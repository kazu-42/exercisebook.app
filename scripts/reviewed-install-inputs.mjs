import { createHash } from "node:crypto";
import path from "node:path";

export const REVIEWED_INSTALL_INPUT_SHA256 = Object.freeze({
  "package.json": "48c995fadf04725948d63f4b9fe34d31ff79383346151c1dbcf01483e1882c3b",
  "pnpm-lock.yaml": "98f5003b775e1b68b119095797949452859a9875d96aaf0b19f4796acf31e17e",
  "pnpm-workspace.yaml":
    "429c25c2a28d77266a7b153f2664d2d1fa6ade41fb19589bd23964f69893a361",
  "apps/web/package.json":
    "f020c01eeffedd8ef90464cb9820fdb0358005f255de87e6fe226037a390b9b0",
  "packages/content-compiler/package.json":
    "97b339890371e4607a2587efdd56a5c54c824cf6d4004f937e8f4c75a6752f7a",
  "packages/domain/package.json":
    "067afad13856173551a89c68197e7bd82c443582a9c3ec35b185309b221e8628",
  "packages/generators/package.json":
    "2278cf4e6d542aa6a1bb570fd5075b0a4bb51d0089fa52be0c2cf3cbb0554b12",
  "packages/planner/package.json":
    "23a7952782e695b34c86582f1a73176a6475dfb5a5e36533a0d1fcd185bfe5b2",
  "packages/print-document/package.json":
    "d5213a2272cdbe93876ef441db69d7b4fa366da8de1ac36e02d3dbecc2ff598b",
  "packages/schemas/package.json":
    "d2f51366c96b37fcb5c569816ccf5360b899648e0afbe74f65e106f2e97dc9c4",
  "packages/test-fixtures/package.json":
    "e5c26ea2c46e04c035a2231452ddb6698956c3612cc0aac90ea68f733bc69926",
  "packages/web-renderer/package.json":
    "e595c93edbfc3024d9a186397674806e2ad1791c1f84d7cd286b734f9a380291",
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
