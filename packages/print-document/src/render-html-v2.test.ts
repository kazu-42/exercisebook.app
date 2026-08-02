import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import {
  deriveFractionAdditionPromptAccessibleText,
  type MaterializedWorksheetInstanceV2,
} from "@exercisebook/schemas";
import { beforeAll, describe, expect, it } from "vitest";

import { studentPrintDocumentFixture } from "../../test-fixtures/src/index.js";
import {
  PRINTABLE_HTML_V2_RENDERER_VERSION,
  PRINT_SEMANTIC_SNAPSHOT_V2_SCHEMA,
  PrintDocumentV2RenderError,
  projectAnswerKeyPrintDocumentV2,
  projectStudentPrintDocumentV2,
  renderPrintableHtml,
  renderPrintableHtmlV2,
  snapshotPrintSemanticsV2,
  type AnswerKeyPrintDocumentV2,
  type PrintDocumentV2,
  type StudentPrintDocumentV2,
  validatePrintDocumentV2,
} from "./index.js";
import {
  MAX_PRINTABLE_HTML_V2_ELEMENTS,
  MAX_PRINTABLE_HTML_V2_UTF8_BYTES,
  renderPrintableHtmlV2WithLimits,
} from "./render-html-v2.js";
import { createMaterializedWorksheetV2Fixture } from "./__tests__/v2-fixture.js";
import { PrintDocumentV2ValidationError } from "./validate-v2.js";

