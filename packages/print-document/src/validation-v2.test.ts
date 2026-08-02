import { describe, expect, it } from "vitest";

import { validatePrintDocumentV1 } from "./validate.js";
import {
  MAX_PRINT_DOCUMENT_V2_PROBLEMS,
  PrintDocumentV2ValidationError,
  validateAnswerKeyPrintDocumentV2,
  validatePrintDocumentV2,
  validateStudentPrintDocumentV2,
} from "./validate-v2.js";

type MutableRecord = Record<string, unknown>;

const SOURCE_HASH = "a".repeat(64);
const CONTENT_HASH = "b".repeat(64);
const INSTANCE_HASH = "c".repeat(64);

describe("PrintDocumentV2 validation", () => {
  it("accepts minimal exact student and answer-key documents", () => {
    const student = studentDocument();
    const answerKey = answerKeyDocument();

    expect(validateStudentPrintDocumentV2(student)).toEqual(student);
    expect(validateAnswerKeyPrintDocumentV2(answerKey)).toEqual(answerKey);
    expect(validatePrintDocumentV2(student).variant).toBe("student");
    expect(validatePrintDocumentV2(answerKey).variant).toBe("answer-key");
  });

  it("keeps the V1 and V2 validation boundaries separate", () => {
    const v2 = studentDocument();
    const v1Shaped = {
      ...v2,
      schema: "exercisebook.print/v1",
      projectorVersion: "print-projector.v1",
    };
    delete (v1Shaped as MutableRecord).sourceInstanceSchema;

    expect(() => validatePrintDocumentV2(v1Shaped)).toThrow(
      PrintDocumentV2ValidationError,
    );
    expect(() => validatePrintDocumentV1(v2)).toThrow();
    expect(() => validateStudentPrintDocumentV2(answerKeyDocument())).toThrow(
      /expected "student"/u,
    );
    expect(() => validateAnswerKeyPrintDocumentV2(v2)).toThrow(
      /expected "answer-key"/u,
    );
  });

  it.each([
    ["schema", "exercisebook.print/v1"],
    ["sourceInstanceSchema", "exercisebook.worksheet-instance/v1"],
    ["sourceInstanceHash", "A".repeat(64)],
    ["projectorVersion", "print-projector.v1"],
    ["paper", "letter"],
    ["locale", "en-US"],
    ["variant", "teacher"],
  ])("rejects an invalid top-level %s discriminator", (field, value) => {
    const invalid = studentDocument();
    invalid[field] = value;

    expect(() => validatePrintDocumentV2(invalid)).toThrow(
      PrintDocumentV2ValidationError,
    );
  });

  it("rejects unknown and missing top-level fields", () => {
    const unknown = studentDocument();
    unknown.extra = true;
    const missing = studentDocument();
    delete missing.sourceInstanceHash;

    expect(() => validatePrintDocumentV2(unknown)).toThrow(/expected exactly/u);
    expect(() => validatePrintDocumentV2(missing)).toThrow(/expected exactly/u);
  });

  it.each([
    ["title heading", 0, "content"],
    ["lesson heading", 2, "sourceNodeId"],
    ["lesson paragraph", 3, "paragraphOrdinal"],
    ["worked example", 4, "model"],
    ["problem group", 5, "sourceNodeId"],
    ["fallback", 6, "problemId"],
    ["working space", 7, "lines"],
  ])("rejects missing and unknown nested fields in %s", (_label, index, field) => {
    const missing = studentDocument();
    delete blockAt(missing, index)[field];
    const unknown = studentDocument();
    blockAt(unknown, index).extra = true;

    expect(() => validatePrintDocumentV2(missing)).toThrow(/expected exactly/u);
    expect(() => validatePrintDocumentV2(unknown)).toThrow(/expected exactly/u);
  });

  it("returns a detached snapshot and preserves source attribution order", () => {
    const source = studentDocument();
    source.attributions = [
      attribution("First source", "https://example.com/first"),
      attribution("Second source", "https://example.com/second"),
    ];

    const validated = validateStudentPrintDocumentV2(source);
    expect(validated).not.toBe(source);
    expect(validated.blocks).not.toBe(source.blocks);
    expect(validated.attributions).not.toBe(source.attributions);
    expect(validated.attributions.map((entry) => entry.title)).toEqual([
      "First source",
      "Second source",
    ]);

    blockAt(source, 0).content = [{ type: "text", text: "Mutated title" }];
    (source.attributions[0] as MutableRecord).title = "Mutated source";
    expect(validated.title).toBe("Fraction addition");
    expect(validated.blocks[0]).toMatchObject({
      content: [{ type: "text", text: "Fraction addition" }],
    });
    expect(validated.attributions[0]?.title).toBe("First source");
  });

  describe("safe-data graph boundary", () => {
    it("rejects an accessor without invoking its getter", () => {
      const invalid = studentDocument();
      let getterCalls = 0;
      Object.defineProperty(invalid, "title", {
        enumerable: true,
        get() {
          getterCalls += 1;
          return "Fraction addition";
        },
      });

      expect(() => validatePrintDocumentV2(invalid)).toThrow(
        PrintDocumentV2ValidationError,
      );
      expect(getterCalls).toBe(0);
    });

    it.each([
      ["symbol property", addSymbolProperty],
      ["non-enumerable property", addNonEnumerableProperty],
      ["custom prototype", addCustomPrototype],
      ["cycle", addCycle],
      ["sparse array", addSparseArray],
      ["lone surrogate", addLoneSurrogate],
    ])("rejects a %s before semantic traversal", (_label, mutate) => {
      const invalid = studentDocument();
      mutate(invalid);

      expect(() => validatePrintDocumentV2(invalid)).toThrow(
        PrintDocumentV2ValidationError,
      );
    });
  });

  describe("exact student block grammar", () => {
    it.each([
      ["worksheet title", 0],
      ["date/time summary", 1],
      ["lesson heading", 2],
      ["lesson paragraph", 3],
      ["worked example", 4],
      ["problem group", 5],
      ["print fallback", 6],
      ["working space", 7],
    ])("requires the %s block in order", (_label, index) => {
      const invalid = studentDocument();
      invalid.blocks.splice(index, 1);

      expect(() => validatePrintDocumentV2(invalid)).toThrow(
        PrintDocumentV2ValidationError,
      );
    });

    it("requires the top-level title to equal the title heading", () => {
      const invalid = studentDocument();
      invalid.title = "Different title";

      expect(() => validatePrintDocumentV2(invalid)).toThrow(/worksheet title/u);
    });

    it("accepts a 240-code-unit worksheet title in both variants and rejects 241", () => {
      const maximumTitle = "x".repeat(240);
      const student = studentDocument();
      setWorksheetTitle(student, maximumTitle);
      const answerKey = answerKeyDocument();
      setWorksheetTitle(answerKey, maximumTitle);
      const tooLong = studentDocument();
      setWorksheetTitle(tooLong, "x".repeat(241));

      expect(validateStudentPrintDocumentV2(student).title).toBe(maximumTitle);
      expect(validateAnswerKeyPrintDocumentV2(answerKey).title).toBe(
        `${maximumTitle} — Answer key`,
      );
      expect(() => validatePrintDocumentV2(tooLong)).toThrow(
        PrintDocumentV2ValidationError,
      );
    });

    it("requires every fixed and ordinal student block ID", () => {
      const cases = [
        [0, "different-title-id"],
        [1, "different-summary-id"],
        [2, "different-lesson-id"],
        [3, "lesson-paragraph-002"],
        [4, "different-worked-example-id"],
        [5, "problem-group-002"],
        [6, "print-fallback-002"],
        [7, "working-space-002"],
      ] as const;

      for (const [blockIndex, wrongId] of cases) {
        const invalid = studentDocument();
        blockAt(invalid, blockIndex).id = wrongId;

        expect(() => validatePrintDocumentV2(invalid)).toThrow(/\.id:/u);
      }
    });

    it.each([
      "2026-02-30 · 12 minutes",
      "2026-07-19 - 12 minutes",
      "2026-07-19 · 0 minutes",
      "2026-07-19 · 481 minutes",
    ])("rejects an invalid exact worksheet summary: %s", (summary) => {
      const invalid = studentDocument();
      blockAt(invalid, 1).content = [{ type: "text", text: summary }];

      expect(() => validatePrintDocumentV2(invalid)).toThrow(
        PrintDocumentV2ValidationError,
      );
    });

    it("requires lesson paragraph node identity and contiguous ordinals", () => {
      const wrongNode = studentDocument();
      blockAt(wrongNode, 3).sourceNodeId = "different-node";
      const skippedOrdinal = studentDocument();
      blockAt(skippedOrdinal, 3).paragraphOrdinal = 2;

      expect(() => validatePrintDocumentV2(wrongNode)).toThrow(/sourceNodeId/u);
      expect(() => validatePrintDocumentV2(skippedOrdinal)).toThrow(
        /paragraphOrdinal/u,
      );
    });

    it("requires the exact worked-example node, arithmetic model, and left + right = result tuple", () => {
      const wrongNode = studentDocument();
      blockAt(wrongNode, 4).sourceNodeId = "different-example";
      const wrongModel = studentDocument();
      workedModel(wrongModel).result = { numerator: "1", denominator: "1" };
      const wrongOperator = studentDocument();
      workedPrompt(wrongOperator)[3] = {
        type: "operator",
        symbol: "+",
        accessibleText: "plus",
      };
      const wrongPromptResult = studentDocument();
      workedPrompt(wrongPromptResult)[4] = fraction("1", "1");

      expect(() => validatePrintDocumentV2(wrongNode)).toThrow(/sourceNodeId/u);
      expect(() => validatePrintDocumentV2(wrongModel)).toThrow(/model/u);
      expect(() => validatePrintDocumentV2(wrongOperator)).toThrow(/symbol/u);
      expect(() => validatePrintDocumentV2(wrongPromptResult)).toThrow(
        /worked-example model value/u,
      );
    });

    it("requires exactly one fallback and one working-space block per problem", () => {
      const missingFallback = studentDocument();
      missingFallback.blocks.splice(6, 1);
      const duplicateFallback = studentDocument();
      duplicateFallback.blocks.splice(
        7,
        0,
        structuredClone(blockAt(duplicateFallback, 6)),
      );
      const mismatchedSpace = studentDocument();
      blockAt(mismatchedSpace, 7).problemId = "other-problem";

      expect(() => validatePrintDocumentV2(missingFallback)).toThrow();
      expect(() => validatePrintDocumentV2(duplicateFallback)).toThrow();
      expect(() => validatePrintDocumentV2(mismatchedSpace)).toThrow(/problemId/u);
    });

    it("requires deterministic problem-group, response, and working-space copy", () => {
      const wrongGroupTitle = studentDocument();
      blockAt(wrongGroupTitle, 5).title = "Practice 1";
      const wrongResponseLabel = studentDocument();
      const responseLabel = problemAt(wrongResponseLabel, 1).response as MutableRecord;
      responseLabel.label = "Your response";
      const wrongResponseLines = studentDocument();
      const responseLines = problemAt(wrongResponseLines, 1).response as MutableRecord;
      responseLines.lines = 4;
      const wrongWorkingLabel = studentDocument();
      blockAt(wrongWorkingLabel, 7).label = "Scratch work";
      const wrongWorkingLines = studentDocument();
      blockAt(wrongWorkingLines, 7).lines = 4;

      expect(() => validatePrintDocumentV2(wrongGroupTitle)).toThrow(/\.title:/u);
      expect(() => validatePrintDocumentV2(wrongResponseLabel)).toThrow(/\.label:/u);
      expect(() => validatePrintDocumentV2(wrongResponseLines)).toThrow(/\.lines:/u);
      expect(() => validatePrintDocumentV2(wrongWorkingLabel)).toThrow(/\.label:/u);
      expect(() => validatePrintDocumentV2(wrongWorkingLines)).toThrow(/\.lines:/u);
    });

    it("requires deterministic plus and equals accessible text", () => {
      const wrongWorkedPlus = studentDocument();
      workedPrompt(wrongWorkedPlus)[1] = operator("+", "add");
      const wrongEquals = studentDocument();
      workedPrompt(wrongEquals)[3] = operator("=", "is");
      const wrongProblemPlus = studentDocument();
      const problemPrompt = problemAt(wrongProblemPlus, 1).prompt;
      if (!Array.isArray(problemPrompt) || problemPrompt[1] === undefined) {
        throw new Error("Missing problem prompt operator");
      }
      problemPrompt[1] = operator("+", "add");

      expect(() => validatePrintDocumentV2(wrongWorkedPlus)).toThrow(/accessibleText/u);
      expect(() => validatePrintDocumentV2(wrongEquals)).toThrow(/accessibleText/u);
      expect(() => validatePrintDocumentV2(wrongProblemPlus)).toThrow(
        /accessibleText/u,
      );
    });
  });

  describe("problem identity and bounds", () => {
    it.each([1, MAX_PRINT_DOCUMENT_V2_PROBLEMS])(
      "accepts the inclusive %s-problem boundary",
      (problemCount) => {
        expect(
          validateStudentPrintDocumentV2(studentDocument(problemCount)),
        ).toMatchObject({ variant: "student" });
      },
    );

    it.each([0, MAX_PRINT_DOCUMENT_V2_PROBLEMS + 1])(
      "rejects the exclusive %s-problem boundary",
      (problemCount) => {
        expect(() => validatePrintDocumentV2(studentDocument(problemCount))).toThrow(
          PrintDocumentV2ValidationError,
        );
      },
    );

    it("requires unique IDs and contiguous problem/group/block ordinals", () => {
      const duplicateBlockId = studentDocument(2);
      blockAt(duplicateBlockId, 8).id = blockAt(duplicateBlockId, 5).id;
      const duplicateProblemId = studentDocument(2);
      problemAt(duplicateProblemId, 2).id = problemAt(duplicateProblemId, 1).id;
      const skippedGroupOrdinal = studentDocument(2);
      blockAt(skippedGroupOrdinal, 8).ordinal = 3;
      const skippedProblemOrdinal = studentDocument(2);
      problemAt(skippedProblemOrdinal, 2).ordinal = 3;
      const skippedFallbackOrdinal = studentDocument(2);
      blockAt(skippedFallbackOrdinal, 9).ordinal = 3;
      const skippedSpaceOrdinal = studentDocument(2);
      blockAt(skippedSpaceOrdinal, 10).ordinal = 3;

      for (const invalid of [
        duplicateBlockId,
        duplicateProblemId,
        skippedGroupOrdinal,
        skippedProblemOrdinal,
        skippedFallbackOrdinal,
        skippedSpaceOrdinal,
      ]) {
        expect(() => validatePrintDocumentV2(invalid)).toThrow(
          PrintDocumentV2ValidationError,
        );
      }
    });

    it("requires compiler-v2 provenance with one content/exercise identity", () => {
      const compilerV1 = studentDocument();
      provenanceAt(compilerV1, 1).compilerVersion = "exercisebook-content-compiler/1";
      const contentDrift = studentDocument(2);
      provenanceAt(contentDrift, 2).contentHash = "d".repeat(64);
      const exerciseDrift = studentDocument(2);
      provenanceAt(exerciseDrift, 2).generatorId = "other.generator";

      expect(() => validatePrintDocumentV2(compilerV1)).toThrow(/compilerVersion/u);
      expect(() => validatePrintDocumentV2(contentDrift)).toThrow(
        /same reviewed content and generator/u,
      );
      expect(() => validatePrintDocumentV2(exerciseDrift)).toThrow();
    });

    it("pins the reviewed content ID and revision", () => {
      const wrongContentId = studentDocument();
      provenanceAt(wrongContentId, 1).contentId = "math.fractions.other";
      const wrongRevision = studentDocument();
      provenanceAt(wrongRevision, 1).contentRevision = 3;

      expect(() => validatePrintDocumentV2(wrongContentId)).toThrow(/contentId/u);
      expect(() => validatePrintDocumentV2(wrongRevision)).toThrow(/contentRevision/u);
    });

    it("binds fallback content to the corresponding prompt and problem", () => {
      const wrongLabel = studentDocument();
      fallbackAt(wrongLabel, 1).content = {
        type: "fraction-bars",
        label: "Different prompt",
        caption: "Compare the bars.",
        bars: [
          { numerator: 1, denominator: 4, label: "1/4" },
          { numerator: 1, denominator: 3, label: "1/3" },
        ],
      };
      const wrongBars = studentDocument();
      const content = fallbackAt(wrongBars, 1).content as MutableRecord;
      (content.bars as MutableRecord[])[0] = {
        numerator: 2,
        denominator: 4,
        label: "2/4",
      };

      expect(() => validatePrintDocumentV2(wrongLabel)).toThrow(
        /promptAccessibleText/u,
      );
      expect(() => validatePrintDocumentV2(wrongBars)).toThrow(/operand/u);
    });
  });

  describe("answer-key appendix", () => {
    it("rejects a reduced canonical response that is not the mapped prompt sum", () => {
      const invalid = answerKeyDocument();
      blockAt(invalid, 10).canonicalResponse = [fraction("1", "1")];

      expect(() => validatePrintDocumentV2(invalid)).toThrow(
        /exact reduced sum of the mapped problem prompt/u,
      );
    });

    it("rejects canonical-response accessible text that does not match its fraction", () => {
      const invalid = answerKeyDocument();
      const canonicalResponse = blockAt(invalid, 10).canonicalResponse;
      if (!Array.isArray(canonicalResponse) || canonicalResponse[0] === undefined) {
        throw new Error("Missing answer-key canonical response");
      }
      (canonicalResponse[0] as MutableRecord).accessibleText = "wrong accessible text";

      expect(() => validatePrintDocumentV2(invalid)).toThrow(/accessibleText/u);
    });

    it("requires the answer-key title suffix and every fixed appendix ID", () => {
      const wrongSuffix = answerKeyDocument();
      wrongSuffix.title = "Fraction addition";
      const wrongPageBreakId = answerKeyDocument();
      blockAt(wrongPageBreakId, 8).id = "different-page-break";
      const wrongTitleId = answerKeyDocument();
      blockAt(wrongTitleId, 9).id = "different-answer-title";
      const wrongEntryId = answerKeyDocument();
      blockAt(wrongEntryId, 10).id = "answer-key-002";

      expect(() => validatePrintDocumentV2(wrongSuffix)).toThrow(/suffix/u);
      expect(() => validatePrintDocumentV2(wrongPageBreakId)).toThrow(/\.id:/u);
      expect(() => validatePrintDocumentV2(wrongTitleId)).toThrow(/\.id:/u);
      expect(() => validatePrintDocumentV2(wrongEntryId)).toThrow(/\.id:/u);
    });

    it("requires the exact page-break, title, and one ordered key entry per problem", () => {
      const missingPageBreak = answerKeyDocument(2);
      missingPageBreak.blocks.splice(11, 1);
      const wrongTitle = answerKeyDocument(2);
      blockAt(wrongTitle, 12).content = [{ type: "text", text: "Solutions" }];
      const missingEntry = answerKeyDocument(2);
      missingEntry.blocks.pop();
      const extraEntry = answerKeyDocument(2);
      extraEntry.blocks.push(
        structuredClone(extraEntry.blocks.at(-1) as MutableRecord),
      );

      expect(() => validatePrintDocumentV2(missingPageBreak)).toThrow();
      expect(() => validatePrintDocumentV2(wrongTitle)).toThrow(/Answer key/u);
      expect(() => validatePrintDocumentV2(missingEntry)).toThrow();
      expect(() => validatePrintDocumentV2(extraEntry)).toThrow(/exactly one ordered/u);
    });

    it("binds key problem IDs and ordinals to the student prefix order", () => {
      const wrongProblem = answerKeyDocument(2);
      blockAt(wrongProblem, 13).problemId = "problem-2";
      const wrongOrdinal = answerKeyDocument(2);
      blockAt(wrongOrdinal, 14).ordinal = 1;
      const reordered = answerKeyDocument(2);
      [reordered.blocks[13], reordered.blocks[14]] = [
        reordered.blocks[14] as MutableRecord,
        reordered.blocks[13] as MutableRecord,
      ];

      expect(() => validatePrintDocumentV2(wrongProblem)).toThrow(/problemId/u);
      expect(() => validatePrintDocumentV2(wrongOrdinal)).toThrow(/ordinal/u);
      expect(() => validatePrintDocumentV2(reordered)).toThrow();
    });
  });

  describe("source attribution contract", () => {
    it.each([
      ["synthetic id", "id", "source-1"],
      ["credential-bearing URL", "sourceUrl", "https://user:pass@example.com/source"],
      ["non-HTTP URL", "sourceUrl", "file:///tmp/source"],
      ["unknown status", "publicationStatus", "private"],
    ])("rejects %s", (_label, field, value) => {
      const invalid = studentDocument();
      (invalid.attributions[0] as MutableRecord)[field] = value;

      expect(() => validatePrintDocumentV2(invalid)).toThrow(
        PrintDocumentV2ValidationError,
      );
    });

    it("rejects missing or empty attributions", () => {
      const missingField = studentDocument();
      delete (missingField.attributions[0] as MutableRecord).licenseId;
      const empty = studentDocument();
      empty.attributions = [];

      expect(() => validatePrintDocumentV2(missingField)).toThrow(/expected exactly/u);
      expect(() => validatePrintDocumentV2(empty)).toThrow();
    });
  });
});

