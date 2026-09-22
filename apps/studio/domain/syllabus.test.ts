import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import { describe, expect, it } from "vitest";
import type { SyllabusRequest, SyllabusSession } from "../src/syllabus-contracts";
import { parseSyllabusRequest, planSyllabus } from "./syllabus";

const base: SyllabusRequest = {
  goalId: "linear-equations",
  startingPoint: "from-basics",
  weeks: 4,
  dailyMinutes: 15,
};

describe("Japanese syllabus planning", () => {
  it("strictly validates only the four supported selection fields", () => {
    expect(parseSyllabusRequest(base)).toEqual(base);
    for (const invalid of [
      null,
      [],
      {},
      { ...base, weeks: 3 },
      { ...base, dailyMinutes: 60 },
      { ...base, goalId: "high-school-math" },
      { ...base, startingPoint: "mastered" },
      { ...base, learnerId: "someone" },
      { ...base, weeks: "4" },
    ]) {
      expect(() => parseSyllabusRequest(invalid)).toThrow(TypeError);
    }
    const getter = Object.defineProperty({ ...base }, "weeks", {
      get: () => {
        throw new Error("must not read an accessor");
      },
      enumerable: true,
    });
    expect(() => parseSyllabusRequest(getter)).toThrow(TypeError);
  });

  it("binds all educational choices and the policy to a deterministic identity", async () => {
    const first = await planSyllabus(base);
    expect(await planSyllabus({ ...base })).toEqual(first);
    expect(first.id).toBe(`syllabus-${first.planHash}`);
    const { id: _id, planHash, ...payload } = first;
    expect(await sha256Hex(canonicalizeJson(payload))).toBe(planHash);
    for (const changed of [
      { ...base, weeks: 6 as const },
      { ...base, dailyMinutes: 20 as const },
      { ...base, startingPoint: "review" as const },
      { ...base, goalId: "expression-values" as const },
    ]) {
      expect((await planSyllabus(changed)).planHash).not.toBe(planHash);
    }
    const mutable = first as unknown as { limitations: string[] };
    mutable.limitations.push("local edit");
    expect((await planSyllabus(base)).limitations).not.toContain("local edit");
  });

  it("keeps all 81 conditions within prerequisites, delay, time, and finite slot caps", async () => {
    let checked = 0;
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
            const plan = await planSyllabus(request);
            expect(plan.request).toEqual(request);
            expect(plan.saved).toBe(false);
            expect(plan.studyDaysPerWeek).toBe(5);
            expect(plan.startingPoint.evidence).toBe("self-report");
            expect(plan.sessions.length).toBeGreaterThan(0);
            expect(plan.sessions.length).toBeLessThanOrEqual(weeks * 5);
            expect(plan.skills.length).toBe(
              goalId === "signed-number-confidence"
                ? 2
                : goalId === "expression-values"
                  ? 4
                  : 6,
            );
            const requiredPhases =
              startingPoint === "from-basics"
                ? ["introduce", "practice", "review", "checkpoint"]
                : startingPoint === "some-familiarity"
                  ? ["introduce", "review", "checkpoint"]
                  : ["practice", "review", "checkpoint"];
            const previous = new Map<string, SyllabusSession>();
            let lastIndex = 0;
            for (const session of plan.sessions) {
              const skill = plan.skills.find((entry) => entry.id === session.skillId);
              expect(skill).toBeDefined();
              expect(session.index).toBeGreaterThan(lastIndex);
              expect(session.index).toBeLessThanOrEqual(weeks * 5);
              expect(session.id).toBe(
                `session-${String(session.index).padStart(2, "0")}`,
              );
              expect(session.week).toBe(Math.floor((session.index - 1) / 5) + 1);
              expect(session.day).toBe(((session.index - 1) % 5) + 1);
              expect(session.topicId).toBe(skill?.topicId);
              expect(session.level).toBe(skill?.level);
              expect(skill?.prerequisites.every((id) => previous.has(id))).toBe(true);
              const { budget } = session;
              expect(budget.practiceMinutes).toBe(session.count * 2);
              expect(budget.totalMinutes).toBe(
                budget.lessonMinutes +
                  budget.practiceMinutes +
                  budget.reflectionMinutes,
              );
              expect(budget.totalMinutes).toBeLessThanOrEqual(dailyMinutes);
              expect(
                Object.values(budget).every(
                  (value) => Number.isSafeInteger(value) && value >= 0,
                ),
              ).toBe(true);
              if (session.phase === "review" || session.phase === "checkpoint") {
                const prior = previous.get(session.skillId);
                expect(prior).toBeDefined();
                expect(session.reviewOfSessionId).toBe(prior?.id);
                expect(
                  session.index - (prior?.index ?? Infinity),
                ).toBeGreaterThanOrEqual(3);
              } else {
                expect(session.reviewOfSessionId).toBeNull();
              }
              expect(session.objective.length).toBeGreaterThan(0);
              expect(session.instructions.length).toBeGreaterThan(0);
              expect(session.reflection.length).toBeGreaterThan(0);
              expect(session.checkpointCriteria.length).toBeGreaterThan(0);
              expect(session).not.toHaveProperty("workbookId");
              expect(session).not.toHaveProperty("mastered");
              previous.set(session.skillId, session);
              lastIndex = session.index;
            }
            expect(plan.coverage.plannedSkillIds).toEqual(
              plan.skills
                .filter((skill) => previous.has(skill.id))
                .map((skill) => skill.id),
            );
            const unfinished = plan.skills
              .filter((skill) => {
                const actual = plan.sessions
                  .filter((session) => session.skillId === skill.id)
                  .map((session) => session.phase);
                expect(actual).toEqual(requiredPhases.slice(0, actual.length));
                return actual.length < requiredPhases.length;
              })
              .map((skill) => skill.id);
            expect(plan.coverage.remainingSkillIds).toEqual(unfinished);
            expect(plan.coverage.status).toBe(
              plan.coverage.remainingSkillIds.length ? "partial" : "planned",
            );
            expect(
              new TextEncoder().encode(JSON.stringify(plan)).byteLength,
            ).toBeLessThanOrEqual(65_536);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBe(81);
  });

  it("does not invent mastery or skip prerequisite content for a self-reported reviewer", async () => {
    const beginner = await planSyllabus({ ...base, weeks: 6 });
    const reviewer = await planSyllabus({ ...base, weeks: 6, startingPoint: "review" });
    expect(reviewer.skills).toEqual(beginner.skills);
    expect(reviewer.sessions[0]?.phase).toBe("practice");
    expect(beginner.sessions[0]?.phase).toBe("introduce");
    expect(reviewer.startingPoint.explanation).toContain("自己申告");
    expect(reviewer.startingPoint.explanation).toContain("習得");
    for (const skill of reviewer.skills) {
      expect(reviewer.sessions.some((session) => session.skillId === skill.id)).toBe(
        true,
      );
    }
  });

  it("reports unfinished teaching/check phases and does not pad short goals with drills", async () => {
    const short = await planSyllabus({ ...base, weeks: 2, dailyMinutes: 10 });
    expect(short.coverage.status).toBe("partial");
    expect(short.coverage.remainingSkillIds.length).toBeGreaterThan(0);
    const long = await planSyllabus({ ...base, weeks: 6, dailyMinutes: 10 });
    expect(long.coverage.status).toBe("planned");
    expect(long.coverage.remainingSkillIds).toEqual([]);
    const narrow = await planSyllabus({
      ...base,
      goalId: "signed-number-confidence",
      weeks: 6,
    });
    expect(narrow.skills).toHaveLength(2);
    expect(narrow.sessions).toHaveLength(8);
    expect(
      narrow.sessions.some(
        (session, index) =>
          index > 0 && session.index > (narrow.sessions[index - 1]?.index ?? 0) + 1,
      ),
    ).toBe(true);
    expect(narrow.limitations.join(" ")).toContain("休息");
  });
});
