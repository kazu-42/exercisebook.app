import {
  PRINT_DOCUMENT_SCHEMA,
  PRINT_PROJECTOR_VERSION,
  type AnswerKeyPrintBlockV1,
  type PrintAttributionV1,
  type PrintDocumentV1,
  type PrintInlineV1,
  type PrintProblemV1,
  type StudentPrintBlockV1,
} from "./types.js";

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;
const INTEGER_PATTERN = /^-?(?:0|[1-9][0-9]*)$/u;
const FORBIDDEN_STUDENT_KEYS =
  /^(?:answer|answers|answerKey|answerMetadata|canonicalAnswer|canonicalResponse|solution|solutionTrace|scoringRule|rubric)$/iu;
const FORBIDDEN_STUDENT_ATTRIBUTE_KEYS =
  /^(?:data-answer|data-solution|data-canonical-answer|aria-answer|answer-key)$/iu;

export class PrintDocumentValidationError extends Error {
  public readonly path: string;

  public constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "PrintDocumentValidationError";
    this.path = path;
  }
}

export function validatePrintDocumentV1(value: unknown): PrintDocumentV1 {
  const document = expectRecord(value, "$");
  expectExactKeys(
    document,
    [
      "schema",
      "sourceInstanceHash",
      "projectorVersion",
      "paper",
      "locale",
      "variant",
      "title",
      "blocks",
      "attributions",
    ],
    [],
    "$",
  );

  expectLiteral(document.schema, PRINT_DOCUMENT_SCHEMA, "$.schema");
  expectPattern(document.sourceInstanceHash, HASH_PATTERN, "$.sourceInstanceHash");
  expectLiteral(
    document.projectorVersion,
    PRINT_PROJECTOR_VERSION,
    "$.projectorVersion",
  );
  expectLiteral(document.paper, "a4", "$.paper");
  expectPattern(document.locale, LOCALE_PATTERN, "$.locale");
  expectBoundedString(document.title, "$.title", 1, 1_000);

  if (document.variant !== "student" && document.variant !== "answer-key") {
    fail("$.variant", 'expected "student" or "answer-key"');
  }

  const blocks = expectArray(document.blocks, "$.blocks");
  if (blocks.length === 0) {
    fail("$.blocks", "must contain at least one block");
  }
  for (const [index, block] of blocks.entries()) {
    validateBlock(block, document.variant === "answer-key", `$.blocks[${index}]`);
  }

  const heading = blocks.find((block) => {
    const candidate = expectRecord(block, "$.blocks[*]");
    return candidate.type === "heading" && candidate.level === 1;
  });
  if (heading === undefined) {
    fail("$.blocks", "must contain a level-1 heading");
  }

  const attributions = expectArray(document.attributions, "$.attributions");
  if (attributions.length === 0) {
    fail("$.attributions", "must contain at least one attribution");
  }
  for (const [index, attribution] of attributions.entries()) {
    validateAttribution(attribution, `$.attributions[${index}]`);
  }

  const result = value as PrintDocumentV1;
  validateDocumentRelationships(result);
  if (result.variant === "student") {
    assertStudentDocumentHasNoAnswerData(result);
  }
  return result;
}

export function assertStudentDocumentHasNoAnswerData(
  document: PrintDocumentV1,
  forbiddenText: readonly string[] = [],
): void {
  if (document.variant !== "student") {
    return;
  }

  visitStudentValue(document, "$");
  const serialized = JSON.stringify(document);
  for (const [index, marker] of forbiddenText.entries()) {
    if (marker.length === 0) {
      fail(`forbiddenText[${index}]`, "leak marker must not be empty");
    }
    if (serialized.includes(marker)) {
      fail("$", `student document contains forbidden source text marker ${index}`);
    }
  }
}

