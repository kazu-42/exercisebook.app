import {
  canonicalizeJson,
  deriveSlotSeed,
  sha256Hex,
  type RationalJson,
} from "@exercisebook/domain";
import {
  RNG_ALGORITHM_V1,
  WORKSHEET_INSTANCE_V2_SCHEMA,
  assertSafeDataObjectGraph,
  validateContentDocumentV2,
  validateWorksheetInstanceV2,
  type ContentDocumentV2,
  type MaterializedWorksheetInstanceV2,
  type WorksheetSlotV2,
} from "@exercisebook/schemas";
import {
  DAILY_PLAN_PREVIEW_REQUEST_V2_SCHEMA,
  DAY_ONE_PREVIEW_REGISTRY_V2,
  planDailyPreviewV2,
  validateDailyPlanPreviewV2,
  type DailyPlanPreviewV2,
} from "@exercisebook/planner";

import {
  FRACTION_ADDITION_GENERATOR_ID,
  FRACTION_ADDITION_GENERATOR_VERSION,
  generateFractionAdditionProblem,
  type GeneratedFractionAdditionV1,
} from "./fraction-addition.js";
import {
  PresentationResolutionError,
  resolveFractionPresentationContextV1,
} from "./fraction-presentation-v1.js";

const MAX_DUPLICATE_RETRIES = 127;

export type FractionAdditionV2MaterializationErrorCode =
  | "unsafe-input"
  | "invalid-assignment"
  | "unsupported-content-state"
  | "locale-mismatch"
  | "generation-exhausted"
  | "invalid-instance";

const MATERIALIZATION_MESSAGES: Readonly<
  Record<FractionAdditionV2MaterializationErrorCode, string>
> = {
  "unsafe-input": "The worksheet materialization input is not safe plain data.",
  "invalid-assignment": "The worksheet assignment input is invalid.",
  "unsupported-content-state":
    "The content publication state is unavailable for this worksheet lane.",
  "locale-mismatch":
    "The assignment locale does not match the supported content locale.",
  "generation-exhausted":
    "The deterministic worksheet generator exhausted its bounded retries.",
  "invalid-instance": "The materialized worksheet instance is invalid.",
};

export class FractionAdditionV2MaterializationError extends Error {
  override readonly name = "FractionAdditionV2MaterializationError";
  readonly code: FractionAdditionV2MaterializationErrorCode;

  constructor(code: FractionAdditionV2MaterializationErrorCode) {
    super(MATERIALIZATION_MESSAGES[code]);
    this.code = code;
  }
}

/**
 * Materialize a content-derived v2 worksheet from one complete, planner-owned
 * plan snapshot. No caller-owned object is read after plan authorization
 * begins, and no independent assignment claims cross this boundary.
 */
export async function materializeFractionAdditionWorksheetFromContentV2(
  document: ContentDocumentV2,
  plan: DailyPlanPreviewV2,
): Promise<MaterializedWorksheetInstanceV2> {
  const { document: stableDocument, plan: stablePlan } = snapshotMaterializationInputs(
    document,
    plan,
  );
  await assertPlanMatchesPinnedPlannerV2(stablePlan);
  const activity = stablePlan.activities[0];

  // Hash the exact validated, detached document that the resolver and every
  // downstream derivation will consume. Do not re-read either caller input.
  const computedContentHash = await sha256Hex(canonicalizeJson(stableDocument));
  const resolved = resolveFractionPresentationContextV1({
    document: stableDocument,
    computedContentHash,
    expectedContent: activity.content,
    selection: activity.presentationSelection,
  });

  const slots: WorksheetSlotV2[] = [];
  const promptSignatures = new Set<string>();
  const excludedAnswerSignatures = new Set(
    activity.presentationSelection.excludedCanonicalAnswers.map(rationalSignature),
  );

  for (let index = 0; index < activity.itemCount; index += 1) {
    const id = `practice-${String(index + 1).padStart(2, "0")}`;
    let selected:
      | Readonly<{
          slotSeed: string;
          generated: GeneratedFractionAdditionV1;
          generationAttempt: number;
        }>
      | undefined;

    for (
      let generationAttempt = 0;
      generationAttempt <= MAX_DUPLICATE_RETRIES;
      generationAttempt += 1
    ) {
      const derivationSlotId =
        generationAttempt === 0 ? id : `${id}:retry-${generationAttempt}`;
      const slotSeed = await deriveSlotSeed({
        baseSeed: stablePlan.generation.baseSeed,
        generatorId: FRACTION_ADDITION_GENERATOR_ID,
        generatorVersion: FRACTION_ADDITION_GENERATOR_VERSION,
        slotId: derivationSlotId,
      });
      const generated = generateFractionAdditionProblem({
        slotSeed,
        difficulty: resolved.exercise.difficulty,
      });
      const promptSignature = fractionAdditionPromptSignature(generated);
      const answerSignature = rationalSignature(generated.canonicalAnswer.value);
      if (
        !promptSignatures.has(promptSignature) &&
        !excludedAnswerSignatures.has(answerSignature)
      ) {
        promptSignatures.add(promptSignature);
        selected = { slotSeed, generated, generationAttempt };
        break;
      }
    }

    if (selected === undefined) {
      throw new FractionAdditionV2MaterializationError("generation-exhausted");
    }

    const { slotSeed, generated, generationAttempt } = selected;
    slots.push({
      id,
      skillIds: [...stableDocument.skills],
      slotSeed,
      selectionReasons: [...activity.selectionReasons],
      expectedMinutes: 2,
      prompt: {
        ...generated.prompt,
        instruction: resolved.presentation.exercise.instruction,
      },
      canonicalAnswer: generated.canonicalAnswer,
      scoringRule: generated.scoringRule,
      hints: [...generated.hints],
      solutionTrace: [...generated.solutionTrace],
      misconceptions: [...generated.misconceptions],
      accessibility: generated.accessibility,
      printFallback: generated.printFallback,
      provenance: {
        contentId: resolved.presentation.content.id,
        contentRevision: resolved.presentation.content.revision,
        sourceHash: resolved.presentation.content.sourceHash,
        contentHash: resolved.presentation.content.contentHash,
        compilerVersion: resolved.presentation.content.compilerVersion,
        generatorId: FRACTION_ADDITION_GENERATOR_ID,
        generatorVersion: FRACTION_ADDITION_GENERATOR_VERSION,
        generationAttempt,
      },
    });
  }

  let instance: ReturnType<typeof validateWorksheetInstanceV2>;
  try {
    instance = validateWorksheetInstanceV2({
      schema: WORKSHEET_INSTANCE_V2_SCHEMA,
      assignmentId: stablePlan.id,
      title: stableDocument.title,
      localStudyDate: stablePlan.localStudyDate,
      timeZone: stablePlan.timeZone,
      locale: stablePlan.locale,
      expectedMinutes: slots.reduce((total, slot) => total + slot.expectedMinutes, 0),
      plan: { id: stablePlan.id, version: 2 },
      policy: stablePlan.policy,
      skillGraph: stablePlan.skillGraph,
      rng: {
        algorithm: RNG_ALGORITHM_V1,
        baseSeed: stablePlan.generation.baseSeed,
        seedSecretVersion: stablePlan.generation.seedVersion,
      },
      content: [resolved.presentation.content],
      presentation: resolved.presentation,
      slots,
      attributions: [attributionFromContent(stableDocument)],
    });
  } catch {
    throw new FractionAdditionV2MaterializationError("invalid-instance");
  }

  const canonicalJson = canonicalizeJson(instance);
  const instanceHash = await sha256Hex(canonicalJson);
  return { instance, canonicalJson, instanceHash };
}

