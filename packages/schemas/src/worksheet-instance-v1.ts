import { z } from "zod";
import {
  canonicalizeJson,
  createRational,
  equalRationals,
  MAX_CANONICAL_INTEGER_DIGITS,
  sha256Hex,
} from "@exercisebook/domain";

import {
  assertSafeDataObjectGraph,
  LocalDateSchema,
  LocaleSchema,
  RationalJsonSchema,
  RevisionSchema,
  Sha256HexSchema,
  StableIdSchema,
  TimeZoneSchema,
} from "./common.js";
import { CONTENT_COMPILER_V1 } from "./content-document-v1.js";
import { AttributionV1Schema } from "./attribution-v1.js";

export { AttributionV1Schema } from "./attribution-v1.js";
export type { AttributionV1 } from "./attribution-v1.js";

export const WORKSHEET_INSTANCE_V1_SCHEMA = "exercisebook.worksheet-instance/v1";
export const WORKSHEET_DELIVERY_V1_SCHEMA = "exercisebook.worksheet-delivery/v1";
export const RNG_ALGORITHM_V1 = "xoshiro128ss-v1";

export const FractionAdditionPromptV1Schema = z.strictObject({
  type: z.literal("fraction-addition"),
  instruction: z.string().min(1).max(500),
  left: RationalJsonSchema,
  right: RationalJsonSchema,
  accessibleText: z.string().min(1).max(1_000),
});

export const HintV1Schema = z.strictObject({
  id: StableIdSchema,
  text: z.string().min(1).max(1_000),
});

export const SolutionStepV1Schema = z.strictObject({
  id: StableIdSchema,
  kind: z.enum([
    "common-denominator",
    "rewrite-left",
    "rewrite-right",
    "add-numerators",
    "reduce",
  ]),
  explanation: z.string().min(1).max(2_000),
  expression: z.string().min(1).max(1_000),
  accessibleText: z.string().min(1).max(2_000),
  result: RationalJsonSchema.optional(),
});

export const MisconceptionV1Schema = z.strictObject({
  id: StableIdSchema,
  description: z.string().min(1).max(1_000),
  incorrectAnswer: RationalJsonSchema,
});

export const PrintFallbackV1Schema = z.strictObject({
  type: z.literal("text"),
  text: z.string().min(1).max(2_000),
});

export const SlotProvenanceV1Schema = z.strictObject({
  contentId: StableIdSchema,
  contentRevision: RevisionSchema,
  sourceHash: Sha256HexSchema,
  contentHash: Sha256HexSchema,
  compilerVersion: z.literal(CONTENT_COMPILER_V1),
  generatorId: z.literal("fractions.add"),
  generatorVersion: z.literal("1"),
  generationAttempt: z.number().int().min(0).max(127),
});

export const WorksheetSlotV1Schema = z.strictObject({
  id: StableIdSchema,
  skillIds: z.array(StableIdSchema).min(1).max(20),
  slotSeed: Sha256HexSchema,
  selectionReasons: z
    .array(
      z.enum(["due-review", "prerequisite-repair", "current-frontier", "transfer"]),
    )
    .min(1)
    .max(10),
  expectedMinutes: z.number().int().positive().max(120),
  prompt: FractionAdditionPromptV1Schema,
  canonicalAnswer: z.strictObject({
    type: z.literal("rational"),
    value: RationalJsonSchema,
  }),
  scoringRule: z.strictObject({
    type: z.literal("rational-equals"),
    accepted: RationalJsonSchema,
    requireReduced: z.boolean(),
  }),
  hints: z.array(HintV1Schema).min(1).max(10),
  solutionTrace: z.array(SolutionStepV1Schema).min(1).max(20),
  misconceptions: z.array(MisconceptionV1Schema).max(20),
  accessibility: z.strictObject({
    summary: z.string().min(1).max(2_000),
  }),
  printFallback: PrintFallbackV1Schema,
  provenance: SlotProvenanceV1Schema,
});

