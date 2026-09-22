import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { GradeItem } from "../src/contracts";
import {
  createWorkbook,
  getAnswerKey,
  parseIntegerAnswer,
  topics,
} from "../server/model";
import {
  computeWorkbookHash,
  type ReleaseArtifact,
  type ReleaseAsset,
  type ReleaseCatalog,
  type ReleasedWorkbook,
} from "../server/release-contract";
import {
  createStudioWorker,
  parseReleasedInteger,
  type StudioWorkerBindings,
} from "./app";
import { validateReleaseCatalog } from "./release";

const ORIGIN = "https://studio.example";
let catalog: ReleaseCatalog;
const assetBytes = new Map<string, { bytes: Uint8Array; type: string }>();

async function releaseId(
  value: Omit<ReleaseCatalog, "releaseId">,
): Promise<ReleaseCatalog> {
  return {
    ...value,
    releaseId: `studio-rc-${await sha256Hex(canonicalizeJson(value))}`,
  };
}

async function resign(value: ReleaseCatalog): Promise<ReleaseCatalog> {
  const { releaseId: _id, ...unsigned } = value;
  return releaseId(unsigned);
}

beforeAll(async () => {
  const contentSourceHashes = [await sha256Hex("original fixture source")];
  const workbooks: ReleasedWorkbook[] = [];
  for (const topic of topics)
    for (const level of ["foundation", "standard"] as const)
      for (const count of [4, 6, 8] as const) {
        const draft = createWorkbook({ topicId: topic.id, level, count });
        const answers = getAnswerKey(draft);
        const { id: _draftId, instanceHash: _draftHash, ...semantics } = draft;
        const instanceHash = await computeWorkbookHash(
          semantics,
          answers,
          contentSourceHashes,
        );
        const workbook = { ...semantics, instanceHash, id: `studio-${instanceHash}` };
        const pdfs = {} as Record<"student" | "answers", ReleaseArtifact>;
        for (const variant of ["student", "answers"] as const) {
          const bytes = new TextEncoder().encode(
            `%PDF-1.7\n${instanceHash}\n${variant}\n%%EOF`,
          );
          const sha256 = await sha256Hex(bytes);
          const path = `/artifacts/${sha256}.pdf` as const;
          pdfs[variant] = { path, sha256, bytes: bytes.byteLength };
          assetBytes.set(path, { bytes, type: "application/pdf" });
        }
        workbooks.push({ workbook, answers, contentSourceHashes, pdfs });
      }
  const assets: ReleaseAsset[] = [];
  for (const [path, type, content] of [
    ["/index.html", "text/html", '<html lang="ja"><body>学習</body></html>'],
    ["/assets/index-abcd1234.js", "text/javascript", 'console.log("studio shell");'],
    ["/assets/index-abcd1234.css", "text/css", "body { color: black; }"],
  ] as const) {
    const bytes = new TextEncoder().encode(content);
    assets.push({
      path,
      contentType: type,
      bytes: bytes.byteLength,
      sha256: await sha256Hex(bytes),
    });
    assetBytes.set(path, { bytes, type });
  }
  catalog = await releaseId({
    schemaVersion: "studio-release-v1",
    sourceRevision: `test:${"a".repeat(64)}`,
    topics,
    workbooks,
    assets,
  });
});

function bindings(): StudioWorkerBindings {
  return {
    ASSETS: {
      fetch: vi.fn(async (request: Request) => {
        const asset = assetBytes.get(new URL(request.url).pathname);
        return asset
          ? new Response(new Uint8Array(asset.bytes), {
              headers: { "Content-Type": asset.type },
            })
          : new Response("missing", { status: 404 });
      }),
    },
    STUDIO_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
  };
}

function post(
  value: unknown,
  path = "/studio-api/workbooks",
  headers: Record<string, string> = {},
) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", ...headers },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
}

function firstEntry(): ReleasedWorkbook {
  const entry = catalog.workbooks[0];
  if (!entry) throw new Error("Missing fixture workbook");
  return entry;
}

