import {
  deriveFractionAdditionWorkedExampleArithmetic,
  validateContentDocumentV2,
  validateWorksheetPresentationV1,
  ContentReferenceV2Schema,
  WORKSHEET_PRESENTATION_V1_SCHEMA,
  assertSafeDataObjectGraph,
  type ContentBlockV2,
  type ContentDocumentV2,
  type ContentReferenceV2,
  type WorksheetPresentationV1,
} from "@exercisebook/schemas";
import type { RationalJson } from "@exercisebook/domain";

export const FRACTION_PRESENTATION_V1_SOURCE_HASH =
  "456c8908debd52c7fcc5eba6e2e9a38434b5fcd8343e7a14a427faae34502523";
export const FRACTION_PRESENTATION_V1_CONTENT_HASH =
  "944225a2dda87ae6ee61e53f21a929301f5264793d665ea2200b65fb0f5a71dd";

export const FRACTION_PRESENTATION_V1_CONTENT_ID =
  "math.fractions.add-unlike-denominators";
export const FRACTION_PRESENTATION_V1_CONTENT_REVISION = 2;
export const FRACTION_PRESENTATION_V1_COMPILER_VERSION =
  "exercisebook-content-compiler/2";
export const FRACTION_PRESENTATION_V1_EXPLANATION_NODE_ID = "lesson-explanation-01";
export const FRACTION_PRESENTATION_V1_WORKED_EXAMPLE_NODE_ID = "worked-example-01";
export const FRACTION_PRESENTATION_V1_EXERCISE_NODE_ID = "practice-01";

const FRACTION_ADDITION_GENERATOR_ID = "fractions.add";
const FRACTION_ADDITION_GENERATOR_VERSION = "1";
const REVIEWED_EXERCISE_COUNT = 8;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const CANONICAL_NUMERATOR = /^(?:0|-?[1-9][0-9]{0,127})$/u;
const CANONICAL_POSITIVE_DENOMINATOR = /^[1-9][0-9]{0,127}$/u;

export type PresentationResolutionErrorCode =
  | "unsafe-input"
  | "invalid-content"
  | "content-identity-mismatch"
  | "invalid-selection"
  | "selected-node-count"
  | "selected-node-type"
  | "exercise-contract-mismatch"
  | "worked-example-arithmetic-mismatch"
  | "excluded-answer-tuple-mismatch"
  | "presentation-invalid";

const PRESENTATION_RESOLUTION_MESSAGES: Readonly<
  Record<PresentationResolutionErrorCode, string>
> = {
  "unsafe-input": "The presentation input is not safe plain data.",
  "invalid-content": "The reviewed content document is invalid.",
  "content-identity-mismatch":
    "The reviewed content identity does not match the pinned policy.",
  "invalid-selection": "The reviewed presentation selection is invalid.",
  "selected-node-count": "A reviewed presentation node did not resolve exactly once.",
  "selected-node-type": "A reviewed presentation node has the wrong semantic role.",
  "exercise-contract-mismatch":
    "The reviewed exercise does not match the generator contract.",
  "worked-example-arithmetic-mismatch":
    "The reviewed worked example has inconsistent arithmetic.",
  "excluded-answer-tuple-mismatch":
    "The reviewed answer exclusion tuple does not match the worked example.",
  "presentation-invalid": "The resolved worksheet presentation is invalid.",
};

export class PresentationResolutionError extends Error {
  override readonly name = "PresentationResolutionError";
  readonly code: PresentationResolutionErrorCode;

  constructor(code: PresentationResolutionErrorCode) {
    super(PRESENTATION_RESOLUTION_MESSAGES[code]);
    this.code = code;
  }
}

export interface WorksheetPresentationSelectionInputV1 {
  readonly explanationNodeId: string;
  readonly workedExampleNodeId: string;
  readonly exerciseNodeId: string;
  readonly excludedCanonicalAnswers: readonly RationalJson[];
}

export interface ResolveWorksheetPresentationV1Input {
  readonly document: ContentDocumentV2;
  readonly computedContentHash: string;
  readonly expectedContent: ContentReferenceV2;
  readonly selection: WorksheetPresentationSelectionInputV1;
}

/** @internal Shared only with the v2 materializer in this package. */
export interface ResolvedFractionPresentationContextV1 {
  readonly presentation: WorksheetPresentationV1;
  readonly exercise: Readonly<{
    difficulty: number;
  }>;
}

/**
 * Resolve the one policy-v3 presentation from an exact reviewed content
 * revision. The resolver intentionally owns no learner-visible prose. The
 * supplied hash is a trusted digest claim: asynchronous callers must compute
 * it from the same detached document snapshot before invoking this function.
 */
export function resolveWorksheetPresentationV1(
  input: ResolveWorksheetPresentationV1Input,
): WorksheetPresentationV1 {
  return resolveFractionPresentationContextV1(input).presentation;
}

