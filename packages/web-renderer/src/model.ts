import {
  AttributionV1Schema,
  WorksheetPresentationV1Schema,
} from "@exercisebook/schemas/presentation-contract-v1";
import { z } from "zod";

const MAX_WEB_WORKSHEET_ITEMS = 96;
const MAX_WEB_DATA_NODES = 20_000;
const MAX_WEB_DATA_DEPTH = 64;
const MAX_WEB_STRING_CODE_UNITS = 500_000;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const CANONICAL_INTEGER = /^(?:0|-?[1-9][0-9]{0,127})$/u;
const STABLE_ID = /^[a-z0-9](?:[a-z0-9._:-]*[a-z0-9])?$/u;

const HumanTextSchema = z.string().min(1).max(2_000);
const StableIdSchema = z.string().min(1).max(160).regex(STABLE_ID);
const CanonicalIntegerSchema = z.string().max(129).regex(CANONICAL_INTEGER);

export const WebWorksheetVariantSchema = z.enum(["student", "answer-key"]);

export const WebFractionSchema = z
  .strictObject({
    numerator: CanonicalIntegerSchema,
    denominator: CanonicalIntegerSchema,
  })
  .superRefine((value, context) => {
    if (CANONICAL_INTEGER.test(value.denominator) && BigInt(value.denominator) <= 0n) {
      context.addIssue({
        code: "custom",
        message: "The denominator must be positive.",
        path: ["denominator"],
      });
    }
  });

export const WebFractionAdditionPromptSchema = z.strictObject({
  kind: z.literal("fraction-addition"),
  left: WebFractionSchema,
  right: WebFractionSchema,
  accessibleText: HumanTextSchema,
});

const WebWorksheetItemBaseShape = {
  id: StableIdSchema,
  ordinal: z.number().int().min(1).max(MAX_WEB_WORKSHEET_ITEMS),
  prompt: WebFractionAdditionPromptSchema,
  responseLabel: z.string().min(1).max(500),
  printFallback: HumanTextSchema,
} as const;

export const StudentWebWorksheetItemSchema = z.strictObject({
  ...WebWorksheetItemBaseShape,
});

export const AnswerKeyWebWorksheetItemSchema = z.strictObject({
  ...WebWorksheetItemBaseShape,
  answer: z.strictObject({
    numerator: CanonicalIntegerSchema,
    denominator: CanonicalIntegerSchema.refine(
      (value) => !CANONICAL_INTEGER.test(value) || BigInt(value) > 0n,
      "The denominator must be positive.",
    ),
    accessibleText: HumanTextSchema,
  }),
  solution: z.array(HumanTextSchema).min(1).max(20),
});

export const WebWorkedExampleSchema = z.strictObject({
  left: WebFractionSchema,
  right: WebFractionSchema,
  result: WebFractionSchema,
  steps: z.array(HumanTextSchema).min(1).max(20),
});

export const WebAttributionSchema = z.strictObject({
  label: z.string().min(1).max(5_000),
  license: z.string().min(1).max(500),
});

const WebWorksheetBaseShape = {
  schemaVersion: z.literal("web-worksheet.v1"),
  instanceHash: z.string().regex(/^[0-9a-f]{64}$/u),
  assignmentId: StableIdSchema,
  title: z.string().min(1).max(240),
  skillTitle: z.string().min(1).max(240),
  studyDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u)
    .refine(isRealCalendarDate, "Expected a real calendar date."),
  locale: z
    .string()
    .min(2)
    .max(255)
    .refine(isCanonicalLocale, "Expected a canonical BCP 47 locale."),
  expectedMinutes: z.number().int().min(1).max(480),
  introduction: HumanTextSchema,
  workedExample: WebWorkedExampleSchema,
  attributions: z.array(WebAttributionSchema).min(1).max(20),
} as const;

export const StudentWebWorksheetSchema = z
  .strictObject({
    ...WebWorksheetBaseShape,
    variant: z.literal("student"),
    items: z.array(StudentWebWorksheetItemSchema).min(1).max(MAX_WEB_WORKSHEET_ITEMS),
  })
  .superRefine(validateItemIdentityAndOrder);

export const AnswerKeyWebWorksheetSchema = z
  .strictObject({
    ...WebWorksheetBaseShape,
    variant: z.literal("answer-key"),
    items: z.array(AnswerKeyWebWorksheetItemSchema).min(1).max(MAX_WEB_WORKSHEET_ITEMS),
  })
  .superRefine(validateItemIdentityAndOrder);

export const WebWorksheetSchema = z.discriminatedUnion("variant", [
  StudentWebWorksheetSchema,
  AnswerKeyWebWorksheetSchema,
]);

/**
 * Parallel V2 browser contract. It intentionally remains outside the V1
 * WebWorksheet union until a V2 view is introduced, so existing V1 consumers
 * cannot accidentally receive a structurally different worksheet.
 */
