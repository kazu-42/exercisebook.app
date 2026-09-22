import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import { validateReleaseCatalog } from "../worker/release";
import type { ReleaseCatalog } from "./release-contract";

export interface SourceRecord {
  readonly path: string;
  readonly sha256: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeRelativePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !/[\\\u0000-\u001f\u007f]/u.test(value) &&
    !path.posix.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

async function readContainedFile(
  root: string,
  relative: string,
  kind: "source" | "release",
): Promise<Uint8Array> {
  if (!safeRelativePath(relative)) throw new Error(`Invalid ${kind} path.`);
  const absolute = path.resolve(root, ...relative.split("/"));
  let resolved: string;
  try {
    resolved = await realpath(absolute);
  } catch {
    throw new Error(`Missing ${kind} file: ${relative}`);
  }
  // Reject links in every component, including links to files inside the root.
  if (resolved !== absolute)
    throw new Error(`Invalid ${kind} path (symbolic link): ${relative}`);
  try {
    return await readFile(absolute);
  } catch {
    throw new Error(`Unreadable ${kind} file: ${relative}`);
  }
}

/** Verify captured inputs without printing source contents or changing artifacts. */
export async function verifySourceRecords(
  repositoryRoot: string,
  sources: unknown,
  sourceRevision: unknown,
): Promise<void> {
  if (!Array.isArray(sources) || sources.length === 0)
    throw new Error("Invalid release source manifest.");
  let previous = "";
  for (const source of sources) {
    if (
      !record(source) ||
      Object.keys(source).length !== 2 ||
      !Object.keys(source).every((key) => key === "path" || key === "sha256")
    )
      throw new Error("Invalid release source record.");
    if (!safeRelativePath(source.path)) throw new Error("Invalid release source path.");
    if (source.path <= previous)
      throw new Error("Release source paths must be sorted and unique.");
    previous = source.path;
    if (typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(source.sha256))
      throw new Error(`Invalid source hash: ${source.path}`);
  }
  if (
    typeof sourceRevision !== "string" ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})\+[a-f0-9]{64}$/u.test(sourceRevision) ||
    sourceRevision.split("+")[1] !== (await sha256Hex(canonicalizeJson(sources)))
  )
    throw new Error("Release source manifest digest does not match sourceRevision.");
  const root = await realpath(repositoryRoot);
  for (const source of sources as SourceRecord[]) {
    const bytes = await readContainedFile(root, source.path, "source");
    if ((await sha256Hex(bytes)) !== source.sha256)
      throw new Error(`Release source has changed: ${source.path}`);
  }
}

async function readJson(root: string, relative: string): Promise<unknown> {
  const bytes = await readContainedFile(root, relative, "release");
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new Error(`Invalid release JSON: ${relative}`);
  }
}

/** Validate the exact catalog, source snapshot, and public bytes before Wrangler. */
export async function verifyReleaseBuild(
  repositoryRoot: string,
  releaseRoot: string,
): Promise<ReleaseCatalog> {
  const root = await realpath(releaseRoot);
  const build = await readJson(root, "build-record.json");
  if (!record(build)) throw new Error("Invalid release build record.");
  await verifySourceRecords(repositoryRoot, build.sources, build.sourceRevision);
  let catalog: ReleaseCatalog;
  try {
    catalog = await validateReleaseCatalog(await readJson(root, "catalog.json"));
  } catch {
    throw new Error("Invalid release catalog: catalog.json");
  }
  if (
    catalog.releaseId !== build.releaseId ||
    catalog.sourceRevision !== build.sourceRevision
  )
    throw new Error("Release catalog does not match build-record.json.");
  const artifacts = [
    ...catalog.assets,
    ...catalog.workbooks.flatMap((entry) => [entry.pdfs.student, entry.pdfs.answers]),
  ];
  for (const artifact of artifacts) {
    const relative = "public/" + artifact.path.slice(1);
    const bytes = await readContainedFile(root, relative, "release");
    if (
      bytes.byteLength !== artifact.bytes ||
      (await sha256Hex(bytes)) !== artifact.sha256
    )
      throw new Error(`Release artifact has changed: ${relative}`);
  }
  return catalog;
}