/**
 * Package-internal resolver variant that preserves the selected exercise
 * semantics for generation. Keeping this in the same pass prevents the
 * materializer from performing a second, subtly different node lookup.
 *
 * @internal
 */
export function resolveFractionPresentationContextV1(
  input: ResolveWorksheetPresentationV1Input,
): ResolvedFractionPresentationContextV1 {
  assertSafeResolverInput(input);

  const stableSelection = validateAndDetachWorksheetPresentationSelectionV1(
    input.selection,
  );
  const stableExpectedContent = validateExpectedContent(input.expectedContent);
  const computedContentHash = validateComputedContentHash(input.computedContentHash);
  const stableDocument = validateDocument(input.document, stableSelection);

  assertPinnedContentIdentity(
    stableDocument,
    computedContentHash,
    stableExpectedContent,
  );

  const explanation = resolveSelectedNode(
    stableDocument.nodes,
    stableSelection.explanationNodeId,
    "explanation",
  );
  const workedExample = resolveSelectedNode(
    stableDocument.nodes,
    stableSelection.workedExampleNodeId,
    "worked-example",
  );
  const exercise = resolveSelectedNode(
    stableDocument.nodes,
    stableSelection.exerciseNodeId,
    "exercise",
  );

  assertReviewedExerciseContract(exercise);
  assertWorkedExampleArithmetic(workedExample.model);
  assertOrderedExclusionTuple(
    stableSelection.excludedCanonicalAnswers,
    workedExample.model,
  );

  try {
    const presentation = validateWorksheetPresentationV1({
      schema: WORKSHEET_PRESENTATION_V1_SCHEMA,
      content: {
        id: stableExpectedContent.id,
        revision: stableExpectedContent.revision,
        sourceHash: stableExpectedContent.sourceHash,
        contentHash: stableExpectedContent.contentHash,
        compilerVersion: stableExpectedContent.compilerVersion,
      },
      lesson: {
        nodeId: stableSelection.explanationNodeId,
        title: explanation.title,
        paragraphs: [...explanation.paragraphs],
      },
      workedExample: {
        nodeId: stableSelection.workedExampleNodeId,
        title: workedExample.title,
        model: {
          type: workedExample.model.type,
          left: { ...workedExample.model.left },
          right: { ...workedExample.model.right },
          result: { ...workedExample.model.result },
          commonDenominator: workedExample.model.commonDenominator,
          leftScaledNumerator: workedExample.model.leftScaledNumerator,
          rightScaledNumerator: workedExample.model.rightScaledNumerator,
          unreducedSumNumerator: workedExample.model.unreducedSumNumerator,
        },
        steps: [...workedExample.steps],
      },
      exercise: {
        nodeId: stableSelection.exerciseNodeId,
        instruction: exercise.instruction,
      },
    });
    const difficulty = exercise.generator.parameters.difficulty;
    if (typeof difficulty !== "number") {
      // Kept as a defensive narrowing even though the contract assertion above
      // has already established the exact runtime type.
      throw new PresentationResolutionError("exercise-contract-mismatch");
    }
    return {
      presentation,
      exercise: { difficulty },
    };
  } catch {
    throw new PresentationResolutionError("presentation-invalid");
  }
}

function assertSafeResolverInput(input: ResolveWorksheetPresentationV1Input): void {
  try {
    assertSafeDataObjectGraph(input);
  } catch {
    throw new PresentationResolutionError("unsafe-input");
  }
  if (
    !isExactRecord(input, [
      "document",
      "computedContentHash",
      "expectedContent",
      "selection",
    ])
  ) {
    throw new PresentationResolutionError("unsafe-input");
  }
}

/**
 * Validate and copy opaque planner selection data without relying on
 * structuredClone. Functions, symbols, hostile rationals, and non-plain
 * values therefore fail as one sanitized resolver error.
 *
 * @internal
 */
export function validateAndDetachWorksheetPresentationSelectionV1(
  selection: unknown,
): WorksheetPresentationSelectionInputV1 {
  if (
    !isExactRecord(selection, [
      "explanationNodeId",
      "workedExampleNodeId",
      "exerciseNodeId",
      "excludedCanonicalAnswers",
    ]) ||
    selection.explanationNodeId !== FRACTION_PRESENTATION_V1_EXPLANATION_NODE_ID ||
    selection.workedExampleNodeId !== FRACTION_PRESENTATION_V1_WORKED_EXAMPLE_NODE_ID ||
    selection.exerciseNodeId !== FRACTION_PRESENTATION_V1_EXERCISE_NODE_ID ||
    !Array.isArray(selection.excludedCanonicalAnswers) ||
    selection.excludedCanonicalAnswers.length !== 3
  ) {
    throw new PresentationResolutionError("invalid-selection");
  }

  const excludedCanonicalAnswers = selection.excludedCanonicalAnswers.map(
    validateBoundaryRational,
  );
  return {
    explanationNodeId: selection.explanationNodeId,
    workedExampleNodeId: selection.workedExampleNodeId,
    exerciseNodeId: selection.exerciseNodeId,
    excludedCanonicalAnswers,
  };
}

