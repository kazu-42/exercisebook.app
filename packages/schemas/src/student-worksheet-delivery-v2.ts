import { canonicalizeJson, equalRationals, sha256Hex } from "@exercisebook/domain";
import { z } from "zod";

import {
  assertSafeDataObjectGraph,
  LocalDateSchema,
  LocaleSchema,
  Sha256HexSchema,
  StableIdSchema,
  TimeZoneSchema,
} from "./common.js";
import {
  AttributionV1Schema,
  assertStudentVisibleDataHasNoRecognizedCanonicalAnswers,
  deriveFractionAdditionAccessibilitySummary,
  deriveFractionAdditionPromptAccessibleText,
  type CanonicalRationalValue,
} from "./worksheet-instance-v1.js";
import {
  WorksheetPresentationV1Schema,
  WorksheetSlotV2Schema,
  validateWorksheetInstanceV2,
  type MaterializedWorksheetInstanceV2,
  type WorksheetPresentationV1,
} from "./worksheet-instance-v2.js";

export const WORKSHEET_DELIVERY_V2_SCHEMA = "exercisebook.worksheet-delivery/v2";

export const StudentWorksheetSlotV2Schema = WorksheetSlotV2Schema.pick({
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

export const StudentWorksheetDeliveryV2Schema = z.strictObject({
  schema: z.literal(WORKSHEET_DELIVERY_V2_SCHEMA),
  instanceHash: Sha256HexSchema,
  assignmentId: StableIdSchema,
  title: z.string().min(1).max(240),
  localStudyDate: LocalDateSchema,
  timeZone: TimeZoneSchema,
  locale: LocaleSchema,
  expectedMinutes: z.number().int().positive().max(480),
  presentation: WorksheetPresentationV1Schema,
  slots: z.array(StudentWorksheetSlotV2Schema).min(1).max(200),
  attributions: z.array(AttributionV1Schema).min(1).max(100),
});

export type StudentWorksheetSlotV2 = z.infer<typeof StudentWorksheetSlotV2Schema>;
export type StudentWorksheetDeliveryV2 = z.infer<
  typeof StudentWorksheetDeliveryV2Schema
>;

/**
 * Trusted server-projector context. Canonical answers must never cross into a
 * response, client bundle, persisted student state, log, or cache.
 */
export interface StudentWorksheetProjectionV2 {
  readonly delivery: StudentWorksheetDeliveryV2;
  readonly canonicalAnswers: readonly CanonicalRationalValue[];
}

export function validateStudentWorksheetDeliveryV2(
  value: unknown,
): StudentWorksheetDeliveryV2 {
  assertSafeDataObjectGraph(value);
  return StudentWorksheetDeliveryV2Schema.parse(value);
}

export async function projectWorksheetV2ForStudent(
  materialized: MaterializedWorksheetInstanceV2,
): Promise<StudentWorksheetDeliveryV2> {
  return (await projectWorksheetV2ForStudentWithCanonicalAnswers(materialized))
    .delivery;
}

/**
 * Authorizes one detached snapshot captured before the first asynchronous
 * yield. Consumers must not re-read the caller-owned materialization after
 * this function resolves.
 */
export async function projectWorksheetV2ForStudentWithCanonicalAnswers(
  materialized: MaterializedWorksheetInstanceV2,
): Promise<StudentWorksheetProjectionV2> {
  assertSafeDataObjectGraph(materialized);

  const providedInstance = materialized.instance;
  const providedCanonicalJson = materialized.canonicalJson;
  const providedInstanceHash = materialized.instanceHash;
  const validatedInstance = validateWorksheetInstanceV2(providedInstance);
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
  const delivery = validateStudentWorksheetDeliveryV2({
    schema: WORKSHEET_DELIVERY_V2_SCHEMA,
    instanceHash: computedHash,
    assignmentId: validatedInstance.assignmentId,
    title: validatedInstance.title,
    localStudyDate: validatedInstance.localStudyDate,
    timeZone: validatedInstance.timeZone,
    locale: validatedInstance.locale,
    expectedMinutes: validatedInstance.expectedMinutes,
    presentation: validatedInstance.presentation,
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

  assertNoRecognizedCanonicalAnswerV2(delivery, canonicalAnswers);
  return { delivery, canonicalAnswers };
}

function assertNoRecognizedCanonicalAnswerV2(
  delivery: StudentWorksheetDeliveryV2,
  canonicalAnswers: readonly CanonicalRationalValue[],
): void {
  if (delivery.slots.length !== canonicalAnswers.length) {
    throw new Error("Student projection slot-to-answer mapping is inconsistent");
  }

  const { slots, presentation, ...globalDelivery } = delivery;
  assertStudentVisibleDataHasNoRecognizedCanonicalAnswers(
    globalDelivery,
    canonicalAnswers,
  );
  assertStudentVisibleDataHasNoRecognizedCanonicalAnswers(
    presentation,
    canonicalAnswers,
  );
  assertPresentationIntermediatesDoNotMatchCanonicalAnswers(
    presentation,
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

    if (
      [prompt.left, prompt.right].some((operand) => equalRationals(operand, answer))
    ) {
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

/**
 * Testable internal guard for the displayed, intentionally unreduced worked-
 * example pairs. This module is not exported as a public package subpath.
 */
export function assertPresentationIntermediatesDoNotMatchCanonicalAnswers(
  presentation: WorksheetPresentationV1,
  canonicalAnswers: readonly CanonicalRationalValue[],
): void {
  const model = presentation.workedExample.model;
  assertStudentVisibleDataHasNoRecognizedCanonicalAnswers(
    [
      {
        numerator: model.leftScaledNumerator,
        denominator: model.commonDenominator,
      },
      {
        numerator: model.rightScaledNumerator,
        denominator: model.commonDenominator,
      },
      {
        numerator: model.unreducedSumNumerator,
        denominator: model.commonDenominator,
      },
    ],
    canonicalAnswers,
  );
}
