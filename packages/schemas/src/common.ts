import { z } from "zod";

import { MAX_CANONICAL_INTEGER_DIGITS } from "@exercisebook/domain";

export { MAX_CANONICAL_INTEGER_DIGITS };

export const SHA256_HEX_PATTERN = "^[0-9a-f]{64}$";
export const MAX_SAFE_DATA_NODES = 50_000;
export const MAX_SAFE_DATA_DEPTH = 128;
export const MAX_SAFE_DATA_STRING_CODE_UNITS = 1_000_000;
const DANGEROUS_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Zod 4 strips some prototype-sensitive own keys before strict-object checks.
 * Run this on the original unknown value so those keys cannot be smuggled
 * across a validator boundary and silently disappear.
 */
export function assertSafeDataObjectGraph(value: unknown): void {
  let nodeCount = 0;
  let stringCodeUnits = 0;
  const activeObjects = new WeakSet<object>();

  const accountString = (length: number): void => {
    stringCodeUnits += length;
    if (stringCodeUnits > MAX_SAFE_DATA_STRING_CODE_UNITS) {
      throw new TypeError(
        `Data object graph exceeds ${MAX_SAFE_DATA_STRING_CODE_UNITS} string code units`,
      );
    }
  };

  const visit = (current: unknown, path: string, depth: number): void => {
    nodeCount += 1;
    if (nodeCount > MAX_SAFE_DATA_NODES) {
      throw new TypeError(`Data object graph exceeds ${MAX_SAFE_DATA_NODES} nodes`);
    }
    if (typeof current === "string") {
      assertValidUnicode(current, path);
      accountString(current.length);
      return;
    }
    if (current === null || typeof current !== "object") {
      return;
    }
    if (depth > MAX_SAFE_DATA_DEPTH) {
      throw new TypeError(`Data object graph exceeds depth ${MAX_SAFE_DATA_DEPTH}`);
    }
    if (activeObjects.has(current)) {
      throw new TypeError(`Cyclic data object graph at ${path}`);
    }

    const prototype = Object.getPrototypeOf(current) as unknown;
    const hasAllowedPrototype = Array.isArray(current)
      ? prototype === Array.prototype
      : prototype === Object.prototype || prototype === null;
    if (!hasAllowedPrototype) {
      throw new TypeError(`Non-plain data object at ${path}`);
    }
    if (Object.getOwnPropertySymbols(current).length > 0) {
      throw new TypeError(`Symbol-keyed data property at ${path}`);
    }

    activeObjects.add(current);
    try {
      const propertyNames = Object.getOwnPropertyNames(current);
      for (const propertyName of propertyNames) {
        if (Array.isArray(current) && propertyName === "length") {
          continue;
        }
        assertValidUnicode(propertyName, `${path} property name`);
        accountString(propertyName.length);
        if (DANGEROUS_OBJECT_KEYS.has(propertyName)) {
          throw new TypeError(
            `Forbidden data property ${JSON.stringify(propertyName)} at ${path}`,
          );
        }
        if (
          Array.isArray(current) &&
          (!/^(?:0|[1-9][0-9]*)$/u.test(propertyName) ||
            Number(propertyName) >= current.length)
        ) {
          throw new TypeError(`Unexpected array property ${propertyName} at ${path}`);
        }

        const descriptor = Object.getOwnPropertyDescriptor(current, propertyName);
        if (descriptor === undefined) {
          throw new TypeError(`Unreadable data property ${propertyName} at ${path}`);
        }
        if ("get" in descriptor || "set" in descriptor) {
          throw new TypeError(`Accessor data property ${propertyName} at ${path}`);
        }
        if (!descriptor.enumerable) {
          throw new TypeError(
            `Non-enumerable data property ${propertyName} at ${path}`,
          );
        }
        visit(
          descriptor.value,
          Array.isArray(current)
            ? `${path}[${propertyName}]`
            : `${path}.${propertyName}`,
          depth + 1,
        );
      }
      if (Array.isArray(current)) {
        for (let index = 0; index < current.length; index += 1) {
          if (!Object.hasOwn(current, index)) {
            throw new TypeError(`Sparse array entry at ${path}[${index}]`);
          }
        }
      }
    } finally {
      activeObjects.delete(current);
    }
  };

  visit(value, "$", 0);
}

