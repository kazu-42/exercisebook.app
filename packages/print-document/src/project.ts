import { canonicalizeJson, sha256Hex, type RationalJson } from "@exercisebook/domain";
import {
  projectWorksheetForStudent,
  validateWorksheetInstanceV1,
  type AttributionV1,
  type MaterializedWorksheetInstanceV1,
  type WorksheetInstanceV1,
  type WorksheetSlotV1,
} from "@exercisebook/schemas";

import {
  PRINT_DOCUMENT_SCHEMA,
  PRINT_PROJECTOR_VERSION,
  type AnswerKeyPrintBlockV1,
  type PrintAnswerKeyBlockV1,
  type PrintAttributionV1,
  type PrintDocumentV1,
  type PrintFractionBarBlockV1,
  type PrintInlineV1,
  type PrintPaper,
  type PrintProblemV1,
  type PrintVariant,
  type AnswerKeyPrintDocumentV1,
  type StudentPrintBlockV1,
  type StudentPrintDocumentV1,
} from "./types.js";
import {
  assertStudentDocumentHasNoAnswerData,
  validatePrintDocumentV1,
} from "./validate.js";

const HASH_PATTERN = /^[0-9a-f]{64}$/u;

export type PrintDocumentProjectionErrorCode =
  | "invalid-materialization"
  | "invalid-instance"
  | "canonical-json-mismatch"
  | "hash-mismatch"
  | "unsupported-paper"
  | "unsupported-variant";

export class PrintDocumentProjectionError extends Error {
  public readonly code: PrintDocumentProjectionErrorCode;

  public constructor(
    code: PrintDocumentProjectionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PrintDocumentProjectionError";
    this.code = code;
  }
}

export interface ProjectPrintDocumentV1Options {
  readonly variant: PrintVariant;
  readonly paper?: PrintPaper;
}

/**
 * Projects a verified WorksheetInstance into a renderer-neutral document.
 *
 * The materialized pair is intentionally revalidated here. A caller cannot
 * substitute a different object, non-canonical bytes, or hash and still cross
 * the print authorization boundary.
 */
export function projectPrintDocumentV1(
  materialized: MaterializedWorksheetInstanceV1,
  options: ProjectPrintDocumentV1Options & { readonly variant: "student" },
): Promise<StudentPrintDocumentV1>;
export function projectPrintDocumentV1(
  materialized: MaterializedWorksheetInstanceV1,
  options: ProjectPrintDocumentV1Options & { readonly variant: "answer-key" },
): Promise<AnswerKeyPrintDocumentV1>;
export function projectPrintDocumentV1(
  materialized: MaterializedWorksheetInstanceV1,
  options: ProjectPrintDocumentV1Options,
): Promise<PrintDocumentV1>;
export async function projectPrintDocumentV1(
  materialized: MaterializedWorksheetInstanceV1,
  options: ProjectPrintDocumentV1Options,
): Promise<PrintDocumentV1> {
  const variant = readVariant(options);
  const paper = readPaper(options);
  const instance = await verifyMaterializedWorksheetInstanceV1(materialized);
  if (variant === "student") {
    await projectWorksheetForStudent(materialized);
  }
  const studentBlocks = projectStudentBlocks(instance);
  const attributions = instance.attributions.map(projectAttribution);

  if (variant === "student") {
    const studentDocument = validatePrintDocumentV1({
      schema: PRINT_DOCUMENT_SCHEMA,
      sourceInstanceHash: materialized.instanceHash,
      projectorVersion: PRINT_PROJECTOR_VERSION,
      paper,
      locale: instance.locale,
      variant,
      title: instance.title,
      blocks: studentBlocks,
      attributions,
    });
    assertStudentDocumentHasNoAnswerData(
      studentDocument,
      collectProtectedSourceText(instance),
    );
    if (studentDocument.variant !== "student") {
      throw new PrintDocumentProjectionError(
        "invalid-instance",
        "Student projection unexpectedly produced a non-student document.",
      );
    }
    return studentDocument;
  }

  const answerKeyBlocks: AnswerKeyPrintBlockV1[] = [
    ...studentBlocks,
    {
      type: "page-break",
      id: "answer-key-page-break",
    },
    {
      type: "heading",
      id: "answer-key-title",
      level: 1,
      content: [{ type: "text", text: "Answer key" }],
    },
    ...instance.slots.map(projectAnswerKeyBlock),
  ];

  return validatePrintDocumentV1({
    schema: PRINT_DOCUMENT_SCHEMA,
    sourceInstanceHash: materialized.instanceHash,
    projectorVersion: PRINT_PROJECTOR_VERSION,
    paper,
    locale: instance.locale,
    variant,
    title: `${instance.title} — Answer key`,
    blocks: answerKeyBlocks,
    attributions,
  });
}

