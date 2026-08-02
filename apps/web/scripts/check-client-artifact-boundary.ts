import { constants, type Dirent } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const FORBIDDEN_CLIENT_ARTIFACT_TOKENS = Object.freeze([
  "projectWorksheetForStudentWithCanonicalAnswers",
  "projectWorksheetV2ForStudentWithCanonicalAnswers",
  "prepareStudentVisibleAnswerGuard",
  "assertDoesNotRevealAnyAnswer",
  "assertDoesNotRevealAnswerAt",
  "assertStudentVisibleDataHasNoRecognizedCanonicalAnswers",
  "baseSeed",
  "excludedCanonicalAnswers",
  "canonicalAnswers",
  "seedSecretVersion",
  "seedVersion",
  "slotSeed",
  "solutionTrace",
  "scoringRule",
  "canonicalAnswer",
] as const);

const JAVASCRIPT_EXTENSIONS = new Set([".cjs", ".js", ".mjs"]);
const MAX_CLIENT_ARTIFACT_ENTRIES = 1_000;
const MAX_CLIENT_ARTIFACT_BYTES = 20 * 1_024 * 1_024;
const MAX_CLIENT_ARTIFACT_DEPTH = 16;
const READ_BUFFER_BYTES = 64 * 1_024;
const FORBIDDEN_CLIENT_ARTIFACT_TOKEN_BYTES = FORBIDDEN_CLIENT_ARTIFACT_TOKENS.map(
  (token) => ({
    token,
    bytes: Buffer.from(token, "utf8"),
  }),
);
const MAX_FORBIDDEN_TOKEN_BYTES = Math.max(
  ...FORBIDDEN_CLIENT_ARTIFACT_TOKEN_BYTES.map(({ bytes }) => bytes.byteLength),
);

export type ClientArtifactBoundarySummary = Readonly<{
  filesScanned: number;
  javascriptFiles: number;
  totalBytes: number;
}>;

/**
 * Scan the actual Vite client output, not source reachability predictions.
 * Server-only answer authority must never survive tree shaking into a browser
 * artifact even when it entered through an otherwise public workspace barrel.
 */
export async function scanClientArtifactBoundary(
  clientOutputDirectory: string,
): Promise<ClientArtifactBoundarySummary> {
  const requestedRoot = resolve(clientOutputDirectory);
  let rootStats;
  try {
    rootStats = await lstat(requestedRoot);
  } catch {
    throw new Error(`Missing client artifact directory: ${requestedRoot}`);
  }
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error(
      `Client artifact directory must be a real directory: ${requestedRoot}`,
    );
  }
  const canonicalRoot = await realpath(requestedRoot);
  const state = {
    entriesScanned: 0,
    filesScanned: 0,
    javascriptFiles: 0,
    totalBytes: 0,
  };

  await scanDirectory(canonicalRoot, canonicalRoot, 0, state);
  if (state.javascriptFiles === 0) {
    throw new Error("Client output contains no JavaScript artifact.");
  }
  return {
    filesScanned: state.filesScanned,
    javascriptFiles: state.javascriptFiles,
    totalBytes: state.totalBytes,
  };
}

async function scanDirectory(
  canonicalRoot: string,
  directory: string,
  depth: number,
  state: {
    entriesScanned: number;
    filesScanned: number;
    javascriptFiles: number;
    totalBytes: number;
  },
): Promise<void> {
  if (depth > MAX_CLIENT_ARTIFACT_DEPTH) {
    throw new Error(
      `Client artifact tree exceeds depth ${String(MAX_CLIENT_ARTIFACT_DEPTH)}.`,
    );
  }
  const entries = await opendir(directory);
  for await (const entry of entries) {
    await scanEntry(canonicalRoot, directory, entry, depth, state);
  }
}

async function scanEntry(
  canonicalRoot: string,
  directory: string,
  entry: Dirent,
  depth: number,
  state: {
    entriesScanned: number;
    filesScanned: number;
    javascriptFiles: number;
    totalBytes: number;
  },
): Promise<void> {
  state.entriesScanned += 1;
  if (state.entriesScanned > MAX_CLIENT_ARTIFACT_ENTRIES) {
    throw new Error(
      `Client artifact tree exceeds ${String(MAX_CLIENT_ARTIFACT_ENTRIES)} scanned entries.`,
    );
  }

  const entryPath = resolve(directory, entry.name);
  const displayPath = relative(canonicalRoot, entryPath);
  if (entry.isSymbolicLink()) {
    throw new Error(`Client artifact tree contains a symlink: ${displayPath}`);
  }
  if (entry.isDirectory()) {
    await scanDirectory(canonicalRoot, entryPath, depth + 1, state);
    return;
  }
  if (!entry.isFile()) {
    throw new Error(
      `Client artifact tree contains a non-regular entry: ${displayPath}`,
    );
  }

  const extension = extensionOf(entry.name);
  state.filesScanned += 1;
  if (JAVASCRIPT_EXTENSIONS.has(extension)) {
    state.javascriptFiles += 1;
  }

  await scanRegularFile(entryPath, displayPath, state);
}

async function scanRegularFile(
  entryPath: string,
  displayPath: string,
  state: { totalBytes: number },
): Promise<void> {
  const remainingBytes = MAX_CLIENT_ARTIFACT_BYTES - state.totalBytes;
  const handle = await open(entryPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let fileBytes = 0;
  let overlap = Buffer.alloc(0);
  const readBuffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);

  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw new Error(
        `Client artifact tree contains a non-regular entry: ${displayPath}`,
      );
    }
    if (stats.size > remainingBytes) {
      throwClientArtifactByteLimit();
    }

    while (true) {
      const bytesStillAllowed = remainingBytes - fileBytes;
      const readLength = Math.min(readBuffer.byteLength, bytesStillAllowed + 1);
      const { bytesRead } = await handle.read(readBuffer, 0, readLength, null);
      if (bytesRead === 0) {
        break;
      }
      fileBytes += bytesRead;
      if (fileBytes > remainingBytes) {
        throwClientArtifactByteLimit();
      }

      const scanWindow = Buffer.concat([overlap, readBuffer.subarray(0, bytesRead)]);
      for (const forbidden of FORBIDDEN_CLIENT_ARTIFACT_TOKEN_BYTES) {
        if (scanWindow.indexOf(forbidden.bytes) !== -1) {
          throw new Error(
            `Client artifact ${displayPath} contains server-only token ${forbidden.token}.`,
          );
        }
      }
      overlap = scanWindow.subarray(
        Math.max(0, scanWindow.byteLength - MAX_FORBIDDEN_TOKEN_BYTES + 1),
      );
    }
  } finally {
    await handle.close();
  }
  state.totalBytes += fileBytes;
}

function throwClientArtifactByteLimit(): never {
  throw new Error(
    `Client artifact tree exceeds ${String(MAX_CLIENT_ARTIFACT_BYTES)} scanned bytes.`,
  );
}

function extensionOf(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot === -1 ? "" : fileName.slice(lastDot).toLowerCase();
}

async function runCli(): Promise<void> {
  const defaultClientOutput = fileURLToPath(
    new URL("../dist/client/", import.meta.url),
  );
  const result = await scanClientArtifactBoundary(
    process.argv[2] ?? defaultClientOutput,
  );
  process.stdout.write(
    `Verified ${String(result.javascriptFiles)} client JavaScript artifact(s) across ${String(result.totalBytes)} scanned bytes.\n`,
  );
}

const invokedScript = process.argv[1];
if (
  invokedScript !== undefined &&
  pathToFileURL(resolve(invokedScript)).href === import.meta.url
) {
  await runCli();
}
