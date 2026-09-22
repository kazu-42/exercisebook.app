import { sha256Hex } from "@exercisebook/domain";
import { parseStrictJson } from "../../web/src/shared/strict-json";
import type { GradeItem, GradeResult, WorkbookRequest } from "../src/contracts";
import type {
  ReleaseArtifact,
  ReleaseAsset,
  ReleaseCatalog,
  ReleasedWorkbook,
} from "../server/release-contract";
import { validateReleaseCatalog } from "./release";
import { planSyllabus, parseSyllabusRequest } from "../domain/syllabus";
import {
  createGeneratedWorkbook,
  generatedPdf,
  GeneratedBusyError,
  type GeneratedBindings,
} from "./generated-service";
import { GeneratedWorkbookStore, IdempotencyConflictError } from "./generated-store";

export interface StudioWorkerBindings extends Partial<GeneratedBindings> {
  readonly ASSETS: { fetch(request: Request): Promise<Response> };
  readonly STUDIO_RATE_LIMITER: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
}

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");
const LIMIT_KEY = "studio-release-candidate-v1";

class HttpError extends Error {
  readonly status: number;
  readonly allow: string | undefined;
  constructor(status: number, message: string, allow?: string) {
    super(message);
    this.status = status;
    this.allow = allow;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}

function secure(response: Response, head: boolean): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", CSP);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  );
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.delete("Set-Cookie");
  return new Response(head ? null : response.body, {
    status: response.status,
    headers,
  });
}

function method(request: Request, expected: string): void {
  if (!expected.split(", ").includes(request.method))
    throw new HttpError(405, "この操作には対応していません。", expected);
}

function sameOrigin(request: Request, required: boolean): void {
  const origin = request.headers.get("Origin");
  if ((required || origin !== null) && origin !== new URL(request.url).origin)
    throw new HttpError(403, "アクセス元を確認できませんでした。");
  const site = request.headers.get("Sec-Fetch-Site");
  if (site !== null && site !== "same-origin" && site !== "none")
    throw new HttpError(403, "アクセス元を確認できませんでした。");
}

function object(
  value: unknown,
  keys?: readonly string[],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (keys === undefined ||
      (Object.keys(value).length === keys.length &&
        Object.keys(value).every((key) => keys.includes(key))))
  );
}

function selection(value: unknown): WorkbookRequest {
  if (
    !object(value, ["topicId", "level", "count"]) ||
    typeof value.topicId !== "string" ||
    !["signed-numbers", "expressions", "equations"].includes(value.topicId) ||
    (value.level !== "foundation" && value.level !== "standard") ||
    (value.count !== 4 && value.count !== 6 && value.count !== 8)
  )
    throw new HttpError(400, "問題集の条件を確認してください。");
  return value as unknown as WorkbookRequest;
}

// This parser is pinned by the release's integer-nfkc-v1 grading policy.
export function parseReleasedInteger(
  value: string,
  equation: boolean,
): number | undefined {
  if (value.length > 64) return undefined;
  let normalized = value.normalize("NFKC").replaceAll("−", "-").trim();
  if (equation) normalized = normalized.replace(/^x\s*=\s*/i, "");
  if (!/^[+-]?\d{1,9}$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function grade(
  entry: Pick<ReleasedWorkbook, "workbook" | "answers">,
  value: unknown,
): GradeResult {
  if (!object(value, ["answers"]) || !object(value.answers))
    throw new HttpError(400, "解答の形式を確認してください。");
  const submissions = value.answers;
  const ids = new Set(entry.workbook.items.map((item) => item.id));
  if (
    !Object.entries(submissions).every(
      ([id, submitted]) =>
        ids.has(id) && typeof submitted === "string" && submitted.length <= 64,
    )
  )
    throw new HttpError(400, "解答の形式を確認してください。");
  const items: GradeItem[] = entry.answers.map((answer) => {
    const submitted = (submissions[answer.id] as string | undefined) ?? "";
    const parsed = parseReleasedInteger(
      submitted,
      entry.workbook.topicId === "equations",
    );
    const status =
      submitted.trim() === ""
        ? "unanswered"
        : parsed === undefined
          ? "invalid"
          : parsed === Number(answer.answer)
            ? "correct"
            : "incorrect";
    return { ...answer, submitted, status };
  });
  return {
    workbookId: entry.workbook.id,
    correctCount: items.filter((item) => item.status === "correct").length,
    total: entry.workbook.count,
    items,
  };
}

async function boundedBytes(
  body: ReadableStream<Uint8Array> | null,
  maximum: number,
  timeoutMs = 5000,
): Promise<Uint8Array> {
  if (body === null) return new Uint8Array();
  const reader = body.getReader();
  const signal = AbortSignal.timeout(timeoutMs);
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  let reads = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (signal.aborted) throw new HttpError(408, "送信に時間がかかりすぎています。");
      if (chunk.done) break;
      reads += 1;
      if (!(chunk.value instanceof Uint8Array) || reads > 1024)
        throw new HttpError(400, "送信内容を読み取れませんでした。");
      size += chunk.value.byteLength;
      if (size > maximum) throw new HttpError(413, "送信内容が大きすぎます。");
      if (chunk.value.byteLength > 0) chunks.push(chunk.value);
    }
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readInput(request: Request): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      request.headers.get("Content-Type") ?? "",
    ) ||
    ![null, "identity"].includes(request.headers.get("Content-Encoding"))
  )
    throw new HttpError(415, "JSON 形式で送信してください。");
  const length = request.headers.get("Content-Length");
  if (length !== null && !/^(?:0|[1-9]\d*)$/.test(length))
    throw new HttpError(400, "送信内容を確認してください。");
  if (length !== null && Number(length) > 8192)
    throw new HttpError(413, "送信内容が大きすぎます。");
  const bytes = await boundedBytes(request.body, 8192);
  try {
    return parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new HttpError(400, "送信内容を読み取れませんでした。");
  }
}

