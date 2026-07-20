import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  extractModuleSpecifiers,
  findImportBoundaryViolations,
} from "./import-boundary-policy.mjs";

const actualRepositoryRoot = path.resolve(import.meta.dirname, "..");

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
    await run(repositoryRoot);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

test("rejects trusted server imports from every browser-reachable source root", async () => {
  await withRepositoryFixture(
    {
      "apps/web/src/react-app/exact.ts":
        'import { trusted } from "@exercisebook/schemas/trusted-student-projection";',
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
      "apps/web/src/shared/relative.ts":
        'export { trusted } from "../../../../packages/schemas/src/trusted-student-projection.js";',
      "apps/web/src/shared/v2-implementation.ts":
        'import { projectWorksheetV2ForStudentWithCanonicalAnswers } from "../../../../packages/schemas/src/student-worksheet-delivery-v2.js";',
      "packages/web-renderer/src/prefix.ts":
        'export * from "@exercisebook/schemas/trusted-student-projection/internal";',
      "packages/web-renderer/src/relative.ts":
        'import trusted from "../../schemas/src/trusted-student-projection.ts";',
      "packages/web-renderer/src/v1-implementation.ts":
        'import { projectWorksheetForStudentWithCanonicalAnswers } from "../../schemas/src/worksheet-instance-v1.js";',
      "packages/web-renderer/src/v2-internal-specifier.ts":
        'import { projectWorksheetV2ForStudentWithCanonicalAnswers } from "@exercisebook/schemas/src/student-worksheet-delivery-v2.js";',
      "packages/web-renderer/src/javascript-bypass.js":
        'import trusted from "@exercisebook/schemas/trusted-student-projection";',
      "packages/web-renderer/src/escaped.ts":
        'const trusted = import("@exercisebook/schemas/trusted-student-projec\\u0074ion");',
    },
    async (repositoryRoot) => {
      const violations = await findImportBoundaryViolations(repositoryRoot);

      assert.equal(violations.length, 18);
      for (const relativeFile of [
        "apps/web/src/react-app/exact.ts",
        "apps/web/src/react-app/dynamic.ts",
        "apps/web/src/react-app/template-import.ts",
        "apps/web/src/react-app/parenthesized-import.ts",
        "apps/web/src/shared/require.ts",
        "apps/web/src/shared/parenthesized-require.ts",
        "apps/web/src/shared/optional-require.ts",
        "apps/web/src/shared/import-equals.ts",
        "apps/web/src/shared/import-type.ts",
        "apps/web/src/shared/relative.ts",
        "apps/web/src/shared/template-require.ts",
        "apps/web/src/shared/v2-implementation.ts",
        "packages/web-renderer/src/prefix.ts",
        "packages/web-renderer/src/relative.ts",
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
});

test("parses every configured source in the current repository", async () => {
  assert.deepEqual(await findImportBoundaryViolations(actualRepositoryRoot), []);
});

test("keeps direct trusted imports available to the Worker server boundary", async () => {
  await withRepositoryFixture(
    {
      "apps/web/src/worker/static.ts":
        'import { trusted } from "@exercisebook/schemas/trusted-student-projection";',
      "apps/web/src/worker/dynamic.ts":
        'const trusted = import("@exercisebook/schemas/trusted-student-projection/internal");',
      "apps/web/src/worker/require.ts":
        'const trusted = require("@exercisebook/schemas/trusted-student-projection");',
      "apps/web/src/worker/relative.ts":
        'export { trusted } from "../../../../packages/schemas/src/trusted-student-projection.js";',
      "apps/web/src/worker/v2-implementation.ts":
        'import { projectWorksheetV2ForStudentWithCanonicalAnswers } from "../../../../packages/schemas/src/student-worksheet-delivery-v2.js";',
      "apps/web/src/worker/computed.ts":
        "const trusted = import(moduleSpecifier); const required = require(moduleSpecifier);",
    },
    async (repositoryRoot) => {
      assert.deepEqual(await findImportBoundaryViolations(repositoryRoot), []);
    },
  );
});

test("rejects a trusted re-export through a protected workspace package", async () => {
  await withRepositoryFixture(
    {
      "packages/generators/src/index.ts":
        'export { trusted } from "@exercisebook/schemas/trusted-student-projection";',
      "apps/web/src/react-app/leak.ts":
        'import { trusted } from "@exercisebook/generators";',
    },
    async (repositoryRoot) => {
      assert.deepEqual(await findImportBoundaryViolations(repositoryRoot), [
        'packages/generators/src/index.ts imports trusted server-only dependency "@exercisebook/schemas/trusted-student-projection"',
      ]);
    },
  );
});

test("preserves framework import guards for protected domain packages", async () => {
  await withRepositoryFixture(
    {
      "packages/domain/src/invalid.ts": 'import React from "react";',
      "packages/domain/src/cloudflare.ts":
        'import { env } from "@cloudflare/workers-types";',
      "packages/domain/src/valid.ts": 'import { value } from "./value.js";',
    },
    async (repositoryRoot) => {
      assert.deepEqual(await findImportBoundaryViolations(repositoryRoot), [
        'packages/domain/src/cloudflare.ts imports forbidden dependency "@cloudflare/workers-types"',
        'packages/domain/src/invalid.ts imports forbidden dependency "react"',
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
        import type { PublicProjection } from "@exercisebook/schemas/student-worksheet-delivery-v20";
      `,
    },
    async (repositoryRoot) => {
      assert.deepEqual(await findImportBoundaryViolations(repositoryRoot), []);
    },
  );
});
