import { describe, expect, it } from "vitest";

import {
  DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2,
  DAY_ONE_PREVIEW_SELECTION_EXPLANATION_V2,
} from "@exercisebook/planner";
import type { StudentWebWorksheetV2 } from "@exercisebook/web-renderer";

import {
  DAILY_PLAN_PREVIEW_RESPONSE_V2_SCHEMA,
  validateDailyPlanPreviewResponseV2,
  type DailyPlanPreviewResponseV2,
} from "./daily-plan-preview-contract-v2.js";

const budgetMapping = {
  8: { itemCount: 4, plannedPracticeMinutes: 8 },
  12: { itemCount: 6, plannedPracticeMinutes: 12 },
  20: { itemCount: 8, plannedPracticeMinutes: 16 },
} as const;

type PracticeMinutes = keyof typeof budgetMapping;

function createStudentWorksheet(
  itemCount: 4 | 6 | 8 = 4,
  expectedMinutes: 8 | 12 | 16 = 8,
): StudentWebWorksheetV2 {
  return {
    schemaVersion: "web-worksheet.v2",
    instanceHash: "a".repeat(64),
    assignmentId: `preview-${"b".repeat(64)}`,
    title: "Add fractions with unlike denominators",
    studyDate: "2026-07-21",
    locale: "en",
    expectedMinutes,
    variant: "student",
    presentation: {
      schema: "exercisebook.worksheet-presentation/v1",
      content: { ...DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2 },
      lesson: {
        nodeId: "lesson-explanation-01",
        title: "The three moves",
        paragraphs: [
          "Find a denominator both fractions can use.",
          "Rename each fraction without changing its value.",
          "Add the numerators and keep the shared denominator.",
        ],
      },
      workedExample: {
        nodeId: "worked-example-01",
        title: "One half plus one third",
        model: {
          type: "fraction-addition",
          left: { numerator: "1", denominator: "2" },
          right: { numerator: "1", denominator: "3" },
          result: { numerator: "5", denominator: "6" },
          commonDenominator: "6",
          leftScaledNumerator: "3",
          rightScaledNumerator: "2",
          unreducedSumNumerator: "5",
        },
        steps: [
          "Find the least common denominator.",
          "Rewrite both addends as equivalent fractions.",
          "Add the numerators and reduce if needed.",
        ],
      },
      exercise: {
        nodeId: "practice-01",
        instruction: "Add each pair of fractions. Give every answer in lowest terms.",
      },
    },
    items: Array.from({ length: itemCount }, (_, index) => {
      const leftDenominator = String(index + 2);
      const rightDenominator = String(index + 3);
      return {
        id: `practice-${String(index + 1).padStart(2, "0")}`,
        ordinal: index + 1,
        prompt: {
          kind: "fraction-addition" as const,
          left: { numerator: "1", denominator: leftDenominator },
          right: { numerator: "1", denominator: rightDenominator },
          accessibleText:
            `Add 1 over ${leftDenominator} and 1 over ${rightDenominator}. ` +
            "Give the answer in lowest terms.",
        },
        responseLabel: `Your answer for problem ${index + 1}`,
        printFallback: "Write one reduced fraction.",
      };
    }),
    attributions: [
      {
        title: "Add fractions with unlike denominators",
        author: "Exercise Book contributors, Exercise Book curriculum review",
        sourceUrl:
          "https://exercisebook.app/content/math/fractions/add-unlike-denominators",
        licenseId: "LicenseRef-ExerciseBook-Draft",
        attributionText:
          "Draft original lesson by Exercise Book contributors. Not yet licensed for publication.",
        publicationStatus: "draft",
        modifications: [],
      },
    ],
  };
}

