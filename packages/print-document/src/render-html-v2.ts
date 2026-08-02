import type {
  AnswerKeyPrintBlockV2,
  AnswerKeyPrintDocumentV2,
  AnswerKeyPrintSemanticSnapshotV2,
  PrintAnswerKeyBlockV2,
  PrintDocumentV2,
  PrintFallbackBlockV2,
  PrintFractionAdditionPromptV2,
  PrintProblemGroupBlockV2,
  PrintSemanticKeyEntryV2,
  PrintSemanticProblemV2,
  PrintSemanticSnapshotV2,
  PrintWorkedExampleBlockV2,
  StudentPrintBlockV2,
  StudentPrintDocumentV2,
  StudentPrintSemanticSnapshotV2,
} from "./types-v2.js";
import {
  PRINT_DOCUMENT_V2_SCHEMA,
  PRINT_SEMANTIC_SNAPSHOT_V2_SCHEMA,
} from "./types-v2.js";
import { validatePrintDocumentV2 } from "./validate-v2.js";

export const PRINTABLE_HTML_V2_RENDERER_VERSION = "printable-html.v2" as const;

/**
 * These are renderer-local resource contracts, not synchronous Worker SLOs.
 * They are intentionally omitted from the package root API.
 */
export const MAX_PRINTABLE_HTML_V2_UTF8_BYTES = 16_000_000;
export const MAX_PRINTABLE_HTML_V2_ELEMENTS = 65_536;

export type PrintDocumentV2RenderErrorCode =
  | "utf8-byte-limit-exceeded"
  | "element-limit-exceeded"
  | "unsupported-output-character"
  | "renderer-invariant-failed";

export class PrintDocumentV2RenderError extends Error {
  public readonly code: PrintDocumentV2RenderErrorCode;

  public constructor(
    code: PrintDocumentV2RenderErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PrintDocumentV2RenderError";
    this.code = code;
  }
}

export interface PrintableHtmlV2Limits {
  readonly maxUtf8Bytes: number;
  readonly maxElements: number;
}

const DEFAULT_LIMITS: PrintableHtmlV2Limits = {
  maxUtf8Bytes: MAX_PRINTABLE_HTML_V2_UTF8_BYTES,
  maxElements: MAX_PRINTABLE_HTML_V2_ELEMENTS,
};

const CSP =
  "default-src &#39;none&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;; object-src &#39;none&#39;; script-src &#39;none&#39;; connect-src &#39;none&#39;; font-src &#39;none&#39;; img-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;";

