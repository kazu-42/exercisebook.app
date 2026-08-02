import {
  addRationals,
  canonicalizeJson,
  sha256Hex,
  type RationalJson,
} from "@exercisebook/domain";
import {
  deriveFractionAdditionAccessibilitySummary,
  deriveFractionAdditionPromptAccessibleText,
  type CanonicalRationalValue,
  type MaterializedWorksheetInstanceV2,
} from "@exercisebook/schemas";
import { projectWorksheetV2ForStudentWithCanonicalAnswers } from "@exercisebook/schemas/trusted-student-projection";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createMaterializedWorksheetV2Fixture,
  rematerializeWorksheetV2Fixture,
} from "./__tests__/v2-fixture.js";
import { canonicalizePrintDocumentV2 } from "./canonical-v2.js";
import {
  assertStudentPrintDocumentV2Authorization,
  projectAnswerKeyPrintDocumentV2,
  projectStudentPrintDocumentV2,
} from "./project-v2.js";
import {
  PRINT_DOCUMENT_V2_SCHEMA,
  PRINT_DOCUMENT_V2_SOURCE_INSTANCE_SCHEMA,
  PRINT_PROJECTOR_V2_VERSION,
  type MaterializedAnswerKeyPrintDocumentV2,
  type MaterializedStudentPrintDocumentV2,
} from "./types-v2.js";

const PINNED_V2_INSTANCE_HASH =
  "934bd3949b6284bbb4061a29b3075560f9389b096ec4f913ad56788e06ac0d02";
const PINNED_STUDENT_PRINT_DOCUMENT_V2_HASH =
  "51892552e00caac748d0ceb2532ed7eb1d7a1e094eef887cb0cc941fd8f80111";
const PINNED_ANSWER_KEY_PRINT_DOCUMENT_V2_HASH =
  "d5a5b226bb485ed8e3cb8a43ef05695015e2a00bb97fe6a85530c654b7db0ebd";
const PINNED_STUDENT_PRINT_DOCUMENT_V2_BYTES = 12_077;
const PINNED_ANSWER_KEY_PRINT_DOCUMENT_V2_BYTES = 16_012;
const SENSITIVE_MARKERS = {
  solutionExplanation: "PRIVATE_SOLUTION_EXPLANATION_SENTINEL",
  solutionExpression: "PRIVATE_SOLUTION_EXPRESSION_SENTINEL",
  solutionAccessibility: "PRIVATE_SOLUTION_ACCESSIBILITY_SENTINEL",
  misconception: "PRIVATE_MISCONCEPTION_SENTINEL",
} as const;
const TRUSTED_PROJECTION_FAILURE = {
  name: "PrintDocumentV2ProjectionError",
  code: "trusted-projection-failed",
  message: "Trusted V2 student projection rejected the verified worksheet snapshot.",
} as const;
const STUDENT_AUTHORIZATION_FAILURE = {
  name: "PrintDocumentV2ProjectionError",
  code: "student-authorization-failed",
  message: "Student PrintDocumentV2 authorization failed.",
} as const;