function createResponse(
  requestedPracticeMinutes: PracticeMinutes = 8,
): DailyPlanPreviewResponseV2 {
  const expected = budgetMapping[requestedPracticeMinutes];
  const worksheet = createStudentWorksheet(
    expected.itemCount,
    expected.plannedPracticeMinutes,
  );

  return {
    schema: DAILY_PLAN_PREVIEW_RESPONSE_V2_SCHEMA,
    plan: {
      id: worksheet.assignmentId,
      goalId: "math.fractions.add-unlike",
      requestedPracticeMinutes,
      plannedPracticeMinutes: expected.plannedPracticeMinutes,
      itemCount: expected.itemCount,
      policy: { id: "day-one-fraction-preview", version: 3 },
      skillGraph: { id: "phase-1-math", revision: 1 },
      evidenceKind: "none",
      selectionReasons: ["current-frontier"],
      selectionExplanation: DAY_ONE_PREVIEW_SELECTION_EXPLANATION_V2,
      saved: false,
    },
    worksheet,
  };
}

describe("DailyPlanPreviewResponseV2", () => {
  it.each([8, 12, 20] as const)(
    "accepts the strict student-only %i-minute public contract",
    (practiceMinutes) => {
      const response = createResponse(practiceMinutes);

      expect(validateDailyPlanPreviewResponseV2(response)).toEqual(response);
    },
  );

  it.each([
    [
      "response generation",
      (value: Record<string, unknown>) => (value.generation = {}),
    ],
    [
      "plan base seed",
      (value: Record<string, unknown>) =>
        ((value.plan as Record<string, unknown>).baseSeed = "c".repeat(64)),
    ],
    [
      "plan activities",
      (value: Record<string, unknown>) =>
        ((value.plan as Record<string, unknown>).activities = []),
    ],
    [
      "plan presentation selection",
      (value: Record<string, unknown>) =>
        ((value.plan as Record<string, unknown>).presentationSelection = {}),
    ],
    [
      "plan answer exclusions",
      (value: Record<string, unknown>) =>
        ((value.plan as Record<string, unknown>).excludedCanonicalAnswers = []),
    ],
    [
      "plan content claim",
      (value: Record<string, unknown>) =>
        ((value.plan as Record<string, unknown>).content = {
          contentHash: DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2.contentHash,
        }),
    ],
    [
      "worksheet answer",
      (value: Record<string, unknown>) =>
        ((
          (
            (value.worksheet as Record<string, unknown>).items as Record<
              string,
              unknown
            >[]
          )[0] as Record<string, unknown>
        ).answer = {
          numerator: "1",
          denominator: "2",
        }),
    ],
  ])("rejects the protected extra field %s", (_name, mutate) => {
    const value = structuredClone(createResponse()) as unknown as Record<
      string,
      unknown
    >;
    mutate(value);

    expect(() => validateDailyPlanPreviewResponseV2(value)).toThrow();
  });

  it.each([
    [
      "V1 response discriminator",
      (value: Record<string, unknown>) =>
        (value.schema = "exercisebook.daily-plan-preview-response/v1"),
    ],
    [
      "V1 worksheet discriminator",
      (value: Record<string, unknown>) =>
        ((value.worksheet as Record<string, unknown>).schemaVersion =
          "web-worksheet.v1"),
    ],
    [
      "answer-key worksheet variant",
      (value: Record<string, unknown>) =>
        ((value.worksheet as Record<string, unknown>).variant = "answer-key"),
    ],
    [
      "policy v2",
      (value: Record<string, unknown>) =>
        ((
          (value.plan as Record<string, unknown>).policy as Record<string, unknown>
        ).version = 2),
    ],
  ])("rejects the wrong V1/V2 lane for %s", (_name, mutate) => {
    const value = structuredClone(createResponse()) as unknown as Record<
      string,
      unknown
    >;
    mutate(value);

    expect(() => validateDailyPlanPreviewResponseV2(value)).toThrow();
  });

  it.each([
    [
      "assignment identity",
      (value: Record<string, unknown>) =>
        ((value.worksheet as Record<string, unknown>).assignmentId =
          `preview-${"c".repeat(64)}`),
    ],
    [
      "item count",
      (value: Record<string, unknown>) =>
        ((value.plan as Record<string, unknown>).itemCount = 6),
    ],
    [
      "planned minutes",
      (value: Record<string, unknown>) =>
        ((value.worksheet as Record<string, unknown>).expectedMinutes = 12),
    ],
    [
      "content ID",
      (value: Record<string, unknown>) =>
        ((
          (
            (value.worksheet as Record<string, unknown>).presentation as Record<
              string,
              unknown
            >
          ).content as Record<string, unknown>
        ).id = "wrong.content"),
    ],
    [
      "content revision",
      (value: Record<string, unknown>) =>
        ((
          (
            (value.worksheet as Record<string, unknown>).presentation as Record<
              string,
              unknown
            >
          ).content as Record<string, unknown>
        ).revision = 3),
    ],
    [
      "source hash",
      (value: Record<string, unknown>) =>
        ((
          (
            (value.worksheet as Record<string, unknown>).presentation as Record<
              string,
              unknown
            >
          ).content as Record<string, unknown>
        ).sourceHash = "d".repeat(64)),
    ],
    [
      "content hash",
      (value: Record<string, unknown>) =>
        ((
          (
            (value.worksheet as Record<string, unknown>).presentation as Record<
              string,
              unknown
            >
          ).content as Record<string, unknown>
        ).contentHash = "e".repeat(64)),
    ],
    [
      "compiler version",
      (value: Record<string, unknown>) =>
        ((
          (
            (value.worksheet as Record<string, unknown>).presentation as Record<
              string,
              unknown
            >
          ).content as Record<string, unknown>
        ).compilerVersion = "exercisebook-content-compiler/3"),
    ],
  ])("rejects a cross-field mismatch in %s", (_name, mutate) => {
    const value = structuredClone(createResponse()) as unknown as Record<
      string,
      unknown
    >;
    mutate(value);

    expect(() => validateDailyPlanPreviewResponseV2(value)).toThrow();
  });

  it("rejects an unsafe graph before invoking an accessor", () => {
    const value = createResponse() as unknown as Record<string, unknown>;
    let getterRan = false;
    Object.defineProperty(value, "hidden", {
      enumerable: true,
      get() {
        getterRan = true;
        return "secret";
      },
    });

    expect(() => validateDailyPlanPreviewResponseV2(value)).toThrow("Accessor");
    expect(getterRan).toBe(false);
  });

  it("rejects a cyclic graph before public response parsing", () => {
    const value = createResponse() as unknown as Record<string, unknown>;
    value.cycle = value;

    expect(() => validateDailyPlanPreviewResponseV2(value)).toThrow("Cyclic");
  });

  it("returns a detached public response", () => {
    const input = createResponse();
    const validated = validateDailyPlanPreviewResponseV2(input);
    const mutableInput = input as unknown as {
      plan: { selectionExplanation: string };
      worksheet: {
        presentation: { lesson: { paragraphs: string[] } };
        items: Array<{ responseLabel: string }>;
      };
    };

    mutableInput.plan.selectionExplanation = "mutated";
    mutableInput.worksheet.presentation.lesson.paragraphs[0] = "mutated";
    mutableInput.worksheet.items[0]!.responseLabel = "mutated";

    expect(validated.plan.selectionExplanation).toBe(
      DAY_ONE_PREVIEW_SELECTION_EXPLANATION_V2,
    );
    expect(validated.worksheet.presentation.lesson.paragraphs[0]).toBe(
      "Find a denominator both fractions can use.",
    );
    expect(validated.worksheet.items[0]?.responseLabel).toBe(
      "Your answer for problem 1",
    );
    expect(validated).not.toBe(input);
    expect(validated.plan).not.toBe(input.plan);
    expect(validated.worksheet).not.toBe(input.worksheet);
  });
});
