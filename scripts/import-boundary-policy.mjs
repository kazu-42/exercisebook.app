import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { parseAst } from "vite";

const protectedRoots = [
  "packages/content-compiler/src",
  "packages/domain/src",
  "packages/generators/src",
  "packages/planner/src",
  "packages/schemas/src",
];
const browserReachableRoots = ["apps/web/src", "packages/web-renderer/src"];
const webWorkerRoot = "apps/web/src/worker";
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
const forbiddenImports = [
  "@cloudflare",
  "@exercisebook/print-document",
  "@exercisebook/web-renderer",
  "hono",
  "react",
  "react-dom",
  "wrangler",
];
const trustedServerSpecifierPrefixes = [
  "@exercisebook/schemas/trusted-student-projection",
  "@exercisebook/schemas/src/trusted-student-projection",
  "@exercisebook/schemas/src/worksheet-instance-v1",
  "@exercisebook/schemas/src/student-worksheet-delivery-v2",
  "@exercisebook/schemas/worksheet-instance-v1",
  "@exercisebook/schemas/student-worksheet-delivery-v2",
];
const trustedServerSourceModules = [
  "packages/schemas/src/trusted-student-projection",
  "packages/schemas/src/worksheet-instance-v1",
  "packages/schemas/src/student-worksheet-delivery-v2",
];
const transparentExpressionTypes = new Set([
  "ChainExpression",
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);

async function collectSourceFiles(directory) {
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

    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(absolutePath)));
    } else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }

  return files;
}

function parserLanguage(sourceFile) {
  if (sourceFile.endsWith(".tsx")) {
    return "tsx";
  }
  if (sourceFile.endsWith(".ts") || /\.(?:c|m)ts$/u.test(sourceFile)) {
    return "ts";
  }
  if (sourceFile.endsWith(".jsx")) {
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

function isAstNode(value) {
  return value !== null && typeof value === "object" && typeof value.type === "string";
}

export function extractModuleSpecifiers(source, sourceFile = "source.tsx") {
  let ast;
  try {
    ast = parseAst(
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

  const specifiers = [];
  function requireStaticSpecifier(node, loadKind) {
    const specifier = staticStringValue(node);
    if (specifier === undefined) {
      throw new Error(
        `Non-static ${loadKind} is not allowed in ${sourceFile} at offset ${node?.start ?? "unknown"}.`,
      );
    }
    return specifier;
  }

  function visit(node) {
    let specifier;
    switch (node.type) {
      case "ExportAllDeclaration":
      case "ExportNamedDeclaration":
      case "ImportDeclaration":
        specifier = staticStringValue(node.source);
        break;
      case "ImportExpression":
        specifier = requireStaticSpecifier(node.source, "import()");
        break;
      case "CallExpression":
        if (node.callee?.type === "Identifier" && node.callee.name === "require") {
          specifier = requireStaticSpecifier(node.arguments[0], "require()");
        }
        break;
      case "TSExternalModuleReference":
        specifier = staticStringValue(node.expression);
        break;
      case "TSImportType":
        specifier = staticStringValue(node.source);
        break;
      default:
        break;
    }
    if (specifier !== undefined) {
      specifiers.push(specifier);
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
  return specifiers;
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
  return sourceExtensions.has(extension) ? file.slice(0, -extension.length) : file;
}

function isTrustedServerImport(repositoryRoot, importingFile, specifier) {
  const queryOrFragment = specifier.search(/[?#]/u);
  const pathSpecifier =
    queryOrFragment === -1 ? specifier : specifier.slice(0, queryOrFragment);
  const normalizedSpecifier = withoutModuleExtension(pathSpecifier);
  if (
    trustedServerSpecifierPrefixes.some(
      (prefix) =>
        normalizedSpecifier === prefix || normalizedSpecifier.startsWith(`${prefix}/`),
    )
  ) {
    return true;
  }
  if (!pathSpecifier.startsWith(".")) {
    return false;
  }

  const resolvedModule = withoutModuleExtension(
    path.resolve(path.dirname(importingFile), pathSpecifier),
  );
  return trustedServerSourceModules.some((relativeModule) => {
    const trustedModule = path.join(repositoryRoot, relativeModule);
    return (
      resolvedModule === trustedModule ||
      resolvedModule.startsWith(`${trustedModule}${path.sep}`)
    );
  });
}

function toRepositoryPath(repositoryRoot, file) {
  return path.relative(repositoryRoot, file).split(path.sep).join("/");
}

function mayUseTrustedImportsInsideProtectedPackage(relativeFile) {
  return (
    relativeFile.startsWith("packages/schemas/src/") ||
    /\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(relativeFile)
  );
}

export async function findImportBoundaryViolations(repositoryRoot) {
  const absoluteRepositoryRoot = path.resolve(repositoryRoot);
  const violations = [];

  for (const relativeRoot of protectedRoots) {
    const files = await collectSourceFiles(
      path.join(absoluteRepositoryRoot, relativeRoot),
    );

    for (const file of files) {
      const relativeFile = toRepositoryPath(absoluteRepositoryRoot, file);
      const source = await readFile(file, "utf8");
      for (const specifier of extractModuleSpecifiers(source, relativeFile)) {
        if (isForbiddenDependency(specifier)) {
          violations.push(
            `${relativeFile} imports forbidden dependency ${JSON.stringify(specifier)}`,
          );
        }
        if (
          !mayUseTrustedImportsInsideProtectedPackage(relativeFile) &&
          isTrustedServerImport(absoluteRepositoryRoot, file, specifier)
        ) {
          violations.push(
            `${relativeFile} imports trusted server-only dependency ${JSON.stringify(specifier)}`,
          );
        }
      }
    }
  }

  const absoluteWorkerRoot = path.join(absoluteRepositoryRoot, webWorkerRoot);
  for (const relativeRoot of browserReachableRoots) {
    const files = await collectSourceFiles(
      path.join(absoluteRepositoryRoot, relativeRoot),
    );

    for (const file of files) {
      if (isWithin(absoluteWorkerRoot, file)) {
        continue;
      }

      const relativeFile = toRepositoryPath(absoluteRepositoryRoot, file);
      const source = await readFile(file, "utf8");
      for (const specifier of extractModuleSpecifiers(source, relativeFile)) {
        if (isTrustedServerImport(absoluteRepositoryRoot, file, specifier)) {
          violations.push(
            `${relativeFile} imports trusted server-only dependency ${JSON.stringify(specifier)}`,
          );
        }
      }
    }
  }

  return violations;
}
