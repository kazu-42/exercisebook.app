import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const protectedRoots = [
  "packages/content-compiler/src",
  "packages/domain/src",
  "packages/generators/src",
  "packages/planner/src",
  "packages/schemas/src",
];
const sourceExtensions = new Set([".cts", ".mts", ".ts", ".tsx"]);
const forbiddenImports = [
  "@cloudflare/",
  "@exercisebook/print-document",
  "@exercisebook/web-renderer",
  "hono",
  "react",
  "react-dom",
  "wrangler",
];
const clientRoots = ["apps/web/src"];
const forbiddenClientImports = ["@exercisebook/schemas/trusted-student-projection"];

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") {
      return [];
    }

    throw error;
  });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(absolutePath)));
    } else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }

  return files;
}

function isForbidden(specifier) {
  return forbiddenImports.some(
    (prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`),
  );
}

const importPattern =
  /\b(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)["']([^"']+)["']/gu;
const violations = [];

for (const relativeRoot of protectedRoots) {
  const files = await collectSourceFiles(path.join(repositoryRoot, relativeRoot));

  for (const file of files) {
    const source = await readFile(file, "utf8");

    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];

      if (specifier !== undefined && isForbidden(specifier)) {
        violations.push(
          `${path.relative(repositoryRoot, file)} imports forbidden dependency ${JSON.stringify(specifier)}`,
        );
      }
    }
  }
}

for (const relativeRoot of clientRoots) {
  const files = await collectSourceFiles(path.join(repositoryRoot, relativeRoot));

  for (const file of files) {
    const relativeFile = path.relative(repositoryRoot, file);
    if (
      relativeFile.startsWith(
        `apps${path.sep}web${path.sep}src${path.sep}worker${path.sep}`,
      )
    ) {
      continue;
    }
    const source = await readFile(file, "utf8");

    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];

      if (specifier !== undefined && forbiddenClientImports.includes(specifier)) {
        violations.push(
          `${relativeFile} imports trusted server-only dependency ${JSON.stringify(specifier)}`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Import boundary violations:");
  console.error(violations.map((violation) => `- ${violation}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Domain import boundaries are intact.");
}
