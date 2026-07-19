import { describe, expect, it } from "vitest";

import { materializeFractionAdditionWorksheetFromContent } from "@exercisebook/generators";
import {
  addRationals,
  canonicalizeJson,
  equalRationals,
  sha256Hex,
} from "@exercisebook/domain";
import {
  DAY_ONE_PREVIEW_REGISTRY,
  DAY_ONE_PREVIEW_RESERVED_CANONICAL_ANSWERS,
  type DailyPlanPreviewRegistryV1,
  type DailyPlanPreviewRequestV1,
} from "@exercisebook/planner";

import { MAX_DAILY_PLAN_PREVIEW_RESPONSE_BYTES } from "../shared/public-api-response-limits.js";
import { parseStrictJson } from "../shared/strict-json.js";
import { createDailyPlanPreviewService } from "./daily-plan-preview-service.js";
import { projectStudentWorksheetForWeb } from "./web-worksheet-projector.js";

function request(practiceMinutes: 8 | 12 | 20): DailyPlanPreviewRequestV1 {
  return {
    schema: "exercisebook.daily-plan-preview-request/v1",
    goalId: "math.fractions.add-unlike",
    practiceMinutes,
    localStudyDate: "2026-07-19",
    timeZone: "Asia/Tokyo",
    locale: "en",
  };
}

