export type TopicId = "signed-numbers" | "expressions" | "equations";
export type Level = "foundation" | "standard";
export type ProblemCount = 4 | 6 | 8;
export type PdfVariant = "student" | "answers";

export interface ExplanationStep {
  relation:
    "expression-equality" | "equivalent-equation" | "substitution" | "verification";
  math: string;
  reason: string;
}

export const explanationRelationLabels: Record<ExplanationStep["relation"], string> = {
  "expression-equality": "同じ値の式",
  "equivalent-equation": "解の変わらない変形",
  substitution: "値の代入",
  verification: "元の方程式で確認",
};

export interface Lesson {
  title: string;
  rule: string;
  example: string;
  steps: readonly ExplanationStep[];
}

export interface Topic {
  id: TopicId;
  number: string;
  title: string;
  subtitle: string;
  description: string;
  prerequisite: string;
  sample: string;
  lesson: Lesson;
}

export interface WorkbookRequest {
  topicId: TopicId;
  level: Level;
  count: ProblemCount;
}

export interface WorkbookItem {
  id: string;
  prompt: string;
  instruction: string;
}

export interface Workbook extends WorkbookRequest {
  schemaVersion: "studio-workbook-v1";
  saved: false;
  id: string;
  instanceHash: string;
  title: string;
  levelLabel: string;
  minutes: number;
  reason: string;
  lesson: Lesson;
  items: readonly WorkbookItem[];
}

export interface GradeItem {
  id: string;
  status: "correct" | "incorrect" | "unanswered" | "invalid";
  submitted: string;
  answer: string;
  steps: readonly ExplanationStep[];
}

export interface GradeResult {
  workbookId: string;
  correctCount: number;
  total: number;
  items: readonly GradeItem[];
}
