import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import {
  LocalDateSchema,
  RevisionSchema,
  StableIdSchema,
  TimeZoneSchema,
  assertSafeDataObjectGraph,
} from "@exercisebook/schemas";
import { z } from "zod";

export const DAILY_PLAN_PREVIEW_REQUEST_V1_SCHEMA =
  "exercisebook.daily-plan-preview-request/v1";
export const DAILY_PLAN_PREVIEW_V1_SCHEMA = "exercisebook.daily-plan-preview/v1";
export const DAILY_PLAN_PREVIEW_REGISTRY_V1_SCHEMA =
  "exercisebook.daily-plan-preview-registry/v1";
export const PUBLIC_PLAN_PREVIEW_SEED_DOMAIN_V1 =
  "exercisebook/public-plan-preview-seed/v1";
export const PLAN_PREVIEW_REQUEST_IDENTITY_DOMAIN_V1 =
  "exercisebook/daily-plan-preview-request-identity/v1";
export const PUBLIC_PREVIEW_SEED_VERSION_V1 = "public-preview-v1";

export const SELECTION_EXPLANATION =
  "This focused set practices the fraction goal you selected. It is a preview based on your goal and time limit, not a saved or mastery-based plan.";

const GOAL_ID = "math.fractions.add-unlike";
export const DAY_ONE_PREVIEW_POLICY_ID = "day-one-fraction-preview";
export const DAY_ONE_PREVIEW_POLICY_VERSION = 2;
export const DAY_ONE_PREVIEW_RESERVED_CANONICAL_ANSWERS = Object.freeze([
  Object.freeze({ numerator: "1", denominator: "2" }),
  Object.freeze({ numerator: "1", denominator: "3" }),
  Object.freeze({ numerator: "5", denominator: "6" }),
] as const);
const POLICY_ID = DAY_ONE_PREVIEW_POLICY_ID;
const POLICY_VERSION = DAY_ONE_PREVIEW_POLICY_VERSION;
const SKILL_GRAPH_ID = "phase-1-math";
const SKILL_GRAPH_REVISION = 1;
const CONTENT_ID = "math.fractions.add-unlike-denominators";
const CONTENT_REVISION = 1;
const GENERATOR_ID = "fractions.add";
const GENERATOR_VERSION = "1";

const PracticeMinutesSchema = z.union([z.literal(8), z.literal(12), z.literal(20)]);
const PlannedPracticeMinutesSchema = z.union([
  z.literal(8),
  z.literal(12),
  z.literal(16),
]);
const PlannedItemCountSchema = z.union([z.literal(4), z.literal(6), z.literal(8)]);

export const DailyPlanPreviewRequestV1Schema = z.strictObject({
  schema: z.literal(DAILY_PLAN_PREVIEW_REQUEST_V1_SCHEMA),
  goalId: z.literal(GOAL_ID),
  practiceMinutes: PracticeMinutesSchema,
  localStudyDate: LocalDateSchema,
  timeZone: TimeZoneSchema,
  locale: z.literal("en"),
});

export type DailyPlanPreviewRequestV1 = Readonly<
  z.infer<typeof DailyPlanPreviewRequestV1Schema>
>;

export const DailyPlanPreviewRegistryV1Schema = z.strictObject({
  schema: z.literal(DAILY_PLAN_PREVIEW_REGISTRY_V1_SCHEMA),
  policy: z.strictObject({
    id: StableIdSchema,
    version: RevisionSchema,
    enabled: z.boolean(),
  }),
  skillGraph: z.strictObject({
    id: StableIdSchema,
    revision: RevisionSchema,
    enabled: z.boolean(),
  }),
  content: z.strictObject({
    id: StableIdSchema,
    revision: RevisionSchema,
    reviewedItemCount: z.number().int().min(0).max(200),
    enabled: z.boolean(),
  }),
  generator: z.strictObject({
    id: StableIdSchema,
    version: StableIdSchema,
    enabled: z.boolean(),
  }),
});

