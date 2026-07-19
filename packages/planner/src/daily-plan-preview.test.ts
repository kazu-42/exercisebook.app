import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import { canonicalizeJson } from "@exercisebook/domain";

import {
  DAILY_PLAN_PREVIEW_REQUEST_V1_SCHEMA,
  DAY_ONE_PREVIEW_REGISTRY,
  SELECTION_EXPLANATION,
  planDailyPreviewV1,
  selectDailyPlanPreviewV1,
  validateDailyPlanPreviewRegistryV1,
  validateDailyPlanPreviewRequestV1,
  validateDailyPlanPreviewResultV1,
  validateDailyPlanPreviewV1,
  type DailyPlanPreviewRegistryV1,
  type DailyPlanPreviewRequestV1,
} from "./daily-plan-preview.js";

const REQUEST: DailyPlanPreviewRequestV1 = {
  schema: DAILY_PLAN_PREVIEW_REQUEST_V1_SCHEMA,
  goalId: "math.fractions.add-unlike",
  practiceMinutes: 12,
  localStudyDate: "2026-07-19",
  timeZone: "Asia/Tokyo",
  locale: "en",
};

const BUDGET_CASES = [
  [8, 4, 8],
  [12, 6, 12],
  [20, 8, 16],
] as const;

describe("DailyPlanPreviewV1", () => {
  it.each(BUDGET_CASES)(
    "maps a %i-minute cap to %i reviewed items and %i planned minutes",
    async (practiceMinutes, itemCount, plannedPracticeMinutes) => {
      const result = await planDailyPreviewV1(
        { ...REQUEST, practiceMinutes },
        DAY_ONE_PREVIEW_REGISTRY,
      );

      expect(result.status).toBe("ready");
      if (result.status !== "ready") {
        throw new Error("The enabled day-one registry must produce a ready plan");
      }
      expect(validateDailyPlanPreviewV1(result.plan)).toEqual(result.plan);
      expect(validateDailyPlanPreviewResultV1(result)).toEqual(result);
      expect(result.plan).toMatchObject({
        requestedPracticeMinutes: practiceMinutes,
        plannedPracticeMinutes,
        evidence: { kind: "none", version: 1 },
        policy: { id: "day-one-fraction-preview", version: 2 },
        skillGraph: { id: "phase-1-math", revision: 1 },
        activities: [
          {
            itemCount,
            expectedMinutes: plannedPracticeMinutes,
            selectionReasons: ["current-frontier"],
            selectionExplanation: SELECTION_EXPLANATION,
            excludedCanonicalAnswers: [
              { numerator: "1", denominator: "2" },
              { numerator: "1", denominator: "3" },
              { numerator: "5", denominator: "6" },
            ],
          },
        ],
      });
      expect(result.plan.plannedPracticeMinutes).toBeLessThanOrEqual(
        result.plan.requestedPracticeMinutes,
      );
      expect(result.plan.id).toMatch(/^preview-[0-9a-f]{64}$/);
      expect(result.plan.generation.baseSeed).toMatch(/^[0-9a-f]{64}$/);
    },
  );

  it("is byte-deterministic across repeated calls and property insertion orders", async () => {
    const reorderedRequest = {
      locale: "en",
      timeZone: "Asia/Tokyo",
      localStudyDate: "2026-07-19",
      practiceMinutes: 12,
      goalId: "math.fractions.add-unlike",
      schema: DAILY_PLAN_PREVIEW_REQUEST_V1_SCHEMA,
    } as const;
    const reorderedRegistry = {
      generator: { ...DAY_ONE_PREVIEW_REGISTRY.generator },
      content: { ...DAY_ONE_PREVIEW_REGISTRY.content },
      skillGraph: { ...DAY_ONE_PREVIEW_REGISTRY.skillGraph },
      policy: { ...DAY_ONE_PREVIEW_REGISTRY.policy },
      schema: DAY_ONE_PREVIEW_REGISTRY.schema,
    } as const;

    const first = await planDailyPreviewV1(REQUEST, DAY_ONE_PREVIEW_REGISTRY);
    const second = await planDailyPreviewV1(reorderedRequest, reorderedRegistry);

    expect(canonicalizeJson(first)).toBe(canonicalizeJson(second));
  });

  it("derives one stable sequence seed across budgets but distinct request identities", async () => {
    const results = await Promise.all(
      BUDGET_CASES.map(([practiceMinutes]) =>
        planDailyPreviewV1({ ...REQUEST, practiceMinutes }, DAY_ONE_PREVIEW_REGISTRY),
      ),
    );
    const plans = results.map((result) => {
      if (result.status !== "ready") {
        throw new Error("The enabled day-one registry must produce a ready plan");
      }
      return result.plan;
    });

    expect(new Set(plans.map((plan) => plan.generation.baseSeed))).toHaveLength(1);
    expect(new Set(plans.map((plan) => plan.id))).toHaveLength(3);
  });

  it("freezes the v1 request-identity and sequence-seed vector", async () => {
    const result = await planDailyPreviewV1(REQUEST, DAY_ONE_PREVIEW_REGISTRY);
    if (result.status !== "ready") {
      throw new Error("The enabled day-one registry must produce a ready plan");
    }

    expect(result.plan.id).toBe(
      "preview-0ceccc181b16205f75577fb8fcae010433680890fab0bafa759e8cb5e6cd4d45",
    );
    expect(result.plan.generation.baseSeed).toBe(
      "fe05015e60ae92979bbd77f1101c5789fa78fcfc0ad524268ef7eaff59102815",
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
      const result = await planDailyPreviewV1(REQUEST, DAY_ONE_PREVIEW_REGISTRY);
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
      const first = await planDailyPreviewV1(REQUEST, DAY_ONE_PREVIEW_REGISTRY);

      vi.stubEnv("TZ", "Europe/Helsinki");
      vi.stubEnv("LANG", "fr_FR.UTF-8");
      vi.setSystemTime(new Date("2042-12-31T23:59:59.999Z"));
      const second = await planDailyPreviewV1(REQUEST, DAY_ONE_PREVIEW_REGISTRY);

      expect(canonicalizeJson(first)).toBe(canonicalizeJson(second));
    } finally {
      vi.unstubAllEnvs();
      vi.useRealTimers();
    }
  });

  it.each(["policy", "skillGraph", "content", "generator"] as const)(
    "fails closed when the required %s revision is disabled",
    async (registryKey) => {
      const registry = {
        ...DAY_ONE_PREVIEW_REGISTRY,
        [registryKey]: {
          ...DAY_ONE_PREVIEW_REGISTRY[registryKey],
          enabled: false,
        },
      } as DailyPlanPreviewRegistryV1;

      const result = await planDailyPreviewV1(REQUEST, registry);

      expect(result).toEqual({ status: "unavailable", code: "goal-unavailable" });
      expect(JSON.stringify(result)).not.toContain("baseSeed");
      expect(JSON.stringify(result)).not.toContain("activities");
    },
  );

  it.each([
    [
      "policy",
      {
        ...DAY_ONE_PREVIEW_REGISTRY,
        policy: { ...DAY_ONE_PREVIEW_REGISTRY.policy, version: 3 },
      },
    ],
    [
      "skill graph",
      {
        ...DAY_ONE_PREVIEW_REGISTRY,
        skillGraph: { ...DAY_ONE_PREVIEW_REGISTRY.skillGraph, revision: 2 },
      },
    ],
    [
      "content",
      {
        ...DAY_ONE_PREVIEW_REGISTRY,
        content: { ...DAY_ONE_PREVIEW_REGISTRY.content, revision: 2 },
      },
    ],
    [
      "generator",
      {
        ...DAY_ONE_PREVIEW_REGISTRY,
        generator: { ...DAY_ONE_PREVIEW_REGISTRY.generator, version: "2" },
      },
    ],
  ] as const)(
    "fails closed for an unknown pinned %s revision",
    async (_name, registry) => {
      await expect(planDailyPreviewV1(REQUEST, registry)).resolves.toEqual({
        status: "unavailable",
        code: "goal-unavailable",
      });
    },
  );

  it("never exceeds either the requested budget or reviewed-content count", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(8, 12, 20) as fc.Arbitrary<8 | 12 | 20>,
        fc.integer({ min: 0, max: 20 }),
        (practiceMinutes, reviewedItemCount) => {
          const result = selectDailyPlanPreviewV1(
            { ...REQUEST, practiceMinutes },
            {
              ...DAY_ONE_PREVIEW_REGISTRY,
              content: {
                ...DAY_ONE_PREVIEW_REGISTRY.content,
                reviewedItemCount,
              },
            },
          );
          if (result.status === "ready") {
            expect(result.itemCount).toBeLessThanOrEqual(reviewedItemCount);
            expect(result.plannedPracticeMinutes).toBeLessThanOrEqual(practiceMinutes);
          } else {
            expect(result.code).toBe("goal-unavailable");
          }
        },
      ),
      { numRuns: 10_000, seed: 2_026_071_9 },
    );
  }, 15_000);

  it("returns unavailable when no reviewed items exist", async () => {
    await expect(
      planDailyPreviewV1(REQUEST, {
        ...DAY_ONE_PREVIEW_REGISTRY,
        content: {
          ...DAY_ONE_PREVIEW_REGISTRY.content,
          reviewedItemCount: 0,
        },
      }),
    ).resolves.toEqual({
      status: "unavailable",
      code: "goal-unavailable",
    });
  });

  it.each([
    [{ ...REQUEST, practiceMinutes: "12" }, "number coercion"],
    [{ ...REQUEST, practiceMinutes: 10 }, "unsupported budget"],
    [{ ...REQUEST, localStudyDate: "2026-02-30" }, "invalid date"],
    [{ ...REQUEST, timeZone: "Mars/Olympus" }, "invalid time zone"],
    [{ ...REQUEST, locale: "ja" }, "unsupported locale"],
    [{ ...REQUEST, goalId: "math.fractions.divide" }, "unsupported goal"],
    [{ ...REQUEST, learnerId: "learner-1" }, "unknown/sensitive key"],
  ])("strictly rejects %s (%s)", (value, _description) => {
    expect(() => validateDailyPlanPreviewRequestV1(value)).toThrow();
  });

  it("rejects hostile object graphs before schema parsing", () => {
    const cyclic: Record<string, unknown> = { ...REQUEST };
    cyclic.self = cyclic;
    const accessor = { ...REQUEST };
    Object.defineProperty(accessor, "learnerId", {
      enumerable: true,
      get: () => "secret",
    });
    const withSymbol = { ...REQUEST, [Symbol("secret")]: true };

    for (const value of [
      cyclic,
      accessor,
      withSymbol,
      { ...REQUEST, goalId: new String(REQUEST.goalId) },
      { ...REQUEST, goalId: "\ud800" },
    ]) {
      expect(() => validateDailyPlanPreviewRequestV1(value)).toThrow();
    }
  });

  it("strictly validates registry and decision boundaries", async () => {
    expect(validateDailyPlanPreviewRegistryV1(DAY_ONE_PREVIEW_REGISTRY)).toEqual(
      DAY_ONE_PREVIEW_REGISTRY,
    );
    expect(() =>
      validateDailyPlanPreviewRegistryV1({
        ...DAY_ONE_PREVIEW_REGISTRY,
        latest: true,
      }),
    ).toThrow();

    const result = await planDailyPreviewV1(REQUEST, DAY_ONE_PREVIEW_REGISTRY);
    if (result.status !== "ready") {
      throw new Error("The enabled day-one registry must produce a ready plan");
    }
    expect(() =>
      validateDailyPlanPreviewV1({
        ...result.plan,
        requestedPracticeMinutes: 8,
      }),
    ).toThrow();
  });
});
