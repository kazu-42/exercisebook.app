import { describe, expect, it, vi } from "vitest";

import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import {
  FractionAdditionV2MaterializationError,
  PresentationResolutionError,
  materializeFractionAdditionWorksheetFromContentV2,
} from "@exercisebook/generators";
import {
  DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2,
  DAY_ONE_PREVIEW_REGISTRY_V2,
  planDailyPreviewV2,
  type DailyPlanPreviewRegistryV2,
  type DailyPlanPreviewRequestV2,
} from "@exercisebook/planner";
import type {
  MaterializedWorksheetInstanceV2,
  WorksheetInstanceV2,
} from "@exercisebook/schemas";

import { MAX_DAILY_PLAN_PREVIEW_RESPONSE_BYTES } from "../shared/public-api-response-limits.js";
import { SAMPLE_CONTENT_DOCUMENT_V2 } from "./sample-content-v2.js";
import { projectStudentWorksheetForWebV2 } from "./web-worksheet-projector-v2.js";
import {
  createDailyPlanPreviewServiceV2,
  validateDailyPlanPreviewServiceResultV2,
} from "./daily-plan-preview-service-v2.js";

function request(
  practiceMinutes: 8 | 12 | 20,
  localStudyDate = "2026-07-21",
): DailyPlanPreviewRequestV2 {
  return {
    schema: "exercisebook.daily-plan-preview-request/v2",
    goalId: "math.fractions.add-unlike",
    practiceMinutes,
    localStudyDate,
    timeZone: "Asia/Tokyo",
    locale: "en",
  };
}

