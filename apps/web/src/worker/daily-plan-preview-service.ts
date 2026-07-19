import {
  materializeFractionAdditionWorksheetFromContent,
  type FractionAdditionAssignmentInput,
} from "@exercisebook/generators";
import {
  DAY_ONE_PREVIEW_REGISTRY,
  planDailyPreviewV1,
  validateDailyPlanPreviewRegistryV1,
  validateDailyPlanPreviewResultV1,
  type DailyPlanPreviewRegistryV1,
  type DailyPlanPreviewRequestV1,
  type DailyPlanPreviewV1,
} from "@exercisebook/planner";
import {
  assertSafeDataObjectGraph,
  validateContentDocumentV1,
  type ContentDocumentV1,
  type MaterializedWorksheetInstanceV1,
} from "@exercisebook/schemas";

import {
  DAILY_PLAN_PREVIEW_RESPONSE_V1_SCHEMA,
  validateDailyPlanPreviewResponseV1,
  type DailyPlanPreviewResponseV1,
} from "../shared/daily-plan-preview-contract.js";
import { SAMPLE_CONTENT_DOCUMENT } from "./sample-content.js";
import { projectStudentWorksheetForWeb } from "./web-worksheet-projector.js";

export type DailyPlanPreviewServiceResult =
  | Readonly<{
      status: "ready";
      response: DailyPlanPreviewResponseV1;
    }>
  | Readonly<{
      status: "unavailable";
      code: "goal-unavailable";
    }>;

export interface DailyPlanPreviewService {
  createPreview(
    request: DailyPlanPreviewRequestV1,
  ): Promise<DailyPlanPreviewServiceResult>;
}

type PlanPreview = typeof planDailyPreviewV1;
type MaterializePreview = (
  document: ContentDocumentV1,
  assignment: FractionAdditionAssignmentInput,
) => Promise<MaterializedWorksheetInstanceV1>;
type ProjectStudentWorksheet = typeof projectStudentWorksheetForWeb;

export interface DailyPlanPreviewServiceDependencies {
  readonly registry?: DailyPlanPreviewRegistryV1;
  readonly contentDocument?: ContentDocumentV1;
  readonly planPreview?: PlanPreview;
  readonly materializePreview?: MaterializePreview;
  readonly projectStudentWorksheet?: ProjectStudentWorksheet;
}

/**
 * Compose the application use case from pure, version-pinned dependencies.
 * There is deliberately no storage, clock, request context, or fallback
 * generator in this service.
 */
export function createDailyPlanPreviewService(
  dependencies: DailyPlanPreviewServiceDependencies = {},
): DailyPlanPreviewService {
  const registry = validateDailyPlanPreviewRegistryV1(
    dependencies.registry ?? DAY_ONE_PREVIEW_REGISTRY,
  );
  const contentDocument = validateContentDocumentV1(
    dependencies.contentDocument ?? SAMPLE_CONTENT_DOCUMENT,
  );
  const planPreview = dependencies.planPreview ?? planDailyPreviewV1;
  const materializePreview =
    dependencies.materializePreview ?? materializeFractionAdditionWorksheetFromContent;
  const projectStudentWorksheet =
    dependencies.projectStudentWorksheet ?? projectStudentWorksheetForWeb;

  return {
    async createPreview(request) {
      const planned = validateDailyPlanPreviewResultV1(
        await planPreview(request, registry),
      );
      if (planned.status === "unavailable") {
        return { status: "unavailable", code: planned.code };
      }

      const plan = planned.plan;
      const activity = plan.activities[0];
      const materialized = await materializePreview(contentDocument, {
        assignmentId: plan.id,
        localStudyDate: plan.localStudyDate,
        timeZone: plan.timeZone,
        locale: plan.locale,
        seed: plan.generation.baseSeed,
        seedSecretVersion: plan.generation.seedVersion,
        requestedItemCount: activity.itemCount,
        plan: { id: plan.id, version: 1 },
        policy: plan.policy,
        skillGraph: plan.skillGraph,
        selectionReasons: activity.selectionReasons,
        excludedCanonicalAnswers: activity.excludedCanonicalAnswers,
      });

      assertSafeDataObjectGraph(materialized);
      assertMaterializationAgreesWithPlan(plan, materialized);
      const expectedInstanceHash = materialized.instanceHash;
      const worksheet = await projectStudentWorksheet(materialized);
      const response = validateDailyPlanPreviewResponseV1({
        schema: DAILY_PLAN_PREVIEW_RESPONSE_V1_SCHEMA,
        plan: {
          id: plan.id,
          goalId: plan.goalId,
          requestedPracticeMinutes: plan.requestedPracticeMinutes,
          plannedPracticeMinutes: plan.plannedPracticeMinutes,
          itemCount: activity.itemCount,
          policy: plan.policy,
          skillGraph: plan.skillGraph,
          evidenceKind: plan.evidence.kind,
          selectionReasons: activity.selectionReasons,
          selectionExplanation: activity.selectionExplanation,
          saved: false,
        },
        worksheet,
      });
      if (response.worksheet.instanceHash !== expectedInstanceHash) {
        throw new Error("Public worksheet hash differs from materialized instance");
      }
      return { status: "ready", response };
    },
  };
}

