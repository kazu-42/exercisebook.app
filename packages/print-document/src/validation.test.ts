import { describe, expect, it } from "vitest";

import {
  answerKeyPrintDocumentFixture,
  studentPrintDocumentFixture,
} from "../../test-fixtures/src/index.js";
import { PrintDocumentValidationError, validatePrintDocumentV1 } from "./index.js";

describe("PrintDocumentV1 relationship and rational validation", () => {
  it.each([
    ["-0", "1"],
    ["1", "0"],
    ["1", "-2"],
  ])("rejects invalid display fraction %s/%s", (numerator, denominator) => {
    const invalid = structuredClone(studentPrintDocumentFixture) as unknown as {
      blocks: Array<Record<string, unknown>>;
    };
    invalid.blocks[0] = {
      type: "heading",
      id: "worksheet-title",
      level: 1,
      content: [
        {
          type: "fraction",
          numerator,
          denominator,
          accessibleText: "invalid fraction",
        },
      ],
    };

    expect(() => validatePrintDocumentV1(invalid)).toThrow(
      PrintDocumentValidationError,
    );
  });

  it("rejects an answer-key entry that does not correspond to problem order", () => {
    const invalid = structuredClone(answerKeyPrintDocumentFixture) as unknown as {
      blocks: Array<Record<string, unknown>>;
    };
    const keyBlock = invalid.blocks.find((block) => block.type === "answer-key");
    if (keyBlock === undefined) {
      throw new Error("fixture does not contain an answer-key block");
    }
    keyBlock.problemId = "different-problem";

    expect(() => validatePrintDocumentV1(invalid)).toThrow(
      /answer-key entries must match every problem ID/u,
    );
  });

  it("rejects duplicate problem IDs before rendering", () => {
    const invalid = structuredClone(studentPrintDocumentFixture) as unknown as {
      blocks: Array<{
        type?: unknown;
        problems?: Array<Record<string, unknown>>;
      }>;
    };
    const group = invalid.blocks.find((block) => block.type === "problem-group");
    if (group?.problems === undefined || group.problems.length < 2) {
      throw new Error("fixture does not contain two problems");
    }
    const firstId = group.problems[0]?.id;
    if (typeof firstId !== "string" || group.problems[1] === undefined) {
      throw new Error("fixture problem IDs are missing");
    }
    group.problems[1].id = firstId;

    expect(() => validatePrintDocumentV1(invalid)).toThrow(/duplicate problem ID/u);
  });

  it.each([-1, 128, 0.5])(
    "rejects invalid generationAttempt provenance: %s",
    (generationAttempt) => {
      const invalid = structuredClone(studentPrintDocumentFixture) as unknown as {
        blocks: Array<Record<string, unknown>>;
      };
      const group = invalid.blocks.find((block) => block.type === "problem-group");
      const problems = group?.problems;
      if (!Array.isArray(problems) || problems[0] === undefined) {
        throw new Error("Expected a problem fixture");
      }
      const problem = problems[0] as Record<string, unknown>;
      const provenance = problem.provenance;
      if (typeof provenance !== "object" || provenance === null) {
        throw new Error("Expected problem provenance");
      }
      (provenance as Record<string, unknown>).generationAttempt = generationAttempt;

      expect(() => validatePrintDocumentV1(invalid)).toThrow(/generationAttempt/u);
    },
  );
});
