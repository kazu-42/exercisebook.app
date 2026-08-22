import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { compileContentSource } from "../src/index.js";

const targets = [
  {
    name: "Phase-1 historical draft",
    sourceUrl: new URL(
      "../../../content/en/math/fractions/add-unlike-denominators.md",
      import.meta.url,
    ),
    outputUrl: new URL(
      "../../../content/compiled/math.fractions.add-unlike-denominators.v1.json",
      import.meta.url,
    ),
  },
  {
    name: "learning.new launch release candidate",
    sourceUrl: new URL(
      "../../../content/en/math/fractions/add-unlike-denominators.public-v3.md",
      import.meta.url,
    ),
    outputUrl: new URL(
      "../../../content/compiled/math.fractions.add-unlike-denominators.public-v3.json",
      import.meta.url,
    ),
  },
] as const;
const arguments_ = process.argv.slice(2);

if (
  arguments_.some((argument) => argument !== "--check") ||
  arguments_.filter((argument) => argument === "--check").length > 1
) {
  throw new Error("Usage: compile-phase-1-content.ts [--check]");
}

for (const target of targets) {
  const source = await readFile(target.sourceUrl, "utf8");
  const compiled = await compileContentSource(source);

  if (arguments_.includes("--check")) {
    let committed: string;
    try {
      committed = await readFile(target.outputUrl, "utf8");
    } catch (error: unknown) {
      throw new Error(
        `The compiled ${target.name} content artifact is missing. Run \`pnpm content:generate\`.`,
        { cause: error },
      );
    }
    if (committed !== compiled.canonicalJson) {
      throw new Error(
        `The compiled ${target.name} content artifact is stale. Run \`pnpm content:generate\` and review the semantic diff.`,
      );
    }
    process.stdout.write(
      `${target.name} content artifact is current: ${compiled.contentHash}\n`,
    );
    continue;
  }

  await mkdir(dirname(target.outputUrl.pathname), { recursive: true });
  const temporaryUrl = new URL(`${target.outputUrl.href}.tmp`);
  try {
    await writeFile(temporaryUrl, compiled.canonicalJson, {
      encoding: "utf8",
      flag: "w",
    });
    await rename(temporaryUrl, target.outputUrl);
  } finally {
    await rm(temporaryUrl, { force: true });
  }
  process.stdout.write(
    `Wrote canonical ContentDocumentV1 ${compiled.contentHash} to ${target.outputUrl.pathname}\n`,
  );
}
