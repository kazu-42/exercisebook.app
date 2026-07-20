import { z } from "zod";

import {
  addRationals,
  leastCommonMultiple,
  type RationalJson,
} from "@exercisebook/domain";

import {
  assertSafeDataObjectGraph,
  CanonicalIntegerStringSchema,
  HttpUrlSchema,
  LocaleSchema,
  RationalJsonSchema,
  RevisionSchema,
  Sha256HexSchema,
  StableIdSchema,
} from "./common.js";
import { derivePhase1MathAccessibleText } from "./phase-1-safe-math.js";

export const CONTENT_DOCUMENT_V2_SCHEMA = "exercisebook.content-ast/v2";
export const CONTENT_COMPILER_V2 = "exercisebook-content-compiler/2";

const TextInlineLeafV2Schema = z.strictObject({
  type: z.literal("text"),
  value: z.string().min(1).max(20_000),
});

const MathInlineLeafV2Schema = z.strictObject({
  type: z.literal("math"),
  source: z.string().min(1).max(2_000),
  accessibleText: z.string().min(1).max(2_000),
});

const InlineLeafV2Schema = z.discriminatedUnion("type", [
  TextInlineLeafV2Schema,
  MathInlineLeafV2Schema,
]);

export const ContentInlineV2Schema = z.discriminatedUnion("type", [
  ...InlineLeafV2Schema.options,
  z.strictObject({
    type: z.literal("emphasis"),
    children: z.array(InlineLeafV2Schema).min(1).max(1_000),
  }),
  z.strictObject({
    type: z.literal("strong"),
    children: z.array(InlineLeafV2Schema).min(1).max(1_000),
  }),
]);

type ContentInlineV2Output = z.infer<typeof ContentInlineV2Schema>;

export const ContentParagraphV2Schema = z.strictObject({
  type: z.literal("paragraph"),
  children: z.array(ContentInlineV2Schema).min(1).max(2_000),
});

export const PresentationPlainTextV1Schema = z
  .string()
  .min(1)
  .max(20_000)
  .refine(
    hasCanonicalPresentationWhitespace,
    "Presentation text must use its canonical whitespace normalization",
  );

const PresentationBodyV1Schema = z.array(PresentationPlainTextV1Schema).min(1).max(8);

const PositiveCanonicalIntegerStringSchema = CanonicalIntegerStringSchema.regex(
  /^[1-9][0-9]*$/u,
  "Expected a positive canonical integer",
);

// RationalJsonSchema's semantic refinement assumes structurally canonical
// integers. Gate hostile V2 values through the non-throwing lexical contract
// first so validation reports Zod issues rather than leaking BigInt errors.
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
    // Zod may run this outer refinement after a nested rational refinement has
    // already reported an issue. Re-parse operands before BigInt arithmetic so
    // hostile denominators cannot escape as division-by-zero RangeErrors.
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

const DirectiveBodyV2Schema = z.array(ContentParagraphV2Schema).min(1).max(200);

export const ContentBlockV2Schema = z.discriminatedUnion("type", [
  ContentParagraphV2Schema,
  z.strictObject({
    type: z.literal("heading"),
    level: z.number().int().min(1).max(6),
    children: z.array(ContentInlineV2Schema).min(1).max(2_000),
  }),
  z.strictObject({
    type: z.literal("explanation"),
    id: StableIdSchema,
    title: z.string().min(1).max(240),
    paragraphs: PresentationBodyV1Schema,
  }),
  z.strictObject({
    type: z.literal("worked-example"),
    id: StableIdSchema,
    title: z.string().min(1).max(240),
    model: FractionAdditionWorkedExampleModelV1Schema,
    steps: PresentationBodyV1Schema,
  }),
  z.strictObject({
    type: z.literal("exercise"),
    id: StableIdSchema,
    generator: z.strictObject({
      id: StableIdSchema,
      version: z.string().min(1).max(80),
      parameters: z.record(
        z.string().min(1).max(80),
        z.union([z.string().max(500), z.number().finite(), z.boolean()]),
      ),
    }),
    count: z.number().int().min(1).max(200),
    instruction: z.string().min(1).max(500),
  }),
  z.strictObject({
    type: z.literal("interactive"),
    id: StableIdSchema,
    kind: z.enum(["fraction-bars"]),
    prompt: z.string().min(1).max(2_000),
    printFallback: z.string().min(1).max(2_000),
    children: DirectiveBodyV2Schema,
  }),
  z.strictObject({
    type: z.literal("hint"),
    id: StableIdSchema,
    children: DirectiveBodyV2Schema,
  }),
  z.strictObject({
    type: z.literal("reflection"),
    id: StableIdSchema,
    children: DirectiveBodyV2Schema,
  }),
  z.strictObject({
    type: z.literal("callout"),
    id: StableIdSchema,
    tone: z.enum(["note", "tip", "warning"]),
    children: DirectiveBodyV2Schema,
  }),
  z.strictObject({
    type: z.literal("figure"),
    id: StableIdSchema,
    assetId: StableIdSchema,
    alt: z.string().min(1).max(2_000),
    caption: z.string().min(1).max(2_000),
  }),
]);

