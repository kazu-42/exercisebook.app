import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyReleaseBuild } from "../server/source-integrity";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

try {
  if (process.argv.length !== 2) throw new Error("check-release accepts no arguments.");
  const catalog = await verifyReleaseBuild(
    repositoryRoot,
    path.join(repositoryRoot, "apps/studio/.release"),
  );
  process.stdout.write(`Studio release verified: ${catalog.releaseId}\n`);
} catch (error) {
  process.stderr.write(
    `Studio release check failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
}
