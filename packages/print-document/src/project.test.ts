import { readFileSync } from "node:fs";

import { compileContentSource } from "@exercisebook/content-compiler";
import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import {
  FRACTION_ADDITION_SAMPLE_INPUT,
  materializeFractionAdditionWorksheetFromContent,
  type FractionAdditionAssignmentInput,
} from "@exercisebook/generators";
import type { CompiledContentV1 } from "@exercisebook/content-compiler";
import {
  projectWorksheetForStudent,
  type MaterializedWorksheetInstanceV1,
} from "@exercisebook/schemas";
import { beforeAll, describe, expect, it } from "vitest";

import {
  PRINT_DOCUMENT_SCHEMA,
  PRINT_PROJECTOR_VERSION,
  PrintDocumentProjectionError,
  canonicalizePrintDocumentV1,
  projectPrintDocumentV1,
  renderPrintableHtml,
  snapshotPrintSemantics,
  validatePrintDocumentV1,
  verifyMaterializedWorksheetInstanceV1,
  type ProjectPrintDocumentV1Options,
} from "./index.js";
import { assertStudentPrintDocumentHasNoRecognizedCanonicalAnswers } from "./project.js";

describe("WorksheetInstanceV1 -> PrintDocumentV1", () => {
  let compiledContent: CompiledContentV1;
  let materialized: MaterializedWorksheetInstanceV1;

  beforeAll(async () => {
    const markdown = readFileSync(
      new URL(
        "../../../content/en/math/fractions/add-unlike-denominators.md",
        import.meta.url,
      ),
      "utf8",
    );
    compiledContent = await compileContentSource(markdown);
    materialized = await materializeFractionAdditionWorksheetFromContent(
      compiledContent.document,
      sampleAssignmentMetadata(),
    );
  });

  it("starts from the authored Markdown and preserves compiled content identity", () => {
    expect(compiledContent.document.id).toBe("math.fractions.add-unlike-denominators");
    expect(compiledContent.contentHash).toBe(
      "336ce8c164c92f836f3ba6ab2f3c1ed0b7230433b950c8c39e6f01ce84d1fbb5",
    );
    expect(materialized.instanceHash).toBe(
      "5252ef64b127638b785a94b3a2c7d1859cd7299e7032bed10aa41e07b2c4d12b",
    );
    expect(compiledContent.document.sourceHash).toBe(
      materialized.instance.content[0]?.sourceHash,
    );
    expect(compiledContent.contentHash).toBe(
      materialized.instance.content[0]?.contentHash,
    );
    expect(compiledContent.document.compilerVersion).toBe(
      materialized.instance.content[0]?.compilerVersion,
    );
    expect(materialized.instance.slots).toHaveLength(8);
    expect(
      compiledContent.document.nodes.find((node) => node.type === "exercise"),
    ).toMatchObject({
      type: "exercise",
      generator: {
        id: "fractions.add",
        version: "1",
        parameters: { difficulty: 2 },
      },
      count: 8,
    });
  });

  it("projects deterministic student and answer-key documents from one source", async () => {
    const student = await projectPrintDocumentV1(materialized, {
      variant: "student",
    });
    const key = await projectPrintDocumentV1(materialized, {
      variant: "answer-key",
    });
    const repeatedStudent = await projectPrintDocumentV1(materialized, {
      variant: "student",
    });

    expect(student.schema).toBe(PRINT_DOCUMENT_SCHEMA);
    expect(student.projectorVersion).toBe(PRINT_PROJECTOR_VERSION);
    expect(student.sourceInstanceHash).toBe(materialized.instanceHash);
    expect(key.sourceInstanceHash).toBe(materialized.instanceHash);
    expect(canonicalizePrintDocumentV1(student)).toBe(
      canonicalizePrintDocumentV1(repeatedStudent),
    );

    const studentSnapshot = snapshotPrintSemantics(student);
    const keySnapshot = snapshotPrintSemantics(key);
    expect(studentSnapshot.problemIds).toEqual(
      materialized.instance.slots.map((slot) => slot.id),
    );
    expect(keySnapshot.problemIds).toEqual(studentSnapshot.problemIds);
    expect(keySnapshot.promptText).toEqual(studentSnapshot.promptText);
    expect(keySnapshot.attributionText).toEqual(studentSnapshot.attributionText);
    expect(keySnapshot.keyEntries.map((entry) => entry.problemId)).toEqual(
      studentSnapshot.problemIds,
    );

    const answerKeyHtml = renderPrintableHtml(key);
    expect(answerKeyHtml).not.toContain("\\frac");
    expect(answerKeyHtml).not.toContain("\\operatorname");
  });

  it("uses each reviewed print fallback and emits a static fraction-bar figure", async () => {
    const student = await projectPrintDocumentV1(materialized, {
      variant: "student",
    });
    const figures = student.blocks.filter((block) => block.type === "fraction-bar");

    expect(figures).toHaveLength(materialized.instance.slots.length);
    expect(figures.map((figure) => figure.caption)).toEqual(
      materialized.instance.slots.map((slot) => slot.printFallback.text),
    );
    for (const figure of figures) {
      expect(figure.bars).toHaveLength(2);
      expect(figure.bars.every((bar) => bar.denominator > 0)).toBe(true);
    }
  });

  it("preserves schema-valid source prompt text in the answer-key variant", async () => {
    const instance = structuredClone(materialized.instance);
    const firstSlot = instance.slots[0];
    if (firstSlot === undefined) {
      throw new Error("Expected a worksheet slot");
    }
    const sourceAccessibleText = "Add the displayed fractions in lowest terms.";
    firstSlot.prompt.accessibleText = sourceAccessibleText;
    const custom = await rematerializeWorksheetInstance(instance);

    await expect(
      projectPrintDocumentV1(custom, { variant: "student" }),
    ).rejects.toThrow("deterministic fraction-addition");

    const answerKey = await projectPrintDocumentV1(custom, {
      variant: "answer-key",
    });
    const problemGroup = answerKey.blocks.find(
      (block) => block.type === "problem-group",
    );
    const fractionBar = answerKey.blocks.find((block) => block.type === "fraction-bar");
    expect(problemGroup?.type).toBe("problem-group");
    expect(
      problemGroup?.type === "problem-group"
        ? problemGroup.problems[0]?.promptAccessibleText
        : undefined,
    ).toBe(sourceAccessibleText);
    expect(fractionBar?.type === "fraction-bar" ? fractionBar.label : undefined).toBe(
      sourceAccessibleText,
    );
  });

  it("rejects one problem's answer in another problem's printable fallback", async () => {
    const instance = structuredClone(materialized.instance);
    const leakedAnswer = instance.slots[1]?.canonicalAnswer.value;
    const targetSlot = instance.slots[0];
    if (leakedAnswer === undefined || targetSlot === undefined) {
      throw new Error("Expected at least two materialized worksheet slots");
    }
    targetSlot.printFallback.text = `A leaked answer is ${leakedAnswer.numerator}/${leakedAnswer.denominator}.`;

    await expect(
      projectPrintDocumentV1(await rematerializeWorksheetInstance(instance), {
        variant: "student",
      }),
    ).rejects.toThrow("canonical-answer");
  });

  it("allows another problem's answer when it is a structured prompt operand", async () => {
    const crossOperand = await createCrossOperandMaterialization(materialized);
    const sourceOperand = crossOperand.instance.slots[0]!.prompt.left;
    const student = await projectPrintDocumentV1(crossOperand, {
      variant: "student",
    });
    const firstProblemGroup = student.blocks.find(
      (block) => block.type === "problem-group",
    );

    expect(firstProblemGroup?.type).toBe("problem-group");
    if (firstProblemGroup?.type !== "problem-group") {
      throw new Error("Expected a projected problem group");
    }
    expect(firstProblemGroup.problems[0]?.prompt[0]).toMatchObject({
      type: "fraction",
      numerator: sourceOperand.numerator,
      denominator: sourceOperand.denominator,
    });
  });

  it.each(["fraction-bar caption", "paragraph"] as const)(
    "rejects an allowed prompt operand when copied into final %s prose",
    async (target) => {
      const crossOperand = await createCrossOperandMaterialization(materialized);
      const delivery = await projectWorksheetForStudent(crossOperand);
      const student = await projectPrintDocumentV1(crossOperand, {
        variant: "student",
      });
      const answers = crossOperand.instance.slots.map(
        (slot) => slot.canonicalAnswer.value,
      );
      const leakedAnswer = answers[1];
      if (leakedAnswer === undefined) {
        throw new Error("Expected a cross-slot answer fixture");
      }
      const tampered = structuredClone(student) as unknown as {
        blocks: Array<Record<string, unknown>>;
      };
      const leakedText = ` The answer is ${leakedAnswer.numerator}/${leakedAnswer.denominator}.`;
      if (target === "fraction-bar caption") {
        const fractionBar = tampered.blocks.find(
          (block) => block.type === "fraction-bar",
        );
        if (fractionBar === undefined || typeof fractionBar.caption !== "string") {
          throw new Error("Expected a fraction-bar fallback");
        }
        fractionBar.caption += leakedText;
      } else {
        tampered.blocks.push({
          type: "paragraph",
          id: "leaked-operand-paragraph",
          content: [{ type: "text", text: leakedText.trim() }],
        });
      }
      const validated = validatePrintDocumentV1(tampered);
      if (validated.variant !== "student") {
        throw new Error("Expected a student PrintDocument fixture");
      }

      expect(() =>
        assertStudentPrintDocumentHasNoRecognizedCanonicalAnswers(
          validated,
          delivery,
          answers,
        ),
      ).toThrow("canonical-answer");
    },
  );

  it("rejects an unmapped fraction bar instead of scanning split rational leaves", async () => {
    const crossOperand = await createCrossOperandMaterialization(materialized);
    const delivery = await projectWorksheetForStudent(crossOperand);
    const student = await projectPrintDocumentV1(crossOperand, {
      variant: "student",
    });
    const answers = crossOperand.instance.slots.map(
      (slot) => slot.canonicalAnswer.value,
    );
    const tampered = structuredClone(student) as unknown as {
      blocks: Array<Record<string, unknown>>;
    };
    const fractionBar = tampered.blocks.find((block) => block.type === "fraction-bar");
    if (fractionBar === undefined) {
      throw new Error("Expected a fraction-bar fallback");
    }
    tampered.blocks.push({
      ...structuredClone(fractionBar),
      id: "unmapped-fraction-bars",
    });
    const validated = validatePrintDocumentV1(tampered);
    if (validated.variant !== "student") {
      throw new Error("Expected a student PrintDocument fixture");
    }

    expect(() =>
      assertStudentPrintDocumentHasNoRecognizedCanonicalAnswers(
        validated,
        delivery,
        answers,
      ),
    ).toThrow("fraction-bar mapping");
  });

  it("contains no canonical response, solution trace, seeds, or answer-only DOM metadata in student bytes", async () => {
    const student = await projectPrintDocumentV1(materialized, {
      variant: "student",
    });
    const canonical = canonicalizePrintDocumentV1(student);
    const html = renderPrintableHtml(student);
    const protectedMarkers = [
      materialized.instance.rng.baseSeed,
      ...materialized.instance.slots.flatMap((slot) => [
        slot.slotSeed,
        `${slot.canonicalAnswer.value.numerator}/${slot.canonicalAnswer.value.denominator}`,
        ...slot.solutionTrace.flatMap((step) => [
          step.explanation,
          step.expression,
          step.accessibleText,
        ]),
      ]),
    ];

    for (const marker of protectedMarkers) {
      expect(canonical).not.toContain(marker);
      expect(html).not.toContain(marker);
    }
    expect(canonical).not.toMatch(
      /canonicalAnswer|canonicalResponse|solutionTrace|scoringRule|answerMetadata/iu,
    );
    expect(html).not.toMatch(
      /data-answer|data-solution|data-canonical-answer|aria-answer/iu,
    );
    expect(html).not.toContain("<script");
  });

  it("matches checked-in student and answer-key semantic goldens", async () => {
    const student = await projectPrintDocumentV1(materialized, {
      variant: "student",
    });
    const key = await projectPrintDocumentV1(materialized, {
      variant: "answer-key",
    });

    expect(snapshotPrintSemantics(student)).toEqual(
      readGolden("fraction-addition.student.semantic.json"),
    );
    expect(snapshotPrintSemantics(key)).toEqual(
      readGolden("fraction-addition.answer-key.semantic.json"),
    );
  });

  it("rejects a hash that does not match canonical worksheet bytes", async () => {
    const mismatched = {
      ...materialized,
      instanceHash: "0".repeat(64),
    };

    await expect(
      projectPrintDocumentV1(mismatched, { variant: "student" }),
    ).rejects.toMatchObject({
      name: "PrintDocumentProjectionError",
      code: "hash-mismatch",
    });
  });

  it("rejects canonical bytes that represent a different valid instance", async () => {
    const differentInstance = {
      ...materialized.instance,
      title: `${materialized.instance.title} changed`,
    };
    const differentCanonicalJson = canonicalizeJson(differentInstance);
    const mismatched = {
      instance: materialized.instance,
      canonicalJson: differentCanonicalJson,
      instanceHash: await sha256Hex(differentCanonicalJson),
    };

    await expect(
      projectPrintDocumentV1(mismatched, { variant: "student" }),
    ).rejects.toMatchObject({
      name: "PrintDocumentProjectionError",
      code: "canonical-json-mismatch",
    });
  });

  it("rejects reordered or whitespace-tampered source bytes even when rehashed", async () => {
    const nonCanonicalJson = JSON.stringify(materialized.instance, null, 2);
    const tampered = {
      instance: materialized.instance,
      canonicalJson: nonCanonicalJson,
      instanceHash: await sha256Hex(nonCanonicalJson),
    };

    await expect(
      projectPrintDocumentV1(tampered, { variant: "student" }),
    ).rejects.toMatchObject({
      name: "PrintDocumentProjectionError",
      code: "canonical-json-mismatch",
    });
  });

  it("rejects an instance with a missing print fallback", async () => {
    const instance = structuredClone(materialized.instance) as unknown as {
      slots: Array<Record<string, unknown>>;
    };
    delete instance.slots[0]?.printFallback;
    const canonicalJson = canonicalizeJson(instance);
    const invalid = {
      instance,
      canonicalJson,
      instanceHash: await sha256Hex(canonicalJson),
    } as unknown as MaterializedWorksheetInstanceV1;

    await expect(
      projectPrintDocumentV1(invalid, { variant: "student" }),
    ).rejects.toMatchObject({
      name: "PrintDocumentProjectionError",
      code: "invalid-instance",
    });
  });

  it("rejects an accessor-bearing print envelope before invoking it", async () => {
    let getterRan = false;
    const hostile = { ...materialized } as Record<string, unknown>;
    Object.defineProperty(hostile, "instance", {
      enumerable: true,
      get() {
        getterRan = true;
        return materialized.instance;
      },
    });

    await expect(
      projectPrintDocumentV1(hostile as never, { variant: "answer-key" }),
    ).rejects.toMatchObject({
      name: "PrintDocumentProjectionError",
      code: "invalid-materialization",
    });
    expect(getterRan).toBe(false);
  });

  it("projects both variants from the detached snapshot captured before hashing", async () => {
    const callerOwned = structuredClone(materialized);
    const expectedTitle = callerOwned.instance.title;
    const expectedHash = callerOwned.instanceHash;

    const studentPending = projectPrintDocumentV1(callerOwned, {
      variant: "student",
    });
    callerOwned.instance.title = "Caller-mutated title";
    const student = await studentPending;

    expect(student.title).toBe(expectedTitle);
    expect(student.sourceInstanceHash).toBe(expectedHash);

    const answerKeySource = structuredClone(materialized);
    const answerKeyPending = projectPrintDocumentV1(answerKeySource, {
      variant: "answer-key",
    });
    answerKeySource.instance.title = "Caller-mutated answer-key title";
    answerKeySource.instance.slots[0]!.canonicalAnswer.value = {
      numerator: "1",
      denominator: "2",
    };
    const answerKey = await answerKeyPending;

    expect(answerKey.title).toBe(`${expectedTitle} — Answer key`);
    expect(answerKey.sourceInstanceHash).toBe(expectedHash);
    expect(answerKey.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "answer-key",
          canonicalResponse: [
            expect.objectContaining({
              numerator:
                materialized.instance.slots[0]!.canonicalAnswer.value.numerator,
              denominator:
                materialized.instance.slots[0]!.canonicalAnswer.value.denominator,
            }),
          ],
        }),
      ]),
    );
  });

  it("verifies one detached materialization snapshot across the hash await", async () => {
    const callerOwned = structuredClone(materialized);
    const expectedTitle = callerOwned.instance.title;

    const pending = verifyMaterializedWorksheetInstanceV1(callerOwned);
    callerOwned.instance.title = "Caller-mutated verifier title";

    await expect(pending).resolves.toMatchObject({ title: expectedTitle });
  });

  it("rejects an unsupported output variant", async () => {
    const unsupported = {
      variant: "teacher",
    } as unknown as ProjectPrintDocumentV1Options;

    await expect(projectPrintDocumentV1(materialized, unsupported)).rejects.toEqual(
      expect.objectContaining<Partial<PrintDocumentProjectionError>>({
        name: "PrintDocumentProjectionError",
        code: "unsupported-variant",
      }),
    );
  });

  it("rejects an unknown projector revision instead of interpreting it as v1", () => {
    const fixture = {
      schema: "exercisebook.print/v1",
      sourceInstanceHash: materialized.instanceHash,
      projectorVersion: "print-projector.v2",
      paper: "a4",
      locale: "en",
      variant: "student",
      title: "Unknown revision",
      blocks: [
        {
          type: "heading",
          id: "worksheet-title",
          level: 1,
          content: [{ type: "text", text: "Unknown revision" }],
        },
      ],
      attributions: [
        {
          id: "attribution-001",
          ...materialized.instance.attributions[0],
        },
      ],
    };

    expect(() => validatePrintDocumentV1(fixture)).toThrow(
      /projectorVersion.*print-projector\.v1/u,
    );
  });
});

