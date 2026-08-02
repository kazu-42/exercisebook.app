import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import {
  FractionAdditionV2MaterializationError,
  PresentationResolutionError,
  materializeFractionAdditionWorksheetFromContentV2,
  type FractionAdditionV2MaterializationErrorCode,
  type PresentationResolutionErrorCode,
} from "@exercisebook/generators";
import {
  DAY_ONE_PREVIEW_REGISTRY_V2,
  planDailyPreviewV2,
  validateDailyPlanPreviewRequestV2,
  validateDailyPlanPreviewRegistryV2,
  validateDailyPlanPreviewResultV2,
  validateDailyPlanPreviewV2,
  type DailyPlanPreviewRegistryV2,
  type DailyPlanPreviewRequestV2,
  type DailyPlanPreviewResultV2,
  type DailyPlanPreviewV2,
} from "@exercisebook/planner";
import {
  assertSafeDataObjectGraph,
  validateContentDocumentV2,
  validateWorksheetInstanceV2,
  type ContentDocumentV2,
  type MaterializedWorksheetInstanceV2,
} from "@exercisebook/schemas";

import {
  DAILY_PLAN_PREVIEW_RESPONSE_V2_SCHEMA,
  validateDailyPlanPreviewResponseV2,
  type DailyPlanPreviewResponseV2,
} from "../shared/daily-plan-preview-contract-v2.js";
import { SAMPLE_CONTENT_DOCUMENT_V2 } from "./sample-content-v2.js";
import {
  assertStudentWebWorksheetV2DoesNotRevealPracticeAnswers,
  projectStudentWorksheetForWebV2,
} from "./web-worksheet-projector-v2.js";

export type DailyPlanPreviewServiceResultV2 =
  | Readonly<{
      status: "ready";
      response: DailyPlanPreviewResponseV2;
    }>
  | Readonly<{
      status: "unavailable";
      code: "goal-unavailable";
    }>;

export interface DailyPlanPreviewServiceV2 {
  createPreview(
    request: DailyPlanPreviewRequestV2,
  ): Promise<DailyPlanPreviewServiceResultV2>;
}

type PlanPreviewV2 = typeof planDailyPreviewV2;
type MaterializePreviewV2 = typeof materializeFractionAdditionWorksheetFromContentV2;
type ProjectStudentWorksheetV2 = typeof projectStudentWorksheetForWebV2;

type ReviewedPresentationUnavailableCode =
  | "content-identity-mismatch"
  | "invalid-selection"
  | "selected-node-count"
  | "selected-node-type"
  | "exercise-contract-mismatch"
  | "worked-example-arithmetic-mismatch"
  | "excluded-answer-tuple-mismatch"
  | "presentation-invalid";

type ReviewedMaterializationUnavailableCode =
  "unsupported-content-state" | "locale-mismatch" | "generation-exhausted";

type MaterializerUnavailableReason =
  | Readonly<{
      kind: "presentation-resolution";
      code: ReviewedPresentationUnavailableCode;
    }>
  | Readonly<{
      kind: "materialization";
      code: ReviewedMaterializationUnavailableCode;
    }>;

type MaterializerInvocationResult =
  | Readonly<{
      status: "ready";
      materialization: MaterializedWorksheetInstanceV2;
    }>
  | Readonly<{
      status: "unavailable";
      reason: MaterializerUnavailableReason;
    }>;

export interface DailyPlanPreviewServiceV2Dependencies {
  readonly registry?: DailyPlanPreviewRegistryV2;
  readonly contentDocument?: ContentDocumentV2;
  readonly planPreview?: PlanPreviewV2;
  readonly materializePreview?: MaterializePreviewV2;
  readonly projectStudentWorksheet?: ProjectStudentWorksheetV2;
}

/**
 * Compose the V2 preview use case from one version-pinned registry, content
 * revision, planner, materializer, and trusted student Web projector. Typed
 * reviewed-configuration failures become the narrow unavailable result; all
 * other defects remain exceptions for the HTTP adapter to sanitize as 500.
 */