export const WorksheetInstanceV1Schema = z
  .strictObject({
    schema: z.literal(WORKSHEET_INSTANCE_V1_SCHEMA),
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
    content: z
      .array(
        z.strictObject({
          id: StableIdSchema,
          revision: RevisionSchema,
          sourceHash: Sha256HexSchema,
          contentHash: Sha256HexSchema,
          compilerVersion: z.literal(CONTENT_COMPILER_V1),
        }),
      )
      .min(1)
      .max(100),
    slots: z.array(WorksheetSlotV1Schema).min(1).max(200),
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

      const reference = contentReferenceKey(
        content.id,
        content.revision,
        content.sourceHash,
        content.contentHash,
        content.compilerVersion,
      );
      contentReferenceCounts.set(
        reference,
        (contentReferenceCounts.get(reference) ?? 0) + 1,
      );
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

      const uniqueSlotCollections: readonly [string, readonly string[]][] = [
        ["skillIds", slot.skillIds],
        ["selectionReasons", slot.selectionReasons],
        ["hints", slot.hints.map((hint) => hint.id)],
        ["solutionTrace", slot.solutionTrace.map((step) => step.id)],
        [
          "misconceptions",
          slot.misconceptions.map((misconception) => misconception.id),
        ],
      ];
      for (const [field, values] of uniqueSlotCollections) {
        const seen = new Set<string>();
        for (const [valueIndex, value] of values.entries()) {
          if (seen.has(value)) {
            context.addIssue({
              code: "custom",
              message: `Duplicate ${field} value in slot ${slot.id}: ${value}`,
              path: ["slots", index, field, valueIndex],
            });
          }
          seen.add(value);
        }
      }

      const provenanceReference = contentReferenceKey(
        slot.provenance.contentId,
        slot.provenance.contentRevision,
        slot.provenance.sourceHash,
        slot.provenance.contentHash,
        slot.provenance.compilerVersion,
      );
      if (contentReferenceCounts.get(provenanceReference) !== 1) {
        context.addIssue({
          code: "custom",
          message: "Slot provenance must match exactly one top-level content reference",
          path: ["slots", index, "provenance"],
        });
      }

      if (
        slot.canonicalAnswer.value.numerator !== slot.scoringRule.accepted.numerator ||
        slot.canonicalAnswer.value.denominator !== slot.scoringRule.accepted.denominator
      ) {
        context.addIssue({
          code: "custom",
          message: "The scoring rule must accept the canonical answer",
          path: ["slots", index, "scoringRule", "accepted"],
        });
      }

      const finalResult = slot.solutionTrace.at(-1)?.result;
      if (
        finalResult === undefined ||
        finalResult.numerator !== slot.canonicalAnswer.value.numerator ||
        finalResult.denominator !== slot.canonicalAnswer.value.denominator
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

function contentIdentityKey(id: string, revision: number): string {
  return `${id}\u0000${revision}`;
}

function contentReferenceKey(
  id: string,
  revision: number,
  sourceHash: string,
  contentHash: string,
  compilerVersion: string,
): string {
  return `${contentIdentityKey(id, revision)}\u0000${sourceHash}\u0000${contentHash}\u0000${compilerVersion}`;
}

export type WorksheetInstanceV1 = z.infer<typeof WorksheetInstanceV1Schema>;
export type WorksheetSlotV1 = z.infer<typeof WorksheetSlotV1Schema>;
export type FractionAdditionPromptV1 = z.infer<typeof FractionAdditionPromptV1Schema>;
export type SolutionStepV1 = z.infer<typeof SolutionStepV1Schema>;

export interface MaterializedWorksheetInstanceV1 {
  readonly instance: WorksheetInstanceV1;
  readonly canonicalJson: string;
  readonly instanceHash: string;
}

export const StudentWorksheetSlotV1Schema = WorksheetSlotV1Schema.pick({
  id: true,
  skillIds: true,
  selectionReasons: true,
  expectedMinutes: true,
  prompt: true,
  hints: true,
  accessibility: true,
  printFallback: true,
  provenance: true,
});

export const StudentWorksheetDeliveryV1Schema = z.strictObject({
  schema: z.literal(WORKSHEET_DELIVERY_V1_SCHEMA),
  instanceHash: Sha256HexSchema,
  assignmentId: StableIdSchema,
  title: z.string().min(1).max(240),
  localStudyDate: LocalDateSchema,
  timeZone: TimeZoneSchema,
  locale: LocaleSchema,
  expectedMinutes: z.number().int().positive().max(480),
  slots: z.array(StudentWorksheetSlotV1Schema).min(1).max(200),
  attributions: z.array(AttributionV1Schema).min(1).max(100),
});

export type StudentWorksheetDeliveryV1 = z.infer<
  typeof StudentWorksheetDeliveryV1Schema
>;

export function deriveFractionAdditionPromptAccessibleText(
  left: CanonicalRationalValue,
  right: CanonicalRationalValue,
): string {
  return `Add ${left.numerator} over ${left.denominator} and ${right.numerator} over ${right.denominator}. Give the answer in lowest terms.`;
}

export function deriveFractionAdditionAccessibilitySummary(
  left: CanonicalRationalValue,
  right: CanonicalRationalValue,
): string {
  return `Fraction addition problem: ${left.numerator} over ${left.denominator} plus ${right.numerator} over ${right.denominator}.`;
}

export function validateWorksheetInstanceV1(value: unknown): WorksheetInstanceV1 {
  assertSafeDataObjectGraph(value);
  return WorksheetInstanceV1Schema.parse(value);
}

export function validateStudentWorksheetDeliveryV1(
  value: unknown,
): StudentWorksheetDeliveryV1 {
  assertSafeDataObjectGraph(value);
  return StudentWorksheetDeliveryV1Schema.parse(value);
}

/**
 * Trusted server-projector context. This is not a response DTO and must never
 * cross into an HTTP response, browser state, client bundle, log, or cache.
 */
export interface StudentWorksheetProjectionV1 {
  readonly delivery: StudentWorksheetDeliveryV1;
  /**
   * Trusted projector context only. Never serialize this collection into a
   * student response or client bundle.
   */
  readonly canonicalAnswers: readonly CanonicalRationalValue[];
}

export async function projectWorksheetForStudent(
  materialized: MaterializedWorksheetInstanceV1,
): Promise<StudentWorksheetDeliveryV1> {
  return (await projectWorksheetForStudentWithCanonicalAnswers(materialized)).delivery;
}

/**
 * Builds delivery and authorization context from one detached, verified
 * snapshot captured before the first await. Consumers must not re-read the
 * caller-owned materialization after awaiting this function.
 */
export async function projectWorksheetForStudentWithCanonicalAnswers(
  materialized: MaterializedWorksheetInstanceV1,
): Promise<StudentWorksheetProjectionV1> {
  assertSafeDataObjectGraph(materialized);
  // Capture the safe data envelope before the first asynchronous yield. Every
  // later authorization decision must describe this one immutable snapshot,
  // even if a caller retains and mutates its original object.
  const providedInstance = materialized.instance;
  const providedCanonicalJson = materialized.canonicalJson;
  const providedInstanceHash = materialized.instanceHash;
  const validatedInstance = validateWorksheetInstanceV1(providedInstance);
  const canonicalJson = canonicalizeJson(validatedInstance);
  if (canonicalJson !== providedCanonicalJson) {
    throw new Error("Worksheet canonical JSON does not match the validated instance");
  }
  const computedHash = await sha256Hex(canonicalJson);
  if (computedHash !== providedInstanceHash) {
    throw new Error("Worksheet instance hash does not match its canonical JSON");
  }

  const canonicalAnswers = validatedInstance.slots.map((slot) => ({
    ...slot.canonicalAnswer.value,
  }));

  const delivery = validateStudentWorksheetDeliveryV1({
    schema: WORKSHEET_DELIVERY_V1_SCHEMA,
    instanceHash: providedInstanceHash,
    assignmentId: validatedInstance.assignmentId,
    title: validatedInstance.title,
    localStudyDate: validatedInstance.localStudyDate,
    timeZone: validatedInstance.timeZone,
    locale: validatedInstance.locale,
    expectedMinutes: validatedInstance.expectedMinutes,
    slots: validatedInstance.slots.map((slot) => ({
      id: slot.id,
      skillIds: slot.skillIds,
      selectionReasons: slot.selectionReasons,
      expectedMinutes: slot.expectedMinutes,
      prompt: slot.prompt,
      hints: slot.hints,
      accessibility: slot.accessibility,
      printFallback: slot.printFallback,
      provenance: slot.provenance,
    })),
    attributions: validatedInstance.attributions,
  });
  assertNoRecognizedCanonicalAnswer(delivery, canonicalAnswers);
  return { delivery, canonicalAnswers };
}

/**
 * Defense-in-depth for accidentally copied answer text. This recognizes
 * rational equivalence across a bounded allowlist of text encodings; deciding
 * whether decimals, percentages, mixed numbers, or arbitrary prose semantically
 * reveal an answer remains outside this runtime gate.
 */
function assertNoRecognizedCanonicalAnswer(
  delivery: StudentWorksheetDeliveryV1,
  canonicalAnswers: readonly CanonicalRationalValue[],
): void {
  if (delivery.slots.length !== canonicalAnswers.length) {
    throw new Error("Student projection slot-to-answer mapping is inconsistent");
  }
  const answerGuard = prepareStudentVisibleAnswerGuard(canonicalAnswers);

  const { slots, ...globalDelivery } = delivery;
  answerGuard.assertDoesNotRevealAnyAnswer(globalDelivery);

  for (const [index, slot] of slots.entries()) {
    const answer = canonicalAnswers[index];
    if (answer === undefined) {
      throw new Error("Student projection slot-to-answer mapping is inconsistent");
    }

    const { prompt, accessibility, ...nonPromptSlot } = slot;
    answerGuard.assertDoesNotRevealAnyAnswer(nonPromptSlot);

    const promptOperands = [prompt.left, prompt.right];
    if (promptOperands.some((operand) => equalRationals(operand, answer))) {
      throw new Error(
        "Student projection contains its own canonical-answer value as a prompt operand",
      );
    }

    if (
      prompt.accessibleText !==
      deriveFractionAdditionPromptAccessibleText(prompt.left, prompt.right)
    ) {
      throw new Error(
        "Student projection prompt accessibleText must equal its deterministic fraction-addition derivation",
      );
    }
    if (
      accessibility.summary !==
      deriveFractionAdditionAccessibilitySummary(prompt.left, prompt.right)
    ) {
      throw new Error(
        "Student projection accessibility summary must equal its deterministic fraction-addition derivation",
      );
    }
    answerGuard.assertDoesNotRevealAnyAnswer({
      type: prompt.type,
      instruction: prompt.instruction,
    });
  }
}

export interface CanonicalRationalValue {
  readonly numerator: string;
  readonly denominator: string;
}

class PreparedStudentVisibleAnswerGuardImpl {
  readonly #allAnswerSignatures: ReadonlySet<string>;
  readonly #answerSignaturesByIndex: readonly ReadonlySet<string>[];
  #remainingSessionCandidates = MAX_RATIONAL_CANDIDATES_PER_SESSION;

  constructor(
    allAnswerSignatures: ReadonlySet<string>,
    answerSignaturesByIndex: readonly ReadonlySet<string>[],
  ) {
    this.#allAnswerSignatures = allAnswerSignatures;
    this.#answerSignaturesByIndex = answerSignaturesByIndex;
  }

  assertDoesNotRevealAnyAnswer(visibleData: unknown): void {
    this.#assertDoesNotRevealAnswers(visibleData, this.#allAnswerSignatures);
  }

  assertDoesNotRevealAnswerAt(visibleData: unknown, answerIndex: number): void {
    if (
      !Number.isInteger(answerIndex) ||
      answerIndex < 0 ||
      answerIndex >= this.#answerSignaturesByIndex.length
    ) {
      throw new Error("Student projection canonical-answer index is invalid");
    }
    const answerSignatures = this.#answerSignaturesByIndex[answerIndex];
    if (answerSignatures === undefined) {
      throw new Error("Student projection canonical-answer index is invalid");
    }
    this.#assertDoesNotRevealAnswers(visibleData, answerSignatures);
  }

  #assertDoesNotRevealAnswers(
    visibleData: unknown,
    canonicalAnswerSignatures: ReadonlySet<string>,
  ): void {
    assertSafeDataObjectGraph(visibleData);
    const scanBudget: RationalCandidateScanBudget = {
      remainingAssertionCandidates: MAX_RATIONAL_CANDIDATES_PER_ASSERTION,
      assertionLimitMessage: `Student projection prepared canonical-answer assertion exceeds ${MAX_RATIONAL_CANDIDATES_PER_ASSERTION} candidates`,
      consumeSessionCandidate: () => {
        if (this.#remainingSessionCandidates <= 0) {
          throw new Error(
            `Student projection prepared canonical-answer phase exceeds ${MAX_RATIONAL_CANDIDATES_PER_SESSION} candidates`,
          );
        }
        this.#remainingSessionCandidates -= 1;
      },
    };
    assertStructuredRationalsDoNotMatchCanonicalAnswers(
      visibleData,
      canonicalAnswerSignatures,
      scanBudget,
    );
    assertStringsDoNotContainCanonicalAnswers(
      collectStringLeaves(visibleData),
      canonicalAnswerSignatures,
      scanBudget,
    );
  }
}

/**
 * Opaque trusted-server authorization context. Its answer signatures are
 * detached during preparation and never exposed as enumerable instance data.
 * The candidate budget is stateful: create one guard for one synchronous
 * authorization phase, then discard it. Never cache it, share it across
 * requests or artifacts, or retry a failed phase with the same guard.
 */
export type PreparedStudentVisibleAnswerGuard = PreparedStudentVisibleAnswerGuardImpl;

export function prepareStudentVisibleAnswerGuard(
  canonicalAnswers: readonly CanonicalRationalValue[],
): PreparedStudentVisibleAnswerGuard {
  assertSafeDataObjectGraph(canonicalAnswers);
  const { allAnswerSignatures, answerSignaturesByIndex } =
    createPreparedCanonicalAnswerSignatureSets(canonicalAnswers);
  const guard = new PreparedStudentVisibleAnswerGuardImpl(
    allAnswerSignatures,
    answerSignaturesByIndex,
  );
  Object.freeze(guard);
  return guard;
}

export function assertStudentVisibleDataHasNoRecognizedCanonicalAnswers(
  visibleData: unknown,
  canonicalAnswers: readonly CanonicalRationalValue[],
): void {
  // Preserve the legacy visible-data-before-answer-context validation order
  // and its text-only per-call candidate budget.
  assertSafeDataObjectGraph(visibleData);
  assertSafeDataObjectGraph(canonicalAnswers);
  const { allAnswerSignatures } =
    createPreparedCanonicalAnswerSignatureSets(canonicalAnswers);
  assertStructuredRationalsDoNotMatchCanonicalAnswers(visibleData, allAnswerSignatures);
  assertStringsDoNotContainCanonicalAnswers(
    collectStringLeaves(visibleData),
    allAnswerSignatures,
    {
      remainingAssertionCandidates: MAX_RATIONAL_CANDIDATES_PER_ASSERTION,
      assertionLimitMessage: `Student projection canonical-answer rational scan exceeds ${MAX_RATIONAL_CANDIDATES_PER_ASSERTION} candidates`,
      consumeSessionCandidate: () => undefined,
    },
  );
}

function assertStructuredRationalsDoNotMatchCanonicalAnswers(
  visibleData: unknown,
  canonicalAnswerSignatures: ReadonlySet<string>,
  scanBudget?: RationalCandidateScanBudget,
): void {
  const pending: unknown[] = [visibleData];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== "object") {
      continue;
    }
    const record = current as Record<string, unknown>;
    if (
      typeof record.numerator === "string" &&
      typeof record.denominator === "string"
    ) {
      if (scanBudget !== undefined) {
        consumeRationalCandidateBudget(scanBudget);
      }
      const signature = structuredRationalSignature(
        record.numerator as string,
        record.denominator as string,
      );
      if (signature !== undefined && canonicalAnswerSignatures.has(signature)) {
        throw new Error(
          "Student projection contains a recognized canonical-answer representation",
        );
      }
    }
    pending.push(...Object.values(record));
  }
}

