export const MAX_PHASE_1_MATH_SOURCE_CODE_UNITS = 2_000;
export const MAX_PHASE_1_MATH_DEPTH = 32;

export type Phase1SafeMathErrorCode =
  "math-source-type" | "math-limit" | "unsafe-math" | "math-depth-limit";

export class Phase1SafeMathError extends Error {
  override readonly name = "Phase1SafeMathError";
  readonly code: Phase1SafeMathErrorCode;

  constructor(code: Phase1SafeMathErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Parses the complete Phase-1 inline-math language and derives the only
 * accessible-text representation accepted at the ContentDocument boundary.
 *
 * The language is deliberately small: decimal digits, basic arithmetic
 * punctuation, whitespace, and recursively nested `\frac{...}{...}`.
 */
export function derivePhase1MathAccessibleText(source: string): string {
  if (typeof source !== "string") {
    throw new Phase1SafeMathError(
      "math-source-type",
      "Math source must be a primitive string",
    );
  }
  if (source.length > MAX_PHASE_1_MATH_SOURCE_CODE_UNITS) {
    throw new Phase1SafeMathError("math-limit", "Math source is too long");
  }
  if (/[\u0000-\u001f\u007f]/.test(source)) {
    throw new Phase1SafeMathError(
      "unsafe-math",
      "Math contains an ASCII control character",
    );
  }

  let offset = 0;

  const parseRequiredMathGroup = (depth: number): string => {
    if (depth > MAX_PHASE_1_MATH_DEPTH) {
      throw new Phase1SafeMathError(
        "math-depth-limit",
        `Math nesting exceeds depth ${MAX_PHASE_1_MATH_DEPTH}`,
      );
    }
    if (source[offset] !== "{") {
      throw new Phase1SafeMathError(
        "unsafe-math",
        "\\frac requires two braced arguments",
      );
    }
    offset += 1;
    const accessibleText = parseExpression(true, depth);
    if (accessibleText.length === 0) {
      throw new Phase1SafeMathError(
        "unsafe-math",
        "\\frac arguments must not be empty",
      );
    }
    return accessibleText;
  };

  const parseExpression = (insideGroup: boolean, depth: number): string => {
    let accessibleText = "";
    while (offset < source.length) {
      const character = source[offset] ?? "";
      if (character === "}") {
        if (!insideGroup) {
          throw new Phase1SafeMathError("unsafe-math", "Math braces are unbalanced");
        }
        offset += 1;
        return normalizeAccessibleMath(accessibleText);
      }
      if (character === "{") {
        throw new Phase1SafeMathError(
          "unsafe-math",
          "Math braces are only allowed as arguments to \\frac",
        );
      }
      if (character === "\\") {
        if (!source.startsWith("\\frac", offset)) {
          const command = /^\\([A-Za-z]+|.)/.exec(source.slice(offset))?.[1] ?? "";
          throw new Phase1SafeMathError(
            "unsafe-math",
            `Math command is not in the Phase-1 allowlist: \\${command}`,
          );
        }
        offset += "\\frac".length;
        const numerator = parseRequiredMathGroup(depth + 1);
        const denominator = parseRequiredMathGroup(depth + 1);
        accessibleText += `${wrapNestedFraction(numerator)} over ${wrapNestedFraction(denominator)}`;
        continue;
      }
      if (!/[0-9+\-=().,\s]/.test(character)) {
        throw new Phase1SafeMathError(
          "unsafe-math",
          `Math character is not in the Phase-1 allowlist: ${JSON.stringify(character)}`,
        );
      }
      accessibleText += character;
      offset += 1;
    }
    if (insideGroup) {
      throw new Phase1SafeMathError("unsafe-math", "Math braces are unbalanced");
    }
    return normalizeAccessibleMath(accessibleText);
  };

  const accessibleText = parseExpression(false, 0);
  if (accessibleText.length === 0) {
    throw new Phase1SafeMathError("unsafe-math", "Math must not be empty");
  }
  return accessibleText;
}

function normalizeAccessibleMath(source: string): string {
  return source.replace(/\s+/g, " ").trim();
}

function wrapNestedFraction(source: string): string {
  return source.includes(" over ") ? `(${source})` : source;
}
