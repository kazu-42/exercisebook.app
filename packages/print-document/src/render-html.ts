import type {
  PrintAnswerKeyBlockV1,
  PrintAttributionV1,
  PrintDocumentV1,
  PrintFractionBarBlockV1,
  PrintInlineV1,
  PrintProblemGroupBlockV1,
  PrintSemanticSnapshotV1,
  PrintVariant,
  StudentPrintBlockV1,
} from "./types.js";
import {
  assertStudentDocumentHasNoAnswerData,
  validatePrintDocumentV1,
} from "./validate.js";

const BASE_CSS = String.raw`
@page {
  size: A4;
  margin: 14mm 14mm 16mm;
}

:root {
  color-scheme: light;
  font-family:
    "Noto Sans",
    "Noto Sans CJK JP",
    "Hiragino Sans",
    "Yu Gothic",
    sans-serif;
  font-size: 11pt;
  line-height: 1.45;
  color: #172032;
  background: #ffffff;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  background: #ffffff;
}

body {
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}

main {
  max-width: 182mm;
  margin: 0 auto;
}

h1,
h2,
h3,
p {
  margin-block-start: 0;
}

h1 {
  margin-block-end: 5mm;
  font-size: 22pt;
  line-height: 1.15;
}

h2 {
  margin-block: 6mm 3mm;
  font-size: 15pt;
}

.print-paragraph {
  margin-block-end: 4mm;
}

.worked-example,
.problem-group,
.problem,
.fraction-bar-figure,
.working-space {
  break-inside: avoid;
}

.problem-group,
.fraction-bar-figure {
  break-after: avoid-page;
  page-break-after: avoid;
}

.worked-example {
  margin-block: 5mm;
  padding: 4mm;
  border: 0.4mm solid #8aa0c2;
  border-radius: 2mm;
  background: #f5f8fc;
}

.worked-example ol {
  margin-block-end: 0;
}

.math-expression {
  display: inline-flex;
  align-items: center;
  gap: 0.16em;
  margin-inline: 0.12em;
  vertical-align: middle;
}

.fraction {
  display: inline-grid;
  grid-template-rows: auto auto;
  min-width: 1.4em;
  text-align: center;
  vertical-align: middle;
  line-height: 1.05;
}

.fraction-numerator {
  padding: 0 0.16em 0.08em;
  border-bottom: 0.08em solid currentColor;
}

.fraction-denominator {
  padding: 0.08em 0.16em 0;
}

.operator {
  display: inline-block;
  padding-inline: 0.15em;
  font-size: 1.2em;
}

.problem-group {
  margin-block: 7mm 4mm;
}

.problem {
  margin-block: 0 6mm;
  padding-block-end: 5mm;
  border-bottom: 0.25mm solid #d2d9e5;
}

.problem-heading {
  display: flex;
  gap: 0.5em;
  align-items: baseline;
  margin-block-end: 2mm;
  font-weight: 700;
}

.problem-number {
  min-width: 1.5em;
}

.problem-prompt {
  margin-block: 2mm 3mm;
  font-size: 15pt;
}

.response-space,
.working-lines {
  display: grid;
  gap: 5mm;
  margin-block-start: 3mm;
}

.response-line,
.working-line {
  display: block;
  min-height: 5mm;
  border-bottom: 0.25mm solid #65728a;
}

.fraction-bar-figure {
  margin: 5mm 0;
  padding: 4mm;
  border: 0.3mm solid #9aa9bd;
}

.fraction-bar-row {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  width: 100%;
  height: 8mm;
  margin-block: 2mm;
  border: 0.3mm solid #42526b;
}

.fraction-bar-segment {
  border-inline-end: 0.2mm solid #42526b;
}

.fraction-bar-segment:last-child {
  border-inline-end: 0;
}

.fraction-bar-segment.filled {
  background: #bfd7ff;
}

.working-space {
  margin-block: 6mm;
}

.page-break {
  break-before: page;
}

.attributions {
  margin-block-start: 8mm;
  padding-block-start: 3mm;
  border-top: 0.25mm solid #abb5c4;
  font-size: 8.5pt;
  color: #38445a;
}

.document-provenance {
  overflow-wrap: anywhere;
  font-family: ui-monospace, monospace;
  font-size: 7.5pt;
}
`;

const ANSWER_KEY_CSS = String.raw`
.key-banner {
  margin-block-end: 5mm;
  padding: 3mm 4mm;
  border: 0.45mm solid #7a4c00;
  background: #fff4d8;
  font-weight: 700;
}

.key-entry {
  break-inside: avoid;
  margin-block: 5mm;
  padding: 4mm;
  border-inline-start: 1.2mm solid #b56b00;
  background: #fffaf0;
}

.key-response {
  font-size: 14pt;
  font-weight: 700;
}
`;