function readGolden(filename: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../test-fixtures/golden/${filename}`, import.meta.url),
      "utf8",
    ),
  );
}

async function rematerializeWorksheetInstance(
  instance: MaterializedWorksheetInstanceV1["instance"],
): Promise<MaterializedWorksheetInstanceV1> {
  const canonicalJson = canonicalizeJson(instance);
  return {
    instance,
    canonicalJson,
    instanceHash: await sha256Hex(canonicalJson),
  };
}

async function createCrossOperandMaterialization(
  base: MaterializedWorksheetInstanceV1,
): Promise<MaterializedWorksheetInstanceV1> {
  const instance = structuredClone(base.instance);
  const sourceOperand = instance.slots[0]?.prompt.left;
  const answerSlot = instance.slots[1];
  const finalStep = answerSlot?.solutionTrace.at(-1);
  if (
    sourceOperand === undefined ||
    answerSlot === undefined ||
    finalStep === undefined
  ) {
    throw new Error("Expected at least two materialized worksheet slots");
  }
  answerSlot.canonicalAnswer.value = { ...sourceOperand };
  answerSlot.scoringRule.accepted = { ...sourceOperand };
  finalStep.expression =
    `\\frac{${sourceOperand.numerator}}{${sourceOperand.denominator}}=` +
    `\\frac{${sourceOperand.numerator}}{${sourceOperand.denominator}}`;
  finalStep.accessibleText = `${sourceOperand.numerator} over ${sourceOperand.denominator} is already in lowest terms.`;
  finalStep.result = { ...sourceOperand };
  return rematerializeWorksheetInstance(instance);
}

function sampleAssignmentMetadata(): FractionAdditionAssignmentInput {
  return {
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
  };
}