function validateBoundaryRational(value: unknown): RationalJson {
  if (
    !isExactRecord(value, ["numerator", "denominator"]) ||
    typeof value.numerator !== "string" ||
    typeof value.denominator !== "string" ||
    !CANONICAL_NUMERATOR.test(value.numerator) ||
    !CANONICAL_POSITIVE_DENOMINATOR.test(value.denominator)
  ) {
    throw new PresentationResolutionError("invalid-selection");
  }

  // Conversion is safe only after the bounded lexical checks above.
  const numerator = BigInt(value.numerator);
  const denominator = BigInt(value.denominator);
  if (greatestCommonDivisor(absBigInt(numerator), denominator) !== 1n) {
    throw new PresentationResolutionError("invalid-selection");
  }
  return { numerator: value.numerator, denominator: value.denominator };
}

function validateExpectedContent(value: unknown): ContentReferenceV2 {
  try {
    const parsed = ContentReferenceV2Schema.parse(value);
    if (
      parsed.id !== FRACTION_PRESENTATION_V1_CONTENT_ID ||
      parsed.revision !== FRACTION_PRESENTATION_V1_CONTENT_REVISION ||
      parsed.sourceHash !== FRACTION_PRESENTATION_V1_SOURCE_HASH ||
      parsed.contentHash !== FRACTION_PRESENTATION_V1_CONTENT_HASH ||
      parsed.compilerVersion !== FRACTION_PRESENTATION_V1_COMPILER_VERSION
    ) {
      throw new PresentationResolutionError("content-identity-mismatch");
    }
    return parsed;
  } catch (error) {
    if (error instanceof PresentationResolutionError) {
      throw error;
    }
    throw new PresentationResolutionError("content-identity-mismatch");
  }
}

function validateComputedContentHash(value: unknown): string {
  if (
    typeof value !== "string" ||
    !SHA256_HEX.test(value) ||
    value !== FRACTION_PRESENTATION_V1_CONTENT_HASH
  ) {
    throw new PresentationResolutionError("content-identity-mismatch");
  }
  return value;
}

function validateDocument(
  document: unknown,
  selection: WorksheetPresentationSelectionInputV1,
): ContentDocumentV2 {
  try {
    return validateContentDocumentV2(document);
  } catch {
    if (rawSelectedNodeCountMismatch(document, selection)) {
      throw new PresentationResolutionError("selected-node-count");
    }
    if (
      rawSelectedWorkedExampleHasArithmeticMismatch(
        document,
        selection.workedExampleNodeId,
      )
    ) {
      throw new PresentationResolutionError("worked-example-arithmetic-mismatch");
    }
    throw new PresentationResolutionError("invalid-content");
  }
}

function rawSelectedNodeCountMismatch(
  document: unknown,
  selection: WorksheetPresentationSelectionInputV1,
): boolean {
  if (!isPlainRecord(document) || !Array.isArray(document.nodes)) {
    return false;
  }
  const nodes: readonly unknown[] = document.nodes;
  return [
    selection.explanationNodeId,
    selection.workedExampleNodeId,
    selection.exerciseNodeId,
  ].some(
    (selectedId) =>
      nodes.filter((node) => isPlainRecord(node) && node.id === selectedId).length !==
      1,
  );
}

function assertPinnedContentIdentity(
  document: ContentDocumentV2,
  computedContentHash: string,
  expected: ContentReferenceV2,
): void {
  if (
    document.id !== expected.id ||
    document.revision !== expected.revision ||
    document.sourceHash !== expected.sourceHash ||
    document.compilerVersion !== expected.compilerVersion ||
    computedContentHash !== expected.contentHash
  ) {
    throw new PresentationResolutionError("content-identity-mismatch");
  }
}

function resolveSelectedNode<Type extends ContentBlockV2["type"]>(
  nodes: readonly ContentBlockV2[],
  nodeId: string,
  expectedType: Type,
): Extract<ContentBlockV2, { readonly type: Type }> {
  const matches = nodes.filter((node) => "id" in node && node.id === nodeId);
  if (matches.length !== 1) {
    throw new PresentationResolutionError("selected-node-count");
  }
  const selected = matches[0];
  if (selected === undefined || selected.type !== expectedType) {
    throw new PresentationResolutionError("selected-node-type");
  }
  return selected as Extract<ContentBlockV2, { readonly type: Type }>;
}

