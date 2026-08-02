import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { studentPrintDocumentFixture } from "../../test-fixtures/src/index.js";
import {
  canonicalizePrintDocumentV2,
  materializePrintDocumentV2,
  MAX_PRINT_DOCUMENT_V2_CANONICAL_BYTES,
} from "./canonical-v2.js";
import { canonicalizePrintDocumentV1 } from "./canonical.js";
import type {
  AnswerKeyPrintBlockV2,
  AnswerKeyPrintDocumentV2,
  PrintAnswerKeyBlockV2,
  PrintFallbackBlockV2,
  PrintFractionAdditionPromptV2,
  PrintProblemGroupBlockV2,
  PrintProblemV2,
  PrintWorkedExampleBlockV2,
  PrintWorkingSpaceBlockV2,
  StudentPrintBlockV2,
  StudentPrintDocumentV2,
} from "./types-v2.js";
import { PrintDocumentV2ValidationError } from "./validate-v2.js";

const SOURCE_INSTANCE_HASH = "a".repeat(64);
const SOURCE_HASH = "b".repeat(64);
const CONTENT_HASH = "c".repeat(64);
const WORKSHEET_TITLE = "Unlike denominator practice";
const PROBLEM_ACCESSIBLE_TEXT =
  "Add 1 over 4 and 1 over 5. Give the answer in lowest terms.";
