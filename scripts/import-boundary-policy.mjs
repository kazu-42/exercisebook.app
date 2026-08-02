import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { assertReviewedInstallInput } from "./reviewed-install-inputs.mjs";

const installedLockSource = await readFile(
  path.resolve(import.meta.dirname, "../pnpm-lock.yaml"),
  "utf8",
).catch((error) => {
  if (error?.code === "ENOENT") {
    return undefined;
  }
  throw error;
});
assertReviewedInstallInput("pnpm-lock.yaml", installedLockSource);
const { parseAst } = await import("vite");

const protectedRoots = [
  "packages/content-compiler/src",
  "packages/domain/src",
  "packages/generators/src",
  "packages/planner/src",
  "packages/schemas/src",
];
const browserSafeProtectedRoots = new Set([
  "packages/domain/src",
  "packages/planner/src",
  "packages/schemas/src",
]);
const browserWorkspaceAllowlist = new Set([
  "@exercisebook/domain",
  "@exercisebook/domain/rational",
  "@exercisebook/planner",
  "@exercisebook/planner/public-preview-contract",
  "@exercisebook/schemas",
  "@exercisebook/schemas/presentation-contract-v1",
  "@exercisebook/schemas/public-data",
  "@exercisebook/web-renderer",
  "@exercisebook/web-renderer/styles.css",
]);
const browserProductionWorkspaceAllowlist = new Set([
  "@exercisebook/domain/rational",
  "@exercisebook/planner/public-preview-contract",
  "@exercisebook/schemas/presentation-contract-v1",
  "@exercisebook/schemas/public-data",
  "@exercisebook/web-renderer",
  "@exercisebook/web-renderer/styles.css",
]);
const protectedWorkspaceAllowlists = new Map([
  ["packages/domain/src", new Set()],
  ["packages/planner/src", new Set(["@exercisebook/domain", "@exercisebook/schemas"])],
  [
    "packages/schemas/src",
    new Set(["@exercisebook/domain", "@exercisebook/domain/rational"]),
  ],
]);
const browserSafeLeafDependencyAllowlists = new Map([
  ["packages/planner/src/public-preview-contract.ts", new Set()],
  ["packages/schemas/src/common.ts", new Set(["@exercisebook/domain/rational", "zod"])],
  ["packages/schemas/src/attribution-v1.ts", new Set(["./common.js", "zod"])],
  [
    "packages/schemas/src/presentation-contract-v1.ts",
    new Set([
      "@exercisebook/domain/rational",
      "./attribution-v1.js",
      "./common.js",
      "zod",
    ]),
  ],
]);
const browserReachableRoots = ["apps/web/src", "packages/web-renderer/src"];
const browserManifestPolicies = [
  {
    manifest: {
      name: "@exercisebook/web",
      version: "0.0.0",
      private: true,
      type: "module",
      scripts: {
        build: "vite build && tsx scripts/check-client-artifact-boundary.ts",
        dev: "vite",
        preview: "vite preview",
        test: "vitest run",
        typecheck: "tsc -p tsconfig.json --noEmit",
        "worksheet:sample": "tsx --tsconfig tsconfig.json scripts/write-sample.ts",
      },
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
    },
    relativeFile: "apps/web/package.json",
    sourceRoot: "apps/web/src",
  },
  {
    manifest: {
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
    },
    relativeFile: "packages/domain/package.json",
    sourceRoot: "packages/domain/src",
  },
  {
    manifest: {
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
    },
    relativeFile: "packages/planner/package.json",
    sourceRoot: "packages/planner/src",
  },
  {
    manifest: {
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
    },
    relativeFile: "packages/schemas/package.json",
    sourceRoot: "packages/schemas/src",
  },
  {
    manifest: {
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
    },
    relativeFile: "packages/web-renderer/package.json",
    sourceRoot: "packages/web-renderer/src",
  },
];
const productionRuntimeDependencyAllowlists = new Map(
  browserManifestPolicies.map((policy) => [
    policy.sourceRoot,
    new Set([
      ...Object.keys(policy.manifest.dependencies ?? {}),
      ...Object.keys(policy.manifest.peerDependencies ?? {}),
    ]),
  ]),
);
const printDocumentProductionRuntimeAllowlist = new Set([
  "@exercisebook/domain",
  "@exercisebook/schemas",
  "@exercisebook/schemas/trusted-student-projection",
]);
const htmlAssetMetaNames = new Set([
  "msapplication-tileimage",
  "msapplication-square70x70logo",
  "msapplication-square150x150logo",
  "msapplication-wide310x150logo",
  "msapplication-square310x310logo",
  "msapplication-config",
  "twitter:image",
]);
const htmlAssetMetaProperties = new Set([
  "og:image",
  "og:image:url",
  "og:image:secure_url",
  "og:audio",
  "og:audio:secure_url",
  "og:video",
  "og:video:secure_url",
]);
const browserPackageScopeRoots = [
  ...browserReachableRoots,
  ...browserSafeProtectedRoots,
];
const dependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
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
const reviewedRootScripts = {
  build: "pnpm -r --if-present build",
  check:
    "pnpm format:check && pnpm typecheck && pnpm schema:check && pnpm content:check && pnpm check:boundaries && pnpm test && pnpm build && pnpm worksheet:sample",
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
  "worksheet:verify": "node scripts/verify-sample-artifacts.mjs",
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
const reviewedWranglerMain = "./src/worker/index.ts";
const reviewedWranglerConfig = `{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "exercisebook-app",
  "main": "${reviewedWranglerMain}",
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
const forbiddenRepositoryResolverConfigs = [".npmrc", ".pnpmfile.cjs", ".pnpmfile.mjs"];
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
    relativeRoot === "." ? fileName : `${relativeRoot}/${fileName}`,
  ),
);
const implicitPostcssPackageFiles = [
  "package.json",
  "apps/package.json",
  "apps/web/package.json",
];
const forbiddenAlternateWranglerConfigs = [
  "apps/web/wrangler.json",
  "apps/web/wrangler.toml",
];
const testOnlySpecifierPrefixes = [
  "@exercisebook/test-fixtures",
  "@exercisebook/web-renderer/fixtures",
];
const additionalTestOnlyRoots = ["packages/test-fixtures/src"];
const additionalTestOnlyModules = ["packages/web-renderer/src/fixtures"];
const sourceExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const viteStyleExtensions = new Set([
  ".css",
  ".less",
  ".sass",
  ".scss",
  ".styl",
  ".stylus",
  ".pcss",
  ".postcss",
  ".sss",
]);
const unreviewedViteStyleExtensions = new Set(
  [...viteStyleExtensions].filter((extension) => extension !== ".css"),
);
// Keep this allowlist synchronized with the exact pinned Vite default asset
// surface. Other extensions fail closed because Vite import analysis can treat
// otherwise unknown files containing valid JavaScript as executable modules.
const reviewedNonExecutableSourceExtensions = new Set([
  ...viteStyleExtensions,
  ".aac",
  ".apng",
  ".avif",
  ".bmp",
  ".cur",
  ".eot",
  ".flac",
  ".gif",
  ".ico",
  ".jfif",
  ".jpg",
  ".jpeg",
  ".json",
  ".jxl",
  ".m4a",
  ".mov",
  ".mp3",
  ".mp4",
  ".ogg",
  ".opus",
  ".otf",
  ".pdf",
  ".pjp",
  ".pjpeg",
  ".png",
  ".svg",
  ".ttf",
  ".txt",
  ".vtt",
  ".wav",
  ".webm",
  ".webmanifest",
  ".webp",
  ".woff",
  ".woff2",
]);
const forbiddenImports = [
  "@cloudflare",
  "@exercisebook/print-document",
  "@exercisebook/web-renderer",
  "hono",
  "react",
  "react-dom",
  "wrangler",
];
const trustedProjectionSpecifierPrefixes = [
  "@exercisebook/schemas/trusted-student-projection",
  "@exercisebook/schemas/src/trusted-student-projection",
];
const trustedProjectionPackageSpecifier =
  "@exercisebook/schemas/trusted-student-projection";
const trustedProjectionConsumerBindings = new Set([
  "PreparedStudentVisibleAnswerGuard",
  "StudentWorksheetProjectionV1",
  "StudentWorksheetProjectionV2",
  "prepareStudentVisibleAnswerGuard",
  "projectWorksheetForStudentWithCanonicalAnswers",
  "projectWorksheetV2ForStudentWithCanonicalAnswers",
]);
const preparedAnswerGuardBindings = new Set([
  "PreparedStudentVisibleAnswerGuard",
  "prepareStudentVisibleAnswerGuard",
]);
const preparedAnswerGuardInternalConsumer =
  "packages/schemas/src/student-worksheet-delivery-v2.ts";
const preparedAnswerGuardInternalSpecifier = "./worksheet-instance-v1.js";
const mixedSchemaModulePolicies = [
  {
    safeBindings: new Set([
      "AttributionV1",
      "AttributionV1Schema",
      "CanonicalRationalValue",
      "FractionAdditionPromptV1",
      "FractionAdditionPromptV1Schema",
      "HintV1Schema",
      "MaterializedWorksheetInstanceV1",
      "MisconceptionV1Schema",
      "PrintFallbackV1Schema",
      "RNG_ALGORITHM_V1",
      "SlotProvenanceV1Schema",
      "SolutionStepV1",
      "SolutionStepV1Schema",
      "StudentWorksheetDeliveryV1",
      "StudentWorksheetDeliveryV1Schema",
      "StudentWorksheetSlotV1Schema",
      "WORKSHEET_DELIVERY_V1_SCHEMA",
      "WORKSHEET_INSTANCE_V1_SCHEMA",
      "WorksheetInstanceV1",
      "WorksheetInstanceV1Schema",
      "WorksheetSlotV1",
      "WorksheetSlotV1Schema",
      "assertStudentVisibleDataHasNoRecognizedCanonicalAnswers",
      "deriveFractionAdditionAccessibilitySummary",
      "deriveFractionAdditionPromptAccessibleText",
      "projectWorksheetForStudent",
      "validateStudentWorksheetDeliveryV1",
      "validateWorksheetInstanceV1",
    ]),
    sourceModules: ["packages/schemas/src/worksheet-instance-v1"],
    specifierPrefixes: [
      "@exercisebook/schemas/src/worksheet-instance-v1",
      "@exercisebook/schemas/worksheet-instance-v1",
    ],
  },
  {
    safeBindings: new Set([
      "StudentWorksheetDeliveryV2",
      "StudentWorksheetDeliveryV2Schema",
      "StudentWorksheetSlotV2",
      "StudentWorksheetSlotV2Schema",
      "WORKSHEET_DELIVERY_V2_SCHEMA",
      "projectWorksheetV2ForStudent",
      "validateStudentWorksheetDeliveryV2",
    ]),
    sourceModules: ["packages/schemas/src/student-worksheet-delivery-v2"],
    specifierPrefixes: [
      "@exercisebook/schemas/src/student-worksheet-delivery-v2",
      "@exercisebook/schemas/student-worksheet-delivery-v2",
    ],
  },
];
const trustedImplementationSpecifierPrefixes = mixedSchemaModulePolicies.flatMap(
  (policy) => policy.specifierPrefixes,
);
const trustedServerSpecifierPrefixes = [
  ...trustedProjectionSpecifierPrefixes,
  ...trustedImplementationSpecifierPrefixes,
];
const trustedProjectionSourceModules = [
  "packages/schemas/src/trusted-student-projection",
];
const trustedImplementationSourceModules = mixedSchemaModulePolicies.flatMap(
  (policy) => policy.sourceModules,
);
const trustedServerSourceModules = [
  ...trustedProjectionSourceModules,
  ...trustedImplementationSourceModules,
];
const transparentExpressionTypes = new Set([
  "ChainExpression",
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);

async function collectSourceFiles(
  directory,
  repositoryRoot,
  allowedExtensions = sourceExtensions,
  rejectUnreviewedRegularFiles = false,
) {
  const directoryStats = await lstat(directory).catch((error) => {
    if (error?.code === "ENOENT") {
      return undefined;
    }

    throw error;
  });
  if (directoryStats === undefined) {
    return [];
  }
  if (directoryStats.isSymbolicLink()) {
    const relativePath = path
      .relative(repositoryRoot, directory)
      .split(path.sep)
      .join("/");
    throw new Error(
      `Symbolic links are not allowed in import boundary source roots: ${relativePath}`,
    );
  }

  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") {
      return [];
    }

    throw error;
  });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));

  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isSymbolicLink()) {
      const relativePath = path
        .relative(repositoryRoot, absolutePath)
        .split(path.sep)
        .join("/");
      throw new Error(
        `Symbolic links are not allowed in import boundary source roots: ${relativePath}`,
      );
    }
    if (entry.isDirectory()) {
      files.push(
        ...(await collectSourceFiles(
          absolutePath,
          repositoryRoot,
          allowedExtensions,
          rejectUnreviewedRegularFiles,
        )),
      );
    } else if (
      entry.isFile() &&
      rejectUnreviewedRegularFiles &&
      path.extname(entry.name) === ""
    ) {
      const relativePath = path
        .relative(repositoryRoot, absolutePath)
        .split(path.sep)
        .join("/");
      throw new Error(
        `Extensionless regular files are not allowed in import boundary source roots: ${relativePath}`,
      );
    } else if (
      entry.isFile() &&
      rejectUnreviewedRegularFiles &&
      !allowedExtensions.has(path.extname(entry.name).toLowerCase()) &&
      !reviewedNonExecutableSourceExtensions.has(path.extname(entry.name).toLowerCase())
    ) {
      const relativePath = path
        .relative(repositoryRoot, absolutePath)
        .split(path.sep)
        .join("/");
      throw new Error(
        `Unreviewed regular file extensions are not allowed in import boundary source roots: ${relativePath}`,
      );
    } else if (
      entry.isFile() &&
      allowedExtensions.has(path.extname(entry.name).toLowerCase())
    ) {
      files.push(absolutePath);
    }
  }

  return files;
}

function parserLanguage(sourceFile) {
  const normalizedSourceFile = sourceFile.toLowerCase();
  if (normalizedSourceFile.endsWith(".tsx")) {
    return "tsx";
  }
  if (
    normalizedSourceFile.endsWith(".ts") ||
    /\.(?:c|m)ts$/u.test(normalizedSourceFile)
  ) {
    return "ts";
  }
  if (normalizedSourceFile.endsWith(".jsx")) {
    return "jsx";
  }
  return "js";
}

function staticStringValue(node) {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (
    node?.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0]?.value.cooked ?? undefined;
  }
  if (
    node !== null &&
    typeof node === "object" &&
    transparentExpressionTypes.has(node.type)
  ) {
    return staticStringValue(node.expression);
  }
  return undefined;
}

function unwrapTransparentExpression(node) {
  let expression = node;
  while (
    expression !== null &&
    typeof expression === "object" &&
    transparentExpressionTypes.has(expression.type)
  ) {
    expression = expression.expression;
  }
  return expression;
}

function importMetaGlobLoadKind(callee) {
  const member = unwrapTransparentExpression(callee);
  if (member?.type !== "MemberExpression") {
    return undefined;
  }

  const object = unwrapTransparentExpression(member.object);
  if (
    object?.type !== "MetaProperty" ||
    object.meta?.type !== "Identifier" ||
    object.meta.name !== "import" ||
    object.property?.type !== "Identifier" ||
    object.property.name !== "meta"
  ) {
    return undefined;
  }

  const propertyName = member.computed
    ? staticStringValue(member.property)
    : member.property?.type === "Identifier"
      ? member.property.name
      : undefined;
  return propertyName === "glob" || propertyName === "globEager"
    ? `import.meta.${propertyName}()`
    : undefined;
}

function isImportMetaUrl(node) {
  const member = unwrapTransparentExpression(node);
  if (member?.type !== "MemberExpression") {
    return false;
  }
  const object = unwrapTransparentExpression(member.object);
  if (
    object?.type !== "MetaProperty" ||
    object.meta?.type !== "Identifier" ||
    object.meta.name !== "import" ||
    object.property?.type !== "Identifier" ||
    object.property.name !== "meta"
  ) {
    return false;
  }
  const propertyName = member.computed
    ? staticStringValue(member.property)
    : member.property?.type === "Identifier"
      ? member.property.name
      : undefined;
  return propertyName === "url";
}

function isAstNode(value) {
  return value !== null && typeof value === "object" && typeof value.type === "string";
}

function parseSourceAst(source, sourceFile) {
  try {
    return parseAst(
      source,
      {
        lang: parserLanguage(sourceFile),
        preserveParens: false,
        sourceType: "unambiguous",
      },
      sourceFile,
    );
  } catch (error) {
    throw new Error(`Could not parse ${sourceFile} for import boundary analysis.`, {
      cause: error,
    });
  }
}

function decodeHtmlEntities(source) {
  const namedEntities = new Map([
    ["amp", "&"],
    ["apos", "'"],
    ["colon", ":"],
    ["gt", ">"],
    ["lt", "<"],
    ["newline", "\n"],
    ["num", "#"],
    ["period", "."],
    ["quest", "?"],
    ["quot", '"'],
    ["sol", "/"],
    ["tab", "\t"],
  ]);
  return source.replace(
    /&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z][a-z0-9]+));?/giu,
    (entity, hex, decimal, named) => {
      if (hex !== undefined || decimal !== undefined) {
        const codePoint = Number.parseInt(hex ?? decimal, hex === undefined ? 10 : 16);
        return Number.isSafeInteger(codePoint) &&
          codePoint >= 0 &&
          codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : entity;
      }
      return namedEntities.get(named.toLowerCase()) ?? entity;
    },
  );
}

function htmlAttributes(source) {
  const attributesSource = source.replace(/\s+\/\s*$/u, "");
  if (/(?:^|\s)\/+(?=[^\s/])/u.test(attributesSource)) {
    return undefined;
  }
  const attributes = new Map();
  const attributePattern =
    /(?:^|\s)([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
  let consumed = 0;
  for (const match of attributesSource.matchAll(attributePattern)) {
    if (attributesSource.slice(consumed, match.index).trim() !== "") {
      return undefined;
    }
    const name = match[1].toLowerCase();
    if (attributes.has(name)) {
      return undefined;
    }
    attributes.set(name, decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? ""));
    consumed = match.index + match[0].length;
  }
  if (attributesSource.slice(consumed).trim() !== "") {
    return undefined;
  }
  return attributes;
}

function htmlOpeningTags(source) {
  const tags = [];
  for (let offset = 0; offset < source.length; offset += 1) {
    if (
      source[offset] !== "<" ||
      source[offset + 1] === "/" ||
      source[offset + 1] === "!" ||
      source[offset + 1] === "?"
    ) {
      continue;
    }
    const opening = /^<([a-z][\w:-]*)\b/iu.exec(source.slice(offset));
    if (opening === null) {
      continue;
    }
    const attributesStart = offset + opening[0].length;
    let quote;
    let tagEnd;
    for (let cursor = attributesStart; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (quote !== undefined) {
        if (character === quote) {
          quote = undefined;
        }
      } else if (character === "'" || character === '"') {
        quote = character;
      } else if (character === ">") {
        tagEnd = cursor;
        break;
      } else if (character === "<") {
        return undefined;
      }
    }
    if (tagEnd === undefined || quote !== undefined) {
      return undefined;
    }
    tags.push({
      attributes: htmlAttributes(source.slice(attributesStart, tagEnd)),
      name: opening[1].toLowerCase(),
    });
    offset = tagEnd;
  }
  return tags;
}

function localHtmlUrlPath(value) {
  const candidate = value.trim();
  if (
    candidate === "" ||
    /^[a-z][a-z0-9+.-]*:/iu.test(candidate) ||
    candidate.startsWith("//")
  ) {
    return undefined;
  }
  try {
    const parsed = new URL(candidate, "https://exercisebook.invalid/");
    return parsed.origin === "https://exercisebook.invalid"
      ? parsed.pathname
      : undefined;
  } catch {
    return "__invalid_local_url__";
  }
}

function htmlSrcsetHasLocalUrl(value) {
  return value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/u)[0] ?? "")
    .some((candidate) => localHtmlUrlPath(candidate) !== undefined);
}

function hasExactHtmlAttributes(attributes, expectedAttributes) {
  const entries = Object.entries(expectedAttributes);
  return (
    attributes.size === entries.length &&
    entries.every(([name, value]) => attributes.get(name) === value)
  );
}

function isReviewedHtmlTag(tag) {
  switch (tag.name) {
    case "html":
      return hasExactHtmlAttributes(tag.attributes, { lang: "en" });
    case "head":
    case "title":
    case "body":
    case "p":
    case "h1":
      return tag.attributes.size === 0;
    case "meta": {
      if (hasExactHtmlAttributes(tag.attributes, { charset: "UTF-8" })) {
        return true;
      }
      return (
        tag.attributes.size === 2 &&
        tag.attributes.has("name") &&
        tag.attributes.has("content") &&
        new Set(["viewport", "description", "theme-color"]).has(
          tag.attributes.get("name").trim().toLowerCase(),
        ) &&
        tag.attributes.get("content").trim() !== ""
      );
    }
    case "link":
      return hasExactHtmlAttributes(tag.attributes, {
        rel: "canonical",
        href: "https://exercisebook.app/",
      });
    case "div":
      return hasExactHtmlAttributes(tag.attributes, { id: "root" });
    case "header":
      return hasExactHtmlAttributes(tag.attributes, {
        class: "static-header",
      });
    case "a": {
      const href = tag.attributes.get("href");
      if (href === "/lessons/fractions/add-unlike-denominators") {
        return tag.attributes.size === 1;
      }
      return (
        href === "/" &&
        tag.attributes.size === 2 &&
        tag.attributes.has("aria-label") &&
        tag.attributes.get("aria-label").trim() !== ""
      );
    }
    case "main":
      return hasExactHtmlAttributes(tag.attributes, {
        class: "static-fallback",
      });
    case "section":
      return hasExactHtmlAttributes(tag.attributes, {
        "aria-labelledby": "static-fraction-title",
      });
    case "h2":
      return hasExactHtmlAttributes(tag.attributes, {
        id: "static-fraction-title",
      });
    case "script":
      return hasExactHtmlAttributes(tag.attributes, {
        type: "module",
        src: "/src/react-app/main.tsx",
      });
    default:
      return false;
  }
}

function hasForbiddenHtmlUrlScheme(value) {
  return /^(?:javascript|data|blob|file|vbscript):/iu.test(
    value.replace(/[\u0000-\u0020]/gu, ""),
  );
}

function assertWebHtmlEntrypoint(source, sourceFile) {
  const error = new Error(
    `${sourceFile} must contain exactly one module script "/src/react-app/main.tsx" and no additional local asset references.`,
  );
  const doctype = /^\s*<!doctype html>/iu.exec(source);
  if (doctype === null || /<!--|-->|<!|<\?/u.test(source.slice(doctype[0].length))) {
    throw error;
  }
  const tags = htmlOpeningTags(source);
  if (tags === undefined || tags.some((tag) => tag.attributes === undefined)) {
    throw error;
  }
  const scripts = tags.filter((tag) => tag.name === "script");
  if (scripts.length !== 1) {
    throw error;
  }
  const script = scripts[0];
  if (
    script.attributes.size !== 2 ||
    script.attributes.get("type")?.toLowerCase() !== "module" ||
    script.attributes.get("src") !== "/src/react-app/main.tsx"
  ) {
    throw error;
  }

  for (const tag of tags) {
    if (
      !isReviewedHtmlTag(tag) ||
      [...tag.attributes.values()].some(hasForbiddenHtmlUrlScheme)
    ) {
      throw error;
    }
    for (const attributeName of ["src", "poster", "href", "xlink:href"]) {
      const value = tag.attributes.get(attributeName);
      if (value === undefined || localHtmlUrlPath(value) === undefined) {
        continue;
      }
      if (
        tag.name === "script" &&
        attributeName === "src" &&
        value === "/src/react-app/main.tsx"
      ) {
        continue;
      }
      if (tag.name === "a" && attributeName === "href") {
        continue;
      }
      throw error;
    }

    for (const attributeName of ["srcset", "imagesrcset"]) {
      const value = tag.attributes.get(attributeName);
      if (value !== undefined && htmlSrcsetHasLocalUrl(value)) {
        throw error;
      }
    }
    if (
      tag.name === "object" &&
      tag.attributes.has("data") &&
      localHtmlUrlPath(tag.attributes.get("data")) !== undefined
    ) {
      throw error;
    }
    const metaName = tag.attributes.get("name")?.trim().toLowerCase();
    const metaProperty = tag.attributes.get("property")?.trim().toLowerCase();
    const metaContent = tag.attributes.get("content");
    if (
      tag.name === "meta" &&
      metaContent !== undefined &&
      (htmlAssetMetaNames.has(metaName) || htmlAssetMetaProperties.has(metaProperty)) &&
      localHtmlUrlPath(metaContent) !== undefined
    ) {
      throw error;
    }
    const inlineStyle = tag.attributes.get("style");
    if (inlineStyle !== undefined) {
      try {
        assertCssHasNoAssetUrls(inlineStyle, `${sourceFile} inline style`);
      } catch {
        throw error;
      }
    }
  }

  const styleBlocks = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/giu)];
  if (styleBlocks.length !== tags.filter((tag) => tag.name === "style").length) {
    throw error;
  }
  for (const styleBlock of styleBlocks) {
    try {
      assertCssHasNoAssetUrls(styleBlock[1], `${sourceFile} inline style`);
    } catch {
      throw error;
    }
  }
}

function isExactImport(node, source, specifierType, importedName, localName) {
  if (
    node?.type !== "ImportDeclaration" ||
    node.source?.value !== source ||
    node.specifiers?.length !== 1
  ) {
    return false;
  }
  const specifier = node.specifiers[0];
  return (
    specifier.type === specifierType &&
    specifier.local?.name === localName &&
    (specifierType !== "ImportSpecifier" || specifier.imported?.name === importedName)
  );
}

function isPlainProperty(property, name) {
  return (
    property?.type === "Property" &&
    property.kind === "init" &&
    !property.computed &&
    !property.method &&
    !property.shorthand &&
    property.key?.type === "Identifier" &&
    property.key.name === name
  );
}

function isZeroArgumentCall(node, calleeName) {
  return (
    node?.type === "CallExpression" &&
    !node.optional &&
    node.callee?.type === "Identifier" &&
    node.callee.name === calleeName &&
    node.arguments.length === 0
  );
}

function assertReviewedViteConfig(source, sourceFile) {
  const error = new Error(
    `${sourceFile} must exactly match the reviewed defineConfig/react/client-module-provenance/cloudflare configuration shape.`,
  );
  const ast = parseSourceAst(source, sourceFile);
  if (
    ast.body.length !== 5 ||
    !isExactImport(
      ast.body[0],
      "@cloudflare/vite-plugin",
      "ImportSpecifier",
      "cloudflare",
      "cloudflare",
    ) ||
    !isExactImport(
      ast.body[1],
      "@vitejs/plugin-react",
      "ImportDefaultSpecifier",
      undefined,
      "react",
    ) ||
    !isExactImport(
      ast.body[2],
      "vite",
      "ImportSpecifier",
      "defineConfig",
      "defineConfig",
    ) ||
    !isExactImport(
      ast.body[3],
      "./scripts/client-module-provenance.ts",
      "ImportSpecifier",
      "clientModuleProvenance",
      "clientModuleProvenance",
    ) ||
    ast.body[4]?.type !== "ExportDefaultDeclaration"
  ) {
    throw error;
  }

  const declaration = unwrapTransparentExpression(ast.body[4].declaration);
  const config = unwrapTransparentExpression(declaration?.arguments?.[0]);
  if (
    declaration?.type !== "CallExpression" ||
    declaration.optional ||
    declaration.callee?.type !== "Identifier" ||
    declaration.callee.name !== "defineConfig" ||
    declaration.arguments.length !== 1 ||
    config?.type !== "ObjectExpression" ||
    config.properties.length !== 2
  ) {
    throw error;
  }

  const [pluginsProperty, buildProperty] = config.properties;
  const plugins = pluginsProperty?.value;
  const build = buildProperty?.value;
  if (
    !isPlainProperty(pluginsProperty, "plugins") ||
    plugins?.type !== "ArrayExpression" ||
    plugins.elements.length !== 3 ||
    !isZeroArgumentCall(plugins.elements[0], "react") ||
    !isZeroArgumentCall(plugins.elements[1], "clientModuleProvenance") ||
    !isZeroArgumentCall(plugins.elements[2], "cloudflare") ||
    !isPlainProperty(buildProperty, "build") ||
    build?.type !== "ObjectExpression" ||
    build.properties.length !== 2
  ) {
    throw error;
  }

  const [sourcemapProperty, targetProperty] = build.properties;
  if (
    !isPlainProperty(sourcemapProperty, "sourcemap") ||
    sourcemapProperty.value?.type !== "Literal" ||
    sourcemapProperty.value.value !== false ||
    !isPlainProperty(targetProperty, "target") ||
    targetProperty.value?.type !== "Literal" ||
    targetProperty.value.value !== "es2024"
  ) {
    throw error;
  }
}

function cssOutsideCommentsAndStrings(source, sourceFile) {
  let executableCss = "";
  let state = "code";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];
    if (state === "comment") {
      if (character === "*" && nextCharacter === "/") {
        executableCss += "  ";
        index += 1;
        state = "code";
      } else {
        executableCss += character === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (state === "single-quote" || state === "double-quote") {
      if (character === "\\") {
        executableCss += " ";
        if (nextCharacter !== undefined) {
          executableCss += nextCharacter === "\n" ? "\n" : " ";
          index += 1;
        }
      } else if (
        (state === "single-quote" && character === "'") ||
        (state === "double-quote" && character === '"')
      ) {
        executableCss += " ";
        state = "code";
      } else {
        executableCss += character === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      executableCss += "  ";
      index += 1;
      state = "comment";
    } else if (character === "'") {
      executableCss += " ";
      state = "single-quote";
    } else if (character === '"') {
      executableCss += " ";
      state = "double-quote";
    } else {
      executableCss += character;
    }
  }
  if (state !== "code") {
    throw new Error(
      `${sourceFile} contains an unterminated CSS comment or string during import boundary analysis.`,
    );
  }
  return executableCss;
}

function assertCssHasNoAssetUrls(source, sourceFile) {
  const executableCss = cssOutsideCommentsAndStrings(source, sourceFile)
    .replace(/\\([0-9a-f]{1,6})\s?/giu, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/\\(.)/gsu, "$1");
  if (
    /@\s*import\b/iu.test(executableCss) ||
    /(?:^|[^a-z0-9_-])(?:url|image-set|-webkit-image-set)\s*\(/iu.test(executableCss)
  ) {
    throw new Error(
      `${sourceFile} may not use CSS @import or asset functions from browser-reachable styles.`,
    );
  }
  if (
    /\b(?:composes|compose-with)\s*:/iu.test(executableCss) ||
    /:\s*import\s*\(/iu.test(executableCss) ||
    /@\s*value\b[^;{}]*\bfrom\b/iu.test(executableCss)
  ) {
    throw new Error(
      `${sourceFile} may not use CSS Modules or ICSS dependency constructs.`,
    );
  }
}

function parseJsonObject(source, error) {
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch {
    throw error;
  }
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw error;
  }
  return manifest;
}

function hasReviewedDependencyPins(
  manifest,
  dependencyPins,
  enforceRequiredPins,
  requireWorkspaceProtocol,
) {
  const sections = new Map();
  for (const sectionName of dependencySections) {
    const section = manifest[sectionName];
    if (section === undefined) {
      continue;
    }
    if (section === null || typeof section !== "object" || Array.isArray(section)) {
      return false;
    }
    sections.set(sectionName, section);
    for (const [packageName, version] of Object.entries(section)) {
      if (typeof version !== "string") {
        return false;
      }
      if (requireWorkspaceProtocol && packageName.startsWith("@exercisebook/")) {
        if (version !== "workspace:*") {
          return false;
        }
        continue;
      }
      if (/^(?:file|link|npm|portal|workspace):/iu.test(version)) {
        return false;
      }
    }
  }

  for (const [expectedSection, expectedPackages] of Object.entries(
    dependencyPins ?? {},
  )) {
    for (const [packageName, expectedVersion] of Object.entries(expectedPackages)) {
      let found = false;
      for (const [sectionName, section] of sections) {
        if (!Object.hasOwn(section, packageName)) {
          continue;
        }
        if (
          sectionName !== expectedSection ||
          section[packageName] !== expectedVersion
        ) {
          return false;
        }
        found = true;
      }
      if (enforceRequiredPins && !found) {
        return false;
      }
    }
  }
  return true;
}

function assertReviewedBrowserManifest(source, policy) {
  const resolverError = new Error(
    `${policy.relativeFile} must match the reviewed browser resolver metadata policy.`,
  );
  const manifest = parseJsonObject(source, resolverError);
  const reviewedManifest = policy.manifest;
  if (
    manifest.name !== reviewedManifest.name ||
    !isDeepStrictEqual(manifest.exports, reviewedManifest.exports) ||
    ["imports", "browser", "main", "module", "jsnext:main", "jsnext"].some((field) =>
      Object.hasOwn(manifest, field),
    )
  ) {
    throw resolverError;
  }
  if (
    dependencySections.some(
      (sectionName) =>
        !isDeepStrictEqual(manifest[sectionName], reviewedManifest[sectionName]),
    )
  ) {
    throw new Error(
      `${policy.relativeFile} must match the reviewed dependency resolution policy.`,
    );
  }
  if (
    policy.relativeFile === "apps/web/package.json" &&
    !isDeepStrictEqual(manifest.scripts, reviewedManifest.scripts)
  ) {
    throw new Error(
      "apps/web/package.json must match the reviewed web scripts policy.",
    );
  }
  if (!isDeepStrictEqual(manifest, reviewedManifest)) {
    throw new Error(
      `${policy.relativeFile} must exactly match the reviewed package manifest policy.`,
    );
  }
}

function assertReviewedRootManifest(source, enforceRequiredPins) {
  const error = new Error(
    "package.json must match the reviewed root dependency resolution policy.",
  );
  const manifest = parseJsonObject(source, error);
  if (enforceRequiredPins) {
    if (!isDeepStrictEqual(manifest.scripts, reviewedRootScripts)) {
      throw new Error(
        "package.json must match the reviewed root execution scripts policy.",
      );
    }
    if (!isDeepStrictEqual(manifest, reviewedRootManifest)) {
      throw new Error("package.json must exactly match the reviewed root manifest.");
    }
    return;
  }
  if (
    ["overrides", "resolutions", "pnpm"].some((field) =>
      Object.hasOwn(manifest, field),
    ) ||
    ((enforceRequiredPins || Object.hasOwn(manifest, "packageManager")) &&
      manifest.packageManager !== "pnpm@11.8.0") ||
    !hasReviewedDependencyPins(
      manifest,
      { devDependencies: { vite: "8.1.5" } },
      enforceRequiredPins,
      false,
    )
  ) {
    throw error;
  }
  if (!isDeepStrictEqual(manifest.scripts, reviewedRootScripts)) {
    throw new Error(
      "package.json must match the reviewed root execution scripts policy.",
    );
  }
}

function assertReviewedPnpmLock(source) {
  try {
    assertReviewedInstallInput("pnpm-lock.yaml", source);
  } catch {
    throw new Error(
      "pnpm-lock.yaml must exactly match the reviewed dependency resolution.",
    );
  }
}

function assertReviewedPnpmWorkspace(source) {
  if (source.replace(/\r\n?/gu, "\n") !== reviewedPnpmWorkspace) {
    throw new Error(
      "pnpm-workspace.yaml must match the reviewed dependency resolution policy.",
    );
  }
}

function assertReviewedWranglerConfig(source) {
  if (source !== reviewedWranglerConfig) {
    throw new Error(
      "apps/web/wrangler.jsonc must exactly match the reviewed Cloudflare entrypoint configuration.",
    );
  }
  return reviewedWranglerMain;
}

function workerRootFromWranglerMain(main) {
  const workerEntrypoint = path.posix.normalize(path.posix.join("apps/web", main));
  if (
    !main.startsWith("./") ||
    !workerEntrypoint.startsWith("apps/web/src/") ||
    path.posix.basename(workerEntrypoint) !== "index.ts"
  ) {
    throw new Error(
      "apps/web/wrangler.jsonc must define the reviewed Worker source entrypoint.",
    );
  }
  return path.posix.dirname(workerEntrypoint);
}

function moduleBindingName(node) {
  if (node?.type === "Identifier") {
    return node.name;
  }
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  return undefined;
}

function extractModuleLoads(source, sourceFile = "source.tsx") {
  const ast = parseSourceAst(source, sourceFile);
  const moduleLoads = [];
  function requireStaticSpecifier(node, loadKind) {
    const specifier = staticStringValue(node);
    if (specifier === undefined) {
      throw new Error(
        `Non-static ${loadKind} is not allowed in ${sourceFile} at offset ${node?.start ?? "unknown"}.`,
      );
    }
    if (specifier.includes("\\")) {
      throw new Error(
        `Backslashes are not allowed in static module or asset specifiers in ${sourceFile} at offset ${node?.start ?? "unknown"}.`,
      );
    }
    return specifier;
  }

  function requireStaticGlobSpecifiers(node, loadKind) {
    const expression = unwrapTransparentExpression(node);
    if (expression?.type !== "ArrayExpression") {
      return [requireStaticSpecifier(expression, loadKind)];
    }

    return expression.elements.map((element) =>
      requireStaticSpecifier(element, loadKind),
    );
  }

  function visit(node) {
    switch (node.type) {
      case "ExportAllDeclaration": {
        const specifier = requireStaticSpecifier(node.source, "export");
        if (specifier !== undefined) {
          moduleLoads.push({
            bindings: ["*"],
            kind: "static",
            operation: "exports",
            specifier,
          });
        }
        break;
      }
      case "ExportNamedDeclaration": {
        const specifier =
          node.source === null
            ? undefined
            : requireStaticSpecifier(node.source, "export");
        if (specifier !== undefined) {
          const aliasedBindings = node.specifiers
            .filter(
              (exported) =>
                moduleBindingName(exported.local) !==
                moduleBindingName(exported.exported),
            )
            .map((exported) => moduleBindingName(exported.local))
            .filter((binding) => binding !== undefined);
          moduleLoads.push({
            aliasedBindings,
            bindings: node.specifiers
              .map((exported) => moduleBindingName(exported.local))
              .filter((binding) => binding !== undefined),
            kind: "static",
            operation: "exports",
            specifier,
          });
        }
        break;
      }
      case "ImportDeclaration": {
        const specifier = requireStaticSpecifier(node.source, "import");
        if (specifier !== undefined) {
          const aliasedBindings = node.specifiers
            .filter(
              (imported) =>
                imported.type === "ImportSpecifier" &&
                moduleBindingName(imported.imported) !==
                  moduleBindingName(imported.local),
            )
            .map((imported) => moduleBindingName(imported.imported))
            .filter((binding) => binding !== undefined);
          moduleLoads.push({
            aliasedBindings,
            bindings: node.specifiers
              .map((imported) => {
                if (imported.type === "ImportNamespaceSpecifier") {
                  return "*";
                }
                if (imported.type === "ImportSpecifier") {
                  return moduleBindingName(imported.imported);
                }
                return "default";
              })
              .filter((binding) => binding !== undefined),
            kind: "static",
            operation: "imports",
            specifier,
          });
        }
        break;
      }
      case "ImportExpression": {
        const specifier = requireStaticSpecifier(node.source, "import()");
        if (specifier !== undefined) {
          moduleLoads.push({
            bindings: ["*"],
            kind: "static",
            operation: "loads",
            specifier,
          });
        }
        break;
      }
      case "NewExpression": {
        const callee = unwrapTransparentExpression(node.callee);
        if (
          callee?.type === "Identifier" &&
          callee.name === "URL" &&
          isImportMetaUrl(node.arguments[1])
        ) {
          const specifier = requireStaticSpecifier(
            node.arguments[0],
            "new URL(..., import.meta.url)",
          );
          if (specifier !== undefined) {
            moduleLoads.push({
              bindings: ["*"],
              kind: "asset-url",
              operation: "loads",
              specifier,
            });
          }
        }
        break;
      }
      case "CallExpression": {
        const globLoadKind = importMetaGlobLoadKind(node.callee);
        if (globLoadKind !== undefined) {
          if (node.arguments.length > 2) {
            throw new Error(
              `${globLoadKind} accepts at most two arguments in ${sourceFile} at offset ${node.start}.`,
            );
          }
          for (const specifier of requireStaticGlobSpecifiers(
            node.arguments[0],
            globLoadKind,
          )) {
            moduleLoads.push({
              bindings: ["*"],
              kind: "vite-glob",
              operation: "loads",
              specifier,
            });
          }
        } else if (
          node.callee?.type === "Identifier" &&
          node.callee.name === "require"
        ) {
          const specifier = requireStaticSpecifier(node.arguments[0], "require()");
          if (specifier !== undefined) {
            moduleLoads.push({
              bindings: ["*"],
              kind: "static",
              operation: "loads",
              specifier,
            });
          }
        }
        break;
      }
      case "TSExternalModuleReference": {
        const specifier = requireStaticSpecifier(
          node.expression,
          "TypeScript external module reference",
        );
        if (specifier !== undefined) {
          moduleLoads.push({
            bindings: ["*"],
            kind: "static",
            operation: "loads",
            specifier,
          });
        }
        break;
      }
      case "TSImportType": {
        const specifier = requireStaticSpecifier(node.source, "TypeScript import type");
        if (specifier !== undefined) {
          moduleLoads.push({
            bindings: [moduleBindingName(node.qualifier) ?? "*"],
            kind: "static",
            operation: "loads",
            specifier,
          });
        }
        break;
      }
      default:
        break;
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          if (isAstNode(child)) {
            visit(child);
          }
        }
      } else if (isAstNode(value)) {
        visit(value);
      }
    }
  }

  visit(ast);
  return moduleLoads;
}

export function extractModuleSpecifiers(source, sourceFile = "source.tsx") {
  return extractModuleLoads(source, sourceFile).map(
    (moduleLoad) => moduleLoad.specifier,
  );
}

function isForbiddenDependency(specifier) {
  return forbiddenImports.some(
    (prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`),
  );
}

