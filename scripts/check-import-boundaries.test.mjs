import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  extractModuleSpecifiers,
  findImportBoundaryViolations,
} from "./import-boundary-policy.mjs";
import { checkReviewedInstallInputs } from "./check-reviewed-install-inputs.mjs";
import { assertReviewedInstallInputs } from "./reviewed-install-inputs.mjs";

const actualRepositoryRoot = path.resolve(import.meta.dirname, "..");

function countOccurrences(source, needle) {
  assert.notEqual(needle, "", "Occurrence matching requires a non-empty needle");
  let count = 0;
  let offset = 0;
  while (offset <= source.length - needle.length) {
    const next = source.indexOf(needle, offset);
    if (next === -1) {
      break;
    }
    count += 1;
    offset = next + needle.length;
  }
  return count;
}

function endOfIndentedYamlBlock(source, firstChildIndex, parentIndentation) {
  let lineStart = firstChildIndex;
  while (lineStart < source.length) {
    const newline = source.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? source.length : newline;
    const line = source.slice(lineStart, lineEnd);
    if (line.trim() !== "") {
      const indentation = /^ */u.exec(line)?.[0].length ?? 0;
      if (indentation <= parentIndentation) {
        return lineStart;
      }
    }
    if (newline === -1) {
      return source.length;
    }
    lineStart = newline + 1;
  }
  return source.length;
}

function assertExactNamedWorkflowStep(workflow, stepName, runCommand) {
  const marker = `      - name: ${stepName}\n`;
  assert.equal(
    countOccurrences(workflow, marker),
    1,
    `CI must define the ${stepName} step exactly once`,
  );
  const start = workflow.indexOf(marker);
  const end = endOfIndentedYamlBlock(workflow, start + marker.length, 6);
  assert.equal(
    workflow.slice(start, end).trimEnd(),
    `${marker}        run: ${runCommand}`.trimEnd(),
    `CI step ${stepName} must remain an exact fail-loud repository-root command`,
  );
}

const reviewedRootPackage = await readFile(
  path.join(actualRepositoryRoot, "package.json"),
  "utf8",
);
const reviewedPnpmLock = await readFile(
  path.join(actualRepositoryRoot, "pnpm-lock.yaml"),
  "utf8",
);
const reviewedWorkspace = await readFile(
  path.join(actualRepositoryRoot, "pnpm-workspace.yaml"),
  "utf8",
);
const reviewedWorkspaceManifestFiles = [
  "apps/web/package.json",
  "packages/content-compiler/package.json",
  "packages/domain/package.json",
  "packages/generators/package.json",
  "packages/planner/package.json",
  "packages/print-document/package.json",
  "packages/schemas/package.json",
  "packages/test-fixtures/package.json",
  "packages/web-renderer/package.json",
];
const reviewedWorkspaceManifests = Object.fromEntries(
  await Promise.all(
    reviewedWorkspaceManifestFiles.map(async (relativeFile) => [
      relativeFile,
      await readFile(path.join(actualRepositoryRoot, relativeFile), "utf8"),
    ]),
  ),
);
const reviewedInstallInputs = {
  "package.json": reviewedRootPackage,
  "pnpm-lock.yaml": reviewedPnpmLock,
  "pnpm-workspace.yaml": reviewedWorkspace,
  ...reviewedWorkspaceManifests,
};
const installPolicyRoots = [
  ".",
  "apps",
  "packages",
  ...reviewedWorkspaceManifestFiles.map((relativeFile) =>
    path.posix.dirname(relativeFile),
  ),
];
const reviewedInstallPackageRoots = [
  ".",
  ...reviewedWorkspaceManifestFiles.map((relativeFile) =>
    path.posix.dirname(relativeFile),
  ),
];
const forbiddenInstallConfigFiles = installPolicyRoots.flatMap((relativeRoot) =>
  [".npmrc", ".pnpmfile.cjs", ".pnpmfile.mjs"].map((fileName) =>
    relativeRoot === "." ? fileName : path.posix.join(relativeRoot, fileName),
  ),
);
const postcssConfigFileNames = [
  ".postcssrc",
  ".postcssrc.json",
  ".postcssrc.yaml",
  ".postcssrc.yml",
  ".postcssrc.ts",
  ".postcssrc.cts",
  ".postcssrc.mts",
  ".postcssrc.js",
  ".postcssrc.cjs",
  ".postcssrc.mjs",
  "postcss.config.ts",
  "postcss.config.cts",
  "postcss.config.mts",
  "postcss.config.js",
  "postcss.config.cjs",
  "postcss.config.mjs",
];
const implicitPostcssConfigFiles = [".", "apps", "apps/web"].flatMap((relativeRoot) =>
  postcssConfigFileNames.map((fileName) =>
    relativeRoot === "." ? fileName : path.posix.join(relativeRoot, fileName),
  ),
);
const reviewedRootScripts = {
  build: "pnpm -r --if-present build",
  check:
    "pnpm format:check && pnpm typecheck && pnpm schema:check && pnpm content:check && pnpm check:boundaries && pnpm test && pnpm build && pnpm worksheet:samples",
  "check:boundaries":
    "node --test scripts/check-import-boundaries.test.mjs && node scripts/check-import-boundaries.mjs",
  "content:check": "pnpm --filter @exercisebook/content-compiler content:check",
  "content:generate": "pnpm --filter @exercisebook/content-compiler content:generate",
  dev: "pnpm --filter @exercisebook/web dev",
  format: "prettier --write . --ignore-unknown",
  "format:check": "prettier --check . --ignore-unknown",
  preview: "pnpm --filter @exercisebook/web preview",
  "schema:check": "pnpm --filter @exercisebook/schemas schema:check",
  test: "vitest run",
  "test:watch": "vitest",
  typecheck:
    "node scripts/check-typescript-version.mjs && tsc -p tsconfig.json --noEmit",
  "worksheet:sample":
    "pnpm content:check && pnpm --filter @exercisebook/web worksheet:sample && pnpm --filter @exercisebook/print-document render:sample -- ../../output/print-sample && pnpm worksheet:verify",
  "worksheet:sample:v2":
    "pnpm content:check && pnpm --filter @exercisebook/print-document render:sample:v2 -- ../../output/print-sample-v2 && pnpm worksheet:verify:v2",
  "worksheet:samples": "pnpm worksheet:sample && pnpm worksheet:sample:v2",
  "worksheet:verify": "node scripts/verify-sample-artifacts.mjs",
  "worksheet:verify:v2": "node scripts/verify-sample-artifacts-v2.mjs",
};
const reviewedRootManifest = {
  name: "exercisebook",
  version: "0.0.0",
  private: true,
  description: "A new exercise book, every day.",
  type: "module",
  packageManager: "pnpm@11.8.0",
  engines: {
    node: ">=24",
  },
  scripts: reviewedRootScripts,
  devDependencies: {
    "@cloudflare/vitest-pool-workers": "0.19.1",
    "@types/node": "26.1.1",
    "fast-check": "4.9.0",
    prettier: "3.9.5",
    typescript: "7.0.2",
    vite: "8.1.5",
    vitest: "4.1.10",
    wrangler: "4.116.0",
  },
};
const reviewedWebScripts = {
  build: "vite build && tsx scripts/check-client-artifact-boundary.ts",
  dev: "vite",
  preview: "vite preview",
  test: "vitest run",
  typecheck: "tsc -p tsconfig.json --noEmit",
  "worksheet:sample": "tsx --tsconfig tsconfig.json scripts/write-sample.ts",
};
const reviewedWebManifest = {
  name: "@exercisebook/web",
  version: "0.0.0",
  private: true,
  type: "module",
  scripts: reviewedWebScripts,
  dependencies: {
    "@exercisebook/domain": "workspace:*",
    "@exercisebook/generators": "workspace:*",
    "@exercisebook/planner": "workspace:*",
    "@exercisebook/schemas": "workspace:*",
    "@exercisebook/web-renderer": "workspace:*",
    hono: "4.12.30",
    react: "19.2.7",
    "react-dom": "19.2.7",
  },
  devDependencies: {
    "@cloudflare/vite-plugin": "1.49.0",
    "@testing-library/jest-dom": "6.9.1",
    "@testing-library/react": "16.3.2",
    "@testing-library/user-event": "14.6.1",
    "@types/jest-axe": "3.5.9",
    "@types/node": "26.1.1",
    "@types/react": "19.2.17",
    "@types/react-dom": "19.2.3",
    "@vitejs/plugin-react": "6.0.3",
    "jest-axe": "10.0.0",
    jsdom: "29.1.1",
    tsx: "4.21.1",
  },
};
const reviewedDomainManifest = {
  name: "@exercisebook/domain",
  version: "0.0.0",
  private: true,
  type: "module",
  exports: {
    ".": "./src/index.ts",
    "./rational": "./src/rational.ts",
  },
  scripts: {
    test: "vitest run --root ../.. packages/domain/src",
    typecheck: "tsc -p tsconfig.json --noEmit",
  },
};
const reviewedPlannerManifest = {
  name: "@exercisebook/planner",
  version: "0.0.0",
  private: true,
  type: "module",
  exports: {
    ".": "./src/index.ts",
    "./public-preview-contract": "./src/public-preview-contract.ts",
  },
  scripts: {
    test: "vitest run --root ../.. packages/planner/src",
    typecheck: "tsc -p tsconfig.json --noEmit",
  },
  dependencies: {
    "@exercisebook/domain": "workspace:*",
    "@exercisebook/schemas": "workspace:*",
    zod: "4.4.3",
  },
  devDependencies: {
    "fast-check": "4.9.0",
  },
};
const reviewedSchemasManifest = {
  name: "@exercisebook/schemas",
  version: "0.0.0",
  private: true,
  type: "module",
  exports: {
    ".": "./src/index.ts",
    "./attribution-v1": "./src/attribution-v1.ts",
    "./presentation-contract-v1": "./src/presentation-contract-v1.ts",
    "./public-data": "./src/common.ts",
    "./trusted-student-projection": "./src/trusted-student-projection.ts",
    "./json-schema/content-document-v1":
      "./json-schema/content-document-v1.schema.json",
    "./json-schema/content-document-v2":
      "./json-schema/content-document-v2.schema.json",
    "./json-schema/worksheet-instance-v1":
      "./json-schema/worksheet-instance-v1.schema.json",
    "./json-schema/worksheet-instance-v2":
      "./json-schema/worksheet-instance-v2.schema.json",
  },
  scripts: {
    "schema:check": "tsx scripts/generate-json-schema.ts --check",
    "schema:generate": "tsx scripts/generate-json-schema.ts",
    test: "vitest run --root ../.. packages/schemas/src",
    typecheck: "tsc -p tsconfig.json --noEmit",
  },
  dependencies: {
    "@exercisebook/domain": "workspace:*",
    zod: "4.4.3",
  },
  devDependencies: {
    "@types/node": "26.1.1",
    prettier: "3.9.5",
    tsx: "4.21.1",
  },
};
const reviewedWebRendererManifest = {
  name: "@exercisebook/web-renderer",
  version: "0.0.0",
  private: true,
  type: "module",
  exports: {
    ".": "./src/index.ts",
    "./fixtures": "./src/fixtures.ts",
    "./styles.css": "./src/styles.css",
  },
  scripts: {
    test: "vitest run",
    typecheck: "tsc -p tsconfig.json --noEmit",
  },
  peerDependencies: {
    react: "19.2.7",
    "react-dom": "19.2.7",
  },
  dependencies: {
    "@exercisebook/schemas": "workspace:*",
    zod: "4.4.3",
  },
  devDependencies: {
    "@testing-library/jest-dom": "6.9.1",
    "@testing-library/react": "16.3.2",
    "@testing-library/user-event": "14.6.1",
    "@types/jest-axe": "3.5.9",
    "@types/react": "19.2.17",
    "@types/react-dom": "19.2.3",
    "jest-axe": "10.0.0",
    jsdom: "29.1.1",
    react: "19.2.7",
    "react-dom": "19.2.7",
  },
};
const reviewedViteConfig = `
  import { cloudflare } from "@cloudflare/vite-plugin";
  import react from "@vitejs/plugin-react";
  import { defineConfig } from "vite";

  import { clientModuleProvenance } from "./scripts/client-module-provenance.ts";

  export default defineConfig({
    plugins: [react(), clientModuleProvenance(), cloudflare()],
    build: {
      sourcemap: false,
      target: "es2024",
    },
  });
`;
const reviewedHtmlEntrypoint = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="A local-first exercise book" />
    <meta name="theme-color" content="#142d42" />
    <link rel="canonical" href="https://exercisebook.app/" />
    <title>Exercise Book</title>
  </head>
  <body>
    <div id="root">
      <header class="static-header">
        <a href="/" aria-label='Exercise &quot; > Book home'>Exercise Book</a>
      </header>
      <main class="static-fallback">
        <p>Free, focused, and made to be worked on.</p>
        <h1>A new exercise book, every day.</h1>
        <p>Learn from a short explanation.</p>
        <p>
          <a href="/lessons/fractions/add-unlike-denominators">Try the lesson</a>
        </p>
        <section aria-labelledby="static-fraction-title">
          <h2 id="static-fraction-title">Fraction-bar fallback</h2>
          <p>Equivalent fractions use the same whole.</p>
        </section>
      </main>
    </div>
    <script type="module" src="/src/react-app/main.tsx"></script>
  </body>
