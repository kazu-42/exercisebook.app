import { describe, expect, it, vi } from "vitest";

import { MAX_CANONICAL_INTEGER_DIGITS } from "@exercisebook/domain";

import {
  assertStudentVisibleDataHasNoRecognizedCanonicalAnswers,
  type CanonicalRationalValue,
} from "./worksheet-instance-v1.js";
import {
  prepareStudentVisibleAnswerGuard,
  type PreparedStudentVisibleAnswerGuard,
} from "./trusted-student-projection.js";

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

describe("prepared equivalent fraction answer leak guard", () => {
  it("detaches prepared answer signatures from later source mutations", () => {
    const mutableAnswer = { numerator: "39", denominator: "35" };
    const guard: PreparedStudentVisibleAnswerGuard = prepareStudentVisibleAnswerGuard([
      mutableAnswer,
    ]);

    mutableAnswer.numerator = "1";
    mutableAnswer.denominator = "2";

    expect(() =>
      guard.assertDoesNotRevealAnyAnswer({ text: "Worked value: 1/2." }),
    ).not.toThrow();
    expect(() =>
      guard.assertDoesNotRevealAnyAnswer({ text: "Worked value: 78/70." }),
    ).toThrow("recognized canonical-answer representation");
  });

  it("keeps prepared answer authority frozen, opaque, and non-serializing", () => {
    const guard = prepareStudentVisibleAnswerGuard(ANSWER_39_OVER_35);

    expect(Object.isFrozen(guard)).toBe(true);
    expect(Object.keys(guard)).toEqual([]);
    expect(JSON.stringify(guard)).toBe("{}");
  });

  it("keeps duplicate answer signatures addressable by every owning index", () => {
    const answers = [
      { numerator: "39", denominator: "35" },
      { numerator: "39", denominator: "35" },
    ] as const;

    for (const answerIndex of [0, 1]) {
      expect(() =>
        prepareStudentVisibleAnswerGuard(answers).assertDoesNotRevealAnswerAt(
          { text: "78/70" },
          answerIndex,
        ),
      ).toThrow("recognized canonical-answer representation");
    }
  });

  it("does not rebuild 200 prepared answer signatures for later scans", () => {
    const answers = Array.from({ length: 200 }, (_, index) => ({
      numerator: String(1_000 + index),
      denominator: "1",
    }));
    const guard = prepareStudentVisibleAnswerGuard(answers);
    const bigIntSpy = vi.spyOn(globalThis, "BigInt");

    try {
      guard.assertDoesNotRevealAnyAnswer({ text: "1/2" });
      guard.assertDoesNotRevealAnswerAt({ text: "2/3" }, 199);

      expect(bigIntSpy).toHaveBeenCalledTimes(4);
    } finally {
      bigIntSpy.mockRestore();
    }
  });

  it("supports all-answer and indexed-answer scopes and rejects invalid indices", () => {
    const answers = [
      { numerator: "39", denominator: "35" },
      { numerator: "2", denominator: "3" },
    ] as const;
    const guard = prepareStudentVisibleAnswerGuard(answers);

    expect(() =>
      guard.assertDoesNotRevealAnswerAt({ text: "Worked value: 4/6." }, 0),
    ).not.toThrow();
    expect(() =>
      guard.assertDoesNotRevealAnyAnswer({ text: "Worked value: 4/6." }),
    ).toThrow("recognized canonical-answer representation");
    expect(() =>
      prepareStudentVisibleAnswerGuard(answers).assertDoesNotRevealAnswerAt(
        { text: "Worked value: 4/6." },
        1,
      ),
    ).toThrow("recognized canonical-answer representation");

    for (const invalidIndex of [-1, 2, 0.5, Number.NaN]) {
      expect(() =>
        prepareStudentVisibleAnswerGuard(answers).assertDoesNotRevealAnswerAt(
          { text: "Keep working." },
          invalidIndex,
        ),
      ).toThrow(/canonical-answer index/i);
    }
  });

  it.each(["1/78/70", "1∕78∕70", "1 over 78 over 70", "1/78 over 70"])(
    "preserves overlapping candidate detection for %s",
    (text) => {
      const guard = prepareStudentVisibleAnswerGuard(ANSWER_39_OVER_35);

      expect(() => guard.assertDoesNotRevealAnyAnswer({ text })).toThrow(
        "recognized canonical-answer representation",
      );
    },
  );

  it("preserves overlapping candidate detection for an indexed answer scope", () => {
    const guard = prepareStudentVisibleAnswerGuard(ANSWER_39_OVER_35);

    expect(() => guard.assertDoesNotRevealAnswerAt({ text: "1/78/70" }, 0)).toThrow(
      "recognized canonical-answer representation",
    );
  });

  it("preserves the 4096-candidate limit independently for each assertion", () => {
    const atLimitGuard = prepareStudentVisibleAnswerGuard(ANSWER_39_OVER_35);
    expect(() =>
      atLimitGuard.assertDoesNotRevealAnyAnswer({ text: "1/2 ".repeat(4_096) }),
    ).not.toThrow();

    const aboveLimitGuard = prepareStudentVisibleAnswerGuard(ANSWER_39_OVER_35);
    expect(() =>
      aboveLimitGuard.assertDoesNotRevealAnyAnswer({ text: "1/2 ".repeat(4_097) }),
    ).toThrow(/prepared canonical-answer assertion exceeds 4096 candidates/i);
  });

  it("charges URI-normalized-only candidates to the prepared assertion budget", () => {
    expect(() =>
      prepareStudentVisibleAnswerGuard(ANSWER_39_OVER_35).assertDoesNotRevealAnyAnswer({
        text: "1%2F2 ".repeat(4_096),
      }),
    ).not.toThrow();
    expect(() =>
      prepareStudentVisibleAnswerGuard(ANSWER_39_OVER_35).assertDoesNotRevealAnyAnswer({
        text: "1%2F2 ".repeat(4_097),
      }),
    ).toThrow(/prepared canonical-answer assertion exceeds 4096 candidates/i);
  });

  it("shares an 8192-candidate aggregate budget across all and indexed assertions", () => {
    const guard = prepareStudentVisibleAnswerGuard(ANSWER_39_OVER_35);
    const candidates = { text: "1/2 ".repeat(2_048) };

    expect(() => guard.assertDoesNotRevealAnyAnswer(candidates)).not.toThrow();
    expect(() => guard.assertDoesNotRevealAnswerAt(candidates, 0)).not.toThrow();
    expect(() => guard.assertDoesNotRevealAnyAnswer(candidates)).not.toThrow();
    expect(() => guard.assertDoesNotRevealAnswerAt(candidates, 0)).not.toThrow();
    expect(() => guard.assertDoesNotRevealAnyAnswer({ text: "1/2" })).toThrow(
      /prepared canonical-answer phase exceeds 8192 candidates/i,
    );
  });

  it("charges structured rational candidates to the same local scan budget", () => {
    const candidates = (count: number) =>
      Array.from({ length: count }, () => ({ numerator: "1", denominator: "2" }));
    const atLimitGuard = prepareStudentVisibleAnswerGuard(ANSWER_39_OVER_35);

    expect(() =>
      atLimitGuard.assertDoesNotRevealAnyAnswer(candidates(4_096)),
    ).not.toThrow();

    const aboveLimitGuard = prepareStudentVisibleAnswerGuard(ANSWER_39_OVER_35);
    expect(() =>
      aboveLimitGuard.assertDoesNotRevealAnyAnswer(candidates(4_097)),
    ).toThrow(/prepared canonical-answer assertion exceeds 4096 candidates/i);
  });

  it("shares one local candidate budget between structured and text forms", () => {
    const structuredCandidates = Array.from({ length: 2_048 }, () => ({
      numerator: "1",
      denominator: "2",
    }));
    const guard = prepareStudentVisibleAnswerGuard(ANSWER_39_OVER_35);

    expect(() =>
      guard.assertDoesNotRevealAnyAnswer({
        structuredCandidates,
        text: "1/2 ".repeat(2_049),
      }),
    ).toThrow(/prepared canonical-answer assertion exceeds 4096 candidates/i);
  });

  it("charges structured and text candidates to one aggregate session budget", () => {
    const structuredCandidates = Array.from({ length: 4_096 }, () => ({
      numerator: "1",
      denominator: "2",
    }));
    const guard = prepareStudentVisibleAnswerGuard(ANSWER_39_OVER_35);

    expect(() =>
      guard.assertDoesNotRevealAnyAnswer(structuredCandidates),
    ).not.toThrow();
    expect(() =>
      guard.assertDoesNotRevealAnswerAt({ text: "1/2 ".repeat(4_096) }, 0),
    ).not.toThrow();
    expect(() =>
      guard.assertDoesNotRevealAnyAnswer([{ numerator: "1", denominator: "2" }]),
    ).toThrow(/prepared canonical-answer phase exceeds 8192 candidates/i);
  });

  it("keeps legacy one-shot scan budgets independent between calls", () => {
    const candidates = { text: "1/2 ".repeat(4_096) };

    expect(() =>
      assertStudentVisibleDataHasNoRecognizedCanonicalAnswers(
        candidates,
        ANSWER_39_OVER_35,
      ),
    ).not.toThrow();
    expect(() =>
      assertStudentVisibleDataHasNoRecognizedCanonicalAnswers(
        candidates,
        ANSWER_39_OVER_35,
      ),
    ).not.toThrow();
  });

  it.each([
    ["benign fraction", "1/2"],
    ["exact answer", "39/35"],
    ["unreduced equivalent", "78/70"],
    ["overlapping chain", "1/78/70"],
    ["malformed separator", "78//70"],
    ["oversized integer", `${"9".repeat(MAX_CANONICAL_INTEGER_DIGITS + 1)}/1`],
    ["local candidate boundary", "1/2 ".repeat(4_096)],
    ["local candidate overflow", "1/2 ".repeat(4_097)],
  ])(
    "keeps prepared and legacy one-shot classifications aligned for %s",
    (_case, text) => {
      const captureOutcome = (operation: () => void): string => {
        try {
          operation();
          return "accepted";
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          for (const classification of [
            "recognized canonical-answer representation",
            "unsupported malformed rational representation",
            "unsupported oversized rational representation",
          ]) {
            if (message.includes(classification)) {
              return classification;
            }
          }
          return message.includes("4096 candidates")
            ? "local candidate overflow"
            : message;
        }
      };

      const legacyOutcome = captureOutcome(() => scan(text));
      const preparedOutcome = captureOutcome(() =>
        prepareStudentVisibleAnswerGuard(
          ANSWER_39_OVER_35,
        ).assertDoesNotRevealAnyAnswer({ text }),
      );

      expect(preparedOutcome).toBe(legacyOutcome);
    },
  );
});