const BASE_CSS = String.raw`
@page {
  size: A4;
  margin: 14mm 14mm 16mm;
}

:root {
  color-scheme: light;
  font-family:
    system-ui,
    -apple-system,
    "Segoe UI",
    sans-serif;
  font-size: 11pt;
  line-height: 1.45;
  color: #18202b;
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

h1,
h2,
h3 {
  break-after: avoid-page;
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

h3 {
  margin-block: 0 2mm;
  font-size: 11pt;
}

h1,
h2,
h3,
p,
li,
dt,
dd,
figcaption,
.attributions {
  overflow-wrap: anywhere;
}

.print-paragraph {
  margin-block-end: 4mm;
}

.worked-example,
.problem,
.fraction-bar-figure,
.print-fallback-text,
.working-space,
.key-entry,
.attributions {
  break-inside: avoid;
}

.worked-example {
  margin-block: 5mm;
  padding: 4mm;
  border: 0.4mm solid #657181;
}

.worked-example ol,
.key-entry ol {
  margin-block-end: 0;
}

.key-entry ol {
  line-height: 1.3;
}

.math-expression {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.16em;
  min-width: 0;
  max-width: 100%;
  margin-inline: 0.12em;
  vertical-align: middle;
}

.fraction {
  display: inline-grid;
  grid-template-rows: auto auto;
  min-width: 1.4em;
  max-width: 100%;
  text-align: center;
  vertical-align: middle;
  line-height: 1.05;
}

.fraction-numerator,
.fraction-denominator {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.fraction-numerator {
  padding: 0 0.16em 0.08em;
  border-bottom: 0.08em solid currentColor;
}

.fraction-denominator {
  padding: 0.08em 0.16em;
}

.operator {
  display: inline-block;
  padding-inline: 0.15em;
  font-size: 1.2em;
}

.problem-group {
  margin-block: 7mm 4mm;
  break-after: avoid-page;
}

.problem {
  margin-block: 0 6mm;
  padding-block-end: 5mm;
  border-bottom: 0.25mm solid #9aa3af;
}

.problem-heading {
  display: flex;
  gap: 0.5em;
  align-items: baseline;
  margin-block-end: 2mm;
}

.problem-number {
  min-width: 1.5em;
  font-weight: 700;
}

.problem-instruction {
  min-width: 0;
  overflow-wrap: anywhere;
}

.problem-prompt {
  margin-block: 2mm 3mm;
  font-size: 15pt;
  overflow-wrap: anywhere;
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
  min-height: 6mm;
  border-bottom: 0.25mm solid #4f5967;
}

.fraction-bar-figure {
  margin: 5mm 0;
  padding: 4mm;
  border: 0.3mm solid #737e8c;
}

.fraction-bar-row {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  width: 100%;
  min-width: 0;
  height: 8mm;
  margin-block: 2mm;
  border: 0.3mm solid #273140;
}

.fraction-bar-segment {
  min-width: 0;
  border-inline-end: 0.2mm solid #273140;
}

.fraction-bar-segment:last-child {
  border-inline-end: 0;
}

.fraction-bar-segment.filled {
  background: repeating-linear-gradient(
    135deg,
    #768293 0,
    #768293 1.2mm,
    #d7dce2 1.2mm,
    #d7dce2 2.4mm
  );
}

.print-fallback-text,
.working-space {
  margin-block: 6mm;
}

.page-break {
  break-before: page;
}

.key-entry {
  margin-block: 2mm;
  padding: 2mm;
  border-inline-start: 1.2mm solid #4d5663;
}

.key-response {
  font-size: 14pt;
  font-weight: 700;
}

.attributions {
  margin-block-start: 4mm;
  padding-block-start: 2mm;
  border-top: 0.25mm solid #8d96a2;
  font-size: 8.5pt;
}

.attribution-details {
  margin-block: 1mm 2mm;
}

.attribution-details div {
  display: grid;
  grid-template-columns: minmax(18mm, auto) 1fr;
  gap: 2mm;
}

.attribution-details dt {
  font-weight: 700;
}

.attribution-details dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.document-provenance {
  overflow-wrap: anywhere;
  font-family: ui-monospace, monospace;
  font-size: 7.5pt;
}
`;

export function renderPrintableHtmlV2(value: unknown): string {
  return renderPrintableHtmlV2WithLimits(value, DEFAULT_LIMITS);
}

/**
 * Internal exact-boundary seam. It is intentionally not exported by the
 * package root so callers cannot weaken the production limits.
 */
