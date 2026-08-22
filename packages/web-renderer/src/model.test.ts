import { describe, expect, it } from "vitest";

import { answerKeyWorksheetFixture, studentWorksheetFixture } from "./fixtures.js";
import {
  validateAnswerKeyWebWorksheet,
  validateStudentWebWorksheet,
  validateWebWorksheet,
} from "./model.js";

describe("WebWorksheet runtime contract", () => {
  it("accepts strict student and answer-key fixtures", () => {
    expect(validateStudentWebWorksheet(studentWorksheetFixture)).toEqual(
      studentWorksheetFixture,
    );
    expect(validateAnswerKeyWebWorksheet(answerKeyWorksheetFixture)).toEqual(
      answerKeyWorksheetFixture,
    );
    expect(validateWebWorksheet(studentWorksheetFixture, "student").variant).toBe(
      "student",
    );
    expect(validateWebWorksheet(answerKeyWorksheetFixture, "answer-key").variant).toBe(
      "answer-key",
    );
  });

  it.each([
    ["top-level", { ...studentWorksheetFixture, unexpected: "field" }],
    [
      "nested prompt",
      {
        ...studentWorksheetFixture,
        items: [
          {
            ...studentWorksheetFixture.items[0],
            prompt: {
              ...studentWorksheetFixture.items[0]!.prompt,
              canonicalAnswer: { numerator: "7", denominator: "12" },
            },
          },
        ],
      },
    ],
    [
      "nested item seed",
      {
        ...studentWorksheetFixture,
        items: [
          {
            ...studentWorksheetFixture.items[0],
            baseSeed: "a".repeat(64),
          },
        ],
      },
    ],
    [
      "student answer",
      {
        ...studentWorksheetFixture,
        items: [
          {
            ...studentWorksheetFixture.items[0],
            answer: { numerator: "7", denominator: "12", accessibleText: "seven" },
          },
        ],
      },
    ],
  ])("rejects unknown or protected data at %s", (_label, value) => {
    expect(() => validateStudentWebWorksheet(value)).toThrow();
  });

  it("rejects missing, wrong-variant, and oversized values", () => {
    const { title: _title, ...missingTitle } = studentWorksheetFixture;
    expect(() => validateStudentWebWorksheet(missingTitle)).toThrow();
    expect(() => validateStudentWebWorksheet(answerKeyWorksheetFixture)).toThrow();
    expect(() =>
      validateStudentWebWorksheet({
        ...studentWorksheetFixture,
        title: "x".repeat(241),
      }),
    ).toThrow();
    expect(() =>
      validateStudentWebWorksheet({
        ...studentWorksheetFixture,
        items: Array.from({ length: 97 }, (_, index) => ({
          ...studentWorksheetFixture.items[0],
          id: `problem-${String(index)}`,
          ordinal: index + 1,
        })),
      }),
    ).toThrow();
  });

  it("rejects cyclic, accessor, sparse-array, and non-plain inputs before Zod", () => {
    const cyclic: Record<string, unknown> = { ...studentWorksheetFixture };
    cyclic.self = cyclic;
    expect(() => validateStudentWebWorksheet(cyclic)).toThrow(/Cyclic/u);

    let getterInvoked = false;
    const accessor = { ...studentWorksheetFixture };
    Object.defineProperty(accessor, "title", {
      enumerable: true,
      get() {
        getterInvoked = true;
        return "unsafe";
      },
    });
    expect(() => validateStudentWebWorksheet(accessor)).toThrow(/Accessor/u);
    expect(getterInvoked).toBe(false);

    const sparseItems = [...studentWorksheetFixture.items];
    sparseItems.length = 3;
    expect(() =>
      validateStudentWebWorksheet({ ...studentWorksheetFixture, items: sparseItems }),
    ).toThrow(/Sparse/u);

    expect(() =>
      validateStudentWebWorksheet(
        Object.assign(Object.create({ inherited: true }) as object, {
          ...studentWorksheetFixture,
        }),
      ),
    ).toThrow(/Non-plain/u);
  });

  it("rejects prototype-sensitive and symbol-keyed original inputs", () => {
    const dangerous = structuredClone(studentWorksheetFixture) as Record<
      string,
      unknown
    >;
    Object.defineProperty(dangerous, "constructor", {
      enumerable: true,
      value: "smuggled",
    });
    expect(() => validateStudentWebWorksheet(dangerous)).toThrow(/Forbidden/u);

    const symbolKeyed = structuredClone(studentWorksheetFixture) as Record<
      PropertyKey,
      unknown
    >;
    symbolKeyed[Symbol("hidden")] = "value";
    expect(() => validateStudentWebWorksheet(symbolKeyed)).toThrow(/Symbol-keyed/u);
  });

  it("rejects invalid Unicode", () => {
    expect(() =>
      validateStudentWebWorksheet({ ...studentWorksheetFixture, title: "\ud800" }),
    ).toThrow(/surrogate/u);
  });

  it("rejects schema-valid fields whose aggregate text exceeds the delivery budget", () => {
    expect(() =>
      validateStudentWebWorksheet({
        ...studentWorksheetFixture,
        introduction: "i".repeat(2_000),
        workedExample: {
          ...studentWorksheetFixture.workedExample,
          steps: Array.from({ length: 20 }, () => "w".repeat(2_000)),
        },
        items: Array.from({ length: 96 }, (_, index) => ({
          ...studentWorksheetFixture.items[0],
          id: `problem-${String(index)}`,
          ordinal: index + 1,
          prompt: {
            ...studentWorksheetFixture.items[0]!.prompt,
            accessibleText: "a".repeat(2_000),
          },
          responseLabel: "r".repeat(500),
          printFallback: "p".repeat(2_000),
        })),
        attributions: Array.from({ length: 20 }, () => ({
          label: "l".repeat(5_000),
          license: "c".repeat(500),
        })),
      }),
    ).toThrow(/string code units/u);
  });

  it("requires answer-key-only answer and solution fields", () => {
    expect(() =>
      validateAnswerKeyWebWorksheet({
        ...answerKeyWorksheetFixture,
        items: answerKeyWorksheetFixture.items.map(
          ({ answer: _answer, ...item }) => item,
        ),
      }),
    ).toThrow();

    expect(() =>
      validateAnswerKeyWebWorksheet({
        ...answerKeyWorksheetFixture,
        items: answerKeyWorksheetFixture.items.map((item) => ({
          ...item,
          solution: [],
        })),
      }),
    ).toThrow();
  });
});
