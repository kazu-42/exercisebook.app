import {
  canonicalizeJson,
  deriveSlotSeed,
  sha256Hex,
  type RationalJson,
} from "@exercisebook/domain";
import {
  ContentReferenceV2Schema,
  LocalDateSchema,
  LocaleSchema,
  RNG_ALGORITHM_V1,
  RevisionSchema,
  Sha256HexSchema,
  StableIdSchema,
  TimeZoneSchema,
  WORKSHEET_INSTANCE_V2_SCHEMA,
  assertSafeDataObjectGraph,
  validateContentDocumentV2,
  validateWorksheetInstanceV2,
  type ContentDocumentV2,
  type ContentReferenceV2,
  type MaterializedWorksheetInstanceV2,
  type WorksheetSlotV2,
} from "@exercisebook/schemas";
import { z } from "zod";

import {
  FRACTION_ADDITION_GENERATOR_ID,
  FRACTION_ADDITION_GENERATOR_VERSION,
  generateFractionAdditionProblem,
  type GeneratedFractionAdditionV1,
} from "./fraction-addition.js";
import {
  PresentationResolutionError,
  resolveFractionPresentationContextV1,
  validateAndDetachWorksheetPresentationSelectionV1,
  type WorksheetPresentationSelectionInputV1,
} from "./fraction-presentation-v1.js";

const MAX_REVIEWED_ITEMS_V2 = 8;
const MAX_DUPLICATE_RETRIES = 127;

export interface FractionAdditionAssignmentInputV2 {
  readonly assignmentId: string;
  readonly localStudyDate: string;
  readonly timeZone: string;
  readonly locale: string;
  readonly seed: string;
  readonly seedSecretVersion: string;
  readonly requestedItemCount: number;
  readonly plan: Readonly<{
    id: string;
    version: number;
  }>;
  readonly policy: Readonly<{
    id: string;
    version: number;
  }>;
  readonly skillGraph: Readonly<{
    id: string;
    revision: number;
  }>;
  readonly selectionReasons: readonly WorksheetSlotV2["selectionReasons"][number][];
  readonly content: ContentReferenceV2;
  readonly presentationSelection: WorksheetPresentationSelectionInputV1;
}

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

const PresentationSelectionSnapshotSchema = z.strictObject({
  explanationNodeId: StableIdSchema,
  workedExampleNodeId: StableIdSchema,
  exerciseNodeId: StableIdSchema,
  // Keep rationals opaque here. The resolver owns the safe lexical and exact
  // ordered-tuple contract after this complete value has been detached.
  excludedCanonicalAnswers: z.array(z.unknown()).min(1).max(8),
});

const FractionAdditionAssignmentInputV2Schema = z.strictObject({
  assignmentId: StableIdSchema,
  localStudyDate: LocalDateSchema,
  timeZone: TimeZoneSchema,
  locale: LocaleSchema,
  seed: Sha256HexSchema,
  seedSecretVersion: StableIdSchema,
  requestedItemCount: z.number().int().min(1).max(MAX_REVIEWED_ITEMS_V2),
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
  selectionReasons: z
    .array(
      z.enum(["due-review", "prerequisite-repair", "current-frontier", "transfer"]),
    )
    .min(1)
    .max(10),
  content: ContentReferenceV2Schema,
  presentationSelection: PresentationSelectionSnapshotSchema,
});

interface StableFractionAdditionAssignmentV2 extends Omit<
  FractionAdditionAssignmentInputV2,
  "presentationSelection"
> {
  readonly presentationSelection: WorksheetPresentationSelectionInputV1;
}

/**
 * Materialize a content-derived v2 worksheet from one pre-await input
 * snapshot. No caller-owned object is read after content hashing begins.
 */
export async function materializeFractionAdditionWorksheetFromContentV2(
  document: ContentDocumentV2,
  assignment: FractionAdditionAssignmentInputV2,
): Promise<MaterializedWorksheetInstanceV2> {
  const { document: stableDocument, assignment: stableAssignment } =
    snapshotMaterializationInputs(document, assignment);

  // Hash the exact validated, detached document that the resolver and every
  // downstream derivation will consume. Do not re-read either caller input.
  const computedContentHash = await sha256Hex(canonicalizeJson(stableDocument));
  const resolved = resolveFractionPresentationContextV1({
    document: stableDocument,
    computedContentHash,
    expectedContent: stableAssignment.content,
    selection: stableAssignment.presentationSelection,
  });

  const slots: WorksheetSlotV2[] = [];
  const promptSignatures = new Set<string>();
  const excludedAnswerSignatures = new Set(
    stableAssignment.presentationSelection.excludedCanonicalAnswers.map(
      rationalSignature,
    ),
  );

  for (let index = 0; index < stableAssignment.requestedItemCount; index += 1) {
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
        baseSeed: stableAssignment.seed,
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
      selectionReasons: [...stableAssignment.selectionReasons],
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
      assignmentId: stableAssignment.assignmentId,
      title: stableDocument.title,
      localStudyDate: stableAssignment.localStudyDate,
      timeZone: stableAssignment.timeZone,
      locale: stableAssignment.locale,
      expectedMinutes: slots.reduce((total, slot) => total + slot.expectedMinutes, 0),
      plan: stableAssignment.plan,
      policy: stableAssignment.policy,
      skillGraph: stableAssignment.skillGraph,
      rng: {
        algorithm: RNG_ALGORITHM_V1,
        baseSeed: stableAssignment.seed,
        seedSecretVersion: stableAssignment.seedSecretVersion,
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
  assignment: FractionAdditionAssignmentInputV2,
): Readonly<{
  document: ContentDocumentV2;
  assignment: StableFractionAdditionAssignmentV2;
}> {
  try {
    // The envelope itself is fresh plain data, so this traverses both caller
    // graphs without first reading any caller-owned property.
    assertSafeDataObjectGraph({ document, assignment });
  } catch {
    throw new FractionAdditionV2MaterializationError("unsafe-input");
  }

  let stableAssignment: z.infer<typeof FractionAdditionAssignmentInputV2Schema>;
  try {
    stableAssignment = FractionAdditionAssignmentInputV2Schema.parse(assignment);
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
  if (
    stableAssignment.locale !== "en" ||
    stableAssignment.locale !== stableDocument.locale
  ) {
    throw new FractionAdditionV2MaterializationError("locale-mismatch");
  }

  // Zod clones all typed assignment fields. The intentionally opaque
  // selection rationals pass through the resolver-owned non-throwing lexical
  // validator before the first await; no raw structured-clone failure can
  // escape this boundary.
  const presentationSelection = validateAndDetachWorksheetPresentationSelectionV1(
    stableAssignment.presentationSelection,
  );

  return {
    document: stableDocument,
    assignment: {
      assignmentId: stableAssignment.assignmentId,
      localStudyDate: stableAssignment.localStudyDate,
      timeZone: stableAssignment.timeZone,
      locale: stableAssignment.locale,
      seed: stableAssignment.seed,
      seedSecretVersion: stableAssignment.seedSecretVersion,
      requestedItemCount: stableAssignment.requestedItemCount,
      plan: stableAssignment.plan,
      policy: stableAssignment.policy,
      skillGraph: stableAssignment.skillGraph,
      selectionReasons: stableAssignment.selectionReasons,
      content: stableAssignment.content,
      presentationSelection,
    },
  };
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
