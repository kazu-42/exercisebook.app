import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  equalRationals,
  greatestCommonDivisor,
  parseRationalJson,
} from "@exercisebook/domain";
import {
  projectWorksheetForStudent,
  validateContentDocumentV1,
  validateWorksheetInstanceV1,
} from "@exercisebook/schemas";

import {
  FRACTION_ADDITION_SAMPLE_INPUT,
  fractionAdditionWorksheetInputFromContent,
  generateFractionAdditionProblem,
  materializeFractionAdditionWorksheet,
  materializeFractionAdditionWorksheetFromContent,
} from "./fraction-addition.js";

import compiledFractionLesson from "../../../content/compiled/math.fractions.add-unlike-denominators.v1.json" with { type: "json" };

const REVIEWED_FRACTION_LESSON = validateContentDocumentV1(compiledFractionLesson);

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

  it("records caller-provided planner provenance instead of inventing it", async () => {
    const materialized = await materializeFractionAdditionWorksheet({
      ...FRACTION_ADDITION_SAMPLE_INPUT,
      assignmentId: "preview-custom-provenance",
      plan: { id: "preview-custom-provenance", version: 7 },
      policy: { id: "day-one-fraction-preview", version: 3 },
      skillGraph: { id: "reviewed-math", revision: 9 },
      selectionReasons: ["prerequisite-repair"],
    });

    expect(materialized.instance.plan).toEqual({
      id: "preview-custom-provenance",
      version: 7,
    });
    expect(materialized.instance.policy).toEqual({
      id: "day-one-fraction-preview",
      version: 3,
    });
    expect(materialized.instance.skillGraph).toEqual({
      id: "reviewed-math",
      revision: 9,
    });
    expect(
      materialized.instance.slots.every(
        (slot) =>
          slot.selectionReasons.length === 1 &&
          slot.selectionReasons[0] === "prerequisite-repair",
      ),
    ).toBe(true);
  });

  it("includes changed policy metadata in the materialized instance hash", async () => {
    const first = await materializeFractionAdditionWorksheet(
      FRACTION_ADDITION_SAMPLE_INPUT,
    );
    const second = await materializeFractionAdditionWorksheet({
      ...FRACTION_ADDITION_SAMPLE_INPUT,
      policy: {
        ...FRACTION_ADDITION_SAMPLE_INPUT.policy,
        version: FRACTION_ADDITION_SAMPLE_INPUT.policy.version + 1,
      },
    });

    expect(first.instance.policy).not.toEqual(second.instance.policy);
    expect(first.instanceHash).not.toBe(second.instanceHash);
  });

  it("requires planner provenance at the direct materializer boundary", async () => {
    const { plan: _plan, ...withoutPlan } = FRACTION_ADDITION_SAMPLE_INPUT;

    await expect(
      materializeFractionAdditionWorksheet(
        withoutPlan as unknown as typeof FRACTION_ADDITION_SAMPLE_INPUT,
      ),
    ).rejects.toThrow();
  });

  it("resolves exactly the requested reviewed prefix and rejects unreviewed padding", async () => {
    const assignment = {
      assignmentId: "preview-reviewed-prefix",
      localStudyDate: "2026-07-19",
      timeZone: "Asia/Tokyo",
      locale: "en",
      seed: "0123456789abcdef".repeat(4),
      seedSecretVersion: "public-preview-v1",
      requestedItemCount: 4,
      plan: { id: "preview-reviewed-prefix", version: 1 },
      policy: { id: "reviewed-prefix-test", version: 1 },
      skillGraph: { id: "phase-1-math", revision: 1 },
      selectionReasons: ["current-frontier"],
    } as const;
    const resolved = await fractionAdditionWorksheetInputFromContent(
      REVIEWED_FRACTION_LESSON,
      assignment,
    );

    expect(resolved.itemCount).toBe(4);
    await expect(
      fractionAdditionWorksheetInputFromContent(REVIEWED_FRACTION_LESSON, {
        ...assignment,
        requestedItemCount: 9,
      }),
    ).rejects.toThrow("reviewed content limit of 8");
  });

  it("keeps shorter materializations as stable prompt prefixes", async () => {
    const instances = await Promise.all(
      [4, 6, 8].map((itemCount) =>
        materializeFractionAdditionWorksheet({
          ...FRACTION_ADDITION_SAMPLE_INPUT,
          itemCount,
        }),
      ),
    );
    const signatures = instances.map((materialized) =>
      materialized.instance.slots.map((slot) => JSON.stringify(slot.prompt)),
    );

    expect(signatures[1]?.slice(0, 4)).toEqual(signatures[0]);
    expect(signatures[2]?.slice(0, 4)).toEqual(signatures[0]);
    expect(signatures[2]?.slice(0, 6)).toEqual(signatures[1]);
  });

  it("deterministically retries answers reserved for reviewed worked examples", async () => {
    const collidingSeed =
      "11cfadc10111057deaafb5f31ff85ecc1a6e19c202a5b04a830f803ba9c5f6bb";
    const withoutReservation = await materializeFractionAdditionWorksheet({
      ...FRACTION_ADDITION_SAMPLE_INPUT,
      seed: collidingSeed,
      itemCount: 4,
    });
    expect(withoutReservation.instance.slots[0]?.canonicalAnswer.value).toEqual({
      numerator: "5",
      denominator: "6",
    });

    const withReservation = await materializeFractionAdditionWorksheet({
      ...FRACTION_ADDITION_SAMPLE_INPUT,
      seed: collidingSeed,
      itemCount: 4,
      policy: { id: "worked-example-safe-materialization", version: 2 },
      excludedCanonicalAnswers: [{ numerator: "5", denominator: "6" }],
    });

    expect(
      withReservation.instance.slots.every(
        (slot) =>
          !equalRationals(slot.canonicalAnswer.value, {
            numerator: "5",
            denominator: "6",
          }),
      ),
    ).toBe(true);
    expect(withReservation.instance.slots[0]?.provenance.generationAttempt).toBe(1);
  });

  it("preserves the Phase 1 content-resolved sample vector", async () => {
    const materialized = await materializeFractionAdditionWorksheetFromContent(
      REVIEWED_FRACTION_LESSON,
      {
        assignmentId: FRACTION_ADDITION_SAMPLE_INPUT.assignmentId,
        localStudyDate: FRACTION_ADDITION_SAMPLE_INPUT.localStudyDate,
        timeZone: FRACTION_ADDITION_SAMPLE_INPUT.timeZone,
        locale: FRACTION_ADDITION_SAMPLE_INPUT.locale,
        seed: FRACTION_ADDITION_SAMPLE_INPUT.seed,
        seedSecretVersion: FRACTION_ADDITION_SAMPLE_INPUT.seedSecretVersion,
        requestedItemCount: FRACTION_ADDITION_SAMPLE_INPUT.itemCount,
        plan: FRACTION_ADDITION_SAMPLE_INPUT.plan,
        policy: FRACTION_ADDITION_SAMPLE_INPUT.policy,
        skillGraph: FRACTION_ADDITION_SAMPLE_INPUT.skillGraph,
        selectionReasons: FRACTION_ADDITION_SAMPLE_INPUT.selectionReasons,
      },
    );

    expect(materialized.instanceHash).toBe(
      "5252ef64b127638b785a94b3a2c7d1859cd7299e7032bed10aa41e07b2c4d12b",
    );
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
  }, 60_000);

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
  }, 30_000);

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
