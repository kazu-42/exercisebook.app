import { describe, expect, it } from "vitest";

import { canonicalizeJson, equalRationals, sha256Hex } from "@exercisebook/domain";
import {
  DAILY_PLAN_PREVIEW_REQUEST_V2_SCHEMA,
  DAY_ONE_PREVIEW_REGISTRY_V2,
  planDailyPreviewV2,
  type DailyPlanPreviewV2,
} from "@exercisebook/planner";
import {
  projectWorksheetV2ForStudent,
  validateContentDocumentV1,
  validateContentDocumentV2,
  validateWorksheetInstanceV2,
} from "@exercisebook/schemas";

import compiledFractionLessonV1 from "../../../content/compiled/math.fractions.add-unlike-denominators.v1.json" with { type: "json" };
import compiledFractionLessonV2 from "../../../content/compiled/math.fractions.add-unlike-denominators.v2.json" with { type: "json" };

import {
  FRACTION_ADDITION_SAMPLE_INPUT,
  materializeFractionAdditionWorksheetFromContent,
} from "./fraction-addition.js";
import {
  FractionAdditionV2MaterializationError,
  materializeFractionAdditionWorksheetFromContentV2,
} from "./fraction-addition-v2.js";
import { PresentationResolutionError } from "./fraction-presentation-v1.js";

const REVIEWED_FRACTION_LESSON_V1 = validateContentDocumentV1(compiledFractionLessonV1);
const REVIEWED_FRACTION_LESSON_V2 = validateContentDocumentV2(compiledFractionLessonV2);

interface MutablePlanProbe {
  id: string;
  localStudyDate: string;
  timeZone: string;
  locale: string;
  requestedPracticeMinutes: number;
  plannedPracticeMinutes: number;
  policy: {
    id: string;
    version: number;
  };
  skillGraph: {
    id: string;
    revision: number;
  };
  generation: {
    baseSeed: string;
    seedVersion: string;
  };
  activities: Array<{
    itemCount: number;
    expectedMinutes: number;
    selectionReasons: string[];
    content: {
      contentHash: string;
    };
    presentationSelection: {
      explanationNodeId: string;
      excludedCanonicalAnswers: unknown[];
    };
  }>;
}

const PLAN_MUTATION_CASES = [
  [
    "regex-valid plan ID",
    (plan: MutablePlanProbe) => {
      plan.id = `preview-${"0".repeat(64)}`;
    },
  ],
  [
    "64-hex base seed",
    (plan: MutablePlanProbe) => {
      plan.generation.baseSeed = "0".repeat(64);
    },
  ],
  [
    "seed version",
    (plan: MutablePlanProbe) => {
      plan.generation.seedVersion = "public-preview-v1";
    },
  ],
  [
    "policy ID",
    (plan: MutablePlanProbe) => {
      plan.policy.id = "alternate-preview-policy";
    },
  ],
  [
    "policy version",
    (plan: MutablePlanProbe) => {
      plan.policy.version = 2;
    },
  ],
  [
    "skill graph ID",
    (plan: MutablePlanProbe) => {
      plan.skillGraph.id = "alternate-skill-graph";
    },
  ],
  [
    "skill graph revision",
    (plan: MutablePlanProbe) => {
      plan.skillGraph.revision = 2;
    },
  ],
  [
    "valid local study date",
    (plan: MutablePlanProbe) => {
      plan.localStudyDate = "2026-07-20";
    },
  ],
  [
    "valid time zone",
    (plan: MutablePlanProbe) => {
      plan.timeZone = "UTC";
    },
  ],
  [
    "locale",
    (plan: MutablePlanProbe) => {
      plan.locale = "ja";
    },
  ],
  [
    "content identity",
    (plan: MutablePlanProbe) => {
      plan.activities[0]!.content.contentHash = "0".repeat(64);
    },
  ],
  [
    "selection reason",
    (plan: MutablePlanProbe) => {
      plan.activities[0]!.selectionReasons = ["due-review"];
    },
  ],
  [
    "selected node",
    (plan: MutablePlanProbe) => {
      plan.activities[0]!.presentationSelection.explanationNodeId =
        "alternate-explanation";
    },
  ],
  [
    "ordered exclusion tuple",
    (plan: MutablePlanProbe) => {
      plan.activities[0]!.presentationSelection.excludedCanonicalAnswers.reverse();
    },
  ],
] as const;

