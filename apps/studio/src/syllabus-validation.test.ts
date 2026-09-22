import { describe, expect, it } from "vitest";
import { planSyllabus } from "../domain/syllabus";
import { readResponseJson } from "./response-validation";
import type { SyllabusPlan, SyllabusRequest } from "./syllabus-contracts";
import { parseSyllabus, readSyllabusResponse } from "./syllabus-validation";

const conditions: SyllabusRequest = {
  goalId: "linear-equations",
  startingPoint: "from-basics",
  weeks: 6,
  dailyMinutes: 20,
};
const jsonResponse = (source: string) =>
  new Response(source, { headers: { "Content-Type": "application/json" } });
const plan = () => planSyllabus(conditions);
const changeSession = (
  source: SyllabusPlan,
  index: number,
  changes: Record<string, unknown>,
) => ({
  ...source,
  sessions: source.sessions.map((session, i) =>
    i === index ? { ...session, ...changes } : session,
  ),
});

describe("syllabus response validation", () => {
  it("accepts all 81 bounded real plans through the strict response reader", async () => {
    let maximumBytes = 0;
    let maximumSessions = 0;
    for (const goalId of [
      "signed-number-confidence",
      "expression-values",
      "linear-equations",
    ] as const) {
      for (const startingPoint of [
        "from-basics",
        "some-familiarity",
        "review",
      ] as const) {
        for (const weeks of [2, 4, 6] as const) {
          for (const dailyMinutes of [10, 15, 20] as const) {
            const request = { goalId, startingPoint, weeks, dailyMinutes };
            const expected = await planSyllabus(request);
            const source = JSON.stringify(expected);
            maximumBytes = Math.max(
              maximumBytes,
              new TextEncoder().encode(source).byteLength,
            );
            maximumSessions = Math.max(maximumSessions, expected.sessions.length);
            const received = await readSyllabusResponse(
              jsonResponse(source),
              new AbortController().signal,
            );
            expect(parseSyllabus(received, request)).toEqual(expected);
          }
        }
      }
    }
    expect(maximumBytes).toBeLessThanOrEqual(65_536);
    expect(maximumSessions).toBeLessThanOrEqual(30);
  });

  it("rejects unrelated requests, altered identities and invented learner evidence", async () => {
    const source = await plan();
    for (const value of [
      { ...source, schemaVersion: "studio-syllabus-v2" },
      { ...source, policyVersion: "algebra-foundation-plan@2" },
      { ...source, id: `syllabus-${"f".repeat(64)}` },
      { ...source, request: { ...conditions, weeks: 2 } },
      { ...source, request: { ...conditions, learnerId: "private" } },
      { ...source, saved: true },
      { ...source, mastered: true },
      { ...source, startingPoint: { ...source.startingPoint, evidence: "assessed" } },
      { ...source, startingPoint: { ...source.startingPoint, mastery: 1 } },
      { ...source, goal: { ...source.goal, id: "expression-values" } },
      { ...source, title: "x".repeat(257) },
    ])
      expect(() => parseSyllabus(value, conditions)).toThrow();
  });

  it("rejects incorrect skill mappings and prerequisite claims", async () => {
    const source = await plan();
    for (const value of [
      { ...source, skills: [...source.skills].reverse() },
      { ...source, skills: source.skills.slice(1) },
      {
        ...source,
        skills: source.skills.map((skill) => ({ ...skill, prerequisites: [] })),
      },
      {
        ...source,
        skills: source.skills.map((skill) => ({ ...skill, prerequisites: [skill.id] })),
      },
      {
        ...source,
        skills: source.skills.map((skill) => ({
          ...skill,
          relation: "recommended_before",
        })),
      },
      changeSession(source, 0, {
        skillId: "equation-signed",
        topicId: "equations",
        level: "standard",
      }),
      changeSession(source, 0, { topicId: "equations" }),
    ])
      expect(() => parseSyllabus(value, conditions)).toThrow();
  });

  it("rejects malformed session order, phases, limits and budgets", async () => {
    const source = await plan();
    const first = source.sessions[0]!;
    for (const value of [
      { ...source, sessions: [] },
      { ...source, sessions: [...source.sessions, ...source.sessions] },
      { ...source, sessions: [...source.sessions].reverse() },
      changeSession(source, 0, { index: 31 }),
      changeSession(source, 0, { id: "session-99" }),
      changeSession(source, 0, { day: 0 }),
      changeSession(source, 0, { week: 2 }),
      changeSession(source, 0, { phase: "mastery-probe" }),
      changeSession(source, 0, { reasonCode: "mastered-prerequisite" }),
      changeSession(source, 0, { reasonCode: "independent-check" }),
      changeSession(source, 0, { count: 12 }),
      changeSession(source, 0, { answer: "hidden" }),
      changeSession(source, 0, { instructions: Array(9).fill("extra") }),
      changeSession(source, 0, { budget: { ...first.budget, totalMinutes: 21 } }),
      changeSession(source, 0, {
        budget: { ...first.budget, totalMinutes: first.budget.totalMinutes - 1 },
      }),
      changeSession(source, 0, { budget: { ...first.budget, practiceMinutes: 1 } }),
    ])
      expect(() => parseSyllabus(value, conditions)).toThrow();
  });

  it("requires backward same-skill review references and full coverage evidence", async () => {
    const source = await plan();
    const reviewIndex = source.sessions.findIndex(
      (session) => session.phase === "review",
    );
    expect(reviewIndex).toBeGreaterThan(0);
    const review = source.sessions[reviewIndex]!;
    for (const value of [
      changeSession(source, reviewIndex, { reviewOfSessionId: review.id }),
      changeSession(source, reviewIndex, { reviewOfSessionId: null }),
      changeSession(source, 0, { reviewOfSessionId: review.id }),
      { ...source, coverage: { ...source.coverage, plannedSkillIds: [] } },
      { ...source, coverage: { ...source.coverage, status: "mastered" } },
      {
        ...source,
        coverage: { ...source.coverage, remainingSkillIds: ["equation-signed"] },
      },
    ])
      expect(() => parseSyllabus(value, conditions)).toThrow();
    const shortConditions = { ...conditions, weeks: 2 } as const;
    const short = await planSyllabus(shortConditions);
    expect(short.coverage.status).toBe("partial");
    expect(() =>
      parseSyllabus(
        {
          ...short,
          coverage: { ...short.coverage, status: "planned", remainingSkillIds: [] },
        },
        shortConditions,
      ),
    ).toThrow();
  });
});

describe("syllabus bounded response reader", () => {
  it("reads a large course without weakening the existing workbook default", async () => {
    const source = JSON.stringify(await plan());
    await expect(readResponseJson(jsonResponse(source))).rejects.toThrow(
      "value limit of 512",
    );
    await expect(
      readSyllabusResponse(jsonResponse(source), new AbortController().signal),
    ).resolves.toEqual(await plan());
  });

  it("retains byte/value/depth bounds, duplicate rejection and cancellation", async () => {
    const signal = new AbortController().signal;
    for (const source of [
      JSON.stringify("x".repeat(65_536)),
      JSON.stringify(Array(4096).fill(0)),
      "[".repeat(65) + "null" + "]".repeat(65),
      '{"saved":false,"saved":true}',
      '{"sessions":[',
    ])
      await expect(
        readSyllabusResponse(jsonResponse(source), signal),
      ).rejects.toThrow();
    await expect(
      readSyllabusResponse(new Response("offline", { status: 503 }), signal),
    ).rejects.toThrow();
    const aborted = AbortSignal.abort(new Error("cancelled"));
    await expect(readSyllabusResponse(jsonResponse("{}"), aborted)).rejects.toThrow(
      "cancelled",
    );
  });
});
