export interface RationalJson {
  readonly numerator: string;
  readonly denominator: string;
}

const CANONICAL_INTEGER = /^-?(?:0|[1-9][0-9]*)$/;
export const MAX_CANONICAL_INTEGER_DIGITS = 128;

export function createRational(numerator: bigint, denominator: bigint): RationalJson {
  if (denominator === 0n) {
    throw new RangeError("The denominator must be non-zero");
  }

  if (numerator === 0n) {
    return { numerator: "0", denominator: "1" };
  }

  const sign = denominator < 0n ? -1n : 1n;
  const signedNumerator = numerator * sign;
  const positiveDenominator = denominator * sign;
  const divisor = greatestCommonDivisor(absolute(signedNumerator), positiveDenominator);

  const normalized = {
    numerator: (signedNumerator / divisor).toString(),
    denominator: (positiveDenominator / divisor).toString(),
  };
  assertIntegerDigitLimit(normalized.numerator, "numerator");
  assertIntegerDigitLimit(normalized.denominator, "denominator");
  return normalized;
}

export function parseRationalJson(value: unknown): RationalJson {
  if (!isRecord(value)) {
    throw new TypeError("A persisted rational must be an object");
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "denominator" || keys[1] !== "numerator") {
    throw new TypeError("A persisted rational has unknown or missing fields");
  }

  const numerator = parseCanonicalInteger(value.numerator, "numerator");
  const denominator = parseCanonicalInteger(value.denominator, "denominator");
  if (denominator <= 0n) {
    throw new RangeError("The denominator must be positive");
  }

  const normalized = createRational(numerator, denominator);
  if (
    normalized.numerator !== value.numerator ||
    normalized.denominator !== value.denominator
  ) {
    throw new RangeError("A persisted rational must be reduced and canonical");
  }
  return normalized;
}

export function addRationals(left: RationalJson, right: RationalJson): RationalJson {
  const validLeft = parseRationalJson(left);
  const validRight = parseRationalJson(right);
  const leftNumerator = BigInt(validLeft.numerator);
  const leftDenominator = BigInt(validLeft.denominator);
  const rightNumerator = BigInt(validRight.numerator);
  const rightDenominator = BigInt(validRight.denominator);

  return createRational(
    leftNumerator * rightDenominator + rightNumerator * leftDenominator,
    leftDenominator * rightDenominator,
  );
}

export function equalRationals(left: RationalJson, right: RationalJson): boolean {
  const validLeft = parseRationalJson(left);
  const validRight = parseRationalJson(right);
  return (
    validLeft.numerator === validRight.numerator &&
    validLeft.denominator === validRight.denominator
  );
}

export function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = absolute(left);
  let b = absolute(right);
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

export function leastCommonMultiple(left: bigint, right: bigint): bigint {
  if (left === 0n || right === 0n) {
    return 0n;
  }
  return absolute((left / greatestCommonDivisor(left, right)) * right);
}

function parseCanonicalInteger(value: unknown, fieldName: string): bigint {
  if (typeof value !== "string") {
    throw new TypeError(`${fieldName} must be a canonical base-10 integer`);
  }
  assertIntegerDigitLimit(value, fieldName);
  if (!CANONICAL_INTEGER.test(value) || value === "-0") {
    throw new TypeError(`${fieldName} must be a canonical base-10 integer`);
  }
  return BigInt(value);
}

function assertIntegerDigitLimit(value: string, fieldName: string): void {
  const digitCount = value.startsWith("-") ? value.length - 1 : value.length;
  if (digitCount > MAX_CANONICAL_INTEGER_DIGITS) {
    throw new RangeError(
      `${fieldName} must contain at most ${MAX_CANONICAL_INTEGER_DIGITS} digits`,
    );
  }
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
