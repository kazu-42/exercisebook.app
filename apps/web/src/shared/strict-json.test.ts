import { describe, expect, it } from "vitest";

import { parseStrictJson } from "./strict-json.js";

describe("parseStrictJson", () => {
  it("parses an ordinary nested JSON value", () => {
    expect(parseStrictJson('{"schema":"v1","items":[1,true,null]}')).toEqual({
      schema: "v1",
      items: [1, true, null],
    });
  });

  it.each([
    ['{"schema":"v1","schema":"v1"}', "literal duplicate"],
    ['{"schema":"v1","\\u0073chema":"v1"}', "escaped-equivalent duplicate"],
    ['{"outer":{"id":1,"\\u0069d":2}}', "nested duplicate"],
  ])("rejects a %s key", (source) => {
    expect(() => parseStrictJson(source)).toThrow("Duplicate JSON object key");
  });

  it.each([
    "",
    "{",
    "[1,]",
    '{"key" 1}',
    '"unterminated',
    '"bad\\xescape"',
    "true false",
  ])("rejects malformed JSON %j", (source) => {
    expect(() => parseStrictJson(source)).toThrow();
  });

  it("bounds nesting before the JavaScript stack becomes a resource risk", () => {
    const source = "[".repeat(65) + "null" + "]".repeat(65);

    expect(() => parseStrictJson(source)).toThrow("nesting limit");
  });

  it("accepts exactly 512 parsed values and rejects the next value", () => {
    const exactlyAtLimit = JSON.stringify(Array.from({ length: 511 }, () => null));
    const overLimit = JSON.stringify(Array.from({ length: 512 }, () => null));

    expect(parseStrictJson(exactlyAtLimit)).toHaveLength(511);
    expect(() => parseStrictJson(overLimit)).toThrow("value limit");
  });

  it("permits an explicit bounded value limit without changing the default", () => {
    const source = JSON.stringify(Array.from({ length: 700 }, () => null));
    expect(() => parseStrictJson(source)).toThrow("value limit of 512");
    expect(parseStrictJson(source, { maximumValues: 701 })).toHaveLength(700);
    expect(() => parseStrictJson(source, { maximumValues: 700 })).toThrow(
      "value limit of 700",
    );
  });

  it("retains duplicate-key and nesting rejection with the larger value limit", () => {
    expect(() => parseStrictJson('{"a":1,"a":2}', { maximumValues: 4096 })).toThrow(
      "Duplicate JSON object key",
    );
    expect(() =>
      parseStrictJson("[".repeat(65) + "null" + "]".repeat(65), {
        maximumValues: 4096,
      }),
    ).toThrow("nesting limit");
    expect(
      parseStrictJson(JSON.stringify(Array.from({ length: 4095 }, () => 0)), {
        maximumValues: 4096,
      }),
    ).toHaveLength(4095);
    expect(() =>
      parseStrictJson(JSON.stringify(Array.from({ length: 4096 }, () => 0)), {
        maximumValues: 4096,
      }),
    ).toThrow("value limit of 4096");
  });

  it.each([0, -1, 1.5, Infinity, NaN, 4097])(
    "rejects invalid maximumValues %s",
    (maximumValues) => {
      expect(() => parseStrictJson("null", { maximumValues })).toThrow(RangeError);
    },
  );
});