</html>
`;
const reviewedPnpmWorkspace = `packages:
  - apps/*
  - packages/*

overrides:
  esbuild: 0.28.1

allowBuilds:
  esbuild@0.28.1: true
  sharp@0.35.2: true
  workerd@1.20260730.1: true

minimumReleaseAge: 1440
`;
const reviewedWranglerConfig = `{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "exercisebook-app",
  "main": "./src/worker/index.ts",
  "compatibility_date": "2026-07-14",
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"],
  },
  "observability": {
    "enabled": true,
  },
}
`;
const reviewedStrictRepositoryFiles = {
  "package.json": JSON.stringify(reviewedRootManifest),
  "pnpm-lock.yaml": reviewedPnpmLock,
  "pnpm-workspace.yaml": reviewedPnpmWorkspace,
  "apps/web/package.json": JSON.stringify(reviewedWebManifest),
  "apps/web/index.html": reviewedHtmlEntrypoint,
  "apps/web/vite.config.mjs": reviewedViteConfig,
  "apps/web/wrangler.jsonc": reviewedWranglerConfig,
  "packages/domain/package.json": JSON.stringify(reviewedDomainManifest),
  "packages/planner/package.json": JSON.stringify(reviewedPlannerManifest),
  "packages/schemas/package.json": JSON.stringify(reviewedSchemasManifest),
  "packages/web-renderer/package.json": JSON.stringify(reviewedWebRendererManifest),
};

async function withRepositoryFixture(files, run) {
  const repositoryRoot = await mkdtemp(
    path.join(tmpdir(), "exercisebook-import-boundaries-"),
  );

  try {
    await Promise.all(
      Object.entries(files).map(async ([relativeFile, source]) => {
        const absoluteFile = path.join(repositoryRoot, relativeFile);
        await mkdir(path.dirname(absoluteFile), { recursive: true });
        await writeFile(absoluteFile, source, "utf8");
      }),
    );
    await run(repositoryRoot, () =>
      findImportBoundaryViolations(repositoryRoot, {
        allowPartialRepository: true,
      }),
    );
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

test("rejects trusted server imports from every browser-reachable source root", async () => {
  await withRepositoryFixture(
    {
      "apps/web/src/react-app/exact.ts":
        'import { trusted } from "@exercisebook/schemas/trusted-student-projection";',
      "apps/web/src/react-app/prepared-guard.ts":
        'import { prepareStudentVisibleAnswerGuard } from "@exercisebook/schemas/trusted-student-projection";',
      "apps/web/src/react-app/dynamic.ts":
        'const trusted = import("@exercisebook/schemas/trusted-student-projection/dynamic");',
      "apps/web/src/react-app/template-import.ts":
        'const trusted = `${enabled ? await import("@exercisebook/schemas/trusted-student-projection/template") : "disabled"}`;',
      "apps/web/src/react-app/parenthesized-import.ts":
        'const trusted = import((("@exercisebook/schemas/trusted-student-projection")));',
      "apps/web/src/shared/require.ts":
        'const trusted = require("@exercisebook/schemas/trusted-student-projection");',
      "apps/web/src/shared/template-require.ts":
        'const trusted = `${enabled ? `${require("@exercisebook/schemas/trusted-student-projection")}` : "disabled"}`;',
      "apps/web/src/shared/parenthesized-require.ts":
        'const trusted = require((("@exercisebook/schemas/trusted-student-projection")));',
      "apps/web/src/shared/optional-require.ts":
        'const trusted = require?.("@exercisebook/schemas/trusted-student-projection");',
      "apps/web/src/shared/import-equals.ts":
        'import trusted = require("@exercisebook/schemas/trusted-student-projection");',
      "apps/web/src/shared/import-type.ts":
        'type Trusted = import("@exercisebook/schemas/trusted-student-projection").Projection;',
      "apps/web/src/shared/prepared-guard-type.ts":
        'import type { PreparedStudentVisibleAnswerGuard } from "@exercisebook/schemas/trusted-student-projection";',
      "apps/web/src/shared/prepared-guard-source.ts":
        'import { prepareStudentVisibleAnswerGuard } from "../../../../packages/schemas/src/worksheet-instance-v1.js";',
      "apps/web/src/shared/relative.ts":
        'export { trusted } from "../../../../packages/schemas/src/trusted-student-projection.js";',
      "apps/web/src/shared/v2-implementation.ts":
        'import { projectWorksheetV2ForStudentWithCanonicalAnswers } from "../../../../packages/schemas/src/student-worksheet-delivery-v2.js";',
      "packages/web-renderer/src/prefix.ts":
        'export * from "@exercisebook/schemas/trusted-student-projection/internal";',
      "packages/web-renderer/src/relative.ts":
        'import trusted from "../../schemas/src/trusted-student-projection.ts";',
      "packages/web-renderer/src/prepared-guard.ts":
        'import { prepareStudentVisibleAnswerGuard } from "@exercisebook/schemas/trusted-student-projection";',
      "packages/web-renderer/src/prepared-guard-source.ts":
        'import type { PreparedStudentVisibleAnswerGuard } from "../../schemas/src/worksheet-instance-v1.js";',
      "packages/web-renderer/src/v1-implementation.ts":
        'import { projectWorksheetForStudentWithCanonicalAnswers } from "../../schemas/src/worksheet-instance-v1.js";',
      "packages/web-renderer/src/v2-internal-specifier.ts":
        'import { projectWorksheetV2ForStudentWithCanonicalAnswers } from "@exercisebook/schemas/src/student-worksheet-delivery-v2.js";',
      "packages/web-renderer/src/javascript-bypass.js":
        'import trusted from "@exercisebook/schemas/trusted-student-projection";',
      "packages/web-renderer/src/escaped.ts":
        'const trusted = import("@exercisebook/schemas/trusted-student-projec\\u0074ion");',
    },
    async (repositoryRoot, findFixtureViolations) => {
      const violations = await findFixtureViolations();

      assert.equal(violations.length, 23);
      for (const relativeFile of [
        "apps/web/src/react-app/exact.ts",
        "apps/web/src/react-app/prepared-guard.ts",
        "apps/web/src/react-app/dynamic.ts",
        "apps/web/src/react-app/template-import.ts",
        "apps/web/src/react-app/parenthesized-import.ts",
        "apps/web/src/shared/require.ts",
        "apps/web/src/shared/parenthesized-require.ts",
        "apps/web/src/shared/optional-require.ts",
        "apps/web/src/shared/import-equals.ts",
        "apps/web/src/shared/import-type.ts",
        "apps/web/src/shared/prepared-guard-type.ts",
        "apps/web/src/shared/prepared-guard-source.ts",
        "apps/web/src/shared/relative.ts",
        "apps/web/src/shared/template-require.ts",
        "apps/web/src/shared/v2-implementation.ts",
        "packages/web-renderer/src/prefix.ts",
        "packages/web-renderer/src/relative.ts",
        "packages/web-renderer/src/prepared-guard.ts",
        "packages/web-renderer/src/prepared-guard-source.ts",
        "packages/web-renderer/src/v1-implementation.ts",
        "packages/web-renderer/src/v2-internal-specifier.ts",
        "packages/web-renderer/src/javascript-bypass.js",
        "packages/web-renderer/src/escaped.ts",
      ]) {
        assert.ok(
          violations.some((violation) => violation.startsWith(relativeFile)),
          `expected a violation for ${relativeFile}`,
        );
      }
    },
  );
});

test("extracts static, re-exported, dynamic, and required module specifiers", () => {
  assert.deepEqual(
    extractModuleSpecifiers(`
      import "@exercisebook/side-effect";
      import type { PublicType } from "@exercisebook/public-types";
      export { publicValue } from "@exercisebook/public-values";
      export type { ExportedType } from "@exercisebook/exported-types";
      export * from "@exercisebook/all-values";
      const quotedDynamic = import("@exercisebook/quoted-dynamic");
      const templateDynamic = import(\`@exercisebook/template-dynamic\`);
      const required = require("@exercisebook/required");
      import requiredTypeScript = require("@exercisebook/import-equals");
      type ImportedType = import("@exercisebook/import-type").Value;
    `),
    [
      "@exercisebook/side-effect",
      "@exercisebook/public-types",
      "@exercisebook/public-values",
      "@exercisebook/exported-types",
      "@exercisebook/all-values",
      "@exercisebook/quoted-dynamic",
      "@exercisebook/template-dynamic",
      "@exercisebook/required",
      "@exercisebook/import-equals",
      "@exercisebook/import-type",
    ],
  );
});

test("extracts static Vite glob and globEager module specifiers", () => {
  assert.deepEqual(
    extractModuleSpecifiers(`
      const literal = import.meta.glob("./literal/*.ts");
      const template = import.meta.glob(\`./template/*.ts\`);
      const multiple = import.meta.glob([
        "./first/*.ts",
        \`./second/*.tsx\`,
      ]);
      const eager = import.meta.globEager("./eager/*.ts");
    `),
    [
      "./literal/*.ts",
      "./template/*.ts",
      "./first/*.ts",
      "./second/*.tsx",
      "./eager/*.ts",
    ],
  );
});

test("fails closed with a deterministic diagnostic when a source cannot parse", () => {
  assert.throws(
    () => extractModuleSpecifiers("import {", "broken.ts"),
    new Error("Could not parse broken.ts for import boundary analysis."),
  );
});

test("fails closed on computed dynamic imports and require calls", () => {
  assert.throws(
    () =>
      extractModuleSpecifiers(
        'import("@exercisebook/" + "schemas/trusted-student-projection");',
        "computed-import.ts",
      ),
    new Error("Non-static import() is not allowed in computed-import.ts at offset 7."),
  );
  assert.throws(
    () => extractModuleSpecifiers("require(moduleName);", "computed-require.ts"),
    new Error(
      "Non-static require() is not allowed in computed-require.ts at offset 8.",
    ),
  );
  assert.throws(
    () =>
      extractModuleSpecifiers(
        "new Worker(new URL(workerPath, import.meta.url), { type: 'module' });",
        "computed-worker-url.ts",
      ),
    new Error(
      "Non-static new URL(..., import.meta.url) is not allowed in computed-worker-url.ts at offset 19.",
    ),
  );
});

test("fails closed on backslash-containing module, glob, and asset specifiers", () => {
  for (const [sourceFile, source] of [
    [
      "backslash-import.ts",
      'import value from "..\\\\worker\\\\web-worksheet-projector.ts";',
    ],
    [
      "backslash-export.ts",
      'export { value } from "..\\\\worker\\\\web-worksheet-projector.ts";',
    ],
    [
      "backslash-worker-url.ts",
      'new URL("..\\\\worker\\\\web-worksheet-projector.ts", import.meta.url);',
    ],
    [
      "backslash-root-url.ts",
      'new URL("..\\\\..\\\\..\\\\..\\\\package.json", import.meta.url);',
    ],
    ["backslash-glob.ts", 'import.meta.glob("..\\\\worker\\\\*.ts");'],
  ]) {
    assert.throws(
      () => extractModuleSpecifiers(source, sourceFile),
      new RegExp(
        `Backslashes are not allowed in static module or asset specifiers in ${sourceFile.replaceAll(".", "\\.")} at offset \\d+\\.`,
        "u",
      ),
    );
  }
});

test("fails closed on non-static Vite glob and globEager patterns", () => {
  assert.throws(
    () =>
      extractModuleSpecifiers("import.meta.glob(modulePattern);", "computed-glob.ts"),
    new Error(
      "Non-static import.meta.glob() is not allowed in computed-glob.ts at offset 17.",
    ),
  );
  assert.throws(
    () =>
      extractModuleSpecifiers(
        'import.meta.glob(["./safe.ts", modulePattern]);',
        "computed-glob-array.ts",
      ),
    new Error(
      "Non-static import.meta.glob() is not allowed in computed-glob-array.ts at offset 31.",
    ),
  );
  assert.throws(
    () =>
      extractModuleSpecifiers(
        "import.meta.globEager(`./${moduleName}.ts`);",
        "computed-glob-eager.ts",
      ),
    new Error(
      "Non-static import.meta.globEager() is not allowed in computed-glob-eager.ts at offset 22.",
    ),
  );
});

test("extracts Vite glob patterns without reproducing option semantics", () => {
  assert.deepEqual(
    extractModuleSpecifiers(`
      const based = import.meta.glob("./trusted-*.ts", {
        base: "../../../../packages/schemas/src",
        eager: true,
        import: "default",
        caseSensitive: true,
      });
      const unsafeOptionsAreStillDetected = import.meta.glob("./other-*.ts", {
        base: moduleBase,
        caseSensitive: false,
        ...globOptions,
      });
    `),
    ["./trusted-*.ts", "./other-*.ts"],
  );
});

test("parses every configured source in the current repository", async () => {
  assert.deepEqual(await findImportBoundaryViolations(actualRepositoryRoot), []);
});

test("requires every reviewed repository input by default", async () => {
  await withRepositoryFixture(reviewedStrictRepositoryFiles, async (repositoryRoot) => {
    assert.deepEqual(await findImportBoundaryViolations(repositoryRoot), []);
  });

  for (const [missingFile, expectedMessage] of [
    [
      "pnpm-workspace.yaml",
      "pnpm-workspace.yaml is required for complete import boundary analysis.",
    ],
    [
      "pnpm-lock.yaml",
      "pnpm-lock.yaml is required for complete import boundary analysis.",
    ],
    ["package.json", "package.json is required for complete import boundary analysis."],
    [
      "apps/web/package.json",
      "apps/web/package.json is required for complete import boundary analysis.",
    ],
    [
      "packages/domain/package.json",
      "packages/domain/package.json is required for complete import boundary analysis.",
    ],
    [
      "packages/planner/package.json",
      "packages/planner/package.json is required for complete import boundary analysis.",
    ],
    [
      "packages/schemas/package.json",
      "packages/schemas/package.json is required for complete import boundary analysis.",
    ],
    [
      "packages/web-renderer/package.json",
      "packages/web-renderer/package.json is required for complete import boundary analysis.",
    ],
    [
      "apps/web/index.html",
      "apps/web/index.html is required for complete import boundary analysis.",
    ],
    [
      "apps/web/vite.config.mjs",
      "apps/web must contain exactly one reviewed Vite configuration.",
    ],
    [
      "apps/web/wrangler.jsonc",
      "apps/web/wrangler.jsonc is required for complete import boundary analysis.",
    ],
  ]) {
    const files = { ...reviewedStrictRepositoryFiles };
    delete files[missingFile];
    await withRepositoryFixture(
      files,
      async (repositoryRoot, findFixtureViolations) => {
        await assert.rejects(
          () => findImportBoundaryViolations(repositoryRoot),
          new Error(expectedMessage),
        );
        assert.deepEqual(await findFixtureViolations(), []);
      },
    );
  }
});

test("preflights reviewed install inputs without loading workspace dependencies", () => {
  assert.doesNotThrow(() => assertReviewedInstallInputs(reviewedInstallInputs));

  for (const relativeFile of Object.keys(reviewedInstallInputs)) {
    assert.throws(
      () =>
        assertReviewedInstallInputs({
          ...reviewedInstallInputs,
          [relativeFile]: `${reviewedInstallInputs[relativeFile]}\n`,
        }),
      new Error(
        `${relativeFile} must exactly match the reviewed pre-install dependency input.`,
      ),
    );
    assert.throws(
      () =>
        assertReviewedInstallInputs(
          Object.fromEntries(
            Object.entries(reviewedInstallInputs).filter(
              ([candidate]) => candidate !== relativeFile,
            ),
          ),
        ),
      new Error(
        `${relativeFile} is required for reviewed pre-install dependency verification.`,
      ),
    );
  }

  for (const relativeFile of reviewedWorkspaceManifestFiles) {
    const manifest = JSON.parse(reviewedInstallInputs[relativeFile]);
    assert.throws(
      () =>
        assertReviewedInstallInputs({
          ...reviewedInstallInputs,
          [relativeFile]: JSON.stringify({
            ...manifest,
            scripts: {
              ...manifest.scripts,
              postinstall: "node ./scripts/unreviewed-postinstall.mjs",
            },
          }),
        }),
      new Error(
        `${relativeFile} must exactly match the reviewed pre-install dependency input.`,
      ),
    );
  }

  for (const relativeFile of forbiddenInstallConfigFiles) {
    assert.throws(
      () =>
        assertReviewedInstallInputs({
          ...reviewedInstallInputs,
          [relativeFile]: "unreviewed install configuration",
        }),
      new Error(
        `${relativeFile} must be absent during reviewed pre-install dependency verification.`,
      ),
    );
  }

  for (const relativeRoot of reviewedInstallPackageRoots) {
    for (const fileName of ["binding.gyp", "native-addon.gyp", "NATIVE.GYP"]) {
      const relativeFile =
        relativeRoot === "." ? fileName : path.posix.join(relativeRoot, fileName);
      assert.throws(
        () =>
          assertReviewedInstallInputs({
            ...reviewedInstallInputs,
            [relativeFile]: "present",
          }),
        new Error(
          `${relativeFile} must be absent during reviewed pre-install dependency verification.`,
        ),
      );
    }
  }

  assert.throws(
    () =>
      assertReviewedInstallInputs({
        ...reviewedInstallInputs,
        "packages/unreviewed/package.json": JSON.stringify({
          name: "@exercisebook/unreviewed",
          private: true,
        }),
      }),
    new TypeError(
      "Unknown reviewed pre-install dependency input: packages/unreviewed/package.json",
    ),
  );
});

test("discovers unknown, missing, and forbidden workspace install inputs", async () => {
  await withRepositoryFixture(reviewedInstallInputs, async (repositoryRoot) => {
    await assert.doesNotReject(() => checkReviewedInstallInputs(repositoryRoot));
  });

  const missingManifestFiles = { ...reviewedInstallInputs };
  delete missingManifestFiles["packages/test-fixtures/package.json"];
  await withRepositoryFixture(missingManifestFiles, async (repositoryRoot) => {
    await assert.rejects(
      () => checkReviewedInstallInputs(repositoryRoot),
      new Error(
        "packages/test-fixtures/package.json is required for reviewed pre-install dependency verification.",
      ),
    );
  });

  await withRepositoryFixture(
    {
      ...reviewedInstallInputs,
      "packages/unreviewed/package.json": JSON.stringify({
        name: "@exercisebook/unreviewed",
        private: true,
      }),
    },
    async (repositoryRoot) => {
      await assert.rejects(
        () => checkReviewedInstallInputs(repositoryRoot),
        new TypeError(
          "Unknown reviewed pre-install dependency input: packages/unreviewed/package.json",
        ),
      );
    },
  );

  for (const relativeFile of forbiddenInstallConfigFiles) {
    await withRepositoryFixture(
      {
        ...reviewedInstallInputs,
        [relativeFile]: "unreviewed install configuration",
      },
      async (repositoryRoot) => {
        await assert.rejects(
          () => checkReviewedInstallInputs(repositoryRoot),
          new Error(
            `${relativeFile} must be absent during reviewed pre-install dependency verification.`,
          ),
        );
      },
    );
  }

  for (const relativeRoot of reviewedInstallPackageRoots) {
    const relativeFile =
      relativeRoot === "."
        ? "binding.gyp"
        : path.posix.join(relativeRoot, "binding.gyp");
    await withRepositoryFixture(
      {
        ...reviewedInstallInputs,
        [relativeFile]: "{}",
      },
      async (repositoryRoot) => {
        await assert.rejects(
          () => checkReviewedInstallInputs(repositoryRoot),
          new Error(
            `${relativeFile} must be absent during reviewed pre-install dependency verification.`,
          ),
        );
      },
    );
  }

  for (const [relativeFile, kind] of [
    ["native-addon.gyp", "directory"],
    ["packages/domain/linked-addon.gyp", "symlink"],
  ]) {
    await withRepositoryFixture(reviewedInstallInputs, async (repositoryRoot) => {
      const absoluteFile = path.join(repositoryRoot, relativeFile);
      if (kind === "directory") {
        await mkdir(absoluteFile, { recursive: true });
      } else {
        await symlink("missing-reviewed-gyp-target", absoluteFile);
      }
      await assert.rejects(
        () => checkReviewedInstallInputs(repositoryRoot),
        new Error(
          `${relativeFile} must be absent during reviewed pre-install dependency verification.`,
        ),
      );
    });
  }

  await withRepositoryFixture(
    {
      ...reviewedInstallInputs,
      "packages/unreviewed/package.json": JSON.stringify({
        name: "@exercisebook/unreviewed",
        private: true,
      }),
      "packages/unreviewed/binding.gyp": "{}",
    },
    async (repositoryRoot) => {
      await assert.rejects(
        () => checkReviewedInstallInputs(repositoryRoot),
        new Error(
          "packages/unreviewed/binding.gyp must be absent during reviewed pre-install dependency verification.",
        ),
      );
    },
  );
});

test("runs the built-in-only dependency preflight before install and invokes boundaries directly in CI", async () => {
  const workflow = await readFile(
    path.join(actualRepositoryRoot, ".github/workflows/ci.yml"),
    "utf8",
  );
  const preflightCommand = "run: node scripts/check-reviewed-install-inputs.mjs";
  const installCommand = "run: pnpm install --frozen-lockfile";
  const directBoundaryCommands = [
    "node --test scripts/check-import-boundaries.test.mjs",
    "node scripts/check-import-boundaries.mjs",
  ];
  const aggregateSampleCommand = "run: pnpm worksheet:samples";
  const checkoutIndex = workflow.indexOf("uses: actions/checkout@");
  const firstNodeSetupIndex = workflow.indexOf("uses: actions/setup-node@");
  const preflightIndex = workflow.indexOf(preflightCommand);
  const pnpmSetupIndex = workflow.indexOf("uses: pnpm/action-setup@");
  const pnpmCacheIndex = workflow.indexOf("cache: pnpm");
  const installIndex = workflow.indexOf(installCommand);

  assert.notEqual(checkoutIndex, -1, "CI must check out the repository");
  assert.notEqual(firstNodeSetupIndex, -1, "CI must set up the reviewed Node runtime");
  assert.notEqual(preflightIndex, -1, "CI must invoke the built-in-only preflight");
  assert.notEqual(pnpmSetupIndex, -1, "CI must set up the pinned pnpm runtime");
  assert.notEqual(pnpmCacheIndex, -1, "CI must configure pnpm caching");
  assert.notEqual(installIndex, -1, "CI must use the frozen workspace install");
  assert.equal(
    countOccurrences(workflow, aggregateSampleCommand),
    1,
    "CI must run the aggregate V1 and V2 sample-artifact gate exactly once",
  );
  assertExactNamedWorkflowStep(
    workflow,
    "Generate and verify sample artifacts",
    "pnpm worksheet:samples",
  );
  assert.doesNotMatch(
    workflow,
    /^\s*(?:continue-on-error|working-directory)\s*:/mu,
    "CI may not weaken or relocate reviewed fail-loud repository-root commands",
  );
  assert.ok(
    checkoutIndex < firstNodeSetupIndex && firstNodeSetupIndex < preflightIndex,
    "CI must check out sources and set up Node before the built-in-only preflight",
  );
  assert.doesNotMatch(
    workflow.slice(0, preflightIndex),
    /\b(?:bun|corepack|npm|npx|pnpm|yarn)\b/iu,
    "CI may not initialize a package manager, package-manager caching, or a package-manager CLI before the built-in-only preflight",
  );
  assert.ok(
    preflightIndex < pnpmSetupIndex &&
      pnpmSetupIndex < pnpmCacheIndex &&
      pnpmCacheIndex < installIndex,
    "CI must validate reviewed inputs before pnpm setup, then configure caching before package installation",
  );
  for (const directBoundaryCommand of directBoundaryCommands) {
    assert.ok(
      workflow.includes(directBoundaryCommand),
      "CI must invoke the boundary tests and live scan without a package-script bootstrap",
    );
  }
});

test("rejects wrappers and step metadata that weaken the aggregate sample gate", () => {
  const exactStep = `jobs:\n  verify:\n    steps:\n      - name: Generate and verify sample artifacts\n        run: pnpm worksheet:samples\n`;
  assert.doesNotThrow(() =>
    assertExactNamedWorkflowStep(
      exactStep,
      "Generate and verify sample artifacts",
      "pnpm worksheet:samples",
    ),
  );
  for (const harmlessWorkflowTail of [
    "# End of workflow\n",
    "  follow_up:\n    runs-on: ubuntu-latest\n",
  ]) {
    assert.doesNotThrow(() =>
      assertExactNamedWorkflowStep(
        `${exactStep}${harmlessWorkflowTail}`,
        "Generate and verify sample artifacts",
        "pnpm worksheet:samples",
      ),
    );
  }

  for (const weakenedStep of [
    exactStep.replace("pnpm worksheet:samples", "pnpm worksheet:samples || true"),
    exactStep.replace(
      "        run: pnpm worksheet:samples",
      "        continue-on-error: true\n        run: pnpm worksheet:samples",
    ),
    exactStep.replace(
      "        run: pnpm worksheet:samples",
      "        working-directory: packages/print-document\n        run: pnpm worksheet:samples",
    ),
    exactStep.replace(
      "        run: pnpm worksheet:samples",
      "        run: |\n          pnpm worksheet:samples",
    ),
  ]) {
    assert.throws(() =>
      assertExactNamedWorkflowStep(
        weakenedStep,
        "Generate and verify sample artifacts",
        "pnpm worksheet:samples",
      ),
    );
  }
});

test("rejects duplicate reviewed Vite configurations", async () => {
  await withRepositoryFixture(
    {
      ...reviewedStrictRepositoryFiles,
      "apps/web/vite.config.js": reviewedViteConfig,
    },
    async (repositoryRoot) => {
      await assert.rejects(
        () => findImportBoundaryViolations(repositoryRoot),
        new Error("apps/web must contain exactly one reviewed Vite configuration."),
      );
    },
  );
});

test("rejects every implicit PostCSS configuration in complete and partial repositories", async () => {
  for (const relativeFile of implicitPostcssConfigFiles) {
    const expectedError = new Error(
      `${relativeFile} may not alter the reviewed browser CSS build configuration.`,
    );
    await withRepositoryFixture(
      {
        [relativeFile]: "export default { plugins: [] };\n",
      },
      async (_repositoryRoot, findFixtureViolations) => {
        await assert.rejects(() => findFixtureViolations(), expectedError);
      },
    );
    await withRepositoryFixture(
      {
        ...reviewedStrictRepositoryFiles,
        [relativeFile]: "export default { plugins: [] };\n",
      },
      async (repositoryRoot) => {
        await assert.rejects(
          () => findImportBoundaryViolations(repositoryRoot),
          expectedError,
        );
      },
    );
  }

  for (const [relativeFile, reviewedManifest] of [
    ["package.json", reviewedRootManifest],
    ["apps/web/package.json", reviewedWebManifest],
    ["apps/package.json", {}],
  ]) {
    const expectedError = new Error(
      `${relativeFile} may not alter the reviewed browser CSS build configuration.`,
    );
    for (const repositoryFiles of [{}, reviewedStrictRepositoryFiles]) {
      await withRepositoryFixture(
        {
          ...repositoryFiles,
          [relativeFile]: JSON.stringify({
            ...reviewedManifest,
            postcss: { plugins: [] },
          }),
        },
        async (repositoryRoot, findFixtureViolations) => {
          await assert.rejects(
            () =>
              repositoryFiles === reviewedStrictRepositoryFiles
                ? findImportBoundaryViolations(repositoryRoot)
                : findFixtureViolations(),
            expectedError,
          );
        },
      );
    }
  }
});

test("requires the exact reviewed Cloudflare Worker entrypoint configuration", async () => {
  await withRepositoryFixture(
    {
      "apps/web/wrangler.jsonc": reviewedWranglerConfig,
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), []);
    },
  );

  const alternateJsonFormatting = JSON.stringify({
    $schema: "../../node_modules/wrangler/config-schema.json",
    name: "exercisebook-app",
    main: "./src/worker/index.ts",
    compatibility_date: "2026-07-14",
    assets: {
      not_found_handling: "single-page-application",
      run_worker_first: ["/api/*"],
    },
    observability: {
      enabled: true,
    },
  });
  for (const wranglerConfig of [
    reviewedWranglerConfig.replace(
      '"../../node_modules/wrangler/config-schema.json"',
      '"../../node_modules/wrangler/alternate-schema.json"',
    ),
    reviewedWranglerConfig.replace(
      '"name": "exercisebook-app"',
      '"name": "exercisebook-preview"',
    ),
    reviewedWranglerConfig.replace(
      '"main": "./src/worker/index.ts"',
      '"main": "./src/react-app/main.tsx"',
    ),
    reviewedWranglerConfig.replace(
      '"compatibility_date": "2026-07-14"',
      '"compatibility_date": "2026-07-15"',
    ),
    reviewedWranglerConfig.replace(
      '"not_found_handling": "single-page-application"',
      '"not_found_handling": "404-page"',
    ),
    reviewedWranglerConfig.replace(
      '"run_worker_first": ["/api/*"]',
      '"run_worker_first": true',
    ),
    reviewedWranglerConfig.replace('"enabled": true', '"enabled": false'),
    reviewedWranglerConfig.replace(
      '  "name": "exercisebook-app",',
      '  "name": "exercisebook-app",\n  "routes": [],',
    ),
    reviewedWranglerConfig.replace(
      '  "name": "exercisebook-app",',
      '  // The reviewed application name.\n  "name": "exercisebook-app",',
    ),
    alternateJsonFormatting,
  ]) {
    await withRepositoryFixture(
      {
        "apps/web/wrangler.jsonc": wranglerConfig,
      },
      async (repositoryRoot, findFixtureViolations) => {
        await assert.rejects(
          () => findFixtureViolations(),
          new Error(
            "apps/web/wrangler.jsonc must exactly match the reviewed Cloudflare entrypoint configuration.",
          ),
        );
      },
    );
  }

  for (const alternateConfig of ["apps/web/wrangler.json", "apps/web/wrangler.toml"]) {
    for (const files of [
      {
        [alternateConfig]: reviewedWranglerConfig,
      },
      {
        ...reviewedStrictRepositoryFiles,
        [alternateConfig]: reviewedWranglerConfig,
      },
    ]) {
      await withRepositoryFixture(
        files,
        async (repositoryRoot, findFixtureViolations) => {
          const findViolations =
            Object.keys(files).length === 1
              ? findFixtureViolations
              : () => findImportBoundaryViolations(repositoryRoot);
          await assert.rejects(
            () => findViolations(),
            new Error(
              `${alternateConfig} may not replace or augment the reviewed apps/web/wrangler.jsonc configuration.`,
            ),
          );
        },
      );
    }
  }
});

test("rejects every Vite public directory entry in complete and partial repositories", async () => {
  for (const files of [
    {
      "apps/web/public/unreviewed.js": "globalThis.unreviewed = true;",
    },
    {
      ...reviewedStrictRepositoryFiles,
      "apps/web/public/unreviewed.js": "globalThis.unreviewed = true;",
    },
  ]) {
    await withRepositoryFixture(
      files,
      async (repositoryRoot, findFixtureViolations) => {
        const findViolations =
          Object.keys(files).length === 1
            ? findFixtureViolations
            : () => findImportBoundaryViolations(repositoryRoot);
        await assert.rejects(
          () => findViolations(),
          new Error(
            "apps/web/public must be absent because Vite copies it outside the reviewed module graph.",
          ),
        );
      },
    );
  }

  await withRepositoryFixture(
    {
      "apps/web/unreviewed-public/asset.txt": "unreviewed",
    },
    async (repositoryRoot, findFixtureViolations) => {
      await symlink(
        "./unreviewed-public",
        path.join(repositoryRoot, "apps/web/public"),
        "dir",
      );
      await assert.rejects(
        () => findFixtureViolations(),
        new Error(
          "apps/web/public must be absent because Vite copies it outside the reviewed module graph.",
        ),
      );
    },
  );
});

test("keeps direct trusted imports available to the Worker server boundary", async () => {
  await withRepositoryFixture(
    {
      "apps/web/src/worker/static.ts":
        'import { projectWorksheetForStudentWithCanonicalAnswers } from "@exercisebook/schemas/trusted-student-projection";',
      "apps/web/src/worker/prepared-guard.ts": `
        import {
          prepareStudentVisibleAnswerGuard,
          type PreparedStudentVisibleAnswerGuard,
        } from "@exercisebook/schemas/trusted-student-projection";
        void prepareStudentVisibleAnswerGuard;
        void (undefined as unknown as PreparedStudentVisibleAnswerGuard);
      `,
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), []);
    },
  );
});

test("rejects every direct schemas implementation load from Worker production", async () => {
  await withRepositoryFixture(
    {
      "apps/web/src/worker/aliased-prepared-guard.ts":
        'import { innocuousGuardFactory } from "../../../../packages/schemas/src/student-worksheet-delivery-v2.js";',
      "apps/web/src/worker/legacy-projector.ts":
        'import { projectWorksheetV2ForStudentWithCanonicalAnswers } from "../../../../packages/schemas/src/student-worksheet-delivery-v2.js";',
      "packages/schemas/src/student-worksheet-delivery-v2.ts": `
        import {
          prepareStudentVisibleAnswerGuard,
        } from "./worksheet-instance-v1.js";
        export const innocuousGuardFactory = prepareStudentVisibleAnswerGuard;
        export const projectWorksheetV2ForStudentWithCanonicalAnswers = true;
      `,
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'apps/web/src/worker/aliased-prepared-guard.ts imports schemas implementation outside reviewed public or trusted entrypoints "../../../../packages/schemas/src/student-worksheet-delivery-v2.js"',
        'apps/web/src/worker/legacy-projector.ts imports schemas implementation outside reviewed public or trusted entrypoints "../../../../packages/schemas/src/student-worksheet-delivery-v2.js"',
      ]);
    },
  );
});

test("allows prepared answer authority only through the exact trusted leaf in Worker and Print production", async () => {
  await withRepositoryFixture(
    {
      "apps/web/src/worker/allowed.ts": `
        import {
          prepareStudentVisibleAnswerGuard,
          type PreparedStudentVisibleAnswerGuard,
        } from "@exercisebook/schemas/trusted-student-projection";
        void prepareStudentVisibleAnswerGuard;
        void (undefined as unknown as PreparedStudentVisibleAnswerGuard);
      `,
      "apps/web/src/worker/root-escape.ts":
        'import { prepareStudentVisibleAnswerGuard } from "@exercisebook/schemas";',
      "apps/web/src/worker/source-escape.ts":
        'import { prepareStudentVisibleAnswerGuard } from "../../../../packages/schemas/src/worksheet-instance-v1.js";',
      "apps/web/src/worker/internal-consumer-escape.ts":
        'import { prepareStudentVisibleAnswerGuard } from "../../../../packages/schemas/src/student-worksheet-delivery-v2.js";',
      "apps/web/src/worker/namespace-source-escape.ts":
        'import * as AnswerAuthority from "../../../../packages/schemas/src/worksheet-instance-v1.js";',
      "apps/web/src/worker/subpath-escape.ts":
        'import type { PreparedStudentVisibleAnswerGuard } from "@exercisebook/schemas/trusted-student-projection/internal";',
      "apps/web/src/worker/trusted-alias-escape.ts":
        'import { prepareStudentVisibleAnswerGuard as innocuousGuardFactory } from "@exercisebook/schemas/trusted-student-projection";',
      "apps/web/src/worker/trusted-dynamic-escape.ts":
        'const answerAuthority = import("@exercisebook/schemas/trusted-student-projection");',
      "apps/web/src/worker/trusted-reexport-escape.ts":
        'export { prepareStudentVisibleAnswerGuard } from "@exercisebook/schemas/trusted-student-projection";',
      "apps/web/src/worker/trusted-relative-escape.ts":
        'import { prepareStudentVisibleAnswerGuard } from "../../../../packages/schemas/src/trusted-student-projection.js";',
      "apps/web/src/worker/trusted-two-step-reexport.ts": `
        import { prepareStudentVisibleAnswerGuard } from "@exercisebook/schemas/trusted-student-projection";
        export { prepareStudentVisibleAnswerGuard };
      `,
      "apps/web/src/worker/trusted-identity-alias.ts": `
        import { prepareStudentVisibleAnswerGuard } from "@exercisebook/schemas/trusted-student-projection";
        const innocuousGuardFactory = prepareStudentVisibleAnswerGuard;
        export { innocuousGuardFactory };
      `,
      "apps/web/src/worker/public-root-reexport.ts":
        'export { prepareStudentVisibleAnswerGuard } from "@exercisebook/schemas";',
      "packages/print-document/src/allowed.ts": `
        import {
          prepareStudentVisibleAnswerGuard,
          type PreparedStudentVisibleAnswerGuard,
        } from "@exercisebook/schemas/trusted-student-projection";
        void prepareStudentVisibleAnswerGuard;
        void (undefined as unknown as PreparedStudentVisibleAnswerGuard);
      `,
      "packages/print-document/src/root-escape.ts":
        'import { prepareStudentVisibleAnswerGuard } from "@exercisebook/schemas";',
      "packages/print-document/src/trusted-alias-escape.ts":
        'import { prepareStudentVisibleAnswerGuard as innocuousGuardFactory } from "@exercisebook/schemas/trusted-student-projection";',
      "packages/print-document/src/trusted-reexport-escape.ts":
        'export { prepareStudentVisibleAnswerGuard } from "@exercisebook/schemas/trusted-student-projection";',
      "packages/print-document/src/trusted-two-step-bridge.ts": `
        import { prepareStudentVisibleAnswerGuard } from "@exercisebook/schemas/trusted-student-projection";
        export { prepareStudentVisibleAnswerGuard };
      `,
      "packages/print-document/src/public-barrel.ts":
        'export { prepareStudentVisibleAnswerGuard } from "./trusted-two-step-bridge.js";',
      "packages/print-document/src/public-root-reexport.ts":
        'export { prepareStudentVisibleAnswerGuard } from "@exercisebook/schemas";',
      "packages/print-document/src/source-escape.ts":
        'import type { PreparedStudentVisibleAnswerGuard } from "../../schemas/src/worksheet-instance-v1.js";',
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'apps/web/src/worker/internal-consumer-escape.ts imports schemas implementation outside reviewed public or trusted entrypoints "../../../../packages/schemas/src/student-worksheet-delivery-v2.js"',
        'apps/web/src/worker/namespace-source-escape.ts imports schemas implementation outside reviewed public or trusted entrypoints "../../../../packages/schemas/src/worksheet-instance-v1.js"',
        'apps/web/src/worker/public-root-reexport.ts exports prepared answer authority outside the exact trusted leaf "@exercisebook/schemas"',
        'apps/web/src/worker/root-escape.ts imports prepared answer authority outside the exact trusted leaf "@exercisebook/schemas"',
        'apps/web/src/worker/source-escape.ts imports schemas implementation outside reviewed public or trusted entrypoints "../../../../packages/schemas/src/worksheet-instance-v1.js"',
        'apps/web/src/worker/subpath-escape.ts imports trusted answer authority outside an exact non-aliased trusted-leaf import "@exercisebook/schemas/trusted-student-projection/internal"',
        'apps/web/src/worker/trusted-alias-escape.ts imports trusted answer authority outside an exact non-aliased trusted-leaf import "@exercisebook/schemas/trusted-student-projection"',
        'apps/web/src/worker/trusted-dynamic-escape.ts loads trusted answer authority outside an exact non-aliased trusted-leaf import "@exercisebook/schemas/trusted-student-projection"',
        'apps/web/src/worker/trusted-identity-alias.ts re-exports trusted answer authority through local binding "innocuousGuardFactory"',
        'apps/web/src/worker/trusted-reexport-escape.ts exports trusted answer authority outside an exact non-aliased trusted-leaf import "@exercisebook/schemas/trusted-student-projection"',
        'apps/web/src/worker/trusted-relative-escape.ts imports trusted answer authority outside an exact non-aliased trusted-leaf import "../../../../packages/schemas/src/trusted-student-projection.js"',
        'apps/web/src/worker/trusted-two-step-reexport.ts re-exports trusted answer authority through local binding "prepareStudentVisibleAnswerGuard"',
        'packages/print-document/src/public-root-reexport.ts exports prepared answer authority outside the exact trusted leaf "@exercisebook/schemas"',
        'packages/print-document/src/root-escape.ts imports prepared answer authority outside the exact trusted leaf "@exercisebook/schemas"',
        'packages/print-document/src/source-escape.ts imports schemas implementation outside reviewed public or trusted entrypoints "../../schemas/src/worksheet-instance-v1.js"',
        'packages/print-document/src/trusted-alias-escape.ts imports trusted answer authority outside an exact non-aliased trusted-leaf import "@exercisebook/schemas/trusted-student-projection"',
        'packages/print-document/src/trusted-reexport-escape.ts exports trusted answer authority outside an exact non-aliased trusted-leaf import "@exercisebook/schemas/trusted-student-projection"',
        'packages/print-document/src/trusted-two-step-bridge.ts re-exports trusted answer authority through local binding "prepareStudentVisibleAnswerGuard"',
      ]);
    },
  );
});

test("fails closed on computed production Worker module loads", async () => {
  await withRepositoryFixture(
    {
      "apps/web/src/worker/computed.ts": "const trusted = import(moduleSpecifier);",
    },
    async (repositoryRoot, findFixtureViolations) => {
      await assert.rejects(
        () => findFixtureViolations(),
        new Error(
          "Non-static import() is not allowed in apps/web/src/worker/computed.ts at offset 23.",
        ),
      );
    },
  );
});

test("rejects trusted modules loaded through Vite glob APIs in browser code", async () => {
  await withRepositoryFixture(
    {
      "apps/web/src/react-app/glob.ts":
        'const trusted = import.meta.glob("../../../../packages/schemas/src/trusted-*.ts");',
      "packages/web-renderer/src/glob-eager.ts":
        "const trusted = import.meta.globEager(`../../schemas/src/student-worksheet-delivery-v2.ts`);",
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'apps/web/src/react-app/glob.ts uses forbidden production Vite module load "../../../../packages/schemas/src/trusted-*.ts"',
        'packages/web-renderer/src/glob-eager.ts uses forbidden production Vite module load "../../schemas/src/student-worksheet-delivery-v2.ts"',
      ]);
    },
  );
});

test("forbids Vite glob APIs in every production source boundary", async () => {
  await withRepositoryFixture(
    {
      "packages/content-compiler/src/glob.ts":
        'const content = import.meta.glob("./*.ts");',
      "packages/planner/src/allowed.test.ts":
        'const fixtures = import.meta.glob("./*.ts");',
      "packages/print-document/src/glob.ts":
        'const templates = import.meta.glob("./*.ts");',
      "apps/web/src/react-app/allowed.test.ts":
        'const fixtures = import.meta.glob("./*.ts");',
      "apps/web/src/worker/glob.ts": 'const handlers = import.meta.glob("./*.ts");',
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'packages/content-compiler/src/glob.ts uses forbidden production Vite module load "./*.ts"',
        'apps/web/src/worker/glob.ts uses forbidden production Vite module load "./*.ts"',
        'packages/print-document/src/glob.ts uses forbidden production Vite module load "./*.ts"',
      ]);
    },
  );
});

test("forbids historical Vite glob and root-absolute escape patterns", async () => {
  await withRepositoryFixture(
    {
      "apps/web/src/react-app/base-glob.ts":
        'const trusted = import.meta.glob("./trusted-*.ts", { base: "../../../../packages/schemas/src", eager: true });',
      "apps/web/src/react-app/root-base-glob.ts":
        'const trusted = import.meta.glob("./trusted-*.ts", { base: "/../../packages/schemas/src" });',
      "apps/web/src/react-app/positive-negative-glob.ts":
        'const trusted = import.meta.glob(["../../../../packages/schemas/src/trusted-*.ts", "!./safe/*.ts"]);',
      "apps/web/src/react-app/conservative-negative-glob.ts":
        'const trusted = import.meta.glob(["../../../../packages/schemas/src/trusted-*.ts", "!../../../../packages/schemas/src/trusted-*.ts"]);',
      "apps/web/src/react-app/question-wildcard-glob.ts":
        'const trusted = import.meta.glob("../../../../packages/schemas/src/trusted?student-projection.ts");',
      "apps/web/src/react-app/root-absolute-glob.ts":
        'const trusted = import.meta.glob("/../../packages/schemas/src/trusted-*.ts");',
      "apps/web/src/react-app/root-absolute-import.ts":
        'import { trusted } from "/../../packages/schemas/src/trusted-student-projection.ts";',
      "apps/web/src/react-app/static-query-import.ts":
        'import { trusted } from "../../../../packages/schemas/src/trusted-student-projection.ts?raw";',
      "packages/schemas/src/trusted-student-projection.ts":
        "export const trusted = true;",
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'apps/web/src/react-app/base-glob.ts uses forbidden production Vite module load "./trusted-*.ts"',
        'apps/web/src/react-app/conservative-negative-glob.ts uses forbidden production Vite module load "../../../../packages/schemas/src/trusted-*.ts"',
        'apps/web/src/react-app/conservative-negative-glob.ts uses forbidden production Vite module load "!../../../../packages/schemas/src/trusted-*.ts"',
        'apps/web/src/react-app/positive-negative-glob.ts uses forbidden production Vite module load "../../../../packages/schemas/src/trusted-*.ts"',
        'apps/web/src/react-app/positive-negative-glob.ts uses forbidden production Vite module load "!./safe/*.ts"',
        'apps/web/src/react-app/question-wildcard-glob.ts uses forbidden production Vite module load "../../../../packages/schemas/src/trusted?student-projection.ts"',
        'apps/web/src/react-app/root-absolute-glob.ts uses forbidden production Vite module load "/../../packages/schemas/src/trusted-*.ts"',
        'apps/web/src/react-app/root-absolute-import.ts uses forbidden production Vite module load "/../../packages/schemas/src/trusted-student-projection.ts"',
        'apps/web/src/react-app/root-base-glob.ts uses forbidden production Vite module load "./trusted-*.ts"',
        'apps/web/src/react-app/static-query-import.ts imports outside its browser source root "../../../../packages/schemas/src/trusted-student-projection.ts?raw"',
      ]);
    },
  );
});

test("rejects browser loads of server-only workspace packages and source paths", async () => {
  await withRepositoryFixture(
    {
      "apps/web/src/react-app/content-compiler.ts":
        'const compiler = import("@exercisebook/content-compiler/internal");',
      "apps/web/src/react-app/generators.ts":
        'import { generate } from "@exercisebook/generators";',
      "apps/web/src/react-app/print-document.ts":
        'export * from "@exercisebook/print-document";',
      "apps/web/src/react-app/print-document-relative.ts":
        'import { project } from "../../../../packages/print-document/src/project.js";',
      "apps/web/src/react-app/print-document-glob.ts":
        'const projects = import.meta.glob("../../../../packages/print-document/src/proj?ct.ts");',
      "apps/web/src/react-app/print-document-root.ts":
        'const project = new URL("/../../packages/print-document/src/project.ts", import.meta.url);',
      "packages/content-compiler/src/index.ts": "export const compile = true;",
      "packages/generators/src/index.ts": "export const generate = true;",
      "packages/print-document/src/project.ts": "export const project = true;",
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'apps/web/src/react-app/content-compiler.ts imports non-allowlisted browser workspace dependency "@exercisebook/content-compiler/internal"',
        'apps/web/src/react-app/generators.ts imports non-allowlisted browser workspace dependency "@exercisebook/generators"',
        'apps/web/src/react-app/print-document-glob.ts uses forbidden production Vite module load "../../../../packages/print-document/src/proj?ct.ts"',
        'apps/web/src/react-app/print-document-relative.ts imports outside its browser source root "../../../../packages/print-document/src/project.js"',
        'apps/web/src/react-app/print-document-root.ts uses forbidden production Vite module load "/../../packages/print-document/src/project.ts"',
        'apps/web/src/react-app/print-document.ts imports non-allowlisted browser workspace dependency "@exercisebook/print-document"',
      ]);
    },
  );
});

test("allows only reviewed runtime dependencies in production package sources", async () => {
  await withRepositoryFixture(
    {
      "apps/web/src/react-app/allowed-runtime.ts": `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { addRationals as domain } from "@exercisebook/domain/rational";
        import { DAILY_PLAN_PREVIEW_REQUEST_V2_SCHEMA as planner } from "@exercisebook/planner/public-preview-contract";
        import { StableIdSchema as schemas } from "@exercisebook/schemas/public-data";
        import { value as renderer } from "@exercisebook/web-renderer";
        void React;
        void createRoot;
        void domain;
        void planner;
        void schemas;
        void renderer;
      `,
      "apps/web/src/react-app/dev-library.ts":
        'import { render } from "@testing-library/react";',
      "apps/web/src/react-app/undeclared.ts": 'import leftPad from "left-pad";',
      "apps/web/src/react-app/dev-library.test.ts":
        'import { render } from "@testing-library/react"; void render;',
      "apps/web/src/worker/allowed-runtime.ts": `
        import { Hono } from "hono";
        import { generate } from "@exercisebook/generators";
        void Hono;
        void generate;
      `,
      "packages/planner/src/allowed-runtime.ts": `
        import { z } from "zod";
        import { value as domain } from "@exercisebook/domain";
        import { value as schemas } from "@exercisebook/schemas";
        void z;
        void domain;
        void schemas;
      `,
      "packages/schemas/src/allowed-runtime.ts": `
        import { z } from "zod";
        import { value as domain } from "@exercisebook/domain";
        void z;
        void domain;
      `,
      "packages/web-renderer/src/allowed-runtime.ts": `
        import { WorksheetPresentationV1Schema } from "@exercisebook/schemas/presentation-contract-v1";
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { z } from "zod";
        void WorksheetPresentationV1Schema;
        void React;
        void createRoot;
        void z;
      `,
      "packages/web-renderer/src/dev-library.ts":
        'import { render } from "@testing-library/react";',
      "packages/web-renderer/src/dev-library.test.ts":
        'import { render } from "@testing-library/react"; void render;',
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'apps/web/src/react-app/dev-library.ts imports non-runtime external dependency "@testing-library/react"',
        'apps/web/src/react-app/undeclared.ts imports non-runtime external dependency "left-pad"',
        'packages/web-renderer/src/dev-library.ts imports non-runtime external dependency "@testing-library/react"',
      ]);
    },
  );
});

test("allows only exact reviewed runtime roots in print-document production sources", async () => {
  await withRepositoryFixture(
    {
      "packages/print-document/src/allowed-local.ts":
        'export const localValue = "local";',
      "packages/print-document/src/allowed-production.ts": `
        import { value as domain } from "@exercisebook/domain";
        import { value as schemas } from "@exercisebook/schemas";
        import { projectWorksheetForStudentWithCanonicalAnswers } from "@exercisebook/schemas/trusted-student-projection";
        import { localValue } from "./allowed-local.js";
        void domain;
        void schemas;
        void projectWorksheetForStudentWithCanonicalAnswers;
        void localValue;
      `,
      "packages/print-document/src/production-leaks.ts": `
        import type { CompiledContentV1 } from "@exercisebook/content-compiler";
        import { value as domainSubpath } from "@exercisebook/domain/rational";
        import { value as schemaSubpath } from "@exercisebook/schemas/public-data";
        import { value as trustedProjectionInternal } from "@exercisebook/schemas/trusted-student-projection/internal";
        import { testOnlyValue } from "./test-helper.test.js";
        const generators = import("@exercisebook/generators");
        const planner = require("@exercisebook/planner");
        type UndeclaredPackage = import("left-pad").Default;
        type Content = CompiledContentV1;
        void generators;
        void planner;
        void domainSubpath;
        void schemaSubpath;
        void trustedProjectionInternal;
        void testOnlyValue;
        void (undefined as unknown as Content);
        void (undefined as unknown as UndeclaredPackage);
      `,
      "packages/print-document/src/production-boundary.test.ts": `
        import { readFileSync } from "node:fs";
        import { compileContentSource } from "@exercisebook/content-compiler";
        import { materializeFractionAdditionV2 } from "@exercisebook/generators";
        import { describe } from "vitest";
        void readFileSync;
        void compileContentSource;
        void materializeFractionAdditionV2;
        void describe;
      `,
      "packages/print-document/src/test-helper.test.ts":
        "export const testOnlyValue = true;",
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'packages/print-document/src/production-leaks.ts imports non-allowlisted production dependency "@exercisebook/content-compiler"',
        'packages/print-document/src/production-leaks.ts imports non-allowlisted production dependency "@exercisebook/domain/rational"',
        'packages/print-document/src/production-leaks.ts imports non-allowlisted production dependency "@exercisebook/schemas/public-data"',
        'packages/print-document/src/production-leaks.ts imports trusted answer authority outside an exact non-aliased trusted-leaf import "@exercisebook/schemas/trusted-student-projection/internal"',
        'packages/print-document/src/production-leaks.ts imports test-only module "./test-helper.test.js"',
        'packages/print-document/src/production-leaks.ts imports non-allowlisted production dependency "@exercisebook/generators"',
        'packages/print-document/src/production-leaks.ts imports non-allowlisted production dependency "@exercisebook/planner"',
        'packages/print-document/src/production-leaks.ts imports non-allowlisted production dependency "left-pad"',
      ]);
    },
  );
});

test("blocks server-only packages from browser-safe workspace package roots", async () => {
  await withRepositoryFixture(
    {
      "packages/planner/src/leak.ts":
        'export { generate } from "@exercisebook/generators";',
      "packages/generators/src/index.ts": "export const generate = true;",
      "apps/web/src/react-app/planner.ts":
        'import { DAILY_PLAN_PREVIEW_REQUEST_V1_SCHEMA } from "@exercisebook/planner/public-preview-contract";',
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'packages/planner/src/leak.ts imports non-allowlisted browser workspace dependency "@exercisebook/generators"',
      ]);
    },
  );
});

test("preserves the intentionally browser-safe workspace package surface", async () => {
  await withRepositoryFixture(
    {
      "apps/web/src/react-app/safe-workspaces.ts": `
        import {
          DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2,
          DAILY_PLAN_PREVIEW_REQUEST_V2_SCHEMA,
        } from "@exercisebook/planner/public-preview-contract";
        import { addRationals } from "@exercisebook/domain/rational";
        import { StableIdSchema } from "@exercisebook/schemas/public-data";
        import { renderWorksheet } from "@exercisebook/web-renderer";
        export {
          addRationals,
          DAILY_PLAN_PREVIEW_REQUEST_V2_SCHEMA,
          DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2,
          renderWorksheet,
          StableIdSchema,
        };
      `,
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), []);
    },
  );
});

test("rejects domain, planner, and schema root barrels from browser production code", async () => {
  await withRepositoryFixture(
    {
      "apps/web/src/react-app/unsafe-workspace-roots.ts": `
        import { deriveSlotSeed } from "@exercisebook/domain";
        import { DailyPlanPreviewV2Schema } from "@exercisebook/planner";
        import { StudentWorksheetDeliveryV2Schema } from "@exercisebook/schemas";
        void deriveSlotSeed;
        void DailyPlanPreviewV2Schema;
        void StudentWorksheetDeliveryV2Schema;
      `,
      "apps/web/src/shared/unsafe-workspace-root-types.ts": `
        import type { DailyPlanPreviewV2 } from "@exercisebook/planner";
        type StudentDelivery =
          import("@exercisebook/schemas").StudentWorksheetDeliveryV2;
        export type { DailyPlanPreviewV2, StudentDelivery };
      `,
      "packages/web-renderer/src/unsafe-workspace-root-types.ts": `
        export type { DailyPlanPreviewV2 } from "@exercisebook/planner";
        export type { StudentWorksheetDeliveryV2 } from "@exercisebook/schemas";
      `,
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'apps/web/src/react-app/unsafe-workspace-roots.ts imports non-allowlisted browser workspace dependency "@exercisebook/domain"',
        'apps/web/src/react-app/unsafe-workspace-roots.ts imports non-allowlisted browser workspace dependency "@exercisebook/planner"',
        'apps/web/src/react-app/unsafe-workspace-roots.ts imports non-allowlisted browser workspace dependency "@exercisebook/schemas"',
        'apps/web/src/shared/unsafe-workspace-root-types.ts imports non-allowlisted browser workspace dependency "@exercisebook/planner"',
        'apps/web/src/shared/unsafe-workspace-root-types.ts imports non-allowlisted browser workspace dependency "@exercisebook/schemas"',
        'packages/web-renderer/src/unsafe-workspace-root-types.ts imports non-allowlisted browser workspace dependency "@exercisebook/planner"',
        'packages/web-renderer/src/unsafe-workspace-root-types.ts imports non-allowlisted browser workspace dependency "@exercisebook/schemas"',
      ]);
    },
  );
});

test("rejects every unreviewed planner and schema browser subpath exactly", async () => {
  await withRepositoryFixture(
    {
      "apps/web/src/shared/unsafe-workspace-subpaths.ts": `
        import type { DailyPlanPreviewV2 } from "@exercisebook/planner/daily-plan-preview-v2";
        export type { WorksheetInstanceV2 } from "@exercisebook/schemas/worksheet-instance-v2";
      `,
      "packages/web-renderer/src/unsafe-workspace-subpaths.ts": `
        type PlannerInternal =
          import("@exercisebook/planner/public-preview-contract/internal").DailyPlanPreviewRequestV2;
        export type { PlannerInternal };
        export type { AttributionV1 } from "@exercisebook/schemas/attribution-v1/internal";
        export type { WorksheetPresentationV1 } from "@exercisebook/schemas/presentation-contract-v1/internal";
        export { StableIdSchema } from "@exercisebook/schemas/public-data/internal";
      `,
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'apps/web/src/shared/unsafe-workspace-subpaths.ts imports non-allowlisted browser workspace dependency "@exercisebook/planner/daily-plan-preview-v2"',
        'apps/web/src/shared/unsafe-workspace-subpaths.ts imports non-allowlisted browser workspace dependency "@exercisebook/schemas/worksheet-instance-v2"',
        'packages/web-renderer/src/unsafe-workspace-subpaths.ts imports non-allowlisted browser workspace dependency "@exercisebook/planner/public-preview-contract/internal"',
        'packages/web-renderer/src/unsafe-workspace-subpaths.ts imports non-allowlisted browser workspace dependency "@exercisebook/schemas/attribution-v1/internal"',
        'packages/web-renderer/src/unsafe-workspace-subpaths.ts imports non-allowlisted browser workspace dependency "@exercisebook/schemas/presentation-contract-v1/internal"',
        'packages/web-renderer/src/unsafe-workspace-subpaths.ts imports non-allowlisted browser workspace dependency "@exercisebook/schemas/public-data/internal"',
      ]);
    },
  );
});

test("allows only exact dependencies from browser-safe leaf entrypoints", async () => {
  await withRepositoryFixture(
    {
      "packages/planner/src/public-preview-contract.ts":
        "export const requestSchema = 'v1';",
      "packages/schemas/src/common.ts": `
        import { MAX_CANONICAL_INTEGER_DIGITS } from "@exercisebook/domain/rational";
        import { z } from "zod";
        export { MAX_CANONICAL_INTEGER_DIGITS, z };
      `,
      "packages/schemas/src/attribution-v1.ts": `
        import { z } from "zod";
        export { HttpUrlSchema } from "./common.js";
        export { z };
      `,
      "packages/schemas/src/presentation-contract-v1.ts": `
        import { addRationals } from "@exercisebook/domain/rational";
        import { z } from "zod";
        export { AttributionV1Schema } from "./attribution-v1.js";
        export { StableIdSchema } from "./common.js";
        export { addRationals, z };
      `,
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), []);
    },
  );

  for (const [relativeFile, source, specifier] of [
    [
      "packages/planner/src/public-preview-contract.ts",
      'export { planDailyWorksheet } from "./daily-plan-preview-v2.js";',
      "./daily-plan-preview-v2.js",
    ],
    [
      "packages/schemas/src/common.ts",
      'export { MAX_CANONICAL_INTEGER_DIGITS } from "@exercisebook/domain";',
      "@exercisebook/domain",
    ],
    [
      "packages/schemas/src/common.ts",
      'export { addRationals } from "@exercisebook/domain/rational/internal";',
      "@exercisebook/domain/rational/internal",
    ],
    [
      "packages/schemas/src/common.ts",
      'export { WorksheetInstanceV2Schema } from "./worksheet-instance-v2.js";',
      "./worksheet-instance-v2.js",
    ],
    [
      "packages/schemas/src/attribution-v1.ts",
      'export { WorksheetInstanceV1Schema } from "./worksheet-instance-v1.js";',
      "./worksheet-instance-v1.js",
    ],
    [
      "packages/schemas/src/attribution-v1.ts",
      'export { z } from "zod/internal";',
      "zod/internal",
    ],
    [
      "packages/schemas/src/presentation-contract-v1.ts",
      'export { addRationals } from "@exercisebook/domain";',
      "@exercisebook/domain",
    ],
    [
      "packages/schemas/src/presentation-contract-v1.ts",
      'export { StableIdSchema } from "./common.js?raw";',
      "./common.js?raw",
    ],
    [
      "packages/schemas/src/presentation-contract-v1.ts",
      'export { WorksheetInstanceV2Schema } from "./worksheet-instance-v2.js";',
      "./worksheet-instance-v2.js",
    ],
  ]) {
    await withRepositoryFixture(
      { [relativeFile]: source },
      async (repositoryRoot, findFixtureViolations) => {
        assert.deepEqual(await findFixtureViolations(), [
          `${relativeFile} exports non-allowlisted browser-safe leaf dependency ${JSON.stringify(specifier)}`,
        ]);
      },
    );
  }
});

test("rejects a trusted re-export through a protected workspace package", async () => {
  await withRepositoryFixture(
    {
      "packages/generators/src/index.ts":
        'export { trusted } from "@exercisebook/schemas/trusted-student-projection";',
      "apps/web/src/react-app/leak.ts":
        'import { trusted } from "@exercisebook/generators";',
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'packages/generators/src/index.ts imports trusted server-only dependency "@exercisebook/schemas/trusted-student-projection"',
        'apps/web/src/react-app/leak.ts imports non-allowlisted browser workspace dependency "@exercisebook/generators"',
      ]);
    },
  );
});

test("allows isolated tests to use trusted code but rejects production loads of test modules", async () => {
  await withRepositoryFixture(
    {
      "packages/generators/src/index.ts": 'export * from "./leak.test.js";',
      "packages/generators/src/leak.test.ts":
        'import { trusted } from "@exercisebook/schemas/trusted-student-projection"; export const wrapped = trusted;',
      "packages/generators/src/ordinary.test.ts":
        'import { trusted } from "@exercisebook/schemas/trusted-student-projection"; export const isolated = trusted;',
      "packages/print-document/src/index.ts": 'export * from "./project.test.js";',
      "packages/print-document/src/project.test.ts": "export const testProject = true;",
      "apps/web/src/react-app/glob-tests.ts":
        'const tests = import.meta.glob("../../../../packages/generators/src/*.{test,spec}.ts");',
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'packages/generators/src/index.ts imports test-only module "./leak.test.js"',
        'apps/web/src/react-app/glob-tests.ts uses forbidden production Vite module load "../../../../packages/generators/src/*.{test,spec}.ts"',
        'packages/print-document/src/index.ts imports test-only module "./project.test.js"',
      ]);
    },
  );
});

test("restricts the trusted projection module to its schema entrypoint and tests", async () => {
  await withRepositoryFixture(
    {
      "packages/schemas/src/index.ts":
        'export { trusted } from "./trusted-student-projection.js";',
      "packages/schemas/src/internal-projector.ts":
        'import { trusted } from "./trusted-student-projection.js";',
      "packages/schemas/src/internal-projector.test.ts":
        'import { trusted } from "./trusted-student-projection.js";',
      "packages/schemas/src/trusted-student-projection.ts":
        'export { projectWorksheetV2ForStudentWithCanonicalAnswers } from "./student-worksheet-delivery-v2.js";',
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'packages/schemas/src/index.ts imports trusted server-only dependency "./trusted-student-projection.js"',
        'packages/schemas/src/internal-projector.ts imports trusted server-only dependency "./trusted-student-projection.js"',
      ]);
    },
  );
});

test("rejects trusted named bindings from mixed modules at the public schemas barrel", async () => {
  await withRepositoryFixture(
    {
      "packages/schemas/src/index.ts": `
        export {
          projectWorksheetV2ForStudentWithCanonicalAnswers as harmlessProjector,
          assertPresentationIntermediatesDoNotMatchCanonicalAnswers,
          StudentWorksheetDeliveryV2Schema,
        } from "./student-worksheet-delivery-v2.js";
        export type {
          StudentWorksheetProjectionV2 as HarmlessProjectionV2,
          StudentWorksheetDeliveryV2,
        } from "./student-worksheet-delivery-v2.js";
        import {
          projectWorksheetForStudentWithCanonicalAnswers as harmlessV1Projector,
          WorksheetInstanceV1Schema,
        } from "./worksheet-instance-v1.js";
        export { WorksheetInstanceV1Schema };
        export type {
          StudentWorksheetProjectionV1 as HarmlessProjectionV1,
          PreparedStudentVisibleAnswerGuard,
          WorksheetInstanceV1,
        } from "./worksheet-instance-v1.js";
        export {
          prepareStudentVisibleAnswerGuard,
        } from "./worksheet-instance-v1.js";
        type SafeImportedType =
          import("./worksheet-instance-v1.js").WorksheetInstanceV1;
        type ForbiddenImportedType =
          import("./worksheet-instance-v1.js").StudentWorksheetProjectionV1;
      `,
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'packages/schemas/src/index.ts exports trusted server-only binding "projectWorksheetV2ForStudentWithCanonicalAnswers" from "./student-worksheet-delivery-v2.js"',
        'packages/schemas/src/index.ts exports trusted server-only binding "assertPresentationIntermediatesDoNotMatchCanonicalAnswers" from "./student-worksheet-delivery-v2.js"',
        'packages/schemas/src/index.ts exports trusted server-only binding "StudentWorksheetProjectionV2" from "./student-worksheet-delivery-v2.js"',
        'packages/schemas/src/index.ts imports trusted server-only binding "projectWorksheetForStudentWithCanonicalAnswers" from "./worksheet-instance-v1.js"',
        'packages/schemas/src/index.ts exports trusted server-only binding "StudentWorksheetProjectionV1" from "./worksheet-instance-v1.js"',
        'packages/schemas/src/index.ts exports trusted server-only binding "PreparedStudentVisibleAnswerGuard" from "./worksheet-instance-v1.js"',
        'packages/schemas/src/index.ts exports trusted server-only binding "prepareStudentVisibleAnswerGuard" from "./worksheet-instance-v1.js"',
        'packages/schemas/src/index.ts loads trusted server-only binding "StudentWorksheetProjectionV1" from "./worksheet-instance-v1.js"',
      ]);
    },
  );
});

test("allows the prepared guard implementation only in its reviewed schemas consumer and trusted entrypoint", async () => {
  await withRepositoryFixture(
    {
      "packages/schemas/src/student-worksheet-delivery-v2.ts": `
        import {
          prepareStudentVisibleAnswerGuard,
          type PreparedStudentVisibleAnswerGuard,
        } from "./worksheet-instance-v1.js";
        void prepareStudentVisibleAnswerGuard;
        void (undefined as unknown as PreparedStudentVisibleAnswerGuard);
      `,
      "packages/schemas/src/trusted-student-projection.ts": `
        export {
          prepareStudentVisibleAnswerGuard,
          type PreparedStudentVisibleAnswerGuard,
        } from "./worksheet-instance-v1.js";
      `,
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), []);
    },
  );
});

test("rejects prepared guard implementation subpaths from the reviewed schemas consumer", async () => {
  await withRepositoryFixture(
    {
      "packages/schemas/src/student-worksheet-delivery-v2.ts": `
        import {
          prepareStudentVisibleAnswerGuard,
          type PreparedStudentVisibleAnswerGuard,
        } from "./worksheet-instance-v1/internal.js";
        void prepareStudentVisibleAnswerGuard;
        void (undefined as unknown as PreparedStudentVisibleAnswerGuard);
      `,
      "packages/schemas/src/worksheet-instance-v1/internal.ts":
        "export const unrelated = true;",
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'packages/schemas/src/student-worksheet-delivery-v2.ts imports trusted server-only binding "prepareStudentVisibleAnswerGuard" from "./worksheet-instance-v1/internal.js"',
        'packages/schemas/src/student-worksheet-delivery-v2.ts imports trusted server-only binding "PreparedStudentVisibleAnswerGuard" from "./worksheet-instance-v1/internal.js"',
      ]);
    },
  );
});

test("rejects prepared answer authority from every public schemas leaf", async () => {
  for (const relativeFile of [
    "packages/schemas/src/attribution-v1.ts",
    "packages/schemas/src/common.ts",
    "packages/schemas/src/presentation-contract-v1.ts",
  ]) {
    await withRepositoryFixture(
      {
        [relativeFile]: `
          export {
            prepareStudentVisibleAnswerGuard,
            type PreparedStudentVisibleAnswerGuard,
          } from "./worksheet-instance-v1.js";
        `,
      },
      async (repositoryRoot, findFixtureViolations) => {
        assert.deepEqual(await findFixtureViolations(), [
          `${relativeFile} exports non-allowlisted browser-safe leaf dependency "./worksheet-instance-v1.js"`,
          `${relativeFile} exports trusted server-only binding "prepareStudentVisibleAnswerGuard" from "./worksheet-instance-v1.js"`,
          `${relativeFile} exports trusted server-only binding "PreparedStudentVisibleAnswerGuard" from "./worksheet-instance-v1.js"`,
        ]);
      },
    );
  }
});

test("allows only direct reviewed bindings from mixed schema modules", async () => {
  await withRepositoryFixture(
    {
      "packages/schemas/src/a-import-alias.ts":
        'import { WorksheetInstanceV1Schema as AlternateSchema } from "./worksheet-instance-v1.js";',
      "packages/schemas/src/b-export-alias.ts":
        'export { StudentWorksheetDeliveryV2Schema as AlternateDeliverySchema } from "./student-worksheet-delivery-v2.js";',
      "packages/schemas/src/c-default.ts":
        'import WorksheetInstance from "./worksheet-instance-v1.js";',
      "packages/schemas/src/d-namespace.ts":
        'import * as Delivery from "./student-worksheet-delivery-v2.js";',
      "packages/schemas/src/e-new-binding.ts":
        'export { NewlyIntroducedProjection } from "./worksheet-instance-v1.js";',
      "packages/schemas/src/f-default-export.ts":
        'export { default as WorksheetInstance } from "./worksheet-instance-v1.js";',
      "packages/schemas/src/g-side-effect.ts":
        'import "./student-worksheet-delivery-v2.js";',
      "packages/schemas/src/h-reviewed.ts": `
        import {
          WorksheetInstanceV1Schema,
          projectWorksheetForStudent,
        } from "./worksheet-instance-v1.js";
        export type {
          WorksheetInstanceV1,
        } from "./worksheet-instance-v1.js";
        export {
          StudentWorksheetDeliveryV2Schema,
          validateStudentWorksheetDeliveryV2,
        } from "./student-worksheet-delivery-v2.js";
        export type {
          StudentWorksheetDeliveryV2,
        } from "./student-worksheet-delivery-v2.js";
        void WorksheetInstanceV1Schema;
        void projectWorksheetForStudent;
      `,
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'packages/schemas/src/a-import-alias.ts imports trusted server-only binding "WorksheetInstanceV1Schema" from "./worksheet-instance-v1.js"',
        'packages/schemas/src/b-export-alias.ts exports trusted server-only binding "StudentWorksheetDeliveryV2Schema" from "./student-worksheet-delivery-v2.js"',
        'packages/schemas/src/c-default.ts imports trusted server-only binding "default" from "./worksheet-instance-v1.js"',
        'packages/schemas/src/d-namespace.ts imports trusted server-only binding "*" from "./student-worksheet-delivery-v2.js"',
        'packages/schemas/src/e-new-binding.ts exports trusted server-only binding "NewlyIntroducedProjection" from "./worksheet-instance-v1.js"',
        'packages/schemas/src/f-default-export.ts exports trusted server-only binding "default" from "./worksheet-instance-v1.js"',
        'packages/schemas/src/g-side-effect.ts imports trusted server-only binding "*" from "./student-worksheet-delivery-v2.js"',
      ]);
    },
  );
});

test("rejects a transitive trusted binding re-export inside the schemas package", async () => {
  await withRepositoryFixture(
    {
      "packages/schemas/src/index.ts": 'export * from "./leaky.js";',
      "packages/schemas/src/leaky.ts":
        'export { projectWorksheetV2ForStudentWithCanonicalAnswers as apparentlySafe } from "./student-worksheet-delivery-v2.js";',
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'packages/schemas/src/leaky.ts exports trusted server-only binding "projectWorksheetV2ForStudentWithCanonicalAnswers" from "./student-worksheet-delivery-v2.js"',
      ]);
    },
  );
});

test("rejects browser imports and globs that cross into the Worker server root", async () => {
  await withRepositoryFixture(
    {
      "apps/web/src/react-app/direct-worker.ts":
        'import { project } from "../worker/web-worksheet-projector.js";',
      "apps/web/src/react-app/constructor-worker.ts":
        'const worker = new Worker(new URL("../worker/web-worksheet-projector.ts", import.meta.url), { type: "module" });',
      "apps/web/src/react-app/glob-worker.ts":
        'const projectors = import.meta.glob("../worker/*.ts");',
      "apps/web/src/react-app/base-glob-worker.ts":
        'const projectors = import.meta.glob("./*.ts", { base: "../worker" });',
      "apps/web/src/react-app/asset-url-worker.ts":
        'const asset = new URL("../worker/web-worksheet-projector.ts", import.meta.url);',
      "apps/web/src/react-app/brace-glob-worker.ts":
        'const projectors = import.meta.glob("../{worker,safe}/*.ts");',
      "apps/web/src/react-app/globstar-worker.ts":
        'const projectors = import.meta.glob("**/worker/*.ts");',
      "apps/web/src/react-app/question-glob-worker.ts":
        'const projectors = import.meta.glob("../w?rker/*.ts");',
      "apps/web/src/react-app/positive-negative-worker.ts":
        'const projectors = import.meta.glob(["../worker/*.ts", "!../worker/safe.ts"]);',
      "apps/web/src/react-app/root-absolute-worker.ts":
        'import { project } from "/src/worker/web-worksheet-projector.js";',
      "apps/web/src/react-app/root-absolute-glob-worker.ts":
        'const projectors = import.meta.glob("/src/worker/*.ts");',
      "apps/web/src/react-app/shared-constructor-worker.ts":
        "const worker = new SharedWorker(new URL(`../worker/web-worksheet-projector.ts`, import.meta.url));",
      "apps/web/src/worker/web-worksheet-projector.ts": "export const project = true;",
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'apps/web/src/react-app/asset-url-worker.ts imports Worker server-only dependency "../worker/web-worksheet-projector.ts"',
        'apps/web/src/react-app/base-glob-worker.ts uses forbidden production Vite module load "./*.ts"',
        'apps/web/src/react-app/brace-glob-worker.ts uses forbidden production Vite module load "../{worker,safe}/*.ts"',
        'apps/web/src/react-app/constructor-worker.ts imports Worker server-only dependency "../worker/web-worksheet-projector.ts"',
        'apps/web/src/react-app/direct-worker.ts imports Worker server-only dependency "../worker/web-worksheet-projector.js"',
        'apps/web/src/react-app/glob-worker.ts uses forbidden production Vite module load "../worker/*.ts"',
        'apps/web/src/react-app/globstar-worker.ts uses forbidden production Vite module load "**/worker/*.ts"',
        'apps/web/src/react-app/positive-negative-worker.ts uses forbidden production Vite module load "../worker/*.ts"',
        'apps/web/src/react-app/positive-negative-worker.ts uses forbidden production Vite module load "!../worker/safe.ts"',
        'apps/web/src/react-app/question-glob-worker.ts uses forbidden production Vite module load "../w?rker/*.ts"',
        'apps/web/src/react-app/root-absolute-glob-worker.ts uses forbidden production Vite module load "/src/worker/*.ts"',
        'apps/web/src/react-app/root-absolute-worker.ts uses forbidden production Vite module load "/src/worker/web-worksheet-projector.js"',
        'apps/web/src/react-app/shared-constructor-worker.ts imports Worker server-only dependency "../worker/web-worksheet-projector.ts"',
      ]);
    },
  );
});

test("fails closed on symlinks under protected and browser source roots", async () => {
  await withRepositoryFixture(
    {
      "packages/domain/target.ts": "export const target = true;",
    },
    async (repositoryRoot, findFixtureViolations) => {
      const link = path.join(repositoryRoot, "packages/domain/src/leak.ts");
      await mkdir(path.dirname(link), { recursive: true });
      await symlink("../target.ts", link);

      await assert.rejects(
        () => findFixtureViolations(),
        new Error(
          "Symbolic links are not allowed in import boundary source roots: packages/domain/src/leak.ts",
        ),
      );
    },
  );

  await withRepositoryFixture(
    {
      "apps/web/src/worker/secret.ts": "export const secret = true;",
    },
    async (repositoryRoot, findFixtureViolations) => {
      const link = path.join(repositoryRoot, "apps/web/src/react-app/leak.ts");
      await mkdir(path.dirname(link), { recursive: true });
      await symlink("../worker/secret.ts", link);

      await assert.rejects(
        () => findFixtureViolations(),
        new Error(
          "Symbolic links are not allowed in import boundary source roots: apps/web/src/react-app/leak.ts",
        ),
      );
    },
  );
});

test("fails closed when an explicit module path traverses an external directory symlink", async () => {
  await withRepositoryFixture(
    {
      "apps/web/src/react-app/leak.ts":
        'import { trusted } from "../../../../packages/schema-alias/trusted-student-projection.ts";',
      "packages/schemas/src/trusted-student-projection.ts":
        "export const trusted = true;",
    },
    async (repositoryRoot, findFixtureViolations) => {
      await symlink(
        "schemas/src",
        path.join(repositoryRoot, "packages/schema-alias"),
        "dir",
      );

      await assert.rejects(
        () => findFixtureViolations(),
        new Error(
          'apps/web/src/react-app/leak.ts module load "../../../../packages/schema-alias/trusted-student-projection.ts" traverses symbolic link "packages/schema-alias"',
        ),
      );
    },
  );

  await withRepositoryFixture(
    {
      "apps/web/src/react-app/leak.ts":
        'import { trusted } from "../../node_modules/@exercisebook/schemas/src/trusted-student-projection.ts";',
      "packages/schemas/src/trusted-student-projection.ts":
        "export const trusted = true;",
    },
    async (repositoryRoot, findFixtureViolations) => {
      const packageLink = path.join(
        repositoryRoot,
        "apps/web/node_modules/@exercisebook/schemas",
      );
      await mkdir(path.dirname(packageLink), { recursive: true });
      await symlink("../../../../packages/schemas", packageLink, "dir");

      await assert.rejects(
        () => findFixtureViolations(),
        new Error(
          'apps/web/src/react-app/leak.ts module load "../../node_modules/@exercisebook/schemas/src/trusted-student-projection.ts" traverses symbolic link "apps/web/node_modules/@exercisebook/schemas"',
        ),
      );
    },
  );
});

test("rejects wildcard glob paths before they can traverse workspace symlinks", async () => {
  await withRepositoryFixture(
    {
      "apps/web/src/react-app/leak.ts":
        'const leaked = import.meta.glob("../../node_modules/@exercisebook/*/src/trusted-student-projection.ts", { exhaustive: true });',
      "packages/schemas/src/trusted-student-projection.ts":
        "export const trusted = true;",
    },
    async (repositoryRoot, findFixtureViolations) => {
      const packageLink = path.join(
        repositoryRoot,
        "apps/web/node_modules/@exercisebook/schemas",
      );
      await mkdir(path.dirname(packageLink), { recursive: true });
      await symlink("../../../../packages/schemas", packageLink, "dir");

      assert.deepEqual(await findFixtureViolations(), [
        'apps/web/src/react-app/leak.ts uses forbidden production Vite module load "../../node_modules/@exercisebook/*/src/trusted-student-projection.ts"',
      ]);
    },
  );
});

