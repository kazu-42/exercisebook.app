import {
  assertSafeDataObjectGraph,
  deriveFractionAdditionPromptAccessibleText,
  FractionAdditionWorkedExampleModelV1Schema,
  type AttributionV1,
  type FractionAdditionWorkedExampleModelV1,
} from "@exercisebook/schemas";

import type {
  PrintFractionBarV1,
  PrintFractionV1,
  PrintInlineV1,
  PrintOperatorV1,
} from "./types.js";
import {
  PRINT_DOCUMENT_V2_PAPER,
  PRINT_DOCUMENT_V2_LOCALE,
  PRINT_DOCUMENT_V2_SCHEMA,
  PRINT_DOCUMENT_V2_SOURCE_INSTANCE_SCHEMA,
  PRINT_PROJECTOR_V2_VERSION,
  type AnswerKeyPrintBlockV2,
  type AnswerKeyPrintDocumentV2,
  type PrintAnswerKeyBlockV2,
  type PrintDocumentV2,
  type PrintFallbackBlockV2,
  type PrintFractionAdditionPromptV2,
  type PrintLessonHeadingBlockV2,
  type PrintLessonParagraphBlockV2,
  type PrintProblemGroupBlockV2,
  type PrintProblemProvenanceV2,
  type PrintProblemV2,
  type PrintSummaryBlockV2,
  type PrintTitleHeadingBlockV2,
  type PrintWorkedExampleBlockV2,
  type PrintWorkedExamplePromptV2,
  type PrintWorkingSpaceBlockV2,
  type StudentPrintBlockV2,
  type StudentPrintDocumentV2,
} from "./types-v2.js";

export const MAX_PRINT_DOCUMENT_V2_BLOCKS = 1_024;
export const MAX_PRINT_DOCUMENT_V2_PROBLEMS = 200;
export const MAX_PRINT_DOCUMENT_V2_ATTRIBUTIONS = 100;
export const MAX_PRINT_DOCUMENT_V2_LESSON_PARAGRAPHS = 8;
export const MAX_PRINT_DOCUMENT_V2_WORKED_EXAMPLE_STEPS = 8;
export const MAX_PRINT_DOCUMENT_V2_SOLUTION_STEPS = 20;

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const STABLE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]*[a-z0-9])?$/u;
const CANONICAL_INTEGER_PATTERN = /^(?:0|-?[1-9][0-9]{0,127})$/u;
const POSITIVE_CANONICAL_INTEGER_PATTERN = /^[1-9][0-9]{0,127}$/u;
const WORKSHEET_SUMMARY_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2}) · ([1-9][0-9]{0,2}) minutes$/u;
const FORBIDDEN_STUDENT_KEYS =
  /^(?:answer|answers|answerKey|answerMetadata|baseSeed|canonicalAnswer|canonicalAnswers|canonicalResponse|misconceptions|rubric|scoringRule|seedSecretVersion|slotSeed|solution|solutionTrace)$/iu;
const FIXED_BLOCK_IDS = {
  worksheetTitle: "worksheet-title",
  worksheetSummary: "worksheet-summary",
  lessonHeading: "lesson-heading",
  workedExample: "worked-example",
  answerKeyPageBreak: "answer-key-page-break",
  answerKeyTitle: "answer-key-title",
} as const;

type PlainRecord = Record<string, unknown>;

interface ParsedStudentPrefix {
  readonly blocks: StudentPrintBlockV2[];
  readonly nextIndex: number;
  readonly problems: readonly PrintProblemV2[];
  readonly worksheetTitle: string;
}

export class PrintDocumentV2ValidationError extends Error {
  public readonly path: string;

  public constructor(path: string, message: string, options?: ErrorOptions) {
    super(`${path}: ${message}`, options);
    this.name = "PrintDocumentV2ValidationError";
    this.path = path;
  }
}

export function validateStudentPrintDocumentV2(value: unknown): StudentPrintDocumentV2 {
  const document = validatePrintDocumentV2(value);
  if (document.variant !== "student") {
    fail("$.variant", 'expected "student"');
  }
  return document;
}

export function validateAnswerKeyPrintDocumentV2(
  value: unknown,
): AnswerKeyPrintDocumentV2 {
  const document = validatePrintDocumentV2(value);
  if (document.variant !== "answer-key") {
    fail("$.variant", 'expected "answer-key"');
  }
  return document;
}

/**
 * Validate one V2 semantic print document and return a fully detached snapshot.
 * No V1 validation entrypoint participates in this boundary.
 */
