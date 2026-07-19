import { describe, expect, it } from "vitest";

import {
  answerKeyPrintDocumentFixture,
  studentPrintDocumentFixture,
} from "../../test-fixtures/src/index.js";
import {
  PrintDocumentValidationError,
  assertStudentDocumentHasNoAnswerData,
  validatePrintDocumentV1,
} from "./index.js";

describe("student answer-leak boundary", () => {
  it("accepts a student document with only response space", () => {
    const document = validatePrintDocumentV1(studentPrintDocumentFixture);
    expect(() => assertStudentDocumentHasNoAnswerData(document)).not.toThrow();
  });

  it.each([
    ["canonicalAnswer", { type: "text", text: "sentinel-canonical-answer" }],
    ["solutionTrace", ["sentinel-solution-trace"]],
    ["answerMetadata", { rubric: "sentinel-answer-metadata" }],
    ["scoringRule", { type: "exact-rational" }],
  ])("rejects a student block containing %s", (field, value) => {
    const leaking = structuredClone(studentPrintDocumentFixture) as unknown as {
      blocks: Array<Record<string, unknown>>;
    };
    leaking.blocks[3] = {
      ...leaking.blocks[3],
      [field]: value,
    };

    expect(() => validatePrintDocumentV1(leaking)).toThrow(
      PrintDocumentValidationError,
    );
  });

  it.each(["data-answer", "data-solution", "aria-answer", "answer-key"])(
    "rejects answer-only DOM attribute metadata: %s",
    (attributeName) => {
      const leaking = structuredClone(studentPrintDocumentFixture) as unknown as {
        blocks: Array<Record<string, unknown>>;
      };
      leaking.blocks[3] = {
        ...leaking.blocks[3],
        attributes: { [attributeName]: "sentinel-hidden-answer" },
      };

      expect(() => validatePrintDocumentV1(leaking)).toThrow(
        PrintDocumentValidationError,
      );
    },
  );

  it("rejects an answer-key block mislabeled as student output", () => {
    const mislabeled = {
      ...answerKeyPrintDocumentFixture,
      variant: "student",
    };

    expect(() => validatePrintDocumentV1(mislabeled)).toThrow(
      PrintDocumentValidationError,
    );
  });
});