export const StudentWebWorksheetItemV2Schema = z
  .strictObject({
    ...WebWorksheetItemBaseShape,
  })
  .superRefine((value, context) => {
    for (const operand of ["left", "right"] as const) {
      if (!isReducedCanonicalWebFraction(value.prompt[operand])) {
        context.addIssue({
          code: "custom",
          message: "Prompt operands must be reduced canonical rationals.",
          path: ["prompt", operand],
        });
      }
    }

    const expectedAccessibleText = deriveFractionAdditionPromptAccessibleText(
      value.prompt.left,
      value.prompt.right,
    );
    if (value.prompt.accessibleText !== expectedAccessibleText) {
      context.addIssue({
        code: "custom",
        message:
          "accessibleText must equal its deterministic fraction-addition derivation.",
        path: ["prompt", "accessibleText"],
      });
    }
  });

export const StudentWebWorksheetV2Schema = z
  .strictObject({
    schemaVersion: z.literal("web-worksheet.v2"),
    instanceHash: z.string().regex(/^[0-9a-f]{64}$/u),
    assignmentId: StableIdSchema,
    title: z.string().min(1).max(240),
    studyDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .refine(isRealCalendarDate, "Expected a real calendar date."),
    locale: z
      .string()
      .min(2)
      .max(255)
      .refine(isCanonicalLocale, "Expected a canonical BCP 47 locale."),
    expectedMinutes: z.number().int().min(1).max(480),
    variant: z.literal("student"),
    presentation: WorksheetPresentationV1Schema,
    items: z.array(StudentWebWorksheetItemV2Schema).min(1).max(MAX_WEB_WORKSHEET_ITEMS),
    attributions: z.array(AttributionV1Schema).min(1).max(100),
  })
  .superRefine(validateItemIdentityAndOrder);

export type WebWorksheetVariant = z.infer<typeof WebWorksheetVariantSchema>;
export type WebFraction = z.infer<typeof WebFractionSchema>;
export type WebFractionAdditionPrompt = z.infer<typeof WebFractionAdditionPromptSchema>;
export type StudentWebWorksheetItem = z.infer<typeof StudentWebWorksheetItemSchema> &
  Readonly<{
    answer?: never;
    solution?: never;
  }>;
export type AnswerKeyWebWorksheetItem = z.infer<typeof AnswerKeyWebWorksheetItemSchema>;
export type WebWorksheetItem = StudentWebWorksheetItem | AnswerKeyWebWorksheetItem;
export type WebWorkedExample = z.infer<typeof WebWorkedExampleSchema>;
export type WebAttribution = z.infer<typeof WebAttributionSchema>;
export type StudentWebWorksheet = Omit<
  z.infer<typeof StudentWebWorksheetSchema>,
  "items"
> &
  Readonly<{ items: readonly StudentWebWorksheetItem[] }>;
export type AnswerKeyWebWorksheet = z.infer<typeof AnswerKeyWebWorksheetSchema>;
export type WebWorksheet = StudentWebWorksheet | AnswerKeyWebWorksheet;
export type StudentWebWorksheetItemV2 = Readonly<
  z.infer<typeof StudentWebWorksheetItemV2Schema> & {
    answer?: never;
    accessibility?: never;
    canonicalAnswer?: never;
    expectedMinutes?: never;
    hints?: never;
    misconceptions?: never;
    provenance?: never;
    scoringRule?: never;
    selectionReasons?: never;
    skillIds?: never;
    slotSeed?: never;
    solution?: never;
    solutionTrace?: never;
  }
>;
export type StudentWebWorksheetV2 = Readonly<
  Omit<z.infer<typeof StudentWebWorksheetV2Schema>, "items"> & {
    items: readonly StudentWebWorksheetItemV2[];
    baseSeed?: never;
    canonicalAnswers?: never;
    introduction?: never;
    seedSecretVersion?: never;
    skillTitle?: never;
    timeZone?: never;
    workedExample?: never;
  }
>;

export function validateStudentWebWorksheet(value: unknown): StudentWebWorksheet {
  assertBoundedPlainData(value);
  return StudentWebWorksheetSchema.parse(value);
}

export function validateAnswerKeyWebWorksheet(value: unknown): AnswerKeyWebWorksheet {
  assertBoundedPlainData(value);
  return AnswerKeyWebWorksheetSchema.parse(value);
}

export function validateWebWorksheet(
  value: unknown,
  expectedVariant: "student",
): StudentWebWorksheet;
export function validateWebWorksheet(
  value: unknown,
  expectedVariant: "answer-key",
): AnswerKeyWebWorksheet;
export function validateWebWorksheet(
  value: unknown,
  expectedVariant: WebWorksheetVariant,
): WebWorksheet;
export function validateWebWorksheet(
  value: unknown,
  expectedVariant: WebWorksheetVariant,
): WebWorksheet {
  return expectedVariant === "student"
    ? validateStudentWebWorksheet(value)
    : validateAnswerKeyWebWorksheet(value);
}

export function validateStudentWebWorksheetV2(value: unknown): StudentWebWorksheetV2 {
  assertBoundedPlainData(value);
  return StudentWebWorksheetV2Schema.parse(value);
}