export function createDailyPlanPreviewServiceV2(
  dependencies: DailyPlanPreviewServiceV2Dependencies = {},
): DailyPlanPreviewServiceV2 {
  const registry = validateDailyPlanPreviewRegistryV2(
    dependencies.registry ?? DAY_ONE_PREVIEW_REGISTRY_V2,
  );
  const contentDocument = validateContentDocumentV2(
    dependencies.contentDocument ?? SAMPLE_CONTENT_DOCUMENT_V2,
  );
  const planPreview = dependencies.planPreview ?? planDailyPreviewV2;
  const materializePreview =
    dependencies.materializePreview ??
    materializeFractionAdditionWorksheetFromContentV2;
  const projectStudentWorksheet =
    dependencies.projectStudentWorksheet ?? projectStudentWorksheetForWebV2;

  return {
    async createPreview(request) {
      const stableRequest = validateDailyPlanPreviewRequestV2(request);
      const planned = validateDailyPlanPreviewResultV2(
        await planPreview(
          validateDailyPlanPreviewRequestV2(stableRequest),
          validateDailyPlanPreviewRegistryV2(registry),
        ),
      );
      if (planPreview !== planDailyPreviewV2) {
        await assertPlannerResultAgreesWithOriginalRequest(
          stableRequest,
          registry,
          planned,
        );
      }
      if (planned.status === "unavailable") {
        return { status: "unavailable", code: planned.code };
      }

      const plan = planned.plan;
      const materialized = await invokeMaterializer(
        materializePreview,
        contentDocument,
        plan,
      );
      const trustedMaterialized =
        materializePreview === materializeFractionAdditionWorksheetFromContentV2
          ? undefined
          : await invokeMaterializer(
              materializeFractionAdditionWorksheetFromContentV2,
              contentDocument,
              plan,
            );
      if (trustedMaterialized !== undefined) {
        assertMaterializerOutcomeMatchesTrustedReplay(
          materialized,
          trustedMaterialized,
        );
      }
      if (materialized.status === "unavailable") {
        return { status: "unavailable", code: "goal-unavailable" };
      }
      const verifiedMaterialization = await verifyMaterialization(
        materialized.materialization,
      );
      assertMaterializationAgreesWithPlan(plan, verifiedMaterialization);

      if (trustedMaterialized !== undefined) {
        if (trustedMaterialized.status !== "ready") {
          throw new Error(
            "Injected materializer outcome does not match the trusted materializer outcome",
          );
        }
        const verifiedExpected = await verifyMaterialization(
          trustedMaterialized.materialization,
        );
        assertMaterializationMatchesTrustedReplay(
          verifiedMaterialization,
          verifiedExpected,
        );
      }

      const expectedInstanceHash = verifiedMaterialization.instanceHash;
      const canonicalAnswers = verifiedMaterialization.instance.slots.map((slot) =>
        Object.freeze({ ...slot.canonicalAnswer.value }),
      );
      const worksheet = await projectStudentWorksheet(
        detachVerifiedMaterialization(verifiedMaterialization),
      );
      const trustedWorksheet =
        projectStudentWorksheet === projectStudentWorksheetForWebV2
          ? undefined
          : await projectStudentWorksheetForWebV2(
              detachVerifiedMaterialization(verifiedMaterialization),
            );
      const activity = plan.activities[0];
      const response = validateDailyPlanPreviewResponseV2({
        schema: DAILY_PLAN_PREVIEW_RESPONSE_V2_SCHEMA,
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
      assertStudentWebWorksheetV2DoesNotRevealPracticeAnswers(
        response.worksheet,
        canonicalAnswers,
      );
      if (
        trustedWorksheet !== undefined &&
        canonicalizeJson(response.worksheet) !== canonicalizeJson(trustedWorksheet)
      ) {
        throw new Error(
          "Injected Web worksheet does not match the trusted student projection",
        );
      }
      return { status: "ready", response };
    },
  };
}

export const dailyPlanPreviewServiceV2 = createDailyPlanPreviewServiceV2();

export function validateDailyPlanPreviewServiceResultV2(
  value: unknown,
): DailyPlanPreviewServiceResultV2 {
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
      response: validateDailyPlanPreviewResponseV2(result.response),
    };
  }
  throw new TypeError("$serviceResult.status is unsupported");
}

