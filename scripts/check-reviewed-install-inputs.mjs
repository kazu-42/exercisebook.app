import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  FORBIDDEN_INSTALL_INPUTS,
  REVIEWED_INSTALL_PACKAGE_ROOTS,
  REVIEWED_INSTALL_INPUT_SHA256,
  assertReviewedInstallInputs,
} from "./reviewed-install-inputs.mjs";

async function readOptionalFile(file) {
  return readFile(file, "utf8").catch((error) => {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return undefined;
    }
    throw error;
  });
}

async function readDirectoryEntries(directory) {
  return readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return [];
    }
    throw error;
  });
}

export async function readReviewedInstallInputs(repositoryRoot) {
  const workspaceManifestFiles = (
    await Promise.all(
      ["apps", "packages"].map(async (relativeRoot) => {
        const entries = await readDirectoryEntries(
          path.join(repositoryRoot, relativeRoot),
        );
        return (
          await Promise.all(
            entries
              .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
              .map(async (entry) => {
                const relativeFile = path.posix.join(
                  relativeRoot,
                  entry.name,
                  "package.json",
                );
                const source = await readOptionalFile(
                  path.join(repositoryRoot, relativeFile),
                );
                return source === undefined ? undefined : relativeFile;
              }),
          )
        ).filter((relativeFile) => relativeFile !== undefined);
      }),
    )
  ).flat();
  const installPackageRoots = [
    ...new Set([
      ...REVIEWED_INSTALL_PACKAGE_ROOTS,
      ...workspaceManifestFiles.map((relativeFile) => path.posix.dirname(relativeFile)),
    ]),
  ];
  const gypInputFiles = (
    await Promise.all(
      installPackageRoots.map(async (relativeRoot) => {
        const entries = await readDirectoryEntries(
          path.join(repositoryRoot, relativeRoot),
        );
        return entries
          .filter((entry) => entry.name.toLowerCase().endsWith(".gyp"))
          .map((entry) =>
            relativeRoot === "."
              ? entry.name
              : path.posix.join(relativeRoot, entry.name),
          );
      }),
    )
  ).flat();
  const inputFiles = [
    ...new Set([
      ...Object.keys(REVIEWED_INSTALL_INPUT_SHA256),
      ...FORBIDDEN_INSTALL_INPUTS,
      ...workspaceManifestFiles,
    ]),
  ].sort();

  return {
    ...Object.fromEntries(
      await Promise.all(
        inputFiles.map(async (relativeFile) => [
          relativeFile,
          await readOptionalFile(path.join(repositoryRoot, relativeFile)),
        ]),
      ),
    ),
    ...Object.fromEntries(
      gypInputFiles.map((relativeFile) => [relativeFile, "present"]),
    ),
  };
}

export async function checkReviewedInstallInputs(repositoryRoot) {
  assertReviewedInstallInputs(await readReviewedInstallInputs(repositoryRoot));
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  await checkReviewedInstallInputs(repositoryRoot);
  console.log("Reviewed install inputs are intact.");
}
