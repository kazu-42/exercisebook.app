import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import {
  CanonicalIntegerStringSchema,
  LocalDateSchema,
  RationalJsonSchema,
  RevisionSchema,
  Sha256HexSchema,
  StableIdSchema,
  TimeZoneSchema,
  assertSafeDataObjectGraph,
} from "@exercisebook/schemas";
import { z } from "zod";
import {
  DAILY_PLAN_PREVIEW_REQUEST_V2_SCHEMA,
  DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2,
  DAY_ONE_PREVIEW_POLICY_ID_V3,
  DAY_ONE_PREVIEW_POLICY_VERSION_V3,
  DAY_ONE_PREVIEW_SELECTION_EXPLANATION_V2,
  DAY_ONE_PREVIEW_V2_CONTENT_FINAL_LOCK,
  type DailyPlanPreviewRequestV2,
} from "./public-preview-contract.js";

export {
  DAILY_PLAN_PREVIEW_REQUEST_V2_SCHEMA,
  DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2,
  DAY_ONE_PREVIEW_POLICY_ID_V3,
  DAY_ONE_PREVIEW_POLICY_VERSION_V3,
  DAY_ONE_PREVIEW_SELECTION_EXPLANATION_V2,
  DAY_ONE_PREVIEW_V2_CONTENT_FINAL_LOCK,
  type DailyPlanPreviewRequestV2,
} from "./public-preview-contract.js";

export const DAILY_PLAN_PREVIEW_V2_SCHEMA = "exercisebook.daily-plan-preview/v2";
export const DAILY_PLAN_PREVIEW_REGISTRY_V2_SCHEMA =
  "exercisebook.daily-plan-preview-registry/v2";
export const PUBLIC_PLAN_PREVIEW_SEED_DOMAIN_V2 =
  "exercisebook/public-plan-preview-seed/v2";
export const PLAN_PREVIEW_REQUEST_IDENTITY_DOMAIN_V2 =
  "exercisebook/daily-plan-preview-request-identity/v2";
export const PUBLIC_PREVIEW_SEED_VERSION_V2 = "public-preview-v2";

const GOAL_ID = "math.fractions.add-unlike";
const SKILL_GRAPH_ID = "phase-1-math";
const SKILL_GRAPH_REVISION = 1;
const CONTENT_ID = DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2.id;
const CONTENT_REVISION = DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2.revision;
const CONTENT_COMPILER_VERSION = DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2.compilerVersion;
const GENERATOR_ID = "fractions.add";
const GENERATOR_VERSION = "1";
const REVIEWED_ITEM_COUNT = 8;

export const DAY_ONE_PREVIEW_RESERVED_CANONICAL_ANSWERS_V2 = Object.freeze([
  Object.freeze({ numerator: "1", denominator: "2" }),
  Object.freeze({ numerator: "1", denominator: "3" }),
  Object.freeze({ numerator: "5", denominator: "6" }),
] as const);

export const DAY_ONE_FRACTION_PRESENTATION_SELECTION_V1 = Object.freeze({
  explanationNodeId: "lesson-explanation-01",
  workedExampleNodeId: "worked-example-01",
  exerciseNodeId: "practice-01",
  excludedCanonicalAnswers: DAY_ONE_PREVIEW_RESERVED_CANONICAL_ANSWERS_V2,
} as const);

const PracticeMinutesSchema = z.union([z.literal(8), z.literal(12), z.literal(20)]);
const PlannedPracticeMinutesSchema = z.union([
  z.literal(8),
  z.literal(12),
  z.literal(16),
]);
const PlannedItemCountSchema = z.union([z.literal(4), z.literal(6), z.literal(8)]);

export const DailyPlanPreviewRequestV2Schema = z.strictObject({
  schema: z.literal(DAILY_PLAN_PREVIEW_REQUEST_V2_SCHEMA),
  goalId: z.literal(GOAL_ID),
  practiceMinutes: PracticeMinutesSchema,
  localStudyDate: LocalDateSchema,
  timeZone: TimeZoneSchema,
  locale: z.literal("en"),
});

export const PreviewContentIdentityV2Schema = z.strictObject({
  id: z.literal(CONTENT_ID),
  revision: z.literal(CONTENT_REVISION),
  sourceHash: z.literal(DAY_ONE_PREVIEW_V2_CONTENT_FINAL_LOCK.sourceHash),
  contentHash: z.literal(DAY_ONE_PREVIEW_V2_CONTENT_FINAL_LOCK.contentHash),
  compilerVersion: z.literal(CONTENT_COMPILER_VERSION),
});