test("keeps production browser paths inside their declared source roots", async () => {
  await withRepositoryFixture(
    {
      "packages/planner/src/bridge.ts":
        'export { wrapped } from "../../bridge/src/index.js";',
      "packages/planner/src/root-generator.ts":
        'const generator = new URL("/../../packages/generators/src/index.ts", import.meta.url);',
      "packages/planner/src/root-worker.ts":
        'import worker from "/src/worker/index.ts";',
      "packages/bridge/src/index.ts":
        'export { generate as wrapped } from "@exercisebook/generators";',
      "packages/generators/src/index.ts": "export const generate = true;",
      "apps/web/src/react-app/bridge.ts":
        'import { wrapped } from "../../../../packages/bridge/src/index.js";',
      "apps/web/src/react-app/planner.ts":
        'import { DAILY_PLAN_PREVIEW_REQUEST_V1_SCHEMA } from "@exercisebook/planner/public-preview-contract";',
      "apps/web/src/worker/index.ts": "export default {};",
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'packages/planner/src/bridge.ts imports outside its browser-safe source root "../../bridge/src/index.js"',
        'packages/planner/src/root-generator.ts uses forbidden production Vite module load "/../../packages/generators/src/index.ts"',
        'packages/planner/src/root-worker.ts uses forbidden production Vite module load "/src/worker/index.ts"',
        'apps/web/src/react-app/bridge.ts imports outside its browser source root "../../../../packages/bridge/src/index.js"',
      ]);
    },
  );
});

