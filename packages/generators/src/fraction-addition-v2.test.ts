import { describe, expect, it } from "vitest";

import { canonicalizeJson, equalRationals, sha256Hex } from "@exercisebook/domain";
import {
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
  type FractionAdditionAssignmentInputV2,
} from "./fraction-addition-v2.js";
import { PresentationResolutionError } from "./fraction-presentation-v1.js";

const FINAL_SOURCE_HASH =
  "456c8908debd52c7fcc5eba6e2e9a38434b5fcd8343e7a14a427faae34502523";
const FINAL_CONTENT_HASH =
  "944225a2dda87ae6ee61e53f21a929301f5264793d665ea2200b65fb0f5a71dd";

const REVIEWED_FRACTION_LESSON_V1 = validateContentDocumentV1(compiledFractionLessonV1);
const REVIEWED_FRACTION_LESSON_V2 = validateContentDocumentV2(compiledFractionLessonV2);

const PRESENTATION_SELECTION = {
  explanationNodeId: "lesson-explanation-01",
  workedExampleNodeId: "worked-example-01",
  exerciseNodeId: "practice-01",
  excludedCanonicalAnswers: [
    { numerator: "1", denominator: "2" },
    { numerator: "1", denominator: "3" },
    { numerator: "5", denominator: "6" },
  ],
} as const;

const ASSIGNMENT_V2: FractionAdditionAssignmentInputV2 = {
  assignmentId: "preview-p17-v2",
  localStudyDate: "2026-07-19",
  timeZone: "Asia/Tokyo",
  locale: "en",
  seed: "0123456789abcdef".repeat(4),
  seedSecretVersion: "public-preview-v2",
  requestedItemCount: 8,
  plan: { id: "preview-p17-v2", version: 2 },
  policy: { id: "day-one-fraction-preview", version: 3 },
  skillGraph: { id: "phase-1-math", revision: 1 },
  selectionReasons: ["current-frontier"],
  content: {
    id: "math.fractions.add-unlike-denominators",
    revision: 2,
    sourceHash: FINAL_SOURCE_HASH,
    contentHash: FINAL_CONTENT_HASH,
    compilerVersion: "exercisebook-content-compiler/2",
  },
  presentationSelection: PRESENTATION_SELECTION,
};