async function verifyMaterialization(
  materialized: MaterializedWorksheetInstanceV2,
): Promise<MaterializedWorksheetInstanceV2> {
  assertSafeDataObjectGraph(materialized);
  const providedCanonicalJson = materialized.canonicalJson;
  const providedInstanceHash = materialized.instanceHash;
  const instance = validateWorksheetInstanceV2(materialized.instance);
  const canonicalJson = canonicalizeJson(instance);
  if (canonicalJson !== providedCanonicalJson) {
    throw new Error("Worksheet canonical JSON does not match the validated instance");
  }
  const instanceHash = await sha256Hex(canonicalJson);
  if (instanceHash !== providedInstanceHash) {
    throw new Error("Worksheet instance hash does not match its canonical JSON");
  }
  return { instance, canonicalJson, instanceHash };
}

async function assertPlannerResultAgreesWithOriginalRequest(
  request: DailyPlanPreviewRequestV2,
  registry: DailyPlanPreviewRegistryV2,
  actual: DailyPlanPreviewResultV2,
): Promise<void> {
  const expected = validateDailyPlanPreviewResultV2(
    await planDailyPreviewV2(
      validateDailyPlanPreviewRequestV2(request),
      validateDailyPlanPreviewRegistryV2(registry),
    ),
  );
  if (canonicalizeJson(actual) !== canonicalizeJson(expected)) {
    throw new Error(
      "Injected preview plan does not agree with the original preview request",
    );
  }
}

async function invokeMaterializer(
  materialize: MaterializePreviewV2,
  contentDocument: ContentDocumentV2,
  plan: DailyPlanPreviewV2,
): Promise<MaterializerInvocationResult> {
  try {
    return {
      status: "ready",
      materialization: await materialize(
        validateContentDocumentV2(contentDocument),
        validateDailyPlanPreviewV2(plan),
      ),
    };
  } catch (error) {
    if (error instanceof PresentationResolutionError) {
      const reason = classifyPresentationUnavailable(error.code);
      if (reason !== undefined) {
        return { status: "unavailable", reason };
      }
    }
    if (error instanceof FractionAdditionV2MaterializationError) {
      const reason = classifyMaterializationUnavailable(error.code);
      if (reason !== undefined) {
        return { status: "unavailable", reason };
      }
    }
    throw error;
  }
}

function classifyPresentationUnavailable(
  code: PresentationResolutionErrorCode,
): MaterializerUnavailableReason | undefined {
  switch (code) {
    case "content-identity-mismatch":
    case "invalid-selection":
    case "selected-node-count":
    case "selected-node-type":
    case "exercise-contract-mismatch":
    case "worked-example-arithmetic-mismatch":
    case "excluded-answer-tuple-mismatch":
    case "presentation-invalid":
      return { kind: "presentation-resolution", code };
    case "unsafe-input":
    case "invalid-content":
      return undefined;
    default:
      return preserveUnknownErrorCode(code);
  }
}

function classifyMaterializationUnavailable(
  code: FractionAdditionV2MaterializationErrorCode,
): MaterializerUnavailableReason | undefined {
  switch (code) {
    case "unsupported-content-state":
    case "locale-mismatch":
    case "generation-exhausted":
      return { kind: "materialization", code };
    case "unsafe-input":
    case "invalid-assignment":
    case "invalid-instance":
      return undefined;
    default:
      return preserveUnknownErrorCode(code);
  }
}

function preserveUnknownErrorCode(_code: never): undefined {
  return undefined;
}

function assertMaterializerOutcomeMatchesTrustedReplay(
  actual: MaterializerInvocationResult,
  expected: MaterializerInvocationResult,
): void {
  if (actual.status === "ready" && expected.status === "ready") {
    return;
  }
  if (
    actual.status === "unavailable" &&
    expected.status === "unavailable" &&
    actual.reason.kind === expected.reason.kind &&
    actual.reason.code === expected.reason.code
  ) {
    return;
  }
  throw new Error(
    "Injected materializer outcome does not match the trusted materializer outcome",
  );
}

function assertMaterializationMatchesTrustedReplay(
  actual: MaterializedWorksheetInstanceV2,
  expected: MaterializedWorksheetInstanceV2,
): void {
  if (
    actual.canonicalJson !== expected.canonicalJson ||
    actual.instanceHash !== expected.instanceHash
  ) {
    throw new Error("Injected worksheet does not match the trusted materialization");
  }
}

