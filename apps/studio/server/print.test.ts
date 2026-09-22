import { describe, expect, it } from "vitest";

import {
  explanationRelationLabels,
  type ExplanationStep,
  type GradeItem,
  type Workbook,
} from "../src/contracts.js";
import { projectPrintDocument, renderPrintHtml } from "./print.js";

const workbook: Workbook = {
  schemaVersion: "studio-workbook-v1",
  saved: false,
  id: "workbook-print-fixture",
  instanceHash: "abcdef0123456789".repeat(4),
  topicId: "equations",
  level: "foundation",
  count: 4,
  title: "一次方程式",
  levelLabel: "基礎を固める",
  minutes: 8,
  reason: "移項の基本を練習します。",
  lesson: {
    title: "両辺に同じ操作をする",
    rule: "等式を保ちながら、文字をひとつにまとめましょう。",
    example: "x + 2 = 5",
    steps: [
      { relation: "equivalent-equation", math: "x = 3", reason: "両辺から 2 を引く。" },
    ],
  },
  items: Array.from({ length: 4 }, (_, index) => ({
    id: `item-${index + 1}`,
    prompt: `x + ${index + 4} = ${index + 15}`,
    instruction: "x の値を求めましょう。",
  })),
};

const answers: readonly GradeItem[] = workbook.items.map((item, index) => ({
  id: item.id,
  status: "unanswered",
  submitted: "DO-NOT-PRINT-SUBMITTED",
  answer: `CANONICAL-ANSWER-${index + 1}`,
  steps: [
    {
      relation: "equivalent-equation",
      math: `SOLUTION-STEP-${index + 1}`,
      reason: `SOLUTION-REASON-${index + 1}`,
    },
  ],
}));

