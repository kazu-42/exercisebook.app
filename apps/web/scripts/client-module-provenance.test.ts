import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";
import { build } from "vite";

import {
  assertClientModuleProvenance,
  clientModuleProvenance,
  classifyClientModuleId,
} from "./client-module-provenance.js";

const REPOSITORY_ROOT = "/workspace/exercisebook";

function outputChunk(moduleIds: readonly string[]): Readonly<Record<string, unknown>> {
  return {
    type: "chunk",
    fileName: "assets/index.js",
    modules: Object.fromEntries(moduleIds.map((moduleId) => [moduleId, {}])),
  };
}

describe("client module provenance", () => {
  it.each([
    [
      `${REPOSITORY_ROOT}/apps/web/src/worker/index.ts`,
      "apps/web/src/worker/index.ts",
      "Worker",
    ],
    [
      `${REPOSITORY_ROOT}/packages/generators/src/index.ts`,
      "packages/generators/src/index.ts",
      "generator",
    ],
    [
      `${REPOSITORY_ROOT}/packages/domain/src/index.ts`,
      "packages/domain/src/index.ts",
      "unreviewed domain",
    ],
    [
      `${REPOSITORY_ROOT}/packages/domain/src/rng.ts`,
      "packages/domain/src/rng.ts",
      "unreviewed domain",
    ],
    [
      `${REPOSITORY_ROOT}/packages/planner/src/daily-plan-preview.ts`,
      "packages/planner/src/daily-plan-preview.ts",
      "unreviewed planner",
    ],
    [
      `${REPOSITORY_ROOT}/packages/schemas/src/trusted-student-projection.ts`,
      "packages/schemas/src/trusted-student-projection.ts",
      "unreviewed schema",
    ],
    [
      `${REPOSITORY_ROOT}/packages/schemas/src/worksheet-instance-v2.ts`,
      "packages/schemas/src/worksheet-instance-v2.ts",
      "unreviewed schema",
    ],
    [
      `${REPOSITORY_ROOT}/packages/content-compiler/src/index.ts`,
      "packages/content-compiler/src/index.ts",
      "unreviewed workspace",
    ],
    [
      `${REPOSITORY_ROOT}/packages/print-document/src/index.ts`,
      "packages/print-document/src/index.ts",
      "unreviewed workspace",
    ],
    [
      `${REPOSITORY_ROOT}/packages/test-fixtures/src/index.ts`,
      "packages/test-fixtures/src/index.ts",
      "unreviewed workspace",
    ],
    [
      `${REPOSITORY_ROOT}/packages/web-renderer/src/fixtures.ts`,
      "packages/web-renderer/src/fixtures.ts",
      "unreviewed workspace",
    ],
    [
      `${REPOSITORY_ROOT}/packages/web-renderer/src/model-v2.test.ts`,
      "packages/web-renderer/src/model-v2.test.ts",
      "unreviewed workspace",
    ],
    [
      `${REPOSITORY_ROOT}/packages/future-authority/src/index.ts`,
      "packages/future-authority/src/index.ts",
      "unreviewed workspace",
    ],
  ] as const)(
    "classifies forbidden production module %s",
    (moduleId, relativePath, category) => {
      expect(classifyClientModuleId(moduleId, REPOSITORY_ROOT)).toEqual({
        category,
        relativePath,
      });
    },
  );

  it.each([
    `${REPOSITORY_ROOT}/apps/web/src/react-app/main.tsx`,
    `${REPOSITORY_ROOT}/apps/web/src/worker-safe.ts`,
    `${REPOSITORY_ROOT}/packages/domain/src/rational.ts`,
    `${REPOSITORY_ROOT}/packages/planner/src/public-preview-contract.ts`,
    `${REPOSITORY_ROOT}/packages/schemas/src/attribution-v1.ts`,
    `${REPOSITORY_ROOT}/packages/schemas/src/common.ts`,
    `${REPOSITORY_ROOT}/packages/schemas/src/presentation-contract-v1.ts`,
    `${REPOSITORY_ROOT}/packages/web-renderer/src/index.ts`,
    `${REPOSITORY_ROOT}/packages/web-renderer/src/model.ts`,
    `${REPOSITORY_ROOT}/packages/web-renderer/src/worksheet-view.tsx`,
    `${REPOSITORY_ROOT}/packages/web-renderer/src/fraction.tsx`,
    `${REPOSITORY_ROOT}/packages/web-renderer/src/fraction-bar-explorer.tsx`,
    `${REPOSITORY_ROOT}/packages/web-renderer/src/styles.css`,
    `${REPOSITORY_ROOT}2/packages/schemas/src/worksheet-instance-v1.ts`,
    "/workspace/exercisebook/node_modules/zod/index.js",
    "/external/node_modules/@exercisebook/schemas/src/worksheet-instance-v1.ts",
    "\u0000vite/preload-helper.js",
  ])("accepts reviewed or unrelated module %s", (moduleId) => {
    expect(classifyClientModuleId(moduleId, REPOSITORY_ROOT)).toBeUndefined();
  });

  it("normalizes Vite queries, file URLs, /@fs/ ids, and workspace symlink ids", () => {
    const workerUrl = pathToFileURL(
      `${REPOSITORY_ROOT}/apps/web/src/worker/index.ts`,
    ).href;

    expect(
      classifyClientModuleId(
        `${REPOSITORY_ROOT}/packages/planner/src/index.ts?commonjs-proxy`,
        REPOSITORY_ROOT,
      ),
    ).toMatchObject({ category: "unreviewed planner" });
    expect(classifyClientModuleId(workerUrl, REPOSITORY_ROOT)).toMatchObject({
      category: "Worker",
    });
    expect(
      classifyClientModuleId(
        `/@fs/${REPOSITORY_ROOT}/packages/generators/src/index.ts`,
        REPOSITORY_ROOT,
      ),
    ).toMatchObject({ category: "generator" });
    expect(
      classifyClientModuleId(
        `${REPOSITORY_ROOT}/apps/web/node_modules/@exercisebook/schemas/src/worksheet-instance-v1.ts`,
        REPOSITORY_ROOT,
      ),
    ).toEqual({
      category: "unreviewed schema",
      relativePath: "packages/schemas/src/worksheet-instance-v1.ts",
    });
    expect(
      classifyClientModuleId(
        `${REPOSITORY_ROOT}/apps/web/node_modules/@exercisebook/print-document/src/index.ts`,
        REPOSITORY_ROOT,
      ),
    ).toEqual({
      category: "unreviewed workspace",
      relativePath: "packages/print-document/src/index.ts",
    });
    expect(
      classifyClientModuleId(
        `${REPOSITORY_ROOT}/apps/web/node_modules/@exercisebook/web-renderer/src/fixtures.ts`,
        REPOSITORY_ROOT,
      ),
    ).toEqual({
      category: "unreviewed workspace",
      relativePath: "packages/web-renderer/src/fixtures.ts",
    });
  });

  it("requires exact browser-safe planner and schema leaf modules", () => {
    expect(
      classifyClientModuleId(
        `${REPOSITORY_ROOT}/packages/planner/src/public-preview-contract.ts-malicious.ts`,
        REPOSITORY_ROOT,
      ),
    ).toMatchObject({ category: "unreviewed planner" });
    expect(
      classifyClientModuleId(
        `${REPOSITORY_ROOT}/packages/schemas/src/common.ts/extra.ts`,
        REPOSITORY_ROOT,
      ),
    ).toMatchObject({ category: "unreviewed schema" });
  });

  it("accepts a client bundle containing only reviewed module provenance", () => {
    expect(
      assertClientModuleProvenance(
        {
          "assets/index.js": outputChunk([
            `${REPOSITORY_ROOT}/apps/web/src/react-app/main.tsx`,
            `${REPOSITORY_ROOT}/packages/planner/src/public-preview-contract.ts`,
            `${REPOSITORY_ROOT}/packages/schemas/src/common.ts`,
          ]),
          "assets/index.css": {
            type: "asset",
            fileName: "assets/index.css",
            source: "",
          },
        },
        REPOSITORY_ROOT,
      ),
    ).toEqual({
      chunksInspected: 1,
      moduleOccurrencesInspected: 3,
    });
  });

  it("rejects a forbidden module from OutputChunk.modules with a stable diagnostic", () => {
    expect(() =>
      assertClientModuleProvenance(
        {
          "assets/index.js": outputChunk([
            `${REPOSITORY_ROOT}/packages/schemas/src/trusted-student-projection.ts`,
          ]),
        },
        REPOSITORY_ROOT,
      ),
    ).toThrow(
      'Client chunk "assets/index.js" contains forbidden unreviewed schema module "packages/schemas/src/trusted-student-projection.ts".',
    );
  });

  it("fails closed when chunk provenance is absent or there are no chunks", () => {
    expect(() =>
      assertClientModuleProvenance(
        {
          "assets/index.js": {
            type: "chunk",
            fileName: "assets/index.js",
          },
        },
        REPOSITORY_ROOT,
      ),
    ).toThrow(/has no module provenance/u);

    expect(() =>
      assertClientModuleProvenance(
        {
          "index.html": {
            type: "asset",
            fileName: "index.html",
            source: "",
          },
        },
        REPOSITORY_ROOT,
      ),
    ).toThrow(/contains no JavaScript chunks/u);
  });

  it("is a build-only, post-enforced Vite plugin", () => {
    const plugin = clientModuleProvenance({
      repositoryRoot: process.cwd(),
    });

    expect(plugin.name).toBe("exercisebook-client-module-provenance");
    expect(plugin.apply).toBe("build");
    expect(plugin.enforce).toBe("post");
    expect(plugin.applyToEnvironment?.({ name: "client" } as never)).toBe(true);
    expect(plugin.applyToEnvironment?.({ name: "exercisebook_app" } as never)).toBe(
      false,
    );
    expect(plugin.generateBundle).toBeTypeOf("function");
  });

  it("rejects forbidden provenance from a real Vite client build", async () => {
    const repositoryRoot = await mkdtemp(
      join(tmpdir(), "exercisebook-module-provenance-"),
    );
    const webRoot = join(repositoryRoot, "apps/web");
    const webSource = join(webRoot, "src");
    const schemaSource = join(repositoryRoot, "packages/schemas/src");
    try {
      await mkdir(webSource, { recursive: true });
      await mkdir(schemaSource, { recursive: true });
      await writeFile(
        join(webSource, "main.js"),
        'import { leaked } from "../../../packages/schemas/src/unsafe.js";\nconsole.log(leaked);\n',
        "utf8",
      );
      await writeFile(
        join(schemaSource, "unsafe.js"),
        'export const leaked = "canonical answer authority";\n',
        "utf8",
      );

      const plugin = clientModuleProvenance({ repositoryRoot });
      const generatedEnvironments: string[] = [];
      const generateBundle = plugin.generateBundle;
      if (typeof generateBundle !== "function") {
        throw new TypeError("Expected a generateBundle hook.");
      }
      plugin.generateBundle = function (...arguments_) {
        generatedEnvironments.push(this.environment.name);
        return generateBundle.apply(this, arguments_);
      };
      const outcome = await build({
        root: webRoot,
        configFile: false,
        logLevel: "silent",
        plugins: [plugin],
        build: {
          outDir: join(webRoot, "dist"),
          rollupOptions: { input: join(webSource, "main.js") },
        },
      }).then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(generatedEnvironments).toEqual(["client"]);
      expect(() => {
        if (outcome !== undefined) {
          throw outcome;
        }
      }).toThrow(
        /forbidden unreviewed schema module "packages\/schemas\/src\/unsafe\.js"/u,
      );
    } finally {
      await rm(repositoryRoot, { force: true, recursive: true });
    }
  });
});
