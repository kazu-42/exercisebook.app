import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import { topics } from "../server/model";
import { renderPdf } from "../server/pdf";
import { projectPrintDocument, renderPrintHtml } from "../server/print";
import { materializeWorkbooks, releaseIdFor } from "../server/release-build";
import { validateReleaseCatalog } from "../worker/release";
import type {
  ReleaseAsset,
  ReleaseCatalog,
  ReleasedWorkbook,
} from "../server/release-contract";

const appRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(appRoot, "../..");
const destination = path.join(appRoot, ".release");
const staging = path.join(appRoot, ".release-build-" + process.pid);
const publicRoot = path.join(staging, "public");

async function filesUnder(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "__pycache__" || entry.name === ".DS_Store") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await filesUnder(fullPath)));
    else if (entry.isFile()) result.push(fullPath);
    else throw new Error("Release inputs cannot contain links or special files.");
  }
  return result.sort();
}

async function collectSources() {
  const paths = [
    ...(await filesUnder(path.join(appRoot, "src"))),
    ...(await filesUnder(path.join(appRoot, "server"))),
    ...(await filesUnder(path.join(appRoot, "domain"))),
    ...(await filesUnder(path.join(appRoot, "worker"))),
    ...(await filesUnder(path.join(appRoot, "scripts"))),
    ...(await filesUnder(path.join(appRoot, "assets"))),
    ...(await filesUnder(path.join(repositoryRoot, "content/studio"))),
    ...(await filesUnder(path.join(repositoryRoot, "patches"))),
    ...(await filesUnder(path.join(repositoryRoot, "packages/domain/src"))),
    ...(await filesUnder(path.join(repositoryRoot, "apps/web/src/shared"))),
    ...(await filesUnder(path.join(appRoot, "dist"))),
    path.join(appRoot, "index.html"),
    path.join(appRoot, "vite.config.ts"),
    path.join(appRoot, "package.json"),
    path.join(appRoot, "wrangler.jsonc"),
    path.join(appRoot, "wrangler.production.jsonc"),
    path.join(repositoryRoot, "package.json"),
    path.join(repositoryRoot, "scripts/check-extract-zip-patch.mjs"),
    path.join(repositoryRoot, "packages/domain/package.json"),
    path.join(repositoryRoot, "tsconfig.base.json"),
    path.join(repositoryRoot, "pnpm-workspace.yaml"),
    path.join(repositoryRoot, "pnpm-lock.yaml"),
  ].sort();
  return Promise.all(
    paths.map(async (file) => ({
      path: path.relative(repositoryRoot, file).split(path.sep).join("/"),
      sha256: await sha256Hex(await readFile(file)),
    })),
  );
}

