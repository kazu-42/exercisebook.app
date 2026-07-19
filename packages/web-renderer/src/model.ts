export type WebWorksheetVariant = "student" | "answer-key";

export type WebFraction = Readonly<{
  numerator: string;
  denominator: string;
}>;

export type WebFractionAdditionPrompt = Readonly<{
  kind: "fraction-addition";
  left: WebFraction;
  right: WebFraction;
  accessibleText: string;
}>;

type WebWorksheetItemBase = Readonly<{
  id: string;
  ordinal: number;
  prompt: WebFractionAdditionPrompt;
  responseLabel: string;
  printFallback: string;
}>;

export type StudentWebWorksheetItem = WebWorksheetItemBase &
  Readonly<{
    answer?: never;
    solution?: never;
  }>;

export type AnswerKeyWebWorksheetItem = WebWorksheetItemBase &
  Readonly<{
    answer: WebFraction & Readonly<{ accessibleText: string }>;
    solution: readonly string[];
  }>;

export type WebWorksheetItem = StudentWebWorksheetItem | AnswerKeyWebWorksheetItem;

export type WebWorkedExample = Readonly<{
  left: WebFraction;
  right: WebFraction;
  result: WebFraction;
  steps: readonly string[];
}>;

export type WebAttribution = Readonly<{
  label: string;
  license: string;
}>;

type WebWorksheetBase = Readonly<{
  schemaVersion: "web-worksheet.v1";
  instanceHash: string;
  assignmentId: string;
  title: string;
  skillTitle: string;
  studyDate: string;
  locale: string;
  expectedMinutes: number;
  introduction: string;
  workedExample: WebWorkedExample;
  attributions: readonly WebAttribution[];
}>;

export type StudentWebWorksheet = WebWorksheetBase &
  Readonly<{
    variant: "student";
    items: readonly StudentWebWorksheetItem[];
  }>;

export type AnswerKeyWebWorksheet = WebWorksheetBase &
  Readonly<{
    variant: "answer-key";
    items: readonly AnswerKeyWebWorksheetItem[];
  }>;

export type WebWorksheet = StudentWebWorksheet | AnswerKeyWebWorksheet;
