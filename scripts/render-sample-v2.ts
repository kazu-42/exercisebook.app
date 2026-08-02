import { constants } from "node:fs";
import { link, lstat, mkdir, open, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface PreparedArtifact {
  readonly filename: string;
  readonly sha256: string;
  readonly utf8Bytes: number;
  readonly contents: string;
}

interface WrittenArtifact extends Omit<PreparedArtifact, "contents"> {
  readonly path: string;
  readonly status: "created" | "unchanged";
}

interface ManifestArtifact {
  readonly filename: string;
  readonly sha256: string;
  readonly utf8Bytes: number;
}

export const MAX_SAMPLE_SOURCE_BYTES = 262_144;

async function main(): Promise<void> {
  const outputDirectory = resolveOutputDirectory(process.argv.slice(2));
  const markdown = await readBoundedRegularUtf8File(
    new URL(
      "../content/en/math/fractions/add-unlike-denominators.v2.md",
      import.meta.url,
    ),
  );
  const { compiler, domain, generators, planner, print } = await loadPipeline();
  const compiledContent = await compiler.compileContentSourceV2(markdown);
  const planned = await planner.planDailyPreviewV2(
    {
      schema: planner.DAILY_PLAN_PREVIEW_REQUEST_V2_SCHEMA,
      goalId: "math.fractions.add-unlike",
      practiceMinutes: 12,
      localStudyDate: "2026-07-19",
      timeZone: "Asia/Tokyo",
      locale: "en",
    },
    planner.DAY_ONE_PREVIEW_REGISTRY_V2,
  );
  if (planned.status !== "ready") {
    throw new Error(`The reviewed V2 sample plan is unavailable: ${planned.code}`);
  }

  const plan = planned.plan;
  const planCanonical = domain.canonicalizeJson(plan);
  const planHash = await domain.sha256Hex(planCanonical);
  const materialized =
    await generators.materializeFractionAdditionWorksheetFromContentV2(
      compiledContent.document,
      plan,
    );
  const [studentPrint, answerKeyPrint] = await Promise.all([
    print.projectStudentPrintDocumentV2({
      materializedWorksheet: materialized,
      paper: "a4",
    }),
    print.projectAnswerKeyPrintDocumentV2({
      materializedWorksheet: materialized,
      paper: "a4",
    }),
  ]);

  const studentSnapshotCanonical = domain.canonicalizeJson(
    print.snapshotPrintSemanticsV2(studentPrint.document),
  );
  const answerKeySnapshotCanonical = domain.canonicalizeJson(
    print.snapshotPrintSemanticsV2(answerKeyPrint.document),
  );
  const studentHtml = print.renderPrintableHtmlV2(studentPrint.document);
  const answerKeyHtml = print.renderPrintableHtmlV2(answerKeyPrint.document);

  const prepared = await Promise.all([
    prepareArtifact(
      domain,
      compiledContent.canonicalJson,
      "content-document.json",
      compiledContent.contentHash,
    ),
    prepareArtifact(domain, planCanonical, "daily-plan.json", planHash),
    prepareArtifact(
      domain,
      materialized.canonicalJson,
      "worksheet-instance.json",
      materialized.instanceHash,
    ),
    prepareArtifact(
      domain,
      studentPrint.canonicalJson,
      "student.print-document.json",
      studentPrint.printDocumentHash,
    ),
    prepareArtifact(
      domain,
      answerKeyPrint.canonicalJson,
      "answer-key.print-document.json",
      answerKeyPrint.printDocumentHash,
    ),
    prepareArtifact(domain, studentSnapshotCanonical, "student.semantic-snapshot.json"),
    prepareArtifact(
      domain,
      answerKeySnapshotCanonical,
      "answer-key.semantic-snapshot.json",
    ),
    prepareArtifact(domain, studentHtml, "student.html"),
    prepareArtifact(domain, answerKeyHtml, "answer-key.html"),
  ]);
  const written = await Promise.all(
    prepared.map((artifact) => writeImmutableArtifact(outputDirectory, artifact)),
  );
  const [
    contentDocumentArtifact,
    dailyPlanArtifact,
    worksheetInstanceArtifact,
    studentPrintDocumentArtifact,
    answerKeyPrintDocumentArtifact,
    studentSemanticSnapshotArtifact,
    answerKeySemanticSnapshotArtifact,
    studentHtmlArtifact,
    answerKeyHtmlArtifact,
  ] = written;
  if (
    contentDocumentArtifact === undefined ||
    dailyPlanArtifact === undefined ||
    worksheetInstanceArtifact === undefined ||
    studentPrintDocumentArtifact === undefined ||
    answerKeyPrintDocumentArtifact === undefined ||
    studentSemanticSnapshotArtifact === undefined ||
    answerKeySemanticSnapshotArtifact === undefined ||
    studentHtmlArtifact === undefined ||
    answerKeyHtmlArtifact === undefined
  ) {
    throw new Error("The V2 print sample artifact set is incomplete.");
  }

  const manifest = {
    schema: "exercisebook.print-sample-manifest.v2",
    sourceHash: compiledContent.document.sourceHash,
    contentHash: compiledContent.contentHash,
    planId: plan.id,
    planHash,
    sourceInstanceHash: materialized.instanceHash,
    projectorVersion: print.PRINT_PROJECTOR_V2_VERSION,
    rendererVersion: print.PRINTABLE_HTML_V2_RENDERER_VERSION,
    semanticSnapshotSchema: print.PRINT_SEMANTIC_SNAPSHOT_V2_SCHEMA,
    artifacts: {
      contentDocument: manifestArtifact(contentDocumentArtifact),
      dailyPlan: manifestArtifact(dailyPlanArtifact),
      canonicalInstance: manifestArtifact(worksheetInstanceArtifact),
      studentPrintDocument: manifestArtifact(studentPrintDocumentArtifact),
      answerKeyPrintDocument: manifestArtifact(answerKeyPrintDocumentArtifact),
      studentSemanticSnapshot: manifestArtifact(studentSemanticSnapshotArtifact),
      answerKeySemanticSnapshot: manifestArtifact(answerKeySemanticSnapshotArtifact),
      studentHtml: manifestArtifact(studentHtmlArtifact),
      answerKeyHtml: manifestArtifact(answerKeyHtmlArtifact),
    },
  } as const;
  await writeImmutableManifest(outputDirectory, manifest);

  process.stdout.write(
    `${JSON.stringify(
      {
        contentHash: compiledContent.contentHash,
        planHash,
        sourceInstanceHash: materialized.instanceHash,
        outputDirectory,
        manifest: "manifest.json",
        artifacts: written,
      },
      undefined,
      2,
    )}\n`,
  );
}

export async function readBoundedRegularUtf8File(path: string | URL): Promise<string> {
  const displayPath = path instanceof URL ? fileURLToPath(path) : path;
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) {
      throw new Error(`Markdown source must be a regular file: ${displayPath}`);
    }
    if (before.size > BigInt(MAX_SAMPLE_SOURCE_BYTES)) {
      throw new Error(
        `Markdown source exceeds ${MAX_SAMPLE_SOURCE_BYTES} bytes: ${displayPath}`,
      );
    }

    const bytes = Buffer.allocUnsafe(MAX_SAMPLE_SOURCE_BYTES + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        null,
      );
      if (bytesRead === 0) {
        break;
      }
      offset += bytesRead;
    }

    const after = await handle.stat({ bigint: true });
    if (
      offset > MAX_SAMPLE_SOURCE_BYTES ||
      after.size > BigInt(MAX_SAMPLE_SOURCE_BYTES)
    ) {
      throw new Error(
        `Markdown source exceeds ${MAX_SAMPLE_SOURCE_BYTES} bytes: ${displayPath}`,
      );
    }
    if (BigInt(offset) !== before.size || after.size !== before.size) {
      throw new Error(
        `Markdown source changed size while being read: ${displayPath} (expected ${before.size} bytes, read ${offset}, final size ${after.size})`,
      );
    }
    if (after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) {
      throw new Error(`Markdown source changed while being read: ${displayPath}`);
    }

    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, offset),
      );
    } catch (error: unknown) {
      throw new Error(`Markdown source is not valid UTF-8: ${displayPath}`, {
        cause: error,
      });
    }
  } finally {
    await handle.close();
  }
}

