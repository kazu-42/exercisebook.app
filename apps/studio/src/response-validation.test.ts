import { describe, expect, it } from "vitest";
import { createWorkbook, gradeWorkbook, topics } from "../server/model";
import {
  parseCatalog,
  parseGradeResult,
  parseWorkbook,
  readResponseJson,
} from "./response-validation";

const workbook = () =>
  createWorkbook({ topicId: "equations", level: "foundation", count: 4 });

describe("studio response validation", () => {
  it("accepts every actual fixture, catalog and grade trace", () => {
    expect(parseCatalog({ topics })).toEqual({ topics });
    for (const topic of topics) {
      for (const level of ["foundation", "standard"] as const) {
        for (const count of [4, 6, 8] as const) {
          const instance = createWorkbook({ topicId: topic.id, level, count });
          expect(parseWorkbook(instance)).toEqual(instance);
          const grade = gradeWorkbook(instance, {
            answers: { "q-1": "4", "q-2": "nonsense", "q-3": "　 " },
          });
          expect(parseGradeResult(grade, instance)).toEqual(grade);
        }
      }
    }
  });

  it("accepts the content-addressed release ID only when its hash agrees", () => {
    const instance = workbook();
    expect(
      parseWorkbook({ ...instance, id: `studio-${instance.instanceHash}` }).id,
    ).toBe(`studio-${instance.instanceHash}`);
    expect(() =>
      parseWorkbook({ ...instance, id: `studio-${"f".repeat(64)}` }),
    ).toThrow();
  });

  it("rejects unknown and duplicate catalog topics and unbounded content", () => {
    expect(() => parseCatalog({ topics: [] })).toThrow();
    expect(() => parseCatalog({ topics: [topics[0], topics[0]] })).toThrow();
    expect(() =>
      parseCatalog({ topics: [{ ...topics[0], id: "calculus" }] }),
    ).toThrow();
    expect(() =>
      parseCatalog({ topics: [{ ...topics[0], title: "x".repeat(513) }] }),
    ).toThrow();
    expect(() => parseCatalog({ topics, hiddenAnswers: [] })).toThrow();
  });

  it("rejects answer-bearing and unexpected fields at every student level", () => {
    const instance = workbook();
    const mutations = [
      { ...instance, answers: ["4"] },
      { ...instance, lesson: { ...instance.lesson, answer: "4" } },
      {
        ...instance,
        items: instance.items.map((item) => ({ ...item, answer: "4" })),
      },
      {
        ...instance,
        lesson: {
          ...instance.lesson,
          steps: instance.lesson.steps.map((step) => ({ ...step, hidden: "4" })),
        },
      },
    ];
    for (const mutation of mutations) expect(() => parseWorkbook(mutation)).toThrow();
  });

  it("rejects truncated, unsupported and incoherent workbook shapes", () => {
    const instance = workbook();
    const { lesson: _lesson, ...truncated } = instance;
    for (const malformed of [
      null,
      [],
      truncated,
      { ...instance, schemaVersion: "studio-workbook-v2" },
      { ...instance, saved: true },
      { ...instance, count: 5 },
      { ...instance, minutes: Infinity },
      { ...instance, items: instance.items.slice(1) },
      { ...instance, items: [...instance.items].reverse() },
      { ...instance, lesson: { ...instance.lesson, steps: [] } },
    ])
      expect(() => parseWorkbook(malformed)).toThrow();
  });

  it("preserves explicit equation relations and rejects ambiguous or mismatched ones", () => {
    const instance = workbook();
    const relation = instance.lesson.steps[0]?.relation;
    expect(relation).toBe("equivalent-equation");
    for (const relation of ["implication", "→", "expression-equality"]) {
      expect(() =>
        parseWorkbook({
          ...instance,
          lesson: {
            ...instance.lesson,
            steps: instance.lesson.steps.map((step) => ({ ...step, relation })),
          },
        }),
      ).toThrow();
    }
  });

  it("rejects stale, reordered, truncated and inconsistent grade results", () => {
    const instance = workbook();
    const grade = gradeWorkbook(instance, { answers: { "q-1": "4" } });
    for (const malformed of [
      { ...grade, workbookId: `draft-${"f".repeat(64)}` },
      { ...grade, total: 8 },
      { ...grade, correctCount: grade.correctCount + 1 },
      { ...grade, items: [...grade.items].reverse() },
      { ...grade, items: grade.items.slice(1) },
      { ...grade, items: grade.items.map((item) => ({ ...item, answer: "NaN" })) },
      {
        ...grade,
        items: grade.items.map((item) => ({ ...item, submitted: "x".repeat(65) })),
      },
      { ...grade, items: grade.items.map((item) => ({ ...item, status: "mastered" })) },
      {
        ...grade,
        items: grade.items.map((item) => ({ ...item, explanation: "extra" })),
      },
    ])
      expect(() => parseGradeResult(malformed, instance)).toThrow();
  });

  it("preserves bounded invalid learner input without accepting incoherent status", () => {
    const instance = workbook();
    const grade = gradeWorkbook(instance, { answers: { "q-1": "\u0000" } });
    expect(parseGradeResult(grade, instance)).toEqual(grade);
    expect(() =>
      parseGradeResult(
        {
          ...grade,
          items: grade.items.map((item) => ({ ...item, status: "unanswered" })),
        },
        instance,
      ),
    ).toThrow();
  });
});

describe("studio bounded response reader", () => {
  const response = (body: string) =>
    new Response(body, {
      headers: { "Content-Type": "application/json" },
    });

  it("reads actual DTOs with duplicate-key protection", async () => {
    expect(await readResponseJson(response(JSON.stringify(workbook())))).toEqual(
      workbook(),
    );
    await expect(
      readResponseJson(response('{"topics":[],"topics":[]}')),
    ).rejects.toThrow();
  });

  it("rejects truncated JSON, HTML, unsuccessful responses and oversized bodies", async () => {
    await expect(readResponseJson(response('{"items":['))).rejects.toThrow();
    await expect(
      readResponseJson(new Response("<html>failed</html>")),
    ).rejects.toThrow();
    await expect(
      readResponseJson(Response.json({}, { status: 503 })),
    ).rejects.toThrow();
    await expect(
      readResponseJson(response(JSON.stringify("x".repeat(65_536)))),
    ).rejects.toThrow();
  });

  it("honors the request abort signal during response handling", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(readResponseJson(response("{}"), controller.signal)).rejects.toThrow(
      "cancelled",
    );
  });
});
