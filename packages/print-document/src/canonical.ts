import { canonicalizeJson } from "@exercisebook/domain";

import type { PrintDocumentV1, PrintVariant } from "./types.js";
import { PrintDocumentValidationError, validatePrintDocumentV1 } from "./validate.js";

const HASH_PATTERN = /^[0-9a-f]{64}$/u;

export function canonicalizePrintDocumentV1(value: unknown): string {
  const document = validatePrintDocumentV1(value);
  return canonicalizeJson(document);
}

export function createArtifactFilename(
  artifactHash: string,
  variant: PrintVariant,
  kind: "html" | "print-document.json",
): string {
  if (!HASH_PATTERN.test(artifactHash)) {
    throw new PrintDocumentValidationError(
      "artifactHash",
      "expected exactly 64 lowercase hexadecimal characters",
    );
  }
  if (variant !== "student" && variant !== "answer-key") {
    throw new PrintDocumentValidationError(
      "variant",
      'expected "student" or "answer-key"',
    );
  }
  return `${artifactHash}.${variant}.${kind}`;
}

export type { PrintDocumentV1 };
