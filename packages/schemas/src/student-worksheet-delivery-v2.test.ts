import { describe, expect, expectTypeOf, it } from "vitest";

import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";

import * as PublicSchemas from "./index.js";
// @ts-expect-error Trusted canonical-answer context must not be root-exported.
import type { StudentWorksheetProjectionV2 as ForbiddenPublicProjectionV2 } from "./index.js";
import {
  WORKSHEET_DELIVERY_V2_SCHEMA,
  assertPresentationIntermediatesDoNotMatchCanonicalAnswers,
  projectWorksheetV2ForStudent,
  validateStudentWorksheetDeliveryV2,
} from "./student-worksheet-delivery-v2.js";
import { projectWorksheetV2ForStudentWithCanonicalAnswers } from "./trusted-student-projection.js";
import type { StudentWorksheetProjectionV2 as TrustedStudentWorksheetProjectionV2 } from "./trusted-student-projection.js";
import { validateWorksheetInstanceV2 } from "./worksheet-instance-v2.js";
import type {
  MaterializedWorksheetInstanceV2,
  WorksheetInstanceV2,
} from "./worksheet-instance-v2.js";

const NORMALIZATION_COMPOSITION_ANSWER_CASES = [
  ["NFKC-created percent escape", "The answer is 39%EF%BC%852F35."],
  ["NFKC-created hexadecimal digits", "The answer is 39%25%EF%BC%92%EF%BC%A635."],
  [
    "decoded fullwidth plus and percent",
    "The%EF%BC%8Banswer%EF%BC%8Bis%EF%BC%8B39%EF%BC%852F35.",
  ],
  [
    "decoded ASCII/fullwidth plus and percent",
    "The%2Banswer%EF%BC%8Bis%2B39%EF%BC%852F35.",
  ],
  ["malformed URI fallback", "The answer is 39%EF%BC%852F35%ZZ"],
] as const;

const BENIGN_NORMALIZATION_COMPOSITION_CASES = [
  ["NFKC-created slash", "Use%EF%BC%852Fto compare fractions."],
  ["decoded fullwidth plus", "Review%EF%BC%8Bequivalent%EF%BC%8Bfractions."],
  ["decoded ASCII/fullwidth plus", "Review%2Bequivalent%EF%BC%8Bfractions."],
  ["malformed URI fallback", "Use%EF%BC%852Fto compare fractions.%ZZ"],
  ["different rational value", "The answer is 38%EF%BC%852F35."],
  ["leading encoded percent before a different rational", "The answer is %2538%2F35."],
] as const;