describe("PrintDocumentV2 printable HTML", () => {
  let materialized: MaterializedWorksheetInstanceV2;
  let studentDocument: StudentPrintDocumentV2;
  let answerKeyDocument: AnswerKeyPrintDocumentV2;

  beforeAll(async () => {
    materialized = await createMaterializedWorksheetV2Fixture();
    studentDocument = (
      await projectStudentPrintDocumentV2({
        materializedWorksheet: materialized,
        paper: "a4",
      })
    ).document;
    answerKeyDocument = (
      await projectAnswerKeyPrintDocumentV2({
        materializedWorksheet: materialized,
        paper: "a4",
      })
    ).document;
  });

  it("renders deterministic self-contained A4 HTML with the reviewed CSP", async () => {
    const html = renderPrintableHtmlV2(studentDocument);

    expect(PRINTABLE_HTML_V2_RENDERER_VERSION).toBe("printable-html.v2");
    expect(PRINT_SEMANTIC_SNAPSHOT_V2_SCHEMA).toBe(
      "exercisebook.print-semantic-snapshot/v2",
    );
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    expect(html).toContain("@page");
    expect(html).toContain("size: A4");
    expect(html).toContain(
      "default-src &#39;none&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;; object-src &#39;none&#39;; script-src &#39;none&#39;; connect-src &#39;none&#39;; font-src &#39;none&#39;; img-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;",
    );

    const lowercaseHtml = html.toLowerCase();
    for (const forbidden of [
      "<script",
      "<link",
      "<base",
      "<iframe",
      "<object",
      "<embed",
      "<form",
      "<audio",
      "<video",
      "<source",
      "@import",
      "@font-face",
      "url(",
    ]) {
      expect(lowercaseHtml).not.toContain(forbidden);
    }
    expect(html).not.toMatch(/\son[a-z]+\s*=/iu);
    expect(html).not.toContain("<a ");
    expect(html).toContain(materialized.instance.attributions[0]?.sourceUrl);
    expect(renderPrintableHtmlV2(structuredClone(studentDocument))).toBe(html);
    expect(await sha256Hex(html)).toBe(await sha256Hex(new TextEncoder().encode(html)));
  });

  it("freezes the exact V2 HTML and semantic-snapshot identities", async () => {
    const studentHtml = renderPrintableHtmlV2(studentDocument);
    const answerKeyHtml = renderPrintableHtmlV2(answerKeyDocument);
    const studentSnapshot = canonicalizeJson(snapshotPrintSemanticsV2(studentDocument));
    const answerKeySnapshot = canonicalizeJson(
      snapshotPrintSemanticsV2(answerKeyDocument),
    );

    expect({
      studentHtmlBytes: utf8ByteLength(studentHtml),
      studentHtmlHash: await sha256Hex(studentHtml),
      answerKeyHtmlBytes: utf8ByteLength(answerKeyHtml),
      answerKeyHtmlHash: await sha256Hex(answerKeyHtml),
      studentSnapshotBytes: utf8ByteLength(studentSnapshot),
      studentSnapshotHash: await sha256Hex(studentSnapshot),
      answerKeySnapshotBytes: utf8ByteLength(answerKeySnapshot),
      answerKeySnapshotHash: await sha256Hex(answerKeySnapshot),
    }).toEqual({
      studentHtmlBytes: 23_436,
      studentHtmlHash:
        "13b819ad153d7c0d2313d412720390ed9544bebf7033f5588e2baf86fc0a5f39",
      answerKeyHtmlBytes: 29_297,
      answerKeyHtmlHash:
        "b49c3812a26b6754d783207d11b4480e20aef112f89087a808b4a60521cb026d",
      studentSnapshotBytes: 9_055,
      studentSnapshotHash:
        "313f7dc135ccbb2bc59967c9f78da8b42f1986136f4a2fb32eedb766ebf54d67",
      answerKeySnapshotBytes: 12_450,
      answerKeySnapshotHash:
        "540ae4e7105b030597df2dd0fdfd04b5fb50d562d93d6f71942d45393412d167",
    });
  });

  it("escapes hostile text without creating executable markup", () => {
    const hostile = structuredClone(studentDocument);
    const hostileTitle =
      '</title><script data-leak="yes">alert(1)</script><img src=x onerror="alert(2)">';
    Reflect.set(hostile, "title", hostileTitle);
    const title = hostile.blocks[0];
    if (title?.type !== "heading") {
      throw new Error("Expected the title heading in the V2 fixture.");
    }
    Reflect.set(title, "content", [{ type: "text", text: hostileTitle }]);
    const paragraph = hostile.blocks.find(
      (block) => block.type === "paragraph" && block.id.startsWith("lesson-paragraph"),
    );
    if (paragraph?.type !== "paragraph") {
      throw new Error("Expected a lesson paragraph in the V2 fixture.");
    }
    Reflect.set(paragraph, "content", [
      {
        type: "text",
        text: "日本語 🙂 & < > \" ' </style><base href=https://evil.test>",
      },
    ]);

    const html = renderPrintableHtmlV2(hostile);
    expect(html).not.toContain("<script data-leak");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<base href=https://evil.test>");
    expect(html).toContain("&lt;/title&gt;&lt;script");
    expect(html).toContain('&lt;img src=x onerror="alert(2)"&gt;');
    expect(html).toContain("日本語 🙂 &amp; &lt; &gt; \" '");
    expect(html).toContain("&lt;/style&gt;&lt;base href=https://evil.test&gt;");
  });

  it("serializes every validated semantic block once and in document order", () => {
    const studentHtml = renderPrintableHtmlV2(studentDocument);
    const answerKeyHtml = renderPrintableHtmlV2(answerKeyDocument);

    expectBlockOrder(studentHtml, studentDocument.blocks);
    expectBlockOrder(answerKeyHtml, answerKeyDocument.blocks);
    expect(countOccurrences(studentHtml, 'class="problem"')).toBe(
      materialized.instance.slots.length,
    );
    expect(countOccurrences(studentHtml, 'class="response-line"')).toBe(
      materialized.instance.slots.length * 3,
    );
    expect(countOccurrences(studentHtml, 'class="working-line"')).toBe(
      materialized.instance.slots.length * 3,
    );
    expect(studentHtml).not.toContain('data-print-block-id="answer-key-');
    expect(studentHtml).not.toContain('data-print-block-id="answer-key-page-break"');
    expect(answerKeyHtml).toContain(
      'data-print-block-id="answer-key-page-break" class="page-break" aria-hidden="true"',
    );
    expect(countOccurrences(answerKeyHtml, 'class="key-entry"')).toBe(
      materialized.instance.slots.length,
    );
  });

  it("faithfully serializes every problem and answer entry from its mapped block", () => {
    const studentHtml = renderPrintableHtmlV2(studentDocument);
    const answerKeyHtml = renderPrintableHtmlV2(answerKeyDocument);

    for (const group of blocksOfType(studentDocument, "problem-group")) {
      const problem = group.problems[0];
      const blockHtml = htmlForBlock(studentHtml, group.id);
      expect(blockHtml).toContain(`data-problem-id="${problem.id}"`);
      expect(blockHtml).toContain(escapeExpectedText(problem.instruction));
      expect(blockHtml).toContain(
        `role="math" aria-label="${problem.promptAccessibleText}"`,
      );
      expect(blockHtml).toContain(
        `<span class="fraction-numerator">${problem.prompt[0].numerator}</span>`,
      );
      expect(blockHtml).toContain(
        `<span class="fraction-denominator">${problem.prompt[0].denominator}</span>`,
      );
      expect(blockHtml).toContain(
        `<span class="fraction-numerator">${problem.prompt[2].numerator}</span>`,
      );
      expect(blockHtml).toContain(
        `<span class="fraction-denominator">${problem.prompt[2].denominator}</span>`,
      );
    }

    for (const entry of blocksOfType(answerKeyDocument, "answer-key")) {
      const blockHtml = htmlForBlock(answerKeyHtml, entry.id);
      expect(blockHtml).toContain(`data-problem-id="${entry.problemId}"`);
      expect(blockHtml).toContain(`Problem ${String(entry.ordinal)}`);
      expect(blockHtml).toContain(
        `role="math" aria-label="${entry.canonicalResponse[0].accessibleText}"`,
      );
      for (const step of entry.explanation) {
        expect(blockHtml).toContain(`<li>${escapeExpectedText(step)}</li>`);
      }
    }
  });

  it("preserves coherent math alternatives, fallback captions, and labelled writing areas", () => {
    const html = renderPrintableHtmlV2(answerKeyDocument);
    const firstGroup = requireBlock(studentDocument, "problem-group");
    const firstProblem = firstGroup.problems[0];
    const firstFallback = requireBlock(studentDocument, "print-fallback");
    const firstWorkingSpace = requireBlock(studentDocument, "working-space");

    expect(html).toContain(
      `role="math" aria-label="${firstProblem.promptAccessibleText}"`,
    );
    expect(html).toContain('class="math-expression" aria-hidden="true"');
    expect(html).toContain(`role="group" aria-label="${firstProblem.response.label}"`);
    expect(html).toContain(`role="group" aria-label="${firstWorkingSpace.label}"`);
    expect(html).toContain(
      'aria-labelledby="eb-v2-problem-group-001-title eb-v2-problem-001-instruction"',
    );
    expect(html).toContain(
      'aria-labelledby="eb-v2-answer-key-title eb-v2-answer-key-001-title"',
    );
    expect(html).toContain('class="response-line" aria-hidden="true"');
    expect(html).toContain('class="working-line" aria-hidden="true"');
    if (firstFallback.content.type === "fraction-bars") {
      expect(html).toContain(
        `class="fraction-bar-diagram" role="img" aria-label="${firstFallback.content.label}"`,
      );
      expect(html).toContain(
        `<figcaption>${firstFallback.content.caption}</figcaption>`,
      );
      expect(html).toContain('class="fraction-bar-rows" aria-hidden="true"');
    }
    expect(html).toContain('<footer class="attributions"');
    expect(html).toContain('<footer class="attributions">');
    expect(html).toContain('<h2 id="eb-v2-attribution-heading">');
  });

  it("renders the text fallback instead of dropping the mapped block", () => {
    const textFallback = structuredClone(studentDocument);
    const fallback = textFallback.blocks.find(
      (block) => block.type === "print-fallback",
    );
    if (fallback?.type !== "print-fallback") {
      throw new Error("Expected a print fallback in the V2 fixture.");
    }
    Reflect.set(fallback, "content", {
      type: "text",
      text: "Draw equal-sized parts & compare them.",
    });

    const baseline = renderPrintableHtmlV2(studentDocument);
    const html = renderPrintableHtmlV2(textFallback);
    expect(html).toContain("Draw equal-sized parts &amp; compare them.");
    expect(countOccurrences(html, 'class="fraction-bar-figure"')).toBe(
      countOccurrences(baseline, 'class="fraction-bar-figure"') - 1,
    );
    expect(html).toContain(`data-print-block-id="${fallback.id}"`);
  });

  it("emits wrapping guards for validator-maximal unbroken author text", () => {
    const extreme = structuredClone(studentDocument);
    const title = "T".repeat(240);
    const lessonHeadingText = "H".repeat(240);
    const paragraphText = "P".repeat(20_000);
    const instruction = "I".repeat(500);
    const fallbackText = "F".repeat(2_000);
    const caption = "C".repeat(2_000);
    const numerator = "9".repeat(128);

    Reflect.set(extreme, "title", title);
    const titleBlock = extreme.blocks.find(
      (block) => block.type === "heading" && block.id === "worksheet-title",
    );
    const lessonHeading = extreme.blocks.find(
      (block) => block.type === "heading" && block.id === "lesson-heading",
    );
    const lessonParagraph = extreme.blocks.find(
      (block) => block.type === "paragraph" && block.id.startsWith("lesson-paragraph"),
    );
    const workedExample = requireBlock(extreme, "worked-example");
    const problemGroup = requireBlock(extreme, "problem-group");
    const problem = problemGroup.problems[0];
    const fallbacks = blocksOfType(extreme, "print-fallback");
    const textFallback = fallbacks[0];
    const captionFallback = fallbacks[1];
    if (
      titleBlock?.type !== "heading" ||
      lessonHeading?.type !== "heading" ||
      lessonParagraph?.type !== "paragraph" ||
      problem === undefined ||
      textFallback === undefined ||
      captionFallback?.content.type !== "fraction-bars"
    ) {
      throw new Error("The V2 fixture cannot exercise maximal wrapping surfaces.");
    }

    Reflect.set(titleBlock, "content", [{ type: "text", text: title }]);
    Reflect.set(lessonHeading, "content", [{ type: "text", text: lessonHeadingText }]);
    Reflect.set(lessonParagraph, "content", [{ type: "text", text: paragraphText }]);
    Reflect.set(workedExample, "title", "W".repeat(240));
    for (const group of blocksOfType(extreme, "problem-group")) {
      const groupedProblem = group.problems[0];
      if (groupedProblem === undefined) {
        throw new Error("The V2 fixture has an empty problem group.");
      }
      Reflect.set(groupedProblem, "instruction", instruction);
    }
    Reflect.set(problem.prompt[0], "numerator", numerator);
    Reflect.set(problem.prompt[0], "denominator", "1");
    Reflect.set(problem.prompt[0], "accessibleText", `${numerator} over 1`);
    Reflect.set(
      problem,
      "promptAccessibleText",
      deriveFractionAdditionPromptAccessibleText(
        { numerator, denominator: "1" },
        {
          numerator: problem.prompt[2].numerator,
          denominator: problem.prompt[2].denominator,
        },
      ),
    );
    Reflect.set(textFallback, "content", { type: "text", text: fallbackText });
    Reflect.set(captionFallback.content, "caption", caption);

    const html = renderPrintableHtmlV2(extreme);
    for (const value of [
      title,
      lessonHeadingText,
      paragraphText,
      instruction,
      fallbackText,
      caption,
      numerator,
    ]) {
      expect(html).toContain(value);
    }
    expect(html).toContain('class="problem-instruction"');
    expect(html).toMatch(
      /\.problem-instruction\s*\{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere;/su,
    );
    expect(html).toMatch(
      /\.math-expression\s*\{[^}]*flex-wrap: wrap;[^}]*min-width: 0;/su,
    );
    expect(html).toMatch(
      /\.fraction-numerator,\s*\.fraction-denominator\s*\{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere;/su,
    );
    expect(html).toMatch(
      /figcaption,\s*\.attributions\s*\{\s*overflow-wrap: anywhere;/su,
    );
  });

  it("produces complete detached student and key semantic snapshots", () => {
    const studentSnapshot = snapshotPrintSemanticsV2(studentDocument);
    const keySnapshot = snapshotPrintSemanticsV2(answerKeyDocument);

    expect(studentSnapshot).toMatchObject({
      schema: "exercisebook.print-semantic-snapshot/v2",
      sourceInstanceSchema: "exercisebook.worksheet-instance/v2",
      sourceInstanceHash: materialized.instanceHash,
      printDocumentSchema: "exercisebook.print/v2",
      projectorVersion: "print-projector.v2",
      paper: "a4",
      locale: "en",
      variant: "student",
      worksheetTitle: materialized.instance.title,
      worksheetSummary: `${materialized.instance.localStudyDate} · ${String(
        materialized.instance.expectedMinutes,
      )} minutes`,
      presentation: materialized.instance.presentation,
      attributions: materialized.instance.attributions,
      keyEntries: [],
    });
    expect(studentSnapshot.problems).toHaveLength(materialized.instance.slots.length);
    expect(keySnapshot.keyEntries).toHaveLength(materialized.instance.slots.length);
    expect(keySnapshot.keyEntries.map((entry) => entry.problemId)).toEqual(
      keySnapshot.problems.map((problem) => problem.id),
    );

    const {
      keyEntries: _studentEntries,
      variant: _studentVariant,
      ...studentShared
    } = studentSnapshot;
    const { keyEntries: _keyEntries, variant: _keyVariant, ...keyShared } = keySnapshot;
    expect(keyShared).toEqual(studentShared);
    expect(studentSnapshot.presentation).toEqual(materialized.instance.presentation);
    expect(studentSnapshot.attributions).toEqual(materialized.instance.attributions);

    const groups = blocksOfType(studentDocument, "problem-group");
    const fallbacks = blocksOfType(studentDocument, "print-fallback");
    const workingSpaces = blocksOfType(studentDocument, "working-space");
    for (const [index, group] of groups.entries()) {
      const problem = group.problems[0];
      const fallback = fallbacks[index];
      const workingSpace = workingSpaces[index];
      if (fallback === undefined || workingSpace === undefined) {
        throw new Error("Expected one fallback and working space per problem.");
      }
      expect(studentSnapshot.problems[index]).toEqual({
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
          lines: problem.response.lines,
        },
        fallback: fallback.content,
        workingSpace: {
          label: workingSpace.label,
          lines: workingSpace.lines,
        },
        provenance: problem.provenance,
      });
    }

    const sourceKeyEntries = blocksOfType(answerKeyDocument, "answer-key");
    for (const [index, sourceEntry] of sourceKeyEntries.entries()) {
      const response = sourceEntry.canonicalResponse[0];
      expect(keySnapshot.keyEntries[index]).toEqual({
        problemId: sourceEntry.problemId,
        ordinal: sourceEntry.ordinal,
        canonicalResponse: {
          numerator: response.numerator,
          denominator: response.denominator,
          accessibleText: response.accessibleText,
        },
        explanation: sourceEntry.explanation,
      });
    }

    const caller = structuredClone(studentDocument);
    const detached = snapshotPrintSemanticsV2(caller);
    const expected = structuredClone(detached);
    Reflect.set(caller.attributions[0]!, "attributionText", "Caller mutation");
    const callerParagraph = caller.blocks.find(
      (block) => block.type === "paragraph" && block.id.startsWith("lesson-paragraph"),
    );
    if (callerParagraph?.type !== "paragraph") {
      throw new Error("Expected a caller-owned lesson paragraph.");
    }
    Reflect.set(callerParagraph, "content", [
      { type: "text", text: "Caller mutation" },
    ]);
    expect(detached).toEqual(expected);
    expect(detached.attributions).not.toBe(caller.attributions);
    expect(detached.presentation.lesson.paragraphs).not.toBe(
      materialized.instance.presentation.lesson.paragraphs,
    );
  });

  it("keeps key-only data out of student HTML and snapshots", () => {
    const keyWithSentinel = structuredClone(answerKeyDocument);
    const keyEntry = keyWithSentinel.blocks.find(
      (block) => block.type === "answer-key",
    );
    if (keyEntry?.type !== "answer-key") {
      throw new Error("Expected an answer-key entry.");
    }
    Reflect.set(keyEntry, "explanation", [
      "PRIVATE_KEY_ONLY_SENTINEL",
      ...keyEntry.explanation.slice(1),
    ]);

    const studentHtml = renderPrintableHtmlV2(studentDocument);
    const keyHtml = renderPrintableHtmlV2(keyWithSentinel);
    const studentSnapshot = snapshotPrintSemanticsV2(studentDocument);

    expect(keyHtml).toContain("PRIVATE_KEY_ONLY_SENTINEL");
    expect(studentHtml).not.toContain("PRIVATE_KEY_ONLY_SENTINEL");
    expect(JSON.stringify(studentSnapshot)).not.toContain("PRIVATE_KEY_ONLY_SENTINEL");
    for (const marker of [
      "canonicalResponse",
      "solutionTrace",
      "scoringRule",
      "misconceptions",
      "baseSeed",
      "slotSeed",
      "seedSecretVersion",
    ]) {
      expect(studentHtml).not.toContain(marker);
    }
    expect(studentSnapshot.keyEntries).toEqual([]);
  });

  it("counts exact UTF-8 bytes and emitted elements before accepting output", () => {
    expect(MAX_PRINTABLE_HTML_V2_UTF8_BYTES).toBe(16_000_000);
    expect(MAX_PRINTABLE_HTML_V2_ELEMENTS).toBe(65_536);

    const html = renderPrintableHtmlV2(studentDocument);
    const exactBytes = utf8ByteLength(html);
    const exactElements = countHtmlElements(html);
    expect(
      renderPrintableHtmlV2WithLimits(studentDocument, {
        maxUtf8Bytes: exactBytes,
        maxElements: MAX_PRINTABLE_HTML_V2_ELEMENTS,
      }),
    ).toBe(html);
    expectRenderError(
      () =>
        renderPrintableHtmlV2WithLimits(studentDocument, {
          maxUtf8Bytes: exactBytes - 1,
          maxElements: MAX_PRINTABLE_HTML_V2_ELEMENTS,
        }),
      "utf8-byte-limit-exceeded",
    );
    expect(
      renderPrintableHtmlV2WithLimits(studentDocument, {
        maxUtf8Bytes: MAX_PRINTABLE_HTML_V2_UTF8_BYTES,
        maxElements: exactElements,
      }),
    ).toBe(html);
    expectRenderError(
      () =>
        renderPrintableHtmlV2WithLimits(studentDocument, {
          maxUtf8Bytes: MAX_PRINTABLE_HTML_V2_UTF8_BYTES,
          maxElements: exactElements - 1,
        }),
      "element-limit-exceeded",
    );

    const multibyte = structuredClone(studentDocument);
    const paragraph = multibyte.blocks.find(
      (block) => block.type === "paragraph" && block.id.startsWith("lesson-paragraph"),
    );
    if (paragraph?.type !== "paragraph") {
      throw new Error("Expected a lesson paragraph.");
    }
    Reflect.set(paragraph, "content", [{ type: "text", text: "日本語 🙂 & < >" }]);
    const multibyteHtml = renderPrintableHtmlV2(multibyte);
    expect(utf8ByteLength(multibyteHtml)).toBeGreaterThan(multibyteHtml.length);
    expect(
      renderPrintableHtmlV2WithLimits(multibyte, {
        maxUtf8Bytes: utf8ByteLength(multibyteHtml),
        maxElements: MAX_PRINTABLE_HTML_V2_ELEMENTS,
      }),
    ).toBe(multibyteHtml);
    expectRenderError(
      () =>
        renderPrintableHtmlV2WithLimits(multibyte, {
          maxUtf8Bytes: utf8ByteLength(multibyteHtml) - 1,
          maxElements: MAX_PRINTABLE_HTML_V2_ELEMENTS,
        }),
      "utf8-byte-limit-exceeded",
    );
  });

  it("keeps the validator-maximal element shape inside the default renderer budgets", () => {
    const maximalDocument = createMaxElementShape(answerKeyDocument);
    const html = renderPrintableHtmlV2(maximalDocument);
    const elementCount = countHtmlElements(html);
    const byteLength = utf8ByteLength(html);

    expect(maximalDocument.blocks).toHaveLength(814);
    expect(elementCount).toBe(59_046);
    expect(byteLength).toBe(2_493_161);
    expect(MAX_PRINTABLE_HTML_V2_ELEMENTS - elementCount).toBe(6_490);
    expect(elementCount).toBeLessThanOrEqual(MAX_PRINTABLE_HTML_V2_ELEMENTS);
    expect(byteLength).toBeLessThanOrEqual(MAX_PRINTABLE_HTML_V2_UTF8_BYTES);
  });

  it("validates before applying renderer limits and never invokes accessors", () => {
    let getterCalls = 0;
    const hostile = structuredClone(studentDocument);
    Object.defineProperty(hostile, "title", {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        return studentDocument.title;
      },
    });

    expect(() =>
      renderPrintableHtmlV2WithLimits(hostile, {
        maxUtf8Bytes: -1,
        maxElements: 1.5,
      }),
    ).toThrow(PrintDocumentV2ValidationError);
    expect(() => snapshotPrintSemanticsV2(hostile)).toThrow(
      PrintDocumentV2ValidationError,
    );
    expect(getterCalls).toBe(0);

    for (const invalidLimits of [
      { maxUtf8Bytes: -1, maxElements: 1 },
      { maxUtf8Bytes: 1.5, maxElements: 1 },
      { maxUtf8Bytes: Number.POSITIVE_INFINITY, maxElements: 1 },
      { maxUtf8Bytes: 1, maxElements: -1 },
    ]) {
      expectRenderError(
        () => renderPrintableHtmlV2WithLimits(studentDocument, invalidLimits),
        "renderer-invariant-failed",
      );
    }
  });

  it.each(["before\u0000after", "before\rafter", "before\r\nafter"])(
    "rejects parser-normalized text %j instead of silently changing semantics",
    (unsafeText) => {
      const nulText = structuredClone(studentDocument);
      const paragraph = nulText.blocks.find(
        (block) =>
          block.type === "paragraph" && block.id.startsWith("lesson-paragraph"),
      );
      if (paragraph?.type !== "paragraph") {
        throw new Error("Expected a lesson paragraph.");
      }
      Reflect.set(paragraph, "content", [{ type: "text", text: unsafeText }]);

      expectRenderError(
        () => renderPrintableHtmlV2(nulText),
        "unsupported-output-character",
      );
    },
  );

  it("keeps the V1 and V2 renderer entrypoints mutually exclusive", () => {
    expect(() => renderPrintableHtmlV2(studentPrintDocumentFixture)).toThrow(
      PrintDocumentV2ValidationError,
    );
    expect(() => renderPrintableHtml(studentDocument)).toThrow();
  });
});