function validateItemIdentityAndOrder(
  value: {
    readonly items: readonly { readonly id: string; readonly ordinal: number }[];
  },
  context: z.RefinementCtx,
): void {
  const ids = new Set<string>();
  for (const [index, item] of value.items.entries()) {
    if (ids.has(item.id)) {
      context.addIssue({
        code: "custom",
        message: "Worksheet item IDs must be unique.",
        path: ["items", index, "id"],
      });
    }
    ids.add(item.id);
    if (item.ordinal !== index + 1) {
      context.addIssue({
        code: "custom",
        message: "Worksheet item ordinals must be contiguous and ordered.",
        path: ["items", index, "ordinal"],
      });
    }
  }
}

function isRealCalendarDate(value: string): boolean {
  const parts = value.split("-");
  if (parts.length !== 3) {
    return false;
  }
  const [yearText, monthText, dayText] = parts;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1 ||
    year > 9_999 ||
    month < 1 ||
    month > 12
  ) {
    return false;
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

function isCanonicalLocale(value: string): boolean {
  try {
    return new Intl.Locale(value).toString() === value;
  } catch {
    return false;
  }
}

function deriveFractionAdditionPromptAccessibleText(
  left: WebFraction,
  right: WebFraction,
): string {
  return `Add ${left.numerator} over ${left.denominator} and ${right.numerator} over ${right.denominator}. Give the answer in lowest terms.`;
}

function isReducedCanonicalWebFraction(value: WebFraction): boolean {
  if (
    !CANONICAL_INTEGER.test(value.numerator) ||
    !CANONICAL_INTEGER.test(value.denominator)
  ) {
    return false;
  }

  const numerator = BigInt(value.numerator);
  const denominator = BigInt(value.denominator);
  if (denominator <= 0n) {
    return false;
  }

  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  return greatestCommonDivisor(absoluteNumerator, denominator) === 1n;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let current = left;
  let remainderSource = right;
  while (remainderSource !== 0n) {
    const remainder = current % remainderSource;
    current = remainderSource;
    remainderSource = remainder;
  }
  return current;
}

function assertBoundedPlainData(value: unknown): void {
  let nodes = 0;
  let stringCodeUnits = 0;
  const active = new WeakSet<object>();

  const accountString = (text: string, path: string): void => {
    assertValidUnicode(text, path);
    stringCodeUnits += text.length;
    if (stringCodeUnits > MAX_WEB_STRING_CODE_UNITS) {
      throw new TypeError(
        `Web worksheet exceeds ${String(MAX_WEB_STRING_CODE_UNITS)} string code units.`,
      );
    }
  };

  const visit = (current: unknown, path: string, depth: number): void => {
    nodes += 1;
    if (nodes > MAX_WEB_DATA_NODES) {
      throw new TypeError(
        `Web worksheet exceeds ${String(MAX_WEB_DATA_NODES)} data nodes.`,
      );
    }
    if (typeof current === "string") {
      accountString(current, path);
      return;
    }
    if (current === null || typeof current !== "object") {
      return;
    }
    if (depth > MAX_WEB_DATA_DEPTH) {
      throw new TypeError(`Web worksheet exceeds depth ${String(MAX_WEB_DATA_DEPTH)}.`);
    }
    if (active.has(current)) {
      throw new TypeError(`Cyclic Web worksheet data at ${path}.`);
    }

    const prototype = Object.getPrototypeOf(current) as unknown;
    const plain = Array.isArray(current)
      ? prototype === Array.prototype
      : prototype === Object.prototype || prototype === null;
    if (!plain) {
      throw new TypeError(`Non-plain Web worksheet data at ${path}.`);
    }
    if (Object.getOwnPropertySymbols(current).length > 0) {
      throw new TypeError(`Symbol-keyed Web worksheet data at ${path}.`);
    }

    active.add(current);
    try {
      for (const propertyName of Object.getOwnPropertyNames(current)) {
        if (Array.isArray(current) && propertyName === "length") {
          continue;
        }
        accountString(propertyName, `${path} property name`);
        if (DANGEROUS_KEYS.has(propertyName)) {
          throw new TypeError(`Forbidden Web worksheet key at ${path}.`);
        }
        if (
          Array.isArray(current) &&
          (!/^(?:0|[1-9][0-9]*)$/u.test(propertyName) ||
            Number(propertyName) >= current.length)
        ) {
          throw new TypeError(`Unexpected array property at ${path}.`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(current, propertyName);
        if (descriptor === undefined) {
          throw new TypeError(`Unreadable Web worksheet property at ${path}.`);
        }
        if ("get" in descriptor || "set" in descriptor) {
          throw new TypeError(`Accessor Web worksheet property at ${path}.`);
        }
        if (!descriptor.enumerable) {
          throw new TypeError(`Non-enumerable Web worksheet property at ${path}.`);
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
            throw new TypeError(`Sparse Web worksheet array at ${path}.`);
          }
        }
      }
    } finally {
      active.delete(current);
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
        throw new TypeError(`Lone high surrogate at ${path}.`);
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError(`Lone low surrogate at ${path}.`);
    }
  }
}
