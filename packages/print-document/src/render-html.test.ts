import { describe, expect, it } from "vitest";

import {
  answerKeyPrintDocumentFixture,
  canonicalAnswerLeakMarkers,
  studentPrintDocumentFixture,
} from "../../test-fixtures/src/index.js";
import {
  renderPrintableHtml,
  snapshotPrintSemantics,
  validatePrintDocumentV1,
} from "./index.js";

describe("printable HTML", () => {
  it("renders an accessible, self-contained A4 student document", () => {
    const document = validatePrintDocumentV1(studentPrintDocumentFixture);
    const html = renderPrintableHtml(document);

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("@page");
    expect(html).toContain("size: A4");
    expect(html).toContain(".worked-example,\n.problem-group,\n.problem,");
    expect(html).toContain("break-after: avoid-page");
    expect(html).toContain("page-break-after: avoid");
    expect(html).toContain('<main aria-labelledby="worksheet-title">');
    expect(html).toContain('data-problem-id="fraction-add-01"');
    expect(html).toContain('aria-label="one fourth plus one third"');
    expect(html).toContain('role="img"');
    expect(html).toContain(
      "Static fraction bars showing one fourth and one third for problem 1",
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("url(");
  });

  it("keeps problem identity/order and source hash equal across variants", () => {
    const student = snapshotPrintSemantics(
      validatePrintDocumentV1(studentPrintDocumentFixture),
    );
    const key = snapshotPrintSemantics(
      validatePrintDocumentV1(answerKeyPrintDocumentFixture),
    );

    expect(student.sourceInstanceHash).toBe(key.sourceInstanceHash);
    expect(student.problemIds).toEqual(key.problemIds);
    expect(student.promptText).toEqual(key.promptText);
    expect(student.attributionText).toEqual(key.attributionText);
  });

  it("renders key-only content only for the answer-key variant", () => {
    const html = renderPrintableHtml(
      validatePrintDocumentV1(answerKeyPrintDocumentFixture),
    );

    expect(html).toContain("Answer key");
    expect(html).toContain("7");
    expect(html).toContain("12");
    expect(html).toContain("The least common denominator is 12.");
  });

  it("escapes text and attributes instead of accepting executable markup", () => {
    const hostile = structuredClone(studentPrintDocumentFixture) as unknown as {
      title: string;
      blocks: Array<Record<string, unknown>>;
    };
    hostile.title = '</title><script data-leak="yes">alert(1)</script>';
    hostile.blocks[0] = {
      type: "heading",
      id: "worksheet-title",
      level: 1,
      content: [{ type: "text", text: '<img src=x onerror="alert(1)">' }],
    };

    const html = renderPrintableHtml(validatePrintDocumentV1(hostile));
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script");
    expect(html).toContain("&lt;img");
  });

  it("does not contain known exercise answers or traces in student bytes", () => {
    const document = validatePrintDocumentV1(studentPrintDocumentFixture);
    const serialized = canonicalizeForLeakAssertion(document);
    const html = renderPrintableHtml(document);

    for (const marker of canonicalAnswerLeakMarkers) {
      expect(serialized).not.toContain(marker);
      expect(html).not.toContain(marker);
    }
  });
});

function canonicalizeForLeakAssertion(value: unknown): string {
  return JSON.stringify(value);
}
