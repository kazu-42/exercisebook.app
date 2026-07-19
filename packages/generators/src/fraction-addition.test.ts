import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  equalRationals,
  greatestCommonDivisor,
  parseRationalJson,
} from "@exercisebook/domain";
import {
  projectWorksheetForStudent,
  validateWorksheetInstanceV1,
} from "@exercisebook/schemas";

import {
  FRACTION_ADDITION_SAMPLE_INPUT,
  generateFractionAdditionProblem,
  materializeFractionAdditionWorksheet,
} from "./fraction-addition.js";

const ZERO_SEED = "0".repeat(64);
const FF_SEED = "f".repeat(64);

describe("fractions.add@1", () => {
  it.each([
    [
      ZERO_SEED,
      {
        left: { numerator: "1", denominator: "9" },
        right: { numerator: "7", denominator: "8" },
        answer: { numerator: "71", denominator: "72" },
      },
    ],
    [
      FF_SEED,
      {
        left: { numerator: "1", denominator: "3" },
        right: { numerator: "1", denominator: "7" },
        answer: { numerator: "10", denominator: "21" },
      },
    ],
  ])("freezes the boundary vector %s", (slotSeed, expected) => {
    const generated = generateFractionAdditionProblem({ slotSeed, difficulty: 2 });
    expect({
      left: generated.model.left,
      right: generated.model.right,
      answer: generated.canonicalAnswer.value,
    }).toEqual(expected);
  });

  it("materializes byte-identical validated instances for identical inputs", async () => {
    const first = await materializeFractionAdditionWorksheet(
      FRACTION_ADDITION_SAMPLE_INPUT,
    );
    const second = await materializeFractionAdditionWorksheet(
      FRACTION_ADDITION_SAMPLE_INPUT,
    );

    expect(validateWorksheetInstanceV1(first.instance)).toEqual(first.instance);
    expect(first.canonicalJson).toBe(second.canonicalJson);
    expect(first.instanceHash).toBe(second.instanceHash);
    expect(first.instanceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.instanceHash).toBe(
      "f48f009e5bf2050742e54a7a8f7800d2e10a71abaf5b1a8a8ac89bbea9fc7ee8",
    );
    expect(first.instance.slots.map((slot) => slot.prompt.instruction)).toEqual(
      Array.from(
        { length: FRACTION_ADDITION_SAMPLE_INPUT.itemCount },
        () => FRACTION_ADDITION_SAMPLE_INPUT.content.instruction,
      ),
    );
  });

  it("records the caller-provided seed secret version instead of an ambient default", async () => {
    const materialized = await materializeFractionAdditionWorksheet({
      ...FRACTION_ADDITION_SAMPLE_INPUT,
      seedSecretVersion: "fixture-secret-v2",
    });

    expect(materialized.instance.rng.seedSecretVersion).toBe("fixture-secret-v2");
  });

  it("rejects self-asserted publication through the direct materializer entrypoint", async () => {
    await expect(
      materializeFractionAdditionWorksheet({
        ...FRACTION_ADDITION_SAMPLE_INPUT,
        content: {
          ...FRACTION_ADDITION_SAMPLE_INPUT.content,
          attribution: {
            ...FRACTION_ADDITION_SAMPLE_INPUT.content.attribution,
            licenseId: "CC-BY-4.0",
            publicationStatus: "published",
          },
        },
      }),
    ).rejects.toThrow("trusted release approval");
  });

  it("rejects an impossible request above the smallest difficulty capacity", async () => {
    await expect(
      materializeFractionAdditionWorksheet({
        ...FRACTION_ADDITION_SAMPLE_INPUT,
        itemCount: 97,
        difficulty: 1,
      }),
    ).rejects.toThrow("1 to 96");
  });

  it("materializes the operational maximum across independent deterministic seeds", async () => {
    for (let seedIndex = 0; seedIndex < 32; seedIndex += 1) {
      const materialized = await materializeFractionAdditionWorksheet({
        ...FRACTION_ADDITION_SAMPLE_INPUT,
        seed: seedIndex.toString(16).padStart(64, "0"),
        itemCount: 96,
        difficulty: 1,
      });
      expect(materialized.instance.slots).toHaveLength(96);
      expect(
        new Set(
          materialized.instance.slots.map((slot) =>
            [slot.prompt.left, slot.prompt.right]
              .map((value) => `${value.numerator}/${value.denominator}`)
              .sort()
              .join("+"),
          ),
        ).size,
      ).toBe(96);
    }
  });

  it("rejects hostile runtime shapes instead of coercing typed input", async () => {
    await expect(
      materializeFractionAdditionWorksheet({
        ...FRACTION_ADDITION_SAMPLE_INPUT,
        seed: new String(FRACTION_ADDITION_SAMPLE_INPUT.seed) as unknown as string,
      }),
    ).rejects.toThrow();

    await expect(
      materializeFractionAdditionWorksheet({
        ...FRACTION_ADDITION_SAMPLE_INPUT,
        content: {
          ...FRACTION_ADDITION_SAMPLE_INPUT.content,
          skillIds: "abc" as unknown as readonly string[],
        },
      }),
    ).rejects.toThrow();

    await expect(
      materializeFractionAdditionWorksheet({
        ...FRACTION_ADDITION_SAMPLE_INPUT,
        assignmentId: ["sample-fractions"] as unknown as string,
      }),
    ).rejects.toThrow();
  });

  it("uses deterministic bounded retries to avoid commutative prompt duplicates", async () => {
    const materialized = await materializeFractionAdditionWorksheet({
      ...FRACTION_ADDITION_SAMPLE_INPUT,
      seed: "0".repeat(63) + "2",
      difficulty: 1,
    });
    const signatures = materialized.instance.slots.map((slot) =>
      [slot.prompt.left, slot.prompt.right]
        .map((value) => `${value.numerator}/${value.denominator}`)
        .sort()
        .join("+"),
    );

    expect(new Set(signatures).size).toBe(signatures.length);
    expect(
      materialized.instance.slots.every(
        (slot) =>
          slot.provenance.generationAttempt >= 0 &&
          slot.provenance.generationAttempt <= 127,
      ),
    ).toBe(true);
    expect(
      materialized.instance.slots.some((slot) => slot.provenance.generationAttempt > 0),
    ).toBe(true);
  });

  it("satisfies exact arithmetic invariants across at least 10,000 generated cases", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        fc.integer({ min: 1, max: 5 }),
        (seedBytes, difficulty) => {
          const slotSeed = Array.from(seedBytes, (value) =>
            value.toString(16).padStart(2, "0"),
          ).join("");
          const generated = generateFractionAdditionProblem({ slotSeed, difficulty });
          const { left, right, commonDenominator } = generated.model;
          const answer = generated.canonicalAnswer.value;

          parseRationalJson(left);
          parseRationalJson(right);
          parseRationalJson(answer);
          expect(left.denominator).not.toBe(right.denominator);
          expect(BigInt(commonDenominator) % BigInt(left.denominator)).toBe(0n);
          expect(BigInt(commonDenominator) % BigInt(right.denominator)).toBe(0n);
          expect(
            greatestCommonDivisor(BigInt(answer.numerator), BigInt(answer.denominator)),
          ).toBe(1n);
          expect(
            equalRationals(
              generated.solutionTrace.at(-1)?.result ?? {
                numerator: "0",
                denominator: "1",
              },
              answer,
            ),
          ).toBe(true);
          const reduceStep = generated.solutionTrace.at(-1);
          const requiredReduction =
            generated.model.unreducedSumNumerator !== answer.numerator ||
            generated.model.commonDenominator !== answer.denominator;
          expect(reduceStep?.explanation).toBe(
            requiredReduction
              ? "Reduce the fraction to lowest terms."
              : "Check the fraction. It is already in lowest terms.",
          );
          for (const misconception of generated.misconceptions) {
            expect(equalRationals(misconception.incorrectAnswer, answer)).toBe(false);
          }
        },
      ),
      { numRuns: 10_000, seed: 2_026_071_9 },
    );
  });

  it("projects a hash-verified student document without answer or solution fields", async () => {
    const materialized = await materializeFractionAdditionWorksheet({
      ...FRACTION_ADDITION_SAMPLE_INPUT,
      itemCount: 1,
    });
    const student = await projectWorksheetForStudent(materialized);
    const serialized = JSON.stringify(student);

    expect(serialized).not.toContain("canonicalAnswer");
    expect(serialized).not.toContain("scoringRule");
    expect(serialized).not.toContain("solutionTrace");
    expect(serialized).not.toContain("misconceptions");
    expect(serialized).not.toContain("slotSeed");
    expect(serialized).not.toContain("baseSeed");
    expect(student.instanceHash).toBe(materialized.instanceHash);
  });

  it("refuses to project a mismatched instance hash", async () => {
    const materialized = await materializeFractionAdditionWorksheet(
      FRACTION_ADDITION_SAMPLE_INPUT,
    );
    await expect(
      projectWorksheetForStudent({
        ...materialized,
        instanceHash: "0".repeat(64),
      }),
    ).rejects.toThrow("hash");
  });
});