export function renderPrintableHtml(value: unknown): string {
  const document = validatePrintDocumentV1(value);
  if (document.variant === "student") {
    assertStudentDocumentHasNoAnswerData(document);
  }

  const titleHeading = document.blocks.find(
    (block) => block.type === "heading" && block.level === 1,
  );
  if (titleHeading === undefined) {
    throw new Error("validated PrintDocumentV1 has no level-1 heading");
  }

  const body = document.blocks
    .map((block) => renderBlock(block, document.variant))
    .join("");
  const keyBanner =
    document.variant === "answer-key"
      ? '<aside class="key-banner" aria-label="Document variant">Answer key</aside>'
      : "";
  const css = document.variant === "answer-key" ? BASE_CSS + ANSWER_KEY_CSS : BASE_CSS;

  return (
    "<!doctype html>" +
    `<html lang="${escapeAttribute(document.locale)}">` +
    "<head>" +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src data:">' +
    `<title>${escapeText(document.title)}</title>` +
    `<style>${css}</style>` +
    "</head>" +
    "<body>" +
    `<main aria-labelledby="${escapeAttribute(titleHeading.id)}">` +
    keyBanner +
    body +
    renderAttributions(document.attributions, document.sourceInstanceHash) +
    "</main>" +
    "</body>" +
    "</html>"
  );
}

export function snapshotPrintSemantics(value: unknown): PrintSemanticSnapshotV1 {
  const document = validatePrintDocumentV1(value);
  const problemIds: string[] = [];
  const promptText: string[] = [];
  const keyEntries: PrintSemanticSnapshotV1["keyEntries"][number][] = [];

  for (const block of document.blocks) {
    if (block.type === "problem-group") {
      for (const problem of block.problems) {
        problemIds.push(problem.id);
        promptText.push(`${problem.instruction} ${problem.promptAccessibleText}`);
      }
    } else if (block.type === "answer-key") {
      keyEntries.push({
        problemId: block.problemId,
        responseText: inlineAccessibleText(block.canonicalResponse),
        explanation: [...block.explanation],
      });
    }
  }

  return {
    sourceInstanceHash: document.sourceInstanceHash,
    variant: document.variant,
    problemIds,
    promptText,
    attributionText: document.attributions.map(
      (attribution) =>
        `${attribution.attributionText} — ${attribution.licenseId} — ${attribution.sourceUrl}`,
    ),
    keyEntries,
  };
}

function renderBlock(
  block: StudentPrintBlockV1 | PrintAnswerKeyBlockV1,
  variant: PrintVariant,
): string {
  switch (block.type) {
    case "heading": {
      const tag = `h${String(block.level)}`;
      return `<${tag} id="${escapeAttribute(block.id)}">${renderInlines(
        block.content,
      )}</${tag}>`;
    }
    case "paragraph":
      return `<p id="${escapeAttribute(block.id)}" class="print-paragraph">${renderInlines(
        block.content,
      )}</p>`;
    case "worked-example":
      return (
        `<section id="${escapeAttribute(block.id)}" class="worked-example" aria-labelledby="${escapeAttribute(block.id)}-title">` +
        `<h2 id="${escapeAttribute(block.id)}-title">${escapeText(block.title)}</h2>` +
        `<p class="problem-prompt math-expression">${renderInlines(block.prompt)}</p>` +
        "<ol>" +
        block.steps.map((step) => `<li>${renderInlines(step)}</li>`).join("") +
        "</ol>" +
        "</section>"
      );
    case "problem-group":
      return renderProblemGroup(block);
    case "fraction-bar":
      return renderFractionBar(block);
    case "working-space":
      return (
        `<section id="${escapeAttribute(block.id)}" class="working-space" aria-label="${escapeAttribute(block.label)}">` +
        `<h2>${escapeText(block.label)}</h2>` +
        `<div class="working-lines">${renderLines(block.lines, "working-line")}</div>` +
        "</section>"
      );
    case "page-break":
      return `<div id="${escapeAttribute(block.id)}" class="page-break" role="separator" aria-label="Page break"></div>`;
    case "answer-key":
      if (variant !== "answer-key") {
        throw new Error("student renderer received an answer-key block");
      }
      return renderAnswerKey(block);
  }
}