function validateBlock(
  value: unknown,
  allowAnswerKey: boolean,
  path: string,
): asserts value is AnswerKeyPrintBlockV1 {
  const block = expectRecord(value, path);
  const type = expectBoundedString(block.type, `${path}.type`, 1, 64);

  switch (type) {
    case "heading":
      expectExactKeys(block, ["type", "id", "level", "content"], [], path);
      validateId(block.id, `${path}.id`);
      if (block.level !== 1 && block.level !== 2 && block.level !== 3) {
        fail(`${path}.level`, "expected 1, 2, or 3");
      }
      validateInlineArray(block.content, `${path}.content`);
      return;
    case "paragraph":
      expectExactKeys(block, ["type", "id", "content"], [], path);
      validateId(block.id, `${path}.id`);
      validateInlineArray(block.content, `${path}.content`);
      return;
    case "worked-example": {
      expectExactKeys(block, ["type", "id", "title", "prompt", "steps"], [], path);
      validateId(block.id, `${path}.id`);
      expectBoundedString(block.title, `${path}.title`, 1, 500);
      validateInlineArray(block.prompt, `${path}.prompt`);
      const steps = expectArray(block.steps, `${path}.steps`);
      if (steps.length === 0) {
        fail(`${path}.steps`, "must contain at least one visible worked step");
      }
      for (const [index, step] of steps.entries()) {
        validateInlineArray(step, `${path}.steps[${index}]`);
      }
      return;
    }
    case "problem-group": {
      expectExactKeys(block, ["type", "id", "title", "problems"], [], path);
      validateId(block.id, `${path}.id`);
      expectBoundedString(block.title, `${path}.title`, 1, 500);
      const problems = expectArray(block.problems, `${path}.problems`);
      if (problems.length === 0) {
        fail(`${path}.problems`, "must contain at least one problem");
      }
      for (const [index, problem] of problems.entries()) {
        validateProblem(problem, `${path}.problems[${index}]`);
      }
      return;
    }
    case "fraction-bar": {
      expectExactKeys(block, ["type", "id", "label", "caption", "bars"], [], path);
      validateId(block.id, `${path}.id`);
      expectBoundedString(block.label, `${path}.label`, 1, 2_000);
      expectBoundedString(block.caption, `${path}.caption`, 1, 2_000);
      const bars = expectArray(block.bars, `${path}.bars`);
      if (bars.length === 0 || bars.length > 12) {
        fail(`${path}.bars`, "must contain between 1 and 12 bars");
      }
      for (const [index, barValue] of bars.entries()) {
        const barPath = `${path}.bars[${index}]`;
        const bar = expectRecord(barValue, barPath);
        expectExactKeys(bar, ["numerator", "denominator", "label"], [], barPath);
        const numerator = expectInteger(bar.numerator, `${barPath}.numerator`);
        const denominator = expectInteger(bar.denominator, `${barPath}.denominator`);
        if (denominator < 1 || denominator > 100) {
          fail(`${barPath}.denominator`, "must be between 1 and 100");
        }
        if (numerator < 0 || numerator > denominator) {
          fail(`${barPath}.numerator`, "must be between zero and the denominator");
        }
        expectBoundedString(bar.label, `${barPath}.label`, 1, 500);
      }
      return;
    }
    case "working-space":
      expectExactKeys(block, ["type", "id", "label", "lines"], [], path);
      validateId(block.id, `${path}.id`);
      expectBoundedString(block.label, `${path}.label`, 1, 500);
      expectIntegerInRange(block.lines, `${path}.lines`, 1, 20);
      return;
    case "page-break":
      expectExactKeys(block, ["type", "id"], [], path);
      validateId(block.id, `${path}.id`);
      return;
    case "answer-key": {
      if (!allowAnswerKey) {
        fail(path, "answer-key blocks are forbidden in student documents");
      }
      expectExactKeys(
        block,
        ["type", "id", "problemId", "ordinal", "canonicalResponse", "explanation"],
        [],
        path,
      );
      validateId(block.id, `${path}.id`);
      validateId(block.problemId, `${path}.problemId`);
      expectIntegerInRange(block.ordinal, `${path}.ordinal`, 1, 10_000);
      validateInlineArray(block.canonicalResponse, `${path}.canonicalResponse`);
      const explanation = expectArray(block.explanation, `${path}.explanation`);
      if (explanation.length === 0) {
        fail(`${path}.explanation`, "must contain at least one step");
      }
      for (const [index, step] of explanation.entries()) {
        expectBoundedString(step, `${path}.explanation[${index}]`, 1, 5_000);
      }
      return;
    }
    default:
      fail(`${path}.type`, `unsupported print block "${type}"`);
  }
}