describe("WorksheetInstanceV2 -> PrintDocumentV2", () => {
  let materialized: MaterializedWorksheetInstanceV2;

  beforeAll(async () => {
    materialized = await createMaterializedWorksheetV2Fixture();
  });

  it("preserves the complete selected presentation, provenance, attribution, and six-problem mapping", async () => {
    const student = await projectStudent(materialized);
    const { document } = student;
    const { instance } = materialized;
    const paragraphCount = instance.presentation.lesson.paragraphs.length;

    expect(materialized.instanceHash).toBe(PINNED_V2_INSTANCE_HASH);
    expect(document).toMatchObject({
      schema: PRINT_DOCUMENT_V2_SCHEMA,
      sourceInstanceSchema: PRINT_DOCUMENT_V2_SOURCE_INSTANCE_SCHEMA,
      sourceInstanceHash: materialized.instanceHash,
      projectorVersion: PRINT_PROJECTOR_V2_VERSION,
      paper: "a4",
      locale: instance.locale,
      variant: "student",
      title: instance.title,
    });
    expect(document.attributions).toEqual(instance.attributions);
    expect(document.blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "heading",
      ...instance.presentation.lesson.paragraphs.map(() => "paragraph"),
      "worked-example",
      ...instance.slots.flatMap(() => [
        "problem-group",
        "print-fallback",
        "working-space",
      ]),
    ]);

    expect(document.blocks[0]).toEqual({
      type: "heading",
      id: "worksheet-title",
      level: 1,
      content: [{ type: "text", text: instance.title }],
    });
    expect(document.blocks[1]).toEqual({
      type: "paragraph",
      id: "worksheet-summary",
      content: [
        {
          type: "text",
          text: `${instance.localStudyDate} · ${instance.expectedMinutes} minutes`,
        },
      ],
    });
    expect(document.blocks[2]).toEqual({
      type: "heading",
      id: "lesson-heading",
      sourceNodeId: instance.presentation.lesson.nodeId,
      level: 2,
      content: [{ type: "text", text: instance.presentation.lesson.title }],
    });

    for (const [
      index,
      paragraph,
    ] of instance.presentation.lesson.paragraphs.entries()) {
      expect(document.blocks[3 + index]).toEqual({
        type: "paragraph",
        id: ordinalId("lesson-paragraph", index + 1),
        sourceNodeId: instance.presentation.lesson.nodeId,
        paragraphOrdinal: index + 1,
        content: [{ type: "text", text: paragraph }],
      });
    }

    const workedExample = document.blocks[3 + paragraphCount];
    expect(workedExample).toMatchObject({
      type: "worked-example",
      id: "worked-example",
      sourceNodeId: instance.presentation.workedExample.nodeId,
      title: instance.presentation.workedExample.title,
      model: instance.presentation.workedExample.model,
      steps: instance.presentation.workedExample.steps,
    });
    if (workedExample?.type !== "worked-example") {
      throw new Error("Expected the selected worked example after lesson paragraphs");
    }
    expect(rationalFromInline(workedExample.prompt[0])).toEqual(
      instance.presentation.workedExample.model.left,
    );
    expect(workedExample.prompt[1]).toMatchObject({ type: "operator", symbol: "+" });
    expect(rationalFromInline(workedExample.prompt[2])).toEqual(
      instance.presentation.workedExample.model.right,
    );
    expect(workedExample.prompt[3]).toMatchObject({ type: "operator", symbol: "=" });
    expect(rationalFromInline(workedExample.prompt[4])).toEqual(
      instance.presentation.workedExample.model.result,
    );

    const firstProblemBlockIndex = 4 + paragraphCount;
    for (const [index, slot] of instance.slots.entries()) {
      const ordinal = index + 1;
      const group = document.blocks[firstProblemBlockIndex + index * 3];
      const fallback = document.blocks[firstProblemBlockIndex + index * 3 + 1];
      const workingSpace = document.blocks[firstProblemBlockIndex + index * 3 + 2];

      expect(group).toMatchObject({
        type: "problem-group",
        id: ordinalId("problem-group", ordinal),
        sourceNodeId: instance.presentation.exercise.nodeId,
        ordinal,
        problems: [
          {
            id: slot.id,
            ordinal,
            instruction: slot.prompt.instruction,
            promptAccessibleText: slot.prompt.accessibleText,
            provenance: slot.provenance,
          },
        ],
      });
      if (group?.type !== "problem-group") {
        throw new Error(`Expected problem group ${ordinal}`);
      }
      const problem = group.problems[0];
      expect(problem).toBeDefined();
      if (problem === undefined) {
        throw new Error(`Expected problem ${ordinal}`);
      }
      expect(rationalFromInline(problem.prompt[0])).toEqual(slot.prompt.left);
      expect(problem.prompt[1]).toMatchObject({ type: "operator", symbol: "+" });
      expect(rationalFromInline(problem.prompt[2])).toEqual(slot.prompt.right);

      expect(fallback).toMatchObject({
        type: "print-fallback",
        id: ordinalId("print-fallback", ordinal),
        problemId: slot.id,
        ordinal,
      });
      if (fallback?.type !== "print-fallback") {
        throw new Error(`Expected print fallback ${ordinal}`);
      }
      if (fallback.content.type === "text") {
        expect(fallback.content.text).toBe(slot.printFallback.text);
      } else {
        expect(fallback.content).toMatchObject({
          label: slot.prompt.accessibleText,
          caption: slot.printFallback.text,
          bars: [
            {
              numerator: Number(slot.prompt.left.numerator),
              denominator: Number(slot.prompt.left.denominator),
            },
            {
              numerator: Number(slot.prompt.right.numerator),
              denominator: Number(slot.prompt.right.denominator),
            },
          ],
        });
      }

      expect(workingSpace).toMatchObject({
        type: "working-space",
        id: ordinalId("working-space", ordinal),
        problemId: slot.id,
        ordinal,
      });
    }
  });

  it("keeps student/key common blocks identical and appends every ordered answer and solution trace", async () => {
    const student = await projectStudent(materialized);
    const key = await projectAnswerKey(materialized);
    const commonBlockCount = student.document.blocks.length;
    const appendix = key.document.blocks.slice(commonBlockCount);

    expect(key.document.sourceInstanceHash).toBe(student.document.sourceInstanceHash);
    expect(key.document.attributions).toEqual(student.document.attributions);
    expect(key.document.blocks.slice(0, commonBlockCount)).toEqual(
      student.document.blocks,
    );
    expect(key.document.title).toBe(`${materialized.instance.title} — Answer key`);
    expect(appendix.slice(0, 2)).toEqual([
      { type: "page-break", id: "answer-key-page-break" },
      {
        type: "heading",
        id: "answer-key-title",
        level: 1,
        content: [{ type: "text", text: "Answer key" }],
      },
    ]);

    const entries = appendix.slice(2);
    expect(entries).toHaveLength(materialized.instance.slots.length);
    for (const [index, slot] of materialized.instance.slots.entries()) {
      const ordinal = index + 1;
      const entry = entries[index];
      expect(entry).toMatchObject({
        type: "answer-key",
        id: ordinalId("answer-key", ordinal),
        problemId: slot.id,
        ordinal,
        canonicalResponse: [
          {
            type: "fraction",
            numerator: slot.canonicalAnswer.value.numerator,
            denominator: slot.canonicalAnswer.value.denominator,
          },
        ],
        explanation: slot.solutionTrace.map(
          (step) => `${step.explanation} ${step.accessibleText}`,
        ),
      });
    }
  });

  it("materializes deterministic canonical bytes and separates instance/student/key identities", async () => {
    const firstStudent = await projectStudent(materialized);
    const secondStudent = await projectStudent(materialized);
    const key = await projectAnswerKey(materialized);

    expect(firstStudent).toEqual(secondStudent);
    expect(firstStudent.canonicalJson).toBe(
      canonicalizePrintDocumentV2(firstStudent.document),
    );
    expect(firstStudent.printDocumentHash).toBe(
      await sha256Hex(firstStudent.canonicalJson),
    );
    expect(key.canonicalJson).toBe(canonicalizePrintDocumentV2(key.document));
    expect(key.printDocumentHash).toBe(await sha256Hex(key.canonicalJson));
    expect(firstStudent.printDocumentHash).toBe(PINNED_STUDENT_PRINT_DOCUMENT_V2_HASH);
    expect(key.printDocumentHash).toBe(PINNED_ANSWER_KEY_PRINT_DOCUMENT_V2_HASH);
    expect(new TextEncoder().encode(firstStudent.canonicalJson).byteLength).toBe(
      PINNED_STUDENT_PRINT_DOCUMENT_V2_BYTES,
    );
    expect(new TextEncoder().encode(key.canonicalJson).byteLength).toBe(
      PINNED_ANSWER_KEY_PRINT_DOCUMENT_V2_BYTES,
    );
    expect(firstStudent.document.sourceInstanceHash).toBe(materialized.instanceHash);
    expect(key.document.sourceInstanceHash).toBe(materialized.instanceHash);
    expect(firstStudent.printDocumentHash).not.toBe(materialized.instanceHash);
    expect(key.printDocumentHash).not.toBe(materialized.instanceHash);
    expect(firstStudent.printDocumentHash).not.toBe(key.printDocumentHash);
    expect(firstStudent.canonicalJson).not.toBe(key.canonicalJson);
  });

  it("does not expose answer authority fields or source-only sentinels in student data", async () => {
    const source = structuredClone(materialized.instance);
    const firstSlot = source.slots[0];
    const firstStep = firstSlot?.solutionTrace[0];
    const firstMisconception = firstSlot?.misconceptions[0];
    if (
      firstSlot === undefined ||
      firstStep === undefined ||
      firstMisconception === undefined
    ) {
      throw new Error("Expected a solution and misconception fixture");
    }

    source.rng.baseSeed = "a".repeat(64);
    firstSlot.slotSeed = "b".repeat(64);
    firstStep.explanation = SENSITIVE_MARKERS.solutionExplanation;
    firstStep.expression = SENSITIVE_MARKERS.solutionExpression;
    firstStep.accessibleText = SENSITIVE_MARKERS.solutionAccessibility;
    firstMisconception.description = SENSITIVE_MARKERS.misconception;
    const sensitive = await rematerializeWorksheetV2Fixture(source);
    const student = await projectStudent(sensitive);
    const serialized = student.canonicalJson;

    expect(serialized).not.toMatch(
      /baseSeed|canonicalAnswer|canonicalResponse|misconceptions|scoringRule|seedSecretVersion|slotSeed|solutionTrace/iu,
    );
    for (const marker of [
      source.rng.baseSeed,
      firstSlot.slotSeed,
      ...Object.values(SENSITIVE_MARKERS),
    ]) {
      expect(serialized).not.toContain(marker);
    }
  });

  it("captures one detached source snapshot before the first asynchronous yield", async () => {
    const studentSource = structuredClone(materialized);
    const keySource = structuredClone(materialized);
    const expectedTitle = materialized.instance.title;
    const expectedFirstAnswer = materialized.instance.slots[0]?.canonicalAnswer.value;
    if (expectedFirstAnswer === undefined) {
      throw new Error("Expected a first answer");
    }

    const studentPending = projectStudent(studentSource);
    const keyPending = projectAnswerKey(keySource);
    studentSource.instance.title = "Caller-mutated student title";
    keySource.instance.title = "Caller-mutated key title";
    keySource.instance.slots[0]!.canonicalAnswer.value = {
      numerator: "0",
      denominator: "1",
    };
    const [student, key] = await Promise.all([studentPending, keyPending]);

    expect(student.document.title).toBe(expectedTitle);
    expect(key.document.title).toBe(`${expectedTitle} — Answer key`);
    const firstEntry = key.document.blocks.find(
      (block) => block.type === "answer-key" && block.ordinal === 1,
    );
    expect(firstEntry?.type).toBe("answer-key");
    if (firstEntry?.type !== "answer-key") {
      throw new Error("Expected first answer-key entry");
    }
    expect(rationalFromInline(firstEntry.canonicalResponse[0])).toEqual(
      expectedFirstAnswer,
    );
  });

  it("returns documents detached from both the caller source and each other", async () => {
    const source = structuredClone(materialized);
    const student = await projectStudent(source);
    const key = await projectAnswerKey(source);
    const originalTitle = source.instance.title;
    const originalStudentCanonical = student.canonicalJson;

    source.instance.presentation.lesson.paragraphs[0] = "Caller changed source text.";
    const mutableStudent = student.document as unknown as { title: string };
    mutableStudent.title = "Consumer changed print title";
    const studentTitleBlock = student.document.blocks[0];
    if (studentTitleBlock?.type !== "heading") {
      throw new Error("Expected student title heading");
    }
    const studentTitleInline = studentTitleBlock.content[0];
    if (studentTitleInline?.type !== "text") {
      throw new Error("Expected student title text");
    }
    (studentTitleInline as { text: string }).text = "Consumer changed title block";

    expect(source.instance.title).toBe(originalTitle);
    expect(key.document.title).toBe(`${originalTitle} — Answer key`);
    expect(student.canonicalJson).toBe(originalStudentCanonical);
    expect(key.document.blocks.slice(0, student.document.blocks.length)).not.toEqual(
      student.document.blocks,
    );
  });

  it.each(["lesson paragraph", "print fallback", "attribution"] as const)(
    "rejects a canonical practice answer copied into %s prose",
    async (target) => {
      const source = structuredClone(materialized.instance);
      const answer = source.slots[0]?.canonicalAnswer.value;
      if (answer === undefined) {
        throw new Error("Expected a canonical answer");
      }
      const leak = `The generated answer is ${rationalText(answer)}.`;

      if (target === "lesson paragraph") {
        source.presentation.lesson.paragraphs[0] = leak;
      } else if (target === "print fallback") {
        source.slots[0]!.printFallback.text = leak;
      } else {
        source.attributions[0]!.attributionText = leak;
      }

      await expect(
        projectStudent(await rematerializeWorksheetV2Fixture(source)),
      ).rejects.toMatchObject(TRUSTED_PROJECTION_FAILURE);
    },
  );

  it("rejects an equivalent unreduced answer representation in student prose", async () => {
    const source = structuredClone(materialized.instance);
    const answer = source.slots[0]?.canonicalAnswer.value;
    if (answer === undefined) {
      throw new Error("Expected a canonical answer");
    }
    const doubled = {
      numerator: (BigInt(answer.numerator) * 2n).toString(),
      denominator: (BigInt(answer.denominator) * 2n).toString(),
    };
    source.presentation.lesson.paragraphs[0] = `This prose must not reveal ${rationalText(doubled)}.`;

    await expect(
      projectStudent(await rematerializeWorksheetV2Fixture(source)),
    ).rejects.toMatchObject(TRUSTED_PROJECTION_FAILURE);
  });

  it("rejects a practice problem that uses its own answer as a prompt operand", async () => {
    const source = structuredClone(materialized.instance);
    const slot = source.slots[0];
    if (slot === undefined) {
      throw new Error("Expected a first slot");
    }
    slot.prompt.left = { ...slot.canonicalAnswer.value };
    slot.prompt.right = { numerator: "0", denominator: "1" };
    slot.prompt.accessibleText = deriveFractionAdditionPromptAccessibleText(
      slot.prompt.left,
      slot.prompt.right,
    );
    slot.accessibility.summary = deriveFractionAdditionAccessibilitySummary(
      slot.prompt.left,
      slot.prompt.right,
    );

    await expect(
      projectStudent(await rematerializeWorksheetV2Fixture(source)),
    ).rejects.toMatchObject(TRUSTED_PROJECTION_FAILURE);
  });

  it("allows a different problem's answer only in the exact mapped prompt role", async () => {
    const crossSlot = await createCrossSlotOperandMaterialization(materialized);
    const sourceAnswer = crossSlot.instance.slots[1]?.canonicalAnswer.value;
    const student = await projectStudent(crossSlot);
    const firstGroup = student.document.blocks.find(
      (block) => block.type === "problem-group" && block.ordinal === 1,
    );
    if (sourceAnswer === undefined || firstGroup?.type !== "problem-group") {
      throw new Error("Expected a cross-slot answer and first problem group");
    }

    expect(rationalFromInline(firstGroup.problems[0]!.prompt[0])).toEqual(sourceAnswer);

    const proseLeak = structuredClone(crossSlot.instance);
    proseLeak.presentation.lesson.paragraphs[0] = `The copied value is ${rationalText(sourceAnswer)}.`;
    await expect(
      projectStudent(await rematerializeWorksheetV2Fixture(proseLeak)),
    ).rejects.toMatchObject(TRUSTED_PROJECTION_FAILURE);
  });

  it("rejects a practice answer equivalent to a worked-example intermediate at the instance boundary", async () => {
    const source = structuredClone(materialized.instance);
    const slot = source.slots[0];
    const finalStep = slot?.solutionTrace.at(-1);
    if (slot === undefined || finalStep === undefined) {
      throw new Error("Expected a first slot and final solution step");
    }
    const workedModel = source.presentation.workedExample.model;
    const collidingAnswer = { ...workedModel.left };
    expect({
      numerator: workedModel.leftScaledNumerator,
      denominator: workedModel.commonDenominator,
    }).toEqual({ numerator: "3", denominator: "6" });

    slot.prompt.left = { ...collidingAnswer };
    slot.prompt.right = { numerator: "0", denominator: "1" };
    slot.prompt.accessibleText = deriveFractionAdditionPromptAccessibleText(
      slot.prompt.left,
      slot.prompt.right,
    );
    slot.accessibility.summary = deriveFractionAdditionAccessibilitySummary(
      slot.prompt.left,
      slot.prompt.right,
    );
    slot.canonicalAnswer.value = { ...collidingAnswer };
    slot.scoringRule.accepted = { ...collidingAnswer };
    finalStep.result = { ...collidingAnswer };

    await expect(rematerializeWorksheetV2Fixture(source)).rejects.toThrow(
      /selected worked-example operand or result/iu,
    );
  });

  it("fails closed before a forged worked-example collision context can reach final authorization", async () => {
    const student = await projectStudent(materialized);
    const projection =
      await projectWorksheetV2ForStudentWithCanonicalAnswers(materialized);
    const collidingAnswers = projection.canonicalAnswers.map((answer) => ({
      ...answer,
    }));
    const workedResult = projection.delivery.presentation.workedExample.model.result;
    collidingAnswers[0] = { ...workedResult };

    expectStudentAuthorizationFailure(
      () =>
        assertStudentPrintDocumentV2Authorization(
          student.document,
          projection.delivery,
          collidingAnswers,
          materialized.instance,
        ),
      /recognized canonical-answer|equivalent canonical-answer/iu,
    );
  });

  it("fails final authorization after problem and fallback mapping tamper", async () => {
    const student = await projectStudent(materialized);
    const projection =
      await projectWorksheetV2ForStudentWithCanonicalAnswers(materialized);

    const problemTamper = structuredClone(student.document);
    const firstGroup = problemTamper.blocks.find(
      (block) => block.type === "problem-group" && block.ordinal === 1,
    );
    if (firstGroup?.type !== "problem-group") {
      throw new Error("Expected first problem group");
    }
    (firstGroup.problems[0] as { id: string }).id = "tampered-problem";
    expectStudentAuthorizationFailure(
      () =>
        assertStudentPrintDocumentV2Authorization(
          problemTamper,
          projection.delivery,
          projection.canonicalAnswers,
          materialized.instance,
        ),
      /expected "tampered-problem"|mapping|map the answer-free delivery|inconsistent/iu,
    );

    const fallbackTamper = structuredClone(student.document);
    const firstFallback = fallbackTamper.blocks.find(
      (block) => block.type === "print-fallback" && block.ordinal === 1,
    );
    if (firstFallback?.type !== "print-fallback") {
      throw new Error("Expected first print fallback");
    }
    (firstFallback as { problemId: string }).problemId = "practice-02";
    expectStudentAuthorizationFailure(
      () =>
        assertStudentPrintDocumentV2Authorization(
          fallbackTamper,
          projection.delivery,
          projection.canonicalAnswers,
          materialized.instance,
        ),
      /expected "practice-01"|mapping|map the answer-free delivery|inconsistent/iu,
    );
  });

  it("fails final authorization when a tampered presentation block contains an answer", async () => {
    const student = await projectStudent(materialized);
    const projection =
      await projectWorksheetV2ForStudentWithCanonicalAnswers(materialized);
    const tampered = structuredClone(student.document);
    const paragraph = tampered.blocks.find(
      (block) => block.type === "paragraph" && "paragraphOrdinal" in block,
    );
    const answer = projection.canonicalAnswers[0];
    if (paragraph?.type !== "paragraph" || answer === undefined) {
      throw new Error("Expected a lesson paragraph and canonical answer");
    }
    const inline = paragraph.content[0];
    if (inline?.type !== "text") {
      throw new Error("Expected lesson text");
    }
    (inline as { text: string }).text = `Leaked ${rationalText(answer)}.`;

    expectStudentAuthorizationFailure(
      () =>
        assertStudentPrintDocumentV2Authorization(
          tampered,
          projection.delivery,
          projection.canonicalAnswers,
          materialized.instance,
        ),
      /canonical-answer|recognized|map the answer-free delivery/iu,
    );
  });

  it("requires one exact projection options envelope with an explicit A4 paper", async () => {
    const invalidOptions = [
      undefined,
      null,
      { materializedWorksheet: materialized },
      { materializedWorksheet: materialized, paper: "a4", variant: "student" },
    ];

    for (const options of invalidOptions) {
      await expectBothProjectorsReject(options, { code: "invalid-options" });
    }
    await expectBothProjectorsReject(
      { materializedWorksheet: materialized, paper: "letter" },
      { code: "unsupported-paper" },
    );
  });

  it("rejects naked and V1-tagged worksheet data instead of inferring a version", async () => {
    await expectBothProjectorsReject(
      { materializedWorksheet: materialized.instance, paper: "a4" },
      { code: "invalid-materialization" },
    );

    const v1TaggedInstance = structuredClone(materialized.instance) as unknown as {
      schema: string;
    };
    v1TaggedInstance.schema = "exercisebook.worksheet-instance/v1";
    const canonicalJson = canonicalizeJson(v1TaggedInstance);
    const wrongVersion = {
      instance: v1TaggedInstance,
      canonicalJson,
      instanceHash: await sha256Hex(canonicalJson),
    };
    await expectBothProjectorsReject(
      { materializedWorksheet: wrongVersion, paper: "a4" },
      { code: "invalid-instance" },
    );
  });

  it("rejects a self-consistent schema-valid unreviewed locale in both variants", async () => {
    const source = structuredClone(materialized.instance);
    source.locale = "ja";
    const japanese = await rematerializeWorksheetV2Fixture(source);

    await expectBothProjectorsReject(
      { materializedWorksheet: japanese, paper: "a4" },
      { code: "unsupported-locale" },
    );
  });

  it("rejects canonical worksheet bytes for a different otherwise-valid instance", async () => {
    const differentSource = structuredClone(materialized.instance);
    differentSource.title = `${differentSource.title} changed`;
    const different = await rematerializeWorksheetV2Fixture(differentSource);
    const mismatched = {
      instance: materialized.instance,
      canonicalJson: different.canonicalJson,
      instanceHash: different.instanceHash,
    };

    await expectBothProjectorsReject(
      { materializedWorksheet: mismatched, paper: "a4" },
      { code: "canonical-json-mismatch" },
    );
  });

  it("rejects non-canonical whitespace even when the supplied bytes are rehashed", async () => {
    const nonCanonicalJson = JSON.stringify(materialized.instance, null, 2);
    const mismatched = {
      instance: materialized.instance,
      canonicalJson: nonCanonicalJson,
      instanceHash: await sha256Hex(nonCanonicalJson),
    };

    await expectBothProjectorsReject(
      { materializedWorksheet: mismatched, paper: "a4" },
      { code: "canonical-json-mismatch" },
    );
  });

  it("rejects a source hash that does not authenticate its canonical worksheet bytes", async () => {
    const mismatched = {
      ...materialized,
      instanceHash: "0".repeat(64),
    };

    await expectBothProjectorsReject(
      { materializedWorksheet: mismatched, paper: "a4" },
      { code: "hash-mismatch" },
    );
  });

  it("rejects accessors in options and materialization without invoking getters", async () => {
    let optionsGetterCalls = 0;
    const hostileOptions: Record<string, unknown> = { paper: "a4" };
    Object.defineProperty(hostileOptions, "materializedWorksheet", {
      enumerable: true,
      get() {
        optionsGetterCalls += 1;
        return materialized;
      },
    });
    await expectBothProjectorsReject(hostileOptions, { code: "invalid-options" });
    expect(optionsGetterCalls).toBe(0);

    let materializationGetterCalls = 0;
    const hostileMaterialization: Record<string, unknown> = {
      canonicalJson: materialized.canonicalJson,
      instanceHash: materialized.instanceHash,
    };
    Object.defineProperty(hostileMaterialization, "instance", {
      enumerable: true,
      get() {
        materializationGetterCalls += 1;
        return materialized.instance;
      },
    });
    await expectBothProjectorsReject(
      { materializedWorksheet: hostileMaterialization, paper: "a4" },
      { code: "invalid-materialization" },
    );
    expect(materializationGetterCalls).toBe(0);
  });
});

