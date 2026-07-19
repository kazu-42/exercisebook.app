import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface WrittenArtifact {
  readonly filename: string;
  readonly path: string;
  readonly status: "created" | "unchanged";
}

async function main(): Promise<void> {
  const outputArgument = process.argv.slice(2).find((value) => value !== "--");
  const outputDirectory = resolveOutputDirectory(outputArgument);
  const { compiler, domain, generators, print } = await loadPipeline();
  const markdown = await readFile(
    new URL("../content/en/math/fractions/add-unlike-denominators.md", import.meta.url),
    "utf8",
  );
  const compiledContent = await compiler.compileContentSource(markdown);
  const sample = generators.FRACTION_ADDITION_SAMPLE_INPUT;
  const materialized = await generators.materializeFractionAdditionWorksheetFromContent(
    compiledContent.document,
    {
      assignmentId: sample.assignmentId,
      localStudyDate: sample.localStudyDate,
      timeZone: sample.timeZone,
      locale: sample.locale,
      seed: sample.seed,
      seedSecretVersion: sample.seedSecretVersion,
    },
  );
  const studentDocument = await print.projectPrintDocumentV1(materialized, {
    variant: "student",
  });
  const answerKeyDocument = await print.projectPrintDocumentV1(materialized, {
    variant: "answer-key",
  });

  const studentCanonical = print.canonicalizePrintDocumentV1(studentDocument);
  const answerKeyCanonical = print.canonicalizePrintDocumentV1(answerKeyDocument);
  const studentHtml = print.renderPrintableHtml(studentDocument);
  const answerKeyHtml = print.renderPrintableHtml(answerKeyDocument);

  const studentDocumentHash = await domain.sha256Hex(studentCanonical);
  const answerKeyDocumentHash = await domain.sha256Hex(answerKeyCanonical);
  const studentHtmlHash = await domain.sha256Hex(studentHtml);
  const answerKeyHtmlHash = await domain.sha256Hex(answerKeyHtml);

  const artifacts = await Promise.all([
    writeImmutableArtifact(
      outputDirectory,
      `${compiledContent.contentHash}.content-document.json`,
      compiledContent.canonicalJson,
    ),
    writeImmutableArtifact(
      outputDirectory,
      `${materialized.instanceHash}.worksheet-instance.json`,
      materialized.canonicalJson,
    ),
    writeImmutableArtifact(
      outputDirectory,
      print.createArtifactFilename(
        studentDocumentHash,
        "student",
        "print-document.json",
      ),
      studentCanonical,
    ),
    writeImmutableArtifact(
      outputDirectory,
      print.createArtifactFilename(
        answerKeyDocumentHash,
        "answer-key",
        "print-document.json",
      ),
      answerKeyCanonical,
    ),
    writeImmutableArtifact(
      outputDirectory,
      print.createArtifactFilename(studentHtmlHash, "student", "html"),
      studentHtml,
    ),
    writeImmutableArtifact(
      outputDirectory,
      print.createArtifactFilename(answerKeyHtmlHash, "answer-key", "html"),
      answerKeyHtml,
    ),
  ]);
  const [
    contentDocumentArtifact,
    worksheetInstanceArtifact,
    studentPrintDocumentArtifact,
    answerKeyPrintDocumentArtifact,
    studentHtmlArtifact,
    answerKeyHtmlArtifact,
  ] = artifacts;
  if (
    contentDocumentArtifact === undefined ||
    worksheetInstanceArtifact === undefined ||
    studentPrintDocumentArtifact === undefined ||
    answerKeyPrintDocumentArtifact === undefined ||
    studentHtmlArtifact === undefined ||
    answerKeyHtmlArtifact === undefined
  ) {
    throw new Error("The print sample artifact set is incomplete");
  }
  const manifest = {
    schema: "exercisebook.print-sample-manifest.v1",
    contentHash: compiledContent.contentHash,
    sourceInstanceHash: materialized.instanceHash,
    artifacts: {
      contentDocument: contentDocumentArtifact.filename,
      canonicalInstance: worksheetInstanceArtifact.filename,
      studentPrintDocument: studentPrintDocumentArtifact.filename,
      answerKeyPrintDocument: answerKeyPrintDocumentArtifact.filename,
      studentHtml: studentHtmlArtifact.filename,
      answerKeyHtml: answerKeyHtmlArtifact.filename,
    },
  };
  await writeFile(
    resolve(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, undefined, 2)}\n`,
    "utf8",
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        contentHash: compiledContent.contentHash,
        sourceInstanceHash: materialized.instanceHash,
        outputDirectory,
        manifest: "manifest.json",
        artifacts,
      },
      null,
      2,
    )}\n`,
  );
}

async function loadPipeline(): Promise<{
  readonly compiler: typeof import("../packages/content-compiler/src/index.js");
  readonly domain: typeof import("../packages/domain/src/index.js");
  readonly generators: typeof import("../packages/generators/src/index.js");
  readonly print: typeof import("../packages/print-document/src/index.js");
}> {
  try {
    const [compiler, domain, generators, print] = await Promise.all([
      import("../packages/content-compiler/src/index.js"),
      import("../packages/domain/src/index.js"),
      import("../packages/generators/src/index.js"),
      import("../packages/print-document/src/index.js"),
    ]);
    return { compiler, domain, generators, print };
  } catch (error: unknown) {
    throw new Error(
      "The shared compiler/domain/generator/print packages are not available. Run the workspace install, then execute `pnpm --filter @exercisebook/print-document render:sample`.",
      { cause: error },
    );
  }
}

function resolveOutputDirectory(argument: string | undefined): string {
  if (argument !== undefined) {
    return resolve(argument);
  }
  return fileURLToPath(new URL("../artifacts/print-sample/", import.meta.url));
}

async function writeImmutableArtifact(
  outputDirectory: string,
  filename: string,
  contents: string,
): Promise<WrittenArtifact> {
  const path = resolve(outputDirectory, filename);
  if (dirname(path) !== resolve(outputDirectory)) {
    throw new Error(`Unsafe artifact filename: ${filename}`);
  }
  await mkdir(outputDirectory, { recursive: true });

  try {
    await writeFile(path, contents, {
      encoding: "utf8",
      flag: "wx",
    });
    return { filename, path, status: "created" };
  } catch (error: unknown) {
    if (!isNodeError(error) || error.code !== "EEXIST") {
      throw error;
    }
  }

  const existing = await readFile(path, "utf8");
  if (existing !== contents) {
    throw new Error(
      `Refusing to overwrite immutable artifact with different bytes: ${path}`,
    );
  }
  return { filename, path, status: "unchanged" };
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown sample-render failure";
  process.stderr.write(`render-sample: ${message}\n`);
  process.exitCode = 1;
});
