import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

const DEFAULT_REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const REVIEWED_BROWSER_SAFE_DOMAIN_MODULES = new Set([
  "packages/domain/src/rational.ts",
]);
const REVIEWED_BROWSER_SAFE_PLANNER_MODULES = new Set([
  "packages/planner/src/public-preview-contract.ts",
]);
const REVIEWED_BROWSER_SAFE_SCHEMA_MODULES = new Set([
  "packages/schemas/src/attribution-v1.ts",
  "packages/schemas/src/common.ts",
  "packages/schemas/src/presentation-contract-v1.ts",
]);
const REVIEWED_BROWSER_SAFE_WEB_RENDERER_MODULES = new Set([
  "packages/web-renderer/src/fraction-bar-explorer.tsx",
  "packages/web-renderer/src/fraction.tsx",
  "packages/web-renderer/src/index.ts",
  "packages/web-renderer/src/model.ts",
  "packages/web-renderer/src/styles.css",
  "packages/web-renderer/src/worksheet-view.tsx",
]);

export type ForbiddenClientModule = Readonly<{
  category:
    | "Worker"
    | "generator"
    | "unreviewed domain"
    | "unreviewed planner"
    | "unreviewed schema"
    | "unreviewed workspace";
  relativePath: string;
}>;

export type ClientModuleProvenanceSummary = Readonly<{
  chunksInspected: number;
  moduleOccurrencesInspected: number;
}>;

/**
 * Classify one resolved Vite/Rolldown module id.
 *
 * Every repository workspace source package is fail-closed. Adding a public
 * leaf or renderer module does not make it browser-safe until this
 * production-build gate is deliberately reviewed with the package export and
 * source-boundary policy.
 */
export function classifyClientModuleId(
  moduleId: string,
  repositoryRoot: string,
): ForbiddenClientModule | undefined {
  const relativePath = logicalWorkspacePath(moduleId, repositoryRoot);
  if (relativePath === undefined) {
    return undefined;
  }

  if (isWithin(relativePath, "apps/web/src/worker")) {
    return { category: "Worker", relativePath };
  }
  if (isWithin(relativePath, "packages/generators/src")) {
    return { category: "generator", relativePath };
  }
  if (
    REVIEWED_BROWSER_SAFE_DOMAIN_MODULES.has(relativePath) ||
    REVIEWED_BROWSER_SAFE_PLANNER_MODULES.has(relativePath) ||
    REVIEWED_BROWSER_SAFE_SCHEMA_MODULES.has(relativePath) ||
    REVIEWED_BROWSER_SAFE_WEB_RENDERER_MODULES.has(relativePath)
  ) {
    return undefined;
  }
  if (
    isWithin(relativePath, "packages/domain/src") &&
    !REVIEWED_BROWSER_SAFE_DOMAIN_MODULES.has(relativePath)
  ) {
    return { category: "unreviewed domain", relativePath };
  }
  if (
    isWithin(relativePath, "packages/planner/src") &&
    !REVIEWED_BROWSER_SAFE_PLANNER_MODULES.has(relativePath)
  ) {
    return { category: "unreviewed planner", relativePath };
  }
  if (
    isWithin(relativePath, "packages/schemas/src") &&
    !REVIEWED_BROWSER_SAFE_SCHEMA_MODULES.has(relativePath)
  ) {
    return { category: "unreviewed schema", relativePath };
  }
  if (isWorkspacePackagePath(relativePath)) {
    return { category: "unreviewed workspace", relativePath };
  }
  return undefined;
}

/**
 * Inspect the final module provenance recorded on every emitted client chunk.
 * This complements byte-token scanning: minification can rename private
 * bindings, but it cannot erase a source module from OutputChunk.modules while
 * retaining that module's rendered code.
 */
export function assertClientModuleProvenance(
  bundle: Readonly<Record<string, unknown>>,
  repositoryRoot: string,
): ClientModuleProvenanceSummary {
  let chunksInspected = 0;
  let moduleOccurrencesInspected = 0;

  for (const [bundleKey, output] of Object.entries(bundle).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!isRecord(output) || output.type !== "chunk") {
      continue;
    }
    chunksInspected += 1;
    const fileName =
      typeof output.fileName === "string" && output.fileName.length > 0
        ? output.fileName
        : bundleKey;
    if (!isRecord(output.modules) || Object.keys(output.modules).length === 0) {
      throw new Error(
        `Client chunk ${JSON.stringify(fileName)} has no module provenance.`,
      );
    }

    const moduleIds = Object.keys(output.modules).sort((left, right) =>
      left.localeCompare(right),
    );
    moduleOccurrencesInspected += moduleIds.length;
    for (const moduleId of moduleIds) {
      const forbidden = classifyClientModuleId(moduleId, repositoryRoot);
      if (forbidden !== undefined) {
        throw new Error(
          `Client chunk ${JSON.stringify(fileName)} contains forbidden ${forbidden.category} module ${JSON.stringify(forbidden.relativePath)}.`,
        );
      }
    }
  }

  if (chunksInspected === 0) {
    throw new Error(
      "Client output contains no JavaScript chunks with module provenance.",
    );
  }
  return { chunksInspected, moduleOccurrencesInspected };
}

