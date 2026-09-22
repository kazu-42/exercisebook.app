import {
  explanationRelationLabels,
  type ExplanationStep,
  type GradeItem,
  type Lesson,
  type PdfVariant,
  type Workbook,
  type WorkbookItem,
} from "../src/contracts.js";

export interface PrintAnswer {
  value: string;
  steps: readonly ExplanationStep[];
}

export interface PrintItem extends WorkbookItem {
  answer?: PrintAnswer;
}

/** A renderer-neutral, authorized snapshot; no learner responses or grading state. */
export interface PrintDocument {
  schemaVersion: "studio-print-v1";
  instanceHash: string;
  variant: PdfVariant;
  title: string;
  levelLabel: string;
  minutes: number;
  lesson: Lesson;
  items: readonly PrintItem[];
}

function escapeHtml(value: string | number): string {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

const PRINT_CSS = `
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { color: #24332e; font-family: "Workbook Noto Sans JP"; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet { width: 210mm; height: 297mm; padding: 15mm 17mm 13mm; break-after: page; display: flex; flex-direction: column; position: relative; }
.sheet:last-child { break-after: auto; }
.brand-row { display: flex; align-items: center; justify-content: space-between; border-bottom: .45mm solid #244f40; padding-bottom: 4mm; }
.brand { font-size: 14pt; letter-spacing: -.3pt; font-weight: 700; }
.edition { font-size: 8pt; letter-spacing: 1pt; }
.eyebrow { margin: 5mm 0 1.5mm; color: #465b52; font-size: 8pt; letter-spacing: 1.2pt; }
.title-row { display: flex; justify-content: space-between; align-items: flex-end; gap: 5mm; }
h1 { margin: 0; font-size: 24pt; font-weight: 600; letter-spacing: 1pt; line-height: 1.4; }
.meta { font-size: 8pt; text-align: right; line-height: 1.9; white-space: nowrap; }
.name-line { margin-top: 4mm; display: flex; justify-content: space-between; font-size: 8pt; color: #526058; }
.name-line span { display: inline-block; min-width: 53mm; border-bottom: .2mm solid #adb8b2; padding-bottom: 2mm; }
.lesson { margin-top: 5mm; border: .25mm solid #bbc8c0; border-left: 1mm solid #244f40; padding: 3mm 4mm; background: #f4f7f3; }
.lesson-label { font-size: 7.5pt; font-weight: 600; letter-spacing: 1pt; margin: 0 0 1.5mm; }
.lesson h2 { font-size: 10pt; margin: 0 0 2mm; font-weight: 600; }
.lesson p { margin: 0; font-size: 8pt; line-height: 1.65; }
.example { display: grid; grid-template-columns: minmax(0, .55fr) minmax(0, 1.45fr); gap: 4mm; align-items: start; padding-top: 2mm; margin-top: 2mm; border-top: .2mm solid #ced7d0; }
.example-label { display: block; font-size: 7.5pt; color: #526058; margin-bottom: 1mm; }
.math { font-variant-numeric: lining-nums; letter-spacing: .1pt; }
.example-formula { font-size: 14pt; line-height: 1.6; text-wrap: balance; word-break: keep-all; }
.example ol { padding-left: 4mm; margin: 0; font-size: 7.5pt; line-height: 1.5; }
.explanation-step { margin: 0 0 1.5mm; break-inside: avoid; }
.explanation-step:last-child { margin-bottom: 0; }
.step-relation { display: block; font-size: 6pt; font-weight: 500; letter-spacing: .2pt; color: #526058; line-height: 1.5; }
.step-math { font-size: 9.5pt; font-weight: 500; line-height: 1.5; }
.explanation-step .step-reason { font-size: 7.5pt; line-height: 1.55; margin: .5mm 0 0; }
.section-label { margin: 6mm 0 3mm; display: flex; justify-content: space-between; align-items: center; }
.section-label h2 { margin: 0; font-size: 10pt; font-weight: 600; }
.section-label span { font-size: 7.5pt; color: #526058; }
.problem-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; border-top: .2mm solid #adb8b2; border-left: .2mm solid #adb8b2; }
.problem-card { padding: 4mm; border-bottom: .2mm solid #adb8b2; border-right: .2mm solid #adb8b2; display: flex; flex-direction: column; break-inside: avoid; min-height: 0; }
.problem-heading { display: flex; align-items: baseline; gap: 3mm; }
.number { font-size: 10pt; font-weight: 600; color: #244f40; }
.instruction { font-size: 7.5pt; line-height: 1.6; }
.prompt { font-size: 16pt; line-height: 1.5; margin-top: 3mm; overflow-wrap: anywhere; }
.work-area { flex: 1; min-height: 14mm; margin: 4mm 0 3mm; background: repeating-linear-gradient(to bottom, transparent 0, transparent 7.8mm, #e5e9e5 7.8mm, #e5e9e5 8mm); }
.answer-line { text-align: right; font-size: 8pt; white-space: nowrap; }
.answer-line span { display: inline-block; width: 35mm; border-bottom: .25mm solid #7e8e85; height: 6mm; vertical-align: bottom; }
.continuation { margin-top: 6mm; font-size: 8.5pt; line-height: 1.8; }
.answer-note { margin: 5mm 0 0; font-size: 8.5pt; line-height: 1.9; }
.answer-list { flex: 1; min-height: 0; display: grid; grid-template-rows: repeat(4, minmax(0, 1fr)); border-top: .2mm solid #adb8b2; margin-top: 5mm; }
.solution-card { min-height: 0; border-bottom: .2mm solid #adb8b2; padding: 2mm 0; display: grid; grid-template-columns: 8mm 40mm 1fr; gap: 3mm; break-inside: avoid; }
.solution-card .prompt { font-size: 13pt; margin: 0 0 2mm; text-wrap: balance; overflow-wrap: normal; word-break: keep-all; }
.canonical-answer { font-size: 16pt; font-weight: 600; }
.answer-tag { font-size: 7pt; font-weight: 400; margin-right: 3mm; }
.solution-card ol { margin: 0; padding-left: 4mm; font-size: 8pt; line-height: 1.55; }
.solution-card .explanation-step { margin-bottom: 1mm; }
.solution-card .explanation-step:last-child { margin-bottom: 0; }
.solution-card .instruction { margin-bottom: 2mm; display: block; }
.reflection { display: flex; justify-content: space-between; padding-top: 4mm; font-size: 7.5pt; color: #526058; }
footer { display: flex; justify-content: space-between; align-items: center; gap: 2mm; padding-top: 5mm; font-size: 6.5pt; line-height: 1.4; color: #526058; }
.identity { font-size: 6.5pt; }
.page-count { min-width: 12mm; text-align: right; font-variant-numeric: tabular-nums; }
@media screen { body { background: #e5e9e5; } .sheet { margin: 8mm auto; background: white; box-shadow: 0 1mm 5mm #0002; } }
`;

function heading(workbook: PrintDocument, variant: PdfVariant): string {
  return `<header>
    <div class="brand-row"><span class="brand">Exercise Book</span><span class="edition">${variant === "student" ? "問題編" : "解答・解説編"}</span></div>
    <p class="eyebrow">中学数学 / ${escapeHtml(workbook.levelLabel)}</p>
    <div class="title-row"><h1>${escapeHtml(workbook.title)}</h1><div class="meta">全 ${workbook.items.length} 問<br>目安 ${escapeHtml(workbook.minutes)} 分</div></div>
    ${variant === "student" ? '<div class="name-line"><span>日付　　　月　　　日</span><span>名前</span></div>' : ""}
  </header>`;
}

function lesson(workbook: PrintDocument): string {
  return `<aside class="lesson"><div class="lesson-label">解く前に、ひとつ確認。</div>
    <h2>${escapeHtml(workbook.lesson.title)}</h2><p>${escapeHtml(workbook.lesson.rule)}</p>
    <div class="example"><div><span class="example-label">例題</span><div class="math example-formula">${escapeHtml(workbook.lesson.example)}</div></div>
    <ol>${workbook.lesson.steps.map(explanationStep).join("")}</ol></div>
  </aside>`;
}

function validStep(step: ExplanationStep): boolean {
  return (
    Object.hasOwn(explanationRelationLabels, step.relation) &&
    typeof step.math === "string" &&
    !!step.math.trim() &&
    typeof step.reason === "string" &&
    !!step.reason.trim()
  );
}

function explanationStep(step: ExplanationStep): string {
  return `<li class="explanation-step" data-relation="${escapeHtml(step.relation)}"><span class="step-relation">${escapeHtml(explanationRelationLabels[step.relation])}</span><div class="math step-math">${escapeHtml(step.math)}</div><p class="step-reason">${escapeHtml(step.reason)}</p></li>`;
}

function problem(item: WorkbookItem, number: number): string {
  return `<article class="problem-card" data-item-id="${escapeHtml(item.id)}">
    <div class="problem-heading"><span class="number">${String(number).padStart(2, "0")}</span><span class="instruction">${escapeHtml(item.instruction)}</span></div>
    <div class="math prompt">${escapeHtml(item.prompt)}</div><div class="work-area" aria-label="途中式を書く欄"></div>
    <div class="answer-line">答え <span></span></div>
  </article>`;
}

function solution(item: WorkbookItem, answer: PrintAnswer, number: number): string {
  return `<article class="solution-card" data-item-id="${escapeHtml(item.id)}">
    <span class="number">${String(number).padStart(2, "0")}</span>
    <div><span class="instruction">${escapeHtml(item.instruction)}</span><div class="math prompt">${escapeHtml(item.prompt)}</div>
    <div class="math canonical-answer"><span class="answer-tag">答え</span>${escapeHtml(answer.value)}</div></div>
    <ol>${answer.steps.map(explanationStep).join("")}</ol>
  </article>`;
}

/** Projects the supplied immutable workbook; never generates or grades content. */
export function projectPrintDocument(
  workbook: Workbook,
  answers: readonly GradeItem[],
  variant: PdfVariant,
): PrintDocument {
  if (workbook.schemaVersion !== "studio-workbook-v1" || workbook.saved !== false)
    throw new Error("Unsupported workbook contract for the preview print document.");
  if (variant !== "student" && variant !== "answers")
    throw new Error("Unsupported PDF variant.");
  if (
    !workbook.lesson.steps.length ||
    workbook.lesson.steps.some((step) => !validStep(step))
  )
    throw new Error("The workbook lesson must contain complete typed explanations.");
  const ids = new Set(workbook.items.map((item) => item.id));
  if (
    ![4, 6, 8].includes(workbook.items.length) ||
    workbook.count !== workbook.items.length ||
    ids.size !== workbook.items.length
  ) {
    throw new Error("Workbook items must contain 4, 6, or 8 unique matching entries.");
  }
  // Do not even traverse the answer projection when creating the student variant.
  const answerMap = new Map<string, GradeItem>();
  if (variant === "answers") {
    for (const answer of answers) {
      if (
        !ids.has(answer.id) ||
        answerMap.has(answer.id) ||
        !answer.answer.trim() ||
        answer.steps.length === 0 ||
        answer.steps.some((step) => !validStep(step))
      ) {
        throw new Error(
          "The answer key must match every workbook item exactly and include a solution.",
        );
      }
      answerMap.set(answer.id, answer);
    }
    if (answerMap.size !== ids.size) throw new Error("The answer key is incomplete.");
  }
  const projectStep = ({
    relation,
    math,
    reason,
  }: ExplanationStep): ExplanationStep => ({ relation, math, reason });
  return {
    schemaVersion: "studio-print-v1",
    instanceHash: workbook.instanceHash,
    variant,
    title: workbook.title,
    levelLabel: workbook.levelLabel,
    minutes: workbook.minutes,
    lesson: {
      title: workbook.lesson.title,
      rule: workbook.lesson.rule,
      example: workbook.lesson.example,
      steps: workbook.lesson.steps.map(projectStep),
    },
    items: workbook.items.map(({ id, prompt, instruction }): PrintItem => {
      const item: PrintItem = { id, prompt, instruction };
      if (variant === "answers") {
        const key = answerMap.get(id)!;
        item.answer = { value: key.answer, steps: key.steps.map(projectStep) };
      }
      return item;
    }),
  };
}

export function renderPrintHtml(
  source: Workbook,
  answers: readonly GradeItem[],
  variant: PdfVariant,
): string {
  const workbook = projectPrintDocument(source, answers, variant);
  const pageCount = Math.ceil(workbook.items.length / 4);
  const pages = Array.from({ length: pageCount }, (_, pageIndex) => {
    const pageItems = workbook.items.slice(pageIndex * 4, (pageIndex + 1) * 4);
    const content =
      variant === "student"
        ? `${pageIndex === 0 ? lesson(workbook) : '<p class="continuation">途中式を残しながら、自分のペースで取り組みましょう。</p>'}
        <div class="section-label"><h2>練習しよう</h2><span>計算のあとに、符号や式を見直そう。</span></div>
        <div class="problem-grid">${pageItems.map((item, index) => problem(item, pageIndex * 4 + index + 1)).join("")}</div>
        <div class="reflection"><span>終わったら、解答・解説編で確認しましょう。</span><span>取り組んだ時間　　　　　分</span></div>`
        : `<p class="answer-note">答えだけでなく、考え方も確認しましょう。<br>間違えた問題は、途中式のどこから違ったかを見つけて、もう一度。</p>
        <div class="answer-list">${pageItems.map((item, index) => solution(item, item.answer!, pageIndex * 4 + index + 1)).join("")}</div>
        <div class="reflection"><span>自分で解けた問題に印をつけましょう。</span><span>見直した問題　　　　　　　　</span></div>`;
    return `<section class="sheet ${variant}" data-page-number="${pageIndex + 1}" data-instance-hash="${escapeHtml(workbook.instanceHash)}">
      ${heading(workbook, variant)}${content}
      <footer><span>教材プレビュー / 学習記録は保存されません</span><span class="identity">SET ${escapeHtml(workbook.instanceHash.slice(0, 12))}</span><span class="page-count">${pageIndex + 1} / ${pageCount}</span></footer>
    </section>`;
  }).join("");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'"><title>${escapeHtml(workbook.title)} — ${variant === "student" ? "問題編" : "解答・解説編"}</title><style>${PRINT_CSS}</style></head><body>${pages}</body></html>`;
}
