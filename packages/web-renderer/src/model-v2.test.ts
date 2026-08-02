import { describe, expect, it } from "vitest";

import { studentWorksheetFixture } from "./fixtures.js";
import {
  validateStudentWebWorksheet,
  validateStudentWebWorksheetV2,
  validateWebWorksheet,
} from "./model.js";

function createStudentWebWorksheetV2Fixture() {
  return {
    schemaVersion: "web-worksheet.v2",
    instanceHash: "934bd3949b6284bbb4061a29b3075560f9389b096ec4f913ad56788e06ac0d02",
    assignmentId:
      "preview-934bd3949b6284bbb4061a29b3075560f9389b096ec4f913ad56788e06ac0d02",
    title: "Add fractions with unlike denominators",
    studyDate: "2026-07-21",
    locale: "en",
    expectedMinutes: 4,
    variant: "student",
    presentation: {
      schema: "exercisebook.worksheet-presentation/v1",
      content: {
        id: "math.fractions.add-unlike-denominators",
        revision: 2,
        sourceHash: "456c8908debd52c7fcc5eba6e2e9a38434b5fcd8343e7a14a427faae34502523",
        contentHash: "944225a2dda87ae6ee61e53f21a929301f5264793d665ea2200b65fb0f5a71dd",
        compilerVersion: "exercisebook-content-compiler/2",
      },
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
    items: [
      {
        id: "practice-01",
        ordinal: 1,
        prompt: {
          kind: "fraction-addition",
          left: { numerator: "1", denominator: "4" },
          right: { numerator: "1", denominator: "3" },
          accessibleText: "Add 1 over 4 and 1 over 3. Give the answer in lowest terms.",
        },
        responseLabel: "Your answer for problem 1",
        printFallback: "Write one reduced fraction.",
      },
      {
        id: "practice-02",
        ordinal: 2,
        prompt: {
          kind: "fraction-addition",
          left: { numerator: "1", denominator: "6" },
          right: { numerator: "1", denominator: "12" },
          accessibleText:
            "Add 1 over 6 and 1 over 12. Give the answer in lowest terms.",
        },
        responseLabel: "Your answer for problem 2",
        printFallback: "Write one reduced fraction.",
      },
    ],
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

describe("StudentWebWorksheetV2 runtime contract", () => {
  it("accepts one strict renderer-neutral student fixture", () => {
    const fixture = createStudentWebWorksheetV2Fixture();

    expect(validateStudentWebWorksheetV2(fixture)).toEqual(fixture);
  });

  it("keeps the V1 and V2 validators explicitly separated", () => {
    const fixture = createStudentWebWorksheetV2Fixture();

    expect(() => validateStudentWebWorksheetV2(studentWorksheetFixture)).toThrow();
    expect(() => validateStudentWebWorksheet(fixture)).toThrow();
    expect(() => validateWebWorksheet(fixture, "student")).toThrow();
  });

  it.each([
    [
      "top-level seed",
      (fixture: ReturnType<typeof createStudentWebWorksheetV2Fixture>) => {
        return { ...fixture, baseSeed: "a".repeat(64) };
      },
    ],
    [
      "legacy introduction",
      (fixture: ReturnType<typeof createStudentWebWorksheetV2Fixture>) => {
        return { ...fixture, introduction: "Application-owned copy" };
      },
    ],
    [
      "legacy worked example",
      (fixture: ReturnType<typeof createStudentWebWorksheetV2Fixture>) => {
        return { ...fixture, workedExample: fixture.presentation.workedExample };
      },
    ],
    [
      "time zone",
      (fixture: ReturnType<typeof createStudentWebWorksheetV2Fixture>) => {
        return { ...fixture, timeZone: "Asia/Tokyo" };
      },
    ],
    [
      "presentation extension",
      (fixture: ReturnType<typeof createStudentWebWorksheetV2Fixture>) => {
        return {
          ...fixture,
          presentation: { ...fixture.presentation, selectedBy: "ambient-policy" },
        };
      },
    ],
    [
      "item answer",
      (fixture: ReturnType<typeof createStudentWebWorksheetV2Fixture>) => {
        return {
          ...fixture,
          items: [
            {
              ...fixture.items[0],
              answer: { numerator: "7", denominator: "12" },
            },
            fixture.items[1],
          ],
        };
      },
    ],
    [
      "item solution trace",
      (fixture: ReturnType<typeof createStudentWebWorksheetV2Fixture>) => {
        return {
          ...fixture,
          items: [
            { ...fixture.items[0], solutionTrace: ["The answer is 7/12."] },
            fixture.items[1],
          ],
        };
      },
    ],
    [
      "item seed",
      (fixture: ReturnType<typeof createStudentWebWorksheetV2Fixture>) => {
        return {
          ...fixture,
          items: [{ ...fixture.items[0], slotSeed: "b".repeat(64) }, fixture.items[1]],
        };
      },
    ],
    [
      "item hints",
      (fixture: ReturnType<typeof createStudentWebWorksheetV2Fixture>) => {
        return {
          ...fixture,
          items: [
            { ...fixture.items[0], hints: [{ id: "hint-01", text: "A hint" }] },
            fixture.items[1],
          ],
        };
      },
    ],
    [
      "item provenance",
      (fixture: ReturnType<typeof createStudentWebWorksheetV2Fixture>) => {
        return {
          ...fixture,
          items: [
            { ...fixture.items[0], provenance: { generatorId: "fractions.add" } },
            fixture.items[1],
          ],
        };
      },
    ],
    [
      "reduced attribution",
      (fixture: ReturnType<typeof createStudentWebWorksheetV2Fixture>) => {
        return {
          ...fixture,
          attributions: [
            {
              label: fixture.attributions[0]!.attributionText,
              license: fixture.attributions[0]!.licenseId,
            },
          ],
        };
      },
    ],
  ])("rejects protected, legacy, or extra data at %s", (_label, mutate) => {
    expect(() =>
      validateStudentWebWorksheetV2(mutate(createStudentWebWorksheetV2Fixture())),
    ).toThrow();
  });

  it("requires unique item IDs and contiguous ordinals", () => {
    const duplicate = createStudentWebWorksheetV2Fixture();
    duplicate.items[1]!.id = duplicate.items[0]!.id;
    expect(() => validateStudentWebWorksheetV2(duplicate)).toThrow(/unique/u);

    const outOfOrder = createStudentWebWorksheetV2Fixture();
    outOfOrder.items[1]!.ordinal = 3;
    expect(() => validateStudentWebWorksheetV2(outOfOrder)).toThrow(/contiguous/u);
  });

  it("rejects prompt accessible text that is not the exact operand derivation", () => {
    const arbitraryAccessibleText = createStudentWebWorksheetV2Fixture();
    arbitraryAccessibleText.items[0]!.prompt.accessibleText =
      "Add the two displayed fractions.";

    expect(() => validateStudentWebWorksheetV2(arbitraryAccessibleText)).toThrow(
      /accessibleText.*deterministic fraction-addition derivation/u,
    );
  });

  it.each([
    ["unreduced positive rational", { numerator: "2", denominator: "4" }],
    ["unreduced negative rational", { numerator: "-2", denominator: "4" }],
    ["noncanonical zero rational", { numerator: "0", denominator: "2" }],
    ["leading-zero numerator", { numerator: "01", denominator: "2" }],
    ["negative-zero numerator", { numerator: "-0", denominator: "1" }],
    ["leading-zero denominator", { numerator: "1", denominator: "02" }],
    ["negative denominator", { numerator: "1", denominator: "-2" }],
  ])("rejects a %s in either prompt operand", (_label, rational) => {
    for (const operand of ["left", "right"] as const) {
      const fixture = createStudentWebWorksheetV2Fixture();
      const prompt = fixture.items[0]!.prompt;
      prompt[operand] = { ...rational };
      prompt.accessibleText =
        `Add ${prompt.left.numerator} over ${prompt.left.denominator} and ` +
        `${prompt.right.numerator} over ${prompt.right.denominator}. ` +
        "Give the answer in lowest terms.";

      expect(() => validateStudentWebWorksheetV2(fixture)).toThrow();
    }
  });

  it("inherits exact worked-example arithmetic validation from the canonical schema", () => {
    const wrongResult = createStudentWebWorksheetV2Fixture();
    wrongResult.presentation.workedExample.model.result = {
      numerator: "1",
      denominator: "1",
    };
    expect(() => validateStudentWebWorksheetV2(wrongResult)).toThrow(/exact sum/u);

    const wrongIntermediate = createStudentWebWorksheetV2Fixture();
    wrongIntermediate.presentation.workedExample.model.leftScaledNumerator = "4";
    expect(() => validateStudentWebWorksheetV2(wrongIntermediate)).toThrow(
      /left scaled numerator/u,
    );
  });

  it("rejects cyclic and accessor inputs before schema parsing", () => {
    const cyclic: Record<string, unknown> = createStudentWebWorksheetV2Fixture();
    cyclic.self = cyclic;
    expect(() => validateStudentWebWorksheetV2(cyclic)).toThrow(/Cyclic/u);

    let getterInvoked = false;
    const accessor = createStudentWebWorksheetV2Fixture();
    Object.defineProperty(accessor, "title", {
      enumerable: true,
      get() {
        getterInvoked = true;
        return "unsafe";
      },
    });
    expect(() => validateStudentWebWorksheetV2(accessor)).toThrow(/Accessor/u);
    expect(getterInvoked).toBe(false);
  });

  it("returns a detached presentation, item graph, and attribution graph", () => {
    const callerOwned = createStudentWebWorksheetV2Fixture();
    const validated = validateStudentWebWorksheetV2(callerOwned);

    callerOwned.presentation.lesson.title = "Caller-mutated lesson";
    callerOwned.items[0]!.prompt.left.numerator = "99";
    callerOwned.attributions[0]!.title = "Caller-mutated attribution";

    expect(validated.presentation.lesson.title).toBe("The three moves");
    expect(validated.items[0]!.prompt.left.numerator).toBe("1");
    expect(validated.attributions[0]!.title).toBe(
      "Add fractions with unlike denominators",
    );
  });
});
