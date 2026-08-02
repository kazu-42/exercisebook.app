import { describe, expect, expectTypeOf, it } from "vitest";

import * as publicApi from "./index.js";
import {
  renderPrintableHtmlV2,
  snapshotPrintSemanticsV2,
  type AnswerKeyPrintDocumentV2,
  type AnswerKeyPrintSemanticSnapshotV2,
  type PrintDocumentV2,
  type PrintSemanticSnapshotV2,
  type StudentPrintDocumentV2,
  type StudentPrintSemanticSnapshotV2,
} from "./index.js";
// @ts-expect-error Individual V2 block construction types are intentionally internal.
import type { PrintProblemV2 as ForbiddenPublicPrintProblemV2 } from "./index.js";

describe("PrintDocumentV2 public API", () => {
  it("exposes trusted projector entrypoints without exporting internal authorization shortcuts", () => {
    void (undefined as unknown as ForbiddenPublicPrintProblemV2);
    expect(publicApi).toMatchObject({
      PRINTABLE_HTML_V2_RENDERER_VERSION: "printable-html.v2",
      PRINT_DOCUMENT_V2_SCHEMA: "exercisebook.print/v2",
      PRINT_DOCUMENT_V2_SOURCE_INSTANCE_SCHEMA: "exercisebook.worksheet-instance/v2",
      PRINT_PROJECTOR_V2_VERSION: "print-projector.v2",
      PRINT_SEMANTIC_SNAPSHOT_V2_SCHEMA: "exercisebook.print-semantic-snapshot/v2",
      canonicalizePrintDocumentV2: expect.any(Function),
      PrintDocumentV2ProjectionError: expect.any(Function),
      PrintDocumentV2RenderError: expect.any(Function),
      PrintDocumentV2ValidationError: expect.any(Function),
      projectStudentPrintDocumentV2: expect.any(Function),
      projectAnswerKeyPrintDocumentV2: expect.any(Function),
      renderPrintableHtmlV2: expect.any(Function),
      snapshotPrintSemanticsV2: expect.any(Function),
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
    expect(exportedNames.has("renderPrintableHtmlV2WithLimits")).toBe(false);
    expect(exportedNames.has("MAX_PRINTABLE_HTML_V2_UTF8_BYTES")).toBe(false);
    expect(exportedNames.has("MAX_PRINTABLE_HTML_V2_ELEMENTS")).toBe(false);
    expect(
      [...exportedNames].filter((name) =>
        /(?:bounded.*writer|writer.*bounded|css)/iu.test(name),
      ),
    ).toEqual([]);
  });

  it("preserves public renderer and discriminated snapshot call signatures", () => {
    expectTypeOf(renderPrintableHtmlV2).parameters.toEqualTypeOf<[value: unknown]>();
    expectTypeOf(renderPrintableHtmlV2).returns.toEqualTypeOf<string>();

    const assertSnapshotOverloads = (
      student: StudentPrintDocumentV2,
      answerKey: AnswerKeyPrintDocumentV2,
      document: PrintDocumentV2,
      unknownValue: unknown,
    ): void => {
      expectTypeOf(
        snapshotPrintSemanticsV2(student),
      ).toEqualTypeOf<StudentPrintSemanticSnapshotV2>();
      expectTypeOf(
        snapshotPrintSemanticsV2(answerKey),
      ).toEqualTypeOf<AnswerKeyPrintSemanticSnapshotV2>();
      expectTypeOf(
        snapshotPrintSemanticsV2(document),
      ).toEqualTypeOf<PrintSemanticSnapshotV2>();
      expectTypeOf(
        snapshotPrintSemanticsV2(unknownValue),
      ).toEqualTypeOf<PrintSemanticSnapshotV2>();
    };

    void assertSnapshotOverloads;

    const internalLimitSeamIsAbsent: "renderPrintableHtmlV2WithLimits" extends keyof typeof publicApi
      ? never
      : true = true;
    expect(internalLimitSeamIsAbsent).toBe(true);
  });
});
