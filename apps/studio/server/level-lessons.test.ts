import { describe, expect, it } from "vitest";
import {
  compiledLessonSources,
  compiledStandardLessonSources,
} from "./compiled-lessons";
import { levelLessonCatalog } from "./level-lessons";
import { createWorkbook, topics } from "./model";

describe("level-aligned lesson selection", () => {
  it("preserves the original catalog and all fixed fixture identities", () => {
    expect(compiledLessonSources).toHaveLength(3);
    expect(compiledStandardLessonSources).toHaveLength(3);
    expect(levelLessonCatalog(topics, "foundation")).toBe(topics);
    expect(
      createWorkbook({ topicId: "equations", level: "foundation", count: 4 })
        .instanceHash,
    ).toBe("8c2b30e1548924387d799ec143e5095e66aaeda440cdb2d3603d063e1f0fd2c8");
  });

  it("uses multiplication, negative substitution, and a negative coefficient at standard level", () => {
    const selected = levelLessonCatalog(topics, "standard");
    expect(selected.map((topic) => topic.lesson.example)).toEqual([
      "(−7) × (−6)",
      "x = −4 のとき、−3x + 5",
      "−4x + 3 = 23",
    ]);
    expect(compiledStandardLessonSources.map((entry) => entry.exampleModel)).toEqual([
      { kind: "arithmetic", operation: "multiply", left: -7, right: -6 },
      { kind: "expression", coefficient: -3, value: -4, constant: 5 },
      { kind: "equation", coefficient: -4, constant: 3, right: 23 },
    ]);
    expect(selected[0]!.lesson.steps.map((step) => step.math)).toEqual([
      "7 × 6 = 42",
      "(−7) × (−6) = 42",
    ]);
    expect(selected[1]!.lesson.steps.map((step) => step.math)).toEqual([
      "−3x + 5 = (−3) × (−4) + 5",
      "(−3) × (−4) + 5 = 12 + 5",
      "12 + 5 = 17",
    ]);
    expect(selected[1]!.lesson.steps[0]!.relation).toBe("substitution");
    expect(selected[1]!.lesson.steps[0]!.reason).toContain("x = −4 のとき");
    expect(selected[2]!.lesson.steps.map((step) => step.math)).toEqual([
      "−4x = 20",
      "x = −5",
      "(−4) × (−5) + 3 = 23",
    ]);
    expect(selected[2]!.lesson.steps.map((step) => step.relation)).toEqual([
      "equivalent-equation",
      "equivalent-equation",
      "verification",
    ]);
    expect(selected[2]!.lesson.steps[1]!.reason).toContain("(−4) は 0 でなく");
    expect(selected[2]!.lesson.rule).toContain("実数");
    expect(selected[2]!.lesson.rule).toContain("解の集合");
    expect(JSON.stringify(selected.map((topic) => topic.lesson))).not.toMatch(/[→⇒⇔]/);
  });

  it("only replaces lessons and does not mutate an existing catalog", () => {
    const before = JSON.stringify(topics);
    const selected = levelLessonCatalog(topics, "standard");
    expect(JSON.stringify(topics)).toBe(before);
    selected.forEach((topic, index) => {
      const { lesson: _lesson, ...metadata } = topic;
      const { lesson: _oldLesson, ...oldMetadata } = topics[index]!;
      expect(metadata).toEqual(oldMetadata);
      expect(topic.lesson).not.toEqual(topics[index]!.lesson);
    });
    expect(
      levelLessonCatalog([...topics].reverse(), "standard").map((topic) => topic.id),
    ).toEqual(["equations", "expressions", "signed-numbers"]);
  });
});