function requireBlock<Type extends PrintDocumentV2["blocks"][number]["type"]>(
  document: PrintDocumentV2,
  type: Type,
): Extract<PrintDocumentV2["blocks"][number], { type: Type }> {
  const block = document.blocks.find(
    (
      candidate,
    ): candidate is Extract<PrintDocumentV2["blocks"][number], { type: Type }> =>
      candidate.type === type,
  );
  if (block === undefined) {
    throw new Error(`Expected a ${type} block in the V2 fixture.`);
  }
  return block as unknown as Extract<PrintDocumentV2["blocks"][number], { type: Type }>;
}

function blocksOfType<Type extends PrintDocumentV2["blocks"][number]["type"]>(
  document: PrintDocumentV2,
  type: Type,
): readonly Extract<PrintDocumentV2["blocks"][number], { type: Type }>[] {
  return document.blocks.filter(
    (block) => block.type === type,
  ) as unknown as readonly Extract<PrintDocumentV2["blocks"][number], { type: Type }>[];
}

function expectBlockOrder(html: string, blocks: PrintDocumentV2["blocks"]): void {
  let cursor = 0;
  for (const block of blocks) {
    const token = `data-print-block-id="${block.id}"`;
    const index = html.indexOf(token, cursor);
    expect(index, `Missing or out-of-order block ${block.id}`).toBeGreaterThanOrEqual(
      cursor,
    );
    expect(countOccurrences(html, token), `Duplicate block ${block.id}`).toBe(1);
    cursor = index + token.length;
  }
  expect(html.indexOf('<footer class="attributions"', cursor)).toBeGreaterThanOrEqual(
    cursor,
  );
}

