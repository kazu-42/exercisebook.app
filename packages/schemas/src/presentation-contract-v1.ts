import {
  addRationals,
  leastCommonMultiple,
  type RationalJson,
} from "@exercisebook/domain/rational";
import { z } from "zod";

import {
  assertSafeDataObjectGraph,
  CanonicalIntegerStringSchema,
  RationalJsonSchema,
  Sha256HexSchema,
} from "./common.js";
import { AttributionV1Schema } from "./attribution-v1.js";

export { AttributionV1Schema } from "./attribution-v1.js";
export type { AttributionV1 } from "./attribution-v1.js";

export const CONTENT_COMPILER_V2 = "exercisebook-content-compiler/2";
export const WORKSHEET_PRESENTATION_V1_SCHEMA =
  "exercisebook.worksheet-presentation/v1";

const PRESENTATION_CONTENT_ID = "math.fractions.add-unlike-denominators";
const PRESENTATION_CONTENT_REVISION = 2;

export const PresentationPlainTextV1Schema = z
  .string()
  .min(1)
  .max(20_000)
  .refine(
    hasCanonicalPresentationWhitespace,
    "Presentation text must use its canonical whitespace normalization",
  );

const PositiveCanonicalIntegerStringSchema = CanonicalIntegerStringSchema.regex(
  /^[1-9][0-9]*$/u,
  "Expected a positive canonical integer",
);

const WorkedExampleRationalJsonV1Schema = z
  .strictObject({
    numerator: CanonicalIntegerStringSchema,
    denominator: CanonicalIntegerStringSchema,
  })
  .pipe(RationalJsonSchema);

export const FractionAdditionWorkedExampleModelV1Schema = z
  .strictObject({
    type: z.literal("fraction-addition"),
    left: WorkedExampleRationalJsonV1Schema,
    right: WorkedExampleRationalJsonV1Schema,
    result: WorkedExampleRationalJsonV1Schema,
    commonDenominator: PositiveCanonicalIntegerStringSchema,
    leftScaledNumerator: CanonicalIntegerStringSchema,
    rightScaledNumerator: CanonicalIntegerStringSchema,
    unreducedSumNumerator: CanonicalIntegerStringSchema,
  })
  .superRefine((model, context) => {
    // Nested validation can already have reported an issue. Re-parse before
    // BigInt arithmetic so hostile denominators remain ordinary Zod failures.
    const left = WorkedExampleRationalJsonV1Schema.safeParse(model.left);
    const right = WorkedExampleRationalJsonV1Schema.safeParse(model.right);
    if (!left.success || !right.success) {
      return;
    }
    let expected: ReturnType<typeof deriveFractionAdditionWorkedExampleArithmetic>;
    try {
      expected = deriveFractionAdditionWorkedExampleArithmetic(left.data, right.data);
    } catch (error) {
      if (!(error instanceof RangeError)) {
        throw error;
      }
      context.addIssue({
        code: "custom",
        message:
          "The worked-example arithmetic exceeds the bounded canonical integer contract",
        path: [],
      });
      return;
    }
    const checks: readonly {
      readonly actual: string;
      readonly expected: string;
      readonly field:
        | "commonDenominator"
        | "leftScaledNumerator"
        | "rightScaledNumerator"
        | "unreducedSumNumerator";
      readonly label: string;
    }[] = [
      {
        actual: model.commonDenominator,
        expected: expected.commonDenominator,
        field: "commonDenominator",
        label: "common denominator",
      },
      {
        actual: model.leftScaledNumerator,
        expected: expected.leftScaledNumerator,
        field: "leftScaledNumerator",
        label: "left scaled numerator",
      },
      {
        actual: model.rightScaledNumerator,
        expected: expected.rightScaledNumerator,
        field: "rightScaledNumerator",
        label: "right scaled numerator",
      },
      {
        actual: model.unreducedSumNumerator,
        expected: expected.unreducedSumNumerator,
        field: "unreducedSumNumerator",
        label: "unreduced sum numerator",
      },
    ];
    for (const check of checks) {
      if (check.actual !== check.expected) {
        context.addIssue({
          code: "custom",
          message: `The ${check.label} must equal its exact arithmetic derivation`,
          path: [check.field],
        });
      }
    }

    const result = WorkedExampleRationalJsonV1Schema.safeParse(model.result);
    if (result.success && !sameRational(result.data, expected.result)) {
      context.addIssue({
        code: "custom",
        message: "The worked-example result must equal the exact sum of its operands",
        path: ["result"],
      });
    }
  });

const PresentationContentReferenceV1Schema = z.strictObject({
  id: z.literal(PRESENTATION_CONTENT_ID),
  revision: z.literal(PRESENTATION_CONTENT_REVISION),
  sourceHash: Sha256HexSchema,
  contentHash: Sha256HexSchema,
  compilerVersion: z.literal(CONTENT_COMPILER_V2),
});

export const WorksheetPresentationV1Schema = z.strictObject({
  schema: z.literal(WORKSHEET_PRESENTATION_V1_SCHEMA),
  content: PresentationContentReferenceV1Schema,
  lesson: z.strictObject({
    nodeId: z.literal("lesson-explanation-01"),
    title: z.string().min(1).max(240),
    paragraphs: z.array(PresentationPlainTextV1Schema).min(1).max(8),
  }),
  workedExample: z.strictObject({
    nodeId: z.literal("worked-example-01"),
    title: z.string().min(1).max(240),
    model: FractionAdditionWorkedExampleModelV1Schema,
    steps: z.array(PresentationPlainTextV1Schema).min(1).max(8),
  }),
  exercise: z.strictObject({
    nodeId: z.literal("practice-01"),
    instruction: z.string().min(1).max(500),
  }),
});

export type FractionAdditionWorkedExampleModelV1 = z.infer<
  typeof FractionAdditionWorkedExampleModelV1Schema
>;
export type PresentationPlainTextV1 = z.infer<typeof PresentationPlainTextV1Schema>;
export type WorksheetPresentationV1 = z.infer<typeof WorksheetPresentationV1Schema>;

export function validateWorksheetPresentationV1(
  value: unknown,
): WorksheetPresentationV1 {
  assertSafeDataObjectGraph(value);
  return WorksheetPresentationV1Schema.parse(value);
}

export function deriveFractionAdditionWorkedExampleArithmetic(
  left: RationalJson,
  right: RationalJson,
): Readonly<{
  commonDenominator: string;
  leftScaledNumerator: string;
  rightScaledNumerator: string;
  unreducedSumNumerator: string;
  result: RationalJson;
}> {
  const leftDenominator = BigInt(left.denominator);
  const rightDenominator = BigInt(right.denominator);
  const commonDenominator = leastCommonMultiple(leftDenominator, rightDenominator);
  const leftScaledNumerator =
    BigInt(left.numerator) * (commonDenominator / leftDenominator);
  const rightScaledNumerator =
    BigInt(right.numerator) * (commonDenominator / rightDenominator);
  return {
    commonDenominator: commonDenominator.toString(),
    leftScaledNumerator: leftScaledNumerator.toString(),
    rightScaledNumerator: rightScaledNumerator.toString(),
    unreducedSumNumerator: (leftScaledNumerator + rightScaledNumerator).toString(),
    result: addRationals(left, right),
  };
}

function hasCanonicalPresentationWhitespace(value: string): boolean {
  return value.replaceAll(/[\p{White_Space}\uFEFF]+/gu, " ").trim() === value;
}

function sameRational(left: RationalJson, right: RationalJson): boolean {
  return left.numerator === right.numerator && left.denominator === right.denominator;
}