export function validatePrintDocumentV2(value: unknown): PrintDocumentV2 {
  assertSafeGraph(value);
  const source = expectExactRecord(
    value,
    [
      "schema",
      "sourceInstanceSchema",
      "sourceInstanceHash",
      "projectorVersion",
      "paper",
      "locale",
      "variant",
      "title",
      "blocks",
      "attributions",
    ],
    "$",
  );

  expectLiteral(source.schema, PRINT_DOCUMENT_V2_SCHEMA, "$.schema");
  expectLiteral(
    source.sourceInstanceSchema,
    PRINT_DOCUMENT_V2_SOURCE_INSTANCE_SCHEMA,
    "$.sourceInstanceSchema",
  );
  const sourceInstanceHash = expectPattern(
    source.sourceInstanceHash,
    HASH_PATTERN,
    "$.sourceInstanceHash",
    64,
  );
  expectLiteral(
    source.projectorVersion,
    PRINT_PROJECTOR_V2_VERSION,
    "$.projectorVersion",
  );
  expectLiteral(source.paper, PRINT_DOCUMENT_V2_PAPER, "$.paper");
  expectLiteral(source.locale, PRINT_DOCUMENT_V2_LOCALE, "$.locale");
  // Answer-key titles append the exact 13-code-unit suffix to a source title
  // that may itself occupy the full 240-code-unit worksheet contract.
  const title = expectBoundedString(source.title, "$.title", 1, 253);
  const variant = expectVariant(source.variant, "$.variant");

  if (variant === "student") {
    visitStudentValue(source, "$");
  }

  const rawBlocks = expectBoundedArray(
    source.blocks,
    "$.blocks",
    1,
    MAX_PRINT_DOCUMENT_V2_BLOCKS,
  );
  const blockIds = new Set<string>();
  const prefix = parseStudentPrefix(rawBlocks, blockIds);
  const attributions = parseAttributions(source.attributions);

  if (variant === "student") {
    if (prefix.nextIndex !== rawBlocks.length) {
      fail(
        `$.blocks[${prefix.nextIndex}]`,
        "student documents must end after the final working-space block",
      );
    }
    if (title !== prefix.worksheetTitle) {
      fail("$.title", "must equal the worksheet title heading for student output");
    }
    return {
      schema: PRINT_DOCUMENT_V2_SCHEMA,
      sourceInstanceSchema: PRINT_DOCUMENT_V2_SOURCE_INSTANCE_SCHEMA,
      sourceInstanceHash,
      projectorVersion: PRINT_PROJECTOR_V2_VERSION,
      paper: PRINT_DOCUMENT_V2_PAPER,
      locale: PRINT_DOCUMENT_V2_LOCALE,
      variant: "student",
      title,
      blocks: prefix.blocks,
      attributions,
    };
  }

  const answerBlocks = parseAnswerKeyAppendix(rawBlocks, prefix, blockIds);
  if (title !== `${prefix.worksheetTitle} — Answer key`) {
    fail("$.title", "must equal the worksheet title with the answer-key suffix");
  }
  return {
    schema: PRINT_DOCUMENT_V2_SCHEMA,
    sourceInstanceSchema: PRINT_DOCUMENT_V2_SOURCE_INSTANCE_SCHEMA,
    sourceInstanceHash,
    projectorVersion: PRINT_PROJECTOR_V2_VERSION,
    paper: PRINT_DOCUMENT_V2_PAPER,
    locale: PRINT_DOCUMENT_V2_LOCALE,
    variant: "answer-key",
    title,
    blocks: [...prefix.blocks, ...answerBlocks],
    attributions,
  };
}

/**
 * A structural guard for callers that already hold a V2 document candidate.
 * Worked-example arithmetic is intentionally allowed; practice answer and
 * answer-key authority fields are not.
 */
export function assertStudentPrintDocumentV2HasNoAnswerData(value: unknown): void {
  assertSafeGraph(value);
  const source = expectRecord(value, "$");
  if (source.variant !== "student") {
    return;
  }
  visitStudentValue(source, "$");
}

function parseStudentPrefix(
  values: readonly unknown[],
  blockIds: Set<string>,
): ParsedStudentPrefix {
  let index = 0;
  const blocks: StudentPrintBlockV2[] = [];

  const title = parseTitleHeading(
    values[index],
    FIXED_BLOCK_IDS.worksheetTitle,
    `$.blocks[${index}]`,
  );
  registerBlockId(title.id, index, blockIds);
  blocks.push(title);
  index += 1;

  const summary = parseSummary(values[index], `$.blocks[${index}]`);
  registerBlockId(summary.id, index, blockIds);
  blocks.push(summary);
  index += 1;

  const lessonHeading = parseLessonHeading(values[index], `$.blocks[${index}]`);
  registerBlockId(lessonHeading.id, index, blockIds);
  blocks.push(lessonHeading);
  index += 1;

  let paragraphCount = 0;
  while (
    paragraphCount < MAX_PRINT_DOCUMENT_V2_LESSON_PARAGRAPHS &&
    isBlockType(values[index], "paragraph")
  ) {
    const paragraph = parseLessonParagraph(
      values[index],
      paragraphCount + 1,
      lessonHeading.sourceNodeId,
      `$.blocks[${index}]`,
    );
    registerBlockId(paragraph.id, index, blockIds);
    blocks.push(paragraph);
    paragraphCount += 1;
    index += 1;
  }
  if (paragraphCount === 0) {
    fail(
      `$.blocks[${index}]`,
      "expected at least one ordered lesson paragraph after the lesson heading",
    );
  }
  if (isBlockType(values[index], "paragraph")) {
    fail(
      `$.blocks[${index}]`,
      `lesson paragraphs must not exceed ${MAX_PRINT_DOCUMENT_V2_LESSON_PARAGRAPHS}`,
    );
  }

  const workedExample = parseWorkedExample(values[index], `$.blocks[${index}]`);
  registerBlockId(workedExample.id, index, blockIds);
  blocks.push(workedExample);
  index += 1;

  const problemIds: string[] = [];
  const problems: PrintProblemV2[] = [];
  let expectedProvenanceIdentity: string | undefined;
  let expectedInstruction: string | undefined;

  while (isBlockType(values[index], "problem-group")) {
    const ordinal = problemIds.length + 1;
    if (ordinal > MAX_PRINT_DOCUMENT_V2_PROBLEMS) {
      fail(
        `$.blocks[${index}]`,
        `problem count must not exceed ${MAX_PRINT_DOCUMENT_V2_PROBLEMS}`,
      );
    }

    const groupIndex = index;
    const group = parseProblemGroup(values[index], ordinal, `$.blocks[${index}]`);
    registerBlockId(group.id, index, blockIds);
    const problem = group.problems[0];
    if (problemIds.includes(problem.id)) {
      fail(`$.blocks[${index}].problems[0].id`, `duplicate problem ID "${problem.id}"`);
    }
    const provenanceIdentity = printProvenanceIdentity(problem.provenance);
    expectedProvenanceIdentity ??= provenanceIdentity;
    if (provenanceIdentity !== expectedProvenanceIdentity) {
      fail(
        `$.blocks[${index}].problems[0].provenance`,
        "all problem provenance must identify the same reviewed content and generator",
      );
    }
    expectedInstruction ??= problem.instruction;
    if (problem.instruction !== expectedInstruction) {
      fail(
        `$.blocks[${index}].problems[0].instruction`,
        "all problem instructions must equal the selected exercise instruction",
      );
    }
    blocks.push(group);
    problemIds.push(problem.id);
    problems.push(problem);
    index += 1;

    const fallback = parseFallback(values[index], problem, `$.blocks[${index}]`);
    registerBlockId(fallback.id, index, blockIds);
    blocks.push(fallback);
    index += 1;

    const workingSpace = parseWorkingSpace(
      values[index],
      problem,
      `$.blocks[${index}]`,
    );
    registerBlockId(workingSpace.id, index, blockIds);
    blocks.push(workingSpace);
    index += 1;

    if (index !== groupIndex + 3) {
      fail(`$.blocks[${groupIndex}]`, "problem block triplet is inconsistent");
    }
  }

  if (problemIds.length === 0) {
    fail(
      `$.blocks[${index}]`,
      "expected at least one problem-group, print-fallback, working-space triplet",
    );
  }

  return {
    blocks,
    nextIndex: index,
    problems,
    worksheetTitle: singleTextContent(title.content, "$.blocks[0].content"),
  };
}