function assertValidUnicode(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) {
        throw new TypeError(`Lone high surrogate at ${path}`);
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError(`Lone low surrogate at ${path}`);
    }
  }
}

/**
 * Bounds decimal-to-BigInt conversion and Euclidean GCD work at the schema
 * boundary. 128 digits is intentionally far above any curriculum value. The
 * exported document validators combine it with aggregate graph and string
 * budgets so hostile but structurally valid inputs have bounded validation
 * work.
 */
export const CANONICAL_INTEGER_PATTERN = `^(?:0|-?[1-9][0-9]{0,${MAX_CANONICAL_INTEGER_DIGITS - 1}})$`;

export const Sha256HexSchema = z
  .string()
  .regex(
    new RegExp(SHA256_HEX_PATTERN),
    "Expected 64 lowercase hexadecimal characters",
  );

export const CanonicalIntegerStringSchema = z
  .string()
  .max(MAX_CANONICAL_INTEGER_DIGITS + 1)
  .regex(
    new RegExp(CANONICAL_INTEGER_PATTERN),
    `Expected a canonical base-10 integer with at most ${MAX_CANONICAL_INTEGER_DIGITS} digits`,
  );

export const HttpUrlSchema = z
  .url()
  .max(2_048)
  .superRefine((value, context) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      // z.url() owns the structural parse error. Keep this semantic refinement
      // non-throwing if Zod evaluates it after an earlier failed check.
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      context.addIssue({
        code: "custom",
        message: "Expected an HTTP(S) URL",
      });
    }
    if (parsed.username !== "" || parsed.password !== "") {
      context.addIssue({
        code: "custom",
        message: "URL credentials are not allowed",
      });
    }
  });

export const RationalJsonSchema = z
  .strictObject({
    numerator: CanonicalIntegerStringSchema,
    denominator: CanonicalIntegerStringSchema,
  })
  .superRefine((value, context) => {
    const denominator = BigInt(value.denominator);
    if (denominator <= 0n) {
      context.addIssue({
        code: "custom",
        message: "The denominator must be positive",
        path: ["denominator"],
      });
      return;
    }

    const numerator = BigInt(value.numerator);
    const commonDivisor = greatestCommonDivisor(
      numerator < 0n ? -numerator : numerator,
      denominator,
    );
    if (commonDivisor !== 1n) {
      context.addIssue({
        code: "custom",
        message: "The rational must be reduced",
      });
    }
  });

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left;
  let b = right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

export type RationalJson = z.infer<typeof RationalJsonSchema>;

/**
 * BCP 47 has no practical short fixed maximum once extensions/private-use
 * subtags are considered. We cap stored tags at 255 characters, then require
 * Intl.Locale's canonical spelling so locale identity is stable in canonical
 * JSON and hashes.
 */
export const LocaleSchema = z
  .string()
  .min(2)
  .max(255)
  .refine(
    isCanonicalBcp47Locale,
    "Expected a canonical BCP 47 tag accepted by Intl.Locale",
  );

function isCanonicalBcp47Locale(value: string): boolean {
  try {
    return new Intl.Locale(value).toString() === value;
  } catch {
    return false;
  }
}

export const StableIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(
    /^[a-z0-9](?:[a-z0-9._:-]*[a-z0-9])?$/,
    "Expected a stable lowercase identifier",
  );

export const RevisionSchema = z.number().int().positive().max(2_147_483_647);

export const LocalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine(isValidIsoDate, "Expected a real calendar date");

function isValidIsoDate(value: string): boolean {
  const [yearText, monthText, dayText] = value.split("-");
  if (yearText === undefined || monthText === undefined || dayText === undefined) {
    return false;
  }
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (year < 1 || year > 9_999) {
    return false;
  }
  const daysInMonth = daysForMonth(year, month);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth;
}

function daysForMonth(year: number, month: number): number {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leapYear ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export const TimeZoneSchema = z
  .string()
  .min(1)
  .max(80)
  .refine(isIanaTimeZone, "Expected an IANA time-zone identifier");

function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
