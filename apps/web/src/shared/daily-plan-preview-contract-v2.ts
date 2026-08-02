import {
  DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2,
  DAY_ONE_PREVIEW_POLICY_ID_V3,
  DAY_ONE_PREVIEW_POLICY_VERSION_V3,
  DAY_ONE_PREVIEW_SELECTION_EXPLANATION_V2,
} from "@exercisebook/planner/public-preview-contract";
import {
  StableIdSchema,
  assertSafeDataObjectGraph,
} from "@exercisebook/schemas/public-data";
import {
  validateStudentWebWorksheetV2,
  type StudentWebWorksheetV2,
} from "@exercisebook/web-renderer";

export const DAILY_PLAN_PREVIEW_RESPONSE_V2_SCHEMA =
  "exercisebook.daily-plan-preview-response/v2";

export const DAILY_PLAN_PREVIEW_SELECTION_EXPLANATION_V2 =
  DAY_ONE_PREVIEW_SELECTION_EXPLANATION_V2;

export type DailyPlanPreviewResponseV2 = Readonly<{
  schema: typeof DAILY_PLAN_PREVIEW_RESPONSE_V2_SCHEMA;
  plan: Readonly<{
    id: string;
    goalId: "math.fractions.add-unlike";
    requestedPracticeMinutes: 8 | 12 | 20;
    plannedPracticeMinutes: 8 | 12 | 16;
    itemCount: 4 | 6 | 8;
    policy: Readonly<{
      id: typeof DAY_ONE_PREVIEW_POLICY_ID_V3;
      version: typeof DAY_ONE_PREVIEW_POLICY_VERSION_V3;
    }>;
    skillGraph: Readonly<{
      id: "phase-1-math";
      revision: 1;
    }>;
    evidenceKind: "none";
    selectionReasons: readonly ["current-frontier"];
    selectionExplanation: typeof DAILY_PLAN_PREVIEW_SELECTION_EXPLANATION_V2;
    saved: false;
  }>;
  worksheet: StudentWebWorksheetV2;
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
 * Validate the exact V2 student response immediately before it crosses the HTTP
 * or browser-state boundary. Internal planner activities, generation values,
 * and presentation-selection claims are intentionally absent.
 */
export function validateDailyPlanPreviewResponseV2(
  value: unknown,
): DailyPlanPreviewResponseV2 {
  assertSafeDataObjectGraph(value);
  const response = exactRecord(value, responseKeys, "$response");
  literal(response.schema, DAILY_PLAN_PREVIEW_RESPONSE_V2_SCHEMA, "$response.schema");

  const plan = validatePublicPlanV2(response.plan);
  const worksheet = validateStudentWebWorksheetV2(response.worksheet);
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
  validatePinnedPresentationContent(worksheet);

  return {
    schema: DAILY_PLAN_PREVIEW_RESPONSE_V2_SCHEMA,
    plan,
    worksheet,
  };
}

function validatePublicPlanV2(value: unknown): DailyPlanPreviewResponseV2["plan"] {
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
  literal(policy.id, DAY_ONE_PREVIEW_POLICY_ID_V3, "$response.plan.policy.id");
  numberLiteral(
    policy.version,
    DAY_ONE_PREVIEW_POLICY_VERSION_V3,
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
    DAILY_PLAN_PREVIEW_SELECTION_EXPLANATION_V2,
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
      id: DAY_ONE_PREVIEW_POLICY_ID_V3,
      version: DAY_ONE_PREVIEW_POLICY_VERSION_V3,
    },
    skillGraph: { id: "phase-1-math", revision: 1 },
    evidenceKind: "none",
    selectionReasons: ["current-frontier"],
    selectionExplanation: DAILY_PLAN_PREVIEW_SELECTION_EXPLANATION_V2,
    saved: false,
  };
}

function validatePinnedPresentationContent(worksheet: StudentWebWorksheetV2): void {
  const content = worksheet.presentation.content;
  literal(
    content.id,
    DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2.id,
    "$response.worksheet.presentation.content.id",
  );
  numberLiteral(
    content.revision,
    DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2.revision,
    "$response.worksheet.presentation.content.revision",
  );
  literal(
    content.sourceHash,
    DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2.sourceHash,
    "$response.worksheet.presentation.content.sourceHash",
  );
  literal(
    content.contentHash,
    DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2.contentHash,
    "$response.worksheet.presentation.content.contentHash",
  );
  literal(
    content.compilerVersion,
    DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2.compilerVersion,
    "$response.worksheet.presentation.content.compilerVersion",
  );
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