function structuredRationalSignature(
  numerator: string,
  denominator: string,
): string | undefined {
  if (
    !isCanonicalIntegerSyntax(numerator) ||
    !isCanonicalIntegerSyntax(denominator) ||
    denominator === "0" ||
    denominator.startsWith("-")
  ) {
    return undefined;
  }
  if (
    canonicalIntegerDigitCount(numerator) > MAX_CANONICAL_INTEGER_DIGITS ||
    canonicalIntegerDigitCount(denominator) > MAX_CANONICAL_INTEGER_DIGITS
  ) {
    throw new Error(
      "Student projection contains an unsupported oversized rational representation",
    );
  }
  return rationalSignature(BigInt(numerator), BigInt(denominator));
}

function isCanonicalIntegerSyntax(value: string): boolean {
  return /^-?(?:0|[1-9][0-9]*)$/u.test(value) && value !== "-0";
}

function canonicalIntegerDigitCount(value: string): number {
  return value.startsWith("-") ? value.length - 1 : value.length;
}

// Both WorksheetInstanceV1 and WorksheetInstanceV2 cap practice slots at 200.
const MAX_STUDENT_VISIBLE_CANONICAL_ANSWERS = 200;

function createPreparedCanonicalAnswerSignatureSets(
  canonicalAnswers: readonly CanonicalRationalValue[],
): {
  readonly allAnswerSignatures: ReadonlySet<string>;
  readonly answerSignaturesByIndex: readonly ReadonlySet<string>[];
} {
  if (canonicalAnswers.length > MAX_STUDENT_VISIBLE_CANONICAL_ANSWERS) {
    throw new Error(
      `Student projection canonical-answer context exceeds ${MAX_STUDENT_VISIBLE_CANONICAL_ANSWERS} answers`,
    );
  }
  const allAnswerSignatures = new Set<string>();
  const answerSignaturesByIndex: ReadonlySet<string>[] = [];
  for (const answer of canonicalAnswers) {
    if (
      !isCanonicalIntegerSyntax(answer.numerator) ||
      !isCanonicalIntegerSyntax(answer.denominator) ||
      answer.denominator === "0" ||
      answer.denominator.startsWith("-") ||
      canonicalIntegerDigitCount(answer.numerator) > MAX_CANONICAL_INTEGER_DIGITS ||
      canonicalIntegerDigitCount(answer.denominator) > MAX_CANONICAL_INTEGER_DIGITS
    ) {
      throw new Error("Student projection canonical-answer context is invalid");
    }
    const normalized = createRational(
      BigInt(answer.numerator),
      BigInt(answer.denominator),
    );
    if (
      normalized.numerator !== answer.numerator ||
      normalized.denominator !== answer.denominator
    ) {
      throw new Error("Student projection canonical-answer context is invalid");
    }
    const signature = `${normalized.numerator}\u0000${normalized.denominator}`;
    allAnswerSignatures.add(signature);
    answerSignaturesByIndex.push(new Set([signature]));
  }
  return {
    allAnswerSignatures,
    answerSignaturesByIndex: Object.freeze(answerSignaturesByIndex),
  };
}

