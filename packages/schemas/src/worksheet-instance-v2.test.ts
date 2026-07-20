import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  WORKSHEET_INSTANCE_V2_RUNTIME_INVARIANTS,
  WorksheetInstanceV2Schema,
  validateWorksheetInstanceV2,
  validateWorksheetPresentationV1,
} from "./index.js";

const SOURCE_HASH = "456c8908debd52c7fcc5eba6e2e9a38434b5fcd8343e7a14a427faae34502523";
const CONTENT_HASH = "944225a2dda87ae6ee61e53f21a929301f5264793d665ea2200b65fb0f5a71dd";
const INSTRUCTION = "Add each pair of fractions. Give every answer in lowest terms.";

describe("WorksheetInstanceV2 contract", () => {
  it("accepts one internally consistent instance-bound presentation", () => {
    expect(validateWorksheetInstanceV2(worksheetInstanceV2Fixture())).toMatchObject({
      schema: "exercisebook.worksheet-instance/v2",
      presentation: {
        schema: "exercisebook.worksheet-presentation/v1",
        lesson: { nodeId: "lesson-explanation-01" },
        workedExample: { nodeId: "worked-example-01" },
        exercise: { nodeId: "practice-01" },
      },
    });
  });

  it("validates the presentation as its own strict safe-data boundary", () => {
    expect(validateWorksheetPresentationV1(worksheetPresentationV1Fixture())).toEqual(
      worksheetPresentationV1Fixture(),
    );
  });

  it("leaves exact release-hash authorization to the resolver", () => {
    const presentation = worksheetPresentationV1Fixture();
    presentation.content.sourceHash = "e".repeat(64);
    presentation.content.contentHash = "f".repeat(64);

    expect(validateWorksheetPresentationV1(presentation)).toMatchObject({
      content: {
        sourceHash: "e".repeat(64),
        contentHash: "f".repeat(64),
      },
    });
  });

  it("keeps the checked-in JSON Schema equal to the Zod structural projection", async () => {
    const committed = JSON.parse(
      await readFile(
        new URL("../json-schema/worksheet-instance-v2.schema.json", import.meta.url),
        "utf8",
      ),
    ) as unknown;
    const generated = {
      ...z.toJSONSchema(WorksheetInstanceV2Schema, {
        io: "output",
        reused: "ref",
        target: "draft-2020-12",
        unrepresentable: "throw",
      }),
      $id: "https://exercisebook.app/schemas/worksheet-instance-v2.schema.json",
      "x-exercisebook-runtime-invariants": WORKSHEET_INSTANCE_V2_RUNTIME_INVARIANTS,
    };

    expect(committed).toEqual(generated);
  });

  it.each([
    [
      "instance discriminator",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.schema = "exercisebook.worksheet-instance/v1";
      },
    ],
    [
      "top-level compiler",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.content[0]!.compilerVersion = "exercisebook-content-compiler/1";
      },
    ],
    [
      "slot compiler",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.slots[0]!.provenance.compilerVersion = "exercisebook-content-compiler/1";
      },
    ],
  ])("rejects a V1/V2 mix in the %s", (_scenario, mutate) => {
    const value = worksheetInstanceV2Fixture();
    mutate(value);
    expect(WorksheetInstanceV2Schema.safeParse(value).success).toBe(false);
  });

  it.each([
    [
      "content ID",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.presentation.content.id = "math.fractions.add-unlike-denominators-v2";
      },
    ],
    [
      "content revision",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.presentation.content.revision = 3;
      },
    ],
    [
      "lesson",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.presentation.lesson.nodeId = "lesson-explanation-02";
      },
    ],
    [
      "worked example",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.presentation.workedExample.nodeId = "worked-example-02";
      },
    ],
    [
      "exercise",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.presentation.exercise.nodeId = "practice-02";
      },
    ],
    [
      "compiler",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.presentation.content.compilerVersion = "exercisebook-content-compiler/1";
      },
    ],
  ])("rejects a changed fixed presentation %s", (_scenario, mutate) => {
    const value = worksheetInstanceV2Fixture();
    mutate(value);
    expect(WorksheetInstanceV2Schema.safeParse(value).success).toBe(false);
  });

  it.each([
    [
      "presentation content",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.presentation.content.sourceHash = "f".repeat(64);
      },
    ],
    [
      "top-level content",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.content[0]!.contentHash = "f".repeat(64);
      },
    ],
    [
      "slot provenance",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.slots[0]!.provenance.sourceHash = "f".repeat(64);
      },
    ],
    [
      "prompt instruction",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.slots[0]!.prompt.instruction = "Use another instruction.";
      },
    ],
    [
      "generator ID",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.slots[0]!.provenance.generatorId = "fractions.subtract";
      },
    ],
    [
      "generator version",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.slots[0]!.provenance.generatorVersion = "2";
      },
    ],
  ])("rejects %s disagreement", (_scenario, mutate) => {
    const value = worksheetInstanceV2Fixture();
    mutate(value);
    expect(WorksheetInstanceV2Schema.safeParse(value).success).toBe(false);
  });

  it.each([
    [
      "worked-example result",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.presentation.workedExample.model.result = {
          numerator: "1",
          denominator: "1",
        };
      },
    ],
    [
      "common denominator",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.presentation.workedExample.model.commonDenominator = "12";
      },
    ],
    [
      "left scaled numerator",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.presentation.workedExample.model.leftScaledNumerator = "6";
      },
    ],
    [
      "right scaled numerator",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.presentation.workedExample.model.rightScaledNumerator = "4";
      },
    ],
    [
      "unreduced sum",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.presentation.workedExample.model.unreducedSumNumerator = "10";
      },
    ],
  ])("rejects incorrect presentation arithmetic in the %s", (_scenario, mutate) => {
    const value = worksheetInstanceV2Fixture();
    mutate(value);
    expect(WorksheetInstanceV2Schema.safeParse(value).success).toBe(false);
  });

  it("rejects a canonical answer that does not equal the prompt sum", () => {
    const value = worksheetInstanceV2Fixture();
    const incorrectAnswer = { numerator: "7", denominator: "8" };
    value.slots[0]!.canonicalAnswer.value = incorrectAnswer;
    value.slots[0]!.scoringRule.accepted = incorrectAnswer;
    value.slots[0]!.solutionTrace.at(-1)!.result = incorrectAnswer;

    expect(WorksheetInstanceV2Schema.safeParse(value).success).toBe(false);
  });

  it("rejects changed prompt operands with a stale canonical answer", () => {
    const value = worksheetInstanceV2Fixture();
    value.slots[0]!.prompt.left = { numerator: "1", denominator: "4" };
    value.slots[0]!.prompt.right = { numerator: "1", denominator: "5" };
    value.slots[0]!.prompt.accessibleText =
      "Add 1 over 4 and 1 over 5. Give the answer in lowest terms.";
    value.slots[0]!.accessibility.summary =
      "Fraction addition problem: 1 over 4 plus 1 over 5.";

    expect(WorksheetInstanceV2Schema.safeParse(value).success).toBe(false);
  });

  it.each([
    ["left operand", { numerator: "1", denominator: "2" }],
    ["right operand", { numerator: "1", denominator: "3" }],
    ["result", { numerator: "5", denominator: "6" }],
  ])("rejects a practice answer equal to the example %s", (_scenario, answer) => {
    const value = worksheetInstanceV2Fixture();
    value.slots[0]!.canonicalAnswer.value = answer;
    value.slots[0]!.scoringRule.accepted = answer;
    value.slots[0]!.solutionTrace[0]!.result = answer;

    expect(WorksheetInstanceV2Schema.safeParse(value).success).toBe(false);
  });

  it.each([
    [
      "duplicate content identity",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.content.push({ ...value.content[0]!, contentHash: "f".repeat(64) });
      },
    ],
    [
      "duplicate slot ID",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.slots.push(structuredClone(value.slots[0]!));
        value.expectedMinutes = 4;
      },
    ],
    [
      "duplicate skill ID",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.slots[0]!.skillIds.push(value.slots[0]!.skillIds[0]!);
      },
    ],
    [
      "duplicate reason",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.slots[0]!.selectionReasons.push(value.slots[0]!.selectionReasons[0]!);
      },
    ],
    [
      "duplicate hint ID",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.slots[0]!.hints.push(structuredClone(value.slots[0]!.hints[0]!));
      },
    ],
    [
      "duplicate solution ID",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.slots[0]!.solutionTrace.push(
          structuredClone(value.slots[0]!.solutionTrace[0]!),
        );
      },
    ],
    [
      "duplicate misconception ID",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.slots[0]!.misconceptions.push(
          structuredClone(value.slots[0]!.misconceptions[0]!),
        );
      },
    ],
  ])("rejects %s", (_scenario, mutate) => {
    const value = worksheetInstanceV2Fixture();
    mutate(value);
    expect(WorksheetInstanceV2Schema.safeParse(value).success).toBe(false);
  });

  it.each([
    [
      "duration",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.expectedMinutes = 3;
      },
    ],
    [
      "scoring",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.slots[0]!.scoringRule.accepted = {
          numerator: "1",
          denominator: "1",
        };
      },
    ],
    [
      "final solution",
      (value: ReturnType<typeof worksheetInstanceV2Fixture>) => {
        value.slots[0]!.solutionTrace[0]!.result = {
          numerator: "1",
          denominator: "1",
        };
      },
    ],
  ])("rejects %s parity failure", (_scenario, mutate) => {
    const value = worksheetInstanceV2Fixture();
    mutate(value);
    expect(WorksheetInstanceV2Schema.safeParse(value).success).toBe(false);
  });

  it.each([
    ["numerator", "not-an-integer"],
    ["denominator", "not-an-integer"],
  ] as const)(
    "rejects a hostile rational %s without leaking a BigInt exception",
    (field, hostileValue) => {
      const value = worksheetInstanceV2Fixture();
      value.slots[0]!.canonicalAnswer.value[field] = hostileValue;

      expect(() => WorksheetInstanceV2Schema.safeParse(value)).not.toThrow();
      expect(WorksheetInstanceV2Schema.safeParse(value).success).toBe(false);
    },
  );

  it("rejects an unsafe accessor graph before invoking the getter", () => {
    const value = worksheetInstanceV2Fixture();
    let getterRan = false;
    Object.defineProperty(value, "presentation", {
      enumerable: true,
      get() {
        getterRan = true;
        return worksheetPresentationV1Fixture();
      },
    });

    expect(() => validateWorksheetInstanceV2(value)).toThrow("Accessor");
    expect(getterRan).toBe(false);
  });

  it("rejects a cyclic object graph", () => {
    const value = worksheetInstanceV2Fixture();
    const cyclic = value as typeof value & { self?: unknown };
    cyclic.self = cyclic;

    expect(() => validateWorksheetInstanceV2(cyclic)).toThrow("Cyclic");
  });
});

