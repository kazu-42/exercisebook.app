import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import { materializeFractionAdditionWorksheetFromContentV2 } from "@exercisebook/generators";
import {
  validateContentDocumentV2,
  validateWorksheetInstanceV2,
  type MaterializedWorksheetInstanceV2,
} from "@exercisebook/schemas";

import compiledFractionLessonV2 from "../../../../content/compiled/math.fractions.add-unlike-denominators.v2.json" with { type: "json" };

const REVIEWED_FRACTION_LESSON_V2 = validateContentDocumentV2(compiledFractionLessonV2);

const PINNED_TWELVE_MINUTE_PLAN_V2 = {
  schema: "exercisebook.daily-plan-preview/v2",
  id: "preview-d8e7bffb76e814cf8fed232ed5817008d9291247f94d4e63bda6fbeb647daf33",
  goalId: "math.fractions.add-unlike",
  localStudyDate: "2026-07-19",
  timeZone: "Asia/Tokyo",
  locale: "en",
  requestedPracticeMinutes: 12,
  plannedPracticeMinutes: 12,
  evidence: {
    kind: "none",
    version: 1,
  },
  policy: {
    id: "day-one-fraction-preview",
    version: 3,
  },
  skillGraph: {
    id: "phase-1-math",
    revision: 1,
  },
  activities: [
    {
      id: "current-frontier-practice",
      kind: "practice",
      skillId: "math.fractions.add-unlike",
      content: {
        id: "math.fractions.add-unlike-denominators",
        revision: 2,
        sourceHash: "456c8908debd52c7fcc5eba6e2e9a38434b5fcd8343e7a14a427faae34502523",
        contentHash: "944225a2dda87ae6ee61e53f21a929301f5264793d665ea2200b65fb0f5a71dd",
        compilerVersion: "exercisebook-content-compiler/2",
      },
      generatorId: "fractions.add",
      generatorVersion: "1",
      itemCount: 6,
      expectedMinutes: 12,
      selectionReasons: ["current-frontier"],
      selectionExplanation:
        "This focused set practices the fraction goal you selected. It is a preview based on your goal and time limit, not a saved or mastery-based plan.",
      presentationSelection: {
        explanationNodeId: "lesson-explanation-01",
        workedExampleNodeId: "worked-example-01",
        exerciseNodeId: "practice-01",
        excludedCanonicalAnswers: [
          {
            numerator: "1",
            denominator: "2",
          },
          {
            numerator: "1",
            denominator: "3",
          },
          {
            numerator: "5",
            denominator: "6",
          },
        ],
      },
    },
  ],
  generation: {
    baseSeed: "338bee573add98fce96ae0616b008d002f1bb613bcbb805d6b291ce34bb1671f",
    seedVersion: "public-preview-v2",
  },
} as const satisfies Parameters<
  typeof materializeFractionAdditionWorksheetFromContentV2
>[1];

export async function createMaterializedWorksheetV2Fixture(): Promise<MaterializedWorksheetInstanceV2> {
  return materializeFractionAdditionWorksheetFromContentV2(
    REVIEWED_FRACTION_LESSON_V2,
    PINNED_TWELVE_MINUTE_PLAN_V2,
  );
}

export async function rematerializeWorksheetV2Fixture(
  instanceValue: unknown,
): Promise<MaterializedWorksheetInstanceV2> {
  const instance = validateWorksheetInstanceV2(instanceValue);
  const canonicalJson = canonicalizeJson(instance);
  return {
    instance,
    canonicalJson,
    instanceHash: await sha256Hex(canonicalJson),
  };
}