export async function verifyMaterializedWorksheetInstanceV1(
  materialized: MaterializedWorksheetInstanceV1,
): Promise<WorksheetInstanceV1> {
  if (!isRecord(materialized)) {
    throw new PrintDocumentProjectionError(
      "invalid-materialization",
      "Worksheet materialization must be an object.",
    );
  }
  if (typeof materialized.canonicalJson !== "string") {
    throw new PrintDocumentProjectionError(
      "invalid-materialization",
      "Worksheet materialization canonicalJson must be a string.",
    );
  }
  if (
    typeof materialized.instanceHash !== "string" ||
    !HASH_PATTERN.test(materialized.instanceHash)
  ) {
    throw new PrintDocumentProjectionError(
      "hash-mismatch",
      "Worksheet materialization hash must be 64 lowercase hexadecimal characters.",
    );
  }

  let instance: WorksheetInstanceV1;
  try {
    instance = validateWorksheetInstanceV1(materialized.instance);
  } catch (error: unknown) {
    throw new PrintDocumentProjectionError(
      "invalid-instance",
      "WorksheetInstanceV1 validation failed.",
      { cause: error },
    );
  }

  let expectedCanonicalJson: string;
  try {
    expectedCanonicalJson = canonicalizeJson(instance);
  } catch (error: unknown) {
    throw new PrintDocumentProjectionError(
      "invalid-instance",
      "WorksheetInstanceV1 is outside the canonical JSON data model.",
      { cause: error },
    );
  }
  if (materialized.canonicalJson !== expectedCanonicalJson) {
    throw new PrintDocumentProjectionError(
      "canonical-json-mismatch",
      "Worksheet materialization bytes do not canonically represent its instance.",
    );
  }

  const actualHash = await sha256Hex(materialized.canonicalJson);
  if (actualHash !== materialized.instanceHash) {
    throw new PrintDocumentProjectionError(
      "hash-mismatch",
      "Worksheet materialization hash does not match its canonical bytes.",
    );
  }

  return instance;
}

function projectStudentBlocks(instance: WorksheetInstanceV1): StudentPrintBlockV1[] {
  const blocks: StudentPrintBlockV1[] = [
    {
      type: "heading",
      id: "worksheet-title",
      level: 1,
      content: [{ type: "text", text: instance.title }],
    },
    {
      type: "paragraph",
      id: "worksheet-summary",
      content: [
        {
          type: "text",
          text: `${instance.localStudyDate} · ${String(instance.expectedMinutes)} minutes`,
        },
      ],
    },
  ];

  for (const [index, slot] of instance.slots.entries()) {
    const ordinal = index + 1;
    blocks.push({
      type: "problem-group",
      id: `problem-group-${String(ordinal).padStart(3, "0")}`,
      title: `Problem ${String(ordinal)}`,
      problems: [projectProblem(slot, ordinal, instance.locale)],
    });
    blocks.push(projectPrintFallback(slot, ordinal));
    blocks.push({
      type: "working-space",
      id: `working-space-${String(ordinal).padStart(3, "0")}`,
      label: `Working space for problem ${String(ordinal)}`,
      lines: 3,
    });
  }

  return blocks;
}

function projectProblem(
  slot: WorksheetSlotV1,
  ordinal: number,
  locale: string,
): PrintProblemV1 {
  return {
    id: slot.id,
    ordinal,
    instruction: slot.prompt.instruction,
    promptAccessibleText: slot.prompt.accessibleText,
    prompt: [
      projectFraction(slot.prompt.left, locale),
      { type: "operator", symbol: "+", accessibleText: operatorText(locale) },
      projectFraction(slot.prompt.right, locale),
    ],
    response: {
      type: "fraction",
      label: responseSpaceText(locale, ordinal),
      lines: 3,
    },
    provenance: {
      contentId: slot.provenance.contentId,
      contentRevision: slot.provenance.contentRevision,
      sourceHash: slot.provenance.sourceHash,
      contentHash: slot.provenance.contentHash,
      compilerVersion: slot.provenance.compilerVersion,
      generatorId: slot.provenance.generatorId,
      generatorVersion: slot.provenance.generatorVersion,
      generationAttempt: slot.provenance.generationAttempt,
    },
  };
}