async function rateLimit(bindings: StudioWorkerBindings): Promise<void> {
  if (
    !bindings?.STUDIO_RATE_LIMITER ||
    typeof bindings.STUDIO_RATE_LIMITER.limit !== "function"
  )
    throw new TypeError("Missing rate limiter");
  const result = await bindings.STUDIO_RATE_LIMITER.limit({ key: LIMIT_KEY });
  if (
    result === null ||
    typeof result !== "object" ||
    typeof result.success !== "boolean"
  )
    throw new TypeError("Invalid rate limit result");
  if (!result.success)
    throw new HttpError(429, "しばらく待ってから、もう一度お試しください。");
}

async function asset(
  bindings: StudioWorkerBindings,
  request: Request,
  entry: ReleaseAsset | ReleaseArtifact,
  contentType: string,
): Promise<Response> {
  if (!bindings?.ASSETS || typeof bindings.ASSETS.fetch !== "function")
    throw new TypeError("Missing assets binding");
  const response = await bindings.ASSETS.fetch(
    new Request(new URL(entry.path, request.url), { method: "GET" }),
  );
  if (response.status !== 200 || response.headers.has("Set-Cookie"))
    throw new TypeError("Static asset unavailable");
  const actualType = response.headers.get("Content-Type")?.split(";", 1)[0]?.trim();
  if (
    actualType !== contentType &&
    !(contentType === "text/javascript" && actualType === "application/javascript")
  )
    throw new TypeError("Static asset content type mismatch");
  let bytes: Uint8Array;
  try {
    bytes = await boundedBytes(response.body, entry.bytes);
  } catch {
    throw new TypeError("Static asset read failed");
  }
  if (bytes.byteLength !== entry.bytes || (await sha256Hex(bytes)) !== entry.sha256)
    throw new TypeError("Static asset integrity mismatch");
  if (
    contentType === "application/pdf" &&
    new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-"
  )
    throw new TypeError("Invalid PDF signature");
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control":
        contentType === "text/html" || contentType === "application/pdf"
          ? "private, no-store"
          : "public, max-age=31536000, immutable",
    },
  });
}