export type DailyPlanPreviewRegistryV1 = Readonly<
  z.infer<typeof DailyPlanPreviewRegistryV1Schema>
>;

export const DAY_ONE_PREVIEW_REGISTRY: DailyPlanPreviewRegistryV1 = Object.freeze({
  schema: DAILY_PLAN_PREVIEW_REGISTRY_V1_SCHEMA,
  policy: Object.freeze({
    id: POLICY_ID,
    version: POLICY_VERSION,
    enabled: true,
  }),
  skillGraph: Object.freeze({
    id: SKILL_GRAPH_ID,
    revision: SKILL_GRAPH_REVISION,
    enabled: true,
  }),
  content: Object.freeze({
    id: CONTENT_ID,
    revision: CONTENT_REVISION,
    reviewedItemCount: 8,
    enabled: true,
  }),
  generator: Object.freeze({
    id: GENERATOR_ID,
    version: GENERATOR_VERSION,
    enabled: true,
  }),
});

const DailyPlanPreviewActivityV1Schema = z.strictObject({
  id: z.literal("current-frontier-practice"),
  kind: z.literal("practice"),
  skillId: z.literal(GOAL_ID),
  contentId: z.literal(CONTENT_ID),
  contentRevision: z.literal(CONTENT_REVISION),
  generatorId: z.literal(GENERATOR_ID),
  generatorVersion: z.literal(GENERATOR_VERSION),
  itemCount: PlannedItemCountSchema,
  expectedMinutes: PlannedPracticeMinutesSchema,
  selectionReasons: z.tuple([z.literal("current-frontier")]),
  selectionExplanation: z.literal(SELECTION_EXPLANATION),
  excludedCanonicalAnswers: z.tuple([
    z.strictObject({
      numerator: z.literal("1"),
      denominator: z.literal("2"),
    }),
    z.strictObject({
      numerator: z.literal("1"),
      denominator: z.literal("3"),
    }),
    z.strictObject({
      numerator: z.literal("5"),
      denominator: z.literal("6"),
    }),
  ]),
});

export const DailyPlanPreviewV1Schema = z
  .strictObject({
    schema: z.literal(DAILY_PLAN_PREVIEW_V1_SCHEMA),
    id: z.string().regex(/^preview-[0-9a-f]{64}$/u),
    goalId: z.literal(GOAL_ID),
    localStudyDate: LocalDateSchema,
    timeZone: TimeZoneSchema,
    locale: z.literal("en"),
    requestedPracticeMinutes: PracticeMinutesSchema,
    plannedPracticeMinutes: PlannedPracticeMinutesSchema,
    evidence: z.strictObject({
      kind: z.literal("none"),
      version: z.literal(1),
    }),
    policy: z.strictObject({
      id: z.literal(POLICY_ID),
      version: z.literal(POLICY_VERSION),
    }),
    skillGraph: z.strictObject({
      id: z.literal(SKILL_GRAPH_ID),
      revision: z.literal(SKILL_GRAPH_REVISION),
    }),
    activities: z.tuple([DailyPlanPreviewActivityV1Schema]),
    generation: z.strictObject({
      baseSeed: z.string().regex(/^[0-9a-f]{64}$/u),
      seedVersion: z.literal(PUBLIC_PREVIEW_SEED_VERSION_V1),
    }),
  })
  .superRefine((plan, context) => {
    const expected = selectionForBudget(plan.requestedPracticeMinutes);
    const activity = plan.activities[0];
    if (plan.plannedPracticeMinutes !== expected.plannedPracticeMinutes) {
      context.addIssue({
        code: "custom",
        message: "Planned minutes do not match the pinned policy",
        path: ["plannedPracticeMinutes"],
      });
    }
    if (activity.itemCount !== expected.itemCount) {
      context.addIssue({
        code: "custom",
        message: "Item count does not match the pinned policy",
        path: ["activities", 0, "itemCount"],
      });
    }
    if (activity.expectedMinutes !== expected.plannedPracticeMinutes) {
      context.addIssue({
        code: "custom",
        message: "Activity minutes do not match the pinned policy",
        path: ["activities", 0, "expectedMinutes"],
      });
    }
    if (plan.plannedPracticeMinutes > plan.requestedPracticeMinutes) {
      context.addIssue({
        code: "custom",
        message: "Planned minutes exceed the requested practice cap",
        path: ["plannedPracticeMinutes"],
      });
    }
  });

