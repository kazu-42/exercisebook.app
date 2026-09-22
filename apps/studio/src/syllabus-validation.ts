import {
  cancelResponseBodyBestEffort,
  readBoundedStrictJsonResponse,
} from "../../web/src/shared/bounded-json-response";
import type {
  StartingPoint,
  SyllabusPhase,
  SyllabusPlan,
  SyllabusRequest,
  SyllabusSession,
  SyllabusSkill,
  SyllabusSkillId,
} from "./syllabus-contracts";

const skillIds = [
  "signed-add-subtract",
  "signed-multiply-divide",
  "substitute-positive",
  "substitute-negative",
  "equation-positive",
  "equation-signed",
] as const;
const goalIds = [
  "signed-number-confidence",
  "expression-values",
  "linear-equations",
] as const;
const startingPoints = ["from-basics", "some-familiarity", "review"] as const;
const phases = ["introduce", "practice", "review", "checkpoint"] as const;
const reasons = [
  "prerequisite-introduction",
  "goal-introduction",
  "guided-practice",
  "starting-point-review",
  "spaced-review",
  "independent-check",
] as const;
const requiredPhases: Record<StartingPoint, readonly SyllabusPhase[]> = {
  "from-basics": ["introduce", "practice", "review", "checkpoint"],
  "some-familiarity": ["introduce", "review", "checkpoint"],
  review: ["practice", "review", "checkpoint"],
};
const prerequisitesBySkill: Record<SyllabusSkillId, readonly SyllabusSkillId[]> = {
  "signed-add-subtract": [],
  "signed-multiply-divide": ["signed-add-subtract"],
  "substitute-positive": ["signed-add-subtract"],
  "substitute-negative": [
    "signed-add-subtract",
    "signed-multiply-divide",
    "substitute-positive",
  ],
  "equation-positive": ["substitute-positive"],
  "equation-signed": [
    "signed-add-subtract",
    "signed-multiply-divide",
    "equation-positive",
  ],
};

function invalid(): never {
  throw new TypeError("Unexpected syllabus response structure.");
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key)))
    invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum = 1024): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  )
    invalid();
  return value;
}
function array(value: unknown, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
    invalid();
  return value;
}
function choice<T extends string | number | boolean>(
  value: unknown,
  values: readonly T[],
): T {
  const found = values.find((candidate) => candidate === value);
  if (found === undefined) invalid();
  return found;
}
function integer(value: unknown, minimum: number, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    invalid();
  return value;
}
function orderedIds(
  value: unknown,
  allowed: readonly SyllabusSkillId[],
): SyllabusSkillId[] {
  const result = array(value, 0, allowed.length).map((id) => choice(id, allowed));
  if (
    result.some(
      (id, index) =>
        index > 0 && skillIds.indexOf(id) <= skillIds.indexOf(result[index - 1]!),
    )
  )
    invalid();
  return result;
}
function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => value === right[index])
  );
}
function request(value: unknown): SyllabusRequest {
  const source = record(value, ["goalId", "startingPoint", "weeks", "dailyMinutes"]);
  return {
    goalId: choice(source.goalId, goalIds),
    startingPoint: choice(source.startingPoint, startingPoints),
    weeks: choice(source.weeks, [2, 4, 6] as const),
    dailyMinutes: choice(source.dailyMinutes, [10, 15, 20] as const),
  };
}
function skill(value: unknown, expectedId: SyllabusSkillId): SyllabusSkill {
  const source = record(value, [
    "id",
    "title",
    "topicId",
    "level",
    "objective",
    "prerequisites",
    "lessonFocus",
    "reflection",
    "checkpointCriteria",
  ]);
  if (source.id !== expectedId) invalid();
  const index = skillIds.indexOf(expectedId);
  const topicId = choice(source.topicId, [
    "signed-numbers",
    "expressions",
    "equations",
  ] as const);
  const level = choice(source.level, ["foundation", "standard"] as const);
  if (
    topicId !== ["signed-numbers", "expressions", "equations"][Math.floor(index / 2)] ||
    level !== (index % 2 === 0 ? "foundation" : "standard")
  )
    invalid();
  const prerequisites = orderedIds(source.prerequisites, skillIds.slice(0, index));
  if (!sameIds(prerequisites, prerequisitesBySkill[expectedId])) invalid();
  return {
    id: expectedId,
    topicId,
    level,
    prerequisites,
    title: text(source.title, 256),
    objective: text(source.objective),
    lessonFocus: text(source.lessonFocus),
    reflection: text(source.reflection),
    checkpointCriteria: text(source.checkpointCriteria),
  };
}

