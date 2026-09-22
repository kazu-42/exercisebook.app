import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { generateWorkbook, type GeneratedWorkbookSnapshot } from "../domain/generator";
import { topics } from "../server/model";
import type { ReleaseCatalog } from "../server/release-contract";
import type { WorkbookRequest } from "../src/contracts";
import { renderBrowserPdf, BROWSER_PDF_FONT_SHA256 } from "./browser-pdf";
import { GeneratedWorkbookStore, IdempotencyConflictError } from "./generated-store";
import {
  createGeneratedWorkbook,
  generatedPdf,
  GeneratedBusyError,
  readArtifact,
  type GeneratedBindings,
} from "./generated-service";

vi.mock("../domain/generator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../domain/generator")>();
  return { ...actual, generateWorkbook: vi.fn(actual.generateWorkbook) };
});
vi.mock("./browser-pdf", () => ({
  BROWSER_PDF_FONT_SHA256: "f".repeat(64),
  RENDERER_VERSION: "test-renderer-v1",
  renderBrowserPdf: vi.fn(),
}));

const request: WorkbookRequest = {
  topicId: "equations",
  level: "foundation",
  count: 4,
};
const key = "12345678-1234-4234-8234-123456789abc";
const release: ReleaseCatalog = {
  schemaVersion: "studio-release-v1",
  releaseId: `studio-rc-${"b".repeat(64)}`,
  sourceRevision: "a".repeat(40) + "+" + "b".repeat(64),
  topics,
  workbooks: [],
  assets: [],
};
const pdf = new TextEncoder().encode("%PDF-1.7\n" + "verified output\n".repeat(10));
let snapshot: GeneratedWorkbookSnapshot;

function bindings(): GeneratedBindings {
  const stored = new Map<string, Uint8Array>();
  return {
    STUDIO_DB: { prepare: vi.fn(), batch: vi.fn() },
    STUDIO_CREATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    STUDIO_RENDER_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    BROWSER: { fetch: vi.fn() },
    STUDIO_ARTIFACTS: {
      get: vi.fn(async (name: string) => {
        if (name === `fonts/${BROWSER_PDF_FONT_SHA256}.ttf`)
          return { size: 9_589_900, arrayBuffer: async () => new ArrayBuffer(1) };
        const bytes = stored.get(name);
        return bytes
          ? {
              size: bytes.length,
              arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
            }
          : null;
      }),
      put: vi.fn(async (name: string, bytes: Uint8Array) => {
        stored.set(name, bytes.slice());
      }),
    },
  };
}

function claimRender() {
  return vi
    .spyOn(GeneratedWorkbookStore.prototype, "claimRender")
    .mockImplementation(async (identity, nowMs, claimToken) => ({
      status: "claimed",
      claim: { ...identity, claimToken, leaseExpires: nowMs + 60_000 },
    }));
}

beforeEach(async () => {
  snapshot = await generateWorkbook(
    request,
    "a".repeat(64),
    topics,
    "original-release",
  );
  vi.mocked(generateWorkbook).mockClear();
  vi.mocked(renderBrowserPdf).mockReset().mockResolvedValue(pdf);
});
afterEach(() => vi.restoreAllMocks());