async function loadPipeline(): Promise<{
  readonly compiler: typeof import("../packages/content-compiler/src/index.js");
  readonly domain: typeof import("../packages/domain/src/index.js");
  readonly generators: typeof import("../packages/generators/src/index.js");
  readonly planner: typeof import("../packages/planner/src/index.js");
  readonly print: typeof import("../packages/print-document/src/index.js");
}> {
  try {
    const [compiler, domain, generators, planner, print] = await Promise.all([
      import("../packages/content-compiler/src/index.js"),
      import("../packages/domain/src/index.js"),
      import("../packages/generators/src/index.js"),
      import("../packages/planner/src/index.js"),
      import("../packages/print-document/src/index.js"),
    ]);
    return { compiler, domain, generators, planner, print };
  } catch (error: unknown) {
    throw new Error(
      "The V2 compiler/domain/planner/generator/print packages are not available. Run the workspace install, then execute `pnpm --filter @exercisebook/print-document render:sample:v2`.",
      { cause: error },
    );
  }
}

async function prepareArtifact(
  domain: typeof import("../packages/domain/src/index.js"),
  contents: string,
  suffix: string,
  expectedHash?: string,
): Promise<PreparedArtifact> {
  const sha256 = await domain.sha256Hex(contents);
  if (expectedHash !== undefined && sha256 !== expectedHash) {
    throw new Error(
      `Artifact identity mismatch for ${suffix}: expected ${expectedHash}, received ${sha256}.`,
    );
  }
  return {
    filename: `${sha256}.${suffix}`,
    sha256,
    utf8Bytes: new TextEncoder().encode(contents).byteLength,
    contents,
  };
}