const textEncoder = new TextEncoder();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PrintDocumentV2 canonical output", () => {
  it("returns a detached validated snapshot before asynchronous hashing", async () => {
    const source = createStudentDocument();
    const expectedCanonicalJson = canonicalizePrintDocumentV2(source);
    const pending = materializePrintDocumentV2(source);

    Reflect.set(source, "title", "Caller mutation");
    const sourceAttribution = source.attributions[0];
    if (sourceAttribution === undefined) {
      throw new Error("Expected the local fixture to contain an attribution.");
    }
    Reflect.set(sourceAttribution, "attributionText", "Caller mutation");

    const materialized = await pending;

    expect(materialized.document).not.toBe(source);
    expect(materialized.document.blocks).not.toBe(source.blocks);
    expect(materialized.document.attributions).not.toBe(source.attributions);
    expect(materialized.document.title).toBe(WORKSHEET_TITLE);
    expect(materialized.document.attributions[0]?.attributionText).toBe(
      "Open lesson adapted for this deterministic print fixture.",
    );
    expect(materialized.canonicalJson).toBe(expectedCanonicalJson);
    expect(JSON.parse(materialized.canonicalJson)).toEqual(materialized.document);
  });

  it("is stable across object-key insertion order", () => {
    const document = createStudentDocument();
    const reordered = reverseObjectKeyInsertionOrder(document);

    expect(canonicalizePrintDocumentV2(reordered)).toBe(
      canonicalizePrintDocumentV2(document),
    );
  });

  it("preserves semantic array order in the canonical bytes", () => {
    const original = createStudentDocument();
    const reordered = createStudentDocument();
    const workedExample = requireWorkedExample(reordered);

    Reflect.set(workedExample, "steps", [...workedExample.steps].reverse());

    expect(canonicalizePrintDocumentV2(reordered)).not.toBe(
      canonicalizePrintDocumentV2(original),
    );
  });

  it("keeps source identity shared across variants but gives each document its own hash", async () => {
    const student = await materializePrintDocumentV2(createStudentDocument());
    const answerKey = await materializePrintDocumentV2(createAnswerKeyDocument());

    expect(student.document.sourceInstanceHash).toBe(SOURCE_INSTANCE_HASH);
    expect(answerKey.document.sourceInstanceHash).toBe(SOURCE_INSTANCE_HASH);
    expect(student.document.sourceInstanceHash).toBe(
      answerKey.document.sourceInstanceHash,
    );
    expect(student.canonicalJson).not.toBe(answerKey.canonicalJson);
    expect(student.printDocumentHash).not.toBe(answerKey.printDocumentHash);
    expect(student.printDocumentHash).not.toBe(SOURCE_INSTANCE_HASH);
    expect(answerKey.printDocumentHash).not.toBe(SOURCE_INSTANCE_HASH);
  });

  it("hashes exactly the canonical UTF-8 bytes and keeps the hash outside the document", async () => {
    const materialized = await materializePrintDocumentV2(createStudentDocument());
    const expectedHash = await sha256Hex(
      textEncoder.encode(materialized.canonicalJson),
    );

    expect(materialized.printDocumentHash).toBe(expectedHash);
    expect(materialized.printDocumentHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.hasOwn(materialized.document, "printDocumentHash")).toBe(false);
    expect(JSON.parse(materialized.canonicalJson)).not.toHaveProperty(
      "printDocumentHash",
    );
    expect(canonicalizePrintDocumentV2(materialized.document)).toBe(
      materialized.canonicalJson,
    );
  });

  it("changes canonical bytes for presentation, problem, and attribution changes", () => {
    const baseline = canonicalizePrintDocumentV2(createStudentDocument());

    const presentationChange = createStudentDocument();
    const workedExample = requireWorkedExample(presentationChange);
    Reflect.set(workedExample, "title", `${workedExample.title} (reviewed)`);

    const problemChange = createStudentDocument();
    const problem = requireFirstProblem(problemChange);
    Reflect.set(problem, "instruction", `${problem.instruction} Work carefully.`);

    const attributionChange = createStudentDocument();
    const attribution = attributionChange.attributions[0];
    if (attribution === undefined) {
      throw new Error("Expected the local fixture to contain an attribution.");
    }
    Reflect.set(
      attribution,
      "attributionText",
      `${attribution.attributionText} Reviewed.`,
    );

    expect(canonicalizePrintDocumentV2(presentationChange)).not.toBe(baseline);
    expect(canonicalizePrintDocumentV2(problemChange)).not.toBe(baseline);
    expect(canonicalizePrintDocumentV2(attributionChange)).not.toBe(baseline);
  });

  it("rejects unsafe and unknown input before invoking SHA-256", async () => {
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");

    const unknownField = createStudentDocument();
    Reflect.set(unknownField, "unexpected", true);
    await expect(materializePrintDocumentV2(unknownField)).rejects.toBeInstanceOf(
      PrintDocumentV2ValidationError,
    );

    let getterRan = false;
    const accessor = createStudentDocument();
    Object.defineProperty(accessor, "title", {
      configurable: true,
      enumerable: true,
      get() {
        getterRan = true;
        return WORKSHEET_TITLE;
      },
    });
    await expect(materializePrintDocumentV2(accessor)).rejects.toBeInstanceOf(
      PrintDocumentV2ValidationError,
    );

    expect(getterRan).toBe(false);
    expect(digest).not.toHaveBeenCalled();
  });

  it("accepts the exact canonical byte cap and rejects the next byte", () => {
    const exact = createAnswerKeyDocumentAtCanonicalByteLength(
      MAX_PRINT_DOCUMENT_V2_CANONICAL_BYTES,
    );
    const exactCanonicalJson = canonicalizePrintDocumentV2(exact);

    expect(canonicalUtf8ByteLength(exactCanonicalJson)).toBe(
      MAX_PRINT_DOCUMENT_V2_CANONICAL_BYTES,
    );

    const over = structuredClone(exact);
    appendOneAsciiByteToExplanation(over);
    expect(canonicalUtf8ByteLength(canonicalizeJson(over))).toBe(
      MAX_PRINT_DOCUMENT_V2_CANONICAL_BYTES + 1,
    );
    expect(() => canonicalizePrintDocumentV2(over)).toThrow(
      new RegExp(
        `canonical document exceeds ${String(MAX_PRINT_DOCUMENT_V2_CANONICAL_BYTES)} bytes`,
        "u",
      ),
    );
  });

  it("keeps V1 and V2 canonicalization entrypoints mutually exclusive", () => {
    expect(() => canonicalizePrintDocumentV1(createStudentDocument())).toThrow();
    expect(() => canonicalizePrintDocumentV2(studentPrintDocumentFixture)).toThrow(
      PrintDocumentV2ValidationError,
    );
  });
});