test("fails closed when browser module or asset paths escape the repository", async () => {
  await withRepositoryFixture(
    {
      "apps/web/src/react-app/leak.ts":
        'import value from "../../../../../outside.ts";',
    },
    async (repositoryRoot, findFixtureViolations) => {
      await assert.rejects(
        () => findFixtureViolations(),
        new Error(
          'apps/web/src/react-app/leak.ts module load "../../../../../outside.ts" resolves outside repository root',
        ),
      );
    },
  );

  await withRepositoryFixture(
    {
      "apps/web/src/react-app/leak.ts":
        'const value = new URL("../../../../../outside.ts", import.meta.url);',
    },
    async (repositoryRoot, findFixtureViolations) => {
      await assert.rejects(
        () => findFixtureViolations(),
        new Error(
          'apps/web/src/react-app/leak.ts module load "../../../../../outside.ts" resolves outside repository root',
        ),
      );
    },
  );
});

test("keeps test fixtures available to tests but unreachable from production", async () => {
  await withRepositoryFixture(
    {
      "apps/web/src/react-app/allowed.test.ts":
        'import { fixture } from "@exercisebook/web-renderer/fixtures"; import { shared } from "@exercisebook/test-fixtures";',
      "apps/web/src/react-app/leak-fixture.ts":
        'import { fixture } from "@exercisebook/web-renderer/fixtures";',
      "apps/web/src/react-app/leak-test-package.ts":
        'import { shared } from "@exercisebook/test-fixtures";',
      "apps/web/src/worker/allowed.test.ts":
        'import { fixture } from "@exercisebook/web-renderer/fixtures";',
      "apps/web/src/worker/helper.test.ts": "export const helper = true;",
      "apps/web/src/worker/leak-fixture.ts":
        'import { fixture } from "@exercisebook/web-renderer/fixtures";',
      "apps/web/src/worker/leak-test-module.ts":
        'import { helper } from "./helper.test.js";',
      "packages/test-fixtures/src/index.ts": "export const shared = true;",
      "packages/web-renderer/src/fixtures.ts":
        "export const fixture = { canonicalAnswer: 42 };",
      "packages/web-renderer/src/index.ts": 'export * from "./fixtures.js";',
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'apps/web/src/react-app/leak-fixture.ts imports test-only module "@exercisebook/web-renderer/fixtures"',
        'apps/web/src/react-app/leak-test-package.ts imports test-only module "@exercisebook/test-fixtures"',
        'packages/web-renderer/src/index.ts imports test-only module "./fixtures.js"',
        'apps/web/src/worker/leak-fixture.ts imports test-only module "@exercisebook/web-renderer/fixtures"',
        'apps/web/src/worker/leak-test-module.ts imports test-only module "./helper.test.js"',
      ]);
    },
  );
});