export type PreviewContentIdentityV2 = Readonly<
  z.infer<typeof PreviewContentIdentityV2Schema>
>;

export const FractionPresentationSelectionV1Schema = z.strictObject({
  explanationNodeId: z.literal("lesson-explanation-01"),
  workedExampleNodeId: z.literal("worked-example-01"),
  exerciseNodeId: z.literal("practice-01"),
  excludedCanonicalAnswers: z
    .tuple([
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
    ])
    .readonly(),
});

export type FractionPresentationSelectionV1 = Readonly<
  z.infer<typeof FractionPresentationSelectionV1Schema>
>;

const RegistryPresentationSelectionV1Schema = z.strictObject({
  explanationNodeId: StableIdSchema,
  workedExampleNodeId: StableIdSchema,
  exerciseNodeId: StableIdSchema,
  excludedCanonicalAnswers: z
    .array(
      z
        .strictObject({
          numerator: CanonicalIntegerStringSchema,
          denominator: CanonicalIntegerStringSchema,
        })
        .pipe(RationalJsonSchema),
    )
    .max(8)
    .readonly(),
});

export const DailyPlanPreviewRegistryV2Schema = z.strictObject({
  schema: z.literal(DAILY_PLAN_PREVIEW_REGISTRY_V2_SCHEMA),
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
    sourceHash: Sha256HexSchema,
    contentHash: Sha256HexSchema,
    compilerVersion: z.string().min(1).max(80),
    reviewedItemCount: z.number().int().min(0).max(200),
    enabled: z.boolean(),
  }),
  generator: z.strictObject({
    id: StableIdSchema,
    version: StableIdSchema,
    enabled: z.boolean(),
  }),
  presentationSelection: RegistryPresentationSelectionV1Schema,
});

export type DailyPlanPreviewRegistryV2 = Readonly<
  z.infer<typeof DailyPlanPreviewRegistryV2Schema>
>;

export const DAY_ONE_PREVIEW_REGISTRY_V2: DailyPlanPreviewRegistryV2 = Object.freeze({
  schema: DAILY_PLAN_PREVIEW_REGISTRY_V2_SCHEMA,
  policy: Object.freeze({
    id: DAY_ONE_PREVIEW_POLICY_ID_V3,
    version: DAY_ONE_PREVIEW_POLICY_VERSION_V3,
    enabled: DAY_ONE_PREVIEW_V2_CONTENT_FINAL_LOCK.finalized,
  }),
  skillGraph: Object.freeze({
    id: SKILL_GRAPH_ID,
    revision: SKILL_GRAPH_REVISION,
    enabled: true,
  }),
  content: Object.freeze({
    ...DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2,
    reviewedItemCount: REVIEWED_ITEM_COUNT,
    enabled: DAY_ONE_PREVIEW_V2_CONTENT_FINAL_LOCK.finalized,
  }),
  generator: Object.freeze({
    id: GENERATOR_ID,
    version: GENERATOR_VERSION,
    enabled: true,
  }),
  presentationSelection: DAY_ONE_FRACTION_PRESENTATION_SELECTION_V1,
});

export const DailyPlanPreviewActivityV2Schema = z.strictObject({
  id: z.literal("current-frontier-practice"),
  kind: z.literal("practice"),
  skillId: z.literal(GOAL_ID),
  content: PreviewContentIdentityV2Schema,
  generatorId: z.literal(GENERATOR_ID),
  generatorVersion: z.literal(GENERATOR_VERSION),
  itemCount: PlannedItemCountSchema,
  expectedMinutes: PlannedPracticeMinutesSchema,
  selectionReasons: z.tuple([z.literal("current-frontier")]),
  selectionExplanation: z.literal(DAY_ONE_PREVIEW_SELECTION_EXPLANATION_V2),
  presentationSelection: FractionPresentationSelectionV1Schema,
});

export type DailyPlanPreviewActivityV2 = Readonly<
  z.infer<typeof DailyPlanPreviewActivityV2Schema>
>;

