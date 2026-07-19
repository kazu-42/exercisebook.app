import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import { canonicalizeJson } from "@exercisebook/domain";

import {
  DAILY_PLAN_PREVIEW_REQUEST_V1_SCHEMA,
  DAY_ONE_PREVIEW_REGISTRY,
  planDailyPreviewV1,
  validateDailyPlanPreviewRequestV1,
  type DailyPlanPreviewRequestV1,
} from "./daily-plan-preview.js";
import {
  DAILY_PLAN_PREVIEW_REGISTRY_V2_SCHEMA,
  DAILY_PLAN_PREVIEW_REQUEST_V2_SCHEMA,
  DAILY_PLAN_PREVIEW_V2_SCHEMA,
  DAY_ONE_FRACTION_PRESENTATION_SELECTION_V1,
  DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2,
  DAY_ONE_PREVIEW_REGISTRY_V2,
  DAY_ONE_PREVIEW_V2_CONTENT_FINAL_LOCK,
  PLAN_PREVIEW_REQUEST_IDENTITY_DOMAIN_V2,
  PUBLIC_PLAN_PREVIEW_SEED_DOMAIN_V2,
  PUBLIC_PREVIEW_SEED_VERSION_V2,
  planDailyPreviewV2,
  selectDailyPlanPreviewV2,
  validateDailyPlanPreviewRegistryV2,
  validateDailyPlanPreviewRequestV2,
  validateDailyPlanPreviewResultV2,
  validateDailyPlanPreviewV2,
  type DailyPlanPreviewRegistryV2,
  type DailyPlanPreviewRequestV2,
} from "./daily-plan-preview-v2.js";

const REQUEST: DailyPlanPreviewRequestV2 = {
  schema: DAILY_PLAN_PREVIEW_REQUEST_V2_SCHEMA,
  goalId: "math.fractions.add-unlike",
  practiceMinutes: 12,
  localStudyDate: "2026-07-19",
  timeZone: "Asia/Tokyo",
  locale: "en",
};

const V1_REQUEST: DailyPlanPreviewRequestV1 = {
  ...REQUEST,
  schema: DAILY_PLAN_PREVIEW_REQUEST_V1_SCHEMA,
};

const BUDGET_CASES = [
  [8, 4, 8],
  [12, 6, 12],
  [20, 8, 16],
] as const;

const FINALIZED_FIXTURE_REGISTRY = DAY_ONE_PREVIEW_REGISTRY_V2;

