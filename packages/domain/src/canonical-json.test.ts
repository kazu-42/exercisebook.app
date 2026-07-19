import { describe, expect, it } from "vitest";

import { canonicalizeJson, hmacSha256Hex, sha256Hex } from "./canonical-json.js";

describe("RFC 8785 compatible canonical JSON", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(
      canonicalizeJson({
        z: [3, { y: true, x: "text" }],
        a: null,
      }),
    ).toBe('{"a":null,"z":[3,{"x":"text","y":true}]}');
  });

  it("uses ECMAScript finite-number serialization and canonicalizes negative zero", () => {
    expect(canonicalizeJson({ negativeZero: -0, tiny: 1e-7 })).toBe(
      '{"negativeZero":0,"tiny":1e-7}',
    );
  });

  it("matches the complete RFC 8785 primitive and property-order sample", () => {
    const canonical = canonicalizeJson({
      numbers: [333_333_333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
      string: '€$\u000f\nA\'B"\\\\"/',
      literals: [null, true, false],
    });

    expect(canonical).toBe(
      String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}`,
    );
  });

  it("matches the RFC 8785 UTF-16 property-order vector", () => {
    const canonical = canonicalizeJson({
      "€": "Euro Sign",
      "\r": "Carriage Return",
      דּ: "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "😀": "Emoji: Grinning Face",
      "\u0080": "Control",
      ö: "Latin Small Letter O With Diaeresis",
    });

    expect(canonical).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, undefined, 1n, "\ud800"])(
    "rejects values outside the canonical JSON data model",
    (value) => {
      expect(() => canonicalizeJson({ value })).toThrow();
    },
  );

  it("rejects sparse arrays, extra array fields, and symbol-keyed properties", () => {
    const sparse = [1, , 3];
    const withExtraField = [1, 2] as number[] & { extra?: boolean };
    withExtraField.extra = true;
    const withSymbol = { value: 1 };
    Object.defineProperty(withSymbol, Symbol("hidden"), {
      enumerable: true,
      value: 2,
    });

    expect(() => canonicalizeJson(sparse)).toThrow("Sparse");
    expect(() => canonicalizeJson(withExtraField)).toThrow("Unexpected array property");
    expect(() => canonicalizeJson(withSymbol)).toThrow("Symbol-keyed");
  });

  it("computes lowercase SHA-256 over exact UTF-8 bytes", async () => {
    await expect(sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("computes the RFC 4231 HMAC-SHA256 test vector", async () => {
    await expect(
      hmacSha256Hex(
        Uint8Array.from({ length: 20 }, () => 0x0b),
        "Hi There",
      ),
    ).resolves.toBe("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
  });
});
