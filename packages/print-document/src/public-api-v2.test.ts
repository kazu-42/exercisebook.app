import { describe, expect, it } from "vitest";

import * as publicApi from "./index.js";
// @ts-expect-error Individual V2 block construction types are intentionally internal.
import type { PrintProblemV2 as ForbiddenPublicPrintProblemV2 } from "./index.js";

describe("PrintDocumentV2 public API", () => {
  it("exposes trusted projector entrypoints without exporting internal authorization shortcuts", () => {
    void (undefined as unknown as ForbiddenPublicPrintProblemV2);
    expect(publicApi).toMatchObject({
      PRINT_DOCUMENT_V2_SCHEMA: "exercisebook.print/v2",
      PRINT_DOCUMENT_V2_SOURCE_INSTANCE_SCHEMA: "exercisebook.worksheet-instance/v2",
      PRINT_PROJECTOR_V2_VERSION: "print-projector.v2",
      canonicalizePrintDocumentV2: expect.any(Function),
      PrintDocumentV2ProjectionError: expect.any(Function),
      PrintDocumentV2ValidationError: expect.any(Function),
      projectStudentPrintDocumentV2: expect.any(Function),
      projectAnswerKeyPrintDocumentV2: expect.any(Function),
      verifyMaterializedWorksheetInstanceV2: expect.any(Function),
      validatePrintDocumentV2: expect.any(Function),
    });

    const exportedNames = new Set(Object.keys(publicApi));
    expect(exportedNames.has("materializePrintDocumentV2")).toBe(false);
    expect(exportedNames.has("assertStudentPrintDocumentV2Authorization")).toBe(false);
    expect(exportedNames.has("assertStudentPrintDocumentV2HasNoAnswerData")).toBe(
      false,
    );
    expect(exportedNames.has("validateStudentPrintDocumentV2")).toBe(false);
    expect(exportedNames.has("validateAnswerKeyPrintDocumentV2")).toBe(false);
    expect(exportedNames.has("PRINT_DOCUMENT_V2_PAPER")).toBe(false);
    expect(exportedNames.has("PRINT_DOCUMENT_V2_LOCALE")).toBe(false);
    expect(exportedNames.has("MAX_PRINT_DOCUMENT_V2_BLOCKS")).toBe(false);
    expect(exportedNames.has("MAX_PRINT_DOCUMENT_V2_CANONICAL_BYTES")).toBe(false);
  });
});
