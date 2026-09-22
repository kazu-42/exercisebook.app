import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isAlias, parseDocument, visit } from "yaml";
import type { Topic, TopicId } from "../src/contracts";

const SOURCE_SCHEMA = "exercisebook.studio-lesson-source/v1";
const DOCUMENT_SCHEMA = "exercisebook.studio-lesson/v1";
const COMPILER_VERSION = "studio-lesson-compiler@1";
const REVIEW_LICENSE = "LicenseRef-ExerciseBook-Review-Only";
const MAX_SOURCE_BYTES = 16_384;
const MAX_MODEL_INTEGER = 1_000;

export const STUDIO_LESSON_SOURCE_PATHS = [
  "content/studio/signed-numbers.md",
  "content/studio/expressions.md",
  "content/studio/equations.md",
  "content/studio/signed-numbers-standard.md",
  "content/studio/expressions-standard.md",
  "content/studio/equations-standard.md",
] as const;

const SOURCE_TOPICS: Readonly<Record<string, TopicId>> = {
  "content/studio/signed-numbers.md": "signed-numbers",
  "content/studio/expressions.md": "expressions",
  "content/studio/equations.md": "equations",
  "content/studio/signed-numbers-standard.md": "signed-numbers",
  "content/studio/expressions-standard.md": "expressions",
  "content/studio/equations-standard.md": "equations",
};

// These are semantic example inputs, never authored answer or explanation text.
// The deterministic model derives the example prompt and all explanation steps.
export type StudioExampleModel =
  | {
      readonly kind: "arithmetic";
      readonly operation: "add" | "subtract" | "multiply" | "divide";
      readonly left: number;
      readonly right: number;
    }
  | {
      readonly kind: "expression";
      readonly coefficient: number;
      readonly value: number;
      readonly constant: number;
    }
  | {
      readonly kind: "equation";
      readonly coefficient: number;
      readonly constant: number;
      readonly right: number;
    };

export interface StudioLessonDocument {
  readonly schema: typeof DOCUMENT_SCHEMA;
  readonly compilerVersion: typeof COMPILER_VERSION;
  readonly revision: number;
  readonly locale: "ja";
  readonly topic: Omit<Topic, "lesson">;
  readonly lesson: {
    readonly title: string;
    readonly rule: string;
  };
  readonly exampleModel: StudioExampleModel;
  readonly provenance: {
    readonly sourcePath: string;
    readonly sourceRevision: number;
    readonly sourceHash: string;
    readonly origin: "original";
    readonly authors: readonly string[];
    readonly attribution: string;
    readonly licenseId: typeof REVIEW_LICENSE;
    readonly status: "draft";
  };
}

export class StudioContentError extends Error {
  constructor(message: string) {
    super(`Studio lesson source: ${message}`);
    this.name = "StudioContentError";
  }
}

function reject(message: string): never {
  throw new StudioContentError(message);
}

function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return reject("expected an object");
  }
  const keys = Object.keys(value);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
    return reject("unknown or missing field");
  }
  return value as Record<string, unknown>;
}