describe("fractions.add@1 WorksheetInstanceV2 materializer", () => {
  it("derives the complete assignment and student delivery from one planner-owned snapshot", async () => {
    const plan = await createRealPlanV2(12);
    const activity = plan.activities[0];
    const materialized = await materializeFractionAdditionWorksheetFromContentV2(
      REVIEWED_FRACTION_LESSON_V2,
      plan,
    );
    const delivery = await projectWorksheetV2ForStudent(materialized);

    expect(materialized.instance).toMatchObject({
      assignmentId: plan.id,
      localStudyDate: plan.localStudyDate,
      timeZone: plan.timeZone,
      locale: plan.locale,
      expectedMinutes: plan.plannedPracticeMinutes,
      plan: { id: plan.id, version: 2 },
      policy: plan.policy,
      skillGraph: plan.skillGraph,
      rng: {
        baseSeed: plan.generation.baseSeed,
        seedSecretVersion: plan.generation.seedVersion,
      },
      content: [activity.content],
    });
    expect(materialized.instance.slots).toHaveLength(activity.itemCount);
    expect(
      materialized.instance.slots.every(
        (slot) =>
          slot.selectionReasons.length === activity.selectionReasons.length &&
          slot.selectionReasons.every(
            (reason, index) => reason === activity.selectionReasons[index],
          ),
      ),
    ).toBe(true);
    expect(delivery).toMatchObject({
      assignmentId: plan.id,
      instanceHash: materialized.instanceHash,
      expectedMinutes: plan.plannedPracticeMinutes,
    });
    expect(JSON.stringify(delivery)).not.toMatch(
      /baseSeed|seedSecretVersion|slotSeed|canonicalAnswer|scoringRule|solutionTrace|misconceptions/u,
    );
  });

  it("keeps real 8, 12, and 20 minute plans deterministic and prefix-stable", async () => {
    const [plan8, plan12, plan20] = await Promise.all([
      createRealPlanV2(8),
      createRealPlanV2(12),
      createRealPlanV2(20),
    ]);
    const [four, six, eight] = await Promise.all([
      materializeFractionAdditionWorksheetFromContentV2(
        REVIEWED_FRACTION_LESSON_V2,
        plan8,
      ),
      materializeFractionAdditionWorksheetFromContentV2(
        REVIEWED_FRACTION_LESSON_V2,
        plan12,
      ),
      materializeFractionAdditionWorksheetFromContentV2(
        REVIEWED_FRACTION_LESSON_V2,
        plan20,
      ),
    ]);
    const [fourReplay, sixReplay, eightReplay] = await Promise.all([
      materializeFractionAdditionWorksheetFromContentV2(
        REVIEWED_FRACTION_LESSON_V2,
        plan8,
      ),
      materializeFractionAdditionWorksheetFromContentV2(
        REVIEWED_FRACTION_LESSON_V2,
        plan12,
      ),
      materializeFractionAdditionWorksheetFromContentV2(
        REVIEWED_FRACTION_LESSON_V2,
        plan20,
      ),
    ]);

    expect([four.instanceHash, six.instanceHash, eight.instanceHash]).toEqual([
      fourReplay.instanceHash,
      sixReplay.instanceHash,
      eightReplay.instanceHash,
    ]);
    expect([four.canonicalJson, six.canonicalJson, eight.canonicalJson]).toEqual([
      fourReplay.canonicalJson,
      sixReplay.canonicalJson,
      eightReplay.canonicalJson,
    ]);
    expect(six.instance.slots.slice(0, 4)).toEqual(four.instance.slots);
    expect(eight.instance.slots.slice(0, 4)).toEqual(four.instance.slots);
    expect(eight.instance.slots.slice(0, 6)).toEqual(six.instance.slots);
    expect([
      four.instance.expectedMinutes,
      six.instance.expectedMinutes,
      eight.instance.expectedMinutes,
    ]).toEqual([8, 12, 16]);
  });

  it("freezes the planner-derived 12-minute V2 instance vector", async () => {
    const plan = await createRealPlanV2(12);
    const first = await materializeFractionAdditionWorksheetFromContentV2(
      REVIEWED_FRACTION_LESSON_V2,
      plan,
    );
    const second = await materializeFractionAdditionWorksheetFromContentV2(
      REVIEWED_FRACTION_LESSON_V2,
      plan,
    );

    expect(validateWorksheetInstanceV2(first.instance)).toEqual(first.instance);
    expect(first.canonicalJson).toBe(canonicalizeJson(first.instance));
    expect(first.canonicalJson).toBe(second.canonicalJson);
    expect(first.instanceHash).toBe(second.instanceHash);
    expect(first.instanceHash).toBe(
      "934bd3949b6284bbb4061a29b3075560f9389b096ec4f913ad56788e06ac0d02",
    );
  });

  it.each(PLAN_MUTATION_CASES)(
    "rejects a complete plan whose %s is mutated",
    async (_name, mutate) => {
      const plan = mutablePlanV2(await createRealPlanV2(12));
      mutate(plan);

      await expect(
        materializeFractionAdditionWorksheetFromContentV2(
          REVIEWED_FRACTION_LESSON_V2,
          plan as unknown as DailyPlanPreviewV2,
        ),
      ).rejects.toMatchObject({
        name: "FractionAdditionV2MaterializationError",
        code: "invalid-assignment",
      });
    },
  );

  it.each([
    [8, 6],
    [12, 8],
    [20, 4],
  ] as const)(
    "rejects a %i-minute plan whose item count is changed to %i",
    async (practiceMinutes, itemCount) => {
      const plan = mutablePlanV2(await createRealPlanV2(practiceMinutes));
      plan.activities[0]!.itemCount = itemCount;

      await expect(
        materializeFractionAdditionWorksheetFromContentV2(
          REVIEWED_FRACTION_LESSON_V2,
          plan as unknown as DailyPlanPreviewV2,
        ),
      ).rejects.toMatchObject({
        name: "FractionAdditionV2MaterializationError",
        code: "invalid-assignment",
      });
    },
  );

  it("rejects independent assignment claims instead of merging them with the plan", async () => {
    const plan = await createRealPlanV2(12);

    await expect(
      materializeFractionAdditionWorksheetFromContentV2(REVIEWED_FRACTION_LESSON_V2, {
        ...plan,
        assignmentId: plan.id,
        seed: plan.generation.baseSeed,
        requestedItemCount: plan.activities[0].itemCount,
      } as never),
    ).rejects.toMatchObject({
      name: "FractionAdditionV2MaterializationError",
      code: "invalid-assignment",
    });
  });

  it("authorizes the complete plan before content hashing or generation", async () => {
    const plan = mutablePlanV2(await createRealPlanV2(12));
    plan.generation.baseSeed = "0".repeat(64);
    const changedDocument = structuredClone(REVIEWED_FRACTION_LESSON_V2);
    changedDocument.title = "Schema-valid but unreviewed title";

    await expect(
      materializeFractionAdditionWorksheetFromContentV2(
        changedDocument,
        plan as unknown as DailyPlanPreviewV2,
      ),
    ).rejects.toMatchObject({
      name: "FractionAdditionV2MaterializationError",
      code: "invalid-assignment",
    });
  });

  it("rejects a document locale that differs from the authorized plan", async () => {
    const plan = await createRealPlanV2(12);
    const mismatchedDocument = structuredClone(REVIEWED_FRACTION_LESSON_V2);
    mismatchedDocument.locale = "ja";

    await expect(
      materializeFractionAdditionWorksheetFromContentV2(mismatchedDocument, plan),
    ).rejects.toMatchObject({
      name: "FractionAdditionV2MaterializationError",
      code: "locale-mismatch",
    });
  });

  it("excludes all worked-example operands and result across broad planner-derived seeds", async () => {
    for (let seedIndex = 0; seedIndex < 128; seedIndex += 1) {
      const plan = await createRealPlanV2(20, studyDateForIndex(seedIndex));
      const materialized = await materializeFractionAdditionWorksheetFromContentV2(
        REVIEWED_FRACTION_LESSON_V2,
        plan,
      );
      const excluded =
        plan.activities[0].presentationSelection.excludedCanonicalAnswers;
      for (const slot of materialized.instance.slots) {
        expect(
          excluded.some((value) => equalRationals(slot.canonicalAnswer.value, value)),
        ).toBe(false);
      }
    }
  }, 30_000);

  it("derives instruction, provenance, title, skills, and attribution from one document and plan", async () => {
    const plan = await createRealPlanV2(20);
    const activity = plan.activities[0];
    const materialized = await materializeFractionAdditionWorksheetFromContentV2(
      REVIEWED_FRACTION_LESSON_V2,
      plan,
    );

    expect(materialized.instance.title).toBe(REVIEWED_FRACTION_LESSON_V2.title);
    expect(materialized.instance.presentation.exercise.instruction).toBe(
      "Add each pair of fractions. Give every answer in lowest terms.",
    );
    expect(materialized.instance.content).toEqual([activity.content]);
    expect(materialized.instance.attributions).toEqual([
      {
        title: REVIEWED_FRACTION_LESSON_V2.title,
        author: "Exercise Book contributors, Exercise Book curriculum review",
        sourceUrl: REVIEWED_FRACTION_LESSON_V2.license.sourceUrl,
        licenseId: REVIEWED_FRACTION_LESSON_V2.license.licenseId,
        attributionText: REVIEWED_FRACTION_LESSON_V2.license.attributionText,
        publicationStatus: "draft",
        modifications: [],
      },
    ]);
    expect(
      materialized.instance.slots.every(
        (slot) =>
          slot.prompt.instruction ===
            materialized.instance.presentation.exercise.instruction &&
          slot.skillIds.length === 1 &&
          slot.skillIds[0] === activity.skillId &&
          slot.provenance.contentId === activity.content.id &&
          slot.provenance.contentRevision === activity.content.revision &&
          slot.provenance.sourceHash === activity.content.sourceHash &&
          slot.provenance.contentHash === activity.content.contentHash &&
          slot.provenance.compilerVersion === activity.content.compilerVersion &&
          slot.provenance.generatorId === activity.generatorId &&
          slot.provenance.generatorVersion === activity.generatorVersion &&
          slot.provenance.generationAttempt >= 0 &&
          slot.provenance.generationAttempt <= 127,
      ),
    ).toBe(true);
  });

  it("includes the full presentation and pinned identity in canonical hash semantics", async () => {
    const plan = await createRealPlanV2(20);
    const original = await materializeFractionAdditionWorksheetFromContentV2(
      REVIEWED_FRACTION_LESSON_V2,
      plan,
    );
    const changedPresentation = validateWorksheetInstanceV2({
      ...original.instance,
      presentation: {
        ...original.instance.presentation,
        lesson: {
          ...original.instance.presentation.lesson,
          title: "A schema-valid changed lesson title",
        },
      },
    });
    const changedIdentityHash = "0".repeat(64);
    const changedIdentity = validateWorksheetInstanceV2({
      ...original.instance,
      content: original.instance.content.map((content) => ({
        ...content,
        contentHash: changedIdentityHash,
      })),
      presentation: {
        ...original.instance.presentation,
        content: {
          ...original.instance.presentation.content,
          contentHash: changedIdentityHash,
        },
      },
      slots: original.instance.slots.map((slot) => ({
        ...slot,
        provenance: {
          ...slot.provenance,
          contentHash: changedIdentityHash,
        },
      })),
    });

    expect(await sha256Hex(canonicalizeJson(changedPresentation))).not.toBe(
      original.instanceHash,
    );
    expect(await sha256Hex(canonicalizeJson(changedIdentity))).not.toBe(
      original.instanceHash,
    );
  });

  it("uses one detached pre-await snapshot when callers mutate document and plan", async () => {
    const sourcePlan = await createRealPlanV2(20);
    const baselineDocument = structuredClone(REVIEWED_FRACTION_LESSON_V2);
    const baselinePlan = structuredClone(sourcePlan);
    const baseline = await materializeFractionAdditionWorksheetFromContentV2(
      baselineDocument,
      baselinePlan,
    );
    const racedDocument = structuredClone(REVIEWED_FRACTION_LESSON_V2);
    const racedPlan = mutablePlanV2(sourcePlan);

    const pending = materializeFractionAdditionWorksheetFromContentV2(
      racedDocument,
      racedPlan as unknown as DailyPlanPreviewV2,
    );
    racedDocument.title = "Caller-mutated title";
    racedDocument.authors[0] = { name: "Caller mutation", role: "author" };
    const explanation = racedDocument.nodes.find((node) => node.type === "explanation");
    if (explanation?.type === "explanation") {
      explanation.paragraphs[0] = "Caller-mutated paragraph";
    }
    racedPlan.id = `preview-${"f".repeat(64)}`;
    racedPlan.generation.baseSeed = "f".repeat(64);
    racedPlan.activities[0]!.presentationSelection.excludedCanonicalAnswers[0] = {
      numerator: "9",
      denominator: "10",
    };

    const raced = await pending;
    expect(raced).toEqual(baseline);
    expect(raced.canonicalJson).not.toContain("Caller-mutated");
  });

  it("rejects accessor-bearing caller data without invoking accessors", async () => {
    const plan = await createRealPlanV2(12);
    let getterRan = false;
    const hostilePlan = {
      ...structuredClone(plan),
    } as Record<string, unknown>;
    Object.defineProperty(hostilePlan, "generation", {
      enumerable: true,
      get() {
        getterRan = true;
        return plan.generation;
      },
    });

    await expect(
      materializeFractionAdditionWorksheetFromContentV2(
        REVIEWED_FRACTION_LESSON_V2,
        hostilePlan as unknown as DailyPlanPreviewV2,
      ),
    ).rejects.toMatchObject({
      name: "FractionAdditionV2MaterializationError",
      code: "unsafe-input",
    });
    expect(getterRan).toBe(false);
  });

  it.each([
    { numerator: "1e999999", denominator: "2" },
    { numerator: "1", denominator: "0" },
    { numerator: "9".repeat(129), denominator: "2" },
    { numerator: "2", denominator: "4" },
  ])(
    "maps hostile plan selection rational $numerator/$denominator to a typed error",
    async (hostile) => {
      const plan = mutablePlanV2(await createRealPlanV2(12));
      plan.activities[0]!.presentationSelection.excludedCanonicalAnswers[0] = hostile;
      const action = materializeFractionAdditionWorksheetFromContentV2(
        REVIEWED_FRACTION_LESSON_V2,
        plan as unknown as DailyPlanPreviewV2,
      );

      await expect(action).rejects.toBeInstanceOf(
        FractionAdditionV2MaterializationError,
      );
      await expect(action).rejects.not.toBeInstanceOf(SyntaxError);
      await expect(action).rejects.not.toBeInstanceOf(RangeError);
    },
  );

  it("rejects a document whose computed hash differs from the pinned plan content", async () => {
    const plan = await createRealPlanV2(12);
    const changed = structuredClone(REVIEWED_FRACTION_LESSON_V2);
    changed.title = "Schema-valid but unreviewed title";

    await expect(
      materializeFractionAdditionWorksheetFromContentV2(changed, plan),
    ).rejects.toMatchObject({
      name: "PresentationResolutionError",
      code: "content-identity-mismatch",
    });
  });

  it("maps opaque function and symbol plan values without leaking DataCloneError", async () => {
    for (const hostile of [() => undefined, Symbol("opaque-selection")]) {
      const plan = mutablePlanV2(await createRealPlanV2(12));
      plan.activities[0]!.presentationSelection.excludedCanonicalAnswers[0] = hostile;
      const action = materializeFractionAdditionWorksheetFromContentV2(
        REVIEWED_FRACTION_LESSON_V2,
        plan as unknown as DailyPlanPreviewV2,
      );

      await expect(action).rejects.toBeInstanceOf(
        FractionAdditionV2MaterializationError,
      );
      await expect(action).rejects.not.toBeInstanceOf(DOMException);
    }
  });

  it("returns fixed bounded materialization diagnostics without echoing caller data", async () => {
    const marker = "DO-NOT-ECHO-MATERIALIZER-CONTENT";
    const plan = mutablePlanV2(await createRealPlanV2(12));
    plan.id = marker;
    let captured: unknown;
    try {
      await materializeFractionAdditionWorksheetFromContentV2(
        REVIEWED_FRACTION_LESSON_V2,
        plan as unknown as DailyPlanPreviewV2,
      );
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(FractionAdditionV2MaterializationError);
    expect((captured as Error).message).not.toContain(marker);
    expect((captured as Error).message.length).toBeLessThan(160);
  });

  it("preserves the frozen content-resolved WorksheetInstanceV1 vector", async () => {
    const v1 = await materializeFractionAdditionWorksheetFromContent(
      REVIEWED_FRACTION_LESSON_V1,
      {
        assignmentId: FRACTION_ADDITION_SAMPLE_INPUT.assignmentId,
        localStudyDate: FRACTION_ADDITION_SAMPLE_INPUT.localStudyDate,
        timeZone: FRACTION_ADDITION_SAMPLE_INPUT.timeZone,
        locale: FRACTION_ADDITION_SAMPLE_INPUT.locale,
        seed: FRACTION_ADDITION_SAMPLE_INPUT.seed,
        seedSecretVersion: FRACTION_ADDITION_SAMPLE_INPUT.seedSecretVersion,
        requestedItemCount: FRACTION_ADDITION_SAMPLE_INPUT.itemCount,
        plan: FRACTION_ADDITION_SAMPLE_INPUT.plan,
        policy: FRACTION_ADDITION_SAMPLE_INPUT.policy,
        skillGraph: FRACTION_ADDITION_SAMPLE_INPUT.skillGraph,
        selectionReasons: FRACTION_ADDITION_SAMPLE_INPUT.selectionReasons,
      },
    );

    expect(v1.instanceHash).toBe(
      "5252ef64b127638b785a94b3a2c7d1859cd7299e7032bed10aa41e07b2c4d12b",
    );
  });
});

function mutablePlanV2(plan: DailyPlanPreviewV2): MutablePlanProbe {
  return structuredClone(plan) as unknown as MutablePlanProbe;
}

async function createRealPlanV2(
  practiceMinutes: 8 | 12 | 20,
  localStudyDate = "2026-07-19",
): Promise<DailyPlanPreviewV2> {
  const result = await planDailyPreviewV2(
    {
      schema: DAILY_PLAN_PREVIEW_REQUEST_V2_SCHEMA,
      goalId: "math.fractions.add-unlike",
      practiceMinutes,
      localStudyDate,
      timeZone: "Asia/Tokyo",
      locale: "en",
    },
    DAY_ONE_PREVIEW_REGISTRY_V2,
  );
  if (result.status !== "ready") {
    throw new Error("The finalized V2 registry must produce a ready plan");
  }
  return result.plan;
}

function studyDateForIndex(index: number): string {
  return new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
}
