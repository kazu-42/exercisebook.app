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
});
