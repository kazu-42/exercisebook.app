import { describe, expect, it } from "vitest";

import type { StudentWebWorksheet } from "@exercisebook/web-renderer";

import {
  DAILY_PLAN_PREVIEW_RESPONSE_V1_SCHEMA,
  validateDailyPlanPreviewResponseV1,
  type DailyPlanPreviewResponseV1,
} from "./daily-plan-preview-contract.js";

function createStudentWorksheet(itemCount = 4): StudentWebWorksheet {
  return {
    schemaVersion: "web-worksheet.v1",
    instanceHash: "a".repeat(64),
    assignmentId: `preview-${"b".repeat(64)}`,
    title: "Add fractions with unlike denominators",
    skillTitle: "Fraction addition",
    studyDate: "2026-07-19",
    locale: "en",
    expectedMinutes: itemCount * 2,
    variant: "student",
    introduction: "Add each pair of fractions. Give every answer in lowest terms.",
    workedExample: {
      left: { numerator: "1", denominator: "2" },
      right: { numerator: "1", denominator: "3" },
      result: { numerator: "5", denominator: "6" },
      steps: ["Rename the fractions with a common denominator, then add."],
    },
    items: Array.from({ length: itemCount }, (_, index) => ({
      id: `practice-${String(index + 1).padStart(2, "0")}`,
      ordinal: index + 1,
      prompt: {
        kind: "fraction-addition" as const,
        left: { numerator: "1", denominator: String(index + 2) },
        right: { numerator: "1", denominator: String(index + 3) },
        accessibleText: `Problem ${index + 1}`,
      },
      responseLabel: `Your answer for problem ${index + 1}`,
      printFallback: "Write one reduced fraction.",
    })),
    attributions: [
      {
        label: "Exercise Book original lesson",
        license: "LicenseRef-ExerciseBook-Draft · draft",
      },
    ],
  };
}

function createResponse(): DailyPlanPreviewResponseV1 {
  const worksheet = createStudentWorksheet();
  return {
    schema: DAILY_PLAN_PREVIEW_RESPONSE_V1_SCHEMA,
    plan: {
      id: worksheet.assignmentId,
      goalId: "math.fractions.add-unlike",
      requestedPracticeMinutes: 8,
      plannedPracticeMinutes: 8,
      itemCount: 4,
      policy: { id: "day-one-fraction-preview", version: 4 },
      skillGraph: { id: "phase-1-math", revision: 1 },
      evidenceKind: "none",
      selectionReasons: ["current-frontier"],
      selectionExplanation:
        "This focused set practices the fraction goal you selected. It is a preview based on your goal and time limit, not a saved or mastery-based plan.",
      saved: false,
    },
    worksheet,
  };
}

describe("DailyPlanPreviewResponseV1", () => {
  it("accepts the strict student-only public contract", () => {
    const response = createResponse();

    expect(validateDailyPlanPreviewResponseV1(response)).toEqual(response);
  });

  it.each([
    ["unknown response key", (value: Record<string, unknown>) => (value.extra = true)],
    [
      "unknown plan key",
      (value: Record<string, unknown>) =>
        ((value.plan as Record<string, unknown>).baseSeed = "c".repeat(64)),
    ],
    [
      "answer-bearing item",
      (value: Record<string, unknown>) =>
        ((
          (
            (value.worksheet as Record<string, unknown>).items as Record<
              string,
              unknown
            >[]
          )[0] as Record<string, unknown>
        ).answer = {
          numerator: "7",
          denominator: "12",
        }),
    ],
    [
      "answer-key variant",
      (value: Record<string, unknown>) =>
        ((value.worksheet as Record<string, unknown>).variant = "answer-key"),
    ],
    [
      "mismatched assignment identity",
      (value: Record<string, unknown>) =>
        ((value.worksheet as Record<string, unknown>).assignmentId = "preview-other"),
    ],
    [
      "mismatched item count",
      (value: Record<string, unknown>) =>
        ((value.plan as Record<string, unknown>).itemCount = 6),
    ],
    [
      "mismatched planned minutes",
      (value: Record<string, unknown>) =>
        ((value.plan as Record<string, unknown>).plannedPracticeMinutes = 12),
    ],
  ])("rejects %s", (_name, mutate) => {
    const value = structuredClone(createResponse()) as unknown as Record<
      string,
      unknown
    >;
    mutate(value);

    expect(() => validateDailyPlanPreviewResponseV1(value)).toThrow();
  });
});