describe("StudentWorksheetDeliveryV2", () => {
  it("projects one strict answer-free delivery with the committed presentation", async () => {
    const materialized = await materializeWorksheetV2Fixture();
    const delivery = await projectWorksheetV2ForStudent(materialized);

    expect(delivery).toEqual({
      schema: WORKSHEET_DELIVERY_V2_SCHEMA,
      instanceHash: materialized.instanceHash,
      assignmentId: materialized.instance.assignmentId,
      title: materialized.instance.title,
      localStudyDate: materialized.instance.localStudyDate,
      timeZone: materialized.instance.timeZone,
      locale: materialized.instance.locale,
      expectedMinutes: materialized.instance.expectedMinutes,
      presentation: materialized.instance.presentation,
      slots: materialized.instance.slots.map((slot) => ({
        id: slot.id,
        skillIds: slot.skillIds,
        selectionReasons: slot.selectionReasons,
        expectedMinutes: slot.expectedMinutes,
        prompt: slot.prompt,
        hints: slot.hints,
        accessibility: slot.accessibility,
        printFallback: slot.printFallback,
        provenance: slot.provenance,
      })),
      attributions: materialized.instance.attributions,
    });
    expect(JSON.stringify(delivery)).not.toMatch(
      /slotSeed|canonicalAnswer|scoringRule|solutionTrace|misconceptions/u,
    );
  });

  it.each([
    ["plan", { id: "forbidden", version: 1 }],
    ["policy", { id: "forbidden", version: 1 }],
    ["skillGraph", { id: "forbidden", revision: 1 }],
    ["rng", { algorithm: "xoshiro128ss-v1" }],
    ["content", []],
  ] as const)("rejects forbidden top-level field %s", async (field, value) => {
    const delivery = await projectWorksheetV2ForStudent(
      await materializeWorksheetV2Fixture(),
    );

    expect(() =>
      validateStudentWorksheetDeliveryV2({ ...delivery, [field]: value }),
    ).toThrow();
  });

  it.each([
    ["slotSeed", "0".repeat(64)],
    [
      "canonicalAnswer",
      { type: "rational", value: { numerator: "39", denominator: "35" } },
    ],
    [
      "scoringRule",
      {
        type: "rational-equals",
        accepted: { numerator: "39", denominator: "35" },
        requireReduced: true,
      },
    ],
    ["solutionTrace", []],
    ["misconceptions", []],
  ] as const)("rejects forbidden slot field %s", async (field, value) => {
    const delivery = await projectWorksheetV2ForStudent(
      await materializeWorksheetV2Fixture(),
    );
    const [firstSlot, ...remainingSlots] = delivery.slots;
    if (firstSlot === undefined) {
      throw new Error("Expected a worksheet slot");
    }

    expect(() =>
      validateStudentWorksheetDeliveryV2({
        ...delivery,
        slots: [{ ...firstSlot, [field]: value }, ...remainingSlots],
      }),
    ).toThrow();
  });

  it("rejects missing or non-strict presentation data", async () => {
    const delivery = await projectWorksheetV2ForStudent(
      await materializeWorksheetV2Fixture(),
    );
    const { presentation: _presentation, ...withoutPresentation } = delivery;

    expect(() => validateStudentWorksheetDeliveryV2(withoutPresentation)).toThrow();
    expect(() =>
      validateStudentWorksheetDeliveryV2({
        ...delivery,
        presentation: {
          ...delivery.presentation,
          lesson: {
            ...delivery.presentation.lesson,
            unsupported: true,
          },
        },
      }),
    ).toThrow();
  });

  it.each([
    ["left scaled numerator", { numerator: "1", denominator: "2" }],
    ["right scaled numerator", { numerator: "1", denominator: "3" }],
    ["unreduced sum numerator", { numerator: "5", denominator: "6" }],
  ] as const)(
    "recognizes the %s intermediate by exact rational equality",
    (_field, answer) => {
      const presentation = worksheetInstanceV2Fixture().presentation;

      expect(() =>
        assertPresentationIntermediatesDoNotMatchCanonicalAnswers(presentation, [
          answer,
        ]),
      ).toThrow("canonical-answer");
    },
  );

  it.each([
    [
      "pretty-printed",
      (instance: WorksheetInstanceV2) => JSON.stringify(instance, null, 2),
    ],
    [
      "noncanonical key order",
      (instance: WorksheetInstanceV2) => JSON.stringify(instance),
    ],
  ] as const)(
    "rejects %s JSON even when it represents the same instance",
    async (_scenario, serialize) => {
      const materialized = await materializeWorksheetV2Fixture();

      await expect(
        projectWorksheetV2ForStudent({
          ...materialized,
          canonicalJson: serialize(materialized.instance),
        }),
      ).rejects.toThrow("canonical JSON");
    },
  );

  it("rejects a hash that differs from the captured canonical JSON", async () => {
    const materialized = await materializeWorksheetV2Fixture();

    await expect(
      projectWorksheetV2ForStudent({
        ...materialized,
        instanceHash: "f".repeat(64),
      }),
    ).rejects.toThrow("instance hash");
  });

  it("rejects accessor-bearing materialization data without invoking accessors", async () => {
    const materialized = await materializeWorksheetV2Fixture();
    let envelopeGetterRan = false;
    const hostileEnvelope = { ...materialized } as Record<string, unknown>;
    Object.defineProperty(hostileEnvelope, "instance", {
      enumerable: true,
      get() {
        envelopeGetterRan = true;
        return materialized.instance;
      },
    });

    await expect(
      projectWorksheetV2ForStudent(hostileEnvelope as never),
    ).rejects.toThrow("Accessor");
    expect(envelopeGetterRan).toBe(false);

    let nestedGetterRan = false;
    const hostileInstance = structuredClone(materialized);
    Object.defineProperty(hostileInstance.instance.presentation.lesson, "title", {
      enumerable: true,
      get() {
        nestedGetterRan = true;
        return "Hostile title";
      },
    });

    await expect(projectWorksheetV2ForStudent(hostileInstance)).rejects.toThrow(
      "Accessor",
    );
    expect(nestedGetterRan).toBe(false);
  });

  it("rejects a cyclic materialization graph before projection", async () => {
    const materialized = await materializeWorksheetV2Fixture();
    const hostile = { ...materialized } as Record<string, unknown>;
    hostile.cycle = hostile;

    await expect(projectWorksheetV2ForStudent(hostile as never)).rejects.toThrow(
      "Cyclic",
    );
  });

  it("authorizes one detached snapshot when the caller mutates during hashing", async () => {
    const materialized = await materializeWorksheetV2Fixture();
    const expectedAnswer = structuredClone(
      materialized.instance.slots[0]!.canonicalAnswer.value,
    );
    const expectedPresentation = structuredClone(materialized.instance.presentation);
    const expectedHash = materialized.instanceHash;

    const pending = projectWorksheetV2ForStudentWithCanonicalAnswers(materialized);
    const mutableEnvelope = materialized as {
      canonicalJson: string;
      instanceHash: string;
    };
    mutableEnvelope.canonicalJson = "{}";
    mutableEnvelope.instanceHash = "f".repeat(64);
    materialized.instance.title = "Caller-mutated title";
    materialized.instance.presentation.lesson.title = "Caller-mutated lesson";
    materialized.instance.slots[0]!.canonicalAnswer.value = {
      numerator: "7",
      denominator: "8",
    };

    const projection = await pending;
    expect(projection.delivery.instanceHash).toBe(expectedHash);
    expect(projection.delivery.title).not.toContain("Caller-mutated");
    expect(projection.delivery.presentation).toEqual(expectedPresentation);
    expect(projection.canonicalAnswers).toEqual([expectedAnswer]);
  });

  it("returns delivery and trusted answers detached from caller-owned data", async () => {
    const materialized = await materializeWorksheetV2Fixture();
    const originalTitle = materialized.instance.presentation.lesson.title;
    const originalAnswer = structuredClone(
      materialized.instance.slots[0]!.canonicalAnswer.value,
    );
    const projection =
      await projectWorksheetV2ForStudentWithCanonicalAnswers(materialized);

    materialized.instance.presentation.lesson.title = "Mutated after projection";
    materialized.instance.slots[0]!.canonicalAnswer.value.numerator = "7";
    expect(projection.delivery.presentation.lesson.title).toBe(originalTitle);
    expect(projection.canonicalAnswers).toEqual([originalAnswer]);

    const mutableDelivery = projection.delivery as {
      presentation: { lesson: { title: string } };
    };
    const mutableAnswers = projection.canonicalAnswers as Array<{
      numerator: string;
      denominator: string;
    }>;
    mutableDelivery.presentation.lesson.title = "Mutated returned delivery";
    mutableAnswers[0]!.numerator = "9";
    expect(materialized.instance.presentation.lesson.title).toBe(
      "Mutated after projection",
    );
    expect(materialized.instance.slots[0]!.canonicalAnswer.value.numerator).toBe("7");
  });

  it("validates into a detached student delivery", async () => {
    const projected = await projectWorksheetV2ForStudent(
      await materializeWorksheetV2Fixture(),
    );
    const callerOwned = structuredClone(projected);
    const validated = validateStudentWorksheetDeliveryV2(callerOwned);

    callerOwned.presentation.lesson.title = "Caller mutation";
    callerOwned.slots[0]!.hints[0]!.text = "Caller mutation";
    expect(validated.presentation.lesson.title).not.toBe("Caller mutation");
    expect(validated.slots[0]!.hints[0]!.text).not.toBe("Caller mutation");
  });

  it("exports only the answer-free V2 projector from the public schema root", () => {
    expect(PublicSchemas).toHaveProperty("projectWorksheetV2ForStudent");
    expect(PublicSchemas).toHaveProperty("validateStudentWorksheetDeliveryV2");
    expect(PublicSchemas).not.toHaveProperty(
      "projectWorksheetV2ForStudentWithCanonicalAnswers",
    );
    expect(PublicSchemas).not.toHaveProperty(
      "projectWorksheetForStudentWithCanonicalAnswers",
    );
    expect(PublicSchemas).not.toHaveProperty(
      "assertPresentationIntermediatesDoNotMatchCanonicalAnswers",
    );
    expectTypeOf<TrustedStudentWorksheetProjectionV2>().toHaveProperty("delivery");
    expectTypeOf<TrustedStudentWorksheetProjectionV2>().toHaveProperty(
      "canonicalAnswers",
    );
  });

  it("rejects the V1 delivery discriminator and compiler-v1 presentation or provenance", async () => {
    const delivery = await projectWorksheetV2ForStudent(
      await materializeWorksheetV2Fixture(),
    );
    expect(() =>
      validateStudentWorksheetDeliveryV2({
        ...delivery,
        schema: "exercisebook.worksheet-delivery/v1",
      }),
    ).toThrow();

    const presentationV1 = structuredClone(delivery);
    presentationV1.presentation.content.compilerVersion =
      "exercisebook-content-compiler/1" as never;
    expect(() => validateStudentWorksheetDeliveryV2(presentationV1)).toThrow();

    const provenanceV1 = structuredClone(delivery);
    provenanceV1.slots[0]!.provenance.compilerVersion =
      "exercisebook-content-compiler/1" as never;
    expect(() => validateStudentWorksheetDeliveryV2(provenanceV1)).toThrow();
  });

  it.each([
    [
      "lesson title",
      (instance: WorksheetInstanceV2, leak: string) => {
        instance.presentation.lesson.title = leak;
      },
    ],
    [
      "lesson paragraph",
      (instance: WorksheetInstanceV2, leak: string) => {
        instance.presentation.lesson.paragraphs[0] = leak;
      },
    ],
    [
      "worked-example title",
      (instance: WorksheetInstanceV2, leak: string) => {
        instance.presentation.workedExample.title = leak;
      },
    ],
    [
      "worked-example step",
      (instance: WorksheetInstanceV2, leak: string) => {
        instance.presentation.workedExample.steps[0] = leak;
      },
    ],
    [
      "exercise instruction",
      (instance: WorksheetInstanceV2, leak: string) => {
        instance.presentation.exercise.instruction = leak;
        for (const slot of instance.slots) {
          slot.prompt.instruction = leak;
        }
      },
    ],
    [
      "global title",
      (instance: WorksheetInstanceV2, leak: string) => {
        instance.title = leak;
      },
    ],
    [
      "attribution",
      (instance: WorksheetInstanceV2, leak: string) => {
        instance.attributions[0]!.attributionText = leak;
      },
    ],
  ] as const)(
    "rejects a generated practice answer injected into the %s",
    async (_field, mutate) => {
      const materialized = await materializeWorksheetV2Fixture();
      const instance = structuredClone(materialized.instance);
      mutate(instance, "The generated answer is 39/35.");

      await expect(
        projectWorksheetV2ForStudent(await rematerializeWorksheetV2Fixture(instance)),
      ).rejects.toThrow("canonical-answer");
    },
  );

  it.each(NORMALIZATION_COMPOSITION_ANSWER_CASES)(
    "rejects %s through the V2 student projector",
    async (_case, text) => {
      const materialized = await materializeWorksheetV2Fixture();
      const instance = structuredClone(materialized.instance);
      instance.presentation.lesson.paragraphs[0] = text;

      await expect(
        projectWorksheetV2ForStudent(await rematerializeWorksheetV2Fixture(instance)),
      ).rejects.toThrow("canonical-answer");
    },
  );

  it("rejects a raw-vs-collapsed URI answer through the V2 student projector", async () => {
    const materialized = await materializeWorksheetV2Fixture();
    const instance = structuredClone(materialized.instance);
    instance.presentation.lesson.paragraphs[0] = "The answer is %2539%2F35.";

    await expect(
      projectWorksheetV2ForStudent(await rematerializeWorksheetV2Fixture(instance)),
    ).rejects.toThrow("canonical-answer");
  });

  it.each(BENIGN_NORMALIZATION_COMPOSITION_CASES)(
    "allows benign %s through the V2 student projector",
    async (_case, text) => {
      const materialized = await materializeWorksheetV2Fixture();
      const instance = structuredClone(materialized.instance);
      instance.presentation.lesson.paragraphs[0] = text;

      await expect(
        projectWorksheetV2ForStudent(await rematerializeWorksheetV2Fixture(instance)),
      ).resolves.toMatchObject({
        presentation: {
          lesson: {
            paragraphs: [text],
          },
        },
      });
    },
  );

  it.each([1, 2, 3, 32])(
    "rejects a compatibility-normalized answer through the V2 projector after %i URI-encoding layers",
    async (encodingDepth) => {
      const materialized = await materializeWorksheetV2Fixture();
      const instance = structuredClone(materialized.instance);
      instance.presentation.lesson.paragraphs[0] = encodeUriComponentRepeatedly(
        "The answer is 39％2F35.",
        encodingDepth,
      );

      await expect(
        projectWorksheetV2ForStudent(await rematerializeWorksheetV2Fixture(instance)),
      ).rejects.toThrow("canonical-answer");
    },
  );

  it.each([1, 2, 3, 32])(
    "allows compatibility-normalized benign text through the V2 projector after %i URI-encoding layers",
    async (encodingDepth) => {
      const materialized = await materializeWorksheetV2Fixture();
      const instance = structuredClone(materialized.instance);
      const text = encodeUriComponentRepeatedly(
        "Use％2Fto compare fractions.",
        encodingDepth,
      );
      instance.presentation.lesson.paragraphs[0] = text;

      await expect(
        projectWorksheetV2ForStudent(await rematerializeWorksheetV2Fixture(instance)),
      ).resolves.toMatchObject({
        presentation: {
          lesson: {
            paragraphs: [text],
          },
        },
      });
    },
  );

  it.each([
    "The answer is 39/35",
    "The answer is 39 / 35",
    "The answer is 39⁄35",
    "The answer is 39∕35",
    "The answer is 39 over 35",
    String.raw`The answer is \frac{39}{35}`,
    "The%20answer%20is%2039%2F35",
    String.raw`{"numerator":"39","denominator":"35"}`,
  ])("rejects recognized answer encoding in presentation prose: %s", async (text) => {
    const materialized = await materializeWorksheetV2Fixture();
    const instance = structuredClone(materialized.instance);
    instance.presentation.lesson.paragraphs[0] = text;

    await expect(
      projectWorksheetV2ForStudent(await rematerializeWorksheetV2Fixture(instance)),
    ).rejects.toThrow("canonical-answer");
  });

  it.each([
    "The answer is 39%25%32%46" + "35.",
    "The answer is 39%25%32%46" + "35%ZZ",
    "The answer is 39%25%32%46" + "35%E0%A4%A",
  ])("rejects a mixed URI-encoded answer in presentation prose: %s", async (text) => {
    const materialized = await materializeWorksheetV2Fixture();
    const instance = structuredClone(materialized.instance);
    instance.presentation.lesson.paragraphs[0] = text;

    await expect(
      projectWorksheetV2ForStudent(await rematerializeWorksheetV2Fixture(instance)),
    ).rejects.toThrow("canonical-answer");
  });

  it("allows benign mixed URI-encoded presentation prose", async () => {
    const materialized = await materializeWorksheetV2Fixture();
    const instance = structuredClone(materialized.instance);
    instance.presentation.lesson.paragraphs[0] =
      "Use%25%32%46to compare numerator and denominator.";

    await expect(
      projectWorksheetV2ForStudent(await rematerializeWorksheetV2Fixture(instance)),
    ).resolves.toMatchObject({
      presentation: {
        lesson: {
          paragraphs: ["Use%25%32%46to compare numerator and denominator."],
        },
      },
    });
  });

  it("allows a prompt operand equal to another slot's canonical answer", async () => {
    const materialized = await materializeWorksheetV2Fixture(true);

    await expect(projectWorksheetV2ForStudent(materialized)).resolves.toMatchObject({
      slots: [
        { id: "practice-01" },
        {
          id: "practice-02",
          prompt: {
            left: { numerator: "39", denominator: "35" },
            accessibleText:
              "Add 39 over 35 and 1 over 2. Give the answer in lowest terms.",
          },
          accessibility: {
            summary: "Fraction addition problem: 39 over 35 plus 1 over 2.",
          },
        },
      ],
    });
  });

  it.each(["hint", "print fallback"] as const)(
    "rejects another slot's answer in a practice %s",
    async (field) => {
      const materialized = await materializeWorksheetV2Fixture(true);
      const instance = structuredClone(materialized.instance);
      const target = instance.slots[0]!;
      if (field === "hint") {
        target.hints[0]!.text = "The other generated answer is 113/70.";
      } else {
        target.printFallback.text = "The other generated answer is 113/70.";
      }

      await expect(
        projectWorksheetV2ForStudent(await rematerializeWorksheetV2Fixture(instance)),
      ).rejects.toThrow("canonical-answer");
    },
  );

  it("rejects another slot's answer in a global attribution URL", async () => {
    const materialized = await materializeWorksheetV2Fixture(true);
    const instance = structuredClone(materialized.instance);
    instance.attributions[0]!.sourceUrl = "https://exercisebook.app/%31%31%33%2F%37%30";

    await expect(
      projectWorksheetV2ForStudent(await rematerializeWorksheetV2Fixture(instance)),
    ).rejects.toThrow("canonical-answer");
  });

  it("rejects another slot's raw-vs-collapsed URI answer", async () => {
    const materialized = await materializeWorksheetV2Fixture(true);
    const instance = structuredClone(materialized.instance);
    instance.attributions[0]!.sourceUrl = "https://exercisebook.app/%25113%2F70";

    await expect(
      projectWorksheetV2ForStudent(await rematerializeWorksheetV2Fixture(instance)),
    ).rejects.toThrow("canonical-answer");
  });

  it("shares one aggregate answer-scan budget across the V2 delivery phase", async () => {
    const instance = structuredClone(worksheetInstanceV2Fixture());
    const sourceSlot = instance.slots[0]!;
    // These exact schema maxima contribute 125, 250, and 500 benign
    // candidates. Every individual assertion stays below 4,096 while the
    // shared 12-slot delivery phase deterministically exceeds 8,192.
    const denseInstruction = "1/2 ".repeat(125);
    const denseHint = "1/2 ".repeat(250);
    const densePrintFallback = "1/2 ".repeat(500);

    instance.presentation.exercise.instruction = denseInstruction;
    instance.slots = Array.from({ length: 12 }, (_, index) => {
      const slot = structuredClone(sourceSlot);
      const ordinal = String(index + 1).padStart(2, "0");

      slot.id = `practice-${ordinal}`;
      slot.slotSeed = (index + 2).toString(16).repeat(64);
      slot.prompt.instruction = denseInstruction;
      slot.hints[0]!.id = `hint-common-denominator-${ordinal}`;
      slot.hints[0]!.text = denseHint;
      slot.solutionTrace[0]!.id = `step-reduce-${ordinal}`;
      slot.printFallback.text = densePrintFallback;
      slot.provenance.generationAttempt = index;
      return slot;
    });
    instance.expectedMinutes = instance.slots.reduce(
      (total, slot) => total + slot.expectedMinutes,
      0,
    );

    await expect(
      projectWorksheetV2ForStudent(await rematerializeWorksheetV2Fixture(instance)),
    ).rejects.toThrow(/prepared canonical-answer phase exceeds 8192 candidates/i);
  });

  it.each([3, 32])(
    "rejects another slot's answer in a global attribution URL after %i URI-encoding layers",
    async (encodingDepth) => {
      const materialized = await materializeWorksheetV2Fixture(true);
      const instance = structuredClone(materialized.instance);
      const encodedAnswer = encodeUriComponentRepeatedly("113/70", encodingDepth);
      instance.attributions[0]!.sourceUrl = `https://exercisebook.app/${encodedAnswer}`;

      await expect(
        projectWorksheetV2ForStudent(await rematerializeWorksheetV2Fixture(instance)),
      ).rejects.toThrow("canonical-answer");
    },
  );

  it("fails closed when answer-bearing text is placed in strict provenance", async () => {
    const materialized = await materializeWorksheetV2Fixture(true);
    const instance = structuredClone(materialized.instance);
    instance.slots[0]!.provenance.contentId = "113/70";
    const canonicalJson = canonicalizeJson(instance);

    await expect(
      projectWorksheetV2ForStudent({
        instance,
        canonicalJson,
        instanceHash: await sha256Hex(canonicalJson),
      }),
    ).rejects.toThrow();
  });

  it.each(["prompt accessible text", "accessibility summary"] as const)(
    "rejects appended answer prose in exact %s even for a cross-slot operand",
    async (field) => {
      const materialized = await materializeWorksheetV2Fixture(true);
      const instance = structuredClone(materialized.instance);
      const target = instance.slots[1]!;
      const appendedAnswer = " The generated answer is 39/35.";
      if (field === "prompt accessible text") {
        target.prompt.accessibleText += appendedAnswer;
      } else {
        target.accessibility.summary += appendedAnswer;
      }

      await expect(
        projectWorksheetV2ForStudent(await rematerializeWorksheetV2Fixture(instance)),
      ).rejects.toThrow("deterministic fraction-addition");
    },
  );

  it("rejects a practice slot's own answer as one of its prompt operands", async () => {
    const materialized = await materializeWorksheetV2Fixture();
    const instance = structuredClone(materialized.instance);
    const slot = instance.slots[0]!;
    slot.prompt.left = { ...slot.canonicalAnswer.value };
    slot.prompt.right = { numerator: "0", denominator: "1" };
    slot.prompt.accessibleText =
      "Add 39 over 35 and 0 over 1. Give the answer in lowest terms.";
    slot.accessibility.summary = "Fraction addition problem: 39 over 35 plus 0 over 1.";

    await expect(
      projectWorksheetV2ForStudent(await rematerializeWorksheetV2Fixture(instance)),
    ).rejects.toThrow("own canonical-answer value as a prompt operand");
  });
});

