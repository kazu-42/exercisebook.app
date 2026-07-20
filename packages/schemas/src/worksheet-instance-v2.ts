import { addRationals, equalRationals } from "@exercisebook/domain";
import { z } from "zod";

import {
  assertSafeDataObjectGraph,
  CanonicalIntegerStringSchema,
  LocalDateSchema,
  LocaleSchema,
  RationalJsonSchema,
  RevisionSchema,
  Sha256HexSchema,
  StableIdSchema,
  TimeZoneSchema,
} from "./common.js";
import {
  CONTENT_COMPILER_V2,
  FractionAdditionWorkedExampleModelV1Schema,
  PresentationPlainTextV1Schema,
} from "./content-document-v2.js";
import {
  AttributionV1Schema,
  FractionAdditionPromptV1Schema,
  MisconceptionV1Schema,
  RNG_ALGORITHM_V1,
  SolutionStepV1Schema,
  WorksheetSlotV1Schema,
} from "./worksheet-instance-v1.js";

export const WORKSHEET_PRESENTATION_V1_SCHEMA =
  "exercisebook.worksheet-presentation/v1";
export const WORKSHEET_INSTANCE_V2_SCHEMA = "exercisebook.worksheet-instance/v2";

const PRESENTATION_CONTENT_ID = "math.fractions.add-unlike-denominators";
const PRESENTATION_CONTENT_REVISION = 2;

export const ContentReferenceV2Schema = z.strictObject({
  id: StableIdSchema,
  revision: RevisionSchema,
  sourceHash: Sha256HexSchema,
  contentHash: Sha256HexSchema,
  compilerVersion: z.literal(CONTENT_COMPILER_V2),
});

export const SlotProvenanceV2Schema = z.strictObject({
  contentId: StableIdSchema,
  contentRevision: RevisionSchema,
  sourceHash: Sha256HexSchema,
  contentHash: Sha256HexSchema,
  compilerVersion: z.literal(CONTENT_COMPILER_V2),
  generatorId: z.literal("fractions.add"),
  generatorVersion: z.literal("1"),
  generationAttempt: z.number().int().min(0).max(127),
});

// The shared V1 rational refinement assumes lexical canonicality before it
// calls BigInt. V2 is a new untrusted boundary, so every nested rational first
// passes a non-throwing lexical object contract. This retains the V1 semantic
// meaning without inheriting its historical hostile-string failure mode.
const BoundaryRationalJsonV2Schema = z
  .strictObject({
    numerator: CanonicalIntegerStringSchema,
    denominator: CanonicalIntegerStringSchema,
  })
  .pipe(RationalJsonSchema);

const FractionAdditionPromptV2Schema = z.strictObject({
  ...FractionAdditionPromptV1Schema.shape,
  left: BoundaryRationalJsonV2Schema,
  right: BoundaryRationalJsonV2Schema,
});

const SolutionStepV2Schema = z.strictObject({
  ...SolutionStepV1Schema.shape,
  result: BoundaryRationalJsonV2Schema.optional(),
});

const MisconceptionV2Schema = z.strictObject({
  ...MisconceptionV1Schema.shape,
  incorrectAnswer: BoundaryRationalJsonV2Schema,
});

