import type { Level, ProblemCount, TopicId } from "./contracts";

export type SyllabusGoalId =
  "signed-number-confidence" | "expression-values" | "linear-equations";
export type StartingPoint = "from-basics" | "some-familiarity" | "review";
export type SyllabusSkillId =
  | "signed-add-subtract"
  | "signed-multiply-divide"
  | "substitute-positive"
  | "substitute-negative"
  | "equation-positive"
  | "equation-signed";
export type SyllabusPhase = "introduce" | "practice" | "review" | "checkpoint";
export type SyllabusReasonCode =
  | "prerequisite-introduction"
  | "goal-introduction"
  | "guided-practice"
  | "starting-point-review"
  | "spaced-review"
  | "independent-check";

export interface SyllabusRequest {
  readonly goalId: SyllabusGoalId;
  readonly startingPoint: StartingPoint;
  readonly weeks: 2 | 4 | 6;
  readonly dailyMinutes: 10 | 15 | 20;
}

export interface SyllabusSkill {
  readonly id: SyllabusSkillId;
  readonly title: string;
  readonly topicId: TopicId;
  readonly level: Level;
  readonly objective: string;
  readonly prerequisites: readonly SyllabusSkillId[];
  readonly lessonFocus: string;
  readonly reflection: string;
  readonly checkpointCriteria: string;
}

export interface SyllabusSession {
  readonly id: string;
  /** One-based study-day slot; gaps are deliberate days without new work. */
  readonly index: number;
  readonly week: number;
  readonly day: 1 | 2 | 3 | 4 | 5;
  readonly phase: SyllabusPhase;
  readonly skillId: SyllabusSkillId;
  readonly topicId: TopicId;
  readonly level: Level;
  readonly count: ProblemCount;
  readonly title: string;
  readonly objective: string;
  readonly lessonFocus: string;
  readonly instructions: readonly string[];
  readonly reflection: string;
  readonly checkpointCriteria: string;
  readonly reasonCode: SyllabusReasonCode;
  readonly reason: string;
  readonly budget: {
    readonly lessonMinutes: number;
    readonly practiceMinutes: number;
    readonly reflectionMinutes: number;
    readonly totalMinutes: number;
  };
  readonly reviewOfSessionId: string | null;
}

export interface SyllabusPlan {
  readonly schemaVersion: "studio-syllabus-v1";
  readonly id: string;
  readonly planHash: string;
  readonly policyVersion: "algebra-foundation-plan@1";
  readonly request: SyllabusRequest;
  readonly saved: false;
  readonly studyDaysPerWeek: 5;
  readonly title: string;
  readonly goal: {
    readonly id: SyllabusGoalId;
    readonly title: string;
    readonly description: string;
  };
  readonly startingPoint: {
    readonly id: StartingPoint;
    readonly label: string;
    readonly explanation: string;
    readonly evidence: "self-report";
  };
  readonly skills: readonly SyllabusSkill[];
  readonly sessions: readonly SyllabusSession[];
  readonly coverage: {
    readonly status: "planned" | "partial";
    readonly plannedSkillIds: readonly SyllabusSkillId[];
    /** Skills whose required introduction/practice/review/check phases do not fit. */
    readonly remainingSkillIds: readonly SyllabusSkillId[];
    readonly explanation: string;
  };
  readonly limitations: readonly string[];
}