/** Validate structure and planning claims; server policy owns course identity. */
export function parseSyllabus(
  value: unknown,
  expectedRequest: SyllabusRequest,
): SyllabusPlan {
  const source = record(value, [
    "schemaVersion",
    "id",
    "planHash",
    "policyVersion",
    "request",
    "saved",
    "studyDaysPerWeek",
    "title",
    "goal",
    "startingPoint",
    "skills",
    "sessions",
    "coverage",
    "limitations",
  ]);
  const conditions = request(source.request);
  const expected = request(expectedRequest);
  if (
    Object.keys(expected).some(
      (key) =>
        conditions[key as keyof SyllabusRequest] !==
        expected[key as keyof SyllabusRequest],
    )
  )
    invalid();
  const schemaVersion = choice(source.schemaVersion, ["studio-syllabus-v1"] as const);
  const policyVersion = choice(source.policyVersion, [
    "algebra-foundation-plan@1",
  ] as const);
  const saved = choice(source.saved, [false] as const);
  const studyDaysPerWeek = choice(source.studyDaysPerWeek, [5] as const);
  const planHash = text(source.planHash, 64);
  const id = text(source.id, 73);
  if (!/^[a-f0-9]{64}$/u.test(planHash) || id !== `syllabus-${planHash}`) invalid();
  const goalSource = record(source.goal, ["id", "title", "description"]);
  if (goalSource.id !== conditions.goalId) invalid();
  const goal = {
    id: conditions.goalId,
    title: text(goalSource.title, 256),
    description: text(goalSource.description),
  };
  const startSource = record(source.startingPoint, [
    "id",
    "label",
    "explanation",
    "evidence",
  ]);
  if (startSource.id !== conditions.startingPoint) invalid();
  const startingPoint = {
    id: conditions.startingPoint,
    label: text(startSource.label, 256),
    explanation: text(startSource.explanation),
    evidence: choice(startSource.evidence, ["self-report"] as const),
  };
  const expectedSkills = skillIds.slice(
    0,
    (goalIds.indexOf(conditions.goalId) + 1) * 2,
  );
  const skills = array(source.skills, expectedSkills.length, expectedSkills.length).map(
    (value, index) => skill(value, expectedSkills[index]!),
  );
  const sessions: SyllabusSession[] = [];
  for (const entry of array(source.sessions, 1, conditions.weeks * 5)) {
    const session = record(entry, [
      "id",
      "index",
      "week",
      "day",
      "phase",
      "skillId",
      "topicId",
      "level",
      "count",
      "title",
      "objective",
      "lessonFocus",
      "instructions",
      "reflection",
      "checkpointCriteria",
      "reasonCode",
      "reason",
      "budget",
      "reviewOfSessionId",
    ]);
    const index = integer(session.index, 1, conditions.weeks * 5);
    if (
      index <= (sessions.at(-1)?.index ?? 0) ||
      session.id !== `session-${String(index).padStart(2, "0")}`
    )
      invalid();
    const week = Math.floor((index - 1) / 5) + 1;
    const day = choice(session.day, [1, 2, 3, 4, 5] as const);
    if (session.week !== week || day !== ((index - 1) % 5) + 1) invalid();
    const skillId = choice(session.skillId, expectedSkills);
    const selectedSkill = skills.find((skill) => skill.id === skillId)!;
    if (
      session.topicId !== selectedSkill.topicId ||
      session.level !== selectedSkill.level
    )
      invalid();
    if (
      selectedSkill.prerequisites.some(
        (id) => !sessions.some((prior) => prior.skillId === id),
      )
    )
      invalid();
    const phase = choice(session.phase, phases);
    const earlierSameSkill = sessions.filter((prior) => prior.skillId === skillId);
    if (phase !== requiredPhases[conditions.startingPoint][earlierSameSkill.length])
      invalid();
    const reasonCode = choice(session.reasonCode, reasons);
    const expectedReason =
      phase === "review"
        ? "spaced-review"
        : phase === "checkpoint"
          ? "independent-check"
          : phase === "practice"
            ? conditions.startingPoint === "review"
              ? "starting-point-review"
              : "guided-practice"
            : skillIds.indexOf(skillId) >= expectedSkills.length - 2
              ? "goal-introduction"
              : "prerequisite-introduction";
    if (reasonCode !== expectedReason) invalid();
    const count = choice(session.count, [4, 6, 8] as const);
    const budgetSource = record(session.budget, [
      "lessonMinutes",
      "practiceMinutes",
      "reflectionMinutes",
      "totalMinutes",
    ]);
    const budget = {
      lessonMinutes: integer(budgetSource.lessonMinutes, 0, conditions.dailyMinutes),
      practiceMinutes: integer(
        budgetSource.practiceMinutes,
        1,
        conditions.dailyMinutes,
      ),
      reflectionMinutes: integer(
        budgetSource.reflectionMinutes,
        0,
        conditions.dailyMinutes,
      ),
      totalMinutes: integer(budgetSource.totalMinutes, 1, conditions.dailyMinutes),
    };
    if (
      budget.practiceMinutes !== count * 2 ||
      budget.totalMinutes !==
        budget.lessonMinutes + budget.practiceMinutes + budget.reflectionMinutes
    )
      invalid();
    const reviewOfSessionId =
      session.reviewOfSessionId === null ? null : text(session.reviewOfSessionId, 10);
    if (phase === "review" || phase === "checkpoint") {
      const prior = earlierSameSkill.at(-1);
      if (!prior || prior.id !== reviewOfSessionId || index - prior.index < 3)
        invalid();
    } else if (reviewOfSessionId !== null) invalid();
    sessions.push({
      id: text(session.id, 10),
      index,
      week,
      day,
      phase,
      skillId,
      topicId: selectedSkill.topicId,
      level: selectedSkill.level,
      count,
      budget,
      title: text(session.title, 256),
      objective: text(session.objective),
      lessonFocus: text(session.lessonFocus),
      instructions: array(session.instructions, 1, 8).map((value) => text(value)),
      reflection: text(session.reflection),
      checkpointCriteria: text(session.checkpointCriteria),
      reasonCode,
      reason: text(session.reason),
      reviewOfSessionId,
    });
  }
  const coverageSource = record(source.coverage, [
    "status",
    "plannedSkillIds",
    "remainingSkillIds",
    "explanation",
  ]);
  const plannedSkillIds = orderedIds(coverageSource.plannedSkillIds, expectedSkills);
  const remainingSkillIds = orderedIds(
    coverageSource.remainingSkillIds,
    expectedSkills,
  );
  if (
    !sameIds(
      plannedSkillIds,
      expectedSkills.filter((id) => sessions.some((session) => session.skillId === id)),
    )
  )
    invalid();
  const incomplete = expectedSkills.filter((id) =>
    requiredPhases[conditions.startingPoint].some(
      (phase) =>
        !sessions.some((session) => session.skillId === id && session.phase === phase),
    ),
  );
  if (!sameIds(remainingSkillIds, incomplete)) invalid();
  const status = choice(coverageSource.status, ["planned", "partial"] as const);
  if ((status === "planned") !== (remainingSkillIds.length === 0)) invalid();
  return {
    schemaVersion,
    id,
    planHash,
    policyVersion,
    request: conditions,
    saved,
    studyDaysPerWeek,
    title: text(source.title, 256),
    goal,
    startingPoint,
    skills,
    sessions,
    coverage: {
      status,
      plannedSkillIds,
      remainingSkillIds,
      explanation: text(coverageSource.explanation, 2048),
    },
    limitations: array(source.limitations, 1, 12).map((value) => text(value, 2048)),
  };
}

export async function readSyllabusResponse(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  if (!response.ok) {
    const error = new TypeError("Syllabus request failed.");
    cancelResponseBodyBestEffort(response, error);
    throw error;
  }
  return readBoundedStrictJsonResponse(response, {
    maximumBytes: 65_536,
    maximumValues: 4096,
    signal,
  });
}