function parseAnswerKeyAppendix(
  values: readonly unknown[],
  prefix: ParsedStudentPrefix,
  blockIds: Set<string>,
): AnswerKeyPrintBlockV2[] {
  let index = prefix.nextIndex;
  const blocks: AnswerKeyPrintBlockV2[] = [];

  const pageBreak = parsePageBreak(values[index], `$.blocks[${index}]`);
  registerBlockId(pageBreak.id, index, blockIds);
  blocks.push(pageBreak);
  index += 1;

  const title = parseTitleHeading(
    values[index],
    FIXED_BLOCK_IDS.answerKeyTitle,
    `$.blocks[${index}]`,
  );
  if (singleTextContent(title.content, `$.blocks[${index}].content`) !== "Answer key") {
    fail(`$.blocks[${index}].content`, 'must contain exactly "Answer key"');
  }
  registerBlockId(title.id, index, blockIds);
  blocks.push(title);
  index += 1;

  for (const problem of prefix.problems) {
    const entry = parseAnswerKeyEntry(values[index], problem, `$.blocks[${index}]`);
    registerBlockId(entry.id, index, blockIds);
    blocks.push(entry);
    index += 1;
  }

  if (index !== values.length) {
    fail(
      `$.blocks[${index}]`,
      "answer-key appendix must contain exactly one ordered entry per problem",
    );
  }
  return blocks;
}

function parseTitleHeading(
  value: unknown,
  expectedId: string,
  path: string,
): PrintTitleHeadingBlockV2 {
  const block = expectExactRecord(value, ["type", "id", "level", "content"], path);
  expectLiteral(block.type, "heading", `${path}.type`);
  const id = expectStableId(block.id, `${path}.id`);
  expectLiteral(id, expectedId, `${path}.id`);
  expectNumberLiteral(block.level, 1, `${path}.level`);
  const content = parseSingleTextInlineArray(block.content, `${path}.content`, 240);
  return { type: "heading", id, level: 1, content };
}

function parseSummary(value: unknown, path: string): PrintSummaryBlockV2 {
  const block = expectExactRecord(value, ["type", "id", "content"], path);
  expectLiteral(block.type, "paragraph", `${path}.type`);
  const id = expectStableId(block.id, `${path}.id`);
  expectLiteral(id, FIXED_BLOCK_IDS.worksheetSummary, `${path}.id`);
  const content = parseSingleTextInlineArray(block.content, `${path}.content`, 500);
  validateWorksheetSummary(singleTextContent(content, `${path}.content`), path);
  return { type: "paragraph", id, content };
}

function parseLessonHeading(value: unknown, path: string): PrintLessonHeadingBlockV2 {
  const block = expectExactRecord(
    value,
    ["type", "id", "sourceNodeId", "level", "content"],
    path,
  );
  expectLiteral(block.type, "heading", `${path}.type`);
  const id = expectStableId(block.id, `${path}.id`);
  expectLiteral(id, FIXED_BLOCK_IDS.lessonHeading, `${path}.id`);
  expectLiteral(block.sourceNodeId, "lesson-explanation-01", `${path}.sourceNodeId`);
  expectNumberLiteral(block.level, 2, `${path}.level`);
  const content = parseSingleTextInlineArray(block.content, `${path}.content`, 240);
  return {
    type: "heading",
    id,
    sourceNodeId: "lesson-explanation-01",
    level: 2,
    content,
  };
}