describe("V2 Daily Plan Preview service", () => {
  it.each([
    [8, 4, 8],
    [12, 6, 12],
    [20, 8, 16],
  ] as const)(
    "runs the real %i-minute planner/materializer/Web chain as %i items and %i minutes",
    async (practiceMinutes, itemCount, plannedPracticeMinutes) => {
      const result = await createDailyPlanPreviewServiceV2().createPreview(
        request(practiceMinutes),
      );

      expect(result.status).toBe("ready");
      if (result.status !== "ready") {
        throw new Error("Expected a ready V2 preview");
      }
      expect(result.response).toMatchObject({
        schema: "exercisebook.daily-plan-preview-response/v2",
        plan: {
          requestedPracticeMinutes: practiceMinutes,
          plannedPracticeMinutes,
          itemCount,
          policy: { id: "day-one-fraction-preview", version: 3 },
          saved: false,
        },
        worksheet: {
          schemaVersion: "web-worksheet.v2",
          variant: "student",
          expectedMinutes: plannedPracticeMinutes,
        },
      });
      expect(result.response.worksheet.items).toHaveLength(itemCount);
      expect(result.response.worksheet.assignmentId).toBe(result.response.plan.id);
      expect(result.response.worksheet.presentation.content).toEqual(
        DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2,
      );
    },
  );

  it("is byte-deterministic and preserves shorter-budget problem prefixes", async () => {
    const service = createDailyPlanPreviewServiceV2();
    const eight = await service.createPreview(request(8));
    const eightRepeated = await service.createPreview(request(8));
    const twelve = await service.createPreview(request(12));
    const twenty = await service.createPreview(request(20));
    if (
      eight.status !== "ready" ||
      eightRepeated.status !== "ready" ||
      twelve.status !== "ready" ||
      twenty.status !== "ready"
    ) {
      throw new Error("Expected ready V2 previews");
    }

    expect(JSON.stringify(eightRepeated.response)).toBe(JSON.stringify(eight.response));
    const prompts = (result: typeof eight) =>
      result.response.worksheet.items.map((item) => item.prompt);
    expect(prompts(twelve).slice(0, 4)).toEqual(prompts(eight));
    expect(prompts(twenty).slice(0, 4)).toEqual(prompts(eight));
    expect(prompts(twenty).slice(0, 6)).toEqual(prompts(twelve));
    expect(eight.response.plan.id).not.toBe(twelve.response.plan.id);
  });

  it("keeps answer, seed, solution, and internal selection data out of the result", async () => {
    const result = await createDailyPlanPreviewServiceV2().createPreview(request(20));
    if (result.status !== "ready") {
      throw new Error("Expected a ready V2 preview");
    }
    const serialized = JSON.stringify(result.response);

    for (const protectedName of [
      "answer",
      "canonicalAnswer",
      "accepted",
      "scoringRule",
      "misconceptions",
      "solutionTrace",
      "baseSeed",
      "slotSeed",
      "seedSecretVersion",
      "generation",
      "activities",
      "presentationSelection",
      "excludedCanonicalAnswers",
    ]) {
      expect(serialized).not.toContain(`\"${protectedName}\"`);
    }
  });

  it("returns unavailable before materialization when the V2 kill switch is disabled", async () => {
    const registry: DailyPlanPreviewRegistryV2 = {
      ...DAY_ONE_PREVIEW_REGISTRY_V2,
      policy: { ...DAY_ONE_PREVIEW_REGISTRY_V2.policy, enabled: false },
    };
    const materializePreview = vi.fn(materializeFractionAdditionWorksheetFromContentV2);
    const service = createDailyPlanPreviewServiceV2({
      registry,
      materializePreview,
    });

    await expect(service.createPreview(request(8))).resolves.toEqual({
      status: "unavailable",
      code: "goal-unavailable",
    });
    expect(materializePreview).not.toHaveBeenCalled();
  });

  it("maps a trusted reviewed-content resolution failure to unavailable", async () => {
    const contentDocument = {
      ...SAMPLE_CONTENT_DOCUMENT_V2,
      title: "A valid but unpinned content revision",
    };
    const service = createDailyPlanPreviewServiceV2({ contentDocument });

    await expect(service.createPreview(request(8))).resolves.toEqual({
      status: "unavailable",
      code: "goal-unavailable",
    });
  });

  it("authenticates an injected unavailable result against the exact trusted reason", async () => {
    const contentDocument = {
      ...SAMPLE_CONTENT_DOCUMENT_V2,
      title: "A valid but unpinned content revision",
    };
    const service = createDailyPlanPreviewServiceV2({
      contentDocument,
      async materializePreview() {
        throw new PresentationResolutionError("content-identity-mismatch");
      },
    });

    await expect(service.createPreview(request(8))).resolves.toEqual({
      status: "unavailable",
      code: "goal-unavailable",
    });
  });

  it("rejects an injected unavailable claim with a different trusted reason", async () => {
    const contentDocument = {
      ...SAMPLE_CONTENT_DOCUMENT_V2,
      title: "A valid but unpinned content revision",
    };
    const service = createDailyPlanPreviewServiceV2({
      contentDocument,
      async materializePreview() {
        throw new PresentationResolutionError("selected-node-count");
      },
    });

    await expect(service.createPreview(request(8))).rejects.toThrow(
      /does not match the trusted materializer outcome/u,
    );
  });

  it("rejects an injected unavailable claim when the trusted materializer is ready", async () => {
    const service = createDailyPlanPreviewServiceV2({
      async materializePreview() {
        throw new PresentationResolutionError("selected-node-count");
      },
    });

    await expect(service.createPreview(request(8))).rejects.toThrow(
      /does not match the trusted materializer outcome/u,
    );
  });

  it.each([
    ["presentation unsafe input", new PresentationResolutionError("unsafe-input")],
    ["invalid content", new PresentationResolutionError("invalid-content")],
    [
      "materializer unsafe input",
      new FractionAdditionV2MaterializationError("unsafe-input"),
    ],
    [
      "invalid assignment",
      new FractionAdditionV2MaterializationError("invalid-assignment"),
    ],
    [
      "invalid instance",
      new FractionAdditionV2MaterializationError("invalid-instance"),
    ],
  ] as const)("does not downgrade the %s defect code", async (_name, failure) => {
    const service = createDailyPlanPreviewServiceV2({
      async materializePreview() {
        throw failure;
      },
    });

    await expect(service.createPreview(request(8))).rejects.toBe(failure);
  });

  it("does not map a forged typed-error shape", async () => {
    const forged = {
      name: "PresentationResolutionError",
      code: "selected-node-count",
    };
    const service = createDailyPlanPreviewServiceV2({
      async materializePreview() {
        throw forged;
      },
    });

    await expect(service.createPreview(request(8))).rejects.toBe(forged);
  });

  it.each([
    [
      "planner",
      () => {
        const failure = new PresentationResolutionError("selected-node-count");
        return {
          failure,
          dependencies: {
            async planPreview() {
              throw failure;
            },
          },
        };
      },
    ],
    [
      "projector",
      () => {
        const failure = new FractionAdditionV2MaterializationError("invalid-instance");
        return {
          failure,
          dependencies: {
            async projectStudentWorksheet() {
              throw failure;
            },
          },
        };
      },
    ],
  ] as const)(
    "does not map a real typed error from the injected %s stage",
    async (_stage, setup) => {
      const { failure, dependencies } = setup();
      const service = createDailyPlanPreviewServiceV2(dependencies);

      await expect(service.createPreview(request(8))).rejects.toBe(failure);
    },
  );

  it("preserves an unexpected dependency failure", async () => {
    const failure = new Error("unexpected projector failure");
    const service = createDailyPlanPreviewServiceV2({
      async projectStudentWorksheet() {
        throw failure;
      },
    });

    await expect(service.createPreview(request(8))).rejects.toBe(failure);
  });

  it("rejects an invalid injected planner result instead of guessing a status", async () => {
    const service = createDailyPlanPreviewServiceV2({
      async planPreview() {
        return {
          status: "unavailable",
          code: "content-unavailable",
        } as never;
      },
    });

    await expect(service.createPreview(request(8))).rejects.toThrow();
  });

  it("rejects a schema-valid ready plan for a different original request", async () => {
    const service = createDailyPlanPreviewServiceV2({
      async planPreview(_request, registry) {
        return planDailyPreviewV2(request(12), registry);
      },
    });

    await expect(service.createPreview(request(8))).rejects.toThrow(
      "does not agree with the original preview request",
    );
  });

  it("rejects a schema-valid injected unavailable result when the trusted planner is ready", async () => {
    const service = createDailyPlanPreviewServiceV2({
      async planPreview() {
        return { status: "unavailable", code: "goal-unavailable" };
      },
    });

    await expect(service.createPreview(request(8))).rejects.toThrow(
      "does not agree with the original preview request",
    );
  });

  it("rejects a schema-valid rehashed materialization with reordered valid problems", async () => {
    const service = createDailyPlanPreviewServiceV2({
      async materializePreview(document, plan) {
        const materialized = await materializeFractionAdditionWorksheetFromContentV2(
          document,
          plan,
        );
        return mutateAndRehash(materialized, (instance) => {
          instance.slots.reverse();
        });
      },
    });

    await expect(service.createPreview(request(8))).rejects.toThrow(
      "does not match the trusted materialization",
    );
  });

  it.each([
    [
      "canonical JSON",
      (materialized: MaterializedWorksheetInstanceV2) => ({
        ...materialized,
        canonicalJson: `${materialized.canonicalJson} `,
      }),
      "canonical JSON",
    ],
    [
      "instance hash",
      (materialized: MaterializedWorksheetInstanceV2) => ({
        ...materialized,
        instanceHash: "0".repeat(64),
      }),
      "instance hash",
    ],
  ] as const)(
    "rejects a materializer result with mismatched %s",
    async (_name, mutate, expectedMessage) => {
      const service = createDailyPlanPreviewServiceV2({
        async materializePreview(document, plan) {
          return mutate(
            await materializeFractionAdditionWorksheetFromContentV2(document, plan),
          );
        },
      });

      await expect(service.createPreview(request(8))).rejects.toThrow(expectedMessage);
    },
  );

  it.each([
    [
      "assignment identity",
      (instance: MutableWorksheetInstanceV2) => {
        instance.assignmentId = `preview-${"c".repeat(64)}`;
        instance.plan.id = instance.assignmentId;
      },
    ],
    [
      "policy",
      (instance: MutableWorksheetInstanceV2) => {
        instance.policy.version = 4;
      },
    ],
    [
      "base seed",
      (instance: MutableWorksheetInstanceV2) => {
        instance.rng.baseSeed = "d".repeat(64);
      },
    ],
    [
      "content identity",
      (instance: MutableWorksheetInstanceV2) => {
        const contentHash = "e".repeat(64);
        instance.content[0]!.contentHash = contentHash;
        instance.presentation.content.contentHash = contentHash;
        for (const slot of instance.slots) {
          slot.provenance.contentHash = contentHash;
        }
      },
    ],
    [
      "ordered worked-example tuple",
      (instance: MutableWorksheetInstanceV2) => {
        const model = instance.presentation.workedExample.model;
        const left = model.left;
        model.left = model.right;
        model.right = left;
        const leftScaledNumerator = model.leftScaledNumerator;
        model.leftScaledNumerator = model.rightScaledNumerator;
        model.rightScaledNumerator = leftScaledNumerator;
      },
    ],
    [
      "selection reason",
      (instance: MutableWorksheetInstanceV2) => {
        for (const slot of instance.slots) {
          slot.selectionReasons = ["due-review"];
        }
      },
    ],
    [
      "slot count",
      (instance: MutableWorksheetInstanceV2) => {
        instance.slots.pop();
        instance.expectedMinutes -= 2;
      },
    ],
  ] as const)("fails closed for a schema-valid %s mismatch", async (_name, mutate) => {
    const service = createDailyPlanPreviewServiceV2({
      async materializePreview(document, plan) {
        const materialized = await materializeFractionAdditionWorksheetFromContentV2(
          document,
          plan,
        );
        return mutateAndRehash(materialized, mutate);
      },
    });

    await expect(service.createPreview(request(8))).rejects.toThrow(
      "does not agree with its preview plan",
    );
  });

  it.each([
    [
      "title",
      (instance: MutableWorksheetInstanceV2) => {
        instance.title = "A different schema-valid title";
      },
    ],
    [
      "presentation",
      (instance: MutableWorksheetInstanceV2) => {
        instance.presentation.lesson.title = "A different schema-valid lesson title";
      },
    ],
    [
      "attribution",
      (instance: MutableWorksheetInstanceV2) => {
        instance.attributions[0]!.attributionText =
          "A different schema-valid attribution.";
      },
    ],
  ] as const)(
    "rejects a schema-valid rehashed materialization with mutated content-derived %s",
    async (_name, mutate) => {
      const service = createDailyPlanPreviewServiceV2({
        async materializePreview(document, plan) {
          const materialized = await materializeFractionAdditionWorksheetFromContentV2(
            document,
            plan,
          );
          return mutateAndRehash(materialized, mutate);
        },
      });

      await expect(service.createPreview(request(8))).rejects.toThrow(
        "does not match the trusted materialization",
      );
    },
  );

  it("does not expose the caller request to an injected planner", async () => {
    const originalRequest = request(8);
    const service = createDailyPlanPreviewServiceV2({
      async planPreview(candidateRequest, registry) {
        const planned = await planDailyPreviewV2(candidateRequest, registry);
        (candidateRequest as Mutable<DailyPlanPreviewRequestV2>).localStudyDate =
          "2026-07-22";
        return planned;
      },
    });

    await expect(service.createPreview(originalRequest)).resolves.toMatchObject({
      status: "ready",
    });
    expect(originalRequest.localStudyDate).toBe("2026-07-21");
  });

  it("keeps the validated registry private across injected planner calls", async () => {
    const service = createDailyPlanPreviewServiceV2({
      async planPreview(candidateRequest, candidateRegistry) {
        const planned = await planDailyPreviewV2(candidateRequest, candidateRegistry);
        (candidateRegistry as Mutable<DailyPlanPreviewRegistryV2>).policy.enabled =
          false;
        return planned;
      },
    });

    await expect(service.createPreview(request(8))).resolves.toMatchObject({
      status: "ready",
    });
    await expect(service.createPreview(request(8))).resolves.toMatchObject({
      status: "ready",
    });
  });

  it("isolates the validated registry across concurrent injected planner calls", async () => {
    const firstMutation = deferred();
    const releaseFirst = deferred();
    let invocation = 0;
    const service = createDailyPlanPreviewServiceV2({
      async planPreview(candidateRequest, candidateRegistry) {
        invocation += 1;
        const currentInvocation = invocation;
        const planned = await planDailyPreviewV2(candidateRequest, candidateRegistry);
        if (currentInvocation === 1) {
          (candidateRegistry as Mutable<DailyPlanPreviewRegistryV2>).policy.enabled =
            false;
          firstMutation.resolve();
          await releaseFirst.promise;
        }
        return planned;
      },
    });

    const first = service.createPreview(request(8));
    await firstMutation.promise;
    const second = service.createPreview(request(8));
    releaseFirst.resolve();

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: "ready" }),
      expect.objectContaining({ status: "ready" }),
    ]);
  });

  it("keeps the validated content private across injected materializer calls", async () => {
    const service = createDailyPlanPreviewServiceV2({
      async materializePreview(document, plan) {
        const materialized = await materializeFractionAdditionWorksheetFromContentV2(
          document,
          plan,
        );
        document.title = "A callback-owned mutation";
        return materialized;
      },
    });

    await expect(service.createPreview(request(8))).resolves.toMatchObject({
      status: "ready",
    });
    await expect(service.createPreview(request(8))).resolves.toMatchObject({
      status: "ready",
    });
  });

  it("keeps the validated plan private from an injected materializer", async () => {
    const service = createDailyPlanPreviewServiceV2({
      async materializePreview(document, plan) {
        const materialized = await materializeFractionAdditionWorksheetFromContentV2(
          document,
          plan,
        );
        (plan as unknown as Mutable<typeof plan>).localStudyDate = "2026-07-22";
        return materialized;
      },
    });

    const result = await service.createPreview(request(8));
    expect(result).toMatchObject({
      status: "ready",
      response: {
        plan: { requestedPracticeMinutes: 8 },
        worksheet: { studyDate: "2026-07-21" },
      },
    });
  });

  it("compares the public worksheet with the pre-projection materialization hash", async () => {
    const service = createDailyPlanPreviewServiceV2({
      async projectStudentWorksheet(materialized) {
        const worksheet = await projectStudentWorksheetForWebV2(materialized);
        return { ...worksheet, instanceHash: "f".repeat(64) };
      },
    });

    await expect(service.createPreview(request(8))).rejects.toThrow(
      "Public worksheet hash differs from materialized instance",
    );
  });

  it("rejects a schema-valid injected Web projection that differs from the trusted projection", async () => {
    const service = createDailyPlanPreviewServiceV2({
      async projectStudentWorksheet(materialized) {
        const worksheet = await projectStudentWorksheetForWebV2(materialized);
        return {
          ...worksheet,
          title: "A different schema-valid projected title",
        };
      },
    });

    await expect(service.createPreview(request(8))).rejects.toThrow(
      "does not match the trusted student projection",
    );
  });

  it("rejects an invalid injected Web response instead of mapping it unavailable", async () => {
    const service = createDailyPlanPreviewServiceV2({
      async projectStudentWorksheet(materialized) {
        const worksheet = structuredClone(
          await projectStudentWorksheetForWebV2(materialized),
        ) as unknown as Record<string, unknown>;
        worksheet.baseSeed = "0".repeat(64);
        return worksheet as never;
      },
    });

    await expect(service.createPreview(request(8))).rejects.toThrow();
  });

  it("rechecks canonical-answer privacy after an injected Web projector", async () => {
    const service = createDailyPlanPreviewServiceV2({
      async projectStudentWorksheet(materialized) {
        const worksheet = await projectStudentWorksheetForWebV2(materialized);
        const answer = materialized.instance.slots[0]!.canonicalAnswer.value;
        return {
          ...worksheet,
          items: worksheet.items.map((item, index) =>
            index === 0
              ? {
                  ...item,
                  responseLabel: `Leaked ${answer.numerator}/${answer.denominator}`,
                }
              : item,
          ),
        };
      },
    });

    await expect(service.createPreview(request(8))).rejects.toThrow(
      /canonical-answer/u,
    );
  });

  it("snapshots the explicit registry instead of depending on later mutation", async () => {
    const registry = structuredClone(DAY_ONE_PREVIEW_REGISTRY_V2);
    const service = createDailyPlanPreviewServiceV2({ registry });
    registry.policy.enabled = false;

    await expect(service.createPreview(request(8))).resolves.toMatchObject({
      status: "ready",
    });
  });

  it("keeps the longest reviewed V2 previews below half the response budget", async () => {
    const service = createDailyPlanPreviewServiceV2();
    let maximumResponseBytes = 0;

    for (let dayOffset = 0; dayOffset < 365; dayOffset += 1) {
      const localStudyDate = new Date(Date.UTC(2026, 0, dayOffset + 1))
        .toISOString()
        .slice(0, 10);
      const result = await service.createPreview(request(20, localStudyDate));
      if (result.status !== "ready") {
        throw new Error(`Expected a ready V2 preview for ${localStudyDate}`);
      }
      maximumResponseBytes = Math.max(
        maximumResponseBytes,
        new TextEncoder().encode(JSON.stringify(result.response)).byteLength,
      );
    }

    expect(maximumResponseBytes * 2).toBeLessThanOrEqual(
      MAX_DAILY_PLAN_PREVIEW_RESPONSE_BYTES,
    );
  }, 60_000);

  it("strictly validates service results and rejects malformed injected output", async () => {
    const ready = await createDailyPlanPreviewServiceV2().createPreview(request(8));
    if (ready.status !== "ready") {
      throw new Error("Expected a ready V2 preview");
    }
    expect(validateDailyPlanPreviewServiceResultV2(ready)).toEqual(ready);
    expect(
      validateDailyPlanPreviewServiceResultV2({
        status: "unavailable",
        code: "goal-unavailable",
      }),
    ).toEqual({ status: "unavailable", code: "goal-unavailable" });

    const malformedValues: unknown[] = [
      { status: "unavailable", code: "content-unavailable" },
      { status: "unavailable", code: "goal-unavailable", detail: "secret" },
      { status: "ready", response: { ...ready.response, extra: true } },
      { status: "ready", response: { ...ready.response, schema: "wrong" } },
      { status: "unknown" },
    ];
    for (const malformed of malformedValues) {
      expect(() => validateDailyPlanPreviewServiceResultV2(malformed)).toThrow();
    }
  });

  it("rejects an unsafe service result before invoking an accessor", () => {
    let getterRan = false;
    const value: Record<string, unknown> = { status: "ready" };
    Object.defineProperty(value, "response", {
      enumerable: true,
      get() {
        getterRan = true;
        return {};
      },
    });

    expect(() => validateDailyPlanPreviewServiceResultV2(value)).toThrow("Accessor");
    expect(getterRan).toBe(false);
  });
});

async function mutateAndRehash(
  materialized: MaterializedWorksheetInstanceV2,
  mutate: (instance: MutableWorksheetInstanceV2) => void,
): Promise<MaterializedWorksheetInstanceV2> {
  const instance = structuredClone(materialized.instance) as MutableWorksheetInstanceV2;
  mutate(instance);
  const canonicalJson = canonicalizeJson(instance);
  return {
    instance: instance as WorksheetInstanceV2,
    canonicalJson,
    instanceHash: await sha256Hex(canonicalJson),
  };
}

type MutableWorksheetInstanceV2 = {
  -readonly [Key in keyof WorksheetInstanceV2]: Mutable<WorksheetInstanceV2[Key]>;
};

type Mutable<Value> = Value extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: Mutable<Value[Key]> }
    : Value;

function deferred(): Readonly<{
  promise: Promise<void>;
  resolve: () => void;
}> {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
