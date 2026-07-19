import { describe, expect, it } from "vitest";

import { FRACTION_ADDITION_SAMPLE_INPUT } from "@exercisebook/generators";

import { generatorSampleService } from "./generator-sample-service.js";

describe("generator-backed sample service", () => {
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