async function materializeWorksheetV2Fixture(
  includeCrossSlotCollision = false,
): Promise<MaterializedWorksheetInstanceV2> {
  return rematerializeWorksheetV2Fixture(
    worksheetInstanceV2Fixture(includeCrossSlotCollision),
  );
}

function encodeUriComponentRepeatedly(value: string, depth: number): string {
  let encoded = value;
  for (let layer = 0; layer < depth; layer += 1) {
    encoded = encodeURIComponent(encoded);
  }
  return encoded;
}

async function rematerializeWorksheetV2Fixture(
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

function worksheetInstanceV2Fixture(
  includeCrossSlotCollision = false,
): WorksheetInstanceV2 {
  const sourceHash = "0".repeat(64);
  const contentHash = "1".repeat(64);
  const instruction = "Add each pair of fractions. Give every answer in lowest terms.";
  const content = {
    id: "math.fractions.add-unlike-denominators",
    revision: 2,
    sourceHash,
    contentHash,
    compilerVersion: "exercisebook-content-compiler/2",
  } as const;
  const provenance = {
    contentId: content.id,
    contentRevision: content.revision,
    sourceHash,
    contentHash,
    compilerVersion: content.compilerVersion,
    generatorId: "fractions.add",
    generatorVersion: "1",
    generationAttempt: 0,
  } as const;
  const slots = [
    {
      id: "practice-01",
      skillIds: ["math.fractions.add-unlike"],
      slotSeed: "2".repeat(64),
      selectionReasons: ["current-frontier"],
      expectedMinutes: 2,
      prompt: {
        type: "fraction-addition",
        instruction,
        left: { numerator: "2", denominator: "5" },
        right: { numerator: "5", denominator: "7" },
        accessibleText: "Add 2 over 5 and 5 over 7. Give the answer in lowest terms.",
      },
      canonicalAnswer: {
        type: "rational",
        value: { numerator: "39", denominator: "35" },
      },
      scoringRule: {
        type: "rational-equals",
        accepted: { numerator: "39", denominator: "35" },
        requireReduced: true,
      },
      hints: [
        {
          id: "hint-common-denominator-01",
          text: "Find a common denominator before adding the numerators.",
        },
      ],
      solutionTrace: [
        {
          id: "step-reduce-01",
          kind: "reduce",
          explanation: "The result is already in lowest terms.",
          expression: "39/35",
          accessibleText: "Thirty-nine thirty-fifths.",
          result: { numerator: "39", denominator: "35" },
        },
      ],
      misconceptions: [],
      accessibility: {
        summary: "Fraction addition problem: 2 over 5 plus 5 over 7.",
      },
      printFallback: {
        type: "text",
        text: "Draw fraction bars and combine equal-sized parts.",
      },
      provenance,
    },
    ...(includeCrossSlotCollision
      ? [
          {
            id: "practice-02",
            skillIds: ["math.fractions.add-unlike"],
            slotSeed: "3".repeat(64),
            selectionReasons: ["current-frontier"] as const,
            expectedMinutes: 2,
            prompt: {
              type: "fraction-addition" as const,
              instruction,
              left: { numerator: "39", denominator: "35" },
              right: { numerator: "1", denominator: "2" },
              accessibleText:
                "Add 39 over 35 and 1 over 2. Give the answer in lowest terms.",
            },
            canonicalAnswer: {
              type: "rational" as const,
              value: { numerator: "113", denominator: "70" },
            },
            scoringRule: {
              type: "rational-equals" as const,
              accepted: { numerator: "113", denominator: "70" },
              requireReduced: true,
            },
            hints: [
              {
                id: "hint-common-denominator-02",
                text: "Find a common denominator before adding the numerators.",
              },
            ],
            solutionTrace: [
              {
                id: "step-reduce-02",
                kind: "reduce" as const,
                explanation: "The result is already in lowest terms.",
                expression: "113/70",
                accessibleText: "One hundred thirteen seventieths.",
                result: { numerator: "113", denominator: "70" },
              },
            ],
            misconceptions: [],
            accessibility: {
              summary: "Fraction addition problem: 39 over 35 plus 1 over 2.",
            },
            printFallback: {
              type: "text" as const,
              text: "Draw fraction bars and combine equal-sized parts.",
            },
            provenance,
          },
        ]
      : []),
  ];

  return validateWorksheetInstanceV2({
    schema: "exercisebook.worksheet-instance/v2",
    assignmentId: "assignment-v2",
    title: "Add fractions with unlike denominators",
    localStudyDate: "2026-07-19",
    timeZone: "Asia/Tokyo",
    locale: "en",
    expectedMinutes: slots.length * 2,
    plan: { id: "phase-1-v2", version: 2 },
    policy: { id: "day-one-fraction-preview", version: 3 },
    skillGraph: { id: "phase-1-math", revision: 1 },
    rng: {
      algorithm: "xoshiro128ss-v1",
      baseSeed: "4".repeat(64),
      seedSecretVersion: "public-preview-v2",
    },
    content: [content],
    presentation: {
      schema: "exercisebook.worksheet-presentation/v1",
      content,
      lesson: {
        nodeId: "lesson-explanation-01",
        title: "The three moves",
        paragraphs: [
          "Find a common denominator, rewrite both fractions, then add the numerators.",
        ],
      },
      workedExample: {
        nodeId: "worked-example-01",
        title: "One half plus one third",
        model: {
          type: "fraction-addition",
          left: { numerator: "1", denominator: "2" },
          right: { numerator: "1", denominator: "3" },
          result: { numerator: "5", denominator: "6" },
          commonDenominator: "6",
          leftScaledNumerator: "3",
          rightScaledNumerator: "2",
          unreducedSumNumerator: "5",
        },
        steps: [
          "Use sixths as the common denominator.",
          "Rewrite one half as three sixths and one third as two sixths.",
          "Add three sixths and two sixths to get five sixths.",
        ],
      },
      exercise: {
        nodeId: "practice-01",
        instruction,
      },
    },
    slots,
    attributions: [
      {
        title: "Add fractions with unlike denominators",
        author: "Exercise Book contributors",
        sourceUrl: "https://exercisebook.app/content/fractions",
        licenseId: "CC-BY-4.0",
        attributionText: "Adapted for Exercise Book.",
        publicationStatus: "draft",
        modifications: [],
      },
    ],
  });
}