export const DailyPlanPreviewV2Schema = z
  .strictObject({
    schema: z.literal(DAILY_PLAN_PREVIEW_V2_SCHEMA),
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
      id: z.literal(DAY_ONE_PREVIEW_POLICY_ID_V3),
      version: z.literal(DAY_ONE_PREVIEW_POLICY_VERSION_V3),
    }),
    skillGraph: z.strictObject({
      id: z.literal(SKILL_GRAPH_ID),
      revision: z.literal(SKILL_GRAPH_REVISION),
    }),
    activities: z.tuple([DailyPlanPreviewActivityV2Schema]),
    generation: z.strictObject({
      baseSeed: Sha256HexSchema,
      seedVersion: z.literal(PUBLIC_PREVIEW_SEED_VERSION_V2),
    }),
  })
  .superRefine((plan, context) => {
    const expected = selectionForBudgetV2(plan.requestedPracticeMinutes);
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

export type DailyPlanPreviewV2 = Readonly<z.infer<typeof DailyPlanPreviewV2Schema>>;

const DailyPlanPreviewUnavailableV2Schema = z.strictObject({
  status: z.literal("unavailable"),
  code: z.literal("goal-unavailable"),
});

export const DailyPlanPreviewResultV2Schema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ready"),
    plan: DailyPlanPreviewV2Schema,
  }),
  DailyPlanPreviewUnavailableV2Schema,
]);

export type DailyPlanPreviewResultV2 = Readonly<
  z.infer<typeof DailyPlanPreviewResultV2Schema>
>;

export type DailyPlanPreviewSelectionV2 =
  | Readonly<{
      status: "ready";
      itemCount: 4 | 6 | 8;
      plannedPracticeMinutes: 8 | 12 | 16;
    }>
  | Readonly<{
      status: "unavailable";
      code: "goal-unavailable";
    }>;

export function validateDailyPlanPreviewRequestV2(
  value: unknown,
): DailyPlanPreviewRequestV2 {
  assertSafeDataObjectGraph(value);
  return DailyPlanPreviewRequestV2Schema.parse(value);
}

export function validateDailyPlanPreviewRegistryV2(
  value: unknown,
): DailyPlanPreviewRegistryV2 {
  assertSafeDataObjectGraph(value);
  return DailyPlanPreviewRegistryV2Schema.parse(value);
}

export function validateDailyPlanPreviewV2(value: unknown): DailyPlanPreviewV2 {
  assertSafeDataObjectGraph(value);
  return DailyPlanPreviewV2Schema.parse(value);
}

export function validateDailyPlanPreviewResultV2(
  value: unknown,
): DailyPlanPreviewResultV2 {
  assertSafeDataObjectGraph(value);
  return DailyPlanPreviewResultV2Schema.parse(value);
}

export function selectDailyPlanPreviewV2(
  request: DailyPlanPreviewRequestV2,
  registry: DailyPlanPreviewRegistryV2,
): DailyPlanPreviewSelectionV2 {
  const stableRequest = validateDailyPlanPreviewRequestV2(request);
  const stableRegistry = validateDailyPlanPreviewRegistryV2(registry);
  return selectValidatedDailyPlanPreviewV2(stableRequest, stableRegistry);
}

