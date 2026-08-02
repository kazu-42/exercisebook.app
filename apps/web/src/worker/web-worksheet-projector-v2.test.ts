import { canonicalizeJson, equalRationals, sha256Hex } from "@exercisebook/domain";
import { materializeFractionAdditionWorksheetFromContentV2 } from "@exercisebook/generators";
import {
  DAILY_PLAN_PREVIEW_REQUEST_V2_SCHEMA,
  DAY_ONE_PREVIEW_REGISTRY_V2,
  planDailyPreviewV2,
} from "@exercisebook/planner";
import {
  deriveFractionAdditionPromptAccessibleText,
  validateWorksheetInstanceV2,
  type CanonicalRationalValue,
  type MaterializedWorksheetInstanceV2,
  type WorksheetInstanceV2,
} from "@exercisebook/schemas";
import { projectWorksheetV2ForStudentWithCanonicalAnswers } from "@exercisebook/schemas/trusted-student-projection";
import type { StudentWebWorksheetV2 } from "@exercisebook/web-renderer";
import { describe, expect, it } from "vitest";

import { SAMPLE_CONTENT_DOCUMENT_V2 } from "./sample-content-v2.js";
import {
  assertStudentWebWorksheetV2DoesNotRevealPracticeAnswers,
  projectStudentWorksheetForWebV2,
} from "./web-worksheet-projector-v2.js";

const REQUEST_DATE = "2026-07-19";

async function createMaterializedFixture(): Promise<MaterializedWorksheetInstanceV2> {
  const planned = await planDailyPreviewV2(
    {
      schema: DAILY_PLAN_PREVIEW_REQUEST_V2_SCHEMA,
      goalId: "math.fractions.add-unlike",
      practiceMinutes: 12,
      localStudyDate: REQUEST_DATE,
      timeZone: "Asia/Tokyo",
      locale: "en",
    },
    DAY_ONE_PREVIEW_REGISTRY_V2,
  );
  if (planned.status !== "ready") {
    throw new Error("Expected the pinned V2 preview to be available");
  }
  return materializeFractionAdditionWorksheetFromContentV2(
    SAMPLE_CONTENT_DOCUMENT_V2,
    planned.plan,
  );
}

async function rematerializeFixture(
  instance: WorksheetInstanceV2,
): Promise<MaterializedWorksheetInstanceV2> {
  const stableInstance = validateWorksheetInstanceV2(instance);
  const canonicalJson = canonicalizeJson(stableInstance);
  return {
    instance: stableInstance,
    canonicalJson,
    instanceHash: await sha256Hex(canonicalJson),
  };
}

type MutableWebWorksheetV2 = {
  presentation: {
    workedExample: {
      model: {
        left: CanonicalRationalValue;
        right: CanonicalRationalValue;
        result: CanonicalRationalValue;
        commonDenominator: string;
        leftScaledNumerator: string;
        rightScaledNumerator: string;
        unreducedSumNumerator: string;
      };
    };
  };
  items: Array<{
    prompt: {
      left: CanonicalRationalValue;
      right: CanonicalRationalValue;
      accessibleText: string;
    };
    responseLabel: string;
  }>;
};