function projectStudent(
  materializedWorksheet: MaterializedWorksheetInstanceV2,
): Promise<MaterializedStudentPrintDocumentV2> {
  return projectStudentPrintDocumentV2({ materializedWorksheet, paper: "a4" });
}

function projectAnswerKey(
  materializedWorksheet: MaterializedWorksheetInstanceV2,
): Promise<MaterializedAnswerKeyPrintDocumentV2> {
  return projectAnswerKeyPrintDocumentV2({ materializedWorksheet, paper: "a4" });
}

async function expectBothProjectorsReject(
  options: unknown,
  expected: Readonly<Record<string, unknown>>,
): Promise<void> {
  await expect(projectStudentPrintDocumentV2(options as never)).rejects.toMatchObject(
    expected,
  );
  await expect(projectAnswerKeyPrintDocumentV2(options as never)).rejects.toMatchObject(
    expected,
  );
}

function expectStudentAuthorizationFailure(
  action: () => void,
  causePattern?: RegExp,
): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toMatchObject(STUDENT_AUTHORIZATION_FAILURE);
  if (causePattern !== undefined) {
    expect(caught).toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringMatching(causePattern),
      }),
    });
  }
}

async function createCrossSlotOperandMaterialization(
  base: MaterializedWorksheetInstanceV2,
): Promise<MaterializedWorksheetInstanceV2> {
  const source = structuredClone(base.instance);
  const target = source.slots[0];
  const sourceAnswer = source.slots[1]?.canonicalAnswer.value;
  const finalStep = target?.solutionTrace.at(-1);
  if (target === undefined || sourceAnswer === undefined || finalStep === undefined) {
    throw new Error("Expected two slots and a final solution step");
  }

  const right = { numerator: "1", denominator: "8" } as const;
  const targetAnswer = addRationals(sourceAnswer, right);
  target.prompt.left = { ...sourceAnswer };
  target.prompt.right = right;
  target.prompt.accessibleText = deriveFractionAdditionPromptAccessibleText(
    target.prompt.left,
    target.prompt.right,
  );
  target.accessibility.summary = deriveFractionAdditionAccessibilitySummary(
    target.prompt.left,
    target.prompt.right,
  );
  target.canonicalAnswer.value = { ...targetAnswer };
  target.scoringRule.accepted = { ...targetAnswer };
  finalStep.result = { ...targetAnswer };
  finalStep.expression =
    `\\frac{${targetAnswer.numerator}}{${targetAnswer.denominator}}=` +
    `\\frac{${targetAnswer.numerator}}{${targetAnswer.denominator}}`;
  finalStep.accessibleText = `${targetAnswer.numerator} over ${targetAnswer.denominator} is already in lowest terms.`;

  return rematerializeWorksheetV2Fixture(source);
}

function rationalFromInline(
  inline:
    | Readonly<{
        readonly type: "fraction";
        readonly numerator: string;
        readonly denominator: string;
      }>
    | undefined,
): RationalJson {
  if (inline?.type !== "fraction") {
    throw new Error("Expected a fraction inline");
  }
  return { numerator: inline.numerator, denominator: inline.denominator };
}

function rationalText(value: CanonicalRationalValue | RationalJson): string {
  return `${value.numerator}/${value.denominator}`;
}

function ordinalId(prefix: string, ordinal: number): string {
  return `${prefix}-${String(ordinal).padStart(3, "0")}`;
}