function parseLessonParagraph(
  value: unknown,
  expectedOrdinal: number,
  expectedSourceNodeId: PrintLessonHeadingBlockV2["sourceNodeId"],
  path: string,
): PrintLessonParagraphBlockV2 {
  const block = expectExactRecord(
    value,
    ["type", "id", "sourceNodeId", "paragraphOrdinal", "content"],
    path,
  );
  expectLiteral(block.type, "paragraph", `${path}.type`);
  const id = expectStableId(block.id, `${path}.id`);
  expectLiteral(id, ordinalBlockId("lesson-paragraph", expectedOrdinal), `${path}.id`);
  expectLiteral(block.sourceNodeId, expectedSourceNodeId, `${path}.sourceNodeId`);
  expectNumberLiteral(
    block.paragraphOrdinal,
    expectedOrdinal,
    `${path}.paragraphOrdinal`,
  );
  const content = parseSingleTextInlineArray(block.content, `${path}.content`, 20_000);
  return {
    type: "paragraph",
    id,
    sourceNodeId: expectedSourceNodeId,
    paragraphOrdinal: expectedOrdinal,
    content,
  };
}

function parseWorkedExample(value: unknown, path: string): PrintWorkedExampleBlockV2 {
  const block = expectExactRecord(
    value,
    ["type", "id", "sourceNodeId", "title", "model", "prompt", "steps"],
    path,
  );
  expectLiteral(block.type, "worked-example", `${path}.type`);
  const id = expectStableId(block.id, `${path}.id`);
  expectLiteral(id, FIXED_BLOCK_IDS.workedExample, `${path}.id`);
  expectLiteral(block.sourceNodeId, "worked-example-01", `${path}.sourceNodeId`);
  const title = expectBoundedString(block.title, `${path}.title`, 1, 240);
  const model = parseWorkedExampleModel(block.model, `${path}.model`);
  const prompt = parseWorkedExamplePrompt(block.prompt, model, `${path}.prompt`);
  const rawSteps = expectBoundedArray(
    block.steps,
    `${path}.steps`,
    1,
    MAX_PRINT_DOCUMENT_V2_WORKED_EXAMPLE_STEPS,
  );
  const steps = rawSteps.map((step, index) =>
    expectBoundedString(step, `${path}.steps[${index}]`, 1, 20_000),
  );
  return {
    type: "worked-example",
    id,
    sourceNodeId: "worked-example-01",
    title,
    model,
    prompt,
    steps,
  };
}

function parseWorkedExampleModel(
  value: unknown,
  path: string,
): FractionAdditionWorkedExampleModelV1 {
  const result = FractionAdditionWorkedExampleModelV1Schema.safeParse(value);
  if (!result.success) {
    fail(path, "must be an exact valid fraction-addition worked-example model");
  }
  const model = result.data;
  return {
    type: "fraction-addition",
    left: { ...model.left },
    right: { ...model.right },
    result: { ...model.result },
    commonDenominator: model.commonDenominator,
    leftScaledNumerator: model.leftScaledNumerator,
    rightScaledNumerator: model.rightScaledNumerator,
    unreducedSumNumerator: model.unreducedSumNumerator,
  };
}

function parseWorkedExamplePrompt(
  value: unknown,
  model: FractionAdditionWorkedExampleModelV1,
  path: string,
): PrintWorkedExamplePromptV2 {
  const values = expectBoundedArray(value, path, 5, 5);
  const left = parseFractionInline(values[0], `${path}[0]`);
  const plus = parseOperatorInline(values[1], "+", `${path}[1]`);
  const right = parseFractionInline(values[2], `${path}[2]`);
  const equals = parseOperatorInline(values[3], "=", `${path}[3]`);
  const result = parseFractionInline(values[4], `${path}[4]`);

  assertFractionMatchesModel(left, model.left, `${path}[0]`);
  assertFractionMatchesModel(right, model.right, `${path}[2]`);
  assertFractionMatchesModel(result, model.result, `${path}[4]`);
  return [left, plus, right, equals, result];
}

function parseProblemGroup(
  value: unknown,
  expectedOrdinal: number,
  path: string,
): PrintProblemGroupBlockV2 {
  const block = expectExactRecord(
    value,
    ["type", "id", "sourceNodeId", "ordinal", "title", "problems"],
    path,
  );
  expectLiteral(block.type, "problem-group", `${path}.type`);
  const id = expectStableId(block.id, `${path}.id`);
  expectLiteral(id, ordinalBlockId("problem-group", expectedOrdinal), `${path}.id`);
  expectLiteral(block.sourceNodeId, "practice-01", `${path}.sourceNodeId`);
  expectNumberLiteral(block.ordinal, expectedOrdinal, `${path}.ordinal`);
  const title = expectBoundedString(block.title, `${path}.title`, 1, 500);
  expectLiteral(title, `Problem ${String(expectedOrdinal)}`, `${path}.title`);
  const rawProblems = expectBoundedArray(block.problems, `${path}.problems`, 1, 1);
  const problem = parseProblem(rawProblems[0], expectedOrdinal, `${path}.problems[0]`);
  return {
    type: "problem-group",
    id,
    sourceNodeId: "practice-01",
    ordinal: expectedOrdinal,
    title,
    problems: [problem],
  };
}