export function createStudioWorker(
  catalog: unknown,
  options: {
    reportFailure?: (event: "studio_release_failed" | "studio_request_failed") => void;
    generated?: boolean;
  } = {},
) {
  const report =
    options.reportFailure ?? ((event) => console.error(JSON.stringify({ event })));
  let checked: Promise<ReleaseCatalog> | undefined;

  return {
    async fetch(request: Request, bindings: StudioWorkerBindings): Promise<Response> {
      let release: ReleaseCatalog;
      try {
        release = await (checked ??= validateReleaseCatalog(catalog));
      } catch {
        report("studio_release_failed");
        return secure(
          json({ error: "教材の公開準備を確認できませんでした。" }, 503),
          request.method === "HEAD",
        );
      }
      try {
        const url = new URL(request.url);
        if (url.pathname === "/api/health") {
          method(request, "GET, HEAD");
          if (url.search !== "")
            throw new HttpError(404, "ページが見つかりませんでした。");
          return secure(
            json({
              service: "exercisebook-studio",
              status: "ok",
              version: "studio-release-v1",
              releaseId: release.releaseId,
              ...(options.generated
                ? {
                    capabilities: [
                      "syllabus-planning-v1",
                      "seeded-workbooks-v1",
                      "stored-instance-pdf-v1",
                    ],
                  }
                : {}),
            }),
            request.method === "HEAD",
          );
        }
        if (
          url.pathname === "/" ||
          url.pathname === "/new" ||
          release.assets.some(
            (entry) => entry.path !== "/index.html" && entry.path === url.pathname,
          )
        ) {
          method(request, "GET, HEAD");
          if (url.search !== "")
            throw new HttpError(404, "ページが見つかりませんでした。");
          const entry = release.assets.find(
            (candidate) =>
              candidate.path ===
              (url.pathname === "/" || url.pathname === "/new"
                ? "/index.html"
                : url.pathname),
          );
          if (!entry) throw new TypeError("Missing checked asset");
          return secure(
            await asset(bindings, request, entry, entry.contentType),
            request.method === "HEAD",
          );
        }
        if (url.pathname === "/studio-api/catalog") {
          method(request, "GET");
          sameOrigin(request, false);
          if (url.search !== "")
            throw new HttpError(400, "URL の条件を確認してください。");
          await rateLimit(bindings);
          return secure(json({ topics: release.topics }), false);
        }
        if (url.pathname === "/studio-api/syllabi" && options.generated) {
          method(request, "POST");
          sameOrigin(request, true);
          if (url.search !== "")
            throw new HttpError(400, "URL の条件を確認してください。");
          await rateLimit(bindings);
          const input = await readInput(request);
          let selection;
          try {
            selection = parseSyllabusRequest(input);
          } catch {
            throw new HttpError(400, "学習計画の条件を確認してください。");
          }
          return secure(json(await planSyllabus(selection)), false);
        }
        if (url.pathname === "/studio-api/workbooks") {
          method(request, "POST");
          sameOrigin(request, true);
          if (url.search !== "")
            throw new HttpError(400, "URL の条件を確認してください。");
          await rateLimit(bindings);
          const selected = selection(await readInput(request));
          const key = request.headers.get("Idempotency-Key");
          if (key !== null) {
            if (
              !options.generated ||
              !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
                key,
              )
            )
              throw new HttpError(400, "問題集の作成キーを確認してください。");
            const snapshot = await createGeneratedWorkbook(
              selected,
              key,
              release,
              bindings as GeneratedBindings,
            );
            return secure(json(snapshot.workbook), false);
          }
          const entry = release.workbooks.find(
            ({ workbook }) =>
              workbook.topicId === selected.topicId &&
              workbook.level === selected.level &&
              workbook.count === selected.count,
          );
          if (!entry) throw new TypeError("Missing checked selection");
          return secure(json(entry.workbook), false);
        }
        const route =
          /^\/studio-api\/workbooks\/(studio-[a-f0-9]{64})\/(grade|pdf)$/.exec(
            url.pathname,
          );
        if (!route) throw new HttpError(404, "ページが見つかりませんでした。");
        await rateLimit(bindings);
        const fixedEntry = release.workbooks.find(
          ({ workbook }) => workbook.id === route[1],
        );
        let input: unknown;
        if (route[2] === "grade") {
          method(request, "POST");
          sameOrigin(request, true);
          if (url.search !== "")
            throw new HttpError(400, "URL の条件を確認してください。");
          input = await readInput(request);
        } else {
          method(request, !fixedEntry && options.generated ? "POST" : "GET, POST");
          sameOrigin(request, request.method === "POST");
          const pairs = [...url.searchParams.entries()];
          if (
            pairs.length !== 1 ||
            pairs[0]?.[0] !== "variant" ||
            !["student", "answers"].includes(pairs[0]?.[1] ?? "")
          )
            throw new HttpError(400, "PDF の種類を選んでください。");
          if (request.method === "POST" && !object(await readInput(request), []))
            throw new HttpError(400, "PDF の作成条件を確認してください。");
        }
        const generated =
          !fixedEntry && options.generated
            ? await new GeneratedWorkbookStore(bindings.STUDIO_DB!).load(route[1]!)
            : undefined;
        const entry = fixedEntry ?? generated;
        if (!entry) throw new HttpError(404, "問題集が見つかりませんでした。");
        if (route[2] === "grade") {
          return secure(json(grade(entry, input)), false);
        }
        const variant = url.searchParams.get("variant") as "student" | "answers";
        const response = fixedEntry
          ? await asset(bindings, request, fixedEntry.pdfs[variant], "application/pdf")
          : new Response(
              (await generatedPdf(
                generated!,
                variant,
                bindings as GeneratedBindings,
              )) as Uint8Array<ArrayBuffer>,
              {
                headers: {
                  "Content-Type": "application/pdf",
                  "Cache-Control": "private, no-store",
                },
              },
            );
        response.headers.set(
          "Content-Disposition",
          `attachment; filename="exercisebook-${entry.workbook.topicId}-${variant}.pdf"`,
        );
        return secure(response, false);
      } catch (error) {
        if (error instanceof IdempotencyConflictError)
          return secure(
            json(
              {
                error:
                  "この作成キーは別の条件で使われています。条件を選び直してください。",
              },
              409,
            ),
            false,
          );
        if (error instanceof GeneratedBusyError) {
          const response = json(
            {
              error:
                "現在、教材を準備しています。少し待ってから、同じ内容でもう一度お試しください。",
            },
            503,
          );
          response.headers.set("Retry-After", "60");
          return secure(response, false);
        }
        if (error instanceof HttpError) {
          const response = json({ error: error.message }, error.status);
          if (error.allow) response.headers.set("Allow", error.allow);
          if (error.status === 429) response.headers.set("Retry-After", "60");
          return secure(response, request.method === "HEAD");
        }
        report("studio_request_failed");
        return secure(
          json(
            { error: "処理を完了できませんでした。少し待ってから再度お試しください。" },
            503,
          ),
          request.method === "HEAD",
        );
      }
    },
  };
}
