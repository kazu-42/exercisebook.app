import {
  DAY_ONE_PREVIEW_POLICY_ID,
  DAY_ONE_PREVIEW_POLICY_VERSION,
  SELECTION_EXPLANATION,
  type DailyPlanPreviewV1,
} from "@exercisebook/planner";
import { StableIdSchema, assertSafeDataObjectGraph } from "@exercisebook/schemas";
import {
  validateStudentWebWorksheet,
  type StudentWebWorksheet,
} from "@exercisebook/web-renderer";

export const DAILY_PLAN_PREVIEW_RESPONSE_V1_SCHEMA =
  "exercisebook.daily-plan-preview-response/v1";

export const DAILY_PLAN_PREVIEW_SELECTION_EXPLANATION = SELECTION_EXPLANATION;

type PreviewActivity = DailyPlanPreviewV1["activities"][number];

export type DailyPlanPreviewResponseV1 = Readonly<{
  schema: typeof DAILY_PLAN_PREVIEW_RESPONSE_V1_SCHEMA;
  plan: Readonly<{
    id: DailyPlanPreviewV1["id"];
    goalId: DailyPlanPreviewV1["goalId"];
    requestedPracticeMinutes: DailyPlanPreviewV1["requestedPracticeMinutes"];
    plannedPracticeMinutes: DailyPlanPreviewV1["plannedPracticeMinutes"];
    itemCount: PreviewActivity["itemCount"];
    policy: DailyPlanPreviewV1["policy"];
    skillGraph: DailyPlanPreviewV1["skillGraph"];
    evidenceKind: DailyPlanPreviewV1["evidence"]["kind"];
    selectionReasons: PreviewActivity["selectionReasons"];
    selectionExplanation: PreviewActivity["selectionExplanation"];
    saved: false;
  }>;
  worksheet: StudentWebWorksheet;
}>;

const responseKeys = ["schema", "plan", "worksheet"] as const;
const planKeys = [
  "id",
  "goalId",
  "requestedPracticeMinutes",
  "plannedPracticeMinutes",
  "itemCount",
  "policy",
  "skillGraph",
  "evidenceKind",
  "selectionReasons",
  "selectionExplanation",
  "saved",
] as const;

/**
 * Validate the final public projection even when an injected application
 * service is statically typed. This is the last fail-closed boundary before a
 * value becomes an HTTP response or browser state.
 */
export function validateDailyPlanPreviewResponseV1(
  value: unknown,
): DailyPlanPreviewResponseV1 {
  assertSafeDataObjectGraph(value);
  const response = exactRecord(value, responseKeys, "$response");
  literal(response.schema, DAILY_PLAN_PREVIEW_RESPONSE_V1_SCHEMA, "$response.schema");

  const plan = validatePublicPlan(response.plan);
  const worksheet = validateStudentWebWorksheet(response.worksheet);
  if (worksheet.assignmentId !== plan.id) {
    invalid("$response.worksheet.assignmentId", "must equal the plan ID");
  }
  if (worksheet.items.length !== plan.itemCount) {
    invalid("$response.worksheet.items", "must agree with plan.itemCount");
  }
  if (worksheet.expectedMinutes !== plan.plannedPracticeMinutes) {
    invalid(
      "$response.worksheet.expectedMinutes",
      "must agree with plan.plannedPracticeMinutes",
    );
  }

  return {
    schema: DAILY_PLAN_PREVIEW_RESPONSE_V1_SCHEMA,
    plan,
    worksheet,
  };
}