function assertStringsDoNotContainCanonicalAnswers(
  visibleStrings: readonly string[],
  canonicalAnswerSignatures: ReadonlySet<string>,
  scanBudget: RationalCandidateScanBudget,
): void {
  if (canonicalAnswerSignatures.size === 0) {
    return;
  }
  for (const visibleString of visibleStrings) {
    for (const normalized of normalizedStringVariants(visibleString)) {
      assertRationalTextCandidatesDoNotMatchCanonicalAnswers(
        normalized,
        canonicalAnswerSignatures,
        scanBudget,
      );
    }
  }
}

// These lexical matchers accept bounded signed decimal digit tokens. This lets
// equivalent noncanonical text such as 078/070 or -78/-70 be recognized without
// blanket-rejecting non-equivalent date/path-like prose. Numeric conversion only
// happens after the captured tokens pass the digit cap below.
// The alternatives are flat and contain no nested repetition, keeping scans
// linear in the already-bounded student-visible string size. The zero-width
// lookahead preserves overlapping starts so a prefix such as `1/` cannot hide
// the answer-equivalent suffix in `1/78/70`.
const RATIONAL_TEXT_CANDIDATE_PATTERN =
  /(?=(?<![0-9-])(-?[0-9]+)(?:\s*([/⁄∕]+)\s*|\s+(over)\s+)(-?[0-9]+)(?![0-9]))/giu;
