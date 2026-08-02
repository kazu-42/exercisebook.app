import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";

import type {
  AnswerKeyPrintDocumentV2,
  MaterializedAnswerKeyPrintDocumentV2,
  MaterializedPrintDocumentV2,
  MaterializedStudentPrintDocumentV2,
  PrintDocumentV2,
  StudentPrintDocumentV2,
} from "./types-v2.js";
import {
  PrintDocumentV2ValidationError,
  validatePrintDocumentV2,
} from "./validate-v2.js";

export const MAX_PRINT_DOCUMENT_V2_CANONICAL_BYTES = 4_000_000;

export function canonicalizePrintDocumentV2(value: unknown): string {
  return canonicalizeValidatedPrintDocumentV2(validatePrintDocumentV2(value));
}

export function materializePrintDocumentV2(
  value: StudentPrintDocumentV2,
): Promise<MaterializedStudentPrintDocumentV2>;
export function materializePrintDocumentV2(
  value: AnswerKeyPrintDocumentV2,
): Promise<MaterializedAnswerKeyPrintDocumentV2>;
export function materializePrintDocumentV2(
  value: unknown,
): Promise<MaterializedPrintDocumentV2>;
export async function materializePrintDocumentV2(
  value: unknown,
): Promise<MaterializedPrintDocumentV2> {
  const document = validatePrintDocumentV2(value);
  const canonicalJson = canonicalizeValidatedPrintDocumentV2(document);
  const printDocumentHash = await sha256Hex(canonicalJson);
  if (document.variant === "student") {
    return {
      document,
      canonicalJson,
      printDocumentHash,
    } satisfies MaterializedStudentPrintDocumentV2;
  }
  return {
    document,
    canonicalJson,
    printDocumentHash,
  } satisfies MaterializedAnswerKeyPrintDocumentV2;
}

function canonicalizeValidatedPrintDocumentV2(document: PrintDocumentV2): string {
  let canonicalJson: string;
  try {
    canonicalJson = canonicalizeJson(document);
  } catch (error: unknown) {
    throw new PrintDocumentV2ValidationError(
      "$",
      "document is outside the canonical JSON data model",
      { cause: error },
    );
  }
  const byteLength = new TextEncoder().encode(canonicalJson).byteLength;
  if (byteLength > MAX_PRINT_DOCUMENT_V2_CANONICAL_BYTES) {
    throw new PrintDocumentV2ValidationError(
      "$",
      `canonical document exceeds ${MAX_PRINT_DOCUMENT_V2_CANONICAL_BYTES} bytes`,
    );
  }
  return canonicalJson;
}