export function clientModuleProvenance(
  options: Readonly<{ repositoryRoot?: string }> = {},
): Plugin {
  const repositoryRoot = realpathSync(
    resolve(options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT),
  );

  return {
    name: "exercisebook-client-module-provenance",
    apply: "build",
    enforce: "post",
    applyToEnvironment(environment) {
      return environment.name === "client";
    },
    generateBundle(_outputOptions, bundle) {
      if (this.environment.name !== "client") {
        this.error(
          `Client module provenance gate ran in unexpected Vite environment ${JSON.stringify(this.environment.name)}.`,
        );
      }
      try {
        assertClientModuleProvenance(bundle, repositoryRoot);
      } catch (error) {
        this.error(
          error instanceof Error
            ? error.message
            : "Client module provenance inspection failed.",
        );
      }
    },
  };
}

function logicalWorkspacePath(
  moduleId: string,
  repositoryRoot: string,
): string | undefined {
  let sourcePath = moduleId.replace(/^\u0000+/u, "");
  sourcePath = stripViteQueryAndHash(sourcePath);
  if (sourcePath.startsWith("file:")) {
    try {
      sourcePath = fileURLToPath(sourcePath);
    } catch {
      return undefined;
    }
  }
  if (sourcePath.startsWith("/@fs/")) {
    sourcePath = sourcePath.slice("/@fs/".length);
  }

  const normalizedRoot = normalizePath(resolve(repositoryRoot)).replace(/\/+$/u, "");
  const normalizedSource = normalizePath(
    isAbsolutePath(sourcePath) ? sourcePath : resolve(repositoryRoot, sourcePath),
  );
  if (!normalizedSource.startsWith(`${normalizedRoot}/`)) {
    return undefined;
  }
  const relativePath = normalizedSource.slice(normalizedRoot.length + 1);
  return workspaceLinkPath(relativePath) ?? relativePath;
}

function workspaceLinkPath(relativePath: string): string | undefined {
  const marker = "node_modules/@exercisebook/";
  const nestedMarker = `/${marker}`;
  const markerIndex = relativePath.lastIndexOf(nestedMarker);
  const packagePath =
    markerIndex === -1
      ? relativePath.startsWith(marker)
        ? relativePath.slice(marker.length)
        : undefined
      : relativePath.slice(markerIndex + nestedMarker.length);
  if (packagePath === undefined) {
    return undefined;
  }
  const slashIndex = packagePath.indexOf("/");
  if (slashIndex === -1) {
    return undefined;
  }
  const packageName = packagePath.slice(0, slashIndex);
  const pathWithinPackage = packagePath.slice(slashIndex + 1);
  return `packages/${packageName}/${pathWithinPackage}`;
}

function isWorkspacePackagePath(relativePath: string): boolean {
  const segments = relativePath.split("/");
  return segments.length >= 3 && segments[0] === "packages";
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value);
}

function stripViteQueryAndHash(value: string): string {
  const queryIndex = value.indexOf("?");
  const hashIndex = value.indexOf("#");
  const endIndex = [queryIndex, hashIndex]
    .filter((index) => index !== -1)
    .reduce((minimum, index) => Math.min(minimum, index), value.length);
  return value.slice(0, endIndex);
}

function normalizePath(value: string): string {
  const segments: string[] = [];
  for (const segment of value.replaceAll("\\", "/").split("/")) {
    if (segment === "" && segments.length === 0) {
      segments.push("");
    } else if (segment === "" || segment === ".") {
      continue;
    } else if (segment === "..") {
      if (segments.length > 1 || (segments.length === 1 && segments[0] !== "")) {
        segments.pop();
      }
    } else {
      segments.push(segment);
    }
  }
  const normalized = segments.join("/");
  return normalized === "" && value.startsWith("/") ? "/" : normalized;
}

function isWithin(relativePath: string, root: string): boolean {
  return relativePath === root || relativePath.startsWith(`${root}/`);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