function parseProblem(
  value: unknown,
  expectedOrdinal: number,
  path: string,
): PrintProblemV2 {
  const problem = expectExactRecord(
    value,
    [
      "id",
      "ordinal",
      "instruction",
      "promptAccessibleText",
      "prompt",
      "response",
      "provenance",
    ],
    path,
  );
  const id = expectStableId(problem.id, `${path}.id`);
  expectNumberLiteral(problem.ordinal, expectedOrdinal, `${path}.ordinal`);
  const instruction = expectBoundedString(
    problem.instruction,
    `${path}.instruction`,
    1,
    500,
  );
  const prompt = parseProblemPrompt(problem.prompt, `${path}.prompt`);
  const promptAccessibleText = expectBoundedString(
    problem.promptAccessibleText,
    `${path}.promptAccessibleText`,
    1,
    2_000,
  );
  const expectedAccessibleText = deriveFractionAdditionPromptAccessibleText(
    toRational(prompt[0]),
    toRational(prompt[2]),
  );
  if (promptAccessibleText !== expectedAccessibleText) {
    fail(
      `${path}.promptAccessibleText`,
      "must equal the exact deterministic fraction-addition prompt text",
    );
  }
  const response = parseResponse(problem.response, expectedOrdinal, `${path}.response`);
  const provenance = parseProblemProvenance(problem.provenance, `${path}.provenance`);
  return {
    id,
    ordinal: expectedOrdinal,
    instruction,
    promptAccessibleText,
    prompt,
    response,
    provenance,
  };
}

function parseProblemPrompt(
  value: unknown,
  path: string,
): PrintFractionAdditionPromptV2 {
  const values = expectBoundedArray(value, path, 3, 3);
  const left = parseFractionInline(values[0], `${path}[0]`);
  const plus = parseOperatorInline(values[1], "+", `${path}[1]`);
  const right = parseFractionInline(values[2], `${path}[2]`);
  assertCanonicalReducedFraction(left, `${path}[0]`);
  assertCanonicalReducedFraction(right, `${path}[2]`);
  assertFractionAccessibleText(left, `${path}[0].accessibleText`);
  assertFractionAccessibleText(right, `${path}[2].accessibleText`);
  return [left, plus, right];
}

function parseResponse(
  value: unknown,
  expectedOrdinal: number,
  path: string,
): PrintProblemV2["response"] {
  const response = expectExactRecord(value, ["type", "label", "lines"], path);
  expectLiteral(response.type, "fraction", `${path}.type`);
  const label = expectBoundedString(response.label, `${path}.label`, 1, 1_000);
  expectLiteral(
    label,
    `Response space for problem ${String(expectedOrdinal)}`,
    `${path}.label`,
  );
  expectNumberLiteral(response.lines, 3, `${path}.lines`);
  return { type: "fraction", label, lines: 3 };
}

function parseProblemProvenance(
  value: unknown,
  path: string,
): PrintProblemProvenanceV2 {
  const provenance = expectExactRecord(
    value,
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
    path,
  );
  const contentId = expectStableId(provenance.contentId, `${path}.contentId`);
  expectLiteral(
    contentId,
    "math.fractions.add-unlike-denominators",
    `${path}.contentId`,
  );
  const contentRevision = expectIntegerInRange(
    provenance.contentRevision,
    `${path}.contentRevision`,
    1,
    2_147_483_647,
  );
  expectNumberLiteral(contentRevision, 2, `${path}.contentRevision`);
  const sourceHash = expectPattern(
    provenance.sourceHash,
    HASH_PATTERN,
    `${path}.sourceHash`,
    64,
  );
  const contentHash = expectPattern(
    provenance.contentHash,
    HASH_PATTERN,
    `${path}.contentHash`,
    64,
  );
  expectLiteral(
    provenance.compilerVersion,
    "exercisebook-content-compiler/2",
    `${path}.compilerVersion`,
  );
  expectLiteral(provenance.generatorId, "fractions.add", `${path}.generatorId`);
  expectLiteral(provenance.generatorVersion, "1", `${path}.generatorVersion`);
  const generationAttempt = expectIntegerInRange(
    provenance.generationAttempt,
    `${path}.generationAttempt`,
    0,
    127,
  );
  return {
    contentId,
    contentRevision,
    sourceHash,
    contentHash,
    compilerVersion: "exercisebook-content-compiler/2",
    generatorId: "fractions.add",
    generatorVersion: "1",
    generationAttempt,
  };
}

function parseFallback(
  value: unknown,
  problem: PrintProblemV2,
  path: string,
): PrintFallbackBlockV2 {
  const block = expectExactRecord(
    value,
    ["type", "id", "problemId", "ordinal", "content"],
    path,
  );
  expectLiteral(block.type, "print-fallback", `${path}.type`);
  const id = expectStableId(block.id, `${path}.id`);
  expectLiteral(id, ordinalBlockId("print-fallback", problem.ordinal), `${path}.id`);
  expectLiteral(block.problemId, problem.id, `${path}.problemId`);
  expectNumberLiteral(block.ordinal, problem.ordinal, `${path}.ordinal`);
  const content = expectRecord(block.content, `${path}.content`);
  if (content.type === "text") {
    const exact = expectExactRecord(content, ["type", "text"], `${path}.content`);
    const text = expectBoundedString(exact.text, `${path}.content.text`, 1, 2_000);
    return {
      type: "print-fallback",
      id,
      problemId: problem.id,
      ordinal: problem.ordinal,
      content: { type: "text", text },
    };
  }
  if (content.type === "fraction-bars") {
    const exact = expectExactRecord(
      content,
      ["type", "label", "caption", "bars"],
      `${path}.content`,
    );
    const label = expectBoundedString(exact.label, `${path}.content.label`, 1, 2_000);
    if (label !== problem.promptAccessibleText) {
      fail(
        `${path}.content.label`,
        "must equal the mapped problem promptAccessibleText",
      );
    }
    const caption = expectBoundedString(
      exact.caption,
      `${path}.content.caption`,
      1,
      2_000,
    );
    const rawBars = expectBoundedArray(exact.bars, `${path}.content.bars`, 2, 2);
    const bars = rawBars.map((bar, index) =>
      parseFractionBar(bar, `${path}.content.bars[${index}]`),
    );
    assertFallbackBarsMatchProblem(bars, problem, `${path}.content.bars`);
    return {
      type: "print-fallback",
      id,
      problemId: problem.id,
      ordinal: problem.ordinal,
      content: { type: "fraction-bars", label, caption, bars },
    };
  }
  fail(`${path}.content.type`, 'expected "text" or "fraction-bars"');
}