function createStudentDocument(problemCount = 1): StudentPrintDocumentV2 {
  const workedExample: PrintWorkedExampleBlockV2 = {
    type: "worked-example",
    id: "worked-example",
    sourceNodeId: "worked-example-01",
    title: "Find a common denominator",
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
    prompt: [
      fraction("1", "2"),
      { type: "operator", symbol: "+", accessibleText: "plus" },
      fraction("1", "3"),
      { type: "operator", symbol: "=", accessibleText: "equals" },
      fraction("5", "6"),
    ],
    steps: ["Rename both fractions with denominator 6.", "Add the renamed numerators."],
  };
  const blocks: StudentPrintBlockV2[] = [
    {
      type: "heading",
      id: "worksheet-title",
      level: 1,
      content: [{ type: "text", text: WORKSHEET_TITLE }],
    },
    {
      type: "paragraph",
      id: "worksheet-summary",
      content: [{ type: "text", text: "2026-07-19 · 12 minutes" }],
    },
    {
      type: "heading",
      id: "lesson-heading",
      sourceNodeId: "lesson-explanation-01",
      level: 2,
      content: [{ type: "text", text: "Add fractions in equal-sized parts" }],
    },
    {
      type: "paragraph",
      id: "lesson-paragraph-001",
      sourceNodeId: "lesson-explanation-01",
      paragraphOrdinal: 1,
      content: [
        {
          type: "text",
          text: "Rename the fractions before adding their numerators.",
        },
      ],
    },
    workedExample,
  ];

  for (let ordinal = 1; ordinal <= problemCount; ordinal += 1) {
    blocks.push(...createProblemTriplet(ordinal));
  }

  return {
    schema: "exercisebook.print/v2",
    sourceInstanceSchema: "exercisebook.worksheet-instance/v2",
    sourceInstanceHash: SOURCE_INSTANCE_HASH,
    projectorVersion: "print-projector.v2",
    paper: "a4",
    locale: "en",
    variant: "student",
    title: WORKSHEET_TITLE,
    blocks,
    attributions: [
      {
        title: "Open fraction lesson",
        author: "Exercise Book contributors",
        sourceUrl: "https://example.test/open-fraction-lesson",
        licenseId: "CC-BY-4.0",
        attributionText: "Open lesson adapted for this deterministic print fixture.",
        publicationStatus: "published",
        modifications: ["Selected one short example.", "Formatted for print."],
      },
    ],
  };
}

function createAnswerKeyDocument(
  problemCount = 1,
  solutionStepCount = 2,
): AnswerKeyPrintDocumentV2 {
  const student = createStudentDocument(problemCount);
  const blocks: AnswerKeyPrintBlockV2[] = [
    ...student.blocks,
    { type: "page-break", id: "answer-key-page-break" },
    {
      type: "heading",
      id: "answer-key-title",
      level: 1,
      content: [{ type: "text", text: "Answer key" }],
    },
  ];

  for (let ordinal = 1; ordinal <= problemCount; ordinal += 1) {
    const entry: PrintAnswerKeyBlockV2 = {
      type: "answer-key",
      id: `answer-key-${formatOrdinal(ordinal)}`,
      problemId: `problem-${String(ordinal)}`,
      ordinal,
      canonicalResponse: [fraction("9", "20")],
      explanation: Array.from(
        { length: solutionStepCount },
        (_, index) => `Step ${String(index + 1)}.`,
      ),
    };
    blocks.push(entry);
  }

  return {
    ...student,
    variant: "answer-key",
    title: `${student.title} — Answer key`,
    blocks,
  };
}

function createProblemTriplet(
  ordinal: number,
): readonly [PrintProblemGroupBlockV2, PrintFallbackBlockV2, PrintWorkingSpaceBlockV2] {
  const problemId = `problem-${String(ordinal)}`;
  const prompt: PrintFractionAdditionPromptV2 = [
    fraction("1", "4"),
    { type: "operator", symbol: "+", accessibleText: "plus" },
    fraction("1", "5"),
  ];
  const problem: PrintProblemV2 = {
    id: problemId,
    ordinal,
    instruction: "Add the fractions and reduce the result.",
    promptAccessibleText: PROBLEM_ACCESSIBLE_TEXT,
    prompt,
    response: {
      type: "fraction",
      label: `Response space for problem ${String(ordinal)}`,
      lines: 3,
    },
    provenance: {
      contentId: "math.fractions.add-unlike-denominators",
      contentRevision: 2,
      sourceHash: SOURCE_HASH,
      contentHash: CONTENT_HASH,
      compilerVersion: "exercisebook-content-compiler/2",
      generatorId: "fractions.add",
      generatorVersion: "1",
      generationAttempt: (ordinal - 1) % 128,
    },
  };
  return [
    {
      type: "problem-group",
      id: `problem-group-${formatOrdinal(ordinal)}`,
      sourceNodeId: "practice-01",
      ordinal,
      title: `Problem ${String(ordinal)}`,
      problems: [problem],
    },
    {
      type: "print-fallback",
      id: `print-fallback-${formatOrdinal(ordinal)}`,
      problemId,
      ordinal,
      content: {
        type: "text",
        text: `Draw equal-sized parts for problem ${String(ordinal)}.`,
      },
    },
    {
      type: "working-space",
      id: `working-space-${formatOrdinal(ordinal)}`,
      problemId,
      ordinal,
      label: `Working space for problem ${String(ordinal)}`,
      lines: 3,
    },
  ];
}