function studentDocument(problemCount = 1): MutableRecord & {
  blocks: MutableRecord[];
  attributions: MutableRecord[];
} {
  const blocks: MutableRecord[] = [
    {
      type: "heading",
      id: "worksheet-title",
      level: 1,
      content: [{ type: "text", text: "Fraction addition" }],
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
      content: [{ type: "text", text: "Use a common denominator" }],
    },
    {
      type: "paragraph",
      id: "lesson-paragraph-001",
      sourceNodeId: "lesson-explanation-01",
      paragraphOrdinal: 1,
      content: [
        {
          type: "text",
          text: "Rename the fractions, add the numerators, and simplify.",
        },
      ],
    },
    {
      type: "worked-example",
      id: "worked-example",
      sourceNodeId: "worked-example-01",
      title: "Worked example",
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
        operator("+", "plus"),
        fraction("1", "3"),
        operator("=", "equals"),
        fraction("5", "6"),
      ],
      steps: ["Use 6 as the common denominator.", "Add 3 and 2 to get 5."],
    },
  ];

  for (let ordinal = 1; ordinal <= problemCount; ordinal += 1) {
    blocks.push(...problemTriplet(ordinal));
  }

  return {
    schema: "exercisebook.print/v2",
    sourceInstanceSchema: "exercisebook.worksheet-instance/v2",
    sourceInstanceHash: INSTANCE_HASH,
    projectorVersion: "print-projector.v2",
    paper: "a4",
    locale: "en",
    variant: "student",
    title: "Fraction addition",
    blocks,
    attributions: [
      attribution("Fraction addition", "https://exercisebook.app/content/fractions"),
    ],
  };
}