function assertReviewedExerciseContract(
  exercise: Extract<ContentBlockV2, { readonly type: "exercise" }>,
): void {
  const parameterKeys = Object.keys(exercise.generator.parameters);
  if (
    exercise.generator.id !== FRACTION_ADDITION_GENERATOR_ID ||
    exercise.generator.version !== FRACTION_ADDITION_GENERATOR_VERSION ||
    exercise.count !== REVIEWED_EXERCISE_COUNT ||
    parameterKeys.length !== 1 ||
    parameterKeys[0] !== "difficulty" ||
    typeof exercise.generator.parameters.difficulty !== "number" ||
    !Number.isInteger(exercise.generator.parameters.difficulty) ||
    exercise.generator.parameters.difficulty < 1 ||
    exercise.generator.parameters.difficulty > 5
  ) {
    throw new PresentationResolutionError("exercise-contract-mismatch");
  }
}

function assertWorkedExampleArithmetic(
  model: Extract<ContentBlockV2, { readonly type: "worked-example" }>["model"],
): void {
  let expected: ReturnType<typeof deriveFractionAdditionWorkedExampleArithmetic>;
  try {
    expected = deriveFractionAdditionWorkedExampleArithmetic(model.left, model.right);
  } catch {
    throw new PresentationResolutionError("worked-example-arithmetic-mismatch");
  }
  if (
    model.commonDenominator !== expected.commonDenominator ||
    model.leftScaledNumerator !== expected.leftScaledNumerator ||
    model.rightScaledNumerator !== expected.rightScaledNumerator ||
    model.unreducedSumNumerator !== expected.unreducedSumNumerator ||
    !sameRational(model.result, expected.result)
  ) {
    throw new PresentationResolutionError("worked-example-arithmetic-mismatch");
  }
}

function assertOrderedExclusionTuple(
  actual: readonly RationalJson[],
  model: Extract<ContentBlockV2, { readonly type: "worked-example" }>["model"],
): void {
  const expected = [model.left, model.right, model.result] as const;
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => {
      const expectedValue = expected[index];
      return expectedValue === undefined || !sameRational(value, expectedValue);
    })
  ) {
    throw new PresentationResolutionError("excluded-answer-tuple-mismatch");
  }
}

function rawSelectedWorkedExampleHasArithmeticMismatch(
  document: unknown,
  selectedId: string,
): boolean {
  if (!isPlainRecord(document) || !Array.isArray(document.nodes)) {
    return false;
  }
  const matches = document.nodes.filter(
    (node) => isPlainRecord(node) && node.id === selectedId,
  );
  if (matches.length !== 1) {
    return false;
  }
  const node = matches[0];
  if (
    !isPlainRecord(node) ||
    node.type !== "worked-example" ||
    !isPlainRecord(node.model)
  ) {
    return false;
  }
  const model = node.model;
  const left = readBoundaryRational(model.left);
  const right = readBoundaryRational(model.right);
  const result = readBoundaryRational(model.result);
  if (
    left === undefined ||
    right === undefined ||
    result === undefined ||
    typeof model.commonDenominator !== "string" ||
    typeof model.leftScaledNumerator !== "string" ||
    typeof model.rightScaledNumerator !== "string" ||
    typeof model.unreducedSumNumerator !== "string"
  ) {
    return false;
  }
  try {
    const expected = deriveFractionAdditionWorkedExampleArithmetic(left, right);
    return (
      model.commonDenominator !== expected.commonDenominator ||
      model.leftScaledNumerator !== expected.leftScaledNumerator ||
      model.rightScaledNumerator !== expected.rightScaledNumerator ||
      model.unreducedSumNumerator !== expected.unreducedSumNumerator ||
      !sameRational(result, expected.result)
    );
  } catch {
    return false;
  }
}

function readBoundaryRational(value: unknown): RationalJson | undefined {
  if (
    !isExactRecord(value, ["numerator", "denominator"]) ||
    typeof value.numerator !== "string" ||
    typeof value.denominator !== "string" ||
    !CANONICAL_NUMERATOR.test(value.numerator) ||
    !CANONICAL_POSITIVE_DENOMINATOR.test(value.denominator)
  ) {
    return undefined;
  }
  try {
    const numerator = BigInt(value.numerator);
    const denominator = BigInt(value.denominator);
    if (greatestCommonDivisor(absBigInt(numerator), denominator) !== 1n) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return { numerator: value.numerator, denominator: value.denominator };
}

function sameRational(left: RationalJson, right: RationalJson): boolean {
  return left.numerator === right.numerator && left.denominator === right.denominator;
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function isExactRecord<Key extends string>(
  value: unknown,
  keys: readonly Key[],
): value is Record<Key, unknown> {
  if (!isPlainRecord(value)) {
    return false;
  }
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