function worksheetPresentationV1Fixture() {
  return {
    schema: "exercisebook.worksheet-presentation/v1",
    content: {
      id: "math.fractions.add-unlike-denominators",
      revision: 2,
      sourceHash: SOURCE_HASH,
      contentHash: CONTENT_HASH,
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
      instruction: INSTRUCTION,
    },
  };
}

function worksheetInstanceV2Fixture() {
  return {
    schema: "exercisebook.worksheet-instance/v2",
    assignmentId: "assignment-v2",
    title: "Adding fractions with unlike denominators",
    localStudyDate: "2026-07-19",
    timeZone: "Asia/Tokyo",
    locale: "en",
    expectedMinutes: 2,
    plan: { id: "phase-1-preview", version: 2 },
    policy: { id: "day-one-fraction-preview", version: 3 },
    skillGraph: { id: "phase-1-math", revision: 1 },
    rng: {
      algorithm: "xoshiro128ss-v1",
      baseSeed: "1".repeat(64),
      seedSecretVersion: "public-preview-v2",
    },
    content: [
      {
        id: "math.fractions.add-unlike-denominators",
        revision: 2,
        sourceHash: SOURCE_HASH,
        contentHash: CONTENT_HASH,
        compilerVersion: "exercisebook-content-compiler/2",
      },
    ],
    presentation: worksheetPresentationV1Fixture(),
    slots: [
      {
        id: "practice-01",
        skillIds: ["math.fractions.add-unlike"],
        slotSeed: "2".repeat(64),
        selectionReasons: ["current-frontier"],
        expectedMinutes: 2,
        prompt: {
          type: "fraction-addition",
          instruction: INSTRUCTION,
          left: { numerator: "2", denominator: "5" },
          right: { numerator: "5", denominator: "7" },
          accessibleText: "Add 2 over 5 and 5 over 7. Give the answer in lowest terms.",
        },
        canonicalAnswer: {
          type: "rational",
          value: { numerator: "39", denominator: "35" },
        },
        scoringRule: {
          type: "rational-equals",
          accepted: { numerator: "39", denominator: "35" },
          requireReduced: true,
        },
        hints: [
          {
            id: "hint-common-denominator",
            text: "Find a common denominator before adding the numerators.",
          },
        ],
        solutionTrace: [
          {
            id: "step-reduce",
            kind: "reduce",
            explanation: "The result is already in lowest terms.",
            expression: "39/35",
            accessibleText: "Thirty-nine thirty-fifths.",
            result: { numerator: "39", denominator: "35" },
          },
        ],
        misconceptions: [
          {
            id: "add-denominators",
            description: "Adding denominators changes the size of the parts.",
            incorrectAnswer: { numerator: "7", denominator: "12" },
          },
        ],
        accessibility: {
          summary: "Fraction addition problem: 2 over 5 plus 5 over 7.",
        },
        printFallback: {
          type: "text",
          text: "Draw fraction bars and combine equal-sized parts.",
        },
        provenance: {
          contentId: "math.fractions.add-unlike-denominators",
          contentRevision: 2,
          sourceHash: SOURCE_HASH,
          contentHash: CONTENT_HASH,
          compilerVersion: "exercisebook-content-compiler/2",
          generatorId: "fractions.add",
          generatorVersion: "1",
          generationAttempt: 0,
        },
      },
    ],
    attributions: [
      {
        title: "Adding fractions with unlike denominators",
        author: "Exercise Book contributors",
        sourceUrl:
          "https://exercisebook.app/content/math.fractions.add-unlike-denominators/2",
        licenseId: "LicenseRef-Project-Decision-Pending",
        attributionText: "Draft authored for Exercise Book.",
        publicationStatus: "draft",
        modifications: [],
      },
    ],
  };
}