describe("WorksheetInstanceV2 Web projector", () => {
  it("projects one real V2 materialization without changing presentation or attribution", async () => {
    const materialized = await createMaterializedFixture();

    const worksheet = await projectStudentWorksheetForWebV2(materialized);

    expect(worksheet).toMatchObject({
      schemaVersion: "web-worksheet.v2",
      instanceHash: materialized.instanceHash,
      assignmentId: materialized.instance.assignmentId,
      title: materialized.instance.title,
      studyDate: materialized.instance.localStudyDate,
      locale: materialized.instance.locale,
      expectedMinutes: materialized.instance.expectedMinutes,
      variant: "student",
    });
    expect(worksheet.presentation).toEqual(materialized.instance.presentation);
    expect(worksheet.attributions).toEqual(materialized.instance.attributions);
    expect(worksheet.items).toHaveLength(materialized.instance.slots.length);
    expect(worksheet.items).toEqual(
      materialized.instance.slots.map((slot, index) => ({
        id: slot.id,
        ordinal: index + 1,
        prompt: {
          kind: "fraction-addition",
          left: slot.prompt.left,
          right: slot.prompt.right,
          accessibleText: deriveFractionAdditionPromptAccessibleText(
            slot.prompt.left,
            slot.prompt.right,
          ),
        },
        responseLabel: `Your answer for problem ${String(index + 1)}`,
        printFallback: slot.printFallback.text,
      })),
    );

    const serialized = JSON.stringify(worksheet);
    for (const protectedName of [
      "baseSeed",
      "canonicalAnswer",
      "hints",
      "misconceptions",
      "provenance",
      "scoringRule",
      "seedSecretVersion",
      "slotSeed",
      "solutionTrace",
      "timeZone",
    ]) {
      expect(serialized).not.toContain(protectedName);
    }
  });

  it("captures a detached snapshot before hashing and ignores later caller mutation", async () => {
    const materialized = await createMaterializedFixture();
    const expectedPresentation = structuredClone(materialized.instance.presentation);
    const expectedAttributions = structuredClone(materialized.instance.attributions);
    const expectedTitle = materialized.instance.title;

    const pending = projectStudentWorksheetForWebV2(materialized);
    materialized.instance.title = "Caller-mutated title";
    materialized.instance.presentation.lesson.title = "Caller-mutated lesson";
    materialized.instance.attributions[0]!.title = "Caller-mutated attribution";

    const worksheet = await pending;
    expect(worksheet.title).toBe(expectedTitle);
    expect(worksheet.presentation).toEqual(expectedPresentation);
    expect(worksheet.attributions).toEqual(expectedAttributions);
  });

  it("rejects a materialization hash mismatch", async () => {
    const materialized = await createMaterializedFixture();

    await expect(
      projectStudentWorksheetForWebV2({
        ...materialized,
        instanceHash: "0".repeat(64),
      }),
    ).rejects.toThrow(/hash/u);
  });

  it("rejects a hash-correct presentation answer leak", async () => {
    const materialized = await createMaterializedFixture();
    const instance = structuredClone(materialized.instance);
    const answer = instance.slots[0]!.canonicalAnswer.value;
    instance.presentation.lesson.paragraphs[0] = `A leaked practice answer is ${answer.numerator}/${answer.denominator}.`;

    await expect(
      projectStudentWorksheetForWebV2(await rematerializeFixture(instance)),
    ).rejects.toThrow(/canonical-answer representation/u);
  });

  it("rejects a hash-correct answer leak in a non-prompt item field", async () => {
    const materialized = await createMaterializedFixture();
    const instance = structuredClone(materialized.instance);
    const answer = instance.slots[1]!.canonicalAnswer.value;
    instance.slots[0]!.printFallback.text = `A leaked answer from another problem is ${answer.numerator}/${answer.denominator}.`;

    await expect(
      projectStudentWorksheetForWebV2(await rematerializeFixture(instance)),
    ).rejects.toThrow(/canonical-answer representation/u);
  });

  it("rechecks every final non-prompt Web field against every answer", async () => {
    const materialized = await createMaterializedFixture();
    const projection =
      await projectWorksheetV2ForStudentWithCanonicalAnswers(materialized);
    const worksheet = structuredClone(
      await projectStudentWorksheetForWebV2(materialized),
    ) as StudentWebWorksheetV2 & MutableWebWorksheetV2;
    const leakedAnswer = projection.canonicalAnswers[1]!;
    worksheet.items[0]!.responseLabel = `The other problem's answer is ${leakedAnswer.numerator}/${leakedAnswer.denominator}.`;

    expect(() =>
      assertStudentWebWorksheetV2DoesNotRevealPracticeAnswers(
        worksheet,
        projection.canonicalAnswers,
      ),
    ).toThrow(/canonical-answer representation/u);
  });

  it("reconstructs structured worked-example intermediates during the final scan", async () => {
    const materialized = await createMaterializedFixture();
    const projection =
      await projectWorksheetV2ForStudentWithCanonicalAnswers(materialized);
    const worksheet = structuredClone(
      await projectStudentWorksheetForWebV2(materialized),
    ) as StudentWebWorksheetV2 & MutableWebWorksheetV2;
    const model = worksheet.presentation.workedExample.model;
    // Make the direct left/right/result pairs distinct from 1/5 while the
    // displayed leftScaledNumerator/commonDenominator pair remains 7/35.
    // The final guard must reconstruct that pair rather than scan its integer
    // properties independently.
    model.left = { numerator: "2", denominator: "5" };
    model.right = { numerator: "1", denominator: "7" };
    model.result = { numerator: "12", denominator: "35" };
    model.commonDenominator = "35";
    model.leftScaledNumerator = "7";
    model.rightScaledNumerator = "5";
    model.unreducedSumNumerator = "12";
    const answers = projection.canonicalAnswers.map((answer, index) =>
      index === 0 ? { numerator: "1", denominator: "5" } : answer,
    );

    expect(() =>
      assertStudentWebWorksheetV2DoesNotRevealPracticeAnswers(worksheet, answers),
    ).toThrow(/canonical-answer representation/u);
  });

  it("rejects an own-answer prompt operand but permits another slot's answer", async () => {
    const materialized = await createMaterializedFixture();
    const projection =
      await projectWorksheetV2ForStudentWithCanonicalAnswers(materialized);
    const original = await projectStudentWorksheetForWebV2(materialized);
    const ownAnswer = projection.canonicalAnswers[0]!;
    const crossSlotAnswer = projection.canonicalAnswers.find(
      (answer) => !equalRationals(answer, ownAnswer),
    );
    if (crossSlotAnswer === undefined) {
      throw new Error("Expected at least one distinct cross-slot answer");
    }

    const ownLeak = structuredClone(original) as StudentWebWorksheetV2 &
      MutableWebWorksheetV2;
    ownLeak.items[0]!.prompt.left = { ...ownAnswer };
    ownLeak.items[0]!.prompt.accessibleText =
      deriveFractionAdditionPromptAccessibleText(
        ownLeak.items[0]!.prompt.left,
        ownLeak.items[0]!.prompt.right,
      );
    expect(() =>
      assertStudentWebWorksheetV2DoesNotRevealPracticeAnswers(
        ownLeak,
        projection.canonicalAnswers,
      ),
    ).toThrow(/own canonical-answer value/u);

    const legitimateCrossSlotOperand = structuredClone(
      original,
    ) as StudentWebWorksheetV2 & MutableWebWorksheetV2;
    legitimateCrossSlotOperand.items[0]!.prompt.left = { ...crossSlotAnswer };
    legitimateCrossSlotOperand.items[0]!.prompt.accessibleText =
      deriveFractionAdditionPromptAccessibleText(
        legitimateCrossSlotOperand.items[0]!.prompt.left,
        legitimateCrossSlotOperand.items[0]!.prompt.right,
      );
    expect(() =>
      assertStudentWebWorksheetV2DoesNotRevealPracticeAnswers(
        legitimateCrossSlotOperand,
        projection.canonicalAnswers,
      ),
    ).not.toThrow();
  });

  it("rejects final prompt accessible text that is not the exact derivation", async () => {
    const materialized = await createMaterializedFixture();
    const projection =
      await projectWorksheetV2ForStudentWithCanonicalAnswers(materialized);
    const worksheet = structuredClone(
      await projectStudentWorksheetForWebV2(materialized),
    ) as StudentWebWorksheetV2 & MutableWebWorksheetV2;
    worksheet.items[0]!.prompt.accessibleText += " Appended text.";

    expect(() =>
      assertStudentWebWorksheetV2DoesNotRevealPracticeAnswers(
        worksheet,
        projection.canonicalAnswers,
      ),
    ).toThrow(/exact deterministic derivation/u);
  });
});