export type DailyPlanPreviewV1 = Readonly<z.infer<typeof DailyPlanPreviewV1Schema>>;

const DailyPlanPreviewUnavailableV1Schema = z.strictObject({
  status: z.literal("unavailable"),
  code: z.literal("goal-unavailable"),
});

export const DailyPlanPreviewResultV1Schema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ready"),
    plan: DailyPlanPreviewV1Schema,
  }),
  DailyPlanPreviewUnavailableV1Schema,
]);

export type DailyPlanPreviewResultV1 = Readonly<
  z.infer<typeof DailyPlanPreviewResultV1Schema>
>;

export type DailyPlanPreviewSelectionV1 =
  | Readonly<{
      status: "ready";
      itemCount: 4 | 6 | 8;
      plannedPracticeMinutes: 8 | 12 | 16;
    }>
  | Readonly<{
      status: "unavailable";
      code: "goal-unavailable";
    }>;

export function validateDailyPlanPreviewRequestV1(
  value: unknown,
): DailyPlanPreviewRequestV1 {
  assertSafeDataObjectGraph(value);
  return DailyPlanPreviewRequestV1Schema.parse(value);
}

export function validateDailyPlanPreviewRegistryV1(
  value: unknown,
): DailyPlanPreviewRegistryV1 {
  assertSafeDataObjectGraph(value);
  return DailyPlanPreviewRegistryV1Schema.parse(value);
}

export function validateDailyPlanPreviewV1(value: unknown): DailyPlanPreviewV1 {
  assertSafeDataObjectGraph(value);
  return DailyPlanPreviewV1Schema.parse(value);
}

export function validateDailyPlanPreviewResultV1(
  value: unknown,
): DailyPlanPreviewResultV1 {
  assertSafeDataObjectGraph(value);
  return DailyPlanPreviewResultV1Schema.parse(value);
}

export function selectDailyPlanPreviewV1(
  request: DailyPlanPreviewRequestV1,
  registry: DailyPlanPreviewRegistryV1,
): DailyPlanPreviewSelectionV1 {
  const stableRequest = validateDailyPlanPreviewRequestV1(request);
  const stableRegistry = validateDailyPlanPreviewRegistryV1(registry);
  return selectValidatedDailyPlanPreviewV1(stableRequest, stableRegistry);
}