describe("generator-backed Daily Plan Preview service", () => {
  it.each([
    [8, 4, 8],
    [12, 6, 12],
    [20, 8, 16],
  ] as const)(
    "materializes the %i-minute policy as %i reviewed items and %i planned minutes",
    async (requested, itemCount, planned) => {
      const result = await createDailyPlanPreviewService().createPreview(
        request(requested),
      );

      expect(result.status).toBe("ready");
      if (result.status !== "ready") {
        throw new Error("Expected a ready preview");
      }
      expect(result.response.plan).toMatchObject({
        requestedPracticeMinutes: requested,
        plannedPracticeMinutes: planned,
        itemCount,
        saved: false,
      });
      expect(result.response.worksheet.items).toHaveLength(itemCount);
      expect(result.response.worksheet.expectedMinutes).toBe(planned);
      expect(result.response.worksheet.assignmentId).toBe(result.response.plan.id);
      const serialized = JSON.stringify(result.response);
      expect(parseStrictJson(serialized)).toEqual(result.response);
    },
  );

  it("is byte-deterministic and preserves shorter-budget problem prefixes", async () => {
    const service = createDailyPlanPreviewService();
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
      throw new Error("Expected ready previews");
    }

    expect(JSON.stringify(eightRepeated.response)).toBe(JSON.stringify(eight.response));
    const prompts = (result: typeof eight) =>
      result.response.worksheet.items.map((item) => item.prompt);
    expect(prompts(twelve).slice(0, 4)).toEqual(prompts(eight));
    expect(prompts(twenty).slice(0, 4)).toEqual(prompts(eight));
    expect(prompts(twenty).slice(0, 6)).toEqual(prompts(twelve));
    expect(eight.response.plan.id).not.toBe(twelve.response.plan.id);
  });

  it("keeps answer, scoring, solution, and seed data out of the public result", async () => {
    const result = await createDailyPlanPreviewService().createPreview(request(20));
    if (result.status !== "ready") {
      throw new Error("Expected a ready preview");
    }
    const serialized = JSON.stringify(result.response);

    for (const protectedName of [
      "canonicalAnswer",
      "accepted",
      "scoringRule",
      "hints",
      "misconceptions",
      "solutionTrace",
      "baseSeed",
      "slotSeed",
      "seedSecretVersion",
    ]) {
      expect(serialized).not.toContain(protectedName);
    }
  });

  it("never lets the reviewed worked example reveal a generated practice answer", async () => {
    const result = await createDailyPlanPreviewService().createPreview({
      ...request(8),
      localStudyDate: "2026-07-30",
    });
    if (result.status !== "ready") {
      throw new Error("Expected a ready preview");
    }

    expect(
      result.response.worksheet.items.every(
        (item) =>
          !equalRationals(
            addRationals(item.prompt.left, item.prompt.right),
            result.response.worksheet.workedExample.result,
          ),
      ),
    ).toBe(true);
  });

  it("reserves every worked-example value across a full year and all slots", async () => {
    const service = createDailyPlanPreviewService();
    const collisions: string[] = [];
    let maximumResponseBytes = 0;
    let maximumResponseDate = "";

    for (let dayOffset = 0; dayOffset < 365; dayOffset += 1) {
      const localStudyDate = new Date(Date.UTC(2026, 0, dayOffset + 1))
        .toISOString()
        .slice(0, 10);
      const result = await service.createPreview({
        ...request(20),
        localStudyDate,
      });
      if (result.status !== "ready") {
        throw new Error(`Expected a ready preview for ${localStudyDate}`);
      }

      const responseBytes = new TextEncoder().encode(
        JSON.stringify(result.response),
      ).byteLength;
      if (responseBytes > maximumResponseBytes) {
        maximumResponseBytes = responseBytes;
        maximumResponseDate = localStudyDate;
      }

      for (const item of result.response.worksheet.items) {
        const generatedAnswer = addRationals(item.prompt.left, item.prompt.right);
        if (
          DAY_ONE_PREVIEW_RESERVED_CANONICAL_ANSWERS.some((reserved) =>
            equalRationals(generatedAnswer, reserved),
          )
        ) {
          collisions.push(`${localStudyDate}:${item.id}`);
        }
      }
    }

    expect(collisions).toEqual([]);
    expect(maximumResponseBytes * 2).toBeLessThanOrEqual(
      MAX_DAILY_PLAN_PREVIEW_RESPONSE_BYTES,
    );
    expect({ maximumResponseBytes, maximumResponseDate }).toEqual({
      maximumResponseBytes: 4_899,
      maximumResponseDate: "2026-01-01",
    });
  }, 60_000);

  it.each(["policy", "skillGraph", "content", "generator"] as const)(
    "returns unavailable before materialization when %s is disabled",
    async (component) => {
      const registry: DailyPlanPreviewRegistryV1 = {
        ...DAY_ONE_PREVIEW_REGISTRY,
        [component]: {
          ...DAY_ONE_PREVIEW_REGISTRY[component],
          enabled: false,
        },
      };
      const result = await createDailyPlanPreviewService({ registry }).createPreview(
        request(8),
      );

      expect(result).toEqual({
        status: "unavailable",
        code: "goal-unavailable",
      });
    },
  );

  it("snapshots the explicit registry instead of depending on later mutation", async () => {
    const registry = structuredClone(DAY_ONE_PREVIEW_REGISTRY);
    const service = createDailyPlanPreviewService({ registry });
    registry.policy.enabled = false;

    const result = await service.createPreview(request(8));

    expect(result.status).toBe("ready");
  });

  it("compares the public worksheet with the pre-await materialization hash", async () => {
    const service = createDailyPlanPreviewService({
      async projectStudentWorksheet(materialized) {
        const pending = projectStudentWorksheetForWeb(materialized);
        const callerOwned = materialized as unknown as { instanceHash: string };
        callerOwned.instanceHash = "0".repeat(64);
        return pending;
      },
    });

    const result = await service.createPreview(request(8));

    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      throw new Error("Expected a ready preview");
    }
    expect(result.response.worksheet.instanceHash).not.toBe("0".repeat(64));
  });

  it("fails closed when materialization violates the plan contract", async () => {
    const service = createDailyPlanPreviewService({
      async materializePreview(document, assignment) {
        const materialized = await materializeFractionAdditionWorksheetFromContent(
          document,
          assignment,
        );
        return {
          ...materialized,
          instance: {
            ...materialized.instance,
            expectedMinutes: materialized.instance.expectedMinutes + 2,
          },
        };
      },
    });

    await expect(service.createPreview(request(8))).rejects.toThrow(
      "does not agree with its preview plan",
    );
  });

  it("rejects one slot's answer when injected into another slot's fallback", async () => {
    const service = createDailyPlanPreviewService({
      async materializePreview(document, assignment) {
        const materialized = await materializeFractionAdditionWorksheetFromContent(
          document,
          assignment,
        );
        const instance = structuredClone(materialized.instance);
        const crossSlotAnswer = instance.slots[1]?.canonicalAnswer.value;
        if (crossSlotAnswer === undefined || instance.slots[0] === undefined) {
          throw new Error("Expected at least two generated slots");
        }
        instance.slots[0].printFallback.text = `A leaked answer from another problem is ${crossSlotAnswer.numerator}/${crossSlotAnswer.denominator}.`;
        const canonicalJson = canonicalizeJson(instance);
        return {
          instance,
          canonicalJson,
          instanceHash: await sha256Hex(canonicalJson),
        };
      },
    });

    await expect(service.createPreview(request(8))).rejects.toThrow(
      "recognized canonical-answer representation",
    );
  });

  it.each([
    [
      "policy",
      (instance: MutablePreviewInstance): void => {
        instance.policy.id = "wrong";
      },
    ],
    [
      "skill graph",
      (instance: MutablePreviewInstance): void => {
        instance.skillGraph.id = "wrong";
      },
    ],
    [
      "slot skill",
      (instance: MutablePreviewInstance): void => {
        instance.slots[0]!.skillIds = ["wrong"];
      },
    ],
    [
      "selection reason",
      (instance: MutablePreviewInstance): void => {
        instance.slots[0]!.selectionReasons = ["due-review"];
      },
    ],
    [
      "content ID",
      (instance: MutablePreviewInstance): void => {
        instance.slots[0]!.provenance.contentId = "wrong";
      },
    ],
    [
      "content revision",
      (instance: MutablePreviewInstance): void => {
        instance.slots[0]!.provenance.contentRevision += 1;
      },
    ],
    [
      "generator ID",
      (instance: MutablePreviewInstance): void => {
        instance.slots[0]!.provenance.generatorId = "wrong";
      },
    ],
    [
      "generator version",
      (instance: MutablePreviewInstance): void => {
        instance.slots[0]!.provenance.generatorVersion = "wrong";
      },
    ],
    [
      "seed version",
      (instance: MutablePreviewInstance): void => {
        instance.rng.seedSecretVersion = "wrong";
      },
    ],
    [
      "slot count",
      (instance: MutablePreviewInstance): void => {
        instance.slots.pop();
      },
    ],
  ] as const)("fails closed for corrupted %s provenance", async (_name, mutate) => {
    const service = createDailyPlanPreviewService({
      async materializePreview(document, assignment) {
        const materialized = await materializeFractionAdditionWorksheetFromContent(
          document,
          assignment,
        );
        const instance = structuredClone(materialized.instance);
        mutate(instance);
        return { ...materialized, instance };
      },
    });

    await expect(service.createPreview(request(8))).rejects.toThrow(
      "does not agree with its preview plan",
    );
  });
});

interface MutablePreviewInstance {
  policy: { id: string; version: number };
  skillGraph: { id: string; revision: number };
  rng: { seedSecretVersion: string };
  slots: Array<{
    skillIds: string[];
    selectionReasons: string[];
    provenance: {
      contentId: string;
      contentRevision: number;
      generatorId: string;
      generatorVersion: string;
    };
  }>;
}
