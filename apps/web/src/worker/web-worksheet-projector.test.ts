import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import {
  validateWorksheetInstanceV1,
  type MaterializedWorksheetInstanceV1,
} from "@exercisebook/schemas";
import { describe, expect, it } from "vitest";

import {
  REVIEWED_WORKED_EXAMPLE,
  assertWorkedExampleDoesNotRevealPracticeAnswers,
  projectAnswerKeyWorksheetForWeb,
  projectStudentWorksheetForWeb,
} from "./web-worksheet-projector.js";

const hash = "0".repeat(64);

async function createMaterializedFixture(
  answer = { numerator: "7", denominator: "12" },
): Promise<MaterializedWorksheetInstanceV1> {
  const instance = validateWorksheetInstanceV1({
    schema: "exercisebook.worksheet-instance/v1",
    assignmentId: "assignment.web-projector",
    title: "Adding fractions with unlike denominators",
    localStudyDate: "2026-07-19",
    timeZone: "Asia/Tokyo",
    locale: "en",
    expectedMinutes: 4,
    plan: { id: "plan.sample", version: 1 },
    policy: { id: "policy.sample", version: 1 },
    skillGraph: { id: "math.fractions", revision: 1 },
    rng: {
      algorithm: "xoshiro128ss-v1",
      baseSeed: "1".repeat(64),
      seedSecretVersion: "public-sample",
    },
    content: [
      {
        id: "fractions.add-unlike",
        revision: 1,
        sourceHash: hash,
        contentHash: "3".repeat(64),
        compilerVersion: "exercisebook-content-compiler/1",
      },
    ],
    slots: [
      {
        id: "practice-01",
        skillIds: ["math.fractions.add"],
        slotSeed: "2".repeat(64),
        selectionReasons: ["current-frontier"],
        expectedMinutes: 4,
        prompt: {
          type: "fraction-addition",
          instruction: "Rename the fractions, then add.",
          left: { numerator: "1", denominator: "4" },
          right: { numerator: "1", denominator: "3" },
          accessibleText: "Add 1 over 4 and 1 over 3. Give the answer in lowest terms.",
        },
        canonicalAnswer: {
          type: "rational",
          value: answer,
        },
        scoringRule: {
          type: "rational-equals",
          accepted: answer,
          requireReduced: true,
        },
        hints: [{ id: "hint-01", text: "Find a multiple of 4 and 3." }],
        solutionTrace: [
          {
            id: "solution-01",
            kind: "common-denominator",
            explanation: "The least common denominator is 12.",
            expression: "lcd(4,3)=12",
            accessibleText: "The least common denominator is twelve.",
          },
          {
            id: "solution-02",
            kind: "add-numerators",
            explanation: "Record the reduced result.",
            expression: `${answer.numerator}/${answer.denominator}`,
            accessibleText: `${answer.numerator} over ${answer.denominator}.`,
            result: answer,
          },
        ],
        misconceptions: [
          {
            id: "add-denominators",
            description: "Adds both denominators.",
            incorrectAnswer: { numerator: "2", denominator: "7" },
          },
        ],
        accessibility: {
          summary: "Fraction addition problem: 1 over 4 plus 1 over 3.",
        },
        printFallback: {
          type: "text",
          text: "Write one reduced fraction.",
        },
        provenance: {
          contentId: "fractions.add-unlike",
          contentRevision: 1,
          sourceHash: hash,
          contentHash: "3".repeat(64),
          compilerVersion: "exercisebook-content-compiler/1",
          generatorId: "fractions.add",
          generatorVersion: "1",
          generationAttempt: 0,
        },
      },
    ],
    attributions: [
      {
        title: "Adding unlike denominators",
        author: "Exercise Book contributors",
        sourceUrl: "https://exercisebook.app/",
        licenseId: "LicenseRef-ExerciseBook-Draft",
        attributionText: "Exercise Book original lesson",
        publicationStatus: "draft",
        modifications: [],
      },
    ],
  });
  const canonicalJson = canonicalizeJson(instance);

  return {
    instance,
    canonicalJson,
    instanceHash: await sha256Hex(canonicalJson),
  };
}