function parseFractionBar(value: unknown, path: string): PrintFractionBarV1 {
  const bar = expectExactRecord(value, ["numerator", "denominator", "label"], path);
  const denominator = expectIntegerInRange(
    bar.denominator,
    `${path}.denominator`,
    1,
    100,
  );
  const numerator = expectIntegerInRange(
    bar.numerator,
    `${path}.numerator`,
    0,
    denominator,
  );
  const label = expectBoundedString(bar.label, `${path}.label`, 1, 500);
  return { numerator, denominator, label };
}

function assertFallbackBarsMatchProblem(
  bars: readonly PrintFractionBarV1[],
  problem: PrintProblemV2,
  path: string,
): void {
  const expected = [
    toBoundedFractionBar(problem.prompt[0]),
    toBoundedFractionBar(problem.prompt[2]),
  ];
  if (expected[0] === undefined || expected[1] === undefined) {
    fail(path, "fraction bars cannot represent this problem's operands");
  }
  for (const [index, bar] of bars.entries()) {
    const expectedBar = expected[index];
    if (
      expectedBar === undefined ||
      bar.numerator !== expectedBar.numerator ||
      bar.denominator !== expectedBar.denominator ||
      bar.label !== `${expectedBar.numerator}/${expectedBar.denominator}`
    ) {
      fail(
        `${path}[${index}]`,
        "must exactly represent the corresponding problem operand",
      );
    }
  }
}

function parseWorkingSpace(
  value: unknown,
  problem: PrintProblemV2,
  path: string,
): PrintWorkingSpaceBlockV2 {
  const block = expectExactRecord(
    value,
    ["type", "id", "problemId", "ordinal", "label", "lines"],
    path,
  );
  expectLiteral(block.type, "working-space", `${path}.type`);
  const id = expectStableId(block.id, `${path}.id`);
  expectLiteral(id, ordinalBlockId("working-space", problem.ordinal), `${path}.id`);
  expectLiteral(block.problemId, problem.id, `${path}.problemId`);
  expectNumberLiteral(block.ordinal, problem.ordinal, `${path}.ordinal`);
  const label = expectBoundedString(block.label, `${path}.label`, 1, 500);
  expectLiteral(
    label,
    `Working space for problem ${String(problem.ordinal)}`,
    `${path}.label`,
  );
  expectNumberLiteral(block.lines, 3, `${path}.lines`);
  return {
    type: "working-space",
    id,
    problemId: problem.id,
    ordinal: problem.ordinal,
    label,
    lines: 3,
  };
}

function parsePageBreak(value: unknown, path: string): AnswerKeyPrintBlockV2 {
  const block = expectExactRecord(value, ["type", "id"], path);
  expectLiteral(block.type, "page-break", `${path}.type`);
  const id = expectStableId(block.id, `${path}.id`);
  expectLiteral(id, FIXED_BLOCK_IDS.answerKeyPageBreak, `${path}.id`);
  return { type: "page-break", id };
}

function parseAnswerKeyEntry(
  value: unknown,
  expectedProblem: PrintProblemV2,
  path: string,
): PrintAnswerKeyBlockV2 {
  const block = expectExactRecord(
    value,
    ["type", "id", "problemId", "ordinal", "canonicalResponse", "explanation"],
    path,
  );
  expectLiteral(block.type, "answer-key", `${path}.type`);
  const id = expectStableId(block.id, `${path}.id`);
  expectLiteral(
    id,
    ordinalBlockId("answer-key", expectedProblem.ordinal),
    `${path}.id`,
  );
  expectLiteral(block.problemId, expectedProblem.id, `${path}.problemId`);
  expectNumberLiteral(block.ordinal, expectedProblem.ordinal, `${path}.ordinal`);
  const rawResponse = expectBoundedArray(
    block.canonicalResponse,
    `${path}.canonicalResponse`,
    1,
    1,
  );
  const response = parseFractionInline(rawResponse[0], `${path}.canonicalResponse[0]`);
  assertCanonicalReducedFraction(response, `${path}.canonicalResponse[0]`);
  assertFractionAccessibleText(response, `${path}.canonicalResponse[0].accessibleText`);
  const expectedResponse = addPromptFractions(expectedProblem.prompt);
  if (
    response.numerator !== expectedResponse.numerator ||
    response.denominator !== expectedResponse.denominator
  ) {
    fail(
      `${path}.canonicalResponse[0]`,
      "must equal the exact reduced sum of the mapped problem prompt",
    );
  }
  const rawExplanation = expectBoundedArray(
    block.explanation,
    `${path}.explanation`,
    1,
    MAX_PRINT_DOCUMENT_V2_SOLUTION_STEPS,
  );
  const explanation = rawExplanation.map((step, index) =>
    expectBoundedString(step, `${path}.explanation[${index}]`, 1, 5_000),
  );
  return {
    type: "answer-key",
    id,
    problemId: expectedProblem.id,
    ordinal: expectedProblem.ordinal,
    canonicalResponse: [response],
    explanation,
  };
}

