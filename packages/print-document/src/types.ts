export const PRINT_DOCUMENT_SCHEMA = "exercisebook.print/v1" as const;
export const PRINT_PROJECTOR_VERSION = "print-projector.v1" as const;

export type PrintVariant = "student" | "answer-key";
export type PrintPaper = "a4";

export interface PrintTextV1 {
  readonly type: "text";
  readonly text: string;
}

export interface PrintOperatorV1 {
  readonly type: "operator";
  readonly symbol: string;
  readonly accessibleText: string;
}

export interface PrintFractionV1 {
  readonly type: "fraction";
  readonly numerator: string;
  readonly denominator: string;
  readonly accessibleText: string;
}

export type PrintInlineV1 = PrintTextV1 | PrintOperatorV1 | PrintFractionV1;

export interface PrintHeadingBlockV1 {
  readonly type: "heading";
  readonly id: string;
  readonly level: 1 | 2 | 3;
  readonly content: readonly PrintInlineV1[];
}

export interface PrintParagraphBlockV1 {
  readonly type: "paragraph";
  readonly id: string;
  readonly content: readonly PrintInlineV1[];
}

export interface PrintWorkedExampleBlockV1 {
  readonly type: "worked-example";
  readonly id: string;
  readonly title: string;
  readonly prompt: readonly PrintInlineV1[];
  readonly steps: readonly (readonly PrintInlineV1[])[];
}

export interface PrintResponseSpaceV1 {
  readonly type: "fraction";
  readonly label: string;
  readonly lines: number;
}

export interface PrintProblemProvenanceV1 {
  readonly contentId: string;
  readonly contentRevision: number;
  readonly sourceHash: string;
  readonly contentHash: string;
  readonly compilerVersion: string;
  readonly generatorId: string;
  readonly generatorVersion: string;
  readonly generationAttempt: number;
}

export interface PrintProblemV1 {
  readonly id: string;
  readonly ordinal: number;
  readonly instruction: string;
  readonly promptAccessibleText: string;
  readonly prompt: readonly PrintInlineV1[];
  readonly response: PrintResponseSpaceV1;
  readonly provenance: PrintProblemProvenanceV1;
}

export interface PrintProblemGroupBlockV1 {
  readonly type: "problem-group";
  readonly id: string;
  readonly title: string;
  readonly problems: readonly PrintProblemV1[];
}

export interface PrintFractionBarV1 {
  readonly numerator: number;
  readonly denominator: number;
  readonly label: string;
}

export interface PrintFractionBarBlockV1 {
  readonly type: "fraction-bar";
  readonly id: string;
  readonly label: string;
  readonly caption: string;
  readonly bars: readonly PrintFractionBarV1[];
}

export interface PrintWorkingSpaceBlockV1 {
  readonly type: "working-space";
  readonly id: string;
  readonly label: string;
  readonly lines: number;
}

export interface PrintPageBreakBlockV1 {
  readonly type: "page-break";
  readonly id: string;
}

export interface PrintAnswerKeyBlockV1 {
  readonly type: "answer-key";
  readonly id: string;
  readonly problemId: string;
  readonly ordinal: number;
  readonly canonicalResponse: readonly PrintInlineV1[];
  readonly explanation: readonly string[];
}

export type StudentPrintBlockV1 =
  | PrintHeadingBlockV1
  | PrintParagraphBlockV1
  | PrintWorkedExampleBlockV1
  | PrintProblemGroupBlockV1
  | PrintFractionBarBlockV1
  | PrintWorkingSpaceBlockV1
  | PrintPageBreakBlockV1;

export type AnswerKeyPrintBlockV1 = StudentPrintBlockV1 | PrintAnswerKeyBlockV1;

export interface PrintAttributionV1 {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly sourceUrl: string;
  readonly licenseId: string;
  readonly attributionText: string;
  readonly publicationStatus: "draft" | "published";
  readonly modifications: readonly string[];
}

interface PrintDocumentBaseV1 {
  readonly schema: typeof PRINT_DOCUMENT_SCHEMA;
  readonly sourceInstanceHash: string;
  readonly projectorVersion: string;
  readonly paper: PrintPaper;
  readonly locale: string;
  readonly title: string;
  readonly attributions: readonly PrintAttributionV1[];
}

export interface StudentPrintDocumentV1 extends PrintDocumentBaseV1 {
  readonly variant: "student";
  readonly blocks: readonly StudentPrintBlockV1[];
}

export interface AnswerKeyPrintDocumentV1 extends PrintDocumentBaseV1 {
  readonly variant: "answer-key";
  readonly blocks: readonly AnswerKeyPrintBlockV1[];
}

export type PrintDocumentV1 = StudentPrintDocumentV1 | AnswerKeyPrintDocumentV1;

export interface PrintSemanticSnapshotV1 {
  readonly sourceInstanceHash: string;
  readonly variant: PrintVariant;
  readonly problemIds: readonly string[];
  readonly promptText: readonly string[];
  readonly attributionText: readonly string[];
  readonly keyEntries: readonly {
    readonly problemId: string;
    readonly responseText: string;
    readonly explanation: readonly string[];
  }[];
}