async function createCrossSlotFixture(): Promise<MaterializedWorksheetInstanceV1> {
  const base = await createMaterializedFixture();
  const firstSlot = structuredClone(base.instance.slots[0]!);
  firstSlot.expectedMinutes = 2;
  const secondSlot = structuredClone(firstSlot);
  const secondAnswer = { numerator: "1", denominator: "4" };
  secondSlot.id = "practice-02";
  secondSlot.slotSeed = "4".repeat(64);
  secondSlot.prompt = {
    type: "fraction-addition",
    instruction: "Rename the fractions, then add.",
    left: { numerator: "1", denominator: "6" },
    right: { numerator: "1", denominator: "12" },
    accessibleText: "Add 1 over 6 and 1 over 12. Give the answer in lowest terms.",
  };
  secondSlot.accessibility.summary =
    "Fraction addition problem: 1 over 6 plus 1 over 12.";
  secondSlot.canonicalAnswer.value = secondAnswer;
  secondSlot.scoringRule.accepted = secondAnswer;
  const finalStep = secondSlot.solutionTrace.at(-1)!;
  finalStep.expression = "1/4";
  finalStep.accessibleText = "1 over 4.";
  finalStep.result = secondAnswer;
  const instance = validateWorksheetInstanceV1({
    ...base.instance,
    expectedMinutes: 4,
    slots: [firstSlot, secondSlot],
  });
  const canonicalJson = canonicalizeJson(instance);
  return {
    instance,
    canonicalJson,
    instanceHash: await sha256Hex(canonicalJson),
  };
}