describe("release integrity", () => {
  it.each(["/", "/new"])(
    "prevents edge HTML injection on the public shell at %s",
    async (pathname) => {
      const response = await createStudioWorker(catalog).fetch(
        new Request(ORIGIN + pathname),
        bindings(),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe(
        "private, no-store, no-transform",
      );
      expect(await response.text()).toBe('<html lang="ja"><body>学習</body></html>');
    },
  );

  it("validates all 18 finite selections and their canonical semantic identities", async () => {
    const checked = await validateReleaseCatalog(catalog);
    expect(checked).toEqual(catalog);
    expect(checked).not.toBe(catalog);
    expect(new Set(checked.workbooks.map((entry) => entry.workbook.id)).size).toBe(18);
  });

  it("detects a changed answer even when the outer release hash is updated", async () => {
    const changed = structuredClone(catalog);
    const answer = changed.workbooks[0]?.answers[0];
    if (!answer) throw new Error("Missing answer");
    answer.answer = "999";
    await expect(validateReleaseCatalog(await resign(changed))).rejects.toThrow();
  });

  it("detects source provenance, identity, PDF variant and catalog relation changes", async () => {
    for (const alter of [
      (value: ReleaseCatalog) => {
        Object.assign(value.workbooks[0] ?? {}, {
          contentSourceHashes: ["b".repeat(64)],
        });
      },
      (value: ReleaseCatalog) => {
        (value.workbooks[0] as ReleasedWorkbook).workbook.id =
          `studio-${"a".repeat(64)}`;
      },
      (value: ReleaseCatalog) => {
        const entry = value.workbooks[0] as ReleasedWorkbook;
        (entry.pdfs as { answers: ReleaseArtifact }).answers = entry.pdfs.student;
      },
      (value: ReleaseCatalog) => {
        (value.workbooks[0] as ReleasedWorkbook).workbook.title = "unrelated topic";
      },
      (value: ReleaseCatalog) => {
        Object.assign(value, { workbooks: value.workbooks.slice(1) });
      },
    ]) {
      const changed = structuredClone(catalog);
      alter(changed);
      await expect(validateReleaseCatalog(await resign(changed))).rejects.toThrow();
    }
  });

  it("rejects extra answer data in any public workbook item, including a recomputed outer hash", async () => {
    const changed = structuredClone(catalog);
    Object.assign(changed.workbooks[0]?.workbook.items[0] ?? {}, { answer: "8" });
    await expect(validateReleaseCatalog(await resign(changed))).rejects.toThrow();
  });
});

describe("release Worker routes", () => {
  it("serves an unsaved public workbook with no private answers or artifact paths", async () => {
    const app = createStudioWorker(catalog);
    const env = bindings();
    const response = await app.fetch(
      post({ topicId: "signed-numbers", level: "foundation", count: 4 }),
      env,
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toMatch(/"answers"|"answer"|"submitted"|"pdfs"|artifacts\//);
    expect(JSON.parse(body)).toEqual(firstEntry().workbook);
    expect(JSON.parse(body).saved).toBe(false);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "default-src 'none'",
    );
    expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(
      await (
        await app.fetch(
          post({ topicId: "signed-numbers", level: "foundation", count: 4 }),
          env,
        )
      ).json(),
    ).toEqual(JSON.parse(body));
  });

  it("serves public catalog and safe health metadata", async () => {
    const app = createStudioWorker(catalog);
    const env = bindings();
    expect(
      await (await app.fetch(new Request(`${ORIGIN}/studio-api/catalog`), env)).json(),
    ).toEqual({ topics });
    expect(
      await (await app.fetch(new Request(`${ORIGIN}/api/health`), env)).json(),
    ).toEqual({
      service: "exercisebook-studio",
      version: "studio-release-v1",
      status: "ok",
      releaseId: catalog.releaseId,
    });
    expect(
      await (
        await app.fetch(new Request(`${ORIGIN}/api/health`, { method: "HEAD" }), env)
      ).text(),
    ).toBe("");
  });

  it("grades only explicit same-origin submissions and separates invalid, unanswered and incorrect", async () => {
    const entry = firstEntry();
    const env = bindings();
    const app = createStudioWorker(catalog);
    const response = await app.fetch(
      post(
        { answers: { "q-1": "８", "q-2": "999", "q-3": "0x10" } },
        `/studio-api/workbooks/${entry.workbook.id}/grade`,
      ),
      env,
    );
    const result = (await response.json()) as {
      correctCount: number;
      items: GradeItem[];
    };
    expect(response.status).toBe(200);
    expect(result.correctCount).toBe(1);
    expect(result.items.map((item) => item.status)).toEqual([
      "correct",
      "incorrect",
      "invalid",
      "unanswered",
    ]);
    expect(entry.answers.every((item) => item.submitted === "")).toBe(true);
  });

  it("only serves prebuilt hash-verified PDF through explicit student or answer variant routes", async () => {
    const entry = firstEntry();
    const env = bindings();
    const app = createStudioWorker(catalog);
    for (const variant of ["student", "answers"] as const) {
      const response = await app.fetch(
        new Request(
          `${ORIGIN}/studio-api/workbooks/${entry.workbook.id}/pdf?variant=${variant}`,
        ),
        env,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/pdf");
      expect(response.headers.get("Content-Disposition")).toContain(`${variant}.pdf`);
      expect(await sha256Hex(new Uint8Array(await response.arrayBuffer()))).toBe(
        entry.pdfs[variant].sha256,
      );
    }
    const denied = await app.fetch(
      new Request(`${ORIGIN}${entry.pdfs.answers.path}`),
      env,
    );
    expect(denied.status).toBe(404);
  });

  it("only serves index aliases and precisely manifested hashed JS/CSS", async () => {
    const app = createStudioWorker(catalog);
    const env = bindings();
    for (const path of [
      "/",
      "/new",
      "/assets/index-abcd1234.js",
      "/assets/index-abcd1234.css",
    ]) {
      expect((await app.fetch(new Request(`${ORIGIN}${path}`), env)).status).toBe(200);
      expect(
        await (
          await app.fetch(new Request(`${ORIGIN}${path}`, { method: "HEAD" }), env)
        ).text(),
      ).toBe("");
    }
    for (const path of [
      "/index.html",
      "/.release/catalog.json",
      "/catalog.json",
      "/server/model.ts",
      "/worker/index.ts",
      "/assets/unknown-abcd1234.js",
      "/assets/index-abcd1234.js?raw",
      "/@fs/etc/passwd",
      "/new?learner=private",
    ]) {
      expect((await app.fetch(new Request(`${ORIGIN}${path}`), env)).status).toBe(404);
    }
  });

  it("requires same-origin mutations and rejects cross-site answer/PDF reads", async () => {
    const app = createStudioWorker(catalog);
    const env = bindings();
    const entry = firstEntry();
    for (const headers of [
      { Origin: "https://evil.example" },
      { Origin: "null" },
      { "Sec-Fetch-Site": "cross-site" },
    ]) {
      expect(
        (await app.fetch(post({}, "/studio-api/workbooks", headers), env)).status,
      ).toBe(403);
    }
    expect(
      (
        await app.fetch(
          new Request(`${ORIGIN}/studio-api/workbooks`, {
            method: "POST",
            body: "{}",
            headers: { "Content-Type": "application/json" },
          }),
          env,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await app.fetch(
          new Request(
            `${ORIGIN}/studio-api/workbooks/${entry.workbook.id}/pdf?variant=answers`,
            { headers: { "Sec-Fetch-Site": "cross-site" } },
          ),
          env,
        )
      ).status,
    ).toBe(403);
  });

  it("enforces methods and strict PDF/query allowlists", async () => {
    const app = createStudioWorker(catalog);
    const env = bindings();
    const prefix = `/studio-api/workbooks/${firstEntry().workbook.id}`;
    for (const path of ["/studio-api/workbooks", `${prefix}/grade`]) {
      const response = await app.fetch(new Request(`${ORIGIN}${path}`), env);
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST");
    }
    for (const suffix of [
      "",
      "?variant=teacher",
      "?variant=student&variant=answers",
      "?variant=answers&token=private",
    ])
      expect(
        (await app.fetch(new Request(`${ORIGIN}${prefix}/pdf${suffix}`), env)).status,
      ).toBe(400);
    expect(
      (await app.fetch(new Request(`${ORIGIN}/studio-api/catalog?unknown=1`), env))
        .status,
    ).toBe(400);
    expect(
      (
        await app.fetch(
          new Request(
            `${ORIGIN}/studio-api/workbooks/studio-${"0".repeat(64)}/pdf?variant=answers`,
          ),
          env,
        )
      ).status,
    ).toBe(404);
  });

  it("rejects duplicate JSON keys, wrong shapes/media, invalid UTF-8, and oversized bodies", async () => {
    const app = createStudioWorker(catalog);
    const env = bindings();
    for (const body of [
      '{"topicId":"equations","topicId":"expressions","level":"foundation","count":4}',
      '{"topicId":"equations","\\u0074opicId":"expressions","level":"foundation","count":4}',
      "{",
      "[]",
      "null",
      { topicId: { toString: 1 }, level: "foundation", count: 4 },
      { topicId: "equations", level: "foundation", count: 4, name: "private" },
    ])
      expect((await app.fetch(post(body), env)).status).toBe(400);
    expect(
      (
        await app.fetch(
          post({}, "/studio-api/workbooks", { "Content-Type": "text/plain" }),
          env,
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await app.fetch(
          post({}, "/studio-api/workbooks", { "Content-Encoding": "gzip" }),
          env,
        )
      ).status,
    ).toBe(415);
    expect((await app.fetch(post("x".repeat(9000)), env)).status).toBe(413);
    const malformed = new Request(`${ORIGIN}/studio-api/workbooks`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: new Uint8Array([0xc3, 0x28]),
    });
    expect((await app.fetch(malformed, env)).status).toBe(400);
    const gradePath = `/studio-api/workbooks/${firstEntry().workbook.id}/grade`;
    expect(
      (await app.fetch(post('{"answers":{"q-1":"8","q-1":"9"}}', gradePath), env))
        .status,
    ).toBe(400);
    expect(
      (await app.fetch(post({ answers: { "q-99": "8" } }, gradePath), env)).status,
    ).toBe(400);
  });

  it("bounds streams containing empty chunks as well as total bytes", async () => {
    let pulls = 0;
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array());
      },
      cancel() {
        canceled = true;
      },
    });
    const request = new Request(`${ORIGIN}/studio-api/workbooks`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    const response = await createStudioWorker(catalog).fetch(request, bindings());
    expect(response.status).toBe(400);
    expect(pulls).toBeLessThan(1030);
    expect(canceled).toBe(true);
  });

  it("rate limits without learner identifiers and fails closed on missing or broken bindings", async () => {
    const app = createStudioWorker(catalog);
    const env = bindings();
    vi.mocked(env.STUDIO_RATE_LIMITER.limit).mockResolvedValueOnce({ success: false });
    const limited = await app.fetch(new Request(`${ORIGIN}/studio-api/catalog`), env);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(env.STUDIO_RATE_LIMITER.limit).toHaveBeenCalledWith({
      key: "studio-release-candidate-v1",
    });
    const reportFailure = vi.fn();
    const guarded = createStudioWorker(catalog, { reportFailure });
    expect(
      (
        await guarded.fetch(new Request(`${ORIGIN}/studio-api/catalog`), {
          ASSETS: env.ASSETS,
        } as StudioWorkerBindings)
      ).status,
    ).toBe(503);
    vi.mocked(env.STUDIO_RATE_LIMITER.limit).mockRejectedValueOnce(
      new Error("private input details"),
    );
    const response = await guarded.fetch(
      new Request(`${ORIGIN}/studio-api/catalog`),
      env,
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private input");
    expect(reportFailure).toHaveBeenLastCalledWith("studio_request_failed");
  });

  it("fails loudly on release and asset corruption, while PDF failure leaves web usable", async () => {
    const reportFailure = vi.fn();
    const changed = structuredClone(catalog);
    (changed as { releaseId: string }).releaseId = `studio-rc-${"0".repeat(64)}`;
    expect(
      (
        await createStudioWorker(changed, { reportFailure }).fetch(
          new Request(`${ORIGIN}/api/health`),
          bindings(),
        )
      ).status,
    ).toBe(503);
    expect(reportFailure).toHaveBeenLastCalledWith("studio_release_failed");
    const app = createStudioWorker(catalog, { reportFailure });
    const env = bindings();
    vi.mocked(env.ASSETS.fetch).mockResolvedValueOnce(
      new Response("%PDF-corrupted", {
        headers: { "Content-Type": "application/pdf" },
      }),
    );
    expect(
      (
        await app.fetch(
          new Request(
            `${ORIGIN}/studio-api/workbooks/${firstEntry().workbook.id}/pdf?variant=student`,
          ),
          env,
        )
      ).status,
    ).toBe(503);
    expect(reportFailure).toHaveBeenLastCalledWith("studio_request_failed");
    expect((await app.fetch(new Request(`${ORIGIN}/new`), env)).status).toBe(200);
    expect(
      (
        await app.fetch(
          post({ topicId: "signed-numbers", level: "foundation", count: 4 }),
          env,
        )
      ).status,
    ).toBe(200);
  });

  it("keeps the release grader equivalent to the pinned local parser for numeric edge cases", () => {
    for (const value of [
      "8",
      " −１２ ",
      "＋００４",
      " ｘ＝−３ ",
      "x=4",
      "0x10",
      "1e1",
      "1/2",
      "1.0",
      "--2",
      "NaN",
      "Infinity",
      "2 3",
      "",
      " ",
      "９".repeat(80),
    ])
      for (const equation of [true, false])
        expect(parseReleasedInteger(value, equation)).toBe(
          parseIntegerAnswer(value, equation),
        );
  });
});