export async function planDailyPreviewV2(
  request: DailyPlanPreviewRequestV2,
  registry: DailyPlanPreviewRegistryV2,
): Promise<DailyPlanPreviewResultV2> {
  const stableRequest = validateDailyPlanPreviewRequestV2(request);
  const stableRegistry = validateDailyPlanPreviewRegistryV2(registry);
  const selection = selectValidatedDailyPlanPreviewV2(stableRequest, stableRegistry);

  if (selection.status === "unavailable") {
    return validateDailyPlanPreviewResultV2({
      status: "unavailable",
      code: "goal-unavailable",
    });
  }

  const versionIdentity = {
    policy: {
      id: DAY_ONE_PREVIEW_POLICY_ID_V3,
      version: DAY_ONE_PREVIEW_POLICY_VERSION_V3,
    },
    skillGraph: {
      id: SKILL_GRAPH_ID,
      revision: SKILL_GRAPH_REVISION,
    },
    evidence: {
      kind: "none",
      version: 1,
    },
    content: DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2,
    generator: {
      id: GENERATOR_ID,
      version: GENERATOR_VERSION,
    },
    presentationSelection: DAY_ONE_FRACTION_PRESENTATION_SELECTION_V1,
  } as const;
  const baseSeed = await sha256Hex(
    canonicalizeJson({
      domain: PUBLIC_PLAN_PREVIEW_SEED_DOMAIN_V2,
      goalId: stableRequest.goalId,
      localStudyDate: stableRequest.localStudyDate,
      timeZone: stableRequest.timeZone,
      locale: stableRequest.locale,
      ...versionIdentity,
    }),
  );
  const requestIdentity = await sha256Hex(
    canonicalizeJson({
      domain: PLAN_PREVIEW_REQUEST_IDENTITY_DOMAIN_V2,
      request: stableRequest,
      ...versionIdentity,
    }),
  );

  return validateDailyPlanPreviewResultV2({
    status: "ready",
    plan: {
      schema: DAILY_PLAN_PREVIEW_V2_SCHEMA,
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
          content: versionIdentity.content,
          generatorId: GENERATOR_ID,
          generatorVersion: GENERATOR_VERSION,
          itemCount: selection.itemCount,
          expectedMinutes: selection.plannedPracticeMinutes,
          selectionReasons: ["current-frontier"],
          selectionExplanation: DAY_ONE_PREVIEW_SELECTION_EXPLANATION_V2,
          presentationSelection: versionIdentity.presentationSelection,
        },
      ],
      generation: {
        baseSeed,
        seedVersion: PUBLIC_PREVIEW_SEED_VERSION_V2,
      },
    },
  });
}

function selectValidatedDailyPlanPreviewV2(
  request: DailyPlanPreviewRequestV2,
  registry: DailyPlanPreviewRegistryV2,
): DailyPlanPreviewSelectionV2 {
  const selection = selectionForBudgetV2(request.practiceMinutes);
  if (!isRequiredVersionAvailableV2(registry, selection.itemCount)) {
    return { status: "unavailable", code: "goal-unavailable" };
  }
  return { status: "ready", ...selection };
}

function selectionForBudgetV2(practiceMinutes: 8 | 12 | 20): Readonly<{
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

function isRequiredVersionAvailableV2(
  registry: DailyPlanPreviewRegistryV2,
  requiredItemCount: number,
): boolean {
  return (
    registry.policy.enabled &&
    registry.policy.id === DAY_ONE_PREVIEW_POLICY_ID_V3 &&
    registry.policy.version === DAY_ONE_PREVIEW_POLICY_VERSION_V3 &&
    registry.skillGraph.enabled &&
    registry.skillGraph.id === SKILL_GRAPH_ID &&
    registry.skillGraph.revision === SKILL_GRAPH_REVISION &&
    registry.content.enabled &&
    registry.content.id === DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2.id &&
    registry.content.revision === DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2.revision &&
    registry.content.sourceHash === DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2.sourceHash &&
    registry.content.contentHash === DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2.contentHash &&
    registry.content.compilerVersion ===
      DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2.compilerVersion &&
    registry.content.reviewedItemCount === REVIEWED_ITEM_COUNT &&
    registry.content.reviewedItemCount >= requiredItemCount &&
    registry.generator.enabled &&
    registry.generator.id === GENERATOR_ID &&
    registry.generator.version === GENERATOR_VERSION &&
    hasExactPresentationSelectionV1(registry.presentationSelection)
  );
}

function hasExactPresentationSelectionV1(
  selection: DailyPlanPreviewRegistryV2["presentationSelection"],
): boolean {
  if (
    selection.explanationNodeId !==
      DAY_ONE_FRACTION_PRESENTATION_SELECTION_V1.explanationNodeId ||
    selection.workedExampleNodeId !==
      DAY_ONE_FRACTION_PRESENTATION_SELECTION_V1.workedExampleNodeId ||
    selection.exerciseNodeId !==
      DAY_ONE_FRACTION_PRESENTATION_SELECTION_V1.exerciseNodeId ||
    selection.excludedCanonicalAnswers.length !==
      DAY_ONE_PREVIEW_RESERVED_CANONICAL_ANSWERS_V2.length
  ) {
    return false;
  }

  return DAY_ONE_PREVIEW_RESERVED_CANONICAL_ANSWERS_V2.every((expected, index) => {
    const actual = selection.excludedCanonicalAnswers[index];
    return (
      actual?.numerator === expected.numerator &&
      actual.denominator === expected.denominator
    );
  });
}
