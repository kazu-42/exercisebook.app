import { describe, expect, it } from "vitest";

import { FRACTION_ADDITION_SAMPLE_INPUT } from "@exercisebook/generators";
import { addRationals, equalRationals } from "@exercisebook/domain";
import { DAY_ONE_PREVIEW_RESERVED_CANONICAL_ANSWERS } from "@exercisebook/planner";

import { MAX_SAMPLE_WORKSHEET_RESPONSE_BYTES } from "../shared/public-api-response-limits.js";
import { parseStrictJson } from "../shared/strict-json.js";
import { generatorSampleService } from "./generator-sample-service.js";

describe("generator-backed sample service", () => {
  it.each([
    ["student", 4_238],
    ["answer-key", 8_562],
  ] as const)(
    "keeps the current %s producer payload below its browser cap with 2x headroom",
    async (variant, expectedResponseBytes) => {
      const worksheet = await generatorSampleService.getSample({
        seed: FRACTION_ADDITION_SAMPLE_INPUT.seed,
        variant,
      });
      const serialized = JSON.stringify(worksheet);
      const responseBytes = new TextEncoder().encode(serialized).byteLength;

      expect(responseBytes).toBeLessThanOrEqual(MAX_SAMPLE_WORKSHEET_RESPONSE_BYTES);
      expect(responseBytes * 2).toBeLessThanOrEqual(
        MAX_SAMPLE_WORKSHEET_RESPONSE_BYTES,
      );
      expect(responseBytes).toBe(expectedResponseBytes);
      expect(parseStrictJson(serialized)).toEqual(worksheet);
    },
  );

  it("returns the canonical eight-item student sample without answer data", async () => {
    const worksheet = await generatorSampleService.getSample({
      seed: FRACTION_ADDITION_SAMPLE_INPUT.seed,
      variant: "student",
    });
    const serialized = JSON.stringify(worksheet);

    expect(worksheet.variant).toBe("student");
    expect(worksheet.items).toHaveLength(8);
    expect(worksheet.expectedMinutes).toBe(16);
    expect(serialized).not.toContain("canonicalAnswer");
    expect(serialized).not.toContain("scoringRule");
    expect(serialized).not.toContain("solutionTrace");
    expect(serialized).not.toContain("slotSeed");
  });

  it("uses a different deterministic instance for a different seed", async () => {
    const requestedSeed = "a".repeat(64);
    const first = await generatorSampleService.getSample({
      seed: requestedSeed,
      variant: "student",
    });
    const repeated = await generatorSampleService.getSample({
      seed: requestedSeed,
      variant: "student",
    });
    const other = await generatorSampleService.getSample({
      seed: "b".repeat(64),
      variant: "student",
    });

    expect(repeated).toEqual(first);
    expect(other.instanceHash).not.toBe(first.instanceHash);
    expect(other.assignmentId).not.toBe(first.assignmentId);
    expect(JSON.stringify(first)).not.toContain(requestedSeed);
  });

  it("reserves every worked-example value across caller-selected seeds", async () => {
    const seed = "11cfadc10111057deaafb5f31ff85ecc1a6e19c202a5b04a830f803ba9c5f6bb";
    const worksheet = await generatorSampleService.getSample({
      seed,
      variant: "student",
    });
    const answerKey = await generatorSampleService.getSample({
      seed,
      variant: "answer-key",
    });

    expect(
      worksheet.items.every(
        (item) =>
          !DAY_ONE_PREVIEW_RESERVED_CANONICAL_ANSWERS.some((reserved) =>
            equalRationals(addRationals(item.prompt.left, item.prompt.right), reserved),
          ),
      ),
    ).toBe(true);
    expect(worksheet.assignmentId).toBe(
      "sample-0d2e4f18c887611e9b4e6739ef1cb3697df8f2ef1bc2b2cbceb6c5f8773470ef",
    );
    expect(worksheet.instanceHash).toBe(
      "69d9c7ebe12ab40093f3d084015b02a0f658f57566176793501a6fd208a65888",
    );
    expect(answerKey.instanceHash).toBe(worksheet.instanceHash);
    expect(answerKey.assignmentId).toBe(worksheet.assignmentId);
  });

  it("projects an explicit answer key from the same instance hash", async () => {
    const student = await generatorSampleService.getSample({
      seed: FRACTION_ADDITION_SAMPLE_INPUT.seed,
      variant: "student",
    });
    const answerKey = await generatorSampleService.getSample({
      seed: FRACTION_ADDITION_SAMPLE_INPUT.seed,
      variant: "answer-key",
    });

    expect(answerKey.variant).toBe("answer-key");
    expect(answerKey.instanceHash).toBe(student.instanceHash);
    expect(answerKey.items.map((item) => item.id)).toEqual(
      student.items.map((item) => item.id),
    );
    expect(answerKey.items.every((item) => item.answer !== undefined)).toBe(true);
    expect(JSON.stringify(answerKey)).not.toContain("\\frac");
    expect(JSON.stringify(answerKey)).not.toContain("\\operatorname");
  });
});
