import { describe, expect, it } from "vitest";

import { MAX_CANONICAL_INTEGER_DIGITS } from "@exercisebook/domain";

import {
  assertStudentVisibleDataHasNoRecognizedCanonicalAnswers,
  type CanonicalRationalValue,
} from "./worksheet-instance-v1.js";

const ANSWER_39_OVER_35 = [{ numerator: "39", denominator: "35" }] as const;
const ANSWER_ONE = [{ numerator: "1", denominator: "1" }] as const;

function scan(
  text: string,
  answers: readonly CanonicalRationalValue[] = ANSWER_39_OVER_35,
): void {
  assertStudentVisibleDataHasNoRecognizedCanonicalAnswers({ text }, answers);
}

describe("equivalent fraction answer leak guard", () => {
  it.each([
    ["exact fraction", "39/35"],
    ["unreduced equivalent", "78/70"],
    ["leading-zero equivalent", "078/070"],
    ["double-negative equivalent", "-78/-70"],
    ["fraction slash equivalent", "78⁄70"],
    ["division slash equivalent", "78∕70"],
    ["word separator equivalent", "78 over 70"],
    ["case-insensitive word separator", "78 OVER 70"],
    ["NFKC-compatible equivalent", "７８／７０"],
    ["TeX equivalent", String.raw`\frac{78}{70}`],
    ["noncanonical TeX equivalent", String.raw`\frac{078}{070}`],
    ["object-like equivalent", `{ "numerator": "78", "denominator": "70" }`],
    ["noncanonical object-like equivalent", `{numerator: 078, denominator: 070}`],
    ["reverse-order object-like equivalent", `{denominator: 70, numerator: 78}`],
  ])("rejects a %s", (_case, text) => {
    expect(() => scan(`Worked value: ${text}.`)).toThrow(
      "recognized canonical-answer representation",
    );
  });

  it.each([
    ["URI-encoded slash", "78%2F70"],
    ["nested URI-encoded slash", "78%252F70"],
    ["form-style encoded over", "78+over+70"],
    ["URI-encoded Unicode slash", "78%E2%81%8470"],
    ["URI-encoded TeX", "%5Cfrac%7B78%7D%7B70%7D"],
    ["URI-encoded object-like text", "%7Bnumerator%3A78%2Cdenominator%3A70%7D"],
  ])("rejects a %s equivalent after bounded normalization", (_case, text) => {
    expect(() => scan(`Worked%20value%3A+${text}.`)).toThrow(
      "recognized canonical-answer representation",
    );
  });

  it.each([
    ["different numerator", "79/70"],
    ["different denominator", "78 over 71"],
    ["opposite sign", "-78/70"],
    ["leading-zero non-equivalent", "079/070"],
    ["negative-denominator non-equivalent", "78/-70"],
    ["non-equivalent TeX", String.raw`\frac{79}{70}`],
    ["non-equivalent object-like text", `{numerator: 78, denominator: 71}`],
    ["ordinary prose containing over", "The turnover target is 70 after 78 days."],
    ["unseparated over token", "78over70"],
  ])("allows a non-equivalent %s", (_case, text) => {
    expect(() => scan(text)).not.toThrow();
  });

  it("allows a non-equivalent calendar date without special slash-chain semantics", () => {
    expect(() => scan("2026/08/02")).not.toThrow();
  });

  it.each([
    ["path around an equivalent", "archive/78/70/result"],
    ["spaced path around an equivalent", "archive/ 78/70 /result"],
    ["path around an exact answer", "archive/39/35/result"],
    ["overlapping slash-chain equivalent suffix", "1/78/70"],
    ["overlapping slash-chain exact suffix", "1/39/35"],
    ["overlapping compatibility-slash suffix", "1∕78∕70"],
    ["overlapping word-chain equivalent suffix", "1 over 78 over 70"],
    ["overlapping mixed-separator equivalent suffix", "1/78 over 70"],
  ])("still rejects a %s", (_case, text) => {
    expect(() => scan(text)).toThrow("recognized canonical-answer representation");
  });

  it("bounds integer digit tokens before comparing with BigInt", () => {
    const boundaryInteger = "9".repeat(MAX_CANONICAL_INTEGER_DIGITS);

    expect(() => scan(`${boundaryInteger}/${boundaryInteger}`, ANSWER_ONE)).toThrow(
      "recognized canonical-answer representation",
    );
  });

  it.each([
    [
      "oversized numerator",
      `${"9".repeat(MAX_CANONICAL_INTEGER_DIGITS + 1)}/1`,
      "unsupported oversized rational representation",
    ],
    [
      "oversized denominator",
      `1/${"9".repeat(MAX_CANONICAL_INTEGER_DIGITS + 1)}`,
      "unsupported oversized rational representation",
    ],
    [
      "oversized TeX integer",
      String.raw`\frac{${"9".repeat(MAX_CANONICAL_INTEGER_DIGITS + 1)}}{1}`,
      "unsupported oversized rational representation",
    ],
    [
      "oversized object-like integer",
      `{numerator: ${"9".repeat(MAX_CANONICAL_INTEGER_DIGITS + 1)}, denominator: 1}`,
      "unsupported oversized rational representation",
    ],
    [
      "form-compatible plus signs",
      "+78/+70",
      "recognized canonical-answer representation",
    ],
    ["zero denominator", "78/0", "unsupported malformed rational representation"],
    ["repeated slash", "78//70", "unsupported malformed rational representation"],
  ])("fails closed for a %s token", (_case, text, message) => {
    expect(() => scan(text)).toThrow(message);
  });

  it("fails closed on a long oversized candidate without unbounded BigInt parsing", () => {
    const oversizedInteger = "9".repeat(MAX_CANONICAL_INTEGER_DIGITS + 10_000);

    expect(() => scan(`${oversizedInteger}/1`)).toThrow(
      "unsupported oversized rational representation",
    );
  });

  it("bounds aggregate rational candidate work across normalized string leaves", () => {
    expect(() => scan("1/2 ".repeat(4_096))).not.toThrow();
    expect(() => scan("1/2 ".repeat(4_097))).toThrow(
      "canonical-answer rational scan exceeds 4096 candidates",
    );
    expect(() => scan(`${"1/".repeat(4_097)}2`)).toThrow(
      "canonical-answer rational scan exceeds 4096 candidates",
    );
  });

  it("uses one bounded signature set for 200 answers and dense candidate text", () => {
    const answers = Array.from({ length: 200 }, (_, index) => ({
      numerator: String(1_000 + index),
      denominator: "1",
    }));

    expect(() => scan("1/2 ".repeat(2_000), answers)).not.toThrow();
  });

  it("fails closed before scanning an answer context above the worksheet slot cap", () => {
    const answers = Array.from({ length: 201 }, (_, index) => ({
      numerator: String(1_000 + index),
      denominator: "1",
    }));

    expect(() => scan("Keep working.", answers)).toThrow(
      "canonical-answer context exceeds 200 answers",
    );
  });
});