export const dailyPlanPreviewService = createDailyPlanPreviewService();

export function validateDailyPlanPreviewServiceResult(
  value: unknown,
): DailyPlanPreviewServiceResult {
  assertSafeDataObjectGraph(value);
  const result = exactRecord(value, "$serviceResult");
  if (result.status === "unavailable") {
    assertExactKeys(result, ["status", "code"], "$serviceResult");
    if (result.code !== "goal-unavailable") {
      throw new TypeError("$serviceResult.code must equal goal-unavailable");
    }
    return { status: "unavailable", code: "goal-unavailable" };
  }
  if (result.status === "ready") {
    assertExactKeys(result, ["status", "response"], "$serviceResult");
    return {
      status: "ready",
      response: validateDailyPlanPreviewResponseV1(result.response),
    };
  }
  throw new TypeError("$serviceResult.status is unsupported");
}

function assertMaterializationAgreesWithPlan(
  plan: DailyPlanPreviewV1,
  materialized: MaterializedWorksheetInstanceV1,
): void {
  const instance = materialized.instance;
  const activity = plan.activities[0];
  const hasMatchingSlots =
    instance.slots.length === activity.itemCount &&
    instance.slots.every(
      (slot) =>
        slot.expectedMinutes === 2 &&
        slot.skillIds.length === 1 &&
        slot.skillIds[0] === activity.skillId &&
        slot.selectionReasons.length === 1 &&
        slot.selectionReasons[0] === activity.selectionReasons[0] &&
        slot.provenance.contentId === activity.contentId &&
        slot.provenance.contentRevision === activity.contentRevision &&
        slot.provenance.generatorId === activity.generatorId &&
        slot.provenance.generatorVersion === activity.generatorVersion,
    );
  const content = instance.content[0];
  if (
    instance.assignmentId !== plan.id ||
    instance.localStudyDate !== plan.localStudyDate ||
    instance.timeZone !== plan.timeZone ||
    instance.locale !== plan.locale ||
    instance.expectedMinutes !== plan.plannedPracticeMinutes ||
    instance.plan.id !== plan.id ||
    instance.plan.version !== 1 ||
    instance.policy.id !== plan.policy.id ||
    instance.policy.version !== plan.policy.version ||
    instance.skillGraph.id !== plan.skillGraph.id ||
    instance.skillGraph.revision !== plan.skillGraph.revision ||
    instance.rng.baseSeed !== plan.generation.baseSeed ||
    instance.rng.seedSecretVersion !== plan.generation.seedVersion ||
    instance.content.length !== 1 ||
    content?.id !== activity.contentId ||
    content?.revision !== activity.contentRevision ||
    !hasMatchingSlots
  ) {
    throw new Error("Materialized worksheet does not agree with its preview plan");
  }
}

function exactRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new TypeError(`${path} has unsupported fields`);
  }
}