const TEX_FRACTION_TEXT_CANDIDATE_PATTERN =
  /\\frac\s*\{\s*(-?[0-9]+)\s*\}\s*\{\s*(-?[0-9]+)\s*\}/giu;
const NUMERATOR_FIRST_OBJECT_TEXT_CANDIDATE_PATTERN =
  /\{\s*["']?numerator["']?\s*:\s*["']?(-?[0-9]+)["']?\s*,\s*["']?denominator["']?\s*:\s*["']?(-?[0-9]+)["']?\s*\}/giu;
const DENOMINATOR_FIRST_OBJECT_TEXT_CANDIDATE_PATTERN =
  /\{\s*["']?denominator["']?\s*:\s*["']?(-?[0-9]+)["']?\s*,\s*["']?numerator["']?\s*:\s*["']?(-?[0-9]+)["']?\s*\}/giu;
// Far above legitimate worksheet prose, while bounding normalization-amplified
// GCD work for adversarial but structurally valid string leaves.
const MAX_RATIONAL_CANDIDATES_PER_ASSERTION = 4_096;
const MAX_RATIONAL_CANDIDATES_PER_SESSION = 8_192;

interface RationalCandidateScanBudget {
  remainingAssertionCandidates: number;
  readonly assertionLimitMessage: string;
  readonly consumeSessionCandidate: () => void;
}

function assertRationalTextCandidatesDoNotMatchCanonicalAnswers(
  value: string,
  canonicalAnswerSignatures: ReadonlySet<string>,
  scanBudget: RationalCandidateScanBudget,
): void {
  for (const match of value.matchAll(RATIONAL_TEXT_CANDIDATE_PATTERN)) {
    consumeRationalCandidateBudget(scanBudget);
    const numerator = match[1];
    const slashSeparator = match[2];
    const overSeparator = match[3];
    const denominator = match[4];
    if (
      numerator === undefined ||
      denominator === undefined ||
      (slashSeparator === undefined && overSeparator === undefined)
    ) {
      throw new Error(
        "Student projection contains an unsupported malformed rational representation",
      );
    }

    assertBoundedRationalTextCandidate(numerator, denominator, slashSeparator);
    assertRationalTextCandidateDoesNotMatchCanonicalAnswers(
      numerator,
      denominator,
      canonicalAnswerSignatures,
    );
  }

  for (const match of value.matchAll(TEX_FRACTION_TEXT_CANDIDATE_PATTERN)) {
    consumeRationalCandidateBudget(scanBudget);
    assertFixedRationalTextMatchDoesNotRevealCanonicalAnswer(
      match,
      1,
      2,
      canonicalAnswerSignatures,
    );
  }
  for (const match of value.matchAll(NUMERATOR_FIRST_OBJECT_TEXT_CANDIDATE_PATTERN)) {
    consumeRationalCandidateBudget(scanBudget);
    assertFixedRationalTextMatchDoesNotRevealCanonicalAnswer(
      match,
      1,
      2,
      canonicalAnswerSignatures,
    );
  }
  for (const match of value.matchAll(DENOMINATOR_FIRST_OBJECT_TEXT_CANDIDATE_PATTERN)) {
    consumeRationalCandidateBudget(scanBudget);
    assertFixedRationalTextMatchDoesNotRevealCanonicalAnswer(
      match,
      2,
      1,
      canonicalAnswerSignatures,
    );
  }
}

function consumeRationalCandidateBudget(scanBudget: RationalCandidateScanBudget): void {
  if (scanBudget.remainingAssertionCandidates <= 0) {
    throw new Error(scanBudget.assertionLimitMessage);
  }
  scanBudget.consumeSessionCandidate();
  scanBudget.remainingAssertionCandidates -= 1;
}

function assertFixedRationalTextMatchDoesNotRevealCanonicalAnswer(
  match: RegExpExecArray,
  numeratorIndex: number,
  denominatorIndex: number,
  canonicalAnswerSignatures: ReadonlySet<string>,
): void {
  const numerator = match[numeratorIndex];
  const denominator = match[denominatorIndex];
  if (numerator === undefined || denominator === undefined) {
    throw new Error(
      "Student projection contains an unsupported malformed rational representation",
    );
  }
  assertBoundedRationalTextCandidate(numerator, denominator, undefined);
  assertRationalTextCandidateDoesNotMatchCanonicalAnswers(
    numerator,
    denominator,
    canonicalAnswerSignatures,
  );
}

function assertRationalTextCandidateDoesNotMatchCanonicalAnswers(
  numerator: string,
  denominator: string,
  canonicalAnswerSignatures: ReadonlySet<string>,
): void {
  const parsedNumerator = BigInt(numerator);
  const parsedDenominator = BigInt(denominator);
  if (parsedDenominator === 0n) {
    throw new Error(
      "Student projection contains an unsupported malformed rational representation",
    );
  }
  if (
    canonicalAnswerSignatures.has(rationalSignature(parsedNumerator, parsedDenominator))
  ) {
    throw new Error(
      "Student projection contains a recognized canonical-answer representation",
    );
  }
}

function rationalSignature(numerator: bigint, denominator: bigint): string {
  const normalized = createRational(numerator, denominator);
  return `${normalized.numerator}\u0000${normalized.denominator}`;
}

function assertBoundedRationalTextCandidate(
  numerator: string,
  denominator: string,
  slashSeparator: string | undefined,
): void {
  if (
    canonicalIntegerDigitCount(numerator) > MAX_CANONICAL_INTEGER_DIGITS ||
    canonicalIntegerDigitCount(denominator) > MAX_CANONICAL_INTEGER_DIGITS
  ) {
    throw new Error(
      "Student projection contains an unsupported oversized rational representation",
    );
  }
  if (slashSeparator !== undefined && slashSeparator.length !== 1) {
    throw new Error(
      "Student projection contains an unsupported malformed rational representation",
    );
  }
}

function collectStringLeaves(value: unknown): readonly string[] {
  const strings: string[] = [];
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      strings.push(current);
      continue;
    }
    if (current !== null && typeof current === "object") {
      pending.push(...Object.values(current));
    }
  }
  return strings;
}

const NESTED_URI_ENCODED_PERCENT_PATTERN = /%(?:25)+(?=[0-9a-f]{2})/giu;
const URI_ENCODED_BYTE_WITH_PERCENT_LAYERS_PATTERN = /%((?:25)+)([0-9a-f]{2})/giu;
const URI_COMPONENT_UNESCAPED_ASCII_PATTERN = /^[a-z0-9\-_.!~*'()]*$/iu;
const URI_ENCODED_BYTE_RUN_PATTERN = /(?:%[0-9a-f]{2})+/giu;
const UTF8_REPLACEMENT_DECODER = new TextDecoder("utf-8", { fatal: false });
const MAX_URI_COMPATIBILITY_DECODE_ROUNDS = 3;
const MAX_STUDENT_VISIBLE_NORMALIZATION_STATES = 24;

interface StudentVisibleNormalizationState {
  readonly value: string;
  readonly uriDecodeRound: number;
}

function normalizedStringVariants(value: string): readonly string[] {
  const variants = new Set<string>();
  const pending: StudentVisibleNormalizationState[] = [];
  const scheduledRoundsByValue = new Map<string, number>();
  let scheduledStateCount = 0;

  const schedule = (candidate: string, uriDecodeRound: number): void => {
    const roundBit = 1 << uriDecodeRound;
    const scheduledRounds = scheduledRoundsByValue.get(candidate) ?? 0;
    if ((scheduledRounds & roundBit) !== 0) {
      return;
    }
    if (scheduledStateCount >= MAX_STUDENT_VISIBLE_NORMALIZATION_STATES) {
      throw new Error(
        `Student projection canonical-answer normalization exceeds ${MAX_STUDENT_VISIBLE_NORMALIZATION_STATES} states`,
      );
    }
    scheduledRoundsByValue.set(candidate, scheduledRounds | roundBit);
    scheduledStateCount += 1;
    pending.push({ value: candidate, uriDecodeRound });
  };

  schedule(value, 0);
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    variants.add(current.value);

    // Re-enqueue every same-round transform until the deduplicated worklist
    // reaches its local fixed point. NFKC and form-style plus normalization
    // are not assumed to commute.
    schedule(current.value.normalize("NFKC"), current.uriDecodeRound);
    schedule(current.value.replaceAll("+", " "), current.uriDecodeRound);

    if (!current.value.includes("%")) {
      continue;
    }

    // Standard encodeURIComponent wrapping only adds one common `25` layer
    // to every encoded byte. Compress all but one provably common outer layer
    // at the same round. Keeping one layer preserves the first potentially
    // ambiguous intermediate, while the strict whole-string eligibility check
    // prevents mixed or malformed input from taking this shortcut.
    const commonLayerCollapsed = collapseCommonUriPercentEncodingLayers(current.value);
    if (commonLayerCollapsed !== current.value) {
      schedule(commonLayerCollapsed, current.uriDecodeRound);
      continue;
    }

    // Repeated encodeURIComponent calls only add another `25` after each
    // encoded percent. Collapse that finite run in one linear scan so the
    // amount of work is independent of the encoding depth.
    const collapsed = current.value.replace(NESTED_URI_ENCODED_PERCENT_PATTERN, "%");
    schedule(collapsed, current.uriDecodeRound);

    // Decode both the current state and its independently collapsed form.
    // Collapsing first can reinterpret answer-leading digits as one encoded
    // byte (for example, `%2539` becomes `%39`) and destroy an intermediate
    // that an ordinary URI decode would expose.
    for (const decodeInput of new Set([current.value, collapsed])) {
      const decoded = decodeUriComponentWithoutThrowing(decodeInput);
      if (decoded === decodeInput) {
        continue;
      }
      if (current.uriDecodeRound >= MAX_URI_COMPATIBILITY_DECODE_ROUNDS) {
        throw new Error(
          `Student projection canonical-answer normalization exceeds ${MAX_URI_COMPATIBILITY_DECODE_ROUNDS} URI decode rounds`,
        );
      }
      schedule(decoded, current.uriDecodeRound + 1);
    }
  }

  return [...variants];
}

function collapseCommonUriPercentEncodingLayers(value: string): string {
  const encodedBytes = [
    ...value.matchAll(URI_ENCODED_BYTE_WITH_PERCENT_LAYERS_PATTERN),
  ];
  if (encodedBytes.length === 0) {
    return value;
  }

  let cursor = 0;
  let commonLayerCount = Number.POSITIVE_INFINITY;
  for (const encodedByte of encodedBytes) {
    if (
      encodedByte.index === undefined ||
      !URI_COMPONENT_UNESCAPED_ASCII_PATTERN.test(
        value.slice(cursor, encodedByte.index),
      )
    ) {
      return value;
    }
    commonLayerCount = Math.min(commonLayerCount, (encodedByte[1]?.length ?? 0) / 2);
    cursor = encodedByte.index + encodedByte[0].length;
  }
  if (
    !URI_COMPONENT_UNESCAPED_ASCII_PATTERN.test(value.slice(cursor)) ||
    commonLayerCount <= 1
  ) {
    return value;
  }

  const removableLayerLength = (commonLayerCount - 1) * 2;
  return value.replace(
    URI_ENCODED_BYTE_WITH_PERCENT_LAYERS_PATTERN,
    (_match, percentLayers: string, encodedByte: string) =>
      `%${percentLayers.slice(removableLayerLength)}${encodedByte}`,
  );
}

function decodeUriComponentWithoutThrowing(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Decode valid byte runs independently so malformed URI text cannot hide
    // a valid encoded answer and decoder exceptions never escape.
    return decodeValidUriByteRuns(value);
  }
}

function decodeValidUriByteRuns(value: string): string {
  return value.replace(URI_ENCODED_BYTE_RUN_PATTERN, (encodedBytes) => {
    const bytes = new Uint8Array(encodedBytes.length / 3);
    for (let offset = 0; offset < encodedBytes.length; offset += 3) {
      bytes[offset / 3] = Number.parseInt(
        encodedBytes.slice(offset + 1, offset + 3),
        16,
      );
    }
    return UTF8_REPLACEMENT_DECODER.decode(bytes);
  });
}
