import { z } from "zod";
import {
  canonicalizeJson,
  equalRationals,
  MAX_CANONICAL_INTEGER_DIGITS,
  sha256Hex,
} from "@exercisebook/domain";

import {
  assertSafeDataObjectGraph,
  HttpUrlSchema,
  LocalDateSchema,
  LocaleSchema,
  RationalJsonSchema,
  RevisionSchema,
  Sha256HexSchema,
  StableIdSchema,
  TimeZoneSchema,
} from "./common.js";
import { CONTENT_COMPILER_V1 } from "./content-document-v1.js";

export const WORKSHEET_INSTANCE_V1_SCHEMA = "exercisebook.worksheet-instance/v1";
export const WORKSHEET_DELIVERY_V1_SCHEMA = "exercisebook.worksheet-delivery/v1";
export const RNG_ALGORITHM_V1 = "xoshiro128ss-v1";

export const AttributionV1Schema = z.strictObject({
  title: z.string().min(1).max(240),
  author: z.string().min(1).max(240),
  sourceUrl: HttpUrlSchema,
  licenseId: z.string().min(1).max(160),
  attributionText: z.string().min(1).max(1_000),
  publicationStatus: z.enum(["draft", "published"]),
  modifications: z.array(z.string().min(1).max(500)).max(50),
});

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
export type AttributionV1 = z.infer<typeof AttributionV1Schema>;

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
 * Defense-in-depth for accidentally copied answer text. This deliberately
 * recognizes common exact encodings only; deciding whether arbitrary prose
 * semantically reveals an answer is not computable as a complete runtime gate.
 */
function assertNoRecognizedCanonicalAnswer(
  delivery: StudentWorksheetDeliveryV1,
  canonicalAnswers: readonly CanonicalRationalValue[],
): void {
  if (delivery.slots.length !== canonicalAnswers.length) {
    throw new Error("Student projection slot-to-answer mapping is inconsistent");
  }

  const { slots, ...globalDelivery } = delivery;
  assertStudentVisibleDataHasNoRecognizedCanonicalAnswers(
    globalDelivery,
    canonicalAnswers,
  );

  for (const [index, slot] of slots.entries()) {
    const answer = canonicalAnswers[index];
    if (answer === undefined) {
      throw new Error("Student projection slot-to-answer mapping is inconsistent");
    }

    const { prompt, accessibility, ...nonPromptSlot } = slot;
    assertStudentVisibleDataHasNoRecognizedCanonicalAnswers(
      nonPromptSlot,
      canonicalAnswers,
    );

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
    assertStudentVisibleDataHasNoRecognizedCanonicalAnswers(
      { type: prompt.type, instruction: prompt.instruction },
      canonicalAnswers,
    );
  }
}

export interface CanonicalRationalValue {
  readonly numerator: string;
  readonly denominator: string;
}

export function assertStudentVisibleDataHasNoRecognizedCanonicalAnswers(
  visibleData: unknown,
  canonicalAnswers: readonly CanonicalRationalValue[],
): void {
  assertSafeDataObjectGraph(visibleData);
  assertStructuredRationalsDoNotMatchCanonicalAnswers(visibleData, canonicalAnswers);
  assertStringsDoNotContainCanonicalAnswers(
    collectStringLeaves(visibleData),
    canonicalAnswers,
  );
}

function assertStructuredRationalsDoNotMatchCanonicalAnswers(
  visibleData: unknown,
  canonicalAnswers: readonly CanonicalRationalValue[],
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
      typeof record.denominator === "string" &&
      canonicalAnswers.some((answer) =>
        rationalStringsAreEqual(
          record.numerator as string,
          record.denominator as string,
          answer,
        ),
      )
    ) {
      throw new Error(
        "Student projection contains a recognized canonical-answer representation",
      );
    }
    pending.push(...Object.values(record));
  }
}

function rationalStringsAreEqual(
  numerator: string,
  denominator: string,
  answer: CanonicalRationalValue,
): boolean {
  if (
    !isCanonicalIntegerSyntax(numerator) ||
    !isCanonicalIntegerSyntax(denominator) ||
    denominator === "0" ||
    denominator.startsWith("-")
  ) {
    return false;
  }
  if (
    canonicalIntegerDigitCount(numerator) > MAX_CANONICAL_INTEGER_DIGITS ||
    canonicalIntegerDigitCount(denominator) > MAX_CANONICAL_INTEGER_DIGITS
  ) {
    throw new Error(
      "Student projection contains an unsupported oversized rational representation",
    );
  }
  return (
    BigInt(numerator) * BigInt(answer.denominator) ===
    BigInt(answer.numerator) * BigInt(denominator)
  );
}

function isCanonicalIntegerSyntax(value: string): boolean {
  return /^-?(?:0|[1-9][0-9]*)$/u.test(value) && value !== "-0";
}

function canonicalIntegerDigitCount(value: string): number {
  return value.startsWith("-") ? value.length - 1 : value.length;
}

function assertStringsDoNotContainCanonicalAnswers(
  visibleStrings: readonly string[],
  canonicalAnswers: readonly CanonicalRationalValue[],
): void {
  for (const answer of canonicalAnswers) {
    const patterns = canonicalAnswerPatterns(answer);
    for (const visibleString of visibleStrings) {
      for (const normalized of normalizedStringVariants(visibleString)) {
        if (patterns.some((pattern) => pattern.test(normalized))) {
          throw new Error(
            "Student projection contains a recognized canonical-answer representation",
          );
        }
      }
    }
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

function normalizedStringVariants(value: string): readonly string[] {
  const variants = new Set<string>();
  let current = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    variants.add(current);
    variants.add(current.normalize("NFKC"));

    const formEncoded = current.replaceAll("+", " ");
    variants.add(formEncoded);
    let decoded: string;
    try {
      decoded = decodeURIComponent(formEncoded);
    } catch {
      break;
    }
    if (decoded === current) {
      break;
    }
    current = decoded;
  }
  return [...variants];
}

function canonicalAnswerPatterns(answer: {
  readonly numerator: string;
  readonly denominator: string;
}): readonly RegExp[] {
  const numerator = escapeRegularExpression(answer.numerator);
  const denominator = escapeRegularExpression(answer.denominator);
  const leftNumberBoundary = "(?<![0-9])";
  const rightNumberBoundary = "(?![0-9])";
  const optionalQuote = `["']?`;
  const numeratorField =
    `${optionalQuote}numerator${optionalQuote}\\s*:\\s*` +
    `${optionalQuote}${numerator}${optionalQuote}`;
  const denominatorField =
    `${optionalQuote}denominator${optionalQuote}\\s*:\\s*` +
    `${optionalQuote}${denominator}${optionalQuote}`;

  return [
    new RegExp(
      `${leftNumberBoundary}${numerator}\\s*[/⁄∕]\\s*${denominator}${rightNumberBoundary}`,
      "iu",
    ),
    new RegExp(
      `${leftNumberBoundary}${numerator}\\s+over\\s+${denominator}${rightNumberBoundary}`,
      "iu",
    ),
    new RegExp(
      `\\\\frac\\s*\\{\\s*${numerator}\\s*\\}\\s*\\{\\s*${denominator}\\s*\\}`,
      "iu",
    ),
    new RegExp(`\\{\\s*${numeratorField}\\s*,\\s*${denominatorField}\\s*\\}`, "iu"),
    new RegExp(`\\{\\s*${denominatorField}\\s*,\\s*${numeratorField}\\s*\\}`, "iu"),
  ];
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