export async function planDailyPreviewV1(
  request: DailyPlanPreviewRequestV1,
  registry: DailyPlanPreviewRegistryV1,
): Promise<DailyPlanPreviewResultV1> {
  const stableRequest = validateDailyPlanPreviewRequestV1(request);
  const stableRegistry = validateDailyPlanPreviewRegistryV1(registry);
  const selection = selectValidatedDailyPlanPreviewV1(stableRequest, stableRegistry);

  if (selection.status === "unavailable") {
    return validateDailyPlanPreviewResultV1({
      status: "unavailable",
      code: "goal-unavailable",
    });
  }

  const versionIdentity = {
    policy: {
      id: POLICY_ID,
      version: POLICY_VERSION,
    },
    skillGraph: {
      id: SKILL_GRAPH_ID,
      revision: SKILL_GRAPH_REVISION,
    },
    evidence: {
      kind: "none",
      version: 1,
    },
    contentRevision: CONTENT_REVISION,
    generatorVersion: GENERATOR_VERSION,
    // Policy v2 owns this complete materialization input. Including it in both
    // identities prevents an accidental constant drift from preserving an old
    // plan ID or seed, while the policy version remains the public rollback
    // and registry boundary.
    excludedCanonicalAnswers: DAY_ONE_PREVIEW_RESERVED_CANONICAL_ANSWERS,
  } as const;
  const baseSeed = await sha256Hex(
    canonicalizeJson({
      domain: PUBLIC_PLAN_PREVIEW_SEED_DOMAIN_V1,
      goalId: stableRequest.goalId,
      localStudyDate: stableRequest.localStudyDate,
      timeZone: stableRequest.timeZone,
      locale: stableRequest.locale,
      ...versionIdentity,
    }),
  );
  const requestIdentity = await sha256Hex(
    canonicalizeJson({
      domain: PLAN_PREVIEW_REQUEST_IDENTITY_DOMAIN_V1,
      request: stableRequest,
      ...versionIdentity,
    }),
  );

  return validateDailyPlanPreviewResultV1({
    status: "ready",
    plan: {
      schema: DAILY_PLAN_PREVIEW_V1_SCHEMA,
      id: `preview-${requestIdentity}`,
      goalId: stableRequest.goalId,
      localStudyDate: stableRequest.localStudyDate,
      timeZone: stableRequest.timeZone,
      locale: stableRequest.locale,
      requestedPracticeMinutes: stableRequest.practiceMinutes,
      plannedPracticeMinutes: selection.plannedPracticeMinutes,
      evidence: versionIdentity.evidence,
      policy: versionIdentity.policy,
      skillGraph: versionIdentity.skillGraph,
      activities: [
        {
          id: "current-frontier-practice",
          kind: "practice",
          skillId: GOAL_ID,
          contentId: CONTENT_ID,
          contentRevision: CONTENT_REVISION,
          generatorId: GENERATOR_ID,
          generatorVersion: GENERATOR_VERSION,
          itemCount: selection.itemCount,
          expectedMinutes: selection.plannedPracticeMinutes,
          selectionReasons: ["current-frontier"],
          selectionExplanation: SELECTION_EXPLANATION,
          excludedCanonicalAnswers: DAY_ONE_PREVIEW_RESERVED_CANONICAL_ANSWERS,
        },
      ],
      generation: {
        baseSeed,
        seedVersion: PUBLIC_PREVIEW_SEED_VERSION_V1,
      },
    },
  });
}

function selectValidatedDailyPlanPreviewV1(
  request: DailyPlanPreviewRequestV1,
  registry: DailyPlanPreviewRegistryV1,
): DailyPlanPreviewSelectionV1 {
  const selection = selectionForBudget(request.practiceMinutes);
  if (!isRequiredVersionAvailable(registry, selection.itemCount)) {
    return { status: "unavailable", code: "goal-unavailable" };
  }
  return { status: "ready", ...selection };
}

function selectionForBudget(practiceMinutes: 8 | 12 | 20): Readonly<{
  itemCount: 4 | 6 | 8;
  plannedPracticeMinutes: 8 | 12 | 16;
}> {
  switch (practiceMinutes) {
    case 8:
      return { itemCount: 4, plannedPracticeMinutes: 8 };
    case 12:
      return { itemCount: 6, plannedPracticeMinutes: 12 };
    case 20:
      return { itemCount: 8, plannedPracticeMinutes: 16 };
  }
}

function isRequiredVersionAvailable(
  registry: DailyPlanPreviewRegistryV1,
  requiredItemCount: number,
): boolean {
  return (
    registry.policy.enabled &&
    registry.policy.id === POLICY_ID &&
    registry.policy.version === POLICY_VERSION &&
    registry.skillGraph.enabled &&
    registry.skillGraph.id === SKILL_GRAPH_ID &&
    registry.skillGraph.revision === SKILL_GRAPH_REVISION &&
    registry.content.enabled &&
    registry.content.id === CONTENT_ID &&
    registry.content.revision === CONTENT_REVISION &&
    registry.content.reviewedItemCount >= requiredItemCount &&
    registry.generator.enabled &&
    registry.generator.id === GENERATOR_ID &&
    registry.generator.version === GENERATOR_VERSION
  );
}
