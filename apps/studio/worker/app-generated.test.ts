import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { generateWorkbook, type GeneratedWorkbookSnapshot } from "../domain/generator";
import { topics } from "../server/model";
import type { ReleaseCatalog } from "../server/release-contract";
import { createStudioWorker, type StudioWorkerBindings } from "./app";
import { GeneratedWorkbookStore, IdempotencyConflictError } from "./generated-store";
import { generatedPdf } from "./generated-service";

// Catalog cryptography has its own real-manifest tests in app.test.ts. These
// tests isolate the new HTTP/store orchestration, using a checked fixture.
vi.mock("./release", () => ({ validateReleaseCatalog: vi.fn(async (value) => value) }));
vi.mock("./generated-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./generated-service")>();
  return { ...actual, generatedPdf: vi.fn() };
});
vi.mock("./browser-pdf", () => ({
  BROWSER_PDF_FONT_SHA256: "f".repeat(64),
  RENDERER_VERSION: "test-renderer-v1",
  renderBrowserPdf: vi.fn(),
}));

const origin = "https://studio.example";
const key = "12345678-1234-4234-8234-123456789abc";
const request = { topicId: "equations", level: "foundation", count: 4 } as const;
let snapshot: GeneratedWorkbookSnapshot;
let release: ReleaseCatalog;

function bindings(): StudioWorkerBindings {
  return {
    ASSETS: { fetch: vi.fn(async () => new Response("not found", { status: 404 })) },
    STUDIO_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    STUDIO_CREATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    STUDIO_DB: { prepare: vi.fn(), batch: vi.fn() },
  };
}

