import { createHash } from "node:crypto";
import path from "node:path";

export const REVIEWED_INSTALL_INPUT_SHA256 = Object.freeze({
  "package.json": "de8c02cc009a05d424a23b9fcc082bc1f1fdeebff5c3d80b384263893e9c81c4",
  "pnpm-lock.yaml": "2c7fddb71346b826f1540ecb1bf8f3a57d50c78acb1662bffdaabe5ead8ee4db",
  "pnpm-workspace.yaml":
    "d79358652e7a27a03be67d38263092cb15cf0b6ebdb03f7222be29324ddebcdd",
  "apps/web/package.json":
    "b6d9816ac362971e2b9e368ccf5d2a852d0a43fc623e94c8e9ec0b0d390ce7b2",
  "packages/content-compiler/package.json":
    "97b339890371e4607a2587efdd56a5c54c824cf6d4004f937e8f4c75a6752f7a",
  "packages/domain/package.json":
    "d6f812176d77d74e8f2419b91feebd68894847c342284eae9ee573adbb67caa9",
  "packages/generators/package.json":
    "2278cf4e6d542aa6a1bb570fd5075b0a4bb51d0089fa52be0c2cf3cbb0554b12",
  "packages/planner/package.json":
    "0ec4f7520a56d59356ab9ad48f96e9b38ca647722276cdacd49b4d1953f88873",
  "packages/print-document/package.json":
    "9584fec88fcc3f1a168dcfd7126a8e3256fd68b952ce34bc33b830aaa73679cc",
  "packages/schemas/package.json":
    "864eed2b228c2f055a1c2d2ed64f6c778ad5b24b8defcb46b195d72efdbfc17b",
  "packages/test-fixtures/package.json":
    "e5c26ea2c46e04c035a2231452ddb6698956c3612cc0aac90ea68f733bc69926",
  "packages/web-renderer/package.json":
    "6e418e072a80ecb7841ae4b1982159301dc206f8f7589d67b003a81c111b3346",
});

export const REVIEWED_WORKSPACE_MANIFESTS = Object.freeze(
  Object.keys(REVIEWED_INSTALL_INPUT_SHA256).filter(
    (relativeFile) =>
      relativeFile !== "package.json" && relativeFile.endsWith("/package.json"),
  ),
);

const reviewedWorkspaceDirectories = REVIEWED_WORKSPACE_MANIFESTS.map((relativeFile) =>
  relativeFile.slice(0, -"/package.json".length),
);
const installConfigurationNames = [".npmrc", ".pnpmfile.cjs", ".pnpmfile.mjs"];

export const REVIEWED_INSTALL_PACKAGE_ROOTS = Object.freeze([
  ".",
  ...reviewedWorkspaceDirectories,
]);

export const FORBIDDEN_INSTALL_INPUTS = Object.freeze(
  [".", "apps", "packages", ...reviewedWorkspaceDirectories].flatMap((relativeRoot) =>
    installConfigurationNames.map((fileName) =>
      relativeRoot === "." ? fileName : `${relativeRoot}/${fileName}`,
    ),
  ),
);

function workspacePackageRootsFromSources(sources) {
  return Object.keys(sources)
    .filter((relativeFile) =>
      /^(?:apps|packages)\/[^/]+\/package\.json$/u.test(relativeFile),
    )
    .map((relativeFile) => relativeFile.slice(0, -"/package.json".length));
}

function isDirectGypInput(relativeFile, packageRoots) {
  return (
    path.posix.basename(relativeFile).toLowerCase().endsWith(".gyp") &&
    packageRoots.has(path.posix.dirname(relativeFile))
  );
}

export function assertReviewedInstallInput(relativeFile, source) {
  const expectedDigest = REVIEWED_INSTALL_INPUT_SHA256[relativeFile];
  if (expectedDigest === undefined) {
    throw new TypeError(`Unknown reviewed install input: ${relativeFile}`);
  }
  if (typeof source !== "string") {
    throw new Error(
      `${relativeFile} is required for reviewed pre-install dependency verification.`,
    );
  }
  const actualDigest = createHash("sha256").update(source).digest("hex");
  if (actualDigest !== expectedDigest) {
    throw new Error(
      `${relativeFile} must exactly match the reviewed pre-install dependency input.`,
    );
  }
}

export function assertReviewedInstallInputs(sources) {
  const installPackageRoots = new Set([
    ...REVIEWED_INSTALL_PACKAGE_ROOTS,
    ...workspacePackageRootsFromSources(sources),
  ]);
  const forbiddenGypInputs = Object.keys(sources).filter((relativeFile) =>
    isDirectGypInput(relativeFile, installPackageRoots),
  );
  for (const relativeFile of forbiddenGypInputs) {
    if (sources[relativeFile] !== undefined) {
      throw new Error(
        `${relativeFile} must be absent during reviewed pre-install dependency verification.`,
      );
    }
  }

  const knownInputs = new Set([
    ...Object.keys(REVIEWED_INSTALL_INPUT_SHA256),
    ...FORBIDDEN_INSTALL_INPUTS,
    ...forbiddenGypInputs,
  ]);
  for (const relativeFile of Object.keys(sources)) {
    if (!knownInputs.has(relativeFile)) {
      throw new TypeError(
        `Unknown reviewed pre-install dependency input: ${relativeFile}`,
      );
    }
  }
  for (const relativeFile of Object.keys(REVIEWED_INSTALL_INPUT_SHA256)) {
    assertReviewedInstallInput(relativeFile, sources[relativeFile]);
  }
  for (const relativeFile of FORBIDDEN_INSTALL_INPUTS) {
    if (sources[relativeFile] !== undefined) {
      throw new Error(
        `${relativeFile} must be absent during reviewed pre-install dependency verification.`,
      );
    }
  }
}