function projectPrintFallback(
  slot: WorksheetSlotV1,
  ordinal: number,
): StudentPrintBlockV1 {
  const left = toFractionBar(slot.prompt.left);
  const right = toFractionBar(slot.prompt.right);
  if (left === undefined || right === undefined) {
    return {
      type: "paragraph",
      id: `print-fallback-${String(ordinal).padStart(3, "0")}`,
      content: [{ type: "text", text: slot.printFallback.text }],
    };
  }

  const fallback: PrintFractionBarBlockV1 = {
    type: "fraction-bar",
    id: `fraction-bars-${String(ordinal).padStart(3, "0")}`,
    label: slot.prompt.accessibleText,
    caption: slot.printFallback.text,
    bars: [
      {
        ...left,
        label: rationalText(slot.prompt.left),
      },
      {
        ...right,
        label: rationalText(slot.prompt.right),
      },
    ],
  };
  return fallback;
}

function projectAnswerKeyBlock(
  slot: WorksheetSlotV1,
  index: number,
): PrintAnswerKeyBlockV1 {
  const ordinal = index + 1;
  const finalStep = slot.solutionTrace.at(-1);
  const accessibleText =
    finalStep?.accessibleText ?? rationalText(slot.canonicalAnswer.value);
  return {
    type: "answer-key",
    id: `answer-key-${String(ordinal).padStart(3, "0")}`,
    problemId: slot.id,
    ordinal,
    canonicalResponse: [
      {
        type: "fraction",
        numerator: slot.canonicalAnswer.value.numerator,
        denominator: slot.canonicalAnswer.value.denominator,
        accessibleText,
      },
    ],
    explanation: slot.solutionTrace.map(
      (step) => `${step.explanation} ${step.accessibleText}`,
    ),
  };
}

function projectFraction(value: RationalJson, locale: string): PrintInlineV1 {
  return {
    type: "fraction",
    numerator: value.numerator,
    denominator: value.denominator,
    accessibleText: fractionText(value, locale),
  };
}

function projectAttribution(
  attribution: AttributionV1,
  index: number,
): PrintAttributionV1 {
  return {
    id: `attribution-${String(index + 1).padStart(3, "0")}`,
    title: attribution.title,
    author: attribution.author,
    sourceUrl: attribution.sourceUrl,
    licenseId: attribution.licenseId,
    attributionText: attribution.attributionText,
    publicationStatus: attribution.publicationStatus,
    modifications: [...attribution.modifications],
  };
}

function collectProtectedSourceText(instance: WorksheetInstanceV1): readonly string[] {
  const protectedText = new Set<string>([
    instance.rng.baseSeed,
    ...instance.slots.map((slot) => slot.slotSeed),
  ]);
  for (const slot of instance.slots) {
    protectedText.add(canonicalizeJson(slot.canonicalAnswer));
    protectedText.add(canonicalizeJson(slot.scoringRule));
    protectedText.add(canonicalizeJson(slot.misconceptions));
    for (const step of slot.solutionTrace) {
      protectedText.add(step.explanation);
      protectedText.add(step.expression);
      protectedText.add(step.accessibleText);
    }
    for (const misconception of slot.misconceptions) {
      protectedText.add(misconception.description);
    }
  }
  return [...protectedText];
}

function toFractionBar(
  value: RationalJson,
): { readonly numerator: number; readonly denominator: number } | undefined {
  const numerator = BigInt(value.numerator);
  const denominator = BigInt(value.denominator);
  if (numerator < 0n || numerator > denominator || denominator > 100n) {
    return undefined;
  }
  return {
    numerator: Number(numerator),
    denominator: Number(denominator),
  };
}

function fractionText(value: RationalJson, locale: string): string {
  if (locale === "ja" || locale.startsWith("ja-")) {
    return `${value.denominator}分の${value.numerator}`;
  }
  return `${value.numerator} over ${value.denominator}`;
}

function rationalText(value: RationalJson): string {
  return `${value.numerator}/${value.denominator}`;
}

function operatorText(locale: string): string {
  return locale === "ja" || locale.startsWith("ja-") ? "たす" : "plus";
}

function responseSpaceText(locale: string, ordinal: number): string {
  return locale === "ja" || locale.startsWith("ja-")
    ? `問題${String(ordinal)}の解答記入欄`
    : `Response space for problem ${String(ordinal)}`;
}

function readVariant(options: ProjectPrintDocumentV1Options): PrintVariant {
  if (options.variant !== "student" && options.variant !== "answer-key") {
    throw new PrintDocumentProjectionError(
      "unsupported-variant",
      `Unsupported print variant: ${String(options.variant)}`,
    );
  }
  return options.variant;
}

function readPaper(options: ProjectPrintDocumentV1Options): PrintPaper {
  if (options.paper !== undefined && options.paper !== "a4") {
    throw new PrintDocumentProjectionError(
      "unsupported-paper",
      `Unsupported paper size: ${String(options.paper)}`,
    );
  }
  return options.paper ?? "a4";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