function validateProblem(
  value: unknown,
  path: string,
): asserts value is PrintProblemV1 {
  const problem = expectRecord(value, path);
  expectExactKeys(
    problem,
    [
      "id",
      "ordinal",
      "instruction",
      "promptAccessibleText",
      "prompt",
      "response",
      "provenance",
    ],
    [],
    path,
  );
  validateId(problem.id, `${path}.id`);
  expectIntegerInRange(problem.ordinal, `${path}.ordinal`, 1, 10_000);
  expectBoundedString(problem.instruction, `${path}.instruction`, 1, 2_000);
  expectBoundedString(
    problem.promptAccessibleText,
    `${path}.promptAccessibleText`,
    1,
    2_000,
  );
  validateInlineArray(problem.prompt, `${path}.prompt`);

  const response = expectRecord(problem.response, `${path}.response`);
  expectExactKeys(response, ["type", "label", "lines"], [], `${path}.response`);
  expectLiteral(response.type, "fraction", `${path}.response.type`);
  expectBoundedString(response.label, `${path}.response.label`, 1, 1_000);
  expectIntegerInRange(response.lines, `${path}.response.lines`, 1, 20);

  const provenance = expectRecord(problem.provenance, `${path}.provenance`);
  expectExactKeys(
    provenance,
    [
      "contentId",
      "contentRevision",
      "sourceHash",
      "contentHash",
      "compilerVersion",
      "generatorId",
      "generatorVersion",
      "generationAttempt",
    ],
    [],
    `${path}.provenance`,
  );
  validateId(provenance.contentId, `${path}.provenance.contentId`);
  expectIntegerInRange(
    provenance.contentRevision,
    `${path}.provenance.contentRevision`,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  expectPattern(provenance.sourceHash, HASH_PATTERN, `${path}.provenance.sourceHash`);
  expectPattern(provenance.contentHash, HASH_PATTERN, `${path}.provenance.contentHash`);
  expectLiteral(
    provenance.compilerVersion,
    "exercisebook-content-compiler/1",
    `${path}.provenance.compilerVersion`,
  );
  validateId(provenance.generatorId, `${path}.provenance.generatorId`);
  expectBoundedString(
    provenance.generatorVersion,
    `${path}.provenance.generatorVersion`,
    1,
    128,
  );
  expectIntegerInRange(
    provenance.generationAttempt,
    `${path}.provenance.generationAttempt`,
    0,
    127,
  );
}

function validateInlineArray(
  value: unknown,
  path: string,
): asserts value is readonly PrintInlineV1[] {
  const inlines = expectArray(value, path);
  if (inlines.length === 0) {
    fail(path, "must contain at least one inline");
  }
  for (const [index, inlineValue] of inlines.entries()) {
    const inlinePath = `${path}[${index}]`;
    const inline = expectRecord(inlineValue, inlinePath);
    const type = expectBoundedString(inline.type, `${inlinePath}.type`, 1, 32);
    switch (type) {
      case "text":
        expectExactKeys(inline, ["type", "text"], [], inlinePath);
        expectBoundedString(inline.text, `${inlinePath}.text`, 1, 10_000);
        break;
      case "operator":
        expectExactKeys(inline, ["type", "symbol", "accessibleText"], [], inlinePath);
        expectBoundedString(inline.symbol, `${inlinePath}.symbol`, 1, 20);
        expectBoundedString(
          inline.accessibleText,
          `${inlinePath}.accessibleText`,
          1,
          2_000,
        );
        break;
      case "fraction": {
        expectExactKeys(
          inline,
          ["type", "numerator", "denominator", "accessibleText"],
          [],
          inlinePath,
        );
        expectPattern(inline.numerator, INTEGER_PATTERN, `${inlinePath}.numerator`);
        if (inline.numerator === "-0") {
          fail(`${inlinePath}.numerator`, "must not be negative zero");
        }
        const denominator = expectPattern(
          inline.denominator,
          INTEGER_PATTERN,
          `${inlinePath}.denominator`,
        );
        if (BigInt(denominator) <= 0n) {
          fail(`${inlinePath}.denominator`, "must be a positive integer");
        }
        expectBoundedString(
          inline.accessibleText,
          `${inlinePath}.accessibleText`,
          1,
          2_000,
        );
        break;
      }
      default:
        fail(`${inlinePath}.type`, `unsupported inline "${type}"`);
    }
  }
}

function validateAttribution(
  value: unknown,
  path: string,
): asserts value is PrintAttributionV1 {
  const attribution = expectRecord(value, path);
  expectExactKeys(
    attribution,
    [
      "id",
      "title",
      "author",
      "sourceUrl",
      "licenseId",
      "attributionText",
      "publicationStatus",
      "modifications",
    ],
    [],
    path,
  );
  validateId(attribution.id, `${path}.id`);
  expectBoundedString(attribution.title, `${path}.title`, 1, 240);
  expectBoundedString(attribution.author, `${path}.author`, 1, 240);
  const sourceUrl = expectBoundedString(
    attribution.sourceUrl,
    `${path}.sourceUrl`,
    1,
    2_048,
  );
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    fail(`${path}.sourceUrl`, "must be an absolute URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    fail(`${path}.sourceUrl`, "must use http or https");
  }
  expectBoundedString(attribution.licenseId, `${path}.licenseId`, 1, 160);
  expectBoundedString(attribution.attributionText, `${path}.attributionText`, 1, 1_000);
  if (
    attribution.publicationStatus !== "draft" &&
    attribution.publicationStatus !== "published"
  ) {
    fail(`${path}.publicationStatus`, 'expected "draft" or "published"');
  }
  const modifications = expectArray(attribution.modifications, `${path}.modifications`);
  if (modifications.length > 50) {
    fail(`${path}.modifications`, "must contain no more than 50 entries");
  }
  for (const [index, modification] of modifications.entries()) {
    expectBoundedString(modification, `${path}.modifications[${index}]`, 1, 500);
  }
}

function validateDocumentRelationships(document: PrintDocumentV1): void {
  const blockIds = new Set<string>();
  const problemIds: string[] = [];
  const problemOrdinals: number[] = [];
  const keyProblemIds: string[] = [];
  const keyOrdinals: number[] = [];

  for (const [blockIndex, block] of document.blocks.entries()) {
    if (blockIds.has(block.id)) {
      fail(`$.blocks[${blockIndex}].id`, `duplicate block ID "${block.id}"`);
    }
    blockIds.add(block.id);

    if (block.type === "problem-group") {
      for (const [problemIndex, problem] of block.problems.entries()) {
        if (problemIds.includes(problem.id)) {
          fail(
            `$.blocks[${blockIndex}].problems[${problemIndex}].id`,
            `duplicate problem ID "${problem.id}"`,
          );
        }
        problemIds.push(problem.id);
        problemOrdinals.push(problem.ordinal);
      }
    } else if (block.type === "answer-key") {
      keyProblemIds.push(block.problemId);
      keyOrdinals.push(block.ordinal);
    }
  }

  for (const [index, ordinal] of problemOrdinals.entries()) {
    if (ordinal !== index + 1) {
      fail("$.blocks", "problem ordinals must be contiguous and match document order");
    }
  }

  if (problemIds.length === 0) {
    fail("$.blocks", "must contain at least one problem");
  }

  if (document.variant === "answer-key") {
    if (
      keyProblemIds.length !== problemIds.length ||
      keyProblemIds.some((problemId, index) => problemId !== problemIds[index])
    ) {
      fail(
        "$.blocks",
        "answer-key entries must match every problem ID in document order",
      );
    }
    if (keyOrdinals.some((ordinal, index) => ordinal !== problemOrdinals[index])) {
      fail("$.blocks", "answer-key ordinals must match their problem ordinals");
    }
  }

  const attributionIds = new Set<string>();
  for (const [index, attribution] of document.attributions.entries()) {
    if (attributionIds.has(attribution.id)) {
      fail(
        `$.attributions[${index}].id`,
        `duplicate attribution ID "${attribution.id}"`,
      );
    }
    attributionIds.add(attribution.id);
  }
}

function visitStudentValue(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      visitStudentValue(item, `${path}[${index}]`);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (
      FORBIDDEN_STUDENT_KEYS.test(key) ||
      FORBIDDEN_STUDENT_ATTRIBUTE_KEYS.test(key)
    ) {
      fail(`${path}.${key}`, "answer-only data is forbidden in student output");
    }
    if (key === "type" && child === "answer-key") {
      fail(path, "answer-key block is forbidden in student output");
    }
    visitStudentValue(child, `${path}.${key}`);
  }
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    fail(path, "expected a plain object");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function expectArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail(path, "expected an array");
  }
  return value;
}

function expectExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail(`${path}.${key}`, "unknown field");
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail(`${path}.${key}`, "required field is missing");
    }
  }
}

function expectLiteral<T extends string>(
  value: unknown,
  expected: T,
  path: string,
): asserts value is T {
  if (value !== expected) {
    fail(path, `expected "${expected}"`);
  }
}

function expectPattern(value: unknown, pattern: RegExp, path: string): string {
  const text = expectBoundedString(value, path, 1, 10_000);
  if (!pattern.test(text)) {
    fail(path, "has an invalid format");
  }
  return text;
}

function expectBoundedString(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    fail(path, `expected a string of length ${minimum}..${maximum}`);
  }
  return value;
}

function expectInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    fail(path, "expected a safe integer");
  }
  return value;
}

function expectIntegerInRange(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  const integer = expectInteger(value, path);
  if (integer < minimum || integer > maximum) {
    fail(path, `expected an integer in range ${minimum}..${maximum}`);
  }
  return integer;
}

function validateId(value: unknown, path: string): string {
  return expectPattern(value, ID_PATTERN, path);
}

function fail(path: string, message: string): never {
  throw new PrintDocumentValidationError(path, message);
}

export type { StudentPrintBlockV1 };