describe("fractions.add@1 WorksheetInstanceV2 materializer", () => {
  it("materializes byte-identical validated instances and freezes the v2 vector", async () => {
    const first = await materializeV2();
    const second = await materializeV2();

    expect(validateWorksheetInstanceV2(first.instance)).toEqual(first.instance);
    expect(first.canonicalJson).toBe(canonicalizeJson(first.instance));
    expect(first.canonicalJson).toBe(second.canonicalJson);
    expect(first.instanceHash).toBe(second.instanceHash);
    expect(first.instanceHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.instanceHash).toBe(
      "318c97a01880bf253ae3fb2c5ed58cfe9eb5111436e1a70555607788ace7c039",
    );
  });

  it("keeps 4, 6, and 8 item materializations as stable slot prefixes", async () => {
    const [four, six, eight] = await Promise.all([
      materializeV2({ requestedItemCount: 4 }),
      materializeV2({ requestedItemCount: 6 }),
      materializeV2({ requestedItemCount: 8 }),
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

  it("rejects requests beyond the eight reviewed exercise items", async () => {
    await expect(materializeV2({ requestedItemCount: 9 })).rejects.toMatchObject({
      name: "FractionAdditionV2MaterializationError",
      code: "invalid-assignment",
    });
  });

  it("rejects unsupported and document-mismatched locales before hashing", async () => {
    await expect(materializeV2({ locale: "ja" })).rejects.toMatchObject({
      name: "FractionAdditionV2MaterializationError",
      code: "locale-mismatch",
    });

    const mismatchedDocument = structuredClone(REVIEWED_FRACTION_LESSON_V2);
    mismatchedDocument.locale = "ja";
    await expect(
      materializeFractionAdditionWorksheetFromContentV2(
        mismatchedDocument,
        ASSIGNMENT_V2,
      ),
    ).rejects.toMatchObject({
      name: "FractionAdditionV2MaterializationError",
      code: "locale-mismatch",
    });
  });

  it("excludes all worked-example operands and result across broad deterministic seeds", async () => {
    const excluded = PRESENTATION_SELECTION.excludedCanonicalAnswers;
    for (let seedIndex = 0; seedIndex < 128; seedIndex += 1) {
      const materialized = await materializeV2({
        seed: seedIndex.toString(16).padStart(64, "0"),
      });
      for (const slot of materialized.instance.slots) {
        expect(
          excluded.some((value) => equalRationals(slot.canonicalAnswer.value, value)),
        ).toBe(false);
      }
    }
  }, 30_000);

  it("derives instruction, provenance, title, skills, and attribution from one document", async () => {
    const materialized = await materializeV2();

    expect(materialized.instance.title).toBe(REVIEWED_FRACTION_LESSON_V2.title);
    expect(materialized.instance.presentation.exercise.instruction).toBe(
      "Add each pair of fractions. Give every answer in lowest terms.",
    );
    expect(materialized.instance.content).toEqual([ASSIGNMENT_V2.content]);
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
          slot.skillIds[0] === "math.fractions.add-unlike" &&
          slot.provenance.contentId === ASSIGNMENT_V2.content.id &&
          slot.provenance.contentRevision === ASSIGNMENT_V2.content.revision &&
          slot.provenance.sourceHash === ASSIGNMENT_V2.content.sourceHash &&
          slot.provenance.contentHash === ASSIGNMENT_V2.content.contentHash &&
          slot.provenance.compilerVersion === ASSIGNMENT_V2.content.compilerVersion &&
          slot.provenance.generatorId === "fractions.add" &&
          slot.provenance.generatorVersion === "1" &&
          slot.provenance.generationAttempt >= 0 &&
          slot.provenance.generationAttempt <= 127,
      ),
    ).toBe(true);
  });

  it("includes the full presentation and pinned identity in canonical hash semantics", async () => {
    const original = await materializeV2();
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

  it("rejects a changed fixed node selection before generating an instance", async () => {
    await expect(
      materializeV2({
        presentationSelection: {
          ...PRESENTATION_SELECTION,
          explanationNodeId: "alternate-explanation",
        },
      }),
    ).rejects.toMatchObject({
      name: "PresentationResolutionError",
      code: "invalid-selection",
    });
  });

  it("uses one detached pre-await snapshot when callers mutate document and assignment", async () => {
    const baselineDocument = structuredClone(REVIEWED_FRACTION_LESSON_V2);
    const baselineAssignment = structuredClone(ASSIGNMENT_V2);
    const baseline = await materializeFractionAdditionWorksheetFromContentV2(
      baselineDocument,
      baselineAssignment,
    );
    const racedDocument = structuredClone(REVIEWED_FRACTION_LESSON_V2);
    const racedAssignment = structuredClone(ASSIGNMENT_V2);
    const mutableRacedAssignment = racedAssignment as unknown as {
      seed: string;
      assignmentId: string;
      presentationSelection: {
        excludedCanonicalAnswers: Array<{
          numerator: string;
          denominator: string;
        }>;
      };
    };

    const pending = materializeFractionAdditionWorksheetFromContentV2(
      racedDocument,
      racedAssignment,
    );
    racedDocument.title = "Caller-mutated title";
    racedDocument.authors[0] = { name: "Caller mutation", role: "author" };
    const explanation = racedDocument.nodes.find((node) => node.type === "explanation");
    if (explanation?.type === "explanation") {
      explanation.paragraphs[0] = "Caller-mutated paragraph";
    }
    mutableRacedAssignment.seed = "f".repeat(64);
    mutableRacedAssignment.assignmentId = "caller-mutated-assignment";
    mutableRacedAssignment.presentationSelection.excludedCanonicalAnswers[0] = {
      numerator: "9",
      denominator: "10",
    };

    const raced = await pending;
    expect(raced).toEqual(baseline);
    expect(raced.canonicalJson).not.toContain("Caller-mutated");
  });

  it("rejects accessor-bearing caller data without invoking accessors", async () => {
    let getterRan = false;
    const hostileAssignment = {
      ...structuredClone(ASSIGNMENT_V2),
    } as Record<string, unknown>;
    Object.defineProperty(hostileAssignment, "seed", {
      enumerable: true,
      get() {
        getterRan = true;
        return ASSIGNMENT_V2.seed;
      },
    });

    await expect(
      materializeFractionAdditionWorksheetFromContentV2(
        REVIEWED_FRACTION_LESSON_V2,
        hostileAssignment as unknown as FractionAdditionAssignmentInputV2,
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
    "maps hostile selection rational $numerator/$denominator to a typed error",
    async (hostile) => {
      const action = materializeV2({
        presentationSelection: {
          ...PRESENTATION_SELECTION,
          excludedCanonicalAnswers: [
            hostile,
            PRESENTATION_SELECTION.excludedCanonicalAnswers[1],
            PRESENTATION_SELECTION.excludedCanonicalAnswers[2],
          ],
        },
      });

      await expect(action).rejects.toBeInstanceOf(PresentationResolutionError);
      await expect(action).rejects.not.toBeInstanceOf(SyntaxError);
      await expect(action).rejects.not.toBeInstanceOf(RangeError);
    },
  );

  it("rejects a document whose computed hash differs from the pinned assignment", async () => {
    const changed = structuredClone(REVIEWED_FRACTION_LESSON_V2);
    changed.title = "Schema-valid but unreviewed title";

    await expect(
      materializeFractionAdditionWorksheetFromContentV2(changed, ASSIGNMENT_V2),
    ).rejects.toMatchObject({
      name: "PresentationResolutionError",
      code: "content-identity-mismatch",
    });
  });

  it("maps opaque function and symbol selection values without leaking DataCloneError", async () => {
    for (const hostile of [() => undefined, Symbol("opaque-selection")]) {
      const action = materializeV2({
        presentationSelection: {
          ...PRESENTATION_SELECTION,
          excludedCanonicalAnswers: [
            hostile as never,
            PRESENTATION_SELECTION.excludedCanonicalAnswers[1],
            PRESENTATION_SELECTION.excludedCanonicalAnswers[2],
          ],
        },
      });

      await expect(action).rejects.toMatchObject({
        name: "PresentationResolutionError",
        code: "invalid-selection",
      });
      await expect(action).rejects.not.toBeInstanceOf(DOMException);
    }
  });

  it("returns fixed bounded materialization diagnostics without echoing caller data", async () => {
    const marker = "DO-NOT-ECHO-MATERIALIZER-CONTENT";
    let captured: unknown;
    try {
      await materializeV2({ assignmentId: marker as never });
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

async function materializeV2(
  overrides: Partial<FractionAdditionAssignmentInputV2> = {},
) {
  return materializeFractionAdditionWorksheetFromContentV2(
    REVIEWED_FRACTION_LESSON_V2,
    {
      ...ASSIGNMENT_V2,
      ...overrides,
    },
  );
}
