const MAX_JSON_NESTING = 64;
const MAX_JSON_VALUES = 512;

export class StrictJsonParseError extends SyntaxError {
  override readonly name = "StrictJsonParseError";
}

/**
 * JSON.parse intentionally keeps the last duplicate object property. API
 * contracts cannot safely make that choice, because intermediaries and other
 * parsers may keep the first one instead. This bounded parser decodes property
 * names before duplicate comparison, so `schema` and `\u0073chema` conflict.
 */
export function parseStrictJson(source: string): unknown {
  return new StrictJsonParser(source).parse();
}

class StrictJsonParser {
  private readonly source: string;
  private index = 0;
  private values = 0;

  constructor(source: string) {
    this.source = source;
  }

  parse(): unknown {
    this.skipWhitespace();
    if (this.index === this.source.length) {
      this.fail("JSON input is empty");
    }
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.source.length) {
      this.fail("Unexpected trailing JSON input");
    }
    return value;
  }

  private parseValue(depth: number): unknown {
    if (depth > MAX_JSON_NESTING) {
      this.fail(`JSON nesting limit of ${MAX_JSON_NESTING} exceeded`);
    }
    this.values += 1;
    if (this.values > MAX_JSON_VALUES) {
      this.fail(`JSON value limit of ${MAX_JSON_VALUES} exceeded`);
    }

    const character = this.source[this.index];
    if (character === "{") {
      return this.parseObject(depth);
    }
    if (character === "[") {
      return this.parseArray(depth);
    }
    if (character === '"') {
      return this.parseString();
    }
    if (character === "t") {
      this.consumeLiteral("true");
      return true;
    }
    if (character === "f") {
      this.consumeLiteral("false");
      return false;
    }
    if (character === "n") {
      this.consumeLiteral("null");
      return null;
    }
    if (character === "-" || (character !== undefined && /[0-9]/u.test(character))) {
      return this.parseNumber();
    }
    this.fail("Expected a JSON value");
  }

  private parseObject(depth: number): Record<string, unknown> {
    this.index += 1;
    this.skipWhitespace();
    const result: Record<string, unknown> = {};
    const keys = new Set<string>();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return result;
    }

    while (this.index < this.source.length) {
      if (this.source[this.index] !== '"') {
        this.fail("Expected a JSON object key");
      }
      const key = this.parseString();
      if (keys.has(key)) {
        this.fail(`Duplicate JSON object key ${JSON.stringify(key)}`);
      }
      keys.add(key);
      this.skipWhitespace();
      if (this.source[this.index] !== ":") {
        this.fail("Expected ':' after a JSON object key");
      }
      this.index += 1;
      this.skipWhitespace();
      const value = this.parseValue(depth + 1);
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
      this.skipWhitespace();
      const separator = this.source[this.index];
      if (separator === "}") {
        this.index += 1;
        return result;
      }
      if (separator !== ",") {
        this.fail("Expected ',' or '}' in a JSON object");
      }
      this.index += 1;
      this.skipWhitespace();
    }
    this.fail("Unterminated JSON object");
  }

  private parseArray(depth: number): unknown[] {
    this.index += 1;
    this.skipWhitespace();
    const result: unknown[] = [];
    if (this.source[this.index] === "]") {
      this.index += 1;
      return result;
    }

    while (this.index < this.source.length) {
      result.push(this.parseValue(depth + 1));
      this.skipWhitespace();
      const separator = this.source[this.index];
      if (separator === "]") {
        this.index += 1;
        return result;
      }
      if (separator !== ",") {
        this.fail("Expected ',' or ']' in a JSON array");
      }
      this.index += 1;
      this.skipWhitespace();
    }
    this.fail("Unterminated JSON array");
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (character === '"') {
        this.index += 1;
        const decoded: unknown = JSON.parse(this.source.slice(start, this.index));
        if (typeof decoded !== "string") {
          this.fail("Invalid JSON string");
        }
        return decoded;
      }
      if (character === "\\") {
        this.index += 1;
        const escape = this.source[this.index];
        if (escape === "u") {
          const hexadecimal = this.source.slice(this.index + 1, this.index + 5);
          if (hexadecimal.length !== 4 || !/^[0-9a-fA-F]{4}$/u.test(hexadecimal)) {
            this.fail("Invalid Unicode escape in JSON string");
          }
          this.index += 5;
          continue;
        }
        if (escape === undefined || !'"\\/bfnrt'.includes(escape)) {
          this.fail("Invalid escape in JSON string");
        }
        this.index += 1;
        continue;
      }
      if (character === undefined || character.charCodeAt(0) < 0x20) {
        this.fail("Unescaped control character in JSON string");
      }
      this.index += 1;
    }
    this.fail("Unterminated JSON string");
  }

  private parseNumber(): number {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(
      this.source.slice(this.index),
    );
    if (match === null) {
      this.fail("Invalid JSON number");
    }
    this.index += match[0].length;
    const value: unknown = JSON.parse(match[0]);
    if (typeof value !== "number") {
      this.fail("Invalid JSON number");
    }
    return value;
  }

  private consumeLiteral(literal: string): void {
    if (!this.source.startsWith(literal, this.index)) {
      this.fail(`Invalid JSON literal; expected ${literal}`);
    }
    this.index += literal.length;
  }

  private skipWhitespace(): void {
    while (
      this.source[this.index] === " " ||
      this.source[this.index] === "\t" ||
      this.source[this.index] === "\n" ||
      this.source[this.index] === "\r"
    ) {
      this.index += 1;
    }
  }

  private fail(message: string): never {
    throw new StrictJsonParseError(
      `${message} at byte-independent index ${this.index}`,
    );
  }
}