export const ContentDocumentV2Schema = z
  .strictObject({
    schema: z.literal(CONTENT_DOCUMENT_V2_SCHEMA),
    id: StableIdSchema,
    revision: RevisionSchema,
    locale: LocaleSchema,
    title: z.string().min(1).max(240),
    skills: z.array(StableIdSchema).min(1).max(20),
    prerequisites: z.array(StableIdSchema).max(100),
    authors: z
      .array(
        z.strictObject({
          name: z.string().min(1).max(240),
          role: z.enum(["author", "reviewer"]),
        }),
      )
      .min(1)
      .max(100),
    license: z.strictObject({
      licenseId: z.string().min(1).max(160),
      sourceUrl: HttpUrlSchema,
      attributionText: z.string().min(1).max(1_000),
      copyrightHolder: z.string().min(1).max(240),
    }),
    publication: z.strictObject({
      status: z.enum(["draft", "published"]),
    }),
    estimatedMinutes: z.number().int().positive().max(480),
    nodes: z.array(ContentBlockV2Schema).min(1).max(10_000),
    sourceHash: Sha256HexSchema,
    compilerVersion: z.literal(CONTENT_COMPILER_V2),
  })
  .superRefine((document, context) => {
    validateContentMath(document.nodes, context);
    validateUniqueReferences(document, context);

    const attributionAuthor = document.authors.map((author) => author.name).join(", ");
    if (attributionAuthor.length > 240) {
      context.addIssue({
        code: "custom",
        message:
          "Combined author names must fit the 240-character attribution author field",
        path: ["authors"],
      });
    }

    const skills = new Set(document.skills);
    for (const [index, prerequisite] of document.prerequisites.entries()) {
      if (skills.has(prerequisite)) {
        context.addIssue({
          code: "custom",
          message: "A prerequisite cannot also be a taught skill",
          path: ["prerequisites", index],
        });
      }
    }
  });

export type ContentDocumentV2 = z.infer<typeof ContentDocumentV2Schema>;
export type ContentBlockV2 = z.infer<typeof ContentBlockV2Schema>;
export type ContentParagraphV2 = z.infer<typeof ContentParagraphV2Schema>;
export type ContentInlineV2 = z.infer<typeof ContentInlineV2Schema>;
export type FractionAdditionWorkedExampleModelV1 = z.infer<
  typeof FractionAdditionWorkedExampleModelV1Schema
>;
export type PresentationPlainTextV1 = z.infer<typeof PresentationPlainTextV1Schema>;

export function validateContentDocumentV2(value: unknown): ContentDocumentV2 {
  assertSafeDataObjectGraph(value);
  return ContentDocumentV2Schema.parse(value);
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

function validateContentMath(
  nodes: readonly ContentBlockV2[],
  context: z.RefinementCtx,
): void {
  const validateMath = (
    math: { readonly source: string; readonly accessibleText: string },
    path: readonly (string | number)[],
  ): void => {
    let derivedAccessibleText: string;
    try {
      derivedAccessibleText = derivePhase1MathAccessibleText(math.source);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid Phase-1 math source",
        path: [...path, "source"],
      });
      return;
    }
    if (math.accessibleText !== derivedAccessibleText) {
      context.addIssue({
        code: "custom",
        message: "Math accessibleText must equal its deterministic Phase-1 derivation",
        path: [...path, "accessibleText"],
      });
    }
  };
  const validateInlineChildren = (
    children: readonly ContentInlineV2Output[],
    path: readonly (string | number)[],
  ): void => {
    for (const [inlineIndex, inline] of children.entries()) {
      const inlinePath = [...path, inlineIndex];
      if (inline.type === "math") {
        validateMath(inline, inlinePath);
      } else if (inline.type === "emphasis" || inline.type === "strong") {
        for (const [leafIndex, leaf] of inline.children.entries()) {
          if (leaf.type === "math") {
            validateMath(leaf, [...inlinePath, "children", leafIndex]);
          }
        }
      }
    }
  };

  for (const [nodeIndex, node] of nodes.entries()) {
    if (node.type === "paragraph" || node.type === "heading") {
      validateInlineChildren(node.children, ["nodes", nodeIndex, "children"]);
    } else if (
      node.type === "interactive" ||
      node.type === "hint" ||
      node.type === "reflection" ||
      node.type === "callout"
    ) {
      for (const [paragraphIndex, paragraph] of node.children.entries()) {
        validateInlineChildren(paragraph.children, [
          "nodes",
          nodeIndex,
          "children",
          paragraphIndex,
          "children",
        ]);
      }
    }
  }
}

function validateUniqueReferences(
  document: {
    readonly skills: readonly string[];
    readonly prerequisites: readonly string[];
    readonly nodes: readonly ContentBlockV2[];
  },
  context: z.RefinementCtx,
): void {
  for (const [field, values] of [
    ["skills", document.skills],
    ["prerequisites", document.prerequisites],
  ] as const) {
    const seen = new Set<string>();
    for (const [index, value] of values.entries()) {
      if (seen.has(value)) {
        context.addIssue({
          code: "custom",
          message:
            field === "skills"
              ? `Duplicate taught skill ID: ${value}`
              : `Duplicate prerequisite ID: ${value}`,
          path: [field, index],
        });
      }
      seen.add(value);
    }
  }

  const nodeIds = new Set<string>();
  for (const [index, node] of document.nodes.entries()) {
    if (!("id" in node)) {
      continue;
    }
    if (nodeIds.has(node.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate content node ID: ${node.id}`,
        path: ["nodes", index, "id"],
      });
    }
    nodeIds.add(node.id);
  }
}
