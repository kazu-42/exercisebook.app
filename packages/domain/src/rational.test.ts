import { describe, expect, it } from "vitest";

import {
  addRationals,
  createRational,
  equalRationals,
  leastCommonMultiple,
  parseRationalJson,
} from "./rational.js";

describe("Rational", () => {
  it("normalizes signs, reduces values, and canonicalizes zero", () => {
    expect(createRational(6n, -8n)).toEqual({
      numerator: "-3",
      denominator: "4",
    });
    expect(createRational(0n, -999n)).toEqual({
      numerator: "0",
      denominator: "1",
    });
  });

  it("adds without floating-point arithmetic", () => {
    const sum = addRationals(createRational(1n, 6n), createRational(1n, 4n));
    expect(sum).toEqual({ numerator: "5", denominator: "12" });
    expect(equalRationals(sum, createRational(10n, 24n))).toBe(true);
    expect(leastCommonMultiple(6n, 4n)).toBe(12n);
  });

  it.each([
    [{ numerator: "1", denominator: "0" }, "positive"],
    [{ numerator: "01", denominator: "2" }, "canonical"],
    [{ numerator: "-0", denominator: "1" }, "canonical"],
    [{ numerator: "1", denominator: "-2" }, "positive"],
    [{ numerator: "2", denominator: "4" }, "reduced"],
  ])("rejects invalid persisted rationals", (value, expectedMessage) => {
    expect(() => parseRationalJson(value)).toThrow(expectedMessage);
  });

  it("bounds persisted integer strings before BigInt and GCD work", () => {
    const atLimit = "1".repeat(128);
    expect(parseRationalJson({ numerator: atLimit, denominator: "1" }).numerator).toBe(
      atLimit,
    );
    expect(() =>
      parseRationalJson({
        numerator: "1".repeat(129),
        denominator: "1",
      }),
    ).toThrow("at most 128 digits");
    expect(() =>
      parseRationalJson({
        numerator: "1".repeat(100_000),
        denominator: "1",
      }),
    ).toThrow("at most 128 digits");
  });
});
