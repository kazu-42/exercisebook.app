import { readFileSync } from "node:fs";

import { compileContentSource } from "@exercisebook/content-compiler";
import { sha256Hex } from "@exercisebook/domain";
import {
  FRACTION_ADDITION_SAMPLE_INPUT,
  materializeFractionAdditionWorksheetFromContent,
  type FractionAdditionAssignmentInput,
} from "@exercisebook/generators";
import { beforeAll, describe, expect, it } from "vitest";

import {
  canonicalizePrintDocumentV1,
  projectPrintDocumentV1,
  renderPrintableHtml,
} from "./index.js";

describe("PrintDocumentV1 compatibility identities", () => {
  let actualIdentities: Readonly<{
    instance: string;
    studentPrintDocument: string;
    answerKeyPrintDocument: string;
    studentHtml: string;
    answerKeyHtml: string;
  }>;

  beforeAll(async () => {
    const markdown = readFileSync(
      new URL(
        "../../../content/en/math/fractions/add-unlike-denominators.md",
        import.meta.url,
      ),
      "utf8",
    );
    const compiledContent = await compileContentSource(markdown);
    const materialized = await materializeFractionAdditionWorksheetFromContent(
      compiledContent.document,
      sampleAssignmentMetadata(),
    );
    const studentDocument = await projectPrintDocumentV1(materialized, {
      variant: "student",
    });
    const answerKeyDocument = await projectPrintDocumentV1(materialized, {
      variant: "answer-key",
    });

    actualIdentities = {
      instance: materialized.instanceHash,
      studentPrintDocument: await sha256Hex(
        canonicalizePrintDocumentV1(studentDocument),
      ),
      answerKeyPrintDocument: await sha256Hex(
        canonicalizePrintDocumentV1(answerKeyDocument),
      ),
      studentHtml: await sha256Hex(renderPrintableHtml(studentDocument)),
      answerKeyHtml: await sha256Hex(renderPrintableHtml(answerKeyDocument)),
    };
  });

  it("keeps the authoritative real-pipeline hashes byte-for-byte stable", () => {
    expect(actualIdentities).toEqual({
      instance: "5252ef64b127638b785a94b3a2c7d1859cd7299e7032bed10aa41e07b2c4d12b",
      studentPrintDocument:
        "cd53a76b9c22c3a3e4af307f8d8bc19f60b9fd3845d5d4112637a2c5cb140c1f",
      answerKeyPrintDocument:
        "f69fcc570f557f163a1f08fb766a507afbd29bd987577e40aecc8ffef96d0ec3",
      studentHtml: "2ff0c371d280373cfc48283e8839f9766f328f6dd23ec35a150e28012228c22d",
      answerKeyHtml: "ac08a37f20b62a7ab2d7b1ca701b281c7124bc550db05ffc2175472fc6112aca",
    });
  });
});

function sampleAssignmentMetadata(): FractionAdditionAssignmentInput {
  return {
    assignmentId: FRACTION_ADDITION_SAMPLE_INPUT.assignmentId,
    localStudyDate: FRACTION_ADDITION_SAMPLE_INPUT.localStudyDate,
    timeZone: FRACTION_ADDITION_SAMPLE_INPUT.timeZone,
    locale: FRACTION_ADDITION_SAMPLE_INPUT.locale,
    seed: FRACTION_ADDITION_SAMPLE_INPUT.seed,
    seedSecretVersion: FRACTION_ADDITION_SAMPLE_INPUT.seedSecretVersion,
    requestedItemCount: FRACTION_ADDITION_SAMPLE_INPUT.itemCount,
    plan: FRACTION_ADDITION_SAMPLE_INPUT.plan,
    policy: FRACTION_ADDITION_SAMPLE_INPUT.policy,
    skillGraph: FRACTION_ADDITION_SAMPLE_INPUT.skillGraph,
    selectionReasons: FRACTION_ADDITION_SAMPLE_INPUT.selectionReasons,
  };
}