describe("generated workbook orchestration", () => {
  it("replays the original stored snapshot before current generation or creation limits", async () => {
    const env = bindings();
    const lookup = vi
      .spyOn(GeneratedWorkbookStore.prototype, "lookupRequest")
      .mockResolvedValue(snapshot);
    const create = vi.spyOn(GeneratedWorkbookStore.prototype, "create");
    expect(await createGeneratedWorkbook(request, key, release, env)).toBe(snapshot);
    expect(lookup).toHaveBeenCalledWith({
      keyHash: await sha256Hex("studio-create/v1:" + key),
      requestHash: await sha256Hex(
        canonicalizeJson({ schemaVersion: "studio-create/v1", request }),
      ),
      releaseId: release.releaseId,
    });
    expect(generateWorkbook).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(env.STUDIO_CREATE_LIMITER.limit).not.toHaveBeenCalled();
  });

  it("propagates an idempotency conflict without generating or rebinding", async () => {
    const env = bindings();
    vi.spyOn(GeneratedWorkbookStore.prototype, "lookupRequest").mockRejectedValue(
      new IdempotencyConflictError(),
    );
    const create = vi.spyOn(GeneratedWorkbookStore.prototype, "create");
    await expect(
      createGeneratedWorkbook(request, key, release, env),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(generateWorkbook).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("generates against the actual release revision format and returns only the committed winner", async () => {
    const env = bindings();
    vi.spyOn(GeneratedWorkbookStore.prototype, "lookupRequest").mockResolvedValue(
      undefined,
    );
    const create = vi
      .spyOn(GeneratedWorkbookStore.prototype, "create")
      .mockResolvedValue(snapshot);
    const result = await createGeneratedWorkbook(request, key, release, env);
    expect(result).toBe(snapshot);
    expect(generateWorkbook).toHaveBeenCalledWith(
      request,
      expect.stringMatching(/^[a-f0-9]{64}$/),
      topics,
      release.sourceRevision,
    );
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[1].sourceRevision).toBe(release.sourceRevision);
  });

  it("does not return a fresh worksheet when persistence fails", async () => {
    const env = bindings();
    vi.spyOn(GeneratedWorkbookStore.prototype, "lookupRequest").mockResolvedValue(
      undefined,
    );
    vi.spyOn(GeneratedWorkbookStore.prototype, "create").mockRejectedValue(
      new Error("storage unavailable"),
    );
    await expect(
      createGeneratedWorkbook(
        request,
        key,
        { ...release, sourceRevision: "valid-source" },
        env,
      ),
    ).rejects.toThrow("storage unavailable");
  });
});

describe("generated PDF orchestration", () => {
  it("verifies and commits stored bytes before completing the same fenced claim", async () => {
    const env = bindings();
    const claim = claimRender();
    const complete = vi
      .spyOn(GeneratedWorkbookStore.prototype, "completeRender")
      .mockResolvedValue(true);
    const fail = vi
      .spyOn(GeneratedWorkbookStore.prototype, "failRender")
      .mockResolvedValue(true);
    const before = canonicalizeJson(snapshot);
    expect(await generatedPdf(snapshot, "student", env)).toEqual(pdf);
    const hash = await sha256Hex(pdf);
    expect(env.STUDIO_ARTIFACTS.put).toHaveBeenCalledWith(`pdf/${hash}.pdf`, pdf, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: {
        contentType: "application/pdf",
        cacheControl: "private, no-store",
      },
    });
    const acquired = await claim.mock.results[0]!.value;
    if (acquired.status !== "claimed") throw new Error("Expected a render claim");
    expect(complete).toHaveBeenCalledWith(
      acquired.claim,
      { sha256: hash, bytes: pdf.length },
      expect.any(Number),
    );
    expect(fail).not.toHaveBeenCalled();
    expect(canonicalizeJson(snapshot)).toBe(before);
    expect(vi.mocked(renderBrowserPdf).mock.calls[0]?.[1]).not.toContain(
      'class="math canonical-answer"',
    );
    expect(generateWorkbook).not.toHaveBeenCalled();
  });

  it("serves an integrity-checked completed artifact without a browser or new render limit", async () => {
    const env = bindings();
    const artifact = { sha256: await sha256Hex(pdf), bytes: pdf.length };
    await env.STUDIO_ARTIFACTS.put(`pdf/${artifact.sha256}.pdf`, pdf, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: {
        contentType: "application/pdf",
        cacheControl: "private, no-store",
      },
    });
    vi.spyOn(GeneratedWorkbookStore.prototype, "claimRender").mockResolvedValue({
      status: "complete",
      artifact,
    });
    expect(await generatedPdf(snapshot, "answers", env)).toEqual(pdf);
    expect(renderBrowserPdf).not.toHaveBeenCalled();
    expect(env.STUDIO_RENDER_LIMITER.limit).not.toHaveBeenCalled();
  });

  it("does not render while another worker owns the claim", async () => {
    const env = bindings();
    vi.spyOn(GeneratedWorkbookStore.prototype, "claimRender").mockResolvedValue({
      status: "busy",
      retryAt: 60_000,
    });
    await expect(generatedPdf(snapshot, "student", env)).rejects.toBeInstanceOf(
      GeneratedBusyError,
    );
    expect(renderBrowserPdf).not.toHaveBeenCalled();
    expect(env.STUDIO_ARTIFACTS.get).not.toHaveBeenCalled();
  });

  it("does not return an artifact after its claim expires", async () => {
    const env = bindings();
    claimRender();
    vi.spyOn(GeneratedWorkbookStore.prototype, "completeRender").mockResolvedValue(
      false,
    );
    const fail = vi
      .spyOn(GeneratedWorkbookStore.prototype, "failRender")
      .mockResolvedValue(false);
    await expect(generatedPdf(snapshot, "student", env)).rejects.toBeInstanceOf(
      GeneratedBusyError,
    );
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: snapshot.workbook.id, variant: "student" }),
    );
  });

  it("releases the failed render claim without changing the Web snapshot", async () => {
    const env = bindings();
    claimRender();
    const complete = vi.spyOn(GeneratedWorkbookStore.prototype, "completeRender");
    const fail = vi
      .spyOn(GeneratedWorkbookStore.prototype, "failRender")
      .mockResolvedValue(true);
    vi.mocked(renderBrowserPdf).mockRejectedValue(new Error("renderer unavailable"));
    const before = canonicalizeJson(snapshot);
    await expect(generatedPdf(snapshot, "student", env)).rejects.toThrow(
      "renderer unavailable",
    );
    expect(fail).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
    expect(env.STUDIO_ARTIFACTS.put).not.toHaveBeenCalled();
    expect(canonicalizeJson(snapshot)).toBe(before);
    expect(generateWorkbook).not.toHaveBeenCalled();
  });

  it("does not commit when the object winning a conditional write fails integrity", async () => {
    const env = bindings();
    claimRender();
    const complete = vi.spyOn(GeneratedWorkbookStore.prototype, "completeRender");
    const fail = vi
      .spyOn(GeneratedWorkbookStore.prototype, "failRender")
      .mockResolvedValue(true);
    const fetchObject = env.STUDIO_ARTIFACTS.get;
    vi.mocked(env.STUDIO_ARTIFACTS.get).mockImplementation(async (name) => {
      if (name.startsWith("fonts/"))
        return { size: 9_589_900, arrayBuffer: async () => new ArrayBuffer(1) };
      return {
        size: pdf.length,
        arrayBuffer: async () => new Uint8Array(pdf.length).buffer,
      };
    });
    await expect(generatedPdf(snapshot, "student", env)).rejects.toThrow(
      "integrity mismatch",
    );
    expect(fetchObject).toHaveBeenCalledWith(`pdf/${await sha256Hex(pdf)}.pdf`);
    expect(complete).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledOnce();
  });

  it("rejects mismatched object metadata, actual bytes, and digest", async () => {
    const env = bindings();
    const artifact = { sha256: await sha256Hex(pdf), bytes: pdf.length };
    for (const object of [
      null,
      {
        size: pdf.length + 1,
        arrayBuffer: vi.fn(async () => pdf.slice().buffer as ArrayBuffer),
      },
      { size: pdf.length, arrayBuffer: vi.fn(async () => new ArrayBuffer(2)) },
      {
        size: pdf.length,
        arrayBuffer: vi.fn(async () => new Uint8Array(pdf.length).buffer),
      },
      {
        size: pdf.length,
        arrayBuffer: vi.fn(async () => {
          const changed = pdf.slice();
          changed[15] = (changed[15] ?? 0) ^ 1;
          return changed.buffer as ArrayBuffer;
        }),
      },
    ]) {
      vi.mocked(env.STUDIO_ARTIFACTS.get).mockResolvedValueOnce(object);
      await expect(readArtifact(env.STUDIO_ARTIFACTS, artifact)).rejects.toThrow();
    }
  });
});