function answerKeyDocument(problemCount = 1): ReturnType<typeof studentDocument> {
  const document = studentDocument(problemCount);
  document.variant = "answer-key";
  document.title = "Fraction addition — Answer key";
  document.blocks.push(
    { type: "page-break", id: "answer-key-page-break" },
    {
      type: "heading",
      id: "answer-key-title",
      level: 1,
      content: [{ type: "text", text: "Answer key" }],
    },
  );
  for (let ordinal = 1; ordinal <= problemCount; ordinal += 1) {
    document.blocks.push({
      type: "answer-key",
      id: `answer-key-${paddedOrdinal(ordinal)}`,
      problemId: `problem-${ordinal}`,
      ordinal,
      canonicalResponse: [fraction("7", "12")],
      explanation: ["Use a common denominator, then add and simplify."],
    });
  }
  return document;
}

function problemTriplet(ordinal: number): MutableRecord[] {
  const problemId = `problem-${ordinal}`;
  const promptAccessibleText =
    "Add 1 over 4 and 1 over 3. Give the answer in lowest terms.";
  return [
    {
      type: "problem-group",
      id: `problem-group-${paddedOrdinal(ordinal)}`,
      sourceNodeId: "practice-01",
      ordinal,
      title: `Problem ${ordinal}`,
      problems: [
        {
          id: problemId,
          ordinal,
          instruction: "Add and simplify.",
          promptAccessibleText,
          prompt: [fraction("1", "4"), operator("+", "plus"), fraction("1", "3")],
          response: {
            type: "fraction",
            label: `Response space for problem ${ordinal}`,
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
            generationAttempt: 0,
          },
        },
      ],
    },
    {
      type: "print-fallback",
      id: `print-fallback-${paddedOrdinal(ordinal)}`,
      problemId,
      ordinal,
      content: {
        type: "fraction-bars",
        label: promptAccessibleText,
        caption: "Compare the bars.",
        bars: [
          { numerator: 1, denominator: 4, label: "1/4" },
          { numerator: 1, denominator: 3, label: "1/3" },
        ],
      },
    },
    {
      type: "working-space",
      id: `working-space-${paddedOrdinal(ordinal)}`,
      problemId,
      ordinal,
      label: `Working space for problem ${ordinal}`,
      lines: 3,
    },
  ];
}

