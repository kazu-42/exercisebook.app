import {
  DAILY_PLAN_PREVIEW_RESPONSE_V1_SCHEMA,
  DAILY_PLAN_PREVIEW_SELECTION_EXPLANATION,
  type DailyPlanPreviewResponseV1,
} from "../shared/daily-plan-preview-contract.js";

const BUDGET_MAPPING = {
  8: { itemCount: 4, plannedPracticeMinutes: 8 },
  12: { itemCount: 6, plannedPracticeMinutes: 12 },
  20: { itemCount: 8, plannedPracticeMinutes: 16 },
} as const;

export function createDailyPlanPreviewResponseFixture(
  requestedPracticeMinutes: 8 | 12 | 20 = 8,
): DailyPlanPreviewResponseV1 {
  const mapping = BUDGET_MAPPING[requestedPracticeMinutes];
  const planId = `preview-${"b".repeat(64)}`;

  return {
    schema: DAILY_PLAN_PREVIEW_RESPONSE_V1_SCHEMA,
    plan: {
      id: planId,
      goalId: "math.fractions.add-unlike",
      requestedPracticeMinutes,
      plannedPracticeMinutes: mapping.plannedPracticeMinutes,
      itemCount: mapping.itemCount,
      policy: { id: "day-one-fraction-preview", version: 2 },
      skillGraph: { id: "phase-1-math", revision: 1 },
      evidenceKind: "none",
      selectionReasons: ["current-frontier"],
      selectionExplanation: DAILY_PLAN_PREVIEW_SELECTION_EXPLANATION,
      saved: false,
    },
    worksheet: {
      schemaVersion: "web-worksheet.v1",
      instanceHash: "a".repeat(64),
      assignmentId: planId,
      title: "Add fractions with unlike denominators",
      skillTitle: "Fraction addition",
      studyDate: "2026-07-19",
      locale: "en",
      expectedMinutes: mapping.plannedPracticeMinutes,
      variant: "student",
      introduction: "Add each pair of fractions. Give every answer in lowest terms.",
      workedExample: {
        left: { numerator: "1", denominator: "2" },
        right: { numerator: "1", denominator: "3" },
        result: { numerator: "5", denominator: "6" },
        steps: ["Rename the fractions with a common denominator, then add."],
      },
      items: Array.from({ length: mapping.itemCount }, (_, index) => ({
        id: `practice-${String(index + 1).padStart(2, "0")}`,
        ordinal: index + 1,
        prompt: {
          kind: "fraction-addition" as const,
          left: { numerator: "1", denominator: String(index + 2) },
          right: { numerator: "1", denominator: String(index + 3) },
          accessibleText: `Problem ${String(index + 1)}`,
        },
        responseLabel: `Your answer for problem ${String(index + 1)}`,
        printFallback: "Write one reduced fraction.",
      })),
      attributions: [
        {
          label: "Exercise Book original lesson",
          license: "LicenseRef-ExerciseBook-Draft · draft",
        },
      ],
    },
  };
}
