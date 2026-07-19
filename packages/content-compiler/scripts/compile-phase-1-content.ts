import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { compileContentSource, compileContentSourceV2 } from "../src/index.js";

const sourceUrl = new URL(
  "../../../content/en/math/fractions/add-unlike-denominators.md",
  import.meta.url,
);
const outputUrl = new URL(
  "../../../content/compiled/math.fractions.add-unlike-denominators.v1.json",
  import.meta.url,
);
const sourceV2Url = new URL(
  "../../../content/en/math/fractions/add-unlike-denominators.v2.md",
  import.meta.url,
);
const outputV2Url = new URL(
  "../../../content/compiled/math.fractions.add-unlike-denominators.v2.json",
  import.meta.url,
);
const arguments_ = process.argv.slice(2);

if (
  arguments_.some((argument) => argument !== "--check") ||
  arguments_.filter((argument) => argument === "--check").length > 1
) {
  throw new Error("Usage: compile-phase-1-content.ts [--check]");
}

const [source, sourceV2] = await Promise.all([
  readFile(sourceUrl, "utf8"),
  readFile(sourceV2Url, "utf8"),
]);
const [compiled, compiledV2] = await Promise.all([
  compileContentSource(source),
  compileContentSourceV2(sourceV2),
]);

if (arguments_.includes("--check")) {
  await checkArtifact(outputUrl, compiled.canonicalJson, "ContentDocumentV1");
  await checkArtifact(outputV2Url, compiledV2.canonicalJson, "ContentDocumentV2");
  process.stdout.write(
    `Content artifacts are current: v1 ${compiled.contentHash}; v2 ${compiledV2.contentHash}\n`,
  );
} else {
  await writeArtifact(outputUrl, compiled.canonicalJson);
  await writeArtifact(outputV2Url, compiledV2.canonicalJson);
  process.stdout.write(
    `Wrote canonical ContentDocumentV1 ${compiled.contentHash} to ${outputUrl.pathname}\nWrote canonical ContentDocumentV2 ${compiledV2.contentHash} to ${outputV2Url.pathname}\n`,
  );
}

async function checkArtifact(
  fileUrl: URL,
  canonicalJson: string,
  documentName: string,
): Promise<void> {
  let committed: string;
  try {
    committed = await readFile(fileUrl, "utf8");
  } catch (error: unknown) {
    throw new Error(
      `The compiled ${documentName} content artifact is missing. Run \`pnpm content:generate\`.`,
      { cause: error },
    );
  }
  if (committed !== canonicalJson) {
    throw new Error(
      `The compiled ${documentName} content artifact is stale. Run \`pnpm content:generate\` and review the semantic diff.`,
    );
  }
}

async function writeArtifact(fileUrl: URL, canonicalJson: string): Promise<void> {
  await mkdir(dirname(fileUrl.pathname), { recursive: true });
  const temporaryUrl = new URL(`${fileUrl.href}.tmp`);
  try {
    await writeFile(temporaryUrl, canonicalJson, {
      encoding: "utf8",
      flag: "w",
    });
    await rename(temporaryUrl, fileUrl);
  } finally {
    await rm(temporaryUrl, { force: true });
  }
}