test("classifies direct test and spec paths before source-root enumeration", async () => {
  await withRepositoryFixture(
    {
      "packages/domain/src/leak.ts":
        'import { hidden } from "../../bridge/src/Hidden.SPEC.JS";',
      "packages/planner/src/leak.ts":
        'export { hidden } from "../../bridge/src/__TESTS__/helper.js";',
      "apps/web/src/worker/leak.ts":
        'const hidden = new URL("../../../../packages/bridge/src/Hidden.TEST.JS", import.meta.url);',
      "packages/bridge/src/Hidden.SPEC.ts": "export const hidden = true;",
      "packages/bridge/src/__TESTS__/helper.ts": "export const hidden = true;",
      "packages/bridge/src/Hidden.TEST.ts": "export const hidden = true;",
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'packages/domain/src/leak.ts imports test-only module "../../bridge/src/Hidden.SPEC.JS"',
        'packages/planner/src/leak.ts imports test-only module "../../bridge/src/__TESTS__/helper.js"',
        'apps/web/src/worker/leak.ts imports test-only module "../../../../packages/bridge/src/Hidden.TEST.JS"',
      ]);
    },
  );
});

test("allows __tests__ sources to use trusted code but rejects production edges into them", async () => {
  await withRepositoryFixture(
    {
      "packages/domain/src/index.ts":
        'export { helper } from "./__tests__/trusted-helper.js";',
      "packages/domain/src/__tests__/trusted-helper.ts":
        'import { trusted } from "@exercisebook/schemas/trusted-student-projection"; export const helper = trusted;',
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'packages/domain/src/index.ts imports test-only module "./__tests__/trusted-helper.js"',
      ]);
    },
  );
});

