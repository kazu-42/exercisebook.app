import { describe, expect, it } from "vitest";

import {
  canonicalizePrintDocumentV1,
  createArtifactFilename,
  validatePrintDocumentV1,
} from "./index.js";
import { studentPrintDocumentFixture } from "../../test-fixtures/src/index.js";

describe("PrintDocumentV1 canonical output", () => {
  it("is byte-deterministic for an equivalent validated document", () => {
    const first = canonicalizePrintDocumentV1(studentPrintDocumentFixture);
    const second = canonicalizePrintDocumentV1(
      JSON.parse(JSON.stringify(studentPrintDocumentFixture)),
    );

    expect(first).toBe(second);
    expect(validatePrintDocumentV1(JSON.parse(first))).toEqual(
      studentPrintDocumentFixture,
    );
  });

  it("uses deterministic content-addressed artifact filenames", () => {
    expect(
      createArtifactFilename(
        studentPrintDocumentFixture.sourceInstanceHash,
        "student",
        "html",
      ),
    ).toBe(
      "75a0ccab1fba9b1a6ea1eb04a45f847fe25ec46291ddde6e67b92af73c68cad0.student.html",
    );
    expect(
      createArtifactFilename(
        studentPrintDocumentFixture.sourceInstanceHash,
        "answer-key",
        "print-document.json",
      ),
    ).toBe(
      "75a0ccab1fba9b1a6ea1eb04a45f847fe25ec46291ddde6e67b92af73c68cad0.answer-key.print-document.json",
    );
  });
});