export const WorksheetSlotV2Schema = z.strictObject({
  ...WorksheetSlotV1Schema.shape,
  prompt: FractionAdditionPromptV2Schema,
  canonicalAnswer: z.strictObject({
    type: z.literal("rational"),
    value: BoundaryRationalJsonV2Schema,
  }),
  scoringRule: z.strictObject({
    type: z.literal("rational-equals"),
    accepted: BoundaryRationalJsonV2Schema,
    requireReduced: z.boolean(),
  }),
  solutionTrace: z.array(SolutionStepV2Schema).min(1).max(20),
  misconceptions: z.array(MisconceptionV2Schema).max(20),
  provenance: SlotProvenanceV2Schema,
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

export const WorksheetInstanceV2Schema = z
  .strictObject({
    schema: z.literal(WORKSHEET_INSTANCE_V2_SCHEMA),
    assignmentId: StableIdSchema,
    title: z.string().min(1).max(240),
    localStudyDate: LocalDateSchema,
    timeZone: TimeZoneSchema,
    locale: LocaleSchema,
    expectedMinutes: z.number().int().positive().max(480),
    plan: z.strictObject({
      id: StableIdSchema,
      version: RevisionSchema,
    }),
    policy: z.strictObject({
      id: StableIdSchema,
      version: RevisionSchema,
    }),
    skillGraph: z.strictObject({
      id: StableIdSchema,
      revision: RevisionSchema,
    }),
    rng: z.strictObject({
      algorithm: z.literal(RNG_ALGORITHM_V1),
      baseSeed: Sha256HexSchema,
      seedSecretVersion: StableIdSchema,
    }),
    content: z.array(ContentReferenceV2Schema).min(1).max(100),
    presentation: WorksheetPresentationV1Schema,
    slots: z.array(WorksheetSlotV2Schema).min(1).max(200),
    attributions: z.array(AttributionV1Schema).min(1).max(100),
  })
  .superRefine((instance, context) => {
    const contentIdentities = new Set<string>();
    const contentReferenceCounts = new Map<string, number>();
    for (const [index, content] of instance.content.entries()) {
      const identity = contentIdentityKey(content.id, content.revision);
      if (contentIdentities.has(identity)) {
        context.addIssue({
          code: "custom",
          message: "Duplicate top-level content ID and revision",
          path: ["content", index],
        });
      }
      contentIdentities.add(identity);

      const reference = contentReferenceKey(content);
      contentReferenceCounts.set(
        reference,
        (contentReferenceCounts.get(reference) ?? 0) + 1,
      );
    }

    const presentationReference = contentReferenceKey(instance.presentation.content);
    if (contentReferenceCounts.get(presentationReference) !== 1) {
      context.addIssue({
        code: "custom",
        message:
          "Presentation content must match exactly one top-level content reference",
        path: ["presentation", "content"],
      });
    }

    const selectedExample = FractionAdditionWorkedExampleModelV1Schema.safeParse(
      instance.presentation.workedExample.model,
    );
    const selectedExampleAnswers = selectedExample.success
      ? [
          selectedExample.data.left,
          selectedExample.data.right,
          selectedExample.data.result,
        ]
      : [];
    if (selectedExample.success) {
      const expectedExampleResult = addRationals(
        selectedExample.data.left,
        selectedExample.data.right,
      );
      if (!equalRationals(selectedExample.data.result, expectedExampleResult)) {
        context.addIssue({
          code: "custom",
          message: "The worked-example result must equal the exact sum of its operands",
          path: ["presentation", "workedExample", "model", "result"],
        });
      }
    }

    const slotIds = new Set<string>();
    let expectedMinutes = 0;
    for (const [index, slot] of instance.slots.entries()) {
      if (slotIds.has(slot.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate slot ID: ${slot.id}`,
          path: ["slots", index, "id"],
        });
      }
      slotIds.add(slot.id);
      expectedMinutes += slot.expectedMinutes;

      validateUniqueSlotCollections(slot, index, context);

      const provenanceReference = contentReferenceKey({
        id: slot.provenance.contentId,
        revision: slot.provenance.contentRevision,
        sourceHash: slot.provenance.sourceHash,
        contentHash: slot.provenance.contentHash,
        compilerVersion: slot.provenance.compilerVersion,
      });
      if (provenanceReference !== presentationReference) {
        context.addIssue({
          code: "custom",
          message: "Slot provenance must match the selected presentation content",
          path: ["slots", index, "provenance"],
        });
      }
      if (contentReferenceCounts.get(provenanceReference) !== 1) {
        context.addIssue({
          code: "custom",
          message: "Slot provenance must match exactly one top-level content reference",
          path: ["slots", index, "provenance"],
        });
      }

      if (slot.prompt.instruction !== instance.presentation.exercise.instruction) {
        context.addIssue({
          code: "custom",
          message: "Slot instruction must equal the selected exercise instruction",
          path: ["slots", index, "prompt", "instruction"],
        });
      }

      const canonicalAnswer = BoundaryRationalJsonV2Schema.safeParse(
        slot.canonicalAnswer.value,
      );
      const leftOperand = BoundaryRationalJsonV2Schema.safeParse(slot.prompt.left);
      const rightOperand = BoundaryRationalJsonV2Schema.safeParse(slot.prompt.right);
      if (
        canonicalAnswer.success &&
        leftOperand.success &&
        rightOperand.success &&
        !rationalSumEquals(leftOperand.data, rightOperand.data, canonicalAnswer.data)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "The canonical answer must equal the exact sum of the prompt operands",
          path: ["slots", index, "canonicalAnswer", "value"],
        });
      }
      if (
        canonicalAnswer.success &&
        selectedExampleAnswers.some((exampleAnswer) =>
          equalRationals(canonicalAnswer.data, exampleAnswer),
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Slot canonical answer must not equal a selected worked-example operand or result",
          path: ["slots", index, "canonicalAnswer", "value"],
        });
      }

      const scoringAnswer = BoundaryRationalJsonV2Schema.safeParse(
        slot.scoringRule.accepted,
      );
      if (
        canonicalAnswer.success &&
        scoringAnswer.success &&
        !equalRationals(canonicalAnswer.data, scoringAnswer.data)
      ) {
        context.addIssue({
          code: "custom",
          message: "The scoring rule must accept the canonical answer",
          path: ["slots", index, "scoringRule", "accepted"],
        });
      }

      const finalResult = BoundaryRationalJsonV2Schema.safeParse(
        slot.solutionTrace.at(-1)?.result,
      );
      if (
        canonicalAnswer.success &&
        (!finalResult.success ||
          !equalRationals(finalResult.data, canonicalAnswer.data))
      ) {
        context.addIssue({
          code: "custom",
          message: "The final solution result must equal the canonical answer",
          path: ["slots", index, "solutionTrace"],
        });
      }
    }

    if (expectedMinutes !== instance.expectedMinutes) {
      context.addIssue({
        code: "custom",
        message: "Worksheet expectedMinutes must equal the sum of slot durations",
        path: ["expectedMinutes"],
      });
    }
  });

export type ContentReferenceV2 = z.infer<typeof ContentReferenceV2Schema>;
export type SlotProvenanceV2 = z.infer<typeof SlotProvenanceV2Schema>;
export type WorksheetSlotV2 = z.infer<typeof WorksheetSlotV2Schema>;
export type WorksheetPresentationV1 = z.infer<typeof WorksheetPresentationV1Schema>;
export type WorksheetInstanceV2 = z.infer<typeof WorksheetInstanceV2Schema>;

export interface MaterializedWorksheetInstanceV2 {
  readonly instance: WorksheetInstanceV2;
  readonly canonicalJson: string;
  readonly instanceHash: string;
}

export function validateWorksheetPresentationV1(
  value: unknown,
): WorksheetPresentationV1 {
  assertSafeDataObjectGraph(value);
  return WorksheetPresentationV1Schema.parse(value);
}

export function validateWorksheetInstanceV2(value: unknown): WorksheetInstanceV2 {
  assertSafeDataObjectGraph(value);
  return WorksheetInstanceV2Schema.parse(value);
}

function contentIdentityKey(id: string, revision: number): string {
  return `${id}\u0000${revision}`;
}

function rationalSumEquals(
  left: { readonly numerator: string; readonly denominator: string },
  right: { readonly numerator: string; readonly denominator: string },
  result: { readonly numerator: string; readonly denominator: string },
): boolean {
  const leftNumerator = BigInt(left.numerator);
  const leftDenominator = BigInt(left.denominator);
  const rightNumerator = BigInt(right.numerator);
  const rightDenominator = BigInt(right.denominator);
  const resultNumerator = BigInt(result.numerator);
  const resultDenominator = BigInt(result.denominator);

  return (
    (leftNumerator * rightDenominator + rightNumerator * leftDenominator) *
      resultDenominator ===
    resultNumerator * leftDenominator * rightDenominator
  );
}

function contentReferenceKey(reference: {
  readonly id: string;
  readonly revision: number;
  readonly sourceHash: string;
  readonly contentHash: string;
  readonly compilerVersion: string;
}): string {
  return `${contentIdentityKey(reference.id, reference.revision)}\u0000${reference.sourceHash}\u0000${reference.contentHash}\u0000${reference.compilerVersion}`;
}

function validateUniqueSlotCollections(
  slot: WorksheetSlotV2,
  slotIndex: number,
  context: z.RefinementCtx,
): void {
  const collections: readonly [string, readonly string[]][] = [
    ["skillIds", slot.skillIds],
    ["selectionReasons", slot.selectionReasons],
    ["hints", slot.hints.map((hint) => hint.id)],
    ["solutionTrace", slot.solutionTrace.map((step) => step.id)],
    ["misconceptions", slot.misconceptions.map((misconception) => misconception.id)],
  ];
  for (const [field, values] of collections) {
    const seen = new Set<string>();
    for (const [valueIndex, value] of values.entries()) {
      if (seen.has(value)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate ${field} value in slot ${slot.id}: ${value}`,
          path: ["slots", slotIndex, field, valueIndex],
        });
      }
      seen.add(value);
    }
  }
}
