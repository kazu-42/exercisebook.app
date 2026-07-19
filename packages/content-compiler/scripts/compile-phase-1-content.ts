import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { compileContentSource } from "../src/index.js";

const sourceUrl = new URL(
  "../../../content/en/math/fractions/add-unlike-denominators.md",
  import.meta.url,
);
const outputUrl = new URL(
  "../../../content/compiled/math.fractions.add-unlike-denominators.v1.json",
  import.meta.url,
);
const arguments_ = process.argv.slice(2);

if (
  arguments_.some((argument) => argument !== "--check") ||
  arguments_.filter((argument) => argument === "--check").length > 1
) {
  throw new Error("Usage: compile-phase-1-content.ts [--check]");
}

const source = await readFile(sourceUrl, "utf8");
const compiled = await compileContentSource(source);

if (arguments_.includes("--check")) {
  let committed: string;
  try {
    committed = await readFile(outputUrl, "utf8");
  } catch (error: unknown) {
    throw new Error(
      "The compiled Phase-1 content artifact is missing. Run `pnpm content:generate`.",
      { cause: error },
    );
  }
  if (committed !== compiled.canonicalJson) {
    throw new Error(
      "The compiled Phase-1 content artifact is stale. Run `pnpm content:generate` and review the semantic diff.",
    );
  }
  process.stdout.write(`Content artifact is current: ${compiled.contentHash}\n`);
} else {
  await mkdir(dirname(outputUrl.pathname), { recursive: true });
  const temporaryUrl = new URL(`${outputUrl.href}.tmp`);
  try {
    await writeFile(temporaryUrl, compiled.canonicalJson, {
      encoding: "utf8",
      flag: "w",
    });
    await rename(temporaryUrl, outputUrl);
  } finally {
    await rm(temporaryUrl, { force: true });
  }
  process.stdout.write(
    `Wrote canonical ContentDocumentV1 ${compiled.contentHash} to ${outputUrl.pathname}\n`,
  );
}