function parseSingleTextInlineArray(
  value: unknown,
  path: string,
  maximumTextLength: number,
): readonly [PrintInlineV1] {
  const values = expectBoundedArray(value, path, 1, 1);
  const inline = expectExactRecord(values[0], ["type", "text"], `${path}[0]`);
  expectLiteral(inline.type, "text", `${path}[0].type`);
  const text = expectBoundedString(
    inline.text,
    `${path}[0].text`,
    1,
    maximumTextLength,
  );
  return [{ type: "text", text }];
}

function parseFractionInline(value: unknown, path: string): PrintFractionV1 {
  const inline = expectExactRecord(
    value,
    ["type", "numerator", "denominator", "accessibleText"],
    path,
  );
  expectLiteral(inline.type, "fraction", `${path}.type`);
  const numerator = expectPattern(
    inline.numerator,
    CANONICAL_INTEGER_PATTERN,
    `${path}.numerator`,
    129,
  );
  const denominator = expectPattern(
    inline.denominator,
    POSITIVE_CANONICAL_INTEGER_PATTERN,
    `${path}.denominator`,
    128,
  );
  const accessibleText = expectBoundedString(
    inline.accessibleText,
    `${path}.accessibleText`,
    1,
    2_000,
  );
  return { type: "fraction", numerator, denominator, accessibleText };
}

function parseOperatorInline<const Symbol extends "+" | "=">(
  value: unknown,
  expectedSymbol: Symbol,
  path: string,
): PrintOperatorV1 & Readonly<{ symbol: Symbol }> {
  const inline = expectExactRecord(value, ["type", "symbol", "accessibleText"], path);
  expectLiteral(inline.type, "operator", `${path}.type`);
  expectLiteral(inline.symbol, expectedSymbol, `${path}.symbol`);
  const accessibleText = expectBoundedString(
    inline.accessibleText,
    `${path}.accessibleText`,
    1,
    2_000,
  );
  const expectedAccessibleText = expectedSymbol === "+" ? "plus" : "equals";
  if (accessibleText !== expectedAccessibleText) {
    fail(
      `${path}.accessibleText`,
      `must equal ${JSON.stringify(expectedAccessibleText)}`,
    );
  }
  return { type: "operator", symbol: expectedSymbol, accessibleText };
}

function parseAttributions(value: unknown): AttributionV1[] {
  const values = expectBoundedArray(
    value,
    "$.attributions",
    1,
    MAX_PRINT_DOCUMENT_V2_ATTRIBUTIONS,
  );
  return values.map((attribution, index) => {
    const path = `$.attributions[${index}]`;
    const source = expectExactRecord(
      attribution,
      [
        "title",
        "author",
        "sourceUrl",
        "licenseId",
        "attributionText",
        "publicationStatus",
        "modifications",
      ],
      path,
    );
    const title = expectBoundedString(source.title, `${path}.title`, 1, 240);
    const author = expectBoundedString(source.author, `${path}.author`, 1, 240);
    const sourceUrl = expectHttpUrl(source.sourceUrl, `${path}.sourceUrl`);
    const licenseId = expectBoundedString(
      source.licenseId,
      `${path}.licenseId`,
      1,
      160,
    );
    const attributionText = expectBoundedString(
      source.attributionText,
      `${path}.attributionText`,
      1,
      1_000,
    );
    if (
      source.publicationStatus !== "draft" &&
      source.publicationStatus !== "published"
    ) {
      fail(`${path}.publicationStatus`, 'expected "draft" or "published"');
    }
    const rawModifications = expectBoundedArray(
      source.modifications,
      `${path}.modifications`,
      0,
      50,
    );
    const modifications = rawModifications.map((modification, modificationIndex) =>
      expectBoundedString(
        modification,
        `${path}.modifications[${modificationIndex}]`,
        1,
        500,
      ),
    );
    return {
      title,
      author,
      sourceUrl,
      licenseId,
      attributionText,
      publicationStatus: source.publicationStatus,
      modifications,
    };
  });
}

function assertFractionMatchesModel(
  inline: PrintFractionV1,
  rational: { readonly numerator: string; readonly denominator: string },
  path: string,
): void {
  if (
    inline.numerator !== rational.numerator ||
    inline.denominator !== rational.denominator
  ) {
    fail(path, "must exactly equal the corresponding worked-example model value");
  }
  assertFractionAccessibleText(inline, `${path}.accessibleText`);
}

function assertFractionAccessibleText(inline: PrintFractionV1, path: string): void {
  const expected = `${inline.numerator} over ${inline.denominator}`;
  if (inline.accessibleText !== expected) {
    fail(path, "must equal the deterministic locale-specific fraction text");
  }
}

function assertCanonicalReducedFraction(inline: PrintFractionV1, path: string): void {
  const numerator = BigInt(inline.numerator);
  const denominator = BigInt(inline.denominator);
  if (greatestCommonDivisor(absBigInt(numerator), denominator) !== 1n) {
    fail(path, "must be a reduced canonical rational");
  }
}

function toRational(inline: PrintFractionV1): {
  readonly numerator: string;
  readonly denominator: string;
} {
  return { numerator: inline.numerator, denominator: inline.denominator };
}

function addPromptFractions(prompt: PrintFractionAdditionPromptV2): {
  readonly numerator: string;
  readonly denominator: string;
} {
  // Every lexical operand has already passed the 128-digit canonical bound,
  // so these two products and one GCD are deterministic bounded work.
  const leftNumerator = BigInt(prompt[0].numerator);
  const leftDenominator = BigInt(prompt[0].denominator);
  const rightNumerator = BigInt(prompt[2].numerator);
  const rightDenominator = BigInt(prompt[2].denominator);
  const numerator = leftNumerator * rightDenominator + rightNumerator * leftDenominator;
  const denominator = leftDenominator * rightDenominator;
  const divisor = greatestCommonDivisor(absBigInt(numerator), denominator);
  return {
    numerator: (numerator / divisor).toString(),
    denominator: (denominator / divisor).toString(),
  };
}