function post(path: string, body: unknown, idempotencyKey?: string): Request {
  return new Request(origin + path, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(idempotencyKey === undefined ? {} : { "Idempotency-Key": idempotencyKey }),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  snapshot = await generateWorkbook(
    request,
    "a".repeat(64),
    topics,
    "a".repeat(40) + "+" + "b".repeat(64),
  );
  release = {
    schemaVersion: "studio-release-v1",
    releaseId: "studio-rc-" + "a".repeat(64),
    sourceRevision: snapshot.sourceRevision,
    topics,
    workbooks: [
      {
        workbook: { ...snapshot.workbook, id: "studio-" + "f".repeat(64) },
        answers: snapshot.answers,
        contentSourceHashes: ["a".repeat(64)],
        pdfs: {
          student: {
            path: `/artifacts/${"a".repeat(64)}.pdf`,
            sha256: "a".repeat(64),
            bytes: 100,
          },
          answers: {
            path: `/artifacts/${"b".repeat(64)}.pdf`,
            sha256: "b".repeat(64),
            bytes: 100,
          },
        },
      },
    ],
    assets: [],
  };
  vi.mocked(generatedPdf).mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("generated studio HTTP boundary", () => {
  it("returns only the student projection of the committed generated snapshot", async () => {
    const env = bindings();
    const app = createStudioWorker(release, { generated: true });
    vi.spyOn(GeneratedWorkbookStore.prototype, "lookupRequest").mockResolvedValue(
      undefined,
    );
    const persist = vi
      .spyOn(GeneratedWorkbookStore.prototype, "create")
      .mockResolvedValue(snapshot);
    const response = await app.fetch(post("/studio-api/workbooks", request, key), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(snapshot.workbook);
    expect(persist).toHaveBeenCalledOnce();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(JSON.stringify(snapshot.workbook)).not.toMatch(
      /"(?:answers|answer|manifest|baseSeed|model|submitted)"/,
    );
  });

  it("requires a valid creation key for dynamic generation and keeps headerless compatibility read-only", async () => {
    const env = bindings();
    const load = vi.spyOn(GeneratedWorkbookStore.prototype, "lookupRequest");
    const app = createStudioWorker(release, { generated: true });
    for (const invalid of ["", "not-a-uuid", "12345678-1234-1234-8234-123456789abc"]) {
      expect(
        (await app.fetch(post("/studio-api/workbooks", request, invalid), env)).status,
      ).toBe(400);
    }
    const compatible = await app.fetch(post("/studio-api/workbooks", request), env);
    expect(compatible.status).toBe(200);
    expect(await compatible.json()).toEqual(release.workbooks[0]!.workbook);
    expect(load).not.toHaveBeenCalled();
    expect(env.STUDIO_DB?.prepare).not.toHaveBeenCalled();
    const disabled = createStudioWorker(release);
    expect(
      (await disabled.fetch(post("/studio-api/workbooks", request, key), env)).status,
    ).toBe(400);
  });

  it("returns 409 for a reused key with different conditions without replacement", async () => {
    const env = bindings();
    vi.spyOn(GeneratedWorkbookStore.prototype, "lookupRequest").mockRejectedValue(
      new IdempotencyConflictError(),
    );
    const create = vi.spyOn(GeneratedWorkbookStore.prototype, "create");
    const response = await createStudioWorker(release, { generated: true }).fetch(
      post("/studio-api/workbooks", request, key),
      env,
    );
    expect(response.status).toBe(409);
    expect(create).not.toHaveBeenCalled();
  });

  it("fails closed on missing storage instead of returning a fixed workbook", async () => {
    const env = bindings();
    delete (env as { STUDIO_DB?: unknown }).STUDIO_DB;
    const reportFailure = vi.fn();
    const response = await createStudioWorker(release, {
      generated: true,
      reportFailure,
    }).fetch(post("/studio-api/workbooks", request, key), env);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(snapshot.workbook.items[0]!.prompt);
    expect(reportFailure).toHaveBeenCalledWith("studio_request_failed");
  });

  it("plans syllabi without workbook storage and rejects GET without creating state", async () => {
    const env = bindings();
    delete (env as { STUDIO_DB?: unknown }).STUDIO_DB;
    const app = createStudioWorker(release, { generated: true });
    const response = await app.fetch(
      post("/studio-api/syllabi", {
        goalId: "linear-equations",
        startingPoint: "from-basics",
        weeks: 4,
        dailyMinutes: 15,
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      schemaVersion: "studio-syllabus-v1",
      saved: false,
    });
    const get = await app.fetch(new Request(origin + "/studio-api/syllabi"), env);
    expect(get.status).toBe(405);
    expect(get.headers.get("Allow")).toBe("POST");
  });

  it("checks method, origin, query, and capacity before reading generated instances", async () => {
    const env = bindings();
    const load = vi
      .spyOn(GeneratedWorkbookStore.prototype, "load")
      .mockResolvedValue(snapshot);
    const app = createStudioWorker(release, { generated: true });
    const prefix = `/studio-api/workbooks/${snapshot.workbook.id}`;
    expect((await app.fetch(new Request(origin + prefix + "/grade"), env)).status).toBe(
      405,
    );
    expect(
      (await app.fetch(new Request(origin + prefix + "/pdf?variant=student"), env))
        .status,
    ).toBe(405);
    expect(
      (
        await app.fetch(
          new Request(origin + prefix + "/pdf?variant=student", {
            method: "POST",
            headers: {
              Origin: origin,
              "Content-Type": "application/json",
              "Sec-Fetch-Site": "cross-site",
            },
            body: "{}",
          }),
          env,
        )
      ).status,
    ).toBe(403);
    expect(
      (await app.fetch(post(prefix + "/pdf?variant=unknown", {}), env)).status,
    ).toBe(400);
    expect(
      (
        await app.fetch(
          post(prefix + "/pdf?variant=student", { html: "client supplied" }),
          env,
        )
      ).status,
    ).toBe(400);
    vi.mocked(env.STUDIO_RATE_LIMITER.limit).mockResolvedValueOnce({ success: false });
    expect(
      (await app.fetch(post(prefix + "/pdf?variant=student", {}), env)).status,
    ).toBe(429);
    expect(load).not.toHaveBeenCalled();
  });

  it("keeps replay and grading available after a generated PDF failure", async () => {
    const env = bindings();
    vi.spyOn(GeneratedWorkbookStore.prototype, "load").mockResolvedValue(snapshot);
    vi.spyOn(GeneratedWorkbookStore.prototype, "lookupRequest").mockResolvedValue(
      snapshot,
    );
    const create = vi.spyOn(GeneratedWorkbookStore.prototype, "create");
    vi.mocked(generatedPdf).mockRejectedValue(new Error("browser service unavailable"));
    const reportFailure = vi.fn();
    const app = createStudioWorker(release, { generated: true, reportFailure });
    const prefix = `/studio-api/workbooks/${snapshot.workbook.id}`;
    expect(
      (await app.fetch(post(prefix + "/pdf?variant=student", {}), env)).status,
    ).toBe(503);
    expect(reportFailure).toHaveBeenCalledWith("studio_request_failed");
    const replay = await app.fetch(post("/studio-api/workbooks", request, key), env);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(snapshot.workbook);
    const answers = Object.fromEntries(
      snapshot.answers.map((item) => [item.id, item.answer]),
    );
    const grade = await app.fetch(post(prefix + "/grade", { answers }), env);
    expect(grade.status).toBe(200);
    expect(await grade.json()).toMatchObject({
      workbookId: snapshot.workbook.id,
      correctCount: 4,
      total: 4,
    });
    expect(create).not.toHaveBeenCalled();
  });
});
