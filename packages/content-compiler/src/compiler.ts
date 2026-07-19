import type { Paragraph, PhrasingContent, Root, RootContent } from "mdast";
import type {
  ContainerDirective,
  Directives,
  LeafDirective,
} from "mdast-util-directive";
import remarkDirective from "remark-directive";
import remarkFrontmatter from "remark-frontmatter";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { parseDocument } from "yaml";
import { z } from "zod";

import { canonicalizeJson, sha256Hex, type RationalJson } from "@exercisebook/domain";
import {
  assertSafeDataObjectGraph,
  CONTENT_COMPILER_V1,
  CONTENT_COMPILER_V2,
  CONTENT_DOCUMENT_V1_SCHEMA,
  CONTENT_DOCUMENT_V2_SCHEMA,
  deriveFractionAdditionWorkedExampleArithmetic,
  derivePhase1MathAccessibleText,
  MAX_CANONICAL_INTEGER_DIGITS,
  Phase1SafeMathError,
  RationalJsonSchema,
  validateContentDocumentV1,
  validateContentDocumentV2,
  type ContentBlockV1,
  type ContentBlockV2,
  type ContentDocumentV1,
  type ContentDocumentV2,
  type ContentInlineV1,
  type ContentParagraphV1,
} from "@exercisebook/schemas";

import {
  containsGfmTableDelimiterRow,
  normalizePresentationPlainTextParts,
} from "./presentation-normalization.js";

const MAX_SOURCE_BYTES = 262_144;
const MAX_YAML_BYTES = 32_768;
const MAX_YAML_DEPTH = 20;
const MAX_AST_NODES = 10_000;
const MAX_AST_DEPTH = 64;
const MAX_DIRECTIVE_ATTRIBUTES = 32;
const MAX_DIAGNOSTIC_CHARACTERS = 4_000;
const CANONICAL_RATIONAL_ATTRIBUTE_PATTERN = new RegExp(
  `^(?:0|-?[1-9][0-9]{0,${MAX_CANONICAL_INTEGER_DIGITS - 1}})/[1-9][0-9]{0,${MAX_CANONICAL_INTEGER_DIGITS - 1}}$`,
  "u",
);
// Keep the authoring gate aligned with fractions.add@1's operational cap. Its
// smallest-difficulty pool has 112 prompts, but bounded duplicate retries are
// intentionally not driven to full pool exhaustion.
const MAX_PHASE_1_FRACTION_ADDITION_ITEMS = 96;

const PHASE_1_SKILLS = new Set([
  "math.fractions.add-unlike",
  "math.fractions.equivalent",
]);
const PHASE_1_CONTAINER_DIRECTIVES = new Set([
  "worked-example",
  "exercise",
  "interactive",
  "hint",
  "reflection",
  "callout",
]);
const CONTENT_V2_CONTAINER_DIRECTIVES = new Set([
  ...PHASE_1_CONTAINER_DIRECTIVES,
  "explanation",
]);
const PHASE_1_LEAF_DIRECTIVES = new Set(["figure"]);
const FORBIDDEN_DIRECTIVE_ATTRIBUTE_NAMES = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const PHASE_1_GENERATORS: ReadonlyMap<
  string,
  ReadonlyMap<string, GeneratorRevisionContract>
> = new Map([
  [
    "fractions.add",
    new Map([
      [
        "1",
        {
          supportedLocales: new Set(["en"]),
          maximumItems: MAX_PHASE_1_FRACTION_ADDITION_ITEMS,
          maximumDirectivesPerDocument: 1,
        },
      ],
    ]),
  ],
]);

const PositiveIntegerTextSchema = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform((value) => Number(value))
  .pipe(z.number().int().positive().max(2_147_483_647));

const FrontmatterSchema = z.strictObject({
  schema: z.literal("exercisebook.content-source/v1"),
  id: z.string(),
  revision: PositiveIntegerTextSchema,
  locale: z.string(),
  title: z.string(),
  skills: z.array(z.string()).min(1),
  prerequisites: z.array(z.string()),
  authors: z
    .array(
      z.strictObject({
        name: z.string(),
        role: z.enum(["author", "reviewer"]),
      }),
    )
    .min(1),
  license: z.strictObject({
    licenseId: z.string(),
    sourceUrl: z.string(),
    attributionText: z.string(),
    copyrightHolder: z.string(),
  }),
  publication: z.strictObject({
    status: z.enum(["draft", "published"]),
  }),
  estimatedMinutes: PositiveIntegerTextSchema,
});

const FrontmatterV2Schema = FrontmatterSchema.extend({
  schema: z.literal("exercisebook.content-source/v2"),
});

type Frontmatter = z.infer<typeof FrontmatterSchema>;
type FrontmatterV2 = z.infer<typeof FrontmatterV2Schema>;

export interface ContentCompilerRegistry {
  readonly skillIds: ReadonlySet<string>;
  readonly generators: ReadonlyMap<
    string,
    ReadonlyMap<string, GeneratorRevisionContract>
  >;
  readonly assetIds: ReadonlySet<string>;
}