function validatePublicPlan(value: unknown): DailyPlanPreviewResponseV1["plan"] {
  const plan = exactRecord(value, planKeys, "$response.plan");
  const id = StableIdSchema.parse(plan.id);
  if (!/^preview-[0-9a-f]{64}$/u.test(id)) {
    invalid("$response.plan.id", "must be a versioned preview identity");
  }
  literal(plan.goalId, "math.fractions.add-unlike", "$response.plan.goalId");
  const requestedPracticeMinutes = oneOfNumbers(
    plan.requestedPracticeMinutes,
    [8, 12, 20] as const,
    "$response.plan.requestedPracticeMinutes",
  );
  const mapping = {
    8: { itemCount: 4, plannedPracticeMinutes: 8 },
    12: { itemCount: 6, plannedPracticeMinutes: 12 },
    20: { itemCount: 8, plannedPracticeMinutes: 16 },
  } as const;
  const expected = mapping[requestedPracticeMinutes];
  numberLiteral(
    plan.plannedPracticeMinutes,
    expected.plannedPracticeMinutes,
    "$response.plan.plannedPracticeMinutes",
  );
  numberLiteral(plan.itemCount, expected.itemCount, "$response.plan.itemCount");

  const policy = exactRecord(
    plan.policy,
    ["id", "version"] as const,
    "$response.plan.policy",
  );
  literal(policy.id, DAY_ONE_PREVIEW_POLICY_ID, "$response.plan.policy.id");
  numberLiteral(
    policy.version,
    DAY_ONE_PREVIEW_POLICY_VERSION,
    "$response.plan.policy.version",
  );

  const skillGraph = exactRecord(
    plan.skillGraph,
    ["id", "revision"] as const,
    "$response.plan.skillGraph",
  );
  literal(skillGraph.id, "phase-1-math", "$response.plan.skillGraph.id");
  numberLiteral(skillGraph.revision, 1, "$response.plan.skillGraph.revision");
  literal(plan.evidenceKind, "none", "$response.plan.evidenceKind");

  if (!Array.isArray(plan.selectionReasons) || plan.selectionReasons.length !== 1) {
    invalid("$response.plan.selectionReasons", "must contain one reason");
  }
  literal(
    plan.selectionReasons[0],
    "current-frontier",
    "$response.plan.selectionReasons[0]",
  );
  literal(
    plan.selectionExplanation,
    DAILY_PLAN_PREVIEW_SELECTION_EXPLANATION,
    "$response.plan.selectionExplanation",
  );
  literal(plan.saved, false, "$response.plan.saved");

  return {
    id,
    goalId: "math.fractions.add-unlike",
    requestedPracticeMinutes,
    plannedPracticeMinutes: expected.plannedPracticeMinutes,
    itemCount: expected.itemCount,
    policy: {
      id: DAY_ONE_PREVIEW_POLICY_ID,
      version: DAY_ONE_PREVIEW_POLICY_VERSION,
    },
    skillGraph: { id: "phase-1-math", revision: 1 },
    evidenceKind: "none",
    selectionReasons: ["current-frontier"],
    selectionExplanation: DAILY_PLAN_PREVIEW_SELECTION_EXPLANATION,
    saved: false,
  };
}

function exactRecord<const T extends readonly string[]>(
  value: unknown,
  keys: T,
  path: string,
): Record<T[number], unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(path, "must be an object");
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  if (
    actualKeys.length !== keys.length ||
    actualKeys.some((key) => !keys.includes(key))
  ) {
    invalid(path, `must contain exactly: ${keys.join(", ")}`);
  }
  return record as Record<T[number], unknown>;
}

function literal<const T extends string | boolean>(
  value: unknown,
  expected: T,
  path: string,
): asserts value is T {
  if (value !== expected) {
    invalid(path, `must equal ${JSON.stringify(expected)}`);
  }
}

function numberLiteral<const T extends number>(
  value: unknown,
  expected: T,
  path: string,
): asserts value is T {
  if (value !== expected) {
    invalid(path, `must equal ${expected}`);
  }
}

function oneOfNumbers<const T extends readonly number[]>(
  value: unknown,
  allowed: T,
  path: string,
): T[number] {
  if (typeof value !== "number" || !allowed.includes(value)) {
    invalid(path, `must be one of ${allowed.join(", ")}`);
  }
  return value as T[number];
}

function invalid(path: string, requirement: string): never {
  throw new TypeError(`${path} ${requirement}`);
}