describe("DailyPlanPreviewV2", () => {
  it("enables the exported default policy only with the exact final content lock", async () => {
    expect(DAY_ONE_PREVIEW_V2_CONTENT_FINAL_LOCK).toEqual({
      finalized: true,
      sourceHash: "456c8908debd52c7fcc5eba6e2e9a38434b5fcd8343e7a14a427faae34502523",
      contentHash: "944225a2dda87ae6ee61e53f21a929301f5264793d665ea2200b65fb0f5a71dd",
    });
    expect(DAY_ONE_PREVIEW_REGISTRY_V2.policy.enabled).toBe(true);
    expect(DAY_ONE_PREVIEW_REGISTRY_V2.content.enabled).toBe(true);
    await expect(
      planDailyPreviewV2(REQUEST, DAY_ONE_PREVIEW_REGISTRY_V2),
    ).resolves.toMatchObject({ status: "ready" });
  });

  it.each(BUDGET_CASES)(
    "maps a %i-minute cap to %i reviewed items and %i planned minutes",
    async (practiceMinutes, itemCount, plannedPracticeMinutes) => {
      const result = await planDailyPreviewV2(
        { ...REQUEST, practiceMinutes },
        FINALIZED_FIXTURE_REGISTRY,
      );

      expect(result.status).toBe("ready");
      if (result.status !== "ready") {
        throw new Error("The enabled pinned v2 registry must produce a ready plan");
      }
      expect(validateDailyPlanPreviewV2(result.plan)).toEqual(result.plan);
      expect(validateDailyPlanPreviewResultV2(result)).toEqual(result);
      expect(result.plan).toMatchObject({
        schema: DAILY_PLAN_PREVIEW_V2_SCHEMA,
        requestedPracticeMinutes: practiceMinutes,
        plannedPracticeMinutes,
        evidence: { kind: "none", version: 1 },
        policy: { id: "day-one-fraction-preview", version: 3 },
        skillGraph: { id: "phase-1-math", revision: 1 },
        activities: [
          {
            itemCount,
            expectedMinutes: plannedPracticeMinutes,
            selectionReasons: ["current-frontier"],
            content: DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2,
            generatorId: "fractions.add",
            generatorVersion: "1",
            presentationSelection: DAY_ONE_FRACTION_PRESENTATION_SELECTION_V1,
          },
        ],
        generation: { seedVersion: PUBLIC_PREVIEW_SEED_VERSION_V2 },
      });
      expect(result.plan.plannedPracticeMinutes).toBeLessThanOrEqual(
        result.plan.requestedPracticeMinutes,
      );
      expect(result.plan.id).toMatch(/^preview-[0-9a-f]{64}$/u);
      expect(result.plan.generation.baseSeed).toMatch(/^[0-9a-f]{64}$/u);
    },
  );

  it("is byte-deterministic across repeated calls and property insertion orders", async () => {
    const reorderedRequest = {
      locale: "en",
      timeZone: "Asia/Tokyo",
      localStudyDate: "2026-07-19",
      practiceMinutes: 12,
      goalId: "math.fractions.add-unlike",
      schema: DAILY_PLAN_PREVIEW_REQUEST_V2_SCHEMA,
    } as const;
    const reorderedRegistry = {
      presentationSelection: {
        excludedCanonicalAnswers:
          FINALIZED_FIXTURE_REGISTRY.presentationSelection.excludedCanonicalAnswers.map(
            (value) => ({ ...value }),
          ),
        exerciseNodeId: FINALIZED_FIXTURE_REGISTRY.presentationSelection.exerciseNodeId,
        workedExampleNodeId:
          FINALIZED_FIXTURE_REGISTRY.presentationSelection.workedExampleNodeId,
        explanationNodeId:
          FINALIZED_FIXTURE_REGISTRY.presentationSelection.explanationNodeId,
      },
      generator: { ...FINALIZED_FIXTURE_REGISTRY.generator },
      content: { ...FINALIZED_FIXTURE_REGISTRY.content },
      skillGraph: { ...FINALIZED_FIXTURE_REGISTRY.skillGraph },
      policy: { ...FINALIZED_FIXTURE_REGISTRY.policy },
      schema: FINALIZED_FIXTURE_REGISTRY.schema,
    } as const;

    const first = await planDailyPreviewV2(REQUEST, FINALIZED_FIXTURE_REGISTRY);
    const second = await planDailyPreviewV2(reorderedRequest, reorderedRegistry);

    expect(canonicalizeJson(first)).toBe(canonicalizeJson(second));
  });

  it("plans from detached request and registry snapshots before its first await", async () => {
    const mutableRequest = { ...REQUEST };
    const mutableRegistry = {
      ...FINALIZED_FIXTURE_REGISTRY,
      policy: { ...FINALIZED_FIXTURE_REGISTRY.policy },
      skillGraph: { ...FINALIZED_FIXTURE_REGISTRY.skillGraph },
      content: { ...FINALIZED_FIXTURE_REGISTRY.content },
      generator: { ...FINALIZED_FIXTURE_REGISTRY.generator },
      presentationSelection: {
        ...FINALIZED_FIXTURE_REGISTRY.presentationSelection,
        excludedCanonicalAnswers:
          FINALIZED_FIXTURE_REGISTRY.presentationSelection.excludedCanonicalAnswers.map(
            (value) => ({ ...value }),
          ),
      },
    };
    const pending = planDailyPreviewV2(mutableRequest, mutableRegistry);

    mutableRequest.practiceMinutes = 20;
    mutableRegistry.policy.enabled = false;
    mutableRegistry.content.contentHash = "0".repeat(64);
    mutableRegistry.presentationSelection.excludedCanonicalAnswers.reverse();

    const [result, expected] = await Promise.all([
      pending,
      planDailyPreviewV2(REQUEST, FINALIZED_FIXTURE_REGISTRY),
    ]);
    expect(canonicalizeJson(result)).toBe(canonicalizeJson(expected));
  });

  it("uses v2 identity domains and derives one stable sequence seed across budgets", async () => {
    expect(PUBLIC_PLAN_PREVIEW_SEED_DOMAIN_V2).toBe(
      "exercisebook/public-plan-preview-seed/v2",
    );
    expect(PLAN_PREVIEW_REQUEST_IDENTITY_DOMAIN_V2).toBe(
      "exercisebook/daily-plan-preview-request-identity/v2",
    );

    const results = await Promise.all(
      BUDGET_CASES.map(([practiceMinutes]) =>
        planDailyPreviewV2({ ...REQUEST, practiceMinutes }, FINALIZED_FIXTURE_REGISTRY),
      ),
    );
    const plans = results.map((result) => {
      if (result.status !== "ready") {
        throw new Error("The enabled pinned v2 registry must produce a ready plan");
      }
      return result.plan;
    });

    expect(new Set(plans.map((plan) => plan.generation.baseSeed))).toHaveLength(1);
    expect(new Set(plans.map((plan) => plan.id))).toHaveLength(3);
  });

  it("freezes the final policy-v3 12-minute request and sequence vectors", async () => {
    const result = await planDailyPreviewV2(REQUEST, DAY_ONE_PREVIEW_REGISTRY_V2);
    if (result.status !== "ready") {
      throw new Error("The finalized v2 registry must produce a ready plan");
    }

    expect(result.plan.id).toBe(
      "preview-d8e7bffb76e814cf8fed232ed5817008d9291247f94d4e63bda6fbeb647daf33",
    );
    expect(result.plan.generation.baseSeed).toBe(
      "338bee573add98fce96ae0616b008d002f1bb613bcbb805d6b291ce34bb1671f",
    );
  });

  it("does not consult wall time or ambient randomness", async () => {
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("wall clock must not be read");
    });
    const mathRandom = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("ambient randomness must not be read");
    });
    try {
      const result = await planDailyPreviewV2(REQUEST, FINALIZED_FIXTURE_REGISTRY);
      expect(result.status).toBe("ready");
    } finally {
      dateNow.mockRestore();
      mathRandom.mockRestore();
    }
  });

  it("is independent of ambient time zone, language, and wall-clock value", async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("TZ", "Pacific/Honolulu");
      vi.stubEnv("LANG", "ja_JP.UTF-8");
      vi.setSystemTime(new Date("2001-01-01T00:00:00.000Z"));
      const first = await planDailyPreviewV2(REQUEST, FINALIZED_FIXTURE_REGISTRY);

      vi.stubEnv("TZ", "Europe/Helsinki");
      vi.stubEnv("LANG", "fr_FR.UTF-8");
      vi.setSystemTime(new Date("2042-12-31T23:59:59.999Z"));
      const second = await planDailyPreviewV2(REQUEST, FINALIZED_FIXTURE_REGISTRY);

      expect(canonicalizeJson(first)).toBe(canonicalizeJson(second));
    } finally {
      vi.unstubAllEnvs();
      vi.useRealTimers();
    }
  });

  it.each(["policy", "skillGraph", "content", "generator"] as const)(
    "returns exact goal-unavailable when the required %s revision is disabled",
    async (registryKey) => {
      const registry = {
        ...FINALIZED_FIXTURE_REGISTRY,
        [registryKey]: {
          ...FINALIZED_FIXTURE_REGISTRY[registryKey],
          enabled: false,
        },
      } as DailyPlanPreviewRegistryV2;

      const result = await planDailyPreviewV2(REQUEST, registry);

      expect(result).toEqual({ status: "unavailable", code: "goal-unavailable" });
      expect(Object.keys(result)).toEqual(["status", "code"]);
    },
  );

  it.each([
    [
      "policy id",
      { policy: { ...FINALIZED_FIXTURE_REGISTRY.policy, id: "other-policy" } },
    ],
    [
      "policy version",
      { policy: { ...FINALIZED_FIXTURE_REGISTRY.policy, version: 2 } },
    ],
    [
      "skill graph id",
      {
        skillGraph: {
          ...FINALIZED_FIXTURE_REGISTRY.skillGraph,
          id: "other-graph",
        },
      },
    ],
    [
      "skill graph revision",
      {
        skillGraph: { ...FINALIZED_FIXTURE_REGISTRY.skillGraph, revision: 2 },
      },
    ],
    [
      "content id",
      {
        content: {
          ...FINALIZED_FIXTURE_REGISTRY.content,
          id: "other-content",
        },
      },
    ],
    [
      "content revision",
      { content: { ...FINALIZED_FIXTURE_REGISTRY.content, revision: 3 } },
    ],
    [
      "source hash",
      {
        content: {
          ...FINALIZED_FIXTURE_REGISTRY.content,
          sourceHash: "0".repeat(64),
        },
      },
    ],
    [
      "content hash",
      {
        content: {
          ...FINALIZED_FIXTURE_REGISTRY.content,
          contentHash: "0".repeat(64),
        },
      },
    ],
    [
      "compiler version",
      {
        content: {
          ...FINALIZED_FIXTURE_REGISTRY.content,
          compilerVersion: "exercisebook-content-compiler/3",
        },
      },
    ],
    [
      "reviewed item count",
      {
        content: {
          ...FINALIZED_FIXTURE_REGISTRY.content,
          reviewedItemCount: 5,
        },
      },
    ],
    [
      "generator id",
      {
        generator: {
          ...FINALIZED_FIXTURE_REGISTRY.generator,
          id: "fractions.subtract",
        },
      },
    ],
    [
      "generator version",
      { generator: { ...FINALIZED_FIXTURE_REGISTRY.generator, version: "2" } },
    ],
  ] as const)(
    "returns exact goal-unavailable for mismatched %s",
    async (_name, patch) => {
      const result = await planDailyPreviewV2(REQUEST, {
        ...FINALIZED_FIXTURE_REGISTRY,
        ...patch,
      });

      expect(result).toEqual({ status: "unavailable", code: "goal-unavailable" });
    },
  );

  it.each([0, 6, 7, 9, 200])(
    "requires the policy-pinned reviewed item count of eight, not merely %i available items",
    async (reviewedItemCount) => {
      const result = await planDailyPreviewV2(REQUEST, {
        ...FINALIZED_FIXTURE_REGISTRY,
        content: {
          ...FINALIZED_FIXTURE_REGISTRY.content,
          reviewedItemCount,
        },
      });

      expect(result).toEqual({ status: "unavailable", code: "goal-unavailable" });
    },
  );

  it.each([
    [
      "explanation node",
      {
        ...FINALIZED_FIXTURE_REGISTRY.presentationSelection,
        explanationNodeId: "lesson-explanation-02",
      },
    ],
    [
      "worked-example node",
      {
        ...FINALIZED_FIXTURE_REGISTRY.presentationSelection,
        workedExampleNodeId: "worked-example-02",
      },
    ],
    [
      "exercise node",
      {
        ...FINALIZED_FIXTURE_REGISTRY.presentationSelection,
        exerciseNodeId: "practice-02",
      },
    ],
    [
      "reordered exclusion tuple",
      {
        ...FINALIZED_FIXTURE_REGISTRY.presentationSelection,
        excludedCanonicalAnswers: [
          { numerator: "1", denominator: "3" },
          { numerator: "1", denominator: "2" },
          { numerator: "5", denominator: "6" },
        ],
      },
    ],
    [
      "short exclusion tuple",
      {
        ...FINALIZED_FIXTURE_REGISTRY.presentationSelection,
        excludedCanonicalAnswers: [
          { numerator: "1", denominator: "2" },
          { numerator: "1", denominator: "3" },
        ],
      },
    ],
    [
      "long exclusion tuple",
      {
        ...FINALIZED_FIXTURE_REGISTRY.presentationSelection,
        excludedCanonicalAnswers: [
          { numerator: "1", denominator: "2" },
          { numerator: "1", denominator: "3" },
          { numerator: "5", denominator: "6" },
          { numerator: "7", denominator: "8" },
        ],
      },
    ],
    [
      "changed exclusion value",
      {
        ...FINALIZED_FIXTURE_REGISTRY.presentationSelection,
        excludedCanonicalAnswers: [
          { numerator: "1", denominator: "2" },
          { numerator: "1", denominator: "3" },
          { numerator: "7", denominator: "8" },
        ],
      },
    ],
  ] as const)(
    "fails closed for a mismatched %s",
    async (_name, presentationSelection) => {
      await expect(
        planDailyPreviewV2(REQUEST, {
          ...FINALIZED_FIXTURE_REGISTRY,
          presentationSelection: {
            ...presentationSelection,
            excludedCanonicalAnswers:
              presentationSelection.excludedCanonicalAnswers.map((value) => ({
                numerator: value.numerator,
                denominator: value.denominator,
              })),
          },
        }),
      ).resolves.toEqual({ status: "unavailable", code: "goal-unavailable" });
    },
  );

  it("never exceeds either the requested budget or reviewed-content count", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(8, 12, 20) as fc.Arbitrary<8 | 12 | 20>,
        fc.integer({ min: 0, max: 20 }),
        (practiceMinutes, reviewedItemCount) => {
          const result = selectDailyPlanPreviewV2(
            { ...REQUEST, practiceMinutes },
            {
              ...FINALIZED_FIXTURE_REGISTRY,
              content: {
                ...FINALIZED_FIXTURE_REGISTRY.content,
                reviewedItemCount,
              },
            },
          );
          if (result.status === "ready") {
            expect(result.itemCount).toBeLessThanOrEqual(reviewedItemCount);
            expect(result.plannedPracticeMinutes).toBeLessThanOrEqual(practiceMinutes);
          } else {
            expect(result).toEqual({
              status: "unavailable",
              code: "goal-unavailable",
            });
          }
        },
      ),
      { numRuns: 10_000, seed: 2_026_071_9 },
    );
  }, 30_000);

  it.each([
    [{ ...REQUEST, schema: DAILY_PLAN_PREVIEW_REQUEST_V1_SCHEMA }, "v1 schema"],
    [
      { ...REQUEST, schema: "exercisebook.daily-plan-preview-request/v3" },
      "unknown schema",
    ],
    [{ ...REQUEST, practiceMinutes: "12" }, "number coercion"],
    [{ ...REQUEST, practiceMinutes: 10 }, "unsupported budget"],
    [{ ...REQUEST, localStudyDate: "2026-02-30" }, "invalid date"],
    [{ ...REQUEST, timeZone: "Mars/Olympus" }, "invalid time zone"],
    [{ ...REQUEST, locale: "ja" }, "unsupported locale"],
    [{ ...REQUEST, goalId: "math.fractions.divide" }, "unsupported goal"],
    [{ ...REQUEST, learnerId: "learner-1" }, "unknown/sensitive key"],
    [{ ...REQUEST, seed: "caller-controlled" }, "caller seed"],
  ])("strictly rejects %s (%s)", (value, _description) => {
    expect(() => validateDailyPlanPreviewRequestV2(value)).toThrow();
  });

  it("keeps v1 and v2 request discriminators mutually exclusive", () => {
    expect(validateDailyPlanPreviewRequestV1(V1_REQUEST)).toEqual(V1_REQUEST);
    expect(validateDailyPlanPreviewRequestV2(REQUEST)).toEqual(REQUEST);
    expect(() => validateDailyPlanPreviewRequestV1(REQUEST)).toThrow();
    expect(() => validateDailyPlanPreviewRequestV2(V1_REQUEST)).toThrow();
  });

  it("rejects hostile request and registry object graphs before schema parsing", () => {
    const cyclicRequest: Record<string, unknown> = { ...REQUEST };
    cyclicRequest.self = cyclicRequest;
    const accessorRequest = { ...REQUEST };
    Object.defineProperty(accessorRequest, "learnerId", {
      enumerable: true,
      get: () => "secret",
    });
    const accessorRegistry = { ...FINALIZED_FIXTURE_REGISTRY };
    Object.defineProperty(accessorRegistry, "latest", {
      enumerable: true,
      get: () => true,
    });

    for (const value of [
      cyclicRequest,
      accessorRequest,
      { ...REQUEST, [Symbol("secret")]: true },
      { ...REQUEST, goalId: new String(REQUEST.goalId) },
      { ...REQUEST, goalId: "\ud800" },
    ]) {
      expect(() => validateDailyPlanPreviewRequestV2(value)).toThrow();
    }
    expect(() => validateDailyPlanPreviewRegistryV2(accessorRegistry)).toThrow();
  });

  it.each([
    { numerator: "not-an-integer", denominator: "2" },
    { numerator: "1", denominator: "not-an-integer" },
  ])(
    "rejects malformed registry rationals through schema validation without leaking BigInt errors",
    (malformedRational) => {
      let caught: unknown;
      try {
        validateDailyPlanPreviewRegistryV2({
          ...FINALIZED_FIXTURE_REGISTRY,
          presentationSelection: {
            ...FINALIZED_FIXTURE_REGISTRY.presentationSelection,
            excludedCanonicalAnswers: [malformedRational],
          },
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({ name: "ZodError" });
      expect(caught).not.toBeInstanceOf(SyntaxError);
      expect(caught).not.toBeInstanceOf(RangeError);
    },
  );

  it("strictly validates registry and decision boundaries without ambient latest", async () => {
    expect(validateDailyPlanPreviewRegistryV2(FINALIZED_FIXTURE_REGISTRY)).toEqual(
      FINALIZED_FIXTURE_REGISTRY,
    );
    expect(() =>
      validateDailyPlanPreviewRegistryV2({
        ...FINALIZED_FIXTURE_REGISTRY,
        latest: true,
      }),
    ).toThrow();

    const result = await planDailyPreviewV2(REQUEST, FINALIZED_FIXTURE_REGISTRY);
    if (result.status !== "ready") {
      throw new Error("The enabled pinned v2 registry must produce a ready plan");
    }
    expect(() =>
      validateDailyPlanPreviewV2({
        ...result.plan,
        requestedPracticeMinutes: 8,
      }),
    ).toThrow();
    expect(() =>
      validateDailyPlanPreviewResultV2({
        status: "unavailable",
        code: "goal-unavailable",
        diagnostics: DAY_ONE_PREVIEW_CONTENT_IDENTITY_V2,
      }),
    ).toThrow();
  });

  it("keeps the exported registry and every identity-bearing child immutable", () => {
    expect(Object.isFrozen(DAY_ONE_PREVIEW_REGISTRY_V2)).toBe(true);
    expect(Object.isFrozen(DAY_ONE_PREVIEW_REGISTRY_V2.policy)).toBe(true);
    expect(Object.isFrozen(DAY_ONE_PREVIEW_REGISTRY_V2.skillGraph)).toBe(true);
    expect(Object.isFrozen(DAY_ONE_PREVIEW_REGISTRY_V2.content)).toBe(true);
    expect(Object.isFrozen(DAY_ONE_PREVIEW_REGISTRY_V2.generator)).toBe(true);
    expect(Object.isFrozen(DAY_ONE_PREVIEW_REGISTRY_V2.presentationSelection)).toBe(
      true,
    );
    expect(
      Object.isFrozen(
        DAY_ONE_PREVIEW_REGISTRY_V2.presentationSelection.excludedCanonicalAnswers,
      ),
    ).toBe(true);
  });

  it("preserves every frozen policy-v2 planner vector", async () => {
    const result = await planDailyPreviewV1(V1_REQUEST, DAY_ONE_PREVIEW_REGISTRY);
    if (result.status !== "ready") {
      throw new Error("The immutable v1 registry must produce a ready plan");
    }

    expect(result.plan.id).toBe(
      "preview-0ceccc181b16205f75577fb8fcae010433680890fab0bafa759e8cb5e6cd4d45",
    );
    expect(result.plan.generation.baseSeed).toBe(
      "fe05015e60ae92979bbd77f1101c5789fa78fcfc0ad524268ef7eaff59102815",
    );
  });
});