function attribution(title: string, sourceUrl: string): MutableRecord {
  return {
    title,
    author: "Exercise Book",
    sourceUrl,
    licenseId: "LicenseRef-Proprietary-Draft",
    attributionText: `${title} source`,
    publicationStatus: "draft",
    modifications: [],
  };
}

function fraction(numerator: string, denominator: string): MutableRecord {
  return {
    type: "fraction",
    numerator,
    denominator,
    accessibleText: `${numerator} over ${denominator}`,
  };
}

function operator(symbol: "+" | "=", accessibleText: string): MutableRecord {
  return { type: "operator", symbol, accessibleText };
}

function paddedOrdinal(ordinal: number): string {
  return String(ordinal).padStart(3, "0");
}

function blockAt(
  document: ReturnType<typeof studentDocument>,
  index: number,
): MutableRecord {
  const block = document.blocks[index];
  if (block === undefined) {
    throw new Error(`Missing block ${index}`);
  }
  return block;
}

function problemAt(
  document: ReturnType<typeof studentDocument>,
  ordinal: number,
): MutableRecord {
  const problems = blockAt(document, 5 + (ordinal - 1) * 3).problems;
  if (!Array.isArray(problems) || problems[0] === undefined) {
    throw new Error(`Missing problem ${ordinal}`);
  }
  return problems[0] as MutableRecord;
}

