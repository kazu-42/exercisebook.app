/**
 * Browser-safe preview wire constants. This module intentionally contains no
 * registry, seed, answer-exclusion, planning, generator, or schema dependency.
 * Browser code must import this subpath instead of the planner root barrel.
 */
export const DAILY_PLAN_PREVIEW_REQUEST_V1_SCHEMA =
  "exercisebook.daily-plan-preview-request/v1";
export const DAY_ONE_PREVIEW_POLICY_ID = "day-one-fraction-preview";
export const DAY_ONE_PREVIEW_POLICY_VERSION = 2;
export const SELECTION_EXPLANATION =
  "This focused set practices the fraction goal you selected. It is a preview based on your goal and time limit, not a saved or mastery-based plan.";

export type DailyPlanPreviewRequestV1 = Readonly<{
  schema: typeof DAILY_PLAN_PREVIEW_REQUEST_V1_SCHEMA;
  goalId: "math.fractions.add-unlike";
  practiceMinutes: 8 | 12 | 20;
  localStudyDate: string;
  timeZone: string;
  locale: "en";
}>;

export const DAILY_PLAN_PREVIEW_REQUEST_V2_SCHEMA =
  "exercisebook.daily-plan-preview-request/v2";
export const DAY_ONE_PREVIEW_POLICY_ID_V3 = "day-one-fraction-preview";
export const DAY_ONE_PREVIEW_POLICY_VERSION_V3 = 3;
export const DAY_ONE_PREVIEW_SELECTION_EXPLANATION_V2 =
  "This focused set practices the fraction goal you selected. It is a preview based on your goal and time limit, not a saved or mastery-based plan.";

export type DailyPlanPreviewRequestV2 = Readonly<{
  schema: typeof DAILY_PLAN_PREVIEW_REQUEST_V2_SCHEMA;
  goalId: "math.fractions.add-unlike";
  practiceMinutes: 8 | 12 | 20;
  localStudyDate: string;
  timeZone: string;
  locale: "en";
}>;

/**
 * This release lock is part of the reproducibility contract. Changing either
 * hash after vector lock requires a new content or policy revision rather than
 * mutating the published identity in place.
 */
export const DAY_ONE_PREVIEW_V2_CONTENT_FINAL_LOCK = Object.freeze({
  finalized: true,
  sourceHash: "456c8908debd52c7fcc5eba6e2e9a38434b5fcd8343e7a14a427faae34502523",
  contentHash: "944225a2dda87ae6ee61e53f21a929301f5264793d665ea2200b65fb0f5a71dd",
} as const);

export const DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2 = Object.freeze({
  id: "math.fractions.add-unlike-denominators",
  revision: 2,
  sourceHash: DAY_ONE_PREVIEW_V2_CONTENT_FINAL_LOCK.sourceHash,
  contentHash: DAY_ONE_PREVIEW_V2_CONTENT_FINAL_LOCK.contentHash,
  compilerVersion: "exercisebook-content-compiler/2",
} as const);