test("rejects extensionless files in executable source roots", async () => {
  await withRepositoryFixture(
    {
      "apps/web/src/react-app/main.tsx":
        'import { bridge } from "./bridge"; export { bridge };',
      "apps/web/src/react-app/bridge":
        'import { trusted } from "@exercisebook/schemas/trusted-student-projection"; export const bridge = trusted;',
    },
    async (repositoryRoot, findFixtureViolations) => {
      await assert.rejects(
        () => findFixtureViolations(),
        new Error(
          "Extensionless regular files are not allowed in import boundary source roots: apps/web/src/react-app/bridge",
        ),
      );
    },
  );

  for (const [relativeFile, source] of [
    [
      "packages/domain/src/bridge",
      'import React from "react"; export const bridge = React;',
    ],
    [
      "apps/web/src/worker/bridge",
      'import { trusted } from "@exercisebook/schemas/trusted-student-projection"; export const bridge = trusted;',
    ],
    ["packages/print-document/src/bridge", 'export * from "../../../outside.js";'],
    [
      "packages/test-fixtures/src/bridge",
      'import { trusted } from "@exercisebook/schemas/trusted-student-projection"; export const bridge = trusted;',
    ],
  ]) {
    await withRepositoryFixture(
      { [relativeFile]: source },
      async (repositoryRoot, findFixtureViolations) => {
        await assert.rejects(
          () => findFixtureViolations(),
          new Error(
            `Extensionless regular files are not allowed in import boundary source roots: ${relativeFile}`,
          ),
        );
      },
    );
  }
});