function renderProblemGroup(block: PrintProblemGroupBlockV1): string {
  return (
    `<section id="${escapeAttribute(block.id)}" class="problem-group" aria-labelledby="${escapeAttribute(block.id)}-title">` +
    `<h2 id="${escapeAttribute(block.id)}-title">${escapeText(block.title)}</h2>` +
    block.problems
      .map(
        (problem) =>
          `<section class="problem" data-problem-id="${escapeAttribute(problem.id)}" aria-labelledby="${escapeAttribute(problem.id)}-heading">` +
          `<div id="${escapeAttribute(problem.id)}-heading" class="problem-heading">` +
          `<span class="problem-number">${String(problem.ordinal)}.</span>` +
          `<span>${escapeText(problem.instruction)}</span>` +
          "</div>" +
          `<p class="problem-prompt math-expression" role="math" aria-label="${escapeAttribute(problem.promptAccessibleText)}">${renderInlines(problem.prompt, true)}</p>` +
          `<div class="response-space" role="group" aria-label="${escapeAttribute(problem.response.label)}">` +
          renderLines(problem.response.lines, "response-line") +
          "</div>" +
          "</section>",
      )
      .join("") +
    "</section>"
  );
}

function renderFractionBar(block: PrintFractionBarBlockV1): string {
  return (
    `<figure id="${escapeAttribute(block.id)}" class="fraction-bar-figure" role="img" aria-label="${escapeAttribute(block.label)}">` +
    block.bars
      .map(
        (bar) =>
          '<div class="fraction-bar-row" aria-hidden="true">' +
          Array.from({ length: bar.denominator }, (_, index) => {
            const fillClass = index < bar.numerator ? " filled" : "";
            return `<span class="fraction-bar-segment${fillClass}"></span>`;
          }).join("") +
          "</div>",
      )
      .join("") +
    `<figcaption>${escapeText(block.caption)}</figcaption>` +
    "</figure>"
  );
}

function renderAnswerKey(block: PrintAnswerKeyBlockV1): string {
  return (
    `<section id="${escapeAttribute(block.id)}" class="key-entry" aria-labelledby="${escapeAttribute(block.id)}-title">` +
    `<h2 id="${escapeAttribute(block.id)}-title">Problem ${String(block.ordinal)}</h2>` +
    `<p class="key-response math-expression">${renderInlines(block.canonicalResponse)}</p>` +
    "<ol>" +
    block.explanation.map((step) => `<li>${escapeText(step)}</li>`).join("") +
    "</ol>" +
    "</section>"
  );
}

function renderInlines(
  inlines: readonly PrintInlineV1[],
  hideFromAccessibility = false,
): string {
  return inlines
    .map((inline) => {
      switch (inline.type) {
        case "text":
          return escapeText(inline.text);
        case "operator":
          if (hideFromAccessibility) {
            return `<span class="operator" aria-hidden="true">${escapeText(inline.symbol)}</span>`;
          }
          return (
            `<span class="operator" role="math" aria-label="${escapeAttribute(inline.accessibleText)}">` +
            `<span aria-hidden="true">${escapeText(inline.symbol)}</span>` +
            "</span>"
          );
        case "fraction":
          if (hideFromAccessibility) {
            return (
              '<span class="fraction" aria-hidden="true">' +
              '<span class="fraction-numerator">' +
              escapeText(inline.numerator) +
              "</span>" +
              '<span class="fraction-denominator">' +
              escapeText(inline.denominator) +
              "</span>" +
              "</span>"
            );
          }
          return (
            `<span class="fraction" role="math" aria-label="${escapeAttribute(inline.accessibleText)}">` +
            '<span aria-hidden="true" class="fraction-numerator">' +
            escapeText(inline.numerator) +
            "</span>" +
            '<span aria-hidden="true" class="fraction-denominator">' +
            escapeText(inline.denominator) +
            "</span>" +
            "</span>"
          );
      }
    })
    .join("");
}

function inlineAccessibleText(inlines: readonly PrintInlineV1[]): string {
  return inlines
    .map((inline) => {
      switch (inline.type) {
        case "text":
          return inline.text;
        case "operator":
        case "fraction":
          return inline.accessibleText;
      }
    })
    .join(" ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function renderLines(count: number, className: string): string {
  return Array.from({ length: count }, () => `<span class="${className}"></span>`).join(
    "",
  );
}

function renderAttributions(
  attributions: readonly PrintAttributionV1[],
  sourceInstanceHash: string,
): string {
  return (
    '<footer class="attributions" aria-label="Attribution and provenance">' +
    "<h2>Attribution</h2>" +
    "<ul>" +
    attributions
      .map(
        (attribution) =>
          "<li>" +
          escapeText(attribution.attributionText) +
          " — " +
          escapeText(attribution.licenseId) +
          ` — ${escapeText(attribution.sourceUrl)}` +
          "</li>",
      )
      .join("") +
    "</ul>" +
    `<p class="document-provenance">Source instance: ${escapeText(sourceInstanceHash)}</p>` +
    "</footer>"
  );
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