export interface GeneratorRevisionContract {
  readonly supportedLocales: ReadonlySet<string>;
  readonly maximumItems: number;
  readonly maximumDirectivesPerDocument: number;
}

export interface CompileContentOptions {
  readonly registry?: ContentCompilerRegistry;
}

export interface CompiledContentV1 {
  readonly document: ContentDocumentV1;
  readonly canonicalJson: string;
  readonly contentHash: string;
}

export interface CompiledContentV2 {
  readonly document: ContentDocumentV2;
  readonly canonicalJson: string;
  readonly contentHash: string;
}

export class ContentCompilationError extends Error {
  override readonly name = "ContentCompilationError";
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${boundedText(message)}`);
    this.code = code;
  }
}

const parser = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkDirective)
  .use(remarkMath)
  .freeze();

export async function compileContentSource(
  source: string,
  options: CompileContentOptions = {},
): Promise<CompiledContentV1> {
  if (typeof source !== "string") {
    throw new ContentCompilationError(
      "source-type",
      "Content source must be a primitive string",
    );
  }
  try {
    assertSafeDataObjectGraph(source);
  } catch (error) {
    throw new ContentCompilationError("source-unicode", boundedDiagnostic(error));
  }
  const originalBytes = new TextEncoder().encode(source);
  if (originalBytes.byteLength > MAX_SOURCE_BYTES) {
    throw new ContentCompilationError(
      "source-bytes-limit",
      `Source exceeds ${MAX_SOURCE_BYTES} UTF-8 bytes`,
    );
  }

  const normalizedSource = normalizeSource(source);
  assertCanonicalDirectiveHeaders(normalizedSource);
  let tree: Root;
  try {
    tree = parser().parse(normalizedSource);
  } catch (error) {
    throw new ContentCompilationError("markdown-parse", errorMessage(error));
  }
  assertTreeLimits(tree);

  const yamlNodes = tree.children.filter(isYamlNode);
  if (yamlNodes.length !== 1 || tree.children[0]?.type !== "yaml") {
    throw new ContentCompilationError(
      "frontmatter",
      "Exactly one YAML frontmatter block must be the first node",
    );
  }
  const yamlSource = yamlNodes[0]?.value ?? "";
  if (new TextEncoder().encode(yamlSource).byteLength > MAX_YAML_BYTES) {
    throw new ContentCompilationError(
      "yaml-bytes-limit",
      `YAML frontmatter exceeds ${MAX_YAML_BYTES} UTF-8 bytes`,
    );
  }

  const frontmatter = parseFrontmatter(yamlSource);
  const registry = options.registry ?? defaultRegistry();
  validateRegistryReferences(frontmatter, registry);

  const nodes = tree.children
    .filter((node) => node.type !== "yaml")
    .map((node) => convertBlock(node, registry));
  validateGeneratorCompatibility(frontmatter, nodes, registry);
  const sourceHash = await sha256Hex(normalizedSource);
  let document: ContentDocumentV1;
  try {
    document = validateContentDocumentV1({
      schema: CONTENT_DOCUMENT_V1_SCHEMA,
      id: frontmatter.id,
      revision: frontmatter.revision,
      locale: frontmatter.locale,
      title: frontmatter.title,
      skills: frontmatter.skills,
      prerequisites: frontmatter.prerequisites,
      authors: frontmatter.authors,
      license: frontmatter.license,
      publication: frontmatter.publication,
      estimatedMinutes: frontmatter.estimatedMinutes,
      nodes,
      sourceHash,
      compilerVersion: CONTENT_COMPILER_V1,
    });
  } catch (error) {
    throw new ContentCompilationError("content-schema", boundedDiagnostic(error));
  }
  const canonicalJson = canonicalizeJson(document);
  const contentHash = await sha256Hex(canonicalJson);
  return { document, canonicalJson, contentHash };
}

/**
 * Compiles the parallel v2 authoring contract. The v1 entrypoint remains
 * intentionally independent so adding presentation metadata cannot change an
 * already published v1 source or content identity.
 */
export async function compileContentSourceV2(
  source: string,
  options: CompileContentOptions = {},
): Promise<CompiledContentV2> {
  if (typeof source !== "string") {
    throw new ContentCompilationError(
      "source-type",
      "Content source must be a primitive string",
    );
  }
  try {
    assertSafeDataObjectGraph(source);
  } catch (error) {
    throw new ContentCompilationError("source-unicode", boundedDiagnostic(error));
  }
  const originalBytes = new TextEncoder().encode(source);
  if (originalBytes.byteLength > MAX_SOURCE_BYTES) {
    throw new ContentCompilationError(
      "source-bytes-limit",
      `Source exceeds ${MAX_SOURCE_BYTES} UTF-8 bytes`,
    );
  }

  const normalizedSource = normalizeSource(source);
  assertCanonicalDirectiveHeaders(normalizedSource, {
    containerDirectives: CONTENT_V2_CONTAINER_DIRECTIVES,
    enforceTypedWorkedExampleRationalSource: true,
  });
  assertCanonicalContainerDirectiveClosingFences(
    normalizedSource,
    CONTENT_V2_CONTAINER_DIRECTIVES,
  );
  let tree: Root;
  try {
    tree = parser().parse(normalizedSource);
  } catch (error) {
    throw new ContentCompilationError("markdown-parse", errorMessage(error));
  }
  assertTreeLimits(tree);

  const yamlNodes = tree.children.filter(isYamlNode);
  if (yamlNodes.length !== 1 || tree.children[0]?.type !== "yaml") {
    throw new ContentCompilationError(
      "frontmatter",
      "Exactly one YAML frontmatter block must be the first node",
    );
  }
  const yamlSource = yamlNodes[0]?.value ?? "";
  if (new TextEncoder().encode(yamlSource).byteLength > MAX_YAML_BYTES) {
    throw new ContentCompilationError(
      "yaml-bytes-limit",
      `YAML frontmatter exceeds ${MAX_YAML_BYTES} UTF-8 bytes`,
    );
  }

  const frontmatter = parseFrontmatterV2(yamlSource);
  const registry = options.registry ?? defaultRegistry();
  validateRegistryReferences(frontmatter, registry);

  const nodes = tree.children
    .filter((node) => node.type !== "yaml")
    .map((node) => convertBlockV2(node, registry));
  validateGeneratorCompatibility(frontmatter, nodes, registry);
  const sourceHash = await sha256Hex(normalizedSource);
  let document: ContentDocumentV2;
  try {
    document = validateContentDocumentV2({
      schema: CONTENT_DOCUMENT_V2_SCHEMA,
      id: frontmatter.id,
      revision: frontmatter.revision,
      locale: frontmatter.locale,
      title: frontmatter.title,
      skills: frontmatter.skills,
      prerequisites: frontmatter.prerequisites,
      authors: frontmatter.authors,
      license: frontmatter.license,
      publication: frontmatter.publication,
      estimatedMinutes: frontmatter.estimatedMinutes,
      nodes,
      sourceHash,
      compilerVersion: CONTENT_COMPILER_V2,
    });
  } catch (error) {
    throw new ContentCompilationError("content-schema", boundedDiagnostic(error));
  }
  const canonicalJson = canonicalizeJson(document);
  const contentHash = await sha256Hex(canonicalJson);
  return { document, canonicalJson, contentHash };
}

function normalizeSource(source: string): string {
  const withoutBom = source.startsWith("\ufeff") ? source.slice(1) : source;
  return withoutBom.replace(/\r\n?/g, "\n");
}

function assertCanonicalDirectiveHeaders(
  source: string,
  options: Readonly<{
    containerDirectives?: ReadonlySet<string>;
    enforceTypedWorkedExampleRationalSource?: boolean;
  }> = {},
): void {
  const containerDirectives =
    options.containerDirectives ?? PHASE_1_CONTAINER_DIRECTIVES;
  for (const line of source.split("\n")) {
    if (!/^(?: {0,3}):{2,}[A-Za-z]/u.test(line)) {
      continue;
    }
    const match = /^(?: {0,3})(:{2,3})([A-Za-z][A-Za-z0-9-]*)\{(.*)\}[ \t]*$/u.exec(
      line,
    );
    if (match === null) {
      throw new ContentCompilationError(
        "directive-header-syntax",
        "Directive headers must use the canonical Phase-1 same-line attribute syntax",
      );
    }
    const fence = match[1] ?? "";
    const directiveName = match[2] ?? "";
    const header = match[3] ?? "";
    const expectedFence = containerDirectives.has(directiveName)
      ? ":::"
      : PHASE_1_LEAF_DIRECTIVES.has(directiveName)
        ? "::"
        : undefined;
    if (expectedFence === undefined) {
      throw new ContentCompilationError(
        "unknown-directive",
        `Unknown directive: ${directiveName}`,
      );
    }
    if (fence !== expectedFence) {
      throw new ContentCompilationError(
        "directive-header-syntax",
        `${directiveName} must use an exact ${expectedFence} opening fence`,
      );
    }

    const attributes = parseCanonicalDirectiveAttributes(header);
    const seenNames = new Set<string>();
    for (const { name } of attributes) {
      if (seenNames.has(name)) {
        throw new ContentCompilationError(
          "duplicate-directive-attribute",
          `Duplicate directive attribute name: ${name}`,
        );
      }
      seenNames.add(name);
      if (FORBIDDEN_DIRECTIVE_ATTRIBUTE_NAMES.has(name)) {
        throw new ContentCompilationError(
          "unsafe-directive-attribute",
          `Forbidden directive attribute name: ${name}`,
        );
      }
    }
    if (
      options.enforceTypedWorkedExampleRationalSource === true &&
      directiveName === "worked-example"
    ) {
      for (const key of ["left", "right", "result"] as const) {
        const rawValue = attributes.find((attribute) => attribute.name === key)?.value;
        if (
          rawValue !== undefined &&
          !CANONICAL_RATIONAL_ATTRIBUTE_PATTERN.test(rawValue)
        ) {
          throw new ContentCompilationError(
            "worked-example-rational",
            `${key} must use canonical reduced numerator/positive-denominator syntax`,
          );
        }
      }
    }
  }
}

function parseCanonicalDirectiveAttributes(
  source: string,
): readonly Readonly<{ name: string; value: string }>[] {
  const attributes: Readonly<{ name: string; value: string }>[] = [];
  let offset = 0;
  while (offset < source.length) {
    while (/[ \t]/u.test(source[offset] ?? "")) {
      offset += 1;
    }
    if (offset >= source.length) {
      break;
    }

    const nameMatch = /^[A-Za-z_][A-Za-z0-9_-]*/u.exec(source.slice(offset));
    if (nameMatch === null) {
      throw nonCanonicalDirectiveAttributeSyntax();
    }
    const name = nameMatch[0];
    offset += name.length;
    if (source[offset] !== "=") {
      throw nonCanonicalDirectiveAttributeSyntax();
    }
    offset += 1;
    if (source[offset] !== '"') {
      throw nonCanonicalDirectiveAttributeSyntax();
    }
    offset += 1;
    const valueStart = offset;
    while (offset < source.length && source[offset] !== '"') {
      offset += 1;
    }
    if (source[offset] !== '"') {
      throw nonCanonicalDirectiveAttributeSyntax();
    }
    const value = source.slice(valueStart, offset);
    offset += 1;
    attributes.push({ name, value });

    if (offset < source.length && !/[ \t]/u.test(source[offset] ?? "")) {
      throw nonCanonicalDirectiveAttributeSyntax();
    }
  }
  return attributes;
}

function assertCanonicalContainerDirectiveClosingFences(
  source: string,
  containerDirectives: ReadonlySet<string>,
): void {
  let openContainerCount = 0;

  for (const line of source.split("\n")) {
    const opening = /^(?: {0,3}):::([A-Za-z][A-Za-z0-9-]*)\{/u.exec(line);
    if (opening !== null && containerDirectives.has(opening[1] ?? "")) {
      openContainerCount += 1;
      continue;
    }

    if (!/^(?: {0,3}):{2,}(?:[ \t].*)?$/u.test(line)) {
      continue;
    }
    if (line !== ":::") {
      throw new ContentCompilationError(
        "directive-closing-syntax",
        "Container directives must use an exact ::: closing fence",
      );
    }
    if (openContainerCount === 0) {
      throw new ContentCompilationError(
        "directive-closing-balance",
        "Container directive closing fence has no matching opening fence",
      );
    }
    openContainerCount -= 1;
  }

  if (openContainerCount !== 0) {
    throw new ContentCompilationError(
      "directive-closing-balance",
      "Every container directive requires one exact ::: closing fence",
    );
  }
}

function nonCanonicalDirectiveAttributeSyntax(): ContentCompilationError {
  return new ContentCompilationError(
    "directive-attribute-syntax",
    'Directive attributes must be whitespace-separated ASCII key="value" pairs without shorthand or valueless attributes',
  );
}

function parseFrontmatter(source: string): Frontmatter {
  let document;
  try {
    document = parseDocument(source, {
      schema: "failsafe",
      strict: true,
      stringKeys: true,
      uniqueKeys: true,
      version: "1.2",
    });
  } catch (error) {
    throw new ContentCompilationError("YAML-parse", errorMessage(error));
  }
  if (document.errors.length > 0) {
    throw new ContentCompilationError(
      "YAML-parse",
      document.errors.map((error) => error.message).join("; "),
    );
  }

  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new ContentCompilationError("YAML-alias", errorMessage(error));
  }
  try {
    assertSafeDataObjectGraph(value);
  } catch (error) {
    throw new ContentCompilationError("frontmatter-object", boundedDiagnostic(error));
  }
  assertDataDepth(value, 0);
  const parsed = FrontmatterSchema.safeParse(value);
  if (!parsed.success) {
    throw new ContentCompilationError(
      "frontmatter-schema",
      z.prettifyError(parsed.error),
    );
  }
  if (parsed.data.publication.status === "published") {
    throw new ContentCompilationError(
      "publication-approval",
      "Published content requires a trusted release approval outside source frontmatter",
    );
  }
  return parsed.data;
}

function parseFrontmatterV2(source: string): FrontmatterV2 {
  let document;
  try {
    document = parseDocument(source, {
      schema: "failsafe",
      strict: true,
      stringKeys: true,
      uniqueKeys: true,
      version: "1.2",
    });
  } catch (error) {
    throw new ContentCompilationError("YAML-parse", errorMessage(error));
  }
  if (document.errors.length > 0) {
    throw new ContentCompilationError(
      "YAML-parse",
      document.errors.map((error) => error.message).join("; "),
    );
  }

  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new ContentCompilationError("YAML-alias", errorMessage(error));
  }
  try {
    assertSafeDataObjectGraph(value);
  } catch (error) {
    throw new ContentCompilationError("frontmatter-object", boundedDiagnostic(error));
  }
  assertDataDepth(value, 0);
  const parsed = FrontmatterV2Schema.safeParse(value);
  if (!parsed.success) {
    throw new ContentCompilationError(
      "frontmatter-schema",
      z.prettifyError(parsed.error),
    );
  }
  if (parsed.data.publication.status === "published") {
    throw new ContentCompilationError(
      "publication-approval",
      "Published content requires a trusted release approval outside source frontmatter",
    );
  }
  return parsed.data;
}

function validateRegistryReferences(
  frontmatter: Pick<Frontmatter, "skills" | "prerequisites">,
  registry: ContentCompilerRegistry,
): void {
  for (const skillId of [...frontmatter.skills, ...frontmatter.prerequisites]) {
    if (!registry.skillIds.has(skillId)) {
      throw new ContentCompilationError(
        "unknown-skill",
        `Unknown skill ID: ${skillId}`,
      );
    }
  }
}

function validateGeneratorCompatibility(
  frontmatter: Pick<Frontmatter, "locale">,
  nodes: readonly (ContentBlockV1 | ContentBlockV2)[],
  registry: ContentCompilerRegistry,
): void {
  const directiveCounts = new Map<string, number>();
  for (const node of nodes) {
    if (node.type !== "exercise") {
      continue;
    }
    const contract = requireGeneratorContract(
      registry,
      node.generator.id,
      node.generator.version,
    );
    if (!contract.supportedLocales.has(frontmatter.locale)) {
      throw new ContentCompilationError(
        "unsupported-generator-locale",
        `${node.generator.id}@${node.generator.version} does not support locale ${frontmatter.locale}`,
      );
    }
    const identity = `${node.generator.id}@${node.generator.version}`;
    const nextCount = (directiveCounts.get(identity) ?? 0) + 1;
    directiveCounts.set(identity, nextCount);
    if (nextCount > contract.maximumDirectivesPerDocument) {
      throw new ContentCompilationError(
        "generator-directive-count",
        `${identity} permits at most ${contract.maximumDirectivesPerDocument} exercise directive per content document`,
      );
    }
  }
}

function convertBlock(
  node: RootContent,
  registry: ContentCompilerRegistry,
): ContentBlockV1 {
  switch (node.type) {
    case "paragraph":
      return convertParagraph(node);
    case "heading":
      return {
        type: "heading",
        level: node.depth,
        children: convertInlineChildren(node.children),
      };
    case "containerDirective":
    case "leafDirective":
      return convertDirective(node, registry);
    case "html":
      throw new ContentCompilationError("raw-HTML", "Raw HTML is not allowed");
    case "image":
    case "imageReference":
      throw new ContentCompilationError(
        "unsupported-image",
        "Markdown image and remote asset fetches are not allowed",
      );
    case "code":
      throw new ContentCompilationError(
        "executable-code",
        "Fenced code is not supported in learning content",
      );
    case "math":
      throw new ContentCompilationError(
        "display-math",
        "Display math must use a reviewed semantic directive",
      );
    default:
      throw new ContentCompilationError(
        "unsupported-markdown",
        `Unsupported Markdown node: ${node.type}`,
      );
  }
}

function convertBlockV2(
  node: RootContent,
  registry: ContentCompilerRegistry,
): ContentBlockV2 {
  switch (node.type) {
    case "paragraph":
      return convertParagraph(node);
    case "heading":
      return {
        type: "heading",
        level: node.depth,
        children: convertInlineChildren(node.children),
      };
    case "containerDirective":
    case "leafDirective":
      return convertDirectiveV2(node, registry);
    case "html":
      throw new ContentCompilationError("raw-HTML", "Raw HTML is not allowed");
    case "image":
    case "imageReference":
      throw new ContentCompilationError(
        "unsupported-image",
        "Markdown image and remote asset fetches are not allowed",
      );
    case "code":
      throw new ContentCompilationError(
        "executable-code",
        "Fenced code is not supported in learning content",
      );
    case "math":
      throw new ContentCompilationError(
        "display-math",
        "Display math must use a reviewed semantic directive",
      );
    default:
      throw new ContentCompilationError(
        "unsupported-markdown",
        `Unsupported Markdown node: ${node.type}`,
      );
  }
}

function convertParagraph(node: Paragraph): ContentParagraphV1 {
  return {
    type: "paragraph",
    children: convertInlineChildren(node.children),
  };
}

function convertInlineChildren(
  children: readonly PhrasingContent[],
): ContentInlineV1[] {
  return children.map((node): ContentInlineV1 => {
    switch (node.type) {
      case "text":
        if (node.value.length === 0) {
          throw new ContentCompilationError("empty-text", "Empty text node");
        }
        return { type: "text", value: node.value };
      case "inlineMath":
        return {
          type: "math",
          source: node.value,
          accessibleText: compileSafeMathAccessibleText(node.value),
        };
      case "emphasis":
      case "strong":
        return {
          type: node.type,
          children: node.children.map((child) => {
            if (child.type === "text") {
              return { type: "text" as const, value: child.value };
            }
            if (child.type === "inlineMath") {
              return {
                type: "math" as const,
                source: child.value,
                accessibleText: compileSafeMathAccessibleText(child.value),
              };
            }
            throw new ContentCompilationError(
              "nested-inline",
              `Unsupported nested inline node: ${child.type}`,
            );
          }),
        };
      case "break":
        return { type: "text", value: "\n" };
      case "html":
        throw new ContentCompilationError("raw-HTML", "Raw inline HTML is not allowed");
      case "image":
      case "imageReference":
        throw new ContentCompilationError(
          "unsupported-image",
          "Markdown images and remote asset fetches are not allowed",
        );
      case "link":
      case "linkReference":
        throw new ContentCompilationError(
          "unsupported-link",
          "Author-controlled links require a reviewed asset registry entry",
        );
      case "textDirective":
        throw new ContentCompilationError(
          "unsupported-directive",
          `Text directive is not allowed: ${node.name}`,
        );
      default:
        throw new ContentCompilationError(
          "unsupported-inline",
          `Unsupported inline node: ${node.type}`,
        );
    }
  });
}

function convertDirective(
  node: ContainerDirective | LeafDirective,
  registry: ContentCompilerRegistry,
): ContentBlockV1 {
  const attributes = normalizedAttributes(node);
  switch (node.name) {
    case "worked-example": {
      assertExactAttributes(attributes, ["id", "title"]);
      return {
        type: "worked-example",
        id: requireAttribute(attributes, "id"),
        title: requireAttribute(attributes, "title"),
        children: convertDirectiveBody(node),
      };
    }
    case "exercise": {
      assertExactAttributes(attributes, [
        "id",
        "generator",
        "version",
        "count",
        "difficulty",
        "instruction",
      ]);
      assertEmptyDirectiveBody(node);
      const generatorId = requireAttribute(attributes, "generator");
      const version = requireAttribute(attributes, "version");
      const contract = requireGeneratorContract(registry, generatorId, version);
      const difficulty = parsePositiveIntegerAttribute(attributes, "difficulty", 5);
      const count = parsePositiveIntegerAttribute(
        attributes,
        "count",
        contract.maximumItems,
      );
      return {
        type: "exercise",
        id: requireAttribute(attributes, "id"),
        generator: {
          id: generatorId,
          version,
          parameters: {
            difficulty,
          },
        },
        count,
        instruction: requireAttribute(attributes, "instruction"),
      };
    }
    case "interactive": {
      assertExactAttributes(attributes, ["id", "kind", "prompt", "printFallback"]);
      const kind = requireAttribute(attributes, "kind");
      if (kind !== "fraction-bars") {
        throw new ContentCompilationError(
          "unknown-interactive",
          `Unknown interactive kind: ${kind}`,
        );
      }
      return {
        type: "interactive",
        id: requireAttribute(attributes, "id"),
        kind,
        prompt: requireAttribute(attributes, "prompt"),
        printFallback: requireAttribute(attributes, "printFallback"),
        children: convertDirectiveBody(node),
      };
    }
    case "hint":
    case "reflection": {
      assertExactAttributes(attributes, ["id"]);
      return {
        type: node.name,
        id: requireAttribute(attributes, "id"),
        children: convertDirectiveBody(node),
      };
    }
    case "callout": {
      assertExactAttributes(attributes, ["id", "tone"]);
      const tone = requireAttribute(attributes, "tone");
      if (tone !== "note" && tone !== "tip" && tone !== "warning") {
        throw new ContentCompilationError(
          "callout-tone",
          `Unknown callout tone: ${tone}`,
        );
      }
      return {
        type: "callout",
        id: requireAttribute(attributes, "id"),
        tone,
        children: convertDirectiveBody(node),
      };
    }
    case "figure": {
      assertExactAttributes(attributes, ["id", "assetId", "alt", "caption"]);
      assertEmptyDirectiveBody(node);
      const assetId = requireAttribute(attributes, "assetId");
      if (!registry.assetIds.has(assetId)) {
        throw new ContentCompilationError(
          "unknown-asset",
          `Unknown reviewed asset ID: ${assetId}`,
        );
      }
      return {
        type: "figure",
        id: requireAttribute(attributes, "id"),
        assetId,
        alt: requireAttribute(attributes, "alt"),
        caption: requireAttribute(attributes, "caption"),
      };
    }
    default:
      throw new ContentCompilationError(
        "unknown-directive",
        `Unknown directive: ${node.name}`,
      );
  }
}

function convertDirectiveV2(
  node: ContainerDirective | LeafDirective,
  registry: ContentCompilerRegistry,
): ContentBlockV2 {
  const attributes = normalizedAttributes(node);
  switch (node.name) {
    case "explanation": {
      assertExactAttributes(attributes, ["id", "title"]);
      return {
        type: "explanation",
        id: requireAttribute(attributes, "id"),
        title: requireAttribute(attributes, "title"),
        paragraphs: convertPresentationDirectiveBody(node),
      };
    }
    case "worked-example": {
      assertExactAttributes(attributes, [
        "id",
        "title",
        "model",
        "left",
        "right",
        "result",
      ]);
      const model = requireAttribute(attributes, "model");
      if (model !== "fraction-addition") {
        throw new ContentCompilationError(
          "worked-example-model",
          `Unknown worked-example model: ${model}`,
        );
      }
      const left = parseRationalAttribute(attributes, "left");
      const right = parseRationalAttribute(attributes, "right");
      const declaredResult = parseRationalAttribute(attributes, "result");
      let derived: ReturnType<typeof deriveFractionAdditionWorkedExampleArithmetic>;
      try {
        derived = deriveFractionAdditionWorkedExampleArithmetic(left, right);
      } catch (error) {
        if (!(error instanceof RangeError)) {
          throw error;
        }
        throw new ContentCompilationError(
          "worked-example-arithmetic",
          "Derived worked-example arithmetic exceeds the bounded canonical integer contract",
        );
      }
      if (!sameRational(declaredResult, derived.result)) {
        throw new ContentCompilationError(
          "worked-example-result",
          "The declared worked-example result does not equal the exact sum of left and right",
        );
      }
      return {
        type: "worked-example",
        id: requireAttribute(attributes, "id"),
        title: requireAttribute(attributes, "title"),
        model: {
          type: "fraction-addition",
          left,
          right,
          result: derived.result,
          commonDenominator: derived.commonDenominator,
          leftScaledNumerator: derived.leftScaledNumerator,
          rightScaledNumerator: derived.rightScaledNumerator,
          unreducedSumNumerator: derived.unreducedSumNumerator,
        },
        steps: convertPresentationDirectiveBody(node),
      };
    }
    default: {
      const converted = convertDirective(node, registry);
      if (converted.type === "worked-example") {
        throw new ContentCompilationError(
          "worked-example-model",
          "Content source v2 requires a typed worked-example model",
        );
      }
      return converted;
    }
  }
}

function requireGeneratorContract(
  registry: ContentCompilerRegistry,
  generatorId: string,
  version: string,
): GeneratorRevisionContract {
  const contract = registry.generators.get(generatorId)?.get(version);
  if (contract === undefined) {
    throw new ContentCompilationError(
      "unknown-generator",
      `Unknown generator revision: ${generatorId}@${version}`,
    );
  }
  return contract;
}

function convertDirectiveBody(
  node: ContainerDirective | LeafDirective,
): ContentParagraphV1[] {
  if (node.type !== "containerDirective" || node.children.length === 0) {
    throw new ContentCompilationError(
      "directive-body",
      `${node.name} requires a non-empty paragraph body`,
    );
  }
  return node.children.map((child) => {
    if (child.type !== "paragraph") {
      throw new ContentCompilationError(
        "directive-body",
        `${node.name} body supports paragraphs only`,
      );
    }
    return convertParagraph(child);
  });
}

function convertPresentationDirectiveBody(
  node: ContainerDirective | LeafDirective,
): string[] {
  if (node.type !== "containerDirective") {
    throw new ContentCompilationError(
      "presentation-paragraph-count",
      `${node.name} requires between one and eight plain-text paragraphs`,
    );
  }
  if (node.children.length < 1 || node.children.length > 8) {
    throw new ContentCompilationError(
      "presentation-paragraph-count",
      `${node.name} requires between one and eight plain-text paragraphs`,
    );
  }

  return node.children.map((child) => {
    if (child.type !== "paragraph" || child.children.length < 1) {
      throw new ContentCompilationError(
        "presentation-plain-text",
        `${node.name} presentation prose supports plain text only`,
      );
    }
    const textParts: string[] = [];
    for (const inline of child.children) {
      if (inline.type !== "text") {
        throw new ContentCompilationError(
          "presentation-plain-text",
          `${node.name} presentation prose supports plain text only`,
        );
      }
      textParts.push(inline.value);
    }
    if (containsGfmTableDelimiterRow(textParts)) {
      throw new ContentCompilationError(
        "presentation-plain-text",
        `${node.name} presentation prose does not support Markdown tables`,
      );
    }
    const normalized = normalizePresentationPlainTextParts(textParts);
    if (normalized.length === 0) {
      throw new ContentCompilationError(
        "presentation-plain-text",
        `${node.name} presentation prose cannot normalize to empty text`,
      );
    }
    return normalized;
  });
}

function parseRationalAttribute(
  attributes: Readonly<Record<string, string>>,
  key: "left" | "right" | "result",
): RationalJson {
  const source = requireAttribute(attributes, key);
  if (!CANONICAL_RATIONAL_ATTRIBUTE_PATTERN.test(source)) {
    throw new ContentCompilationError(
      "worked-example-rational",
      `${key} must use canonical reduced numerator/positive-denominator syntax`,
    );
  }
  const separator = source.indexOf("/");
  const candidate = {
    numerator: source.slice(0, separator),
    denominator: source.slice(separator + 1),
  };
  const parsed = RationalJsonSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ContentCompilationError(
      "worked-example-rational",
      `${key} must be a reduced rational with a positive denominator`,
    );
  }
  return parsed.data;
}

function sameRational(left: RationalJson, right: RationalJson): boolean {
  return left.numerator === right.numerator && left.denominator === right.denominator;
}

function assertEmptyDirectiveBody(node: Directives): void {
  if (node.children.length > 0) {
    throw new ContentCompilationError(
      "directive-body",
      `${node.name} does not accept body content`,
    );
  }
}

function normalizedAttributes(node: Directives): Record<string, string> {
  const source = node.attributes ?? {};
  const entries = Object.entries(source);
  if (entries.length > MAX_DIRECTIVE_ATTRIBUTES) {
    throw new ContentCompilationError(
      "directive-attributes-limit",
      `${node.name} has too many attributes`,
    );
  }
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, value] of entries) {
    if (typeof value !== "string") {
      throw new ContentCompilationError(
        "directive-attribute",
        `${node.name}.${key} must have a string value`,
      );
    }
    result[key] = value;
  }
  return result;
}

function assertExactAttributes(
  attributes: Readonly<Record<string, string>>,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(attributes)) {
    if (!allowedSet.has(key)) {
      throw new ContentCompilationError(
        "unknown-directive-attribute",
        `Unknown directive attribute: ${key}`,
      );
    }
  }
  for (const key of allowed) {
    if (attributes[key] === undefined) {
      throw new ContentCompilationError(
        "missing-directive-attribute",
        `Missing directive attribute: ${key}`,
      );
    }
  }
}

function requireAttribute(
  attributes: Readonly<Record<string, string>>,
  key: string,
): string {
  const value = attributes[key];
  if (value === undefined || value.length === 0) {
    throw new ContentCompilationError(
      "missing-directive-attribute",
      `Missing directive attribute: ${key}`,
    );
  }
  return value;
}

function parsePositiveIntegerAttribute(
  attributes: Readonly<Record<string, string>>,
  key: string,
  maximum: number,
): number {
  const source = requireAttribute(attributes, key);
  if (!/^[1-9][0-9]*$/.test(source)) {
    throw new ContentCompilationError(
      "directive-integer",
      `${key} must be a canonical positive integer`,
    );
  }
  const value = Number(source);
  if (!Number.isSafeInteger(value) || value > maximum) {
    throw new ContentCompilationError(
      "directive-integer",
      `${key} must not exceed ${maximum}`,
    );
  }
  return value;
}

function compileSafeMathAccessibleText(source: string): string {
  try {
    return derivePhase1MathAccessibleText(source);
  } catch (error) {
    if (error instanceof Phase1SafeMathError) {
      throw new ContentCompilationError(error.code, error.message);
    }
    throw error;
  }
}

function assertTreeLimits(tree: Root): void {
  let nodeCount = 0;
  const visit = (
    node: { readonly children?: readonly unknown[] },
    depth: number,
  ): void => {
    nodeCount += 1;
    if (nodeCount > MAX_AST_NODES) {
      throw new ContentCompilationError(
        "ast-nodes-limit",
        `Markdown AST exceeds ${MAX_AST_NODES} nodes`,
      );
    }
    if (depth > MAX_AST_DEPTH) {
      throw new ContentCompilationError(
        "ast-depth-limit",
        `Markdown AST exceeds depth ${MAX_AST_DEPTH}`,
      );
    }
    for (const child of node.children ?? []) {
      if (typeof child !== "object" || child === null) {
        throw new ContentCompilationError("ast-shape", "Invalid Markdown AST child");
      }
      visit(child as { readonly children?: readonly unknown[] }, depth + 1);
    }
  };
  visit(tree, 0);
}

function assertDataDepth(value: unknown, depth: number): void {
  if (depth > MAX_YAML_DEPTH) {
    throw new ContentCompilationError(
      "YAML-depth-limit",
      `YAML data exceeds depth ${MAX_YAML_DEPTH}`,
    );
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      assertDataDepth(child, depth + 1);
    }
  } else if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) {
      assertDataDepth(child, depth + 1);
    }
  }
}

function isYamlNode(node: RootContent): node is RootContent & { value: string } {
  return node.type === "yaml" && "value" in node && typeof node.value === "string";
}

function defaultRegistry(): ContentCompilerRegistry {
  return {
    skillIds: PHASE_1_SKILLS,
    generators: PHASE_1_GENERATORS,
    assetIds: new Set(),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function boundedDiagnostic(error: unknown): string {
  return boundedText(errorMessage(error));
}

function boundedText(message: string): string {
  return message.length <= MAX_DIAGNOSTIC_CHARACTERS
    ? message
    : `${message.slice(0, MAX_DIAGNOSTIC_CHARACTERS)}…`;
}