test("allows pinned assets but rejects unreviewed executable extensions", async () => {
  await withRepositoryFixture(
    {
      "apps/web/src/react-app/main.tsx": `
        import "./styles.css";
        import iconUrl from "./icon.svg";
        import notesUrl from "./notes.txt";
        export { iconUrl, notesUrl };
      `,
      "apps/web/src/react-app/styles.css": ".safe { color: navy; }",
      "apps/web/src/react-app/icon.svg":
        '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      "apps/web/src/react-app/notes.txt": "Static notes",
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), []);
    },
  );

  for (const extension of [".astro", ".custom", ".mdx", ".svelte", ".vue"]) {
    const relativeFile = `apps/web/src/react-app/bridge${extension}`;
    await withRepositoryFixture(
      {
        [relativeFile]:
          'import { trusted } from "@exercisebook/schemas/trusted-student-projection"; export const bridge = trusted;',
      },
      async (repositoryRoot, findFixtureViolations) => {
        await assert.rejects(
          () => findFixtureViolations(),
          new Error(
            `Unreviewed regular file extensions are not allowed in import boundary source roots: ${relativeFile}`,
          ),
        );
      },
    );
  }
});

test("scans source extensions case-insensitively", async () => {
  await withRepositoryFixture(
    {
      "packages/domain/src/a.TS": 'import React from "react";',
      "packages/domain/src/b.Ts": 'import api from "hono";',
      "packages/planner/src/c.TSX":
        'export { generate } from "@exercisebook/generators";',
      "packages/schemas/src/d.jS":
        'export { generate } from "@exercisebook/generators";',
      "apps/web/src/react-app/e.JS":
        'import { generate } from "@exercisebook/generators";',
      "apps/web/src/react-app/f.MJS":
        'import document from "@exercisebook/print-document";',
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'packages/domain/src/a.TS imports forbidden dependency "react"',
        'packages/domain/src/b.Ts imports forbidden dependency "hono"',
        'packages/planner/src/c.TSX imports non-allowlisted browser workspace dependency "@exercisebook/generators"',
        'packages/schemas/src/d.jS imports non-allowlisted browser workspace dependency "@exercisebook/generators"',
        'apps/web/src/react-app/e.JS imports non-allowlisted browser workspace dependency "@exercisebook/generators"',
        'apps/web/src/react-app/f.MJS imports non-allowlisted browser workspace dependency "@exercisebook/print-document"',
      ]);
    },
  );
});

test("locks the HTML entrypoint, CSS asset graph, and Vite resolver configuration", async () => {
  await withRepositoryFixture(
    {
      "apps/web/index.html": reviewedHtmlEntrypoint,
      "apps/web/vite.config.mjs": reviewedViteConfig,
      "apps/web/src/react-app/styles.css": `/* @import url('../worker/comment-only.ts'); */
        .safe::before { content: "@import url(image-set('ignored.png'))"; }
        .safe { color: navy; }`,
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), []);
    },
  );

  await withRepositoryFixture(
    {
      "apps/web/index.html":
        '<script type="module" src="/src/react-app/main.tsx"></script><script type="module" src="/src/worker/index.ts"></script>',
    },
    async (repositoryRoot, findFixtureViolations) => {
      await assert.rejects(
        () => findFixtureViolations(),
        new Error(
          'apps/web/index.html must contain exactly one module script "/src/react-app/main.tsx" and no additional local asset references.',
        ),
      );
    },
  );

  for (const viteConfig of [
    reviewedViteConfig.replace('from "vite"', 'from "./vite-wrapper.js"'),
    reviewedViteConfig.replace(
      "export default defineConfig(",
      "const reviewed = defineConfig; export default reviewed(",
    ),
    reviewedViteConfig.replace(
      'from "./scripts/client-module-provenance.ts"',
      'from "./scripts/client-module-provenance-wrapper.ts"',
    ),
    reviewedViteConfig.replace(
      "import { clientModuleProvenance }",
      "import { clientModuleProvenance as unreviewedProvenance }",
    ),
    reviewedViteConfig.replace(
      "plugins: [react(), clientModuleProvenance(), cloudflare()]",
      "plugins: [react(), { config() {} }, clientModuleProvenance(), cloudflare()]",
    ),
    reviewedViteConfig.replace(
      "plugins: [react(), clientModuleProvenance(), cloudflare()]",
      "plugins: [react(), ...extraPlugins, clientModuleProvenance(), cloudflare()]",
    ),
    reviewedViteConfig.replace(
      "plugins: [react(), clientModuleProvenance(), cloudflare()]",
      'plugins: [react({ jsxRuntime: "classic" }), clientModuleProvenance(), cloudflare()]',
    ),
    reviewedViteConfig.replace(
      "plugins: [react(), clientModuleProvenance(), cloudflare()]",
      "plugins: [react(), clientModuleProvenance({}), cloudflare()]",
    ),
    reviewedViteConfig.replace(
      "plugins: [react(), clientModuleProvenance(), cloudflare()]",
      "plugins: [clientModuleProvenance(), react(), cloudflare()]",
    ),
    reviewedViteConfig.replace(
      "plugins: [react(), clientModuleProvenance(), cloudflare()]",
      "plugins: [react(), cloudflare(), clientModuleProvenance()]",
    ),
    reviewedViteConfig.replace(
      "plugins: [react(), clientModuleProvenance(), cloudflare()]",
      "plugins: [react(), cloudflare()]",
    ),
    reviewedViteConfig.replace(
      "plugins: [react(), clientModuleProvenance(), cloudflare()]",
      "plugins: [react(), clientModuleProvenance(), clientModuleProvenance(), cloudflare()]",
    ),
    reviewedViteConfig.replace("build: {", '["build"]: {'),
  ]) {
    await withRepositoryFixture(
      {
        "apps/web/vite.config.mjs": viteConfig,
      },
      async (repositoryRoot, findFixtureViolations) => {
        await assert.rejects(
          () => findFixtureViolations(),
          new Error(
            "apps/web/vite.config.mjs must exactly match the reviewed defineConfig/react/client-module-provenance/cloudflare configuration shape.",
          ),
        );
      },
    );
  }

  for (const [relativeFile, css] of [
    [
      "apps/web/src/react-app/styles.css",
      ".leak { background: url('../worker/index.ts'); }",
    ],
    [
      "packages/web-renderer/src/styles.css",
      ".leak { background: u\\72l('../worker/index.ts'); }",
    ],
    ["apps/web/src/react-app/import.css", "@import '../worker/trusted.css';"],
    [
      "apps/web/src/react-app/image-set.css",
      ".leak { background: image-set('trusted.png' 1x); }",
    ],
  ]) {
    await withRepositoryFixture(
      {
        [relativeFile]: css,
      },
      async (repositoryRoot, findFixtureViolations) => {
        await assert.rejects(
          () => findFixtureViolations(),
          new Error(
            `${relativeFile} may not use CSS @import or asset functions from browser-reachable styles.`,
          ),
        );
      },
    );
  }
});

test("fails closed on every unreviewed Vite style language in browser-safe roots", async () => {
  const browserStyleRoots = [
    "apps/web/src/react-app",
    "packages/web-renderer/src",
    "packages/domain/src",
    "packages/planner/src",
    "packages/schemas/src",
  ];
  const unreviewedStyleExtensions = [
    ".less",
    ".sass",
    ".scss",
    ".styl",
    ".stylus",
    ".pcss",
    ".postcss",
    ".sss",
  ];

  for (const relativeRoot of browserStyleRoots) {
    for (const extension of unreviewedStyleExtensions) {
      const relativeFile = `${relativeRoot}/unreviewed${extension}`;
      await withRepositoryFixture(
        {
          [relativeFile]: ".safe { color: navy; }",
        },
        async (repositoryRoot, findFixtureViolations) => {
          await assert.rejects(
            () => findFixtureViolations(),
            new Error(
              `${relativeFile} may not use unreviewed Vite style language ${JSON.stringify(extension)} in browser-safe source roots.`,
            ),
          );
        },
      );
    }
  }
});

test("rejects CSS Modules and ICSS dependency constructs across browser-safe roots", async () => {
  for (const [relativeFile, css] of [
    ["apps/web/src/react-app/styles.module.css", ".local { color: navy; }"],
    [
      "packages/web-renderer/src/composes.css",
      ".local { c\\6fmposes: base from './base.css'; }",
    ],
    [
      "packages/domain/src/compose-with.css",
      ".local { compose-with: base from global; }",
    ],
    ["packages/planner/src/icits.css", ':import("./tokens.css") { imported: token; }'],
    ["packages/schemas/src/value.css", '@v\\61lue token from "./tokens.css";'],
  ]) {
    await withRepositoryFixture(
      {
        [relativeFile]: css,
      },
      async (repositoryRoot, findFixtureViolations) => {
        await assert.rejects(
          () => findFixtureViolations(),
          new Error(
            relativeFile.endsWith(".module.css")
              ? `${relativeFile} may not use CSS Modules in browser-safe source roots.`
              : `${relativeFile} may not use CSS Modules or ICSS dependency constructs.`,
          ),
        );
      },
    );
  }

  await withRepositoryFixture(
    {
      "packages/domain/src/safe.css": `
        /* composes: base from "./comment.css"; */
        .safe::before {
          content: ':import("./string.css") @value token from "./string.css"';
        }
      `,
      "packages/planner/src/also-safe.css":
        '.safe::before { content: "compose-with: base from global"; }',
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), []);
    },
  );
});

test("rejects unreviewed Vite style module loads even when the target is absent", async () => {
  for (const [relativeFile, specifier] of [
    ["apps/web/src/react-app/load.ts", "./theme.pcss"],
    ["packages/web-renderer/src/load.ts", "./theme.postcss?inline"],
    ["packages/domain/src/load.ts", "./theme.scss"],
    ["packages/planner/src/load.ts", "./theme.less"],
    ["packages/schemas/src/load.ts", "./theme.module.css"],
  ]) {
    await withRepositoryFixture(
      {
        [relativeFile]: `import ${JSON.stringify(specifier)};`,
      },
      async (repositoryRoot, findFixtureViolations) => {
        assert.deepEqual(await findFixtureViolations(), [
          `${relativeFile} imports unreviewed Vite style module ${JSON.stringify(specifier)}`,
        ]);
      },
    );
  }
});

test("rejects local HTML asset-bearing edges after entity and path normalization", async () => {
  for (const assetMarkup of [
    "<link rel=icon href='/src/react-app/../worker/index.ts'>",
    '<img src="/src/worker/index.ts">',
    '<img srcset="/src/worker/a.ts 1x, /src/worker/b.ts 2x">',
    '<video poster="/src/worker/a.ts"></video>',
    '<svg><use href="/src/worker/a.ts"></use></svg>',
    '<svg><use xlink:href="/src/worker/a.ts"></use></svg>',
    '<div style="background: url(&sol;src&sol;worker&sol;a.ts)"></div>',
    `<div style='background: image-set("/src/worker/a.png" 1x)'></div>`,
    "<style>@import '/src/worker/a.css';</style>",
    '<object data="/src/worker/index.ts"></object>',
    '<link rel="preload" imagesrcset="/src/worker/a.ts 1x">',
    '<meta property="og:image" content="/src/worker/a.ts">',
    '<meta name="twitter:image" content="/src/worker/a.ts">',
    '<img src="/src/worker/a.ts" src="https://example.test/safe.png">',
    '<link rel=icon title=">" href="/src/worker/index.ts">',
    '<img/src="/src/worker/index.ts">',
    '<link/href="/src/worker/index.ts">',
    '<object/data="/src/worker/index.ts">',
    '<img///src="/src/worker/index.ts">',
    '<link rel=icon title="&quot; >" href="/src/worker/index.ts">',
    '<link rel=icon title="&#34; >" href="/src/worker/index.ts">',
    '<link rel=icon title="&#x22; >" href="/src/worker/index.ts">',
    '<link rel=icon href="&sol;src&sol;react-app&sol;&period;&period;&sol;worker&sol;index.ts">',
    '<link rel=icon href="&#47;src&#47;react-app&#47;&#46;&#46;&#47;worker&#47;index.ts">',
    '<link title="<!--" href="/src/worker/index.ts"> -->">',
    '<iframe srcdoc="&lt;script src=&quot;/src/worker/index.ts&quot;&gt;&lt;/script&gt;"></iframe>',
    '<iframe src="https://example.test/frame"></iframe>',
    '<object data="https://example.test/object"></object>',
    '<embed src="https://example.test/embed">',
    '<base href="https://example.test/">',
    '<link rel="icon" href="https://example.test/icon.svg">',
    '<meta http-equiv="refresh" content="0; url=/src/worker/index.ts">',
    '<a href="javascript:alert(1)">Unsafe</a>',
    '<a href="java&#x73;cript&colon;alert(1)">Unsafe</a>',
    '<a href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;">Unsafe</a>',
    '<a href="blob:https://exercisebook.app/unsafe">Unsafe</a>',
    '<a href="file:///src/worker/index.ts">Unsafe</a>',
    '<a href="vbscript:msgbox(1)">Unsafe</a>',
    '<a href="https://exercisebook.app/lessons/fractions/add-unlike-denominators">Not local</a>',
    '<a href="/unreviewed-path">Unreviewed</a>',
  ]) {
    await withRepositoryFixture(
      {
        "apps/web/index.html": `${reviewedHtmlEntrypoint}${assetMarkup}`,
      },
      async (repositoryRoot, findFixtureViolations) => {
        await assert.rejects(
          () => findFixtureViolations(),
          new Error(
            'apps/web/index.html must contain exactly one module script "/src/react-app/main.tsx" and no additional local asset references.',
          ),
        );
      },
    );
  }
});

test("locks browser package resolver metadata to reviewed public entrypoints", async () => {
  await withRepositoryFixture(
    {
      "apps/web/package.json": JSON.stringify(reviewedWebManifest),
      "packages/domain/package.json": JSON.stringify(reviewedDomainManifest),
      "packages/planner/package.json": JSON.stringify(reviewedPlannerManifest),
      "packages/schemas/package.json": JSON.stringify(reviewedSchemasManifest),
      "packages/web-renderer/package.json": JSON.stringify(reviewedWebRendererManifest),
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), []);
    },
  );

  for (const [relativeFile, manifest] of [
    [
      "apps/web/package.json",
      {
        name: "@exercisebook/web",
        scripts: reviewedWebScripts,
        imports: { "#trusted": "../../packages/schemas/src/worksheet-instance-v1.ts" },
      },
    ],
    [
      "packages/domain/package.json",
      {
        name: "@exercisebook/domain",
        exports: {
          ".": "../schemas/src/trusted-student-projection.ts",
          "./rational": "./src/rational.ts",
        },
      },
    ],
    [
      "packages/planner/package.json",
      {
        name: "@exercisebook/planner",
        exports: {
          ".": {
            browser: "../schemas/src/trusted-student-projection.ts",
            default: "./src/index.ts",
          },
          "./public-preview-contract": "./src/public-preview-contract.ts",
        },
      },
    ],
    [
      "packages/web-renderer/package.json",
      {
        name: "@exercisebook/web-renderer",
        exports: {
          ".": "./src/index.ts",
          "./fixtures": "./src/fixtures.ts",
          "./styles.css": ["./src/styles.css"],
        },
      },
    ],
    [
      "packages/schemas/package.json",
      {
        name: "@exercisebook/schemas",
        exports: {
          ".": "./src/index.ts",
          "./attribution-v1": "./src/attribution-v1.ts",
          "./presentation-contract-v1": "./src/presentation-contract-v1.ts",
          "./public-data": "./src/common.ts",
          "./trusted-student-projection": "./src/trusted-student-projection.ts",
          "./json-schema/content-document-v1":
            "./json-schema/content-document-v1.schema.json",
          "./json-schema/content-document-v2":
            "./json-schema/content-document-v2.schema.json",
          "./json-schema/worksheet-instance-v1":
            "./json-schema/worksheet-instance-v1.schema.json",
          "./json-schema/worksheet-instance-v2":
            "./json-schema/worksheet-instance-v2.schema.json",
        },
        browser: "./src/trusted-student-projection.ts",
      },
    ],
    [
      "packages/domain/package.json",
      {
        name: "@exercisebook/domain",
        exports: {
          ".": "./src/index.ts",
          "./rational": "./src/rational.ts",
        },
        main: "../schemas/src/trusted-student-projection.ts",
      },
    ],
    [
      "packages/planner/package.json",
      {
        name: "@exercisebook/planner",
        exports: {
          ".": "./src/index.ts",
          "./public-preview-contract": "./src/public-preview-contract.ts",
        },
        module: "../schemas/src/trusted-student-projection.ts",
      },
    ],
    [
      "packages/domain/package.json",
      {
        name: "@exercisebook/domain",
        exports: {
          ".": "./src/index.ts",
          "./rational": "./src/rational.ts",
        },
        "jsnext:main": "../schemas/src/trusted-student-projection.ts",
      },
    ],
    [
      "packages/planner/package.json",
      {
        name: "@exercisebook/planner",
        exports: {
          ".": "./src/index.ts",
          "./public-preview-contract": "./src/public-preview-contract.ts",
        },
        jsnext: "../schemas/src/trusted-student-projection.ts",
      },
    ],
  ]) {
    await withRepositoryFixture(
      {
        [relativeFile]: JSON.stringify(manifest),
      },
      async (repositoryRoot, findFixtureViolations) => {
        await assert.rejects(
          () => findFixtureViolations(),
          new Error(
            `${relativeFile} must match the reviewed browser resolver metadata policy.`,
          ),
        );
      },
    );
  }
});