describe("Web worksheet projector", () => {
  it("uses the integrity-checked student delivery and never reintroduces secrets", async () => {
    const materialized = await createMaterializedFixture();
    const worksheet = await projectStudentWorksheetForWeb(materialized);
    const serialized = JSON.stringify(worksheet);

    expect(worksheet.instanceHash).toBe(materialized.instanceHash);
    expect(worksheet.items.map((item) => item.id)).toEqual(["practice-01"]);
    expect(worksheet.items[0]?.prompt.accessibleText).toBe(
      "Add 1 over 4 and 1 over 3. Give the answer in lowest terms.",
    );
    expect(serialized).not.toContain("baseSeed");
    expect(serialized).not.toContain("slotSeed");
    expect(serialized).not.toContain("canonicalAnswer");
    expect(serialized).not.toContain("scoringRule");
    expect(serialized).not.toContain("solutionTrace");
    expect(serialized).not.toContain("misconceptions");
    expect(serialized).not.toContain("7/12");
  });

  it("fails closed when a worked example would reveal a practice answer", async () => {
    const materialized = await createMaterializedFixture({
      numerator: "5",
      denominator: "6",
    });

    await expect(projectStudentWorksheetForWeb(materialized)).rejects.toThrow(
      "worked example",
    );
  });

  it("uses the authorized answer snapshot when the caller mutates during hashing", async () => {
    const materialized = await createMaterializedFixture({
      numerator: "5",
      denominator: "6",
    });

    const pending = projectStudentWorksheetForWeb(materialized);
    materialized.instance.slots[0]!.canonicalAnswer.value = {
      numerator: "7",
      denominator: "12",
    };

    await expect(pending).rejects.toThrow("worked example");
  });

  it("projects an answer key from one detached snapshot", async () => {
    const materialized = await createMaterializedFixture();
    const expectedHash = materialized.instanceHash;
    const expectedTitle = materialized.instance.title;

    const pending = projectAnswerKeyWorksheetForWeb(materialized);
    materialized.instance.title = "Caller-mutated title";
    materialized.instance.slots[0]!.canonicalAnswer.value = {
      numerator: "1",
      denominator: "2",
    };

    const worksheet = await pending;
    expect(worksheet.instanceHash).toBe(expectedHash);
    expect(worksheet.title).toBe(expectedTitle);
    expect(worksheet.items[0]?.answer).toMatchObject({
      numerator: "7",
      denominator: "12",
    });
  });

  it("validates the final answer-key DTO and fails closed on oversized solution prose", async () => {
    const materialized = await createMaterializedFixture();
    const instance = structuredClone(materialized.instance);
    const firstStep = instance.slots[0]?.solutionTrace[0];
    if (firstStep === undefined) {
      throw new Error("Expected a solution step fixture");
    }
    firstStep.explanation = "e".repeat(2_000);
    firstStep.accessibleText = "a".repeat(2_000);
    const canonicalJson = canonicalizeJson(instance);

    await expect(
      projectAnswerKeyWorksheetForWeb({
        instance,
        canonicalJson,
        instanceHash: await sha256Hex(canonicalJson),
      }),
    ).rejects.toThrow();
  });

  it("scans worked-example prose for a practice answer even when its result differs", () => {
    expect(() =>
      assertWorkedExampleDoesNotRevealPracticeAnswers(
        {
          ...REVIEWED_WORKED_EXAMPLE,
          left: { ...REVIEWED_WORKED_EXAMPLE.left },
          right: { ...REVIEWED_WORKED_EXAMPLE.right },
          result: { ...REVIEWED_WORKED_EXAMPLE.result },
          steps: [
            ...REVIEWED_WORKED_EXAMPLE.steps,
            "A different practice answer is 7/12.",
          ],
        },
        [{ numerator: "7", denominator: "12" }],
      ),
    ).toThrow("recognized canonical-answer representation");
  });

  it.each([
    ["left operand", { numerator: "1", denominator: "2" }],
    ["right operand", { numerator: "1", denominator: "3" }],
  ] as const)(
    "structurally rejects a practice answer matching the worked-example %s",
    (_name, canonicalAnswer) => {
      expect(() =>
        assertWorkedExampleDoesNotRevealPracticeAnswers(
          {
            left: { numerator: "1", denominator: "2" },
            right: { numerator: "1", denominator: "3" },
            result: { numerator: "5", denominator: "6" },
            steps: ["Use a common denominator, then add and reduce."],
          },
          [canonicalAnswer],
        ),
      ).toThrow("worked example");
    },
  );

  it("allows a different problem's answer as a legitimate structured operand", async () => {
    const worksheet = await projectStudentWorksheetForWeb(
      await createCrossSlotFixture(),
    );

    expect(worksheet.items).toHaveLength(2);
    expect(worksheet.items[0]?.prompt.left).toEqual({
      numerator: "1",
      denominator: "4",
    });
    expect(worksheet.items[0]?.prompt.accessibleText).toBe(
      "Add 1 over 4 and 1 over 3. Give the answer in lowest terms.",
    );
  });

  it("rejects appended answer prose hidden behind an authorized prompt operand", async () => {
    const base = await createCrossSlotFixture();
    const instance = structuredClone(base.instance);
    instance.slots[0]!.prompt.accessibleText += " The answer is 1/4.";
    const canonicalJson = canonicalizeJson(instance);

    await expect(
      projectStudentWorksheetForWeb({
        instance,
        canonicalJson,
        instanceHash: await sha256Hex(canonicalJson),
      }),
    ).rejects.toThrow("deterministic fraction-addition derivation");
  });

  it("rejects a different problem's answer in a non-prompt item field", async () => {
    const base = await createCrossSlotFixture();
    const instance = structuredClone(base.instance);
    instance.slots[0]!.printFallback.text =
      "A leaked answer from another problem is 1/4.";
    const canonicalJson = canonicalizeJson(instance);

    await expect(
      projectStudentWorksheetForWeb({
        instance,
        canonicalJson,
        instanceHash: await sha256Hex(canonicalJson),
      }),
    ).rejects.toThrow("recognized canonical-answer representation");
  });

  it("projects the explicit answer key from the same materialized instance", async () => {
    const materialized = await createMaterializedFixture();
    const worksheet = await projectAnswerKeyWorksheetForWeb(materialized);

    expect(worksheet.variant).toBe("answer-key");
    expect(worksheet.items[0]?.answer).toEqual({
      numerator: "7",
      denominator: "12",
      accessibleText: "7 over 12.",
    });
    expect(worksheet.attributions).toEqual([
      {
        label: "Exercise Book original lesson",
        license: "LicenseRef-ExerciseBook-Draft · draft",
      },
    ]);
  });
});