export function renderPrintableHtmlV2WithLimits(
  value: unknown,
  limits: PrintableHtmlV2Limits,
): string {
  const document = validatePrintDocumentV2(value);
  assertLimits(limits);
  const writer = new BoundedHtmlWriter(limits);

  writer.append("<!doctype html>");
  writer.start(`<html lang="${escapeAttribute(document.locale)}">`);
  writer.start("<head>");
  writer.start('<meta charset="utf-8">');
  writer.start(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`);
  writer.start('<meta name="referrer" content="no-referrer">');
  writer.start('<meta name="viewport" content="width=device-width, initial-scale=1">');
  writer.start("<title>");
  writer.append(escapeText(document.title));
  writer.append("</title>");
  writer.start("<style>");
  writer.append(BASE_CSS);
  writer.append("</style>");
  writer.append("</head>");
  writer.start("<body>");
  writer.start('<main aria-labelledby="eb-v2-worksheet-title">');

  for (const block of document.blocks) {
    renderBlock(writer, block);
  }
  renderAttributions(writer, document);

  writer.append("</main>");
  writer.append("</body>");
  writer.append("</html>");
  return writer.finish();
}

export function snapshotPrintSemanticsV2(
  value: StudentPrintDocumentV2,
): StudentPrintSemanticSnapshotV2;
export function snapshotPrintSemanticsV2(
  value: AnswerKeyPrintDocumentV2,
): AnswerKeyPrintSemanticSnapshotV2;
export function snapshotPrintSemanticsV2(value: unknown): PrintSemanticSnapshotV2;
export function snapshotPrintSemanticsV2(value: unknown): PrintSemanticSnapshotV2 {
  const document = validatePrintDocumentV2(value);
  return createSemanticSnapshot(document);
}

function renderBlock(writer: BoundedHtmlWriter, block: AnswerKeyPrintBlockV2): void {
  switch (block.type) {
    case "heading":
      renderHeading(writer, block);
      return;
    case "paragraph":
      renderParagraph(writer, block);
      return;
    case "worked-example":
      renderWorkedExample(writer, block);
      return;
    case "problem-group":
      renderProblemGroup(writer, block);
      return;
    case "print-fallback":
      renderFallback(writer, block);
      return;
    case "working-space":
      renderWorkingSpace(writer, block);
      return;
    case "page-break":
      writer.start(
        `<div data-print-block-id="${escapeAttribute(block.id)}" class="page-break" aria-hidden="true">`,
      );
      writer.append("</div>");
      return;
    case "answer-key":
      renderAnswerKey(writer, block);
      return;
  }
}

function renderHeading(
  writer: BoundedHtmlWriter,
  block: Extract<AnswerKeyPrintBlockV2, { type: "heading" }>,
): void {
  const tag = block.level === 1 ? "h1" : "h2";
  writer.start(
    `<${tag} id="${domIdForHeading(block.id)}" data-print-block-id="${escapeAttribute(block.id)}">`,
  );
  renderInlines(writer, block.content);
  writer.append(`</${tag}>`);
}

function renderParagraph(
  writer: BoundedHtmlWriter,
  block: Extract<StudentPrintBlockV2, { type: "paragraph" }>,
): void {
  writer.start(
    `<p id="${domIdForParagraph(block.id)}" data-print-block-id="${escapeAttribute(block.id)}" class="print-paragraph">`,
  );
  renderInlines(writer, block.content);
  writer.append("</p>");
}

function renderWorkedExample(
  writer: BoundedHtmlWriter,
  block: PrintWorkedExampleBlockV2,
): void {
  writer.start(
    `<section id="eb-v2-worked-example" data-print-block-id="${escapeAttribute(block.id)}" class="worked-example" aria-labelledby="eb-v2-worked-example-title">`,
  );
  writer.start('<h2 id="eb-v2-worked-example-title">');
  writer.append(escapeText(block.title));
  writer.append("</h2>");
  renderMathExpression(writer, block.prompt, inlineAccessibleText(block.prompt));
  writer.start("<ol>");
  for (const step of block.steps) {
    writer.start("<li>");
    writer.append(escapeText(step));
    writer.append("</li>");
  }
  writer.append("</ol>");
  writer.append("</section>");
}

function renderProblemGroup(
  writer: BoundedHtmlWriter,
  block: PrintProblemGroupBlockV2,
): void {
  const ordinal = formatOrdinal(block.ordinal);
  const problem = block.problems[0];
  writer.start(
    `<section id="eb-v2-problem-group-${ordinal}" data-print-block-id="${escapeAttribute(block.id)}" class="problem-group" aria-labelledby="eb-v2-problem-group-${ordinal}-title">`,
  );
  writer.start(`<h2 id="eb-v2-problem-group-${ordinal}-title">`);
  writer.append(escapeText(block.title));
  writer.append("</h2>");
  writer.start(
    `<section class="problem" data-problem-id="${escapeAttribute(problem.id)}" aria-labelledby="eb-v2-problem-group-${ordinal}-title eb-v2-problem-${ordinal}-instruction">`,
  );
  writer.start(`<h3 id="eb-v2-problem-${ordinal}-heading" class="problem-heading">`);
  writer.start('<span class="problem-number" aria-hidden="true">');
  writer.append(`${String(problem.ordinal)}.`);
  writer.append("</span>");
  writer.start(
    `<span id="eb-v2-problem-${ordinal}-instruction" class="problem-instruction">`,
  );
  writer.append(escapeText(problem.instruction));
  writer.append("</span>");
  writer.append("</h3>");
  renderMathExpression(writer, problem.prompt, problem.promptAccessibleText);
  writer.start(
    `<div class="response-space" role="group" aria-label="${escapeAttribute(problem.response.label)}">`,
  );
  renderLines(writer, problem.response.lines, "response-line");
  writer.append("</div>");
  writer.append("</section>");
  writer.append("</section>");
}

function renderFallback(writer: BoundedHtmlWriter, block: PrintFallbackBlockV2): void {
  const ordinal = formatOrdinal(block.ordinal);
  if (block.content.type === "text") {
    writer.start(
      `<aside id="eb-v2-print-fallback-${ordinal}" data-print-block-id="${escapeAttribute(block.id)}" data-problem-id="${escapeAttribute(block.problemId)}" class="print-fallback-text" aria-label="Print fallback for problem ${String(block.ordinal)}">`,
    );
    writer.start("<p>");
    writer.append(escapeText(block.content.text));
    writer.append("</p>");
    writer.append("</aside>");
    return;
  }

  writer.start(
    `<figure id="eb-v2-print-fallback-${ordinal}" data-print-block-id="${escapeAttribute(block.id)}" data-problem-id="${escapeAttribute(block.problemId)}" class="fraction-bar-figure">`,
  );
  writer.start(
    `<div class="fraction-bar-diagram" role="img" aria-label="${escapeAttribute(block.content.label)}">`,
  );
  writer.start('<div class="fraction-bar-rows" aria-hidden="true">');
  for (const bar of block.content.bars) {
    writer.start('<div class="fraction-bar-row">');
    for (let index = 0; index < bar.denominator; index += 1) {
      const className =
        index < bar.numerator ? "fraction-bar-segment filled" : "fraction-bar-segment";
      writer.start(`<span class="${className}">`);
      writer.append("</span>");
    }
    writer.append("</div>");
  }
  writer.append("</div>");
  writer.append("</div>");
  writer.start("<figcaption>");
  writer.append(escapeText(block.content.caption));
  writer.append("</figcaption>");
  writer.append("</figure>");
}

function renderWorkingSpace(
  writer: BoundedHtmlWriter,
  block: Extract<StudentPrintBlockV2, { type: "working-space" }>,
): void {
  const ordinal = formatOrdinal(block.ordinal);
  writer.start(
    `<section id="eb-v2-working-space-${ordinal}" data-print-block-id="${escapeAttribute(block.id)}" data-problem-id="${escapeAttribute(block.problemId)}" class="working-space" role="group" aria-label="${escapeAttribute(block.label)}">`,
  );
  writer.start(`<h3 id="eb-v2-working-space-${ordinal}-title">`);
  writer.append(escapeText(block.label));
  writer.append("</h3>");
  writer.start('<div class="working-lines">');
  renderLines(writer, block.lines, "working-line");
  writer.append("</div>");
  writer.append("</section>");
}

function renderAnswerKey(
  writer: BoundedHtmlWriter,
  block: Extract<PrintAnswerKeyBlockV2, { type: "answer-key" }>,
): void {
  const ordinal = formatOrdinal(block.ordinal);
  writer.start(
    `<section id="eb-v2-answer-key-${ordinal}" data-print-block-id="${escapeAttribute(block.id)}" data-problem-id="${escapeAttribute(block.problemId)}" class="key-entry" aria-labelledby="eb-v2-answer-key-title eb-v2-answer-key-${ordinal}-title">`,
  );
  writer.start(`<h2 id="eb-v2-answer-key-${ordinal}-title">`);
  writer.append(`Problem ${String(block.ordinal)}`);
  writer.append("</h2>");
  writer.start(
    `<p class="key-response" role="math" aria-label="${escapeAttribute(inlineAccessibleText(block.canonicalResponse))}">`,
  );
  writer.start('<span class="math-expression" aria-hidden="true">');
  renderVisualInlines(writer, block.canonicalResponse);
  writer.append("</span>");
  writer.append("</p>");
  writer.start("<ol>");
  for (const step of block.explanation) {
    writer.start("<li>");
    writer.append(escapeText(step));
    writer.append("</li>");
  }
  writer.append("</ol>");
  writer.append("</section>");
}

function renderMathExpression(
  writer: BoundedHtmlWriter,
  inlines: PrintFractionAdditionPromptV2 | PrintWorkedExampleBlockV2["prompt"],
  accessibleText: string,
): void {
  writer.start(
    `<p class="problem-prompt" role="math" aria-label="${escapeAttribute(accessibleText)}">`,
  );
  writer.start('<span class="math-expression" aria-hidden="true">');
  renderVisualInlines(writer, inlines);
  writer.append("</span>");
  writer.append("</p>");
}

function renderVisualInlines(
  writer: BoundedHtmlWriter,
  inlines:
    | PrintFractionAdditionPromptV2
    | PrintWorkedExampleBlockV2["prompt"]
    | PrintAnswerKeyBlockV2["canonicalResponse"],
): void {
  for (const inline of inlines) {
    if (inline.type === "fraction") {
      writer.start('<span class="fraction">');
      writer.start('<span class="fraction-numerator">');
      writer.append(escapeText(inline.numerator));
      writer.append("</span>");
      writer.start('<span class="fraction-denominator">');
      writer.append(escapeText(inline.denominator));
      writer.append("</span>");
      writer.append("</span>");
    } else {
      writer.start('<span class="operator">');
      writer.append(escapeText(inline.symbol));
      writer.append("</span>");
    }
  }
}

function renderInlines(
  writer: BoundedHtmlWriter,
  inlines: Extract<StudentPrintBlockV2, { type: "heading" | "paragraph" }>["content"],
): void {
  for (const inline of inlines) {
    if (inline.type === "text") {
      writer.append(escapeText(inline.text));
    } else if (inline.type === "fraction") {
      writer.start(
        `<span class="fraction" role="math" aria-label="${escapeAttribute(inline.accessibleText)}">`,
      );
      writer.start('<span class="fraction-numerator" aria-hidden="true">');
      writer.append(escapeText(inline.numerator));
      writer.append("</span>");
      writer.start('<span class="fraction-denominator" aria-hidden="true">');
      writer.append(escapeText(inline.denominator));
      writer.append("</span>");
      writer.append("</span>");
    } else {
      writer.start(
        `<span class="operator" role="math" aria-label="${escapeAttribute(inline.accessibleText)}">`,
      );
      writer.start('<span aria-hidden="true">');
      writer.append(escapeText(inline.symbol));
      writer.append("</span>");
      writer.append("</span>");
    }
  }
}

function renderLines(
  writer: BoundedHtmlWriter,
  count: number,
  className: "response-line" | "working-line",
): void {
  for (let index = 0; index < count; index += 1) {
    writer.start(`<span class="${className}" aria-hidden="true">`);
    writer.append("</span>");
  }
}

function renderAttributions(
  writer: BoundedHtmlWriter,
  document: PrintDocumentV2,
): void {
  writer.start('<footer class="attributions">');
  writer.start('<h2 id="eb-v2-attribution-heading">');
  writer.append("Attribution and provenance");
  writer.append("</h2>");
  writer.start("<ul>");
  for (const attribution of document.attributions) {
    writer.start("<li>");
    writer.start('<p class="attribution-text">');
    writer.append(escapeText(attribution.attributionText));
    writer.append("</p>");
    writer.start('<dl class="attribution-details">');
    renderDefinition(writer, "Title", attribution.title);
    renderDefinition(writer, "Author", attribution.author);
    renderDefinition(writer, "Source", attribution.sourceUrl);
    renderDefinition(writer, "License", attribution.licenseId);
    renderDefinition(writer, "Status", attribution.publicationStatus);
    if (attribution.modifications.length > 0) {
      writer.start("<div>");
      writer.start("<dt>");
      writer.append("Modifications");
      writer.append("</dt>");
      writer.start("<dd>");
      writer.start("<ul>");
      for (const modification of attribution.modifications) {
        writer.start("<li>");
        writer.append(escapeText(modification));
        writer.append("</li>");
      }
      writer.append("</ul>");
      writer.append("</dd>");
      writer.append("</div>");
    }
    writer.append("</dl>");
    writer.append("</li>");
  }
  writer.append("</ul>");
  writer.start('<p class="document-provenance">');
  writer.append("Source instance: ");
  writer.append(escapeText(document.sourceInstanceHash));
  writer.append("</p>");
  writer.append("</footer>");
}

function renderDefinition(
  writer: BoundedHtmlWriter,
  term: string,
  description: string,
): void {
  writer.start("<div>");
  writer.start("<dt>");
  writer.append(term);
  writer.append("</dt>");
  writer.start("<dd>");
  writer.append(escapeText(description));
  writer.append("</dd>");
  writer.append("</div>");
}

function createSemanticSnapshot(document: PrintDocumentV2): PrintSemanticSnapshotV2 {
  const blocks: readonly AnswerKeyPrintBlockV2[] = document.blocks;
  const title = blocks[0];
  const summary = blocks[1];
  const lessonHeading = blocks[2];
  if (
    title?.type !== "heading" ||
    title.id !== "worksheet-title" ||
    summary?.type !== "paragraph" ||
    summary.id !== "worksheet-summary" ||
    lessonHeading?.type !== "heading" ||
    lessonHeading.id !== "lesson-heading" ||
    !("sourceNodeId" in lessonHeading)
  ) {
    throw invariantFailure();
  }
  const lessonParagraphs = blocks.filter(
    (block): block is Extract<StudentPrintBlockV2, { type: "paragraph" }> =>
      block.type === "paragraph" && block.id.startsWith("lesson-paragraph-"),
  );
  const workedExample = blocks.find(
    (block): block is PrintWorkedExampleBlockV2 => block.type === "worked-example",
  );
  if (workedExample === undefined) {
    throw invariantFailure();
  }
  const groups = blocks.filter(
    (block): block is PrintProblemGroupBlockV2 => block.type === "problem-group",
  );
  const fallbacks = blocks.filter(
    (block): block is PrintFallbackBlockV2 => block.type === "print-fallback",
  );
  const workingSpaces = blocks.filter(
    (block): block is Extract<StudentPrintBlockV2, { type: "working-space" }> =>
      block.type === "working-space",
  );
  const firstProblem = groups[0]?.problems[0];
  if (
    firstProblem === undefined ||
    fallbacks.length !== groups.length ||
    workingSpaces.length !== groups.length
  ) {
    throw invariantFailure();
  }

  const problems: PrintSemanticProblemV2[] = groups.map((group, index) => {
    const problem = group.problems[0];
    const fallback = fallbacks[index];
    const workingSpace = workingSpaces[index];
    if (
      fallback === undefined ||
      workingSpace === undefined ||
      fallback.problemId !== problem.id ||
      workingSpace.problemId !== problem.id
    ) {
      throw invariantFailure();
    }
    return {
      id: problem.id,
      ordinal: problem.ordinal,
      instruction: problem.instruction,
      prompt: {
        type: "fraction-addition",
        left: {
          numerator: problem.prompt[0].numerator,
          denominator: problem.prompt[0].denominator,
        },
        right: {
          numerator: problem.prompt[2].numerator,
          denominator: problem.prompt[2].denominator,
        },
        accessibleText: problem.promptAccessibleText,
      },
      response: {
        label: problem.response.label,
        lines: 3,
      },
      fallback: cloneFallback(fallback),
      workingSpace: {
        label: workingSpace.label,
        lines: 3,
      },
      provenance: { ...problem.provenance },
    };
  });

  const presentation = {
    schema: "exercisebook.worksheet-presentation/v1" as const,
    content: {
      id: firstProblem.provenance.contentId,
      revision: firstProblem.provenance.contentRevision,
      sourceHash: firstProblem.provenance.sourceHash,
      contentHash: firstProblem.provenance.contentHash,
      compilerVersion: firstProblem.provenance.compilerVersion,
    },
    lesson: {
      nodeId: lessonHeading.sourceNodeId,
      title: singleText(lessonHeading.content),
      paragraphs: lessonParagraphs.map((paragraph) => singleText(paragraph.content)),
    },
    workedExample: {
      nodeId: workedExample.sourceNodeId,
      title: workedExample.title,
      model: cloneWorkedExampleModel(workedExample),
      steps: [...workedExample.steps],
    },
    exercise: {
      nodeId: groups[0]?.sourceNodeId ?? "practice-01",
      instruction: firstProblem.instruction,
    },
  };

  const shared = {
    schema: PRINT_SEMANTIC_SNAPSHOT_V2_SCHEMA,
    sourceInstanceSchema: document.sourceInstanceSchema,
    sourceInstanceHash: document.sourceInstanceHash,
    printDocumentSchema: PRINT_DOCUMENT_V2_SCHEMA,
    projectorVersion: document.projectorVersion,
    paper: document.paper,
    locale: document.locale,
    worksheetTitle: singleText(title.content),
    worksheetSummary: singleText(summary.content),
    presentation,
    problems,
    attributions: document.attributions.map((attribution) => ({
      ...attribution,
      modifications: [...attribution.modifications],
    })),
  } as const;

  if (document.variant === "student") {
    return {
      ...shared,
      variant: "student",
      keyEntries: [],
    };
  }

  const keyEntries: PrintSemanticKeyEntryV2[] = blocks
    .filter((block): block is PrintAnswerKeyBlockV2 => block.type === "answer-key")
    .map((block) => {
      const response = block.canonicalResponse[0];
      return {
        problemId: block.problemId,
        ordinal: block.ordinal,
        canonicalResponse: {
          numerator: response.numerator,
          denominator: response.denominator,
          accessibleText: response.accessibleText,
        },
        explanation: [...block.explanation],
      };
    });
  return {
    ...shared,
    variant: "answer-key",
    keyEntries,
  };
}

function cloneFallback(
  block: PrintFallbackBlockV2,
): PrintSemanticProblemV2["fallback"] {
  if (block.content.type === "text") {
    return { type: "text", text: block.content.text };
  }
  return {
    type: "fraction-bars",
    label: block.content.label,
    caption: block.content.caption,
    bars: block.content.bars.map((bar) => ({ ...bar })),
  };
}

function cloneWorkedExampleModel(
  block: PrintWorkedExampleBlockV2,
): PrintSemanticSnapshotV2["presentation"]["workedExample"]["model"] {
  return {
    ...block.model,
    left: { ...block.model.left },
    right: { ...block.model.right },
    result: { ...block.model.result },
  };
}

function inlineAccessibleText(
  inlines: readonly { readonly accessibleText: string }[],
): string {
  return inlines
    .map((inline) => inline.accessibleText)
    .join(" ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function singleText(
  inlines: readonly { readonly type: string; readonly text?: string }[],
): string {
  const inline = inlines[0];
  if (inlines.length !== 1 || inline?.type !== "text" || inline.text === undefined) {
    throw invariantFailure();
  }
  return inline.text;
}

function domIdForHeading(blockId: string): string {
  switch (blockId) {
    case "worksheet-title":
      return "eb-v2-worksheet-title";
    case "lesson-heading":
      return "eb-v2-lesson-heading";
    case "answer-key-title":
      return "eb-v2-answer-key-title";
    default:
      throw invariantFailure();
  }
}

function domIdForParagraph(blockId: string): string {
  if (blockId === "worksheet-summary") {
    return "eb-v2-worksheet-summary";
  }
  const ordinal = /^lesson-paragraph-([0-9]{3})$/u.exec(blockId)?.[1];
  if (ordinal === undefined) {
    throw invariantFailure();
  }
  return `eb-v2-lesson-paragraph-${ordinal}`;
}

function formatOrdinal(value: number): string {
  return String(value).padStart(3, "0");
}

function escapeText(value: string): string {
  if (/[\u0000\r]/u.test(value)) {
    throw new PrintDocumentV2RenderError(
      "unsupported-output-character",
      "Printable HTML V2 cannot preserve one or more input characters.",
    );
  }
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function assertLimits(limits: PrintableHtmlV2Limits): void {
  if (
    !Number.isSafeInteger(limits.maxUtf8Bytes) ||
    limits.maxUtf8Bytes < 0 ||
    !Number.isSafeInteger(limits.maxElements) ||
    limits.maxElements < 0
  ) {
    throw invariantFailure();
  }
}

function invariantFailure(): PrintDocumentV2RenderError {
  return new PrintDocumentV2RenderError(
    "renderer-invariant-failed",
    "Printable HTML V2 encountered an internal renderer invariant failure.",
  );
}

class BoundedHtmlWriter {
  readonly #fragments: string[] = [];
  readonly #limits: PrintableHtmlV2Limits;
  #utf8Bytes = 0;
  #elements = 0;

  public constructor(limits: PrintableHtmlV2Limits) {
    this.#limits = limits;
  }

  public append(fragment: string): void {
    this.#append(fragment, 0);
  }

  public start(fragment: string): void {
    this.#append(fragment, 1);
  }

  public finish(): string {
    return this.#fragments.join("");
  }

  #append(fragment: string, elementIncrement: 0 | 1): void {
    const nextElements = this.#elements + elementIncrement;
    if (nextElements > this.#limits.maxElements) {
      throw new PrintDocumentV2RenderError(
        "element-limit-exceeded",
        "Printable HTML V2 exceeds its reviewed element limit.",
      );
    }
    const nextUtf8Bytes = this.#utf8Bytes + utf8ByteLength(fragment);
    if (nextUtf8Bytes > this.#limits.maxUtf8Bytes) {
      throw new PrintDocumentV2RenderError(
        "utf8-byte-limit-exceeded",
        "Printable HTML V2 exceeds its reviewed UTF-8 byte limit.",
      );
    }
    this.#elements = nextElements;
    this.#utf8Bytes = nextUtf8Bytes;
    this.#fragments.push(fragment);
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && index + 1 < value.length) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}