describe("Japanese workbook print projection", () => {
  it("never serializes practice answers, solution steps, or submitted work into student HTML", () => {
    const html = renderPrintHtml(workbook, answers, "student");

    expect(html).not.toContain("CANONICAL-ANSWER");
    expect(html).not.toContain("SOLUTION-STEP");
    expect(html).not.toContain("DO-NOT-PRINT-SUBMITTED");
    expect(html).toContain(workbook.lesson.example);
    expect(html).toContain("教材プレビュー / 学習記録は保存されません");
  });

  it("projects a renderer-neutral snapshot that excludes learner submissions and student answers", () => {
    const student = projectPrintDocument(workbook, answers, "student");
    expect(student.schemaVersion).toBe("studio-print-v1");
    expect(student.instanceHash).toBe(workbook.instanceHash);
    expect(student.lesson).toEqual(workbook.lesson);
    expect(student.lesson).not.toBe(workbook.lesson);
    expect(student.items).toEqual(workbook.items);
    expect(JSON.stringify(student)).not.toMatch(
      /CANONICAL-ANSWER|SOLUTION-STEP|DO-NOT-PRINT-SUBMITTED|"status"/,
    );
    const answerDocument = projectPrintDocument(workbook, answers, "answers");
    expect(answerDocument.items[0]!.answer).toEqual({
      value: answers[0]!.answer,
      steps: answers[0]!.steps,
    });
    expect(JSON.stringify(answerDocument)).not.toContain("DO-NOT-PRINT-SUBMITTED");
  });

  it("preserves the instance, question order, and content in both variants", () => {
    for (const variant of ["student", "answers"] as const) {
      const html = renderPrintHtml(workbook, [...answers].reverse(), variant);
      expect(html).toContain(`data-instance-hash="${workbook.instanceHash}"`);
      expect(html).toContain("abcdef012345");
      let previous = -1;
      for (const item of workbook.items) {
        const position = html.indexOf(item.prompt);
        expect(position).toBeGreaterThan(previous);
        previous = position;
      }
      expect(html).not.toContain("DO-NOT-PRINT-SUBMITTED");
    }
    const answerHtml = renderPrintHtml(workbook, answers, "answers");
    for (const answer of answers) {
      expect(answerHtml).toContain(answer.answer);
      expect(answerHtml).toContain(answer.steps[0]!.math);
      expect(answerHtml).toContain(answer.steps[0]!.reason);
    }
  });

  it("preserves typed mathematics, reasons, and relation labels without inventing equality or arrows", () => {
    const answerHtml = renderPrintHtml(workbook, answers, "answers");
    const studentHtml = renderPrintHtml(workbook, [], "student");
    for (const html of [answerHtml, studentHtml]) {
      expect(html).toContain('data-relation="equivalent-equation"');
      expect(html).toContain(explanationRelationLabels["equivalent-equation"]);
      expect(html).not.toContain("→");
    }
    expect(studentHtml).toContain('<div class="math step-math">x = 3</div>');
    expect(studentHtml).toContain('<p class="step-reason">両辺から 2 を引く。</p>');
    expect(studentHtml).not.toContain("SOLUTION-REASON");
  });

  it("rejects missing step fields and unknown relations rather than printing an incomplete explanation", () => {
    for (const step of [
      { relation: "equivalent-equation", math: " ", reason: "理由" },
      { relation: "equivalent-equation", math: "x = 1", reason: " " },
      { relation: "invented-relation", math: "x = 1", reason: "理由" },
    ]) {
      expect(() =>
        renderPrintHtml(
          workbook,
          answers.map((answer) => ({ ...answer, steps: [step as ExplanationStep] })),
          "answers",
        ),
      ).toThrow(/answer key/i);
      expect(() =>
        renderPrintHtml(
          {
            ...workbook,
            lesson: { ...workbook.lesson, steps: [step as ExplanationStep] },
          },
          [],
          "student",
        ),
      ).toThrow(/lesson/i);
    }
  });

  it("requests only the bundled font family and permits only inline font bytes", () => {
    const html = renderPrintHtml(workbook, [], "student");
    expect(html).toContain('font-family: "Workbook Noto Sans JP"');
    expect(html).toContain("font-src data:");
    expect(html).not.toMatch(
      /Hiragino|Yu Gothic|Times New Roman|Georgia|font-family:\s*(?:serif|sans-serif|monospace)/,
    );
  });

  it("rejects incomplete, unrelated, duplicate, and empty answer keys", () => {
    const invalidKeys = [
      [],
      answers.slice(1),
      [...answers, answers[0]!],
      [answers[0]!, answers[0]!, ...answers.slice(2)],
      answers.map((answer) => ({ ...answer, id: `unrelated-${answer.id}` })),
      answers.map((answer) => ({ ...answer, answer: " " })),
      answers.map((answer) => ({ ...answer, steps: [] })),
    ];
    for (const key of invalidKeys) {
      expect(() => renderPrintHtml(workbook, key, "answers")).toThrow(/answer key/i);
    }
    expect(() => renderPrintHtml(workbook, [], "student")).not.toThrow();
  });

  it("escapes every text and attribute boundary", () => {
    const attack = `\"><script>alert('pdf')</script>&`;
    const hostile: Workbook = {
      ...workbook,
      id: attack,
      instanceHash: attack,
      title: attack,
      levelLabel: attack,
      lesson: {
        title: attack,
        rule: attack,
        example: attack,
        steps: [{ relation: "equivalent-equation", math: attack, reason: attack }],
      },
      items: workbook.items.map((item) => ({
        ...item,
        prompt: attack,
        instruction: attack,
      })),
    };
    const html = renderPrintHtml(
      hostile,
      answers.map((answer) => ({
        ...answer,
        answer: attack,
        steps: [{ relation: "equivalent-equation", math: attack, reason: attack }],
      })),
      "answers",
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain(
      "&quot;&gt;&lt;script&gt;alert(&#39;pdf&#39;)&lt;/script&gt;&amp;",
    );
    expect(html).not.toMatch(/<(?:script|iframe|img|link)\b/i);
  });

  it("gives every A4 page an explicit page count and keeps four questions per sheet", () => {
    const eight: Workbook = {
      ...workbook,
      count: 8,
      items: [
        ...workbook.items,
        ...workbook.items.map((item) => ({ ...item, id: `${item.id}-next` })),
      ],
    };
    const html = renderPrintHtml(eight, [], "student");
    expect(html.match(/class="sheet /g)).toHaveLength(2);
    expect(html).toContain("1 / 2");
    expect(html).toContain("2 / 2");
    expect(html.match(/class="problem-card"/g)).toHaveLength(8);
    expect(html).toContain("size: A4 portrait");
  });

  it("rejects unsupported variants and invalid worksheet shape", () => {
    expect(() => renderPrintHtml(workbook, answers, "unknown" as "student")).toThrow(
      /variant/i,
    );
    expect(() => renderPrintHtml({ ...workbook, items: [] }, [], "student")).toThrow(
      /items/i,
    );
    expect(() =>
      renderPrintHtml(
        {
          ...workbook,
          items: [workbook.items[0]!, workbook.items[0]!, ...workbook.items.slice(2)],
        },
        [],
        "student",
      ),
    ).toThrow(/items/i);
  });
});