function isWithin(directory, file) {
  const relative = path.relative(directory, file);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function withoutModuleExtension(file) {
  const extension = path.extname(file);
  return sourceExtensions.has(extension.toLowerCase())
    ? file.slice(0, -extension.length)
    : file;
}

function moduleLoadPathSpecifier(moduleLoad) {
  if (moduleLoad.kind === "vite-glob") {
    return moduleLoad.specifier;
  }
  const queryOrFragment = moduleLoad.specifier.search(/[?#]/u);
  return queryOrFragment === -1
    ? moduleLoad.specifier
    : moduleLoad.specifier.slice(0, queryOrFragment);
}

function isUnreviewedBrowserStyleModule(moduleLoad) {
  const specifier = moduleLoadPathSpecifier(moduleLoad).toLowerCase();
  return (
    specifier.endsWith(".module.css") ||
    [...unreviewedViteStyleExtensions].some((extension) =>
      specifier.endsWith(extension),
    )
  );
}

function isUnapprovedWorkspaceImport(moduleLoad, allowlist, allowTestOnly) {
  if (moduleLoad.kind === "vite-glob") {
    return false;
  }
  const specifier = moduleLoadPathSpecifier(moduleLoad);
  if (!specifier.startsWith("@exercisebook/")) {
    return false;
  }
  if (allowlist.has(specifier)) {
    return false;
  }
  return !(
    allowTestOnly &&
    testOnlySpecifierPrefixes.some(
      (prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`),
    )
  );
}

function isUnapprovedBrowserSafeLeafDependency(relativeFile, moduleLoad) {
  const allowlist = browserSafeLeafDependencyAllowlists.get(relativeFile);
  return allowlist !== undefined && !allowlist.has(moduleLoad.specifier);
}

function isUnapprovedProductionExternalImport(moduleLoad, allowlist) {
  if (moduleLoad.kind !== "static") {
    return false;
  }
  const specifier = moduleLoad.specifier;
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    return false;
  }
  return ![...allowlist].some(
    (packageName) =>
      specifier === packageName || specifier.startsWith(`${packageName}/`),
  );
}

function isUnapprovedPrintDocumentProductionImport(moduleLoad) {
  if (moduleLoad.kind === "vite-glob") {
    return false;
  }
  const specifier = moduleLoad.specifier;
  return (
    !specifier.startsWith(".") &&
    !printDocumentProductionRuntimeAllowlist.has(specifier)
  );
}

function isForbiddenProductionViteLoad(moduleLoad, rootAbsoluteForbidden) {
  return (
    moduleLoad.kind === "vite-glob" ||
    (rootAbsoluteForbidden && moduleLoadPathSpecifier(moduleLoad).startsWith("/"))
  );
}

function resolveModuleLoadPattern(moduleLoad, importingFile, resolutionRoot) {
  const pathSpecifier = moduleLoadPathSpecifier(moduleLoad);
  if (moduleLoad.kind === "vite-glob") {
    return undefined;
  }
  if (pathSpecifier.startsWith(".")) {
    return path.resolve(path.dirname(importingFile), pathSpecifier);
  }
  if (pathSpecifier.startsWith("/")) {
    return path.resolve(resolutionRoot, `.${pathSpecifier}`);
  }
  return undefined;
}

function isModuleLoadOutsideSourceRoot(
  importingFile,
  moduleLoad,
  resolutionRoot,
  sourceRoot,
) {
  const resolvedPattern = resolveModuleLoadPattern(
    moduleLoad,
    importingFile,
    resolutionRoot,
  );
  return resolvedPattern !== undefined && !isWithin(sourceRoot, resolvedPattern);
}

function moduleLoadMatchesSpecifierPrefix(moduleLoad, specifierPrefix) {
  if (moduleLoad.kind === "vite-glob") {
    return false;
  }
  const pathSpecifier = moduleLoadPathSpecifier(moduleLoad);
  const normalizedSpecifier = withoutModuleExtension(pathSpecifier);
  return (
    normalizedSpecifier === specifierPrefix ||
    normalizedSpecifier.startsWith(`${specifierPrefix}/`)
  );
}

function isTestOnlyPath(value) {
  const normalizedPath = value.replaceAll("\\", "/");
  return (
    /(?:^|\/)__tests__(?:\/|$)/iu.test(normalizedPath) ||
    /(?:^|\/)[^/]+\.(?:spec|test)\.[^/]+$/iu.test(normalizedPath)
  );
}

function isTestModuleLoad(importingFile, moduleLoad, resolutionRoot, testSourceFiles) {
  const pathSpecifier = moduleLoadPathSpecifier(moduleLoad);
  if (
    testOnlySpecifierPrefixes.some((specifierPrefix) =>
      moduleLoadMatchesSpecifierPrefix(moduleLoad, specifierPrefix),
    )
  ) {
    return true;
  }
  if (isTestOnlyPath(pathSpecifier)) {
    return true;
  }
  if (
    pathSpecifier.startsWith("@exercisebook/") &&
    /(?:^|[/.-])(?:spec|test)(?:[/.-]|$)/iu.test(pathSpecifier)
  ) {
    return true;
  }

  const resolvedPattern = resolveModuleLoadPattern(
    moduleLoad,
    importingFile,
    resolutionRoot,
  );
  if (resolvedPattern === undefined) {
    return false;
  }
  if (isTestOnlyPath(resolvedPattern)) {
    return true;
  }
  const resolvedModule = withoutModuleExtension(resolvedPattern);
  return testSourceFiles.some(
    (testSourceFile) => withoutModuleExtension(testSourceFile) === resolvedModule,
  );
}

async function assertModuleLoadDoesNotTraverseSymlink(
  repositoryRoot,
  importingFile,
  relativeFile,
  moduleLoad,
  resolutionRoot,
) {
  const resolvedPattern = resolveModuleLoadPattern(
    moduleLoad,
    importingFile,
    resolutionRoot,
  );
  if (resolvedPattern === undefined) {
    return;
  }

  if (!isWithin(repositoryRoot, resolvedPattern)) {
    throw new Error(
      `${relativeFile} module load ${JSON.stringify(moduleLoad.specifier)} resolves outside repository root`,
    );
  }
  const relativeSegments = path
    .relative(repositoryRoot, resolvedPattern)
    .split(path.sep)
    .filter((segment) => segment.length > 0);
  let currentPath = repositoryRoot;
  for (const segment of relativeSegments) {
    currentPath = path.join(currentPath, segment);
    const stats = await lstat(currentPath).catch((error) => {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
        return undefined;
      }
      throw error;
    });
    if (stats === undefined) {
      return;
    }
    if (stats.isSymbolicLink()) {
      const symlinkPath = isWithin(repositoryRoot, currentPath)
        ? toRepositoryPath(repositoryRoot, currentPath)
        : currentPath;
      throw new Error(
        `${relativeFile} module load ${JSON.stringify(moduleLoad.specifier)} traverses symbolic link ${JSON.stringify(symlinkPath)}`,
      );
    }
  }
}

function isTrustedImportFromModules(
  repositoryRoot,
  importingFile,
  moduleLoad,
  resolutionRoot,
  specifierPrefixes,
  sourceModules,
) {
  const pathSpecifier = moduleLoadPathSpecifier(moduleLoad);
  if (moduleLoad.kind === "vite-glob") {
    return false;
  }

  const normalizedSpecifier = withoutModuleExtension(pathSpecifier);
  if (
    specifierPrefixes.some(
      (prefix) =>
        normalizedSpecifier === prefix || normalizedSpecifier.startsWith(`${prefix}/`),
    )
  ) {
    return true;
  }

  const resolvedModule = resolveModuleLoadPattern(
    moduleLoad,
    importingFile,
    resolutionRoot,
  );
  if (resolvedModule === undefined) {
    return false;
  }
  const normalizedResolvedModule = withoutModuleExtension(resolvedModule);
  return sourceModules.some((relativeModule) => {
    const trustedModule = path.join(repositoryRoot, relativeModule);
    return (
      normalizedResolvedModule === trustedModule ||
      normalizedResolvedModule.startsWith(`${trustedModule}${path.sep}`)
    );
  });
}

function isTrustedServerImport(
  repositoryRoot,
  importingFile,
  moduleLoad,
  resolutionRoot,
) {
  return isTrustedImportFromModules(
    repositoryRoot,
    importingFile,
    moduleLoad,
    resolutionRoot,
    trustedServerSpecifierPrefixes,
    trustedServerSourceModules,
  );
}

function isTrustedProjectionImport(
  repositoryRoot,
  importingFile,
  moduleLoad,
  resolutionRoot,
) {
  return isTrustedImportFromModules(
    repositoryRoot,
    importingFile,
    moduleLoad,
    resolutionRoot,
    trustedProjectionSpecifierPrefixes,
    trustedProjectionSourceModules,
  );
}

function findSchemasTrustedBindingViolations(
  repositoryRoot,
  file,
  relativeFile,
  moduleLoads,
) {
  const violations = [];
  for (const moduleLoad of moduleLoads) {
    const mixedModulePolicy = mixedSchemaModulePolicies.find((policy) =>
      isTrustedImportFromModules(
        repositoryRoot,
        file,
        moduleLoad,
        repositoryRoot,
        policy.specifierPrefixes,
        policy.sourceModules,
      ),
    );
    if (mixedModulePolicy === undefined) {
      continue;
    }
    const bindings = moduleLoad.bindings.length === 0 ? ["*"] : moduleLoad.bindings;
    for (const binding of bindings) {
      if (
        isReviewedPreparedAnswerGuardInternalImport(relativeFile, moduleLoad, binding)
      ) {
        continue;
      }
      if (
        !mixedModulePolicy.safeBindings.has(binding) ||
        moduleLoad.aliasedBindings?.includes(binding)
      ) {
        violations.push(
          `${relativeFile} ${moduleLoad.operation} trusted server-only binding ${JSON.stringify(binding)} from ${JSON.stringify(moduleLoad.specifier)}`,
        );
      }
    }
  }

  return violations;
}

function isReviewedPreparedAnswerGuardInternalImport(
  relativeFile,
  moduleLoad,
  binding,
) {
  return (
    relativeFile === preparedAnswerGuardInternalConsumer &&
    moduleLoad.operation === "imports" &&
    moduleLoad.specifier === preparedAnswerGuardInternalSpecifier &&
    preparedAnswerGuardBindings.has(binding) &&
    !moduleLoad.aliasedBindings?.includes(binding)
  );
}

function schemaAnswerAuthorityViolation(
  repositoryRoot,
  file,
  relativeFile,
  moduleLoad,
  resolutionRoot,
) {
  const normalizedSpecifier = withoutModuleExtension(
    moduleLoadPathSpecifier(moduleLoad),
  );
  const loadsSchemasPackage =
    normalizedSpecifier === "@exercisebook/schemas" ||
    normalizedSpecifier.startsWith("@exercisebook/schemas/");
  const loadsTrustedProjection = isTrustedImportFromModules(
    repositoryRoot,
    file,
    moduleLoad,
    resolutionRoot,
    trustedProjectionSpecifierPrefixes,
    trustedProjectionSourceModules,
  );
  const loadsSchemaImplementation = isTrustedImportFromModules(
    repositoryRoot,
    file,
    moduleLoad,
    resolutionRoot,
    trustedImplementationSpecifierPrefixes,
    trustedImplementationSourceModules,
  );
  if (
    loadsTrustedProjection &&
    moduleLoad.specifier === trustedProjectionPackageSpecifier &&
    moduleLoad.operation === "imports" &&
    moduleLoad.bindings.length > 0 &&
    moduleLoad.bindings.every((binding) =>
      trustedProjectionConsumerBindings.has(binding),
    ) &&
    (moduleLoad.aliasedBindings?.length ?? 0) === 0
  ) {
    return undefined;
  }
  if (loadsTrustedProjection) {
    return `${relativeFile} ${moduleLoad.operation} trusted answer authority outside an exact non-aliased trusted-leaf import ${JSON.stringify(moduleLoad.specifier)}`;
  }
  if (loadsSchemaImplementation) {
    return `${relativeFile} ${moduleLoad.operation} schemas implementation outside reviewed public or trusted entrypoints ${JSON.stringify(moduleLoad.specifier)}`;
  }
  if (!loadsSchemasPackage) {
    return undefined;
  }

  const exposesPreparedAuthority = moduleLoad.bindings.some((binding) =>
    preparedAnswerGuardBindings.has(binding),
  );
  if (!exposesPreparedAuthority) {
    return undefined;
  }

  return `${relativeFile} ${moduleLoad.operation} prepared answer authority outside the exact trusted leaf ${JSON.stringify(moduleLoad.specifier)}`;
}

function directIdentityBinding(node) {
  const expression = unwrapTransparentExpression(node);
  return expression?.type === "Identifier" ? expression.name : undefined;
}

function addTrustedAuthorityIdentityAliases(statement, authorityBindings) {
  const declaration =
    statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
  let changed = false;
  if (declaration?.type === "VariableDeclaration") {
    for (const declarator of declaration.declarations) {
      const alias = moduleBindingName(declarator.id);
      const sourceBinding = directIdentityBinding(declarator.init);
      if (
        alias !== undefined &&
        sourceBinding !== undefined &&
        authorityBindings.has(sourceBinding) &&
        !authorityBindings.has(alias)
      ) {
        authorityBindings.add(alias);
        changed = true;
      }
    }
  }
  if (declaration?.type === "TSTypeAliasDeclaration") {
    const alias = moduleBindingName(declaration.id);
    const sourceBinding =
      declaration.typeAnnotation?.type === "TSTypeReference"
        ? moduleBindingName(declaration.typeAnnotation.typeName)
        : undefined;
    if (
      alias !== undefined &&
      sourceBinding !== undefined &&
      authorityBindings.has(sourceBinding) &&
      !authorityBindings.has(alias)
    ) {
      authorityBindings.add(alias);
      changed = true;
    }
  }
  return changed;
}

function findTrustedAuthorityLocalReexportViolations(source, relativeFile) {
  const ast = parseSourceAst(source, relativeFile);
  const authorityBindings = new Set();
  for (const statement of ast.body) {
    if (
      statement.type !== "ImportDeclaration" ||
      staticStringValue(statement.source) !== trustedProjectionPackageSpecifier
    ) {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (specifier.type !== "ImportSpecifier") {
        continue;
      }
      const imported = moduleBindingName(specifier.imported);
      const local = moduleBindingName(specifier.local);
      if (
        imported !== undefined &&
        imported === local &&
        trustedProjectionConsumerBindings.has(imported)
      ) {
        authorityBindings.add(local);
      }
    }
  }

  let changed;
  do {
    changed = false;
    for (const statement of ast.body) {
      changed =
        addTrustedAuthorityIdentityAliases(statement, authorityBindings) || changed;
    }
  } while (changed);

  const exportedAuthorityBindings = new Set();
  for (const statement of ast.body) {
    if (statement.type === "ExportNamedDeclaration" && statement.source === null) {
      for (const specifier of statement.specifiers) {
        const local = moduleBindingName(specifier.local);
        if (local !== undefined && authorityBindings.has(local)) {
          exportedAuthorityBindings.add(local);
        }
      }
      const declaration = statement.declaration;
      if (declaration?.type === "VariableDeclaration") {
        for (const declarator of declaration.declarations) {
          const local = moduleBindingName(declarator.id);
          if (local !== undefined && authorityBindings.has(local)) {
            exportedAuthorityBindings.add(local);
          }
        }
      }
      if (declaration?.type === "TSTypeAliasDeclaration") {
        const local = moduleBindingName(declaration.id);
        if (local !== undefined && authorityBindings.has(local)) {
          exportedAuthorityBindings.add(local);
        }
      }
    }
    if (statement.type === "ExportDefaultDeclaration") {
      const local = directIdentityBinding(statement.declaration);
      if (local !== undefined && authorityBindings.has(local)) {
        exportedAuthorityBindings.add(local);
      }
    }
  }

  return [...exportedAuthorityBindings]
    .sort((left, right) => left.localeCompare(right))
    .map(
      (binding) =>
        `${relativeFile} re-exports trusted answer authority through local binding ${JSON.stringify(binding)}`,
    );
}

function toRepositoryPath(repositoryRoot, file) {
  return path.relative(repositoryRoot, file).split(path.sep).join("/");
}

function isSchemasSource(relativeFile) {
  return relativeFile.startsWith("packages/schemas/src/");
}

function isTestSource(relativeFile) {
  return isTestOnlyPath(relativeFile);
}

function isTrustedProjectionEntrypoint(relativeFile) {
  return relativeFile === "packages/schemas/src/trusted-student-projection.ts";
}

function isWorkerServerImport(
  workerRoot,
  importingFile,
  moduleLoad,
  webApplicationRoot,
) {
  const resolvedPattern = resolveModuleLoadPattern(
    moduleLoad,
    importingFile,
    webApplicationRoot,
  );
  if (resolvedPattern === undefined) {
    return false;
  }
  return isWithin(workerRoot, resolvedPattern);
}

export async function findImportBoundaryViolations(
  repositoryRoot,
  { allowPartialRepository = false } = {},
) {
  const absoluteRepositoryRoot = path.resolve(repositoryRoot);
  const absoluteWebApplicationRoot = path.join(absoluteRepositoryRoot, "apps/web");
  const requireCompleteRepository = !allowPartialRepository;
  const violations = [];
  const sourceFilesByRoot = new Map();
  let webWorkerRoot;

  async function readOptionalFile(file) {
    return readFile(file, "utf8").catch((error) => {
      if (error?.code === "ENOENT") {
        return undefined;
      }
      throw error;
    });
  }

  async function sourceFilesForRoot(relativeRoot) {
    if (!sourceFilesByRoot.has(relativeRoot)) {
      sourceFilesByRoot.set(
        relativeRoot,
        await collectSourceFiles(
          path.join(absoluteRepositoryRoot, relativeRoot),
          absoluteRepositoryRoot,
          sourceExtensions,
          true,
        ),
      );
    }
    return sourceFilesByRoot.get(relativeRoot);
  }

  for (const relativeFile of forbiddenRepositoryResolverConfigs) {
    if (
      (await readOptionalFile(path.join(absoluteRepositoryRoot, relativeFile))) !==
      undefined
    ) {
      throw new Error(`${relativeFile} may not alter reviewed dependency resolution.`);
    }
  }
  for (const relativeFile of implicitPostcssConfigFiles) {
    if (
      (await readOptionalFile(path.join(absoluteRepositoryRoot, relativeFile))) !==
      undefined
    ) {
      throw new Error(
        `${relativeFile} may not alter the reviewed browser CSS build configuration.`,
      );
    }
  }
  for (const relativeFile of implicitPostcssPackageFiles) {
    const source = await readOptionalFile(
      path.join(absoluteRepositoryRoot, relativeFile),
    );
    if (source === undefined) {
      continue;
    }
    const error = new Error(
      `${relativeFile} may not alter the reviewed browser CSS build configuration.`,
    );
    const manifest = parseJsonObject(source, error);
    if (Object.hasOwn(manifest, "postcss")) {
      throw error;
    }
  }
  for (const relativeFile of forbiddenAlternateWranglerConfigs) {
    if (
      (await readOptionalFile(path.join(absoluteRepositoryRoot, relativeFile))) !==
      undefined
    ) {
      throw new Error(
        `${relativeFile} may not replace or augment the reviewed apps/web/wrangler.jsonc configuration.`,
      );
    }
  }
  const publicDirectory = path.join(absoluteWebApplicationRoot, "public");
  const publicDirectoryStats = await lstat(publicDirectory).catch((error) => {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (publicDirectoryStats !== undefined) {
    throw new Error(
      "apps/web/public must be absent because Vite copies it outside the reviewed module graph.",
    );
  }
  const pnpmWorkspace = await readOptionalFile(
    path.join(absoluteRepositoryRoot, "pnpm-workspace.yaml"),
  );
  if (pnpmWorkspace === undefined) {
    if (requireCompleteRepository) {
      throw new Error(
        "pnpm-workspace.yaml is required for complete import boundary analysis.",
      );
    }
  } else {
    assertReviewedPnpmWorkspace(pnpmWorkspace);
  }
  const pnpmLock = await readOptionalFile(
    path.join(absoluteRepositoryRoot, "pnpm-lock.yaml"),
  );
  if (pnpmLock === undefined) {
    if (requireCompleteRepository) {
      throw new Error(
        "pnpm-lock.yaml is required for complete import boundary analysis.",
      );
    }
  } else {
    assertReviewedPnpmLock(pnpmLock);
  }
  for (const manifestPolicy of browserManifestPolicies) {
    const manifest = await readOptionalFile(
      path.join(absoluteRepositoryRoot, manifestPolicy.relativeFile),
    );
    if (manifest === undefined) {
      if (requireCompleteRepository) {
        throw new Error(
          `${manifestPolicy.relativeFile} is required for complete import boundary analysis.`,
        );
      }
      continue;
    }
    assertReviewedBrowserManifest(manifest, manifestPolicy);
  }
  const rootManifest = await readOptionalFile(
    path.join(absoluteRepositoryRoot, "package.json"),
  );
  if (rootManifest === undefined) {
    if (requireCompleteRepository) {
      throw new Error(
        "package.json is required for complete import boundary analysis.",
      );
    }
  } else {
    assertReviewedRootManifest(rootManifest, requireCompleteRepository);
  }
  for (const relativeRoot of browserPackageScopeRoots) {
    const jsonFiles = await collectSourceFiles(
      path.join(absoluteRepositoryRoot, relativeRoot),
      absoluteRepositoryRoot,
      new Set([".json"]),
    );
    for (const jsonFile of jsonFiles) {
      if (path.basename(jsonFile) !== "package.json") {
        continue;
      }
      const relativeFile = toRepositoryPath(absoluteRepositoryRoot, jsonFile);
      throw new Error(
        `${relativeFile} may not define a package resolver scope inside browser-reachable source roots.`,
      );
    }
  }
  const webHtmlFile = path.join(absoluteWebApplicationRoot, "index.html");
  const webHtml = await readOptionalFile(webHtmlFile);
  if (webHtml === undefined) {
    if (requireCompleteRepository) {
      throw new Error(
        "apps/web/index.html is required for complete import boundary analysis.",
      );
    }
  } else {
    assertWebHtmlEntrypoint(webHtml, "apps/web/index.html");
  }
  const reviewedViteConfigs = [];
  for (const extension of sourceExtensions) {
    const relativeViteConfig = `apps/web/vite.config${extension}`;
    const viteConfig = await readOptionalFile(
      path.join(absoluteRepositoryRoot, relativeViteConfig),
    );
    if (viteConfig !== undefined) {
      assertReviewedViteConfig(viteConfig, relativeViteConfig);
      reviewedViteConfigs.push(relativeViteConfig);
    }
  }
  if (
    reviewedViteConfigs.length > 1 ||
    (requireCompleteRepository && reviewedViteConfigs.length !== 1)
  ) {
    throw new Error("apps/web must contain exactly one reviewed Vite configuration.");
  }
  const wranglerConfig = await readOptionalFile(
    path.join(absoluteRepositoryRoot, "apps/web/wrangler.jsonc"),
  );
  if (wranglerConfig === undefined) {
    if (requireCompleteRepository) {
      throw new Error(
        "apps/web/wrangler.jsonc is required for complete import boundary analysis.",
      );
    }
    webWorkerRoot = workerRootFromWranglerMain(reviewedWranglerMain);
  } else {
    webWorkerRoot = workerRootFromWranglerMain(
      assertReviewedWranglerConfig(wranglerConfig),
    );
  }
  for (const relativeRoot of browserPackageScopeRoots) {
    const styleFiles = await collectSourceFiles(
      path.join(absoluteRepositoryRoot, relativeRoot),
      absoluteRepositoryRoot,
      viteStyleExtensions,
    );
    for (const styleFile of styleFiles) {
      const relativeFile = toRepositoryPath(absoluteRepositoryRoot, styleFile);
      const extension = path.extname(relativeFile).toLowerCase();
      if (unreviewedViteStyleExtensions.has(extension)) {
        throw new Error(
          `${relativeFile} may not use unreviewed Vite style language ${JSON.stringify(extension)} in browser-safe source roots.`,
        );
      }
      if (relativeFile.toLowerCase().endsWith(".module.css")) {
        throw new Error(
          `${relativeFile} may not use CSS Modules in browser-safe source roots.`,
        );
      }
      assertCssHasNoAssetUrls(await readFile(styleFile, "utf8"), relativeFile);
    }
  }

  for (const relativeRoot of protectedRoots) {
    await sourceFilesForRoot(relativeRoot);
  }
  for (const relativeRoot of browserReachableRoots) {
    await sourceFilesForRoot(relativeRoot);
  }
  await sourceFilesForRoot("packages/print-document/src");
  for (const sourceRoot of additionalTestOnlyRoots) {
    await sourceFilesForRoot(sourceRoot);
  }
  const allSourceFiles = [...new Set([...sourceFilesByRoot.values()].flat())];
  const testSourceFiles = allSourceFiles.filter((file) => {
    const relativeFile = toRepositoryPath(absoluteRepositoryRoot, file);
    const relativeModule = withoutModuleExtension(relativeFile);
    return (
      isTestSource(relativeFile) ||
      additionalTestOnlyModules.includes(relativeModule) ||
      additionalTestOnlyRoots.some(
        (sourceRoot) =>
          relativeFile === sourceRoot || relativeFile.startsWith(`${sourceRoot}/`),
      )
    );
  });
  const absoluteWorkerRoot = path.join(absoluteRepositoryRoot, webWorkerRoot);
  const workerSourceFiles = await sourceFilesForRoot(webWorkerRoot);

  for (const relativeRoot of protectedRoots) {
    const files = await sourceFilesForRoot(relativeRoot);

    for (const file of files) {
      const relativeFile = toRepositoryPath(absoluteRepositoryRoot, file);
      const testSource = isTestSource(relativeFile);
      const browserSafeProductionSource =
        browserSafeProtectedRoots.has(relativeRoot) && !testSource;
      const resolutionRoot = browserSafeProductionSource
        ? absoluteWebApplicationRoot
        : absoluteRepositoryRoot;
      const absoluteSourceRoot = path.join(absoluteRepositoryRoot, relativeRoot);
      const source = await readFile(file, "utf8");
      const moduleLoads = extractModuleLoads(source, relativeFile);
      for (const moduleLoad of moduleLoads) {
        if (isUnapprovedBrowserSafeLeafDependency(relativeFile, moduleLoad)) {
          violations.push(
            `${relativeFile} ${moduleLoad.operation} non-allowlisted browser-safe leaf dependency ${JSON.stringify(moduleLoad.specifier)}`,
          );
          continue;
        }
        if (
          browserSafeProtectedRoots.has(relativeRoot) &&
          isUnreviewedBrowserStyleModule(moduleLoad)
        ) {
          violations.push(
            `${relativeFile} imports unreviewed Vite style module ${JSON.stringify(moduleLoad.specifier)}`,
          );
          continue;
        }
        if (
          !testSource &&
          isForbiddenProductionViteLoad(moduleLoad, browserSafeProductionSource)
        ) {
          violations.push(
            `${relativeFile} uses forbidden production Vite module load ${JSON.stringify(moduleLoad.specifier)}`,
          );
          continue;
        }
        if (testSource && moduleLoad.kind === "vite-glob") {
          continue;
        }
        await assertModuleLoadDoesNotTraverseSymlink(
          absoluteRepositoryRoot,
          file,
          relativeFile,
          moduleLoad,
          resolutionRoot,
        );
        if (isForbiddenDependency(moduleLoadPathSpecifier(moduleLoad))) {
          violations.push(
            `${relativeFile} imports forbidden dependency ${JSON.stringify(moduleLoad.specifier)}`,
          );
          continue;
        }
        if (
          !testSource &&
          isTestModuleLoad(file, moduleLoad, resolutionRoot, testSourceFiles)
        ) {
          violations.push(
            `${relativeFile} imports test-only module ${JSON.stringify(moduleLoad.specifier)}`,
          );
          continue;
        }
        if (
          browserSafeProductionSource &&
          isUnapprovedWorkspaceImport(
            moduleLoad,
            protectedWorkspaceAllowlists.get(relativeRoot),
            false,
          )
        ) {
          violations.push(
            `${relativeFile} imports non-allowlisted browser workspace dependency ${JSON.stringify(moduleLoad.specifier)}`,
          );
          continue;
        }
        if (
          browserSafeProductionSource &&
          isWorkerServerImport(
            absoluteWorkerRoot,
            file,
            moduleLoad,
            absoluteWebApplicationRoot,
          )
        ) {
          violations.push(
            `${relativeFile} imports Worker server-only dependency ${JSON.stringify(moduleLoad.specifier)}`,
          );
          continue;
        }
        const importsForbiddenTrustedDependency = isSchemasSource(relativeFile)
          ? !testSource &&
            !isTrustedProjectionEntrypoint(relativeFile) &&
            isTrustedProjectionImport(
              absoluteRepositoryRoot,
              file,
              moduleLoad,
              resolutionRoot,
            )
          : !testSource &&
            isTrustedServerImport(
              absoluteRepositoryRoot,
              file,
              moduleLoad,
              resolutionRoot,
            );
        if (importsForbiddenTrustedDependency) {
          violations.push(
            `${relativeFile} imports trusted server-only dependency ${JSON.stringify(moduleLoad.specifier)}`,
          );
          continue;
        }
        if (
          browserSafeProductionSource &&
          isUnapprovedProductionExternalImport(
            moduleLoad,
            productionRuntimeDependencyAllowlists.get(relativeRoot),
          )
        ) {
          violations.push(
            `${relativeFile} imports non-runtime external dependency ${JSON.stringify(moduleLoad.specifier)}`,
          );
          continue;
        }
        if (
          browserSafeProductionSource &&
          isModuleLoadOutsideSourceRoot(
            file,
            moduleLoad,
            resolutionRoot,
            absoluteSourceRoot,
          )
        ) {
          violations.push(
            `${relativeFile} imports outside its browser-safe source root ${JSON.stringify(moduleLoad.specifier)}`,
          );
        }
      }
      if (
        isSchemasSource(relativeFile) &&
        !testSource &&
        !isTrustedProjectionEntrypoint(relativeFile)
      ) {
        violations.push(
          ...findSchemasTrustedBindingViolations(
            absoluteRepositoryRoot,
            file,
            relativeFile,
            moduleLoads,
          ),
        );
      }
    }
  }

  for (const relativeRoot of browserReachableRoots) {
    const files = await sourceFilesForRoot(relativeRoot);
    const absoluteSourceRoot = path.join(absoluteRepositoryRoot, relativeRoot);

    for (const file of files) {
      if (isWithin(absoluteWorkerRoot, file)) {
        continue;
      }

      const relativeFile = toRepositoryPath(absoluteRepositoryRoot, file);
      const testSource = isTestSource(relativeFile);
      const source = await readFile(file, "utf8");
      const moduleLoads = extractModuleLoads(source, relativeFile);
      for (const moduleLoad of moduleLoads) {
        if (isUnreviewedBrowserStyleModule(moduleLoad)) {
          violations.push(
            `${relativeFile} imports unreviewed Vite style module ${JSON.stringify(moduleLoad.specifier)}`,
          );
          continue;
        }
        if (!testSource && isForbiddenProductionViteLoad(moduleLoad, true)) {
          violations.push(
            `${relativeFile} uses forbidden production Vite module load ${JSON.stringify(moduleLoad.specifier)}`,
          );
          continue;
        }
        if (testSource && moduleLoad.kind === "vite-glob") {
          continue;
        }
        await assertModuleLoadDoesNotTraverseSymlink(
          absoluteRepositoryRoot,
          file,
          relativeFile,
          moduleLoad,
          absoluteWebApplicationRoot,
        );
        if (
          !testSource &&
          isTestModuleLoad(
            file,
            moduleLoad,
            absoluteWebApplicationRoot,
            testSourceFiles,
          )
        ) {
          violations.push(
            `${relativeFile} imports test-only module ${JSON.stringify(moduleLoad.specifier)}`,
          );
          continue;
        }
        if (
          isUnapprovedWorkspaceImport(
            moduleLoad,
            testSource
              ? browserWorkspaceAllowlist
              : browserProductionWorkspaceAllowlist,
            testSource,
          )
        ) {
          violations.push(
            `${relativeFile} imports non-allowlisted browser workspace dependency ${JSON.stringify(moduleLoad.specifier)}`,
          );
          continue;
        }
        if (
          isWorkerServerImport(
            absoluteWorkerRoot,
            file,
            moduleLoad,
            absoluteWebApplicationRoot,
          )
        ) {
          violations.push(
            `${relativeFile} imports Worker server-only dependency ${JSON.stringify(moduleLoad.specifier)}`,
          );
          continue;
        }
        if (
          !testSource &&
          isUnapprovedProductionExternalImport(
            moduleLoad,
            productionRuntimeDependencyAllowlists.get(relativeRoot),
          )
        ) {
          violations.push(
            `${relativeFile} imports non-runtime external dependency ${JSON.stringify(moduleLoad.specifier)}`,
          );
          continue;
        }
        if (
          !testSource &&
          isModuleLoadOutsideSourceRoot(
            file,
            moduleLoad,
            absoluteWebApplicationRoot,
            absoluteSourceRoot,
          )
        ) {
          violations.push(
            `${relativeFile} imports outside its browser source root ${JSON.stringify(moduleLoad.specifier)}`,
          );
        }
      }
    }
  }

  for (const file of workerSourceFiles) {
    const relativeFile = toRepositoryPath(absoluteRepositoryRoot, file);
    if (isTestSource(relativeFile)) {
      continue;
    }
    const source = await readFile(file, "utf8");
    const moduleLoads = extractModuleLoads(source, relativeFile);
    violations.push(
      ...findTrustedAuthorityLocalReexportViolations(source, relativeFile),
    );
    for (const moduleLoad of moduleLoads) {
      if (isUnreviewedBrowserStyleModule(moduleLoad)) {
        violations.push(
          `${relativeFile} imports unreviewed Vite style module ${JSON.stringify(moduleLoad.specifier)}`,
        );
        continue;
      }
      if (isForbiddenProductionViteLoad(moduleLoad, false)) {
        violations.push(
          `${relativeFile} uses forbidden production Vite module load ${JSON.stringify(moduleLoad.specifier)}`,
        );
        continue;
      }
      if (
        isTestModuleLoad(file, moduleLoad, absoluteWebApplicationRoot, testSourceFiles)
      ) {
        violations.push(
          `${relativeFile} imports test-only module ${JSON.stringify(moduleLoad.specifier)}`,
        );
        continue;
      }
      await assertModuleLoadDoesNotTraverseSymlink(
        absoluteRepositoryRoot,
        file,
        relativeFile,
        moduleLoad,
        absoluteWebApplicationRoot,
      );
      const preparedAuthorityViolation = schemaAnswerAuthorityViolation(
        absoluteRepositoryRoot,
        file,
        relativeFile,
        moduleLoad,
        absoluteWebApplicationRoot,
      );
      if (preparedAuthorityViolation !== undefined) {
        violations.push(preparedAuthorityViolation);
        continue;
      }
      if (
        isUnapprovedProductionExternalImport(
          moduleLoad,
          productionRuntimeDependencyAllowlists.get("apps/web/src"),
        )
      ) {
        violations.push(
          `${relativeFile} imports non-runtime external dependency ${JSON.stringify(moduleLoad.specifier)}`,
        );
      }
    }
  }

  const printDocumentSourceFiles =
    sourceFilesByRoot.get("packages/print-document/src") ?? [];
  for (const file of printDocumentSourceFiles) {
    const relativeFile = toRepositoryPath(absoluteRepositoryRoot, file);
    if (isTestSource(relativeFile)) {
      continue;
    }
    const source = await readFile(file, "utf8");
    const moduleLoads = extractModuleLoads(source, relativeFile);
    violations.push(
      ...findTrustedAuthorityLocalReexportViolations(source, relativeFile),
    );
    for (const moduleLoad of moduleLoads) {
      if (isForbiddenProductionViteLoad(moduleLoad, false)) {
        violations.push(
          `${relativeFile} uses forbidden production Vite module load ${JSON.stringify(moduleLoad.specifier)}`,
        );
        continue;
      }
      await assertModuleLoadDoesNotTraverseSymlink(
        absoluteRepositoryRoot,
        file,
        relativeFile,
        moduleLoad,
        absoluteRepositoryRoot,
      );
      const preparedAuthorityViolation = schemaAnswerAuthorityViolation(
        absoluteRepositoryRoot,
        file,
        relativeFile,
        moduleLoad,
        absoluteRepositoryRoot,
      );
      if (preparedAuthorityViolation !== undefined) {
        violations.push(preparedAuthorityViolation);
        continue;
      }
      const testModuleLoad = isTestModuleLoad(
        file,
        moduleLoad,
        absoluteRepositoryRoot,
        testSourceFiles,
      );
      if (testModuleLoad) {
        violations.push(
          `${relativeFile} imports test-only module ${JSON.stringify(moduleLoad.specifier)}`,
        );
      }
      if (!testModuleLoad && isUnapprovedPrintDocumentProductionImport(moduleLoad)) {
        violations.push(
          `${relativeFile} imports non-allowlisted production dependency ${JSON.stringify(moduleLoad.specifier)}`,
        );
      }
      if (
        isModuleLoadOutsideSourceRoot(
          file,
          moduleLoad,
          absoluteRepositoryRoot,
          path.join(absoluteRepositoryRoot, "packages/print-document/src"),
        )
      ) {
        violations.push(
          `${relativeFile} imports outside its print-document source root ${JSON.stringify(moduleLoad.specifier)}`,
        );
      }
    }
  }

  return violations;
}