function plainText(value: unknown, maximum = 240): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    !value.isWellFormed() ||
    /[\p{Cc}\p{Cf}<>`\\[\]{}*_#$]/u.test(value) ||
    value.includes("::")
  ) {
    return reject("expected bounded plain text without markup or controls");
  }
  return value;
}

function requireLiteral<T extends string>(value: unknown, expected: T): T {
  if (value !== expected)
    return reject("unsupported schema, locale, status, or license");
  return expected;
}

function integer(value: unknown, maximum = MAX_MODEL_INTEGER): number {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/.test(value)) {
    return reject("expected a canonical integer");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || Math.abs(parsed) > maximum) {
    return reject("integer is outside the supported example range");
  }
  return parsed;
}

function compileExample(value: unknown, topicId: TopicId): StudioExampleModel {
  if (value === null || typeof value !== "object" || !("kind" in value)) {
    return reject("missing semantic example model");
  }
  if (topicId === "signed-numbers" && value.kind === "arithmetic") {
    const data = record(value, ["kind", "operation", "left", "right"]);
    const operation = data.operation;
    if (
      operation !== "add" &&
      operation !== "subtract" &&
      operation !== "multiply" &&
      operation !== "divide"
    ) {
      return reject("unknown arithmetic operation");
    }
    const left = integer(data.left);
    const right = integer(data.right);
    if (operation === "divide" && (right === 0 || left % right !== 0)) {
      return reject("division examples require a nonzero divisor and integer result");
    }
    return { kind: "arithmetic", operation, left, right };
  }
  if (topicId === "expressions" && value.kind === "expression") {
    const data = record(value, ["kind", "coefficient", "value", "constant"]);
    return {
      kind: "expression",
      coefficient: integer(data.coefficient),
      value: integer(data.value),
      constant: integer(data.constant),
    };
  }
  if (topicId === "equations" && value.kind === "equation") {
    const data = record(value, ["kind", "coefficient", "constant", "right"]);
    const coefficient = integer(data.coefficient);
    const constant = integer(data.constant);
    const right = integer(data.right);
    if (coefficient === 0 || (right - constant) % coefficient !== 0) {
      return reject(
        "equation examples require a nonzero coefficient and integer solution",
      );
    }
    return { kind: "equation", coefficient, constant, right };
  }
  return reject("unknown example model or topic mismatch");
}

function parseFrontmatter(source: string): unknown {
  const document = parseDocument(source, {
    schema: "failsafe",
    strict: true,
    stringKeys: true,
    uniqueKeys: true,
    version: "1.2",
  });
  if (document.errors.length > 0 || document.warnings.length > 0) {
    return reject("invalid or unsupported YAML");
  }
  let nodeCount = 0;
  visit(document, (_key, node, path) => {
    nodeCount += 1;
    if (nodeCount > 160 || path.length > 8) reject("YAML structure limit exceeded");
    if (
      isAlias(node) ||
      (node !== null &&
        typeof node === "object" &&
        (("anchor" in node && node.anchor !== undefined) ||
          ("tag" in node && node.tag !== undefined)))
    ) {
      reject("YAML aliases, anchors, and tags are not supported");
    }
  });
  return document.toJS({ maxAliasCount: 0 });
}

/** Compile the deliberately small grammar: strict YAML + one plain paragraph. */
export function compileStudioLessonSource(
  source: string,
  sourcePath: string,
): StudioLessonDocument {
  if (!STUDIO_LESSON_SOURCE_PATHS.some((path) => path === sourcePath)) {
    return reject("unregistered source path");
  }
  if (
    typeof source !== "string" ||
    !source.isWellFormed() ||
    Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES
  ) {
    return reject("invalid or oversized source");
  }
  const normalized = source.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n"))
    return reject("YAML frontmatter must come first");
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) return reject("missing frontmatter closing delimiter");
  const data = record(parseFrontmatter(normalized.slice(4, end)), [
    "schema",
    "revision",
    "locale",
    "status",
    "author",
    "attribution",
    "license",
    "topic",
    "lesson",
    "exampleModel",
  ]);
  requireLiteral(data.schema, SOURCE_SCHEMA);
  requireLiteral(data.locale, "ja");
  requireLiteral(data.status, "draft");
  requireLiteral(data.license, REVIEW_LICENSE);
  const revision = integer(data.revision, 1_000_000);
  if (revision < 1) return reject("revision must be positive");
  const topic = record(data.topic, [
    "id",
    "number",
    "title",
    "subtitle",
    "description",
    "prerequisite",
    "sample",
  ]);
  const id = topic.id;
  if (id !== "signed-numbers" && id !== "expressions" && id !== "equations") {
    return reject("unknown topic");
  }
  if (SOURCE_TOPICS[sourcePath] !== id) return reject("source path and topic disagree");
  const number = plainText(topic.number, 2);
  const expectedNumber =
    id === "signed-numbers" ? "01" : id === "expressions" ? "02" : "03";
  if (number !== expectedNumber) return reject("topic order must match the catalog");
  const lesson = record(data.lesson, ["title"]);
  const body = normalized.slice(end + 5).trim();
  if (/^(?:#{1,6}\s|[-+]\s|[0-9]+[.)]\s|---)/u.test(body)) {
    return reject("only a plain paragraph is supported");
  }
  return {
    schema: DOCUMENT_SCHEMA,
    compilerVersion: COMPILER_VERSION,
    revision,
    locale: "ja",
    topic: {
      id,
      number,
      title: plainText(topic.title, 80),
      subtitle: plainText(topic.subtitle, 120),
      description: plainText(topic.description),
      prerequisite: plainText(topic.prerequisite, 120),
      sample: plainText(topic.sample, 120),
    },
    lesson: {
      title: plainText(lesson.title, 120),
      rule: plainText(body, 800),
    },
    exampleModel: compileExample(data.exampleModel, id),
    provenance: {
      sourcePath,
      sourceRevision: revision,
      sourceHash: createHash("sha256").update(source, "utf8").digest("hex"),
      origin: "original",
      authors: [plainText(data.author, 160)],
      attribution: plainText(data.attribution),
      licenseId: REVIEW_LICENSE,
      status: "draft",
    },
  };
}

export async function compileStudioLessonSources(
  root: string,
): Promise<readonly StudioLessonDocument[]> {
  return Promise.all(
    STUDIO_LESSON_SOURCE_PATHS.map(async (sourcePath) =>
      compileStudioLessonSource(
        await readFile(resolve(root, sourcePath), "utf8"),
        sourcePath,
      ),
    ),
  );
}

const COMPILED_PATH = "apps/studio/server/compiled-lessons.json";

export async function verifyCompiledStudioLessons(root: string): Promise<void> {
  const expected = await compileStudioLessonSources(root);
  const actual: unknown = JSON.parse(
    await readFile(resolve(root, COMPILED_PATH), "utf8"),
  );
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    reject("compiled AST is stale; run studio:content:generate");
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1 || (args[0] !== "--check" && args[0] !== "--write")) {
    reject("expected exactly --check or --write");
  }
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  if (args[0] === "--check") {
    await verifyCompiledStudioLessons(root);
    process.stdout.write(
      "Studio lesson sources and committed AST match (6 draft lessons).\n",
    );
  } else {
    const documents = await compileStudioLessonSources(root);
    await writeFile(
      resolve(root, COMPILED_PATH),
      `${JSON.stringify(documents, null, 2)}\n`,
    );
    process.stdout.write(
      "Compiled 6 studio draft lessons; publication remains unapproved.\n",
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
