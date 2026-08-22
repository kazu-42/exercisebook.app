import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const clientRoot = path.join(repositoryRoot, "apps/web/dist/client");
const generatedConfigPath = path.join(
  repositoryRoot,
  "apps/web/dist/exercisebook_app/wrangler.json",
);
const violations = [];

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") {
      violations.push(
        `Missing launch build directory ${path.relative(repositoryRoot, directory)}`,
      );
      return [];
    }
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolute)));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

const clientFiles = await collectFiles(clientRoot);
const permittedRootFiles = new Set([".assetsignore", "index.html"]);
const permittedAsset =
  /^assets\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:css|js|mjs|png|svg|woff|woff2)$/u;
const forbiddenPublicTokens = [
  "/lessons/",
  "/worksheet/sample",
  "/api/worksheets/sample",
  "LicenseRef-ExerciseBook-Draft",
  "learning-new-launch-2026-08-22",
  "repository-owner",
  "launch-release-manifest",
];

for (const file of clientFiles) {
  const relative = path.relative(clientRoot, file);
  if (!permittedRootFiles.has(relative) && !permittedAsset.test(relative)) {
    violations.push(`Unexpected public launch artifact ${relative}`);
  }
  if (relative.endsWith(".map")) {
    violations.push(`Public source map is forbidden: ${relative}`);
  }
  const bytes = await readFile(file);
  const source = bytes.toString("utf8");
  for (const token of forbiddenPublicTokens) {
    if (source.includes(token)) {
      violations.push(
        `Public launch artifact ${relative} contains forbidden token ${JSON.stringify(token)}`,
      );
    }
  }
}

const indexPath = path.join(clientRoot, "index.html");
const indexHtml = await readFile(indexPath, "utf8").catch(() => "");
if (!indexHtml.includes('href="https://exercisebook.app/new"')) {
  violations.push("Launch index does not declare the canonical /new URL");
}
for (const match of indexHtml.matchAll(/(?:src|href)="([^"]+)"/gu)) {
  const reference = match[1];
  if (
    reference !== "https://exercisebook.app/new" &&
    reference !== "/new" &&
    !reference?.startsWith("/assets/")
  ) {
    violations.push(`Launch index contains an unreviewed resource ${reference}`);
  }
}

const generatedConfig = JSON.parse(
  await readFile(generatedConfigPath, "utf8").catch(() => "{}"),
);
if (
  generatedConfig.assets?.binding !== "ASSETS" ||
  generatedConfig.assets?.run_worker_first !== true ||
  generatedConfig.assets?.html_handling !== "none" ||
  generatedConfig.assets?.not_found_handling !== "none"
) {
  violations.push("Generated primary Worker config does not fail closed on assets");
}
const rateLimits = generatedConfig.ratelimits;
if (
  !Array.isArray(rateLimits) ||
  rateLimits.length !== 1 ||
  rateLimits[0]?.name !== "PREVIEW_RATE_LIMITER" ||
  rateLimits[0]?.namespace_id !== "321001" ||
  rateLimits[0]?.simple?.limit !== 120 ||
  rateLimits[0]?.simple?.period !== 60
) {
  violations.push("Generated primary Worker config has unexpected rate limiting");
}

if (violations.length > 0) {
  console.error("Launch bundle violations:");
  console.error(violations.map((violation) => `- ${violation}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Launch bundle is closed to ${clientFiles.length} reviewed static artifacts.`,
  );
}