async function writeImmutableArtifact(
  outputDirectory: string,
  artifact: PreparedArtifact,
): Promise<WrittenArtifact> {
  const path = resolve(outputDirectory, artifact.filename);
  if (dirname(path) !== resolve(outputDirectory)) {
    throw new Error(`Unsafe artifact filename: ${artifact.filename}`);
  }
  const status = await publishImmutableFile(
    outputDirectory,
    artifact.filename,
    artifact.contents,
  );
  return {
    filename: artifact.filename,
    path,
    sha256: artifact.sha256,
    utf8Bytes: artifact.utf8Bytes,
    status,
  };
}

async function writeImmutableManifest(
  outputDirectory: string,
  manifest: object,
): Promise<void> {
  await publishImmutableFile(
    outputDirectory,
    "manifest.json",
    `${JSON.stringify(manifest, undefined, 2)}\n`,
  );
}

async function publishImmutableFile(
  outputDirectory: string,
  filename: string,
  contents: string,
): Promise<"created" | "unchanged"> {
  await ensureOutputDirectory(outputDirectory);
  const finalPath = resolve(outputDirectory, filename);
  const temporaryDirectory = dirname(resolve(outputDirectory));
  const temporaryPath = resolve(
    temporaryDirectory,
    `.${basename(outputDirectory)}.${randomUUID()}.tmp`,
  );
  if (
    dirname(finalPath) !== resolve(outputDirectory) ||
    dirname(temporaryPath) !== temporaryDirectory
  ) {
    throw new Error(`Unsafe immutable output path: ${filename}`);
  }

  const temporary = await open(
    temporaryPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o644,
  );
  try {
    try {
      await temporary.writeFile(contents, { encoding: "utf8" });
      await temporary.sync();
    } finally {
      await temporary.close();
    }
    try {
      await link(temporaryPath, finalPath);
      return "created";
    } catch (error: unknown) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw error;
      }
    }

    const expectedBytes = Buffer.from(contents, "utf8");
    const existing = await readRegularFileBytes(finalPath, expectedBytes.byteLength);
    if (!existing.equals(expectedBytes)) {
      throw new Error(
        `Refusing to overwrite immutable output with different bytes: ${finalPath}`,
      );
    }
    return "unchanged";
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function ensureOutputDirectory(outputDirectory: string): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  for (const directory of [dirname(resolve(outputDirectory)), outputDirectory]) {
    const stats = await lstat(directory);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`The V2 sample output must be a regular directory: ${directory}`);
    }
  }
}

async function readRegularFileBytes(
  path: string,
  expectedBytes: number,
): Promise<Buffer> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw new Error(`Immutable output is not a regular file: ${path}`);
    }
    if (stats.size > expectedBytes) {
      throw new Error(
        `Refusing to overwrite immutable output with different bytes: existing file exceeds its expected size: ${path}`,
      );
    }
    if (stats.size < expectedBytes) {
      throw new Error(
        `Refusing to overwrite immutable output with different bytes: existing file has an unexpected size: ${path}`,
      );
    }
    const bytes = Buffer.allocUnsafe(expectedBytes + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        null,
      );
      if (bytesRead === 0) {
        break;
      }
      offset += bytesRead;
    }
    if (offset > expectedBytes) {
      throw new Error(
        `Refusing to overwrite immutable output with different bytes: existing file exceeds its expected size: ${path}`,
      );
    }
    if (offset < expectedBytes) {
      throw new Error(
        `Refusing to overwrite immutable output with different bytes: existing file has an unexpected size: ${path}`,
      );
    }
    return bytes.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

function manifestArtifact(artifact: WrittenArtifact): ManifestArtifact {
  return {
    filename: artifact.filename,
    sha256: artifact.sha256,
    utf8Bytes: artifact.utf8Bytes,
  };
}

function resolveOutputDirectory(arguments_: readonly string[]): string {
  const positional = arguments_.filter((value) => value !== "--");
  if (positional.length > 1) {
    throw new Error("Usage: render-sample-v2.ts [--] [output-directory]");
  }
  const argument = positional[0];
  if (argument !== undefined) {
    return resolve(argument);
  }
  return fileURLToPath(new URL("../output/print-sample-v2/", import.meta.url));
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

const invokedEntrypoint = process.argv[1];
if (
  invokedEntrypoint !== undefined &&
  fileURLToPath(import.meta.url) === resolve(invokedEntrypoint)
) {
  main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown V2 sample-render failure";
    process.stderr.write(`render-sample-v2: ${message}\n`);
    process.exitCode = 1;
  });
}
