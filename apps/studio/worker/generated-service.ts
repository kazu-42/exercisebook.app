import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import { generateWorkbook, type GeneratedWorkbookSnapshot } from "../domain/generator";
import type { ReleaseCatalog } from "../server/release-contract";
import { projectPrintDocument, renderPrintHtml } from "../server/print";
import { levelLessonCatalog } from "../server/level-lessons";
import type { PdfVariant, WorkbookRequest } from "../src/contracts";
import {
  BROWSER_PDF_FONT_SHA256,
  RENDERER_VERSION,
  renderBrowserPdf,
  type BrowserPdfBinding,
} from "./browser-pdf";
import {
  GeneratedWorkbookStore,
  type GeneratedDatabase,
  type RenderArtifact,
} from "./generated-store";

export interface StoredObject {
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ArtifactBucket {
  get(key: string): Promise<StoredObject | null>;
  put(
    key: string,
    bytes: Uint8Array,
    options: {
      onlyIf: { etagDoesNotMatch: string };
      httpMetadata: { contentType: string; cacheControl: string };
    },
  ): Promise<unknown>;
}

export interface RequestLimiter {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

export interface GeneratedBindings {
  readonly STUDIO_DB: GeneratedDatabase;
  readonly STUDIO_ARTIFACTS: ArtifactBucket;
  readonly BROWSER: BrowserPdfBinding;
  readonly STUDIO_CREATE_LIMITER: RequestLimiter;
  readonly STUDIO_RENDER_LIMITER: RequestLimiter;
}

export class GeneratedBusyError extends Error {}

export async function useResourceLimit(
  limiter: RequestLimiter,
  key: string,
): Promise<void> {
  if (!limiter || typeof limiter.limit !== "function")
    throw new TypeError("Missing resource limiter.");
  const result = await limiter.limit({ key });
  if (!result || typeof result.success !== "boolean")
    throw new TypeError("Invalid resource limiter result.");
  if (!result.success)
    throw new GeneratedBusyError("Resource capacity is temporarily full.");
}

export async function createGeneratedWorkbook(
  request: WorkbookRequest,
  idempotencyKey: string,
  release: ReleaseCatalog,
  bindings: GeneratedBindings,
): Promise<GeneratedWorkbookSnapshot> {
  const identity = {
    keyHash: await sha256Hex("studio-create/v1:" + idempotencyKey),
    requestHash: await sha256Hex(
      canonicalizeJson({ schemaVersion: "studio-create/v1", request }),
    ),
    releaseId: release.releaseId,
  };
  const store = new GeneratedWorkbookStore(bindings.STUDIO_DB);
  const replay = await store.lookupRequest(identity);
  if (replay) return replay;
  await useResourceLimit(bindings.STUDIO_CREATE_LIMITER, "studio-create-v1");
  // Only an explicit creation key selects a new seed. Retries and rendering
  // never use current time, process randomness, or a fresh generation request.
  const baseSeed = await sha256Hex(
    canonicalizeJson(["studio-base-seed/v1", identity.keyHash]),
  );
  const snapshot = await generateWorkbook(
    request,
    baseSeed,
    levelLessonCatalog(release.topics, request.level),
    release.sourceRevision,
  );
  return store.create(identity, snapshot);
}

export async function readArtifact(
  bucket: ArtifactBucket,
  artifact: RenderArtifact,
): Promise<Uint8Array> {
  if (!bucket || typeof bucket.get !== "function")
    throw new TypeError("Missing artifact bucket.");
  const object = await bucket.get(`pdf/${artifact.sha256}.pdf`);
  if (!object || object.size !== artifact.bytes || object.size > 5 * 1024 * 1024)
    throw new TypeError("Stored PDF is missing or has changed.");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (
    bytes.byteLength !== artifact.bytes ||
    new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-" ||
    (await sha256Hex(bytes)) !== artifact.sha256
  )
    throw new TypeError("Stored PDF integrity mismatch.");
  return bytes;
}

export async function generatedPdf(
  snapshot: GeneratedWorkbookSnapshot,
  variant: PdfVariant,
  bindings: GeneratedBindings,
): Promise<Uint8Array> {
  const document = projectPrintDocument(snapshot.workbook, snapshot.answers, variant);
  const html = renderPrintHtml(snapshot.workbook, snapshot.answers, variant);
  const rendererSpec = canonicalizeJson({
    renderer: RENDERER_VERSION,
    font: BROWSER_PDF_FONT_SHA256,
    documentHash: await sha256Hex(canonicalizeJson(document)),
    htmlHash: await sha256Hex(html),
  });
  const renderSpecHash = await sha256Hex(
    canonicalizeJson({
      schemaVersion: "studio-render-spec/v1",
      instanceId: snapshot.workbook.id,
      variant,
      rendererSpec,
    }),
  );
  const store = new GeneratedWorkbookStore(bindings.STUDIO_DB);
  const result = await store.claimRender(
    { renderSpecHash, instanceId: snapshot.workbook.id, variant, rendererSpec },
    Date.now(),
    crypto.randomUUID(),
  );
  if (result.status === "complete")
    return readArtifact(bindings.STUDIO_ARTIFACTS, result.artifact);
  if (result.status === "busy")
    throw new GeneratedBusyError("This PDF is already being prepared.");
  try {
    await useResourceLimit(bindings.STUDIO_RENDER_LIMITER, "studio-render-v1");
    if (!bindings.STUDIO_ARTIFACTS || !bindings.BROWSER)
      throw new TypeError("Missing PDF infrastructure.");
    const font = await bindings.STUDIO_ARTIFACTS.get(
      `fonts/${BROWSER_PDF_FONT_SHA256}.ttf`,
    );
    if (!font || font.size !== 9_589_900) throw new TypeError("Missing pinned font.");
    const bytes = await renderBrowserPdf(
      bindings.BROWSER,
      html,
      new Uint8Array(await font.arrayBuffer()),
    );
    if (bytes.byteLength > 5 * 1024 * 1024)
      throw new TypeError("PDF exceeds the stored artifact limit.");
    const artifact = { sha256: await sha256Hex(bytes), bytes: bytes.byteLength };
    // Conditional writes preserve existing content-addressed objects. Verify
    // the winning object before committing its relationship to the instance.
    await bindings.STUDIO_ARTIFACTS.put(`pdf/${artifact.sha256}.pdf`, bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: {
        contentType: "application/pdf",
        cacheControl: "private, no-store",
      },
    });
    const persisted = await readArtifact(bindings.STUDIO_ARTIFACTS, artifact);
    if (!(await store.completeRender(result.claim, artifact, Date.now())))
      throw new GeneratedBusyError(
        "The PDF render claim expired. Retry the same workbook.",
      );
    return persisted;
  } catch (error) {
    await store.failRender(result.claim);
    throw error;
  }
}
