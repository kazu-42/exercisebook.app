import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import type { GradeItem, PdfVariant, Workbook } from "../src/contracts";
import {
  createWorkbook,
  getAnswerKey,
  gradeWorkbook,
  InvalidInputError,
  restoreWorkbook,
  topics,
} from "./model";
import { renderPdf } from "./pdf";

type Next = (error?: unknown) => void;
type PdfRenderer = (
  workbook: Workbook,
  answers: readonly GradeItem[],
  variant: PdfVariant,
) => Promise<Uint8Array>;
type FailureEvent = "studio_pdf_failed" | "studio_api_failed";

class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function requireLocalOrigin(request: IncomingMessage): string {
  const host = request.headers.host;
  if (!host || !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::[1-9]\d{0,4})?$/.test(host))
    throw new ApiError(403, "このプレビューはローカル環境でのみ利用できます。");
  let authority: URL;
  try {
    authority = new URL(`http://${host}`);
  } catch {
    throw new ApiError(403, "アクセス元を確認できませんでした。");
  }
  const address = request.socket.remoteAddress;
  if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1")
    throw new ApiError(403, "このプレビューはローカル環境でのみ利用できます。");
  if (
    request.headers.origin !== undefined &&
    request.headers.origin !== authority.origin
  )
    throw new ApiError(403, "アクセス元を確認できませんでした。");
  const fetchSite = request.headers["sec-fetch-site"];
  if (fetchSite !== undefined && fetchSite !== "same-origin" && fetchSite !== "none")
    throw new ApiError(403, "アクセス元を確認できませんでした。");
  return authority.origin;
}

function requireMethod(
  request: IncomingMessage,
  response: ServerResponse,
  expected: "GET" | "POST",
): void {
  if (request.method !== expected) {
    response.setHeader("Allow", expected);
    throw new ApiError(405, "この操作には対応していません。");
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      request.headers["content-type"] ?? "",
    ) ||
    (request.headers["content-encoding"] !== undefined &&
      request.headers["content-encoding"] !== "identity")
  )
    throw new ApiError(415, "JSON 形式で送信してください。");
  const maximumBytes = 8 * 1024;
  const contentLength = request.headers["content-length"];
  if (
    contentLength !== undefined &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes)
  )
    throw new ApiError(413, "送信内容が大きすぎます。");
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      clearTimeout(timeout);
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("aborted", onAborted);
    };
    const fail = (error: ApiError) => {
      cleanup();
      request.resume();
      reject(error);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > maximumBytes) {
        fail(new ApiError(413, "送信内容が大きすぎます。"));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const onError = () => fail(new ApiError(400, "送信内容を読み取れませんでした。"));
    const onAborted = () => fail(new ApiError(400, "送信が中断されました。"));
    const timeout = setTimeout(
      () => fail(new ApiError(408, "送信に時間がかかりすぎています。")),
      5_000,
    );
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
    request.on("aborted", onAborted);
  });
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new ApiError(400, "送信内容を読み取れませんでした。");
  }
}

export function createStudioMiddleware(
  options: {
    renderPdf?: PdfRenderer;
    reportFailure?: (event: FailureEvent) => void;
  } = {},
) {
  const render = options.renderPdf ?? renderPdf;
  const reportFailure =
    options.reportFailure ??
    ((event: FailureEvent) => console.error(`[studio-api] ${event}`));

  return (request: IncomingMessage, response: ServerResponse, next: Next): void => {
    if (request.url !== "/studio-api" && !request.url?.startsWith("/studio-api/")) {
      next();
      return;
    }
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    void (async () => {
      const origin = requireLocalOrigin(request);
      const url = new URL(request.url ?? "/", origin);
      if (!url.pathname.endsWith("/pdf") && url.search !== "")
        throw new ApiError(400, "URL の条件を確認してください。");

      if (url.pathname === "/studio-api/catalog") {
        requireMethod(request, response, "GET");
        json(response, 200, { topics });
        return;
      }
      if (url.pathname === "/studio-api/workbooks") {
        requireMethod(request, response, "POST");
        json(response, 200, createWorkbook(await readJson(request)));
        return;
      }
      const route = /^\/studio-api\/workbooks\/(draft-[a-f0-9]{64})\/(grade|pdf)$/.exec(
        url.pathname,
      );
      if (!route) throw new ApiError(404, "問題集が見つかりませんでした。");
      const workbook = restoreWorkbook(route[1] ?? "");
      if (!workbook) throw new ApiError(404, "問題集が見つかりませんでした。");
      if (route[2] === "grade") {
        requireMethod(request, response, "POST");
        json(response, 200, gradeWorkbook(workbook, await readJson(request)));
        return;
      }
      requireMethod(request, response, "GET");
      const entries = [...url.searchParams.entries()];
      const variant = url.searchParams.get("variant");
      if (
        entries.length !== 1 ||
        entries[0]?.[0] !== "variant" ||
        (variant !== "student" && variant !== "answers")
      )
        throw new ApiError(400, "PDF の種類を選んでください。");
      let pdf: Uint8Array;
      try {
        pdf = await render(workbook, getAnswerKey(workbook), variant);
      } catch {
        reportFailure("studio_pdf_failed");
        throw new ApiError(
          503,
          "PDF を作成できませんでした。画面の問題集は引き続き使えます。少し待ってから再度お試しください。",
        );
      }
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/pdf");
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="exercisebook-${workbook.topicId}-${variant}.pdf"`,
      );
      response.setHeader("Content-Length", pdf.byteLength);
      response.end(pdf);
    })().catch((error: unknown) => {
      if (response.destroyed || response.writableEnded) return;
      if (error instanceof ApiError) {
        if (error.status === 413 || error.status === 408)
          response.setHeader("Connection", "close");
        json(response, error.status, { error: error.message });
      } else if (error instanceof InvalidInputError) {
        json(response, 400, { error: error.message });
      } else {
        reportFailure("studio_api_failed");
        json(response, 500, {
          error: "処理を完了できませんでした。もう一度お試しください。",
        });
      }
    });
  };
}

export function studioApiPlugin(): Plugin {
  return {
    name: "local-draft-workbook-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(createStudioMiddleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(createStudioMiddleware());
    },
  };
}