function provenanceAt(
  document: ReturnType<typeof studentDocument>,
  ordinal: number,
): MutableRecord {
  const provenance = problemAt(document, ordinal).provenance;
  if (typeof provenance !== "object" || provenance === null) {
    throw new Error(`Missing problem ${ordinal} provenance`);
  }
  return provenance as MutableRecord;
}

function fallbackAt(
  document: ReturnType<typeof studentDocument>,
  ordinal: number,
): MutableRecord {
  return blockAt(document, 6 + (ordinal - 1) * 3);
}

function workedModel(document: ReturnType<typeof studentDocument>): MutableRecord {
  const model = blockAt(document, 4).model;
  if (typeof model !== "object" || model === null) {
    throw new Error("Missing worked-example model");
  }
  return model as MutableRecord;
}

function workedPrompt(document: ReturnType<typeof studentDocument>): MutableRecord[] {
  const prompt = blockAt(document, 4).prompt;
  if (!Array.isArray(prompt)) {
    throw new Error("Missing worked-example prompt");
  }
  return prompt as MutableRecord[];
}

function setWorksheetTitle(
  document: ReturnType<typeof studentDocument>,
  title: string,
): void {
  blockAt(document, 0).content = [{ type: "text", text: title }];
  document.title = document.variant === "answer-key" ? `${title} — Answer key` : title;
}

function addSymbolProperty(document: MutableRecord): void {
  Object.defineProperty(document, Symbol("unexpected"), {
    value: true,
    enumerable: true,
  });
}

function addNonEnumerableProperty(document: MutableRecord): void {
  Object.defineProperty(document, "hidden", { value: true, enumerable: false });
}

function addCustomPrototype(document: MutableRecord): void {
  Object.setPrototypeOf(document, { unexpected: true });
}

function addCycle(document: MutableRecord): void {
  document.cycle = document;
}

function addSparseArray(document: MutableRecord): void {
  const sparse = new Array(2) as unknown[];
  sparse[0] = document.blocks;
  document.blocks = sparse as MutableRecord[];
}

function addLoneSurrogate(document: MutableRecord): void {
  document.title = "\ud800";
}