function snapshotMaterializationInputs(
  document: ContentDocumentV2,
  plan: DailyPlanPreviewV2,
): Readonly<{
  document: ContentDocumentV2;
  plan: DailyPlanPreviewV2;
}> {
  try {
    // The envelope itself is fresh plain data, so this traverses both caller
    // graphs without first reading any caller-owned property.
    assertSafeDataObjectGraph({ document, plan });
  } catch {
    throw new FractionAdditionV2MaterializationError("unsafe-input");
  }

  let stablePlan: DailyPlanPreviewV2;
  try {
    stablePlan = validateDailyPlanPreviewV2(plan);
  } catch {
    throw new FractionAdditionV2MaterializationError("invalid-assignment");
  }

  let stableDocument: ContentDocumentV2;
  try {
    stableDocument = validateContentDocumentV2(document);
  } catch {
    throw new PresentationResolutionError("invalid-content");
  }

  if (stableDocument.publication.status !== "draft") {
    throw new FractionAdditionV2MaterializationError("unsupported-content-state");
  }
  if (stablePlan.locale !== stableDocument.locale) {
    throw new FractionAdditionV2MaterializationError("locale-mismatch");
  }

  return {
    document: stableDocument,
    plan: stablePlan,
  };
}

async function assertPlanMatchesPinnedPlannerV2(
  plan: DailyPlanPreviewV2,
): Promise<void> {
  let expectedPlan: DailyPlanPreviewV2;
  try {
    const expected = await planDailyPreviewV2(
      {
        schema: DAILY_PLAN_PREVIEW_REQUEST_V2_SCHEMA,
        goalId: plan.goalId,
        practiceMinutes: plan.requestedPracticeMinutes,
        localStudyDate: plan.localStudyDate,
        timeZone: plan.timeZone,
        locale: plan.locale,
      },
      DAY_ONE_PREVIEW_REGISTRY_V2,
    );
    if (expected.status !== "ready") {
      throw new Error("The pinned V2 planner is unavailable");
    }
    expectedPlan = expected.plan;
  } catch {
    throw new FractionAdditionV2MaterializationError("invalid-assignment");
  }

  if (canonicalizeJson(plan) !== canonicalizeJson(expectedPlan)) {
    throw new FractionAdditionV2MaterializationError("invalid-assignment");
  }
}

function attributionFromContent(document: ContentDocumentV2) {
  return {
    title: document.title,
    author: document.authors.map((author) => author.name).join(", "),
    sourceUrl: document.license.sourceUrl,
    licenseId: document.license.licenseId,
    attributionText: document.license.attributionText,
    publicationStatus: document.publication.status,
    modifications: [],
  } as const;
}

function fractionAdditionPromptSignature(
  generated: GeneratedFractionAdditionV1,
): string {
  return [generated.model.left, generated.model.right]
    .map(rationalSignature)
    .sort()
    .join("+");
}

function rationalSignature(value: RationalJson): string {
  return `${value.numerator}/${value.denominator}`;
}
