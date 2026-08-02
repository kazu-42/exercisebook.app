import type {
  AttributionV1,
  FractionAdditionWorkedExampleModelV1,
  WorksheetPresentationV1,
} from "@exercisebook/schemas";

import type {
  PrintFractionBarV1,
  PrintFractionV1,
  PrintInlineV1,
  PrintOperatorV1,
  PrintPageBreakBlockV1,
} from "./types.js";

export const PRINT_DOCUMENT_V2_SCHEMA = "exercisebook.print/v2" as const;
export const PRINT_DOCUMENT_V2_SOURCE_INSTANCE_SCHEMA =
  "exercisebook.worksheet-instance/v2" as const;
export const PRINT_PROJECTOR_V2_VERSION = "print-projector.v2" as const;
export const PRINT_DOCUMENT_V2_PAPER = "a4" as const;
export const PRINT_DOCUMENT_V2_LOCALE = "en" as const;

export type PrintVariantV2 = "student" | "answer-key";
export type PrintPaperV2 = typeof PRINT_DOCUMENT_V2_PAPER;

export type PrintFractionAdditionPromptV2 = readonly [
  PrintFractionV1,
  PrintOperatorV1 & Readonly<{ symbol: "+" }>,
  PrintFractionV1,
];

export type PrintWorkedExamplePromptV2 = readonly [
  PrintFractionV1,
  PrintOperatorV1 & Readonly<{ symbol: "+" }>,
  PrintFractionV1,
  PrintOperatorV1 & Readonly<{ symbol: "=" }>,
  PrintFractionV1,
];

export interface PrintTitleHeadingBlockV2 {
  readonly type: "heading";
  readonly id: string;
  readonly level: 1;
  readonly content: readonly PrintInlineV1[];
}

export interface PrintSummaryBlockV2 {
  readonly type: "paragraph";
  readonly id: "worksheet-summary";
  readonly content: readonly PrintInlineV1[];
}

export interface PrintLessonHeadingBlockV2 {
  readonly type: "heading";
  readonly id: "lesson-heading";
  readonly sourceNodeId: WorksheetPresentationV1["lesson"]["nodeId"];
  readonly level: 2;
  readonly content: readonly PrintInlineV1[];
}

export interface PrintLessonParagraphBlockV2 {
  readonly type: "paragraph";
  readonly id: string;
  readonly sourceNodeId: WorksheetPresentationV1["lesson"]["nodeId"];
  readonly paragraphOrdinal: number;
  readonly content: readonly PrintInlineV1[];
}

export interface PrintWorkedExampleBlockV2 {
  readonly type: "worked-example";
  readonly id: "worked-example";
  readonly sourceNodeId: WorksheetPresentationV1["workedExample"]["nodeId"];
  readonly title: string;
  readonly model: FractionAdditionWorkedExampleModelV1;
  readonly prompt: PrintWorkedExamplePromptV2;
  readonly steps: readonly string[];
}

export interface PrintProblemProvenanceV2 {
  readonly contentId: "math.fractions.add-unlike-denominators";
  readonly contentRevision: 2;
  readonly sourceHash: string;
  readonly contentHash: string;
  readonly compilerVersion: "exercisebook-content-compiler/2";
  readonly generatorId: "fractions.add";
  readonly generatorVersion: "1";
  readonly generationAttempt: number;
}

export interface PrintProblemV2 {
  readonly id: string;
  readonly ordinal: number;
  readonly instruction: string;
  readonly promptAccessibleText: string;
  readonly prompt: PrintFractionAdditionPromptV2;
  readonly response: PrintResponseSpaceV2;
  readonly provenance: PrintProblemProvenanceV2;
}

export interface PrintResponseSpaceV2 {
  readonly type: "fraction";
  readonly label: string;
  readonly lines: 3;
}

export interface PrintProblemGroupBlockV2 {
  readonly type: "problem-group";
  readonly id: string;
  readonly sourceNodeId: WorksheetPresentationV1["exercise"]["nodeId"];
  readonly ordinal: number;
  readonly title: string;
  readonly problems: readonly [PrintProblemV2];
}

export interface PrintFractionBarsFallbackContentV2 {
  readonly type: "fraction-bars";
  readonly label: string;
  readonly caption: string;
  readonly bars: readonly PrintFractionBarV1[];
}

export interface PrintTextFallbackContentV2 {
  readonly type: "text";
  readonly text: string;
}

export type PrintFallbackContentV2 =
  PrintFractionBarsFallbackContentV2 | PrintTextFallbackContentV2;

export interface PrintFallbackBlockV2 {
  readonly type: "print-fallback";
  readonly id: string;
  readonly problemId: string;
  readonly ordinal: number;
  readonly content: PrintFallbackContentV2;
}

export interface PrintWorkingSpaceBlockV2 {
  readonly type: "working-space";
  readonly id: string;
  readonly problemId: string;
  readonly ordinal: number;
  readonly label: string;
  readonly lines: 3;
}

export interface PrintAnswerKeyBlockV2 {
  readonly type: "answer-key";
  readonly id: string;
  readonly problemId: string;
  readonly ordinal: number;
  readonly canonicalResponse: readonly [PrintFractionV1];
  readonly explanation: readonly string[];
}

export type StudentPrintBlockV2 =
  | PrintTitleHeadingBlockV2
  | PrintSummaryBlockV2
  | PrintLessonHeadingBlockV2
  | PrintLessonParagraphBlockV2
  | PrintWorkedExampleBlockV2
  | PrintProblemGroupBlockV2
  | PrintFallbackBlockV2
  | PrintWorkingSpaceBlockV2;

export type AnswerKeyPrintBlockV2 =
  StudentPrintBlockV2 | PrintPageBreakBlockV1 | PrintAnswerKeyBlockV2;

interface PrintDocumentBaseV2 {
  readonly schema: typeof PRINT_DOCUMENT_V2_SCHEMA;
  readonly sourceInstanceSchema: typeof PRINT_DOCUMENT_V2_SOURCE_INSTANCE_SCHEMA;
  readonly sourceInstanceHash: string;
  readonly projectorVersion: typeof PRINT_PROJECTOR_V2_VERSION;
  readonly paper: PrintPaperV2;
  readonly locale: typeof PRINT_DOCUMENT_V2_LOCALE;
  readonly title: string;
  readonly attributions: readonly AttributionV1[];
}

export interface StudentPrintDocumentV2 extends PrintDocumentBaseV2 {
  readonly variant: "student";
  readonly blocks: readonly StudentPrintBlockV2[];
}

export interface AnswerKeyPrintDocumentV2 extends PrintDocumentBaseV2 {
  readonly variant: "answer-key";
  readonly blocks: readonly AnswerKeyPrintBlockV2[];
}

export type PrintDocumentV2 = StudentPrintDocumentV2 | AnswerKeyPrintDocumentV2;

export interface MaterializedPrintDocumentV2<
  Document extends PrintDocumentV2 = PrintDocumentV2,
> {
  readonly document: Document;
  readonly canonicalJson: string;
  readonly printDocumentHash: string;
}

export type MaterializedStudentPrintDocumentV2 =
  MaterializedPrintDocumentV2<StudentPrintDocumentV2>;
export type MaterializedAnswerKeyPrintDocumentV2 =
  MaterializedPrintDocumentV2<AnswerKeyPrintDocumentV2>;