await mkdir(publicRoot, { recursive: true });
try {
  const sources = await collectSources();
  const semanticPaths = new Set([
    "apps/studio/server/model.ts",
    "apps/studio/server/release-contract.ts",
    "apps/studio/worker/app.ts",
    "apps/studio/src/contracts.ts",
    "apps/studio/domain/math-model.ts",
    "apps/studio/domain/generator.ts",
  ]);
  const sourceHashes = sources
    .filter(
      (source) =>
        semanticPaths.has(source.path) || source.path.startsWith("content/studio/"),
    )
    .map((source) => source.sha256);
  const frozen = await materializeWorkbooks(sourceHashes);
  const assets: ReleaseAsset[] = [];
  for (const file of await filesUnder(path.join(appRoot, "dist"))) {
    const relative = path
      .relative(path.join(appRoot, "dist"), file)
      .split(path.sep)
      .join("/");
    if (
      relative !== "index.html" &&
      !/^assets\/[A-Za-z0-9_-]+\.(?:js|css)$/.test(relative)
    )
      throw new Error("Unexpected client artifact: " + relative);
    const bytes = await readFile(file);
    const target = path.join(publicRoot, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: "wx" });
    assets.push({
      path: "/" + relative,
      sha256: await sha256Hex(bytes),
      bytes: bytes.length,
      contentType: relative.endsWith(".html")
        ? "text/html"
        : relative.endsWith(".js")
          ? "text/javascript"
          : "text/css",
    });
  }
  if (!assets.some((asset) => asset.path === "/index.html"))
    throw new Error("Build the client first.");
  await mkdir(path.join(publicRoot, "artifacts"), { recursive: true });
  const workbooks: ReleasedWorkbook[] = [];
  const renderRecords = [];
  for (const entry of frozen) {
    const rendered = await Promise.all(
      (["student", "answers"] as const).map(async (variant) => {
        const html = renderPrintHtml(entry.workbook, entry.answers, variant);
        const bytes = await renderPdf(entry.workbook, entry.answers, variant);
        const sha256 = await sha256Hex(bytes);
        const artifact = {
          path: ("/artifacts/" +
            sha256 +
            ".pdf") as ReleasedWorkbook["pdfs"]["student"]["path"],
          sha256,
          bytes: bytes.byteLength,
        };
        await writeFile(path.join(publicRoot, artifact.path), bytes, { flag: "wx" });
        return {
          instanceHash: entry.workbook.instanceHash,
          variant,
          printDocumentHash: await sha256Hex(
            canonicalizeJson(
              projectPrintDocument(entry.workbook, entry.answers, variant),
            ),
          ),
          printHtmlHash: await sha256Hex(html),
          pdf: artifact,
        };
      }),
    );
    const pdfs: ReleasedWorkbook["pdfs"] = {
      student: rendered[0]!.pdf,
      answers: rendered[1]!.pdf,
    };
    renderRecords.push(...rendered);
    workbooks.push({ ...entry, pdfs });
    console.log(
      "Rendered " +
        entry.workbook.topicId +
        "/" +
        entry.workbook.level +
        "/" +
        entry.workbook.count,
    );
  }
  // Re-read inputs: do not publish a mixed build if source changed during rendering.
  if (canonicalizeJson(sources) !== canonicalizeJson(await collectSources()))
    throw new Error(
      "Release inputs changed while rendering. Rebuild after edits finish.",
    );
  const sourceDigest = await sha256Hex(canonicalizeJson(sources));
  const sourceRevision =
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim() +
    "+" +
    sourceDigest;
  const payload = {
    schemaVersion: "studio-release-v1" as const,
    sourceRevision,
    topics,
    workbooks,
    assets,
  };
  const catalog: ReleaseCatalog = {
    ...payload,
    releaseId: await releaseIdFor(payload),
  };
  await validateReleaseCatalog(catalog);
  await writeFile(path.join(staging, "catalog.json"), canonicalizeJson(catalog));
  await writeFile(
    path.join(staging, "build-record.json"),
    JSON.stringify(
      {
        releaseId: catalog.releaseId,
        sourceRevision,
        status: "review-candidate",
        contentLicense: "LicenseRef-ExerciseBook-Review-Only",
        sources,
        renderer: "playwright-1.63.0/chromium",
        renderRecords,
      },
      null,
      2,
    ),
  );
  // Reject a bad PDF before replacing the active local build.
  execFileSync(
    "uv",
    [
      "run",
      "--no-project",
      path.join(appRoot, "scripts/verify-release.py"),
      "--release",
      staging,
      "--output",
      path.join(repositoryRoot, "output/studio-release"),
    ],
    { cwd: repositoryRoot, stdio: "inherit" },
  );
  // Archive exact bytes before replacing the active local build.
  const archive = path.join(
    repositoryRoot,
    "output/studio-releases",
    catalog.releaseId,
  );
  await mkdir(path.dirname(archive), { recursive: true });
  const { cp } = await import("node:fs/promises");
  await cp(staging, archive, { recursive: true, errorOnExist: true, force: false });
  const previous = path.join(appRoot, ".release-build-previous-" + process.pid);
  let hadPrevious = false;
  try {
    await rename(destination, previous);
    hadPrevious = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await rename(staging, destination);
  } catch (error) {
    if (hadPrevious) await rename(previous, destination);
    throw error;
  }
  if (hadPrevious) await rm(previous, { recursive: true });
  console.log(
    JSON.stringify({
      releaseId: catalog.releaseId,
      workbooks: workbooks.length,
      pdfs: renderRecords.length,
      sourceRevision,
    }),
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}