function toBoundedFractionBar(
  inline: PrintFractionV1,
): { readonly numerator: number; readonly denominator: number } | undefined {
  const numerator = BigInt(inline.numerator);
  const denominator = BigInt(inline.denominator);
  if (numerator < 0n || numerator > denominator || denominator > 100n) {
    return undefined;
  }
  return { numerator: Number(numerator), denominator: Number(denominator) };
}

function printProvenanceIdentity(provenance: PrintProblemProvenanceV2): string {
  return [
    provenance.contentId,
    String(provenance.contentRevision),
    provenance.sourceHash,
    provenance.contentHash,
    provenance.compilerVersion,
    provenance.generatorId,
    provenance.generatorVersion,
  ].join("\u0000");
}

function registerBlockId(id: string, blockIndex: number, blockIds: Set<string>): void {
  if (blockIds.has(id)) {
    fail(`$.blocks[${blockIndex}].id`, `duplicate block ID "${id}"`);
  }
  blockIds.add(id);
}

function ordinalBlockId(prefix: string, ordinal: number): string {
  return `${prefix}-${String(ordinal).padStart(3, "0")}`;
}

function validateWorksheetSummary(value: string, path: string): void {
  const match = WORKSHEET_SUMMARY_PATTERN.exec(value);
  if (match === null) {
    fail(`${path}.content[0].text`, 'expected "YYYY-MM-DD · N minutes"');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const minutes = Number(match[4]);
  if (
    year < 1 ||
    year > 9_999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    minutes < 1 ||
    minutes > 480
  ) {
    fail(`${path}.content[0].text`, "contains an invalid study date or duration");
  }
}

function singleTextContent(value: readonly PrintInlineV1[], path: string): string {
  const inline = value[0];
  if (value.length !== 1 || inline?.type !== "text") {
    fail(path, "must contain exactly one text inline");
  }
  return inline.text;
}

function visitStudentValue(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      visitStudentValue(child, `${path}[${index}]`);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_STUDENT_KEYS.test(key)) {
      fail(`${path}.${key}`, "answer-only data is forbidden in student output");
    }
    if (key === "type" && child === "answer-key") {
      fail(path, "answer-key blocks are forbidden in student output");
    }
    // The selected worked example is curriculum presentation, not a generated
    // practice answer. Its exact `result` field is intentionally retained;
    // only answer-authority field names are rejected here.
    visitStudentValue(child, `${path}.${key}`);
  }
}

function assertSafeGraph(value: unknown): void {
  try {
    assertSafeDataObjectGraph(value);
  } catch (error: unknown) {
    throw new PrintDocumentV2ValidationError(
      "$",
      "expected a bounded safe plain-data object graph",
      { cause: error },
    );
  }
}

function isBlockType(value: unknown, expected: string): boolean {
  return isRecord(value) && value.type === expected;
}

function expectRecord(value: unknown, path: string): PlainRecord {
  if (!isRecord(value)) {
    fail(path, "expected a plain object");
  }
  return value;
}

function isRecord(value: unknown): value is PlainRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function expectExactRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
  path: string,
): Record<Keys[number], unknown> {
  const record = expectRecord(value, path);
  const actualKeys = Object.keys(record);
  if (
    actualKeys.length !== keys.length ||
    actualKeys.some((key) => !keys.includes(key))
  ) {
    fail(path, `expected exactly the fields: ${keys.join(", ")}`);
  }
  return record as Record<Keys[number], unknown>;
}

function expectBoundedArray(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail(path, "expected an array");
  }
  if (value.length < minimum || value.length > maximum) {
    fail(path, `expected an array of length ${minimum}..${maximum}`);
  }
  return value;
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

function expectPattern(
  value: unknown,
  pattern: RegExp,
  path: string,
  maximum: number,
): string {
  const text = expectBoundedString(value, path, 1, maximum);
  if (!pattern.test(text)) {
    fail(path, "has an invalid format");
  }
  return text;
}

function expectStableId(value: unknown, path: string): string {
  return expectPattern(value, STABLE_ID_PATTERN, path, 160);
}

function expectHttpUrl(value: unknown, path: string): string {
  const url = expectBoundedString(value, path, 1, 2_048);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail(path, "expected an absolute HTTP(S) URL");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    fail(path, "expected an HTTP(S) URL without credentials");
  }
  return url;
}

function expectVariant(value: unknown, path: string): "student" | "answer-key" {
  if (value !== "student" && value !== "answer-key") {
    fail(path, 'expected "student" or "answer-key"');
  }
  return value;
}

function expectLiteral<const Literal extends string>(
  value: unknown,
  expected: Literal,
  path: string,
): asserts value is Literal {
  if (value !== expected) {
    fail(path, `expected ${JSON.stringify(expected)}`);
  }
}

function expectNumberLiteral<const Literal extends number>(
  value: unknown,
  expected: Literal,
  path: string,
): asserts value is Literal {
  if (value !== expected) {
    fail(path, `expected ${String(expected)}`);
  }
}

function expectIntegerInRange(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value)) {
    fail(path, "expected a safe integer");
  }
  const integer = value as number;
  if (integer < minimum || integer > maximum) {
    fail(path, `expected an integer in range ${minimum}..${maximum}`);
  }
  return integer;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left;
  let b = right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function fail(path: string, message: string): never {
  throw new PrintDocumentV2ValidationError(path, message);
}