function fraction(numerator: string, denominator: string) {
  return {
    type: "fraction" as const,
    numerator,
    denominator,
    accessibleText: `${numerator} over ${denominator}`,
  };
}

function formatOrdinal(ordinal: number): string {
  return String(ordinal).padStart(3, "0");
}

function requireWorkedExample(
  document: StudentPrintDocumentV2,
): PrintWorkedExampleBlockV2 {
  const block = document.blocks.find(
    (candidate): candidate is PrintWorkedExampleBlockV2 =>
      candidate.type === "worked-example",
  );
  if (block === undefined) {
    throw new Error("Expected the local fixture to contain a worked example.");
  }
  return block;
}

function requireFirstProblem(document: StudentPrintDocumentV2): PrintProblemV2 {
  const block = document.blocks.find(
    (candidate): candidate is PrintProblemGroupBlockV2 =>
      candidate.type === "problem-group",
  );
  const problem = block?.problems[0];
  if (problem === undefined) {
    throw new Error("Expected the local fixture to contain a problem.");
  }
  return problem;
}

function reverseObjectKeyInsertionOrder(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => reverseObjectKeyInsertionOrder(item));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const reversed: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value).reverse()) {
    reversed[key] = reverseObjectKeyInsertionOrder(child);
  }
  return reversed;
}

function createAnswerKeyDocumentAtCanonicalByteLength(
  targetByteLength: number,
): AnswerKeyPrintDocumentV2 {
  const document = createAnswerKeyDocument(7, 20);
  let remaining =
    targetByteLength - canonicalUtf8ByteLength(canonicalizeJson(document));
  if (remaining <= 0) {
    throw new Error("The byte-cap fixture baseline is unexpectedly too large.");
  }

  const explanations = answerKeyExplanations(document);
  for (const steps of explanations) {
    for (const [index, step] of steps.entries()) {
      if (remaining < 6) {
        break;
      }
      const capacity = 5_000 - step.length;
      const controls = Math.min(capacity, Math.floor(remaining / 6));
      if (controls > 0) {
        Reflect.set(steps, index, `${step}${"\u0001".repeat(controls)}`);
        remaining -= controls * 6;
      }
    }
  }

  if (remaining > 0) {
    const slot = findExplanationWithCapacity(explanations, remaining);
    Reflect.set(slot.steps, slot.index, `${slot.value}${"x".repeat(remaining)}`);
    remaining = 0;
  }

  if (
    remaining !== 0 ||
    canonicalUtf8ByteLength(canonicalizeJson(document)) !== targetByteLength
  ) {
    throw new Error("Could not construct the exact canonical byte-cap fixture.");
  }
  return document;
}

function appendOneAsciiByteToExplanation(document: AnswerKeyPrintDocumentV2): void {
  const slot = findExplanationWithCapacity(answerKeyExplanations(document), 1);
  Reflect.set(slot.steps, slot.index, `${slot.value}x`);
}

function answerKeyExplanations(
  document: AnswerKeyPrintDocumentV2,
): readonly (readonly string[])[] {
  return document.blocks
    .filter((block): block is PrintAnswerKeyBlockV2 => block.type === "answer-key")
    .map((block) => block.explanation);
}

function findExplanationWithCapacity(
  explanations: readonly (readonly string[])[],
  requiredCapacity: number,
): Readonly<{
  steps: readonly string[];
  index: number;
  value: string;
}> {
  for (const steps of explanations) {
    for (const [index, value] of steps.entries()) {
      if (5_000 - value.length >= requiredCapacity) {
        return { steps, index, value };
      }
    }
  }
  throw new Error("The byte-cap fixture has no remaining explanation capacity.");
}

function canonicalUtf8ByteLength(canonicalJson: string): number {
  return textEncoder.encode(canonicalJson).byteLength;
}