function detachVerifiedMaterialization(
  materialized: MaterializedWorksheetInstanceV2,
): MaterializedWorksheetInstanceV2 {
  return {
    instance: validateWorksheetInstanceV2(materialized.instance),
    canonicalJson: materialized.canonicalJson,
    instanceHash: materialized.instanceHash,
  };
}

function assertMaterializationAgreesWithPlan(
  plan: DailyPlanPreviewV2,
  materialized: MaterializedWorksheetInstanceV2,
): void {
  const instance = materialized.instance;
  const activity = plan.activities[0];
  const content = instance.content[0];
  const presentationContent = instance.presentation.content;
  const selection = activity.presentationSelection;
  const workedExample = instance.presentation.workedExample.model;
  const hasMatchingExampleTuple =
    sameRational(workedExample.left, selection.excludedCanonicalAnswers[0]) &&
    sameRational(workedExample.right, selection.excludedCanonicalAnswers[1]) &&
    sameRational(workedExample.result, selection.excludedCanonicalAnswers[2]);
  const hasMatchingSlots =
    instance.slots.length === activity.itemCount &&
    instance.slots.every(
      (slot) =>
        slot.expectedMinutes === 2 &&
        slot.skillIds.length === 1 &&
        slot.skillIds[0] === activity.skillId &&
        sameStringArray(slot.selectionReasons, activity.selectionReasons) &&
        slot.provenance.contentId === activity.content.id &&
        slot.provenance.contentRevision === activity.content.revision &&
        slot.provenance.sourceHash === activity.content.sourceHash &&
        slot.provenance.contentHash === activity.content.contentHash &&
        slot.provenance.compilerVersion === activity.content.compilerVersion &&
        slot.provenance.generatorId === activity.generatorId &&
        slot.provenance.generatorVersion === activity.generatorVersion,
    );

  if (
    instance.assignmentId !== plan.id ||
    instance.localStudyDate !== plan.localStudyDate ||
    instance.timeZone !== plan.timeZone ||
    instance.locale !== plan.locale ||
    instance.expectedMinutes !== plan.plannedPracticeMinutes ||
    instance.plan.id !== plan.id ||
    instance.plan.version !== 2 ||
    instance.policy.id !== plan.policy.id ||
    instance.policy.version !== plan.policy.version ||
    instance.skillGraph.id !== plan.skillGraph.id ||
    instance.skillGraph.revision !== plan.skillGraph.revision ||
    instance.rng.baseSeed !== plan.generation.baseSeed ||
    instance.rng.seedSecretVersion !== plan.generation.seedVersion ||
    instance.content.length !== 1 ||
    !sameContentIdentity(content, activity.content) ||
    !sameContentIdentity(presentationContent, activity.content) ||
    instance.presentation.lesson.nodeId !== selection.explanationNodeId ||
    instance.presentation.workedExample.nodeId !== selection.workedExampleNodeId ||
    instance.presentation.exercise.nodeId !== selection.exerciseNodeId ||
    !hasMatchingExampleTuple ||
    !hasMatchingSlots
  ) {
    throw new Error("Materialized worksheet does not agree with its preview plan");
  }
}

function sameContentIdentity(
  actual:
    | DailyPlanPreviewV2["activities"][number]["content"]
    | MaterializedWorksheetInstanceV2["instance"]["content"][number]
    | MaterializedWorksheetInstanceV2["instance"]["presentation"]["content"]
    | undefined,
  expected: DailyPlanPreviewV2["activities"][number]["content"],
): boolean {
  return (
    actual !== undefined &&
    actual.id === expected.id &&
    actual.revision === expected.revision &&
    actual.sourceHash === expected.sourceHash &&
    actual.contentHash === expected.contentHash &&
    actual.compilerVersion === expected.compilerVersion
  );
}

function sameRational(
  actual: Readonly<{ numerator: string; denominator: string }>,
  expected: Readonly<{ numerator: string; denominator: string }>,
): boolean {
  return (
    actual.numerator === expected.numerator &&
    actual.denominator === expected.denominator
  );
}

function sameStringArray(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
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