test("locks web package scripts to reviewed Vite and worksheet commands", async () => {
  await withRepositoryFixture(
    {
      "apps/web/package.json": JSON.stringify(reviewedWebManifest),
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), []);
    },
  );

  const mutatedScriptPolicies = [
    {},
    {
      ...reviewedWebScripts,
      build: "vite build --config ./src/worker/vite.config.mjs",
    },
    {
      ...reviewedWebScripts,
      build: "vite build --root ./src/worker",
    },
    {
      ...reviewedWebScripts,
      dev: "NODE_OPTIONS=--require=./src/worker/bootstrap.cjs vite",
    },
    {
      ...reviewedWebScripts,
      test: "sh -c 'node ./src/worker/bootstrap.js && vitest run'",
    },
    {
      ...reviewedWebScripts,
      postinstall: "node ./src/worker/bootstrap.js",
    },
    Object.fromEntries(
      Object.entries(reviewedWebScripts).filter(
        ([scriptName]) => scriptName !== "build",
      ),
    ),
  ];
  for (const scripts of mutatedScriptPolicies) {
    await withRepositoryFixture(
      {
        "apps/web/package.json": JSON.stringify({
          ...reviewedWebManifest,
          scripts,
        }),
      },
      async (repositoryRoot, findFixtureViolations) => {
        await assert.rejects(
          () => findFixtureViolations(),
          new Error(
            "apps/web/package.json must match the reviewed web scripts policy.",
          ),
        );
      },
    );
  }

  await withRepositoryFixture(
    {
      ...reviewedStrictRepositoryFiles,
      "apps/web/package.json": JSON.stringify({
        ...JSON.parse(reviewedStrictRepositoryFiles["apps/web/package.json"]),
        scripts: {
          ...reviewedWebScripts,
          build: "vite build --config ./src/worker/vite.config.mjs",
        },
      }),
    },
    async (repositoryRoot) => {
      await assert.rejects(
        () => findImportBoundaryViolations(repositoryRoot),
        new Error("apps/web/package.json must match the reviewed web scripts policy."),
      );
    },
  );
});

test("pins every reviewed browser package manifest to its exact runtime surface", async () => {
  for (const [relativeFile, reviewedManifest] of [
    ["apps/web/package.json", reviewedWebManifest],
    ["packages/domain/package.json", reviewedDomainManifest],
    ["packages/planner/package.json", reviewedPlannerManifest],
    ["packages/schemas/package.json", reviewedSchemasManifest],
    ["packages/web-renderer/package.json", reviewedWebRendererManifest],
  ]) {
    const unreviewedDependencyManifest = {
      ...reviewedManifest,
      dependencies: {
        ...reviewedManifest.dependencies,
        "opaque-bridge": "1.0.0",
      },
    };
    await withRepositoryFixture(
      {
        [relativeFile]: JSON.stringify(unreviewedDependencyManifest),
      },
      async (repositoryRoot, findFixtureViolations) => {
        await assert.rejects(
          () => findFixtureViolations(),
          new Error(
            `${relativeFile} must match the reviewed dependency resolution policy.`,
          ),
        );
      },
    );
  }

  const movedRuntimeDependency = {
    ...reviewedPlannerManifest,
    dependencies: Object.fromEntries(
      Object.entries(reviewedPlannerManifest.dependencies).filter(
        ([packageName]) => packageName !== "zod",
      ),
    ),
    devDependencies: {
      ...reviewedPlannerManifest.devDependencies,
      zod: "4.4.3",
    },
  };
  await withRepositoryFixture(
    {
      "packages/planner/package.json": JSON.stringify(movedRuntimeDependency),
    },
    async (repositoryRoot, findFixtureViolations) => {
      await assert.rejects(
        () => findFixtureViolations(),
        new Error(
          "packages/planner/package.json must match the reviewed dependency resolution policy.",
        ),
      );
    },
  );

  for (const appsWebManifest of [
    {
      ...reviewedWebManifest,
      devDependencies: {
        ...reviewedWebManifest.devDependencies,
        vite: "9.0.0",
      },
    },
    {
      ...reviewedWebManifest,
      dependencies: {
        ...reviewedWebManifest.dependencies,
        "@exercisebook/opaque-bridge": "workspace:*",
      },
    },
  ]) {
    await withRepositoryFixture(
      {
        ...reviewedStrictRepositoryFiles,
        "apps/web/package.json": JSON.stringify(appsWebManifest),
        "packages/opaque-bridge/package.json": JSON.stringify({
          name: "@exercisebook/opaque-bridge",
          version: "0.0.0",
          private: true,
          type: "module",
          exports: { ".": "./src/index.ts" },
        }),
        "packages/opaque-bridge/src/index.ts":
          'export * from "@exercisebook/schemas/trusted-student-projection";',
      },
      async (repositoryRoot) => {
        await assert.rejects(
          () => findImportBoundaryViolations(repositoryRoot),
          new Error(
            "apps/web/package.json must match the reviewed dependency resolution policy.",
          ),
        );
      },
    );
  }
});

test("locks browser dependency specifiers and build tooling to reviewed versions", async () => {
  for (const [relativeFile, manifest] of [
    [
      "apps/web/package.json",
      {
        name: "@exercisebook/web",
        scripts: reviewedWebScripts,
        dependencies: {
          "@exercisebook/domain": "file:../../packages/bridge",
        },
      },
    ],
    [
      "apps/web/package.json",
      {
        name: "@exercisebook/web",
        scripts: reviewedWebScripts,
        dependencies: {
          react: "npm:preact@10.27.2",
        },
      },
    ],
    [
      "apps/web/package.json",
      {
        name: "@exercisebook/web",
        scripts: reviewedWebScripts,
        devDependencies: {
          "@vitejs/plugin-react": "file:../../packages/bridge",
        },
      },
    ],
    [
      "apps/web/package.json",
      {
        name: "@exercisebook/web",
        scripts: reviewedWebScripts,
        dependencies: {
          "innocent-alias": "npm:@exercisebook/domain@1.0.0",
        },
      },
    ],
    [
      "packages/planner/package.json",
      {
        name: "@exercisebook/planner",
        exports: {
          ".": "./src/index.ts",
          "./public-preview-contract": "./src/public-preview-contract.ts",
        },
        dependencies: {
          "@exercisebook/domain": "npm:@exercisebook/bridge@1.0.0",
        },
      },
    ],
    [
      "packages/schemas/package.json",
      {
        name: "@exercisebook/schemas",
        exports: {
          ".": "./src/index.ts",
          "./attribution-v1": "./src/attribution-v1.ts",
          "./presentation-contract-v1": "./src/presentation-contract-v1.ts",
          "./public-data": "./src/common.ts",
          "./trusted-student-projection": "./src/trusted-student-projection.ts",
          "./json-schema/content-document-v1":
            "./json-schema/content-document-v1.schema.json",
          "./json-schema/content-document-v2":
            "./json-schema/content-document-v2.schema.json",
          "./json-schema/worksheet-instance-v1":
            "./json-schema/worksheet-instance-v1.schema.json",
          "./json-schema/worksheet-instance-v2":
            "./json-schema/worksheet-instance-v2.schema.json",
        },
        dependencies: {
          "@exercisebook/domain": "file:../bridge",
        },
      },
    ],
  ]) {
    await withRepositoryFixture(
      {
        [relativeFile]: JSON.stringify(manifest),
      },
      async (repositoryRoot, findFixtureViolations) => {
        await assert.rejects(
          () => findFixtureViolations(),
          new Error(
            `${relativeFile} must match the reviewed dependency resolution policy.`,
          ),
        );
      },
    );
  }

  for (const rootManifest of [
    {
      name: "exercisebook",
      overrides: {
        "@exercisebook/domain": "file:packages/bridge",
      },
    },
    {
      name: "exercisebook",
      resolutions: {
        vite: "npm:malicious-vite@8.1.5",
      },
    },
    {
      name: "exercisebook",
      packageManager: "pnpm@11.8.1",
    },
    {
      name: "exercisebook",
      devDependencies: {
        vite: "npm:malicious-vite@8.1.5",
      },
    },
    {
      name: "exercisebook",
      dependencies: {
        "innocent-alias": "file:packages/bridge",
      },
    },
  ]) {
    await withRepositoryFixture(
      {
        "package.json": JSON.stringify(rootManifest),
      },
      async (repositoryRoot, findFixtureViolations) => {
        await assert.rejects(
          () => findFixtureViolations(),
          new Error(
            "package.json must match the reviewed root dependency resolution policy.",
          ),
        );
      },
    );
  }

  await withRepositoryFixture(
    {
      "pnpm-workspace.yaml": reviewedPnpmWorkspace.replace(
        "overrides:\n  esbuild: 0.28.1",
        "overrides:\n  @exercisebook/domain: file:packages/bridge\n  esbuild: 0.28.1",
      ),
    },
    async (repositoryRoot, findFixtureViolations) => {
      await assert.rejects(
        () => findFixtureViolations(),
        new Error(
          "pnpm-workspace.yaml must match the reviewed dependency resolution policy.",
        ),
      );
    },
  );

  for (const [relativeFile, source] of [
    [".pnpmfile.cjs", "module.exports = { hooks: {} };"],
    [".pnpmfile.mjs", "export const hooks = {};"],
    [".npmrc", "pnpmfile=./dependency-rewriter.cjs\n"],
  ]) {
    await withRepositoryFixture(
      {
        [relativeFile]: source,
      },
      async (repositoryRoot, findFixtureViolations) => {
        await assert.rejects(
          () => findFixtureViolations(),
          new Error(`${relativeFile} may not alter reviewed dependency resolution.`),
        );
      },
    );
  }
});

test("locks root execution scripts so the reviewed boundary gate cannot be bypassed", async () => {
  const mutatedRootScripts = [
    {
      ...reviewedRootScripts,
      build: "pnpm --filter @exercisebook/opaque-bridge build",
    },
    {
      ...reviewedRootScripts,
      check: "pnpm test",
    },
    {
      ...reviewedRootScripts,
      "check:boundaries": "node scripts/check-import-boundaries.mjs || true",
    },
    {
      ...reviewedRootScripts,
      prebuild: "node scripts/replace-vite-config.mjs",
    },
    Object.fromEntries(
      Object.entries(reviewedRootScripts).filter(
        ([scriptName]) => scriptName !== "check:boundaries",
      ),
    ),
  ];
  for (const scripts of mutatedRootScripts) {
    await withRepositoryFixture(
      {
        "package.json": JSON.stringify({
          name: "exercisebook",
          scripts,
        }),
      },
      async (repositoryRoot, findFixtureViolations) => {
        await assert.rejects(
          () => findFixtureViolations(),
          new Error(
            "package.json must match the reviewed root execution scripts policy.",
          ),
        );
      },
    );
  }

  await withRepositoryFixture(
    {
      ...reviewedStrictRepositoryFiles,
      "package.json": JSON.stringify({
        ...JSON.parse(reviewedStrictRepositoryFiles["package.json"]),
        scripts: {
          ...reviewedRootScripts,
          postinstall: "node scripts/replace-vite-config.mjs",
        },
      }),
    },
    async (repositoryRoot) => {
      await assert.rejects(
        () => findImportBoundaryViolations(repositoryRoot),
        new Error(
          "package.json must match the reviewed root execution scripts policy.",
        ),
      );
    },
  );
});

test("locks the complete root manifest and pnpm lockfile in complete repositories", async () => {
  await withRepositoryFixture(
    {
      ...reviewedStrictRepositoryFiles,
      "package.json": JSON.stringify({
        ...reviewedRootManifest,
        devDependencies: {
          ...reviewedRootManifest.devDependencies,
          "vite-wrapper": "1.0.0",
        },
      }),
    },
    async (repositoryRoot) => {
      await assert.rejects(
        () => findImportBoundaryViolations(repositoryRoot),
        new Error("package.json must exactly match the reviewed root manifest."),
      );
    },
  );

  await withRepositoryFixture(
    {
      ...reviewedStrictRepositoryFiles,
      "pnpm-lock.yaml": `${reviewedPnpmLock}\n# unreviewed resolution`,
    },
    async (repositoryRoot) => {
      await assert.rejects(
        () => findImportBoundaryViolations(repositoryRoot),
        new Error(
          "pnpm-lock.yaml must exactly match the reviewed dependency resolution.",
        ),
      );
    },
  );

  await withRepositoryFixture(
    {
      "package.json": JSON.stringify({
        name: "isolated-fixture",
        scripts: reviewedRootScripts,
      }),
    },
    async (_repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), []);
    },
  );
});

test("rejects nested package resolver scopes under browser-reachable source roots", async () => {
  for (const relativeFile of [
    "apps/web/src/react-app/package.json",
    "apps/web/src/worker/package.json",
    "packages/web-renderer/src/package.json",
    "packages/domain/src/package.json",
    "packages/planner/src/internal/package.json",
    "packages/schemas/src/package.json",
  ]) {
    await withRepositoryFixture(
      {
        [relativeFile]: JSON.stringify({
          imports: {
            "#trusted": "../../../../packages/schemas/src/worksheet-instance-v1.ts",
          },
        }),
      },
      async (repositoryRoot, findFixtureViolations) => {
        await assert.rejects(
          () => findFixtureViolations(),
          new Error(
            `${relativeFile} may not define a package resolver scope inside browser-reachable source roots.`,
          ),
        );
      },
    );
  }

  await withRepositoryFixture(
    {
      "packages/generators/src/package.json": JSON.stringify({
        imports: { "#internal": "./internal.ts" },
      }),
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), []);
    },
  );
});

test("preserves framework import guards for protected domain packages", async () => {
  await withRepositoryFixture(
    {
      "packages/domain/src/invalid.ts": 'import React from "react";',
      "packages/domain/src/cloudflare.ts":
        'import { env } from "@cloudflare/workers-types";',
      "packages/domain/src/hono-query.ts": 'import api from "hono#url";',
      "packages/domain/src/valid.ts": 'import { value } from "./value.js";',
      "packages/domain/src/react-query.ts": 'import React from "react?raw";',
      "packages/domain/src/print-query.ts":
        'import document from "@exercisebook/print-document?raw";',
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), [
        'packages/domain/src/cloudflare.ts imports forbidden dependency "@cloudflare/workers-types"',
        'packages/domain/src/hono-query.ts imports forbidden dependency "hono#url"',
        'packages/domain/src/invalid.ts imports forbidden dependency "react"',
        'packages/domain/src/print-query.ts imports forbidden dependency "@exercisebook/print-document?raw"',
        'packages/domain/src/react-query.ts imports forbidden dependency "react?raw"',
      ]);
    },
  );
});

test("ignores import-shaped text outside actual module loading syntax", async () => {
  await withRepositoryFixture(
    {
      "apps/web/src/react-app/comments.ts": `
        // import("@exercisebook/schemas/trusted-student-projection");
        const example = 'require("@exercisebook/schemas/trusted-student-projection")';
        /* export * from "@exercisebook/schemas/trusted-student-projection"; */
        const metadata = {
          from: "@exercisebook/schemas/trusted-student-projection",
        };
        const expression = /import\\("@exercisebook\\/schemas\\/trusted-student-projection"\\)/u;
        loader.import("@exercisebook/schemas/trusted-student-projection");
        loader.require("@exercisebook/schemas/trusted-student-projection");
        const documentation = \`import("@exercisebook/schemas/trusted-student-projection")\`;
        const safeUrl = new URL("./safe-image.svg", import.meta.url);
        import type { WorksheetPresentationV1 } from "@exercisebook/schemas/presentation-contract-v1";
      `,
    },
    async (repositoryRoot, findFixtureViolations) => {
      assert.deepEqual(await findFixtureViolations(), []);
    },
  );
});