function countOccurrences(value: string, token: string): number {
  return value.split(token).length - 1;
}

function htmlForBlock(html: string, blockId: string): string {
  const marker = `data-print-block-id="${blockId}"`;
  const start = html.indexOf(marker);
  if (start < 0) {
    throw new Error(`Missing HTML block ${blockId}.`);
  }
  const next = html.indexOf('data-print-block-id="', start + marker.length);
  return html.slice(start, next < 0 ? html.length : next);
}

function escapeExpectedText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function countHtmlElements(html: string): number {
  return [...html.matchAll(/<[a-z][a-z0-9-]*(?:\s|>)/gu)].length;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function expectRenderError(
  operation: () => unknown,
  code: PrintDocumentV2RenderError["code"],
): void {
  try {
    operation();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(PrintDocumentV2RenderError);
    expect(error).toMatchObject({
      name: "PrintDocumentV2RenderError",
      code,
    });
    return;
  }
  throw new Error(`Expected PrintDocumentV2RenderError with code ${code}.`);
}

type DeepMutable<Value> = Value extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: DeepMutable<Value[Key]> }
    : Value;

function createMaxElementShape(
  source: AnswerKeyPrintDocumentV2,
): AnswerKeyPrintDocumentV2 {
  const document = structuredClone(source) as DeepMutable<AnswerKeyPrintDocumentV2>;
  const firstGroupIndex = document.blocks.findIndex(
    (block) => block.type === "problem-group",
  );
  const pageBreakIndex = document.blocks.findIndex(
    (block) => block.type === "page-break",
  );
  const prefix = document.blocks.slice(0, firstGroupIndex);
  const groupTemplate = document.blocks[firstGroupIndex];
  const fallbackTemplate = document.blocks[firstGroupIndex + 1];
  const workingTemplate = document.blocks[firstGroupIndex + 2];
  const pageBreak = document.blocks[pageBreakIndex];
  const keyTitle = document.blocks[pageBreakIndex + 1];
  const keyTemplate = document.blocks.find((block) => block.type === "answer-key");
  const paragraphTemplate = prefix.find(
    (block) =>
      block.type === "paragraph" &&
      block.id.startsWith("lesson-paragraph-") &&
      "paragraphOrdinal" in block,
  );
  const workedIndex = prefix.findIndex((block) => block.type === "worked-example");

  if (
    firstGroupIndex < 0 ||
    pageBreakIndex < 0 ||
    groupTemplate?.type !== "problem-group" ||
    fallbackTemplate?.type !== "print-fallback" ||
    fallbackTemplate.content.type !== "fraction-bars" ||
    workingTemplate?.type !== "working-space" ||
    pageBreak?.type !== "page-break" ||
    keyTitle?.type !== "heading" ||
    keyTemplate === undefined ||
    paragraphTemplate?.type !== "paragraph" ||
    !("paragraphOrdinal" in paragraphTemplate) ||
    workedIndex < 0
  ) {
    throw new Error("The V2 answer-key fixture shape changed.");
  }

  const extraParagraphs = Array.from({ length: 5 }, (_, offset) => {
    const ordinal = offset + 4;
    const block = structuredClone(paragraphTemplate);
    block.id = `lesson-paragraph-${String(ordinal).padStart(3, "0")}`;
    block.paragraphOrdinal = ordinal;
    block.content = [{ type: "text", text: `Paragraph ${String(ordinal)}` }];
    return block;
  });
  prefix.splice(workedIndex, 0, ...extraParagraphs);

  const promptAccessibleText = deriveFractionAdditionPromptAccessibleText(
    { numerator: "1", denominator: "100" },
    { numerator: "1", denominator: "100" },
  );
  const pad = (value: number): string => String(value).padStart(3, "0");
  const problemBlocks: DeepMutable<AnswerKeyPrintDocumentV2["blocks"]> = [];
  const keyBlocks: DeepMutable<AnswerKeyPrintDocumentV2["blocks"]> = [];

  for (let ordinal = 1; ordinal <= 200; ordinal += 1) {
    const problemId = `practice-${pad(ordinal)}`;
    const group = structuredClone(groupTemplate);
    const problem = group.problems[0];
    if (problem === undefined) {
      throw new Error("The V2 problem-group fixture is empty.");
    }
    group.id = `problem-group-${pad(ordinal)}`;
    group.ordinal = ordinal;
    group.title = `Problem ${String(ordinal)}`;
    problem.id = problemId;
    problem.ordinal = ordinal;
    problem.response.label = `Response space for problem ${String(ordinal)}`;
    problem.prompt[0] = {
      type: "fraction",
      numerator: "1",
      denominator: "100",
      accessibleText: "1 over 100",
    };
    problem.prompt[2] = {
      type: "fraction",
      numerator: "1",
      denominator: "100",
      accessibleText: "1 over 100",
    };
    problem.promptAccessibleText = promptAccessibleText;

    const fallback = structuredClone(fallbackTemplate);
    if (fallback.content.type !== "fraction-bars") {
      throw new Error("The V2 print fallback fixture changed type.");
    }
    fallback.id = `print-fallback-${pad(ordinal)}`;
    fallback.problemId = problemId;
    fallback.ordinal = ordinal;
    fallback.content.label = promptAccessibleText;
    fallback.content.bars = [
      { numerator: 1, denominator: 100, label: "1/100" },
      { numerator: 1, denominator: 100, label: "1/100" },
    ];

    const working = structuredClone(workingTemplate);
    working.id = `working-space-${pad(ordinal)}`;
    working.problemId = problemId;
    working.ordinal = ordinal;
    working.label = `Working space for problem ${String(ordinal)}`;
    problemBlocks.push(group, fallback, working);

    const key = structuredClone(keyTemplate);
    key.id = `answer-key-${pad(ordinal)}`;
    key.problemId = problemId;
    key.ordinal = ordinal;
    key.canonicalResponse = [
      {
        type: "fraction",
        numerator: "1",
        denominator: "50",
        accessibleText: "1 over 50",
      },
    ];
    key.explanation = Array.from(
      { length: 20 },
      (_, index) => `Step ${String(index + 1)}`,
    );
    keyBlocks.push(key);
  }

  document.blocks = [...prefix, ...problemBlocks, pageBreak, keyTitle, ...keyBlocks];
  const attribution = document.attributions[0];
  if (attribution === undefined) {
    throw new Error("The V2 answer-key fixture has no attribution.");
  }
  document.attributions = Array.from({ length: 100 }, () => ({
    ...structuredClone(attribution),
    modifications: Array.from(
      { length: 50 },
      (_, index) => `Modification ${String(index + 1)}`,
    ),
  }));

  return validatePrintDocumentV2(document) as AnswerKeyPrintDocumentV2;
}
