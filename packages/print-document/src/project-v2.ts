import {
  canonicalizeJson,
  equalRationals,
  sha256Hex,
  type RationalJson,
} from "@exercisebook/domain";
import {
  assertSafeDataObjectGraph,
  assertStudentVisibleDataHasNoRecognizedCanonicalAnswers,
  deriveFractionAdditionPromptAccessibleText,
  validateStudentWorksheetDeliveryV2,
  validateWorksheetInstanceV2,
  type AttributionV1,
  type CanonicalRationalValue,
  type MaterializedWorksheetInstanceV2,
  type StudentWorksheetDeliveryV2,
  type StudentWorksheetSlotV2,
  type WorksheetInstanceV2,
  type WorksheetSlotV2,
} from "@exercisebook/schemas";
import { projectWorksheetV2ForStudentWithCanonicalAnswers } from "@exercisebook/schemas/trusted-student-projection";

import { materializePrintDocumentV2 } from "./canonical-v2.js";
import {
  PRINT_DOCUMENT_V2_LOCALE,
  PRINT_DOCUMENT_V2_PAPER,
  PRINT_DOCUMENT_V2_SCHEMA,
  PRINT_DOCUMENT_V2_SOURCE_INSTANCE_SCHEMA,
  PRINT_PROJECTOR_V2_VERSION,
  type AnswerKeyPrintBlockV2,
  type AnswerKeyPrintDocumentV2,
  type MaterializedAnswerKeyPrintDocumentV2,
  type MaterializedStudentPrintDocumentV2,
  type PrintAnswerKeyBlockV2,
  type PrintFallbackBlockV2,
  type PrintFractionAdditionPromptV2,
  type PrintPaperV2,
  type PrintProblemGroupBlockV2,
  type PrintProblemV2,
  type PrintWorkedExampleBlockV2,
  type StudentPrintBlockV2,
  type StudentPrintDocumentV2,
} from "./types-v2.js";
import {
  validateAnswerKeyPrintDocumentV2,
  validateStudentPrintDocumentV2,
} from "./validate-v2.js";

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const CANONICAL_INTEGER_PATTERN = /^(?:0|-?[1-9][0-9]{0,127})$/u;
const POSITIVE_CANONICAL_INTEGER_PATTERN = /^[1-9][0-9]{0,127}$/u;

export type PrintDocumentV2ProjectionErrorCode =
  | "invalid-options"
  | "invalid-materialization"
  | "invalid-instance"
  | "canonical-json-mismatch"
  | "hash-mismatch"
  | "unsupported-paper"
  | "unsupported-locale"
  | "trusted-projection-failed"
  | "invalid-document"
  | "student-authorization-failed";

export class PrintDocumentV2ProjectionError extends Error {
  public readonly code: PrintDocumentV2ProjectionErrorCode;

  public constructor(
    code: PrintDocumentV2ProjectionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PrintDocumentV2ProjectionError";
    this.code = code;
  }
}

export interface ProjectStudentPrintDocumentV2Options {
  readonly materializedWorksheet: MaterializedWorksheetInstanceV2;
  readonly paper: PrintPaperV2;
}

export interface ProjectAnswerKeyPrintDocumentV2Options {
  readonly materializedWorksheet: MaterializedWorksheetInstanceV2;
  readonly paper: PrintPaperV2;
}

interface CapturedWorksheetMaterializationV2 {
  readonly instance: WorksheetInstanceV2;
  readonly canonicalJson: string;
  readonly instanceHash: string;
}

interface VerifiedProjectionSourceV2 {
  readonly materializedWorksheet: MaterializedWorksheetInstanceV2;
  readonly paper: PrintPaperV2;
  readonly delivery: StudentWorksheetDeliveryV2;
  readonly canonicalAnswers: readonly CanonicalRationalValue[];
}

/**
 * Project the exact answer-free semantic document for one authenticated V2
 * worksheet snapshot. `paper` is required and participates in the document
 * hash; there is no variant default or V1 fallback.
 */
export async function projectStudentPrintDocumentV2(
  options: ProjectStudentPrintDocumentV2Options,
): Promise<MaterializedStudentPrintDocumentV2> {
  const source = await authorizeProjectionSourceV2(options);
  const candidate = buildStudentDocument(
    source.delivery,
    source.paper,
    projectStudentBlocks(source.delivery),
  );
  const document = validateProjectedStudentDocument(candidate);
  assertStudentPrintDocumentV2Authorization(
    document,
    source.delivery,
    source.canonicalAnswers,
    source.materializedWorksheet.instance,
  );
  return materializePrintDocumentV2(document);
}

/**
 * Project an answer-key document from the same detached snapshot used for its
 * answer-free prefix. Key entries are the only blocks that read full slots.
 */
export async function projectAnswerKeyPrintDocumentV2(
  options: ProjectAnswerKeyPrintDocumentV2Options,
): Promise<MaterializedAnswerKeyPrintDocumentV2> {
  const source = await authorizeProjectionSourceV2(options);
  const studentBlocks = projectStudentBlocks(source.delivery);

  // Authorize the shared prefix as a complete student document before any
  // answer-bearing appendix is created. This keeps the common student/key
  // semantics on the answer-free delivery side of the boundary.
  const studentDocument = validateProjectedStudentDocument(
    buildStudentDocument(source.delivery, source.paper, studentBlocks),
  );
  assertStudentPrintDocumentV2Authorization(
    studentDocument,
    source.delivery,
    source.canonicalAnswers,
    source.materializedWorksheet.instance,
  );

  const instance = source.materializedWorksheet.instance;
  const candidate: AnswerKeyPrintDocumentV2 = {
    schema: PRINT_DOCUMENT_V2_SCHEMA,
    sourceInstanceSchema: PRINT_DOCUMENT_V2_SOURCE_INSTANCE_SCHEMA,
    sourceInstanceHash: source.delivery.instanceHash,
    projectorVersion: PRINT_PROJECTOR_V2_VERSION,
    paper: source.paper,
    locale: PRINT_DOCUMENT_V2_LOCALE,
    variant: "answer-key",
    title: `${source.delivery.title} — Answer key`,
    blocks: [
      ...studentDocument.blocks,
      { type: "page-break", id: "answer-key-page-break" },
      {
        type: "heading",
        id: "answer-key-title",
        level: 1,
        content: [{ type: "text", text: "Answer key" }],
      },
      ...instance.slots.map(projectAnswerKeyBlock),
    ],
    attributions: studentDocument.attributions,
  };
  const document = validateProjectedAnswerKeyDocument(candidate);
  return materializePrintDocumentV2(document);
}

/**
 * Verify and detach an integrity-bearing V2 worksheet materialization.
 *
 * A valid hash proves only that this snapshot is self-consistent. It does not
 * prove that policy, content, or planner selection is trusted; application
 * services must authenticate those authorities through trusted replay before
 * exposing this projector to an external request.
 */
export async function verifyMaterializedWorksheetInstanceV2(
  materialized: MaterializedWorksheetInstanceV2,
): Promise<WorksheetInstanceV2> {
  const captured = captureWorksheetMaterializationV2(materialized);
  return (await finishWorksheetMaterializationVerificationV2(captured)).instance;
}

/**
 * Final role-sensitive authorization for the student print AST.
 *
 * The source instance proves delivery/answer mapping, while exact block
 * equality proves that no seed, scoring, solution, or misconception field was
 * renamed into the AST. All visible blocks are reconstructed from the detached
 * answer-free delivery. Cross-slot answers are allowed solely as exact prompt
 * operands (and their exact fraction-bar representation); a problem's own
 * answer is never allowed in those roles.
 */
export function assertStudentPrintDocumentV2Authorization(
  documentValue: StudentPrintDocumentV2,
  deliveryValue: StudentWorksheetDeliveryV2,
  canonicalAnswerValues: readonly CanonicalRationalValue[],
  sourceInstanceValue: WorksheetInstanceV2,
): void {
  try {
    assertStudentPrintDocumentV2AuthorizationRaw(
      documentValue,
      deliveryValue,
      canonicalAnswerValues,
      sourceInstanceValue,
    );
  } catch (error: unknown) {
    throw new PrintDocumentV2ProjectionError(
      "student-authorization-failed",
      "Student PrintDocumentV2 authorization failed.",
      { cause: error },
    );
  }
}

async function authorizeProjectionSourceV2(
  options:
    ProjectStudentPrintDocumentV2Options | ProjectAnswerKeyPrintDocumentV2Options,
): Promise<VerifiedProjectionSourceV2> {
  // This complete graph inspection happens before the first property read and
  // before the first asynchronous yield. Accessors therefore cannot race or
  // execute while the input envelope is captured.
  assertSafeProjectionOptions(options);
  const optionRecord = expectExactRecord(
    options,
    ["materializedWorksheet", "paper"],
    "invalid-options",
    "PrintDocumentV2 projection options",
  );
  if (optionRecord.paper !== PRINT_DOCUMENT_V2_PAPER) {
    throw new PrintDocumentV2ProjectionError(
      "unsupported-paper",
      "PrintDocumentV2 supports only an explicitly requested A4 paper size.",
    );
  }

  const captured = captureWorksheetMaterializationV2(
    optionRecord.materializedWorksheet,
    true,
  );
  const materializedWorksheet =
    await finishWorksheetMaterializationVerificationV2(captured);

  let projection: Awaited<
    ReturnType<typeof projectWorksheetV2ForStudentWithCanonicalAnswers>
  >;
  try {
    projection =
      await projectWorksheetV2ForStudentWithCanonicalAnswers(materializedWorksheet);
  } catch (error: unknown) {
    throw new PrintDocumentV2ProjectionError(
      "trusted-projection-failed",
      "Trusted V2 student projection rejected the verified worksheet snapshot.",
      { cause: error },
    );
  }
  if (projection.delivery.locale !== PRINT_DOCUMENT_V2_LOCALE) {
    throw new PrintDocumentV2ProjectionError(
      "unsupported-locale",
      "PrintDocumentV2 currently supports only the reviewed English locale.",
    );
  }
  if (
    projection.delivery.instanceHash !== materializedWorksheet.instanceHash ||
    projection.delivery.slots.length !== materializedWorksheet.instance.slots.length ||
    projection.canonicalAnswers.length !== materializedWorksheet.instance.slots.length
  ) {
    throw new PrintDocumentV2ProjectionError(
      "trusted-projection-failed",
      "Trusted V2 student projection returned an inconsistent source mapping.",
    );
  }

  return {
    materializedWorksheet,
    paper: PRINT_DOCUMENT_V2_PAPER,
    delivery: projection.delivery,
    canonicalAnswers: projection.canonicalAnswers,
  };
}

function assertSafeProjectionOptions(value: unknown): void {
  try {
    assertSafeDataObjectGraph(value);
  } catch (error: unknown) {
    // Classify an unsafe nested materialization without reading it through a
    // getter. A top-level accessor remains an invalid options envelope; a
    // safe data descriptor whose nested graph is hostile is an invalid
    // materialization.
    if (isRecord(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(
        value,
        "materializedWorksheet",
      );
      if (descriptor !== undefined && "value" in descriptor) {
        try {
          assertSafeDataObjectGraph(descriptor.value);
        } catch (materializationError: unknown) {
          throw new PrintDocumentV2ProjectionError(
            "invalid-materialization",
            "Worksheet materialization must be one safe plain-data snapshot.",
            { cause: materializationError },
          );
        }
      }
    }
    throw new PrintDocumentV2ProjectionError(
      "invalid-options",
      "PrintDocumentV2 projection options must be one safe plain-data envelope.",
      { cause: error },
    );
  }
}

function captureWorksheetMaterializationV2(
  value: unknown,
  graphAlreadyChecked = false,
): CapturedWorksheetMaterializationV2 {
  if (!graphAlreadyChecked) {
    try {
      assertSafeDataObjectGraph(value);
    } catch (error: unknown) {
      throw new PrintDocumentV2ProjectionError(
        "invalid-materialization",
        "Worksheet materialization must be one safe plain-data snapshot.",
        { cause: error },
      );
    }
  }
  const materialized = expectExactRecord(
    value,
    ["instance", "canonicalJson", "instanceHash"],
    "invalid-materialization",
    "Worksheet materialization",
  );

  const providedCanonicalJson = materialized.canonicalJson;
  if (typeof providedCanonicalJson !== "string") {
    throw new PrintDocumentV2ProjectionError(
      "invalid-materialization",
      "Worksheet materialization canonicalJson must be a string.",
    );
  }
  const providedInstanceHash = materialized.instanceHash;
  if (
    typeof providedInstanceHash !== "string" ||
    !HASH_PATTERN.test(providedInstanceHash)
  ) {
    throw new PrintDocumentV2ProjectionError(
      "hash-mismatch",
      "Worksheet materialization hash must be 64 lowercase hexadecimal characters.",
    );
  }

  let instance: WorksheetInstanceV2;
  try {
    instance = validateWorksheetInstanceV2(materialized.instance);
  } catch (error: unknown) {
    throw new PrintDocumentV2ProjectionError(
      "invalid-instance",
      "WorksheetInstanceV2 validation failed.",
      { cause: error },
    );
  }
  if (instance.locale !== PRINT_DOCUMENT_V2_LOCALE) {
    throw new PrintDocumentV2ProjectionError(
      "unsupported-locale",
      "PrintDocumentV2 currently supports only the reviewed English locale.",
    );
  }

  let expectedCanonicalJson: string;
  try {
    expectedCanonicalJson = canonicalizeJson(instance);
  } catch (error: unknown) {
    throw new PrintDocumentV2ProjectionError(
      "invalid-instance",
      "WorksheetInstanceV2 is outside the canonical JSON data model.",
      { cause: error },
    );
  }
  if (providedCanonicalJson !== expectedCanonicalJson) {
    throw new PrintDocumentV2ProjectionError(
      "canonical-json-mismatch",
      "Worksheet materialization bytes do not canonically represent its instance.",
    );
  }

  return {
    instance,
    canonicalJson: providedCanonicalJson,
    instanceHash: providedInstanceHash,
  };
}

async function finishWorksheetMaterializationVerificationV2(
  captured: CapturedWorksheetMaterializationV2,
): Promise<MaterializedWorksheetInstanceV2> {
  const actualHash = await sha256Hex(captured.canonicalJson);
  if (actualHash !== captured.instanceHash) {
    throw new PrintDocumentV2ProjectionError(
      "hash-mismatch",
      "Worksheet materialization hash does not match its canonical bytes.",
    );
  }
  return {
    instance: captured.instance,
    canonicalJson: captured.canonicalJson,
    instanceHash: captured.instanceHash,
  };
}

function buildStudentDocument(
  delivery: StudentWorksheetDeliveryV2,
  paper: PrintPaperV2,
  blocks: readonly StudentPrintBlockV2[],
): StudentPrintDocumentV2 {
  return {
    schema: PRINT_DOCUMENT_V2_SCHEMA,
    sourceInstanceSchema: PRINT_DOCUMENT_V2_SOURCE_INSTANCE_SCHEMA,
    sourceInstanceHash: delivery.instanceHash,
    projectorVersion: PRINT_PROJECTOR_V2_VERSION,
    paper,
    locale: PRINT_DOCUMENT_V2_LOCALE,
    variant: "student",
    title: delivery.title,
    blocks,
    attributions: projectAttributions(delivery.attributions),
  };
}

function projectStudentBlocks(
  delivery: StudentWorksheetDeliveryV2,
): StudentPrintBlockV2[] {
  const presentation = delivery.presentation;
  const blocks: StudentPrintBlockV2[] = [
    {
      type: "heading",
      id: "worksheet-title",
      level: 1,
      content: [{ type: "text", text: delivery.title }],
    },
    {
      type: "paragraph",
      id: "worksheet-summary",
      content: [
        {
          type: "text",
          text: `${delivery.localStudyDate} · ${String(delivery.expectedMinutes)} minutes`,
        },
      ],
    },
    {
      type: "heading",
      id: "lesson-heading",
      sourceNodeId: presentation.lesson.nodeId,
      level: 2,
      content: [{ type: "text", text: presentation.lesson.title }],
    },
    ...presentation.lesson.paragraphs.map((paragraph, index) => ({
      type: "paragraph" as const,
      id: ordinalId("lesson-paragraph", index + 1),
      sourceNodeId: presentation.lesson.nodeId,
      paragraphOrdinal: index + 1,
      content: [{ type: "text" as const, text: paragraph }],
    })),
    projectWorkedExample(delivery),
  ];

  for (const [index, slot] of delivery.slots.entries()) {
    const ordinal = index + 1;
    blocks.push(projectProblemGroup(slot, ordinal, presentation.exercise.nodeId));
    blocks.push(projectPrintFallback(slot, ordinal));
    blocks.push({
      type: "working-space",
      id: ordinalId("working-space", ordinal),
      problemId: slot.id,
      ordinal,
      label: `Working space for problem ${String(ordinal)}`,
      lines: 3,
    });
  }
  return blocks;
}

function projectWorkedExample(
  delivery: StudentWorksheetDeliveryV2,
): PrintWorkedExampleBlockV2 {
  const source = delivery.presentation.workedExample;
  const model = source.model;
  return {
    type: "worked-example",
    id: "worked-example",
    sourceNodeId: source.nodeId,
    title: source.title,
    model: {
      type: "fraction-addition",
      left: { ...model.left },
      right: { ...model.right },
      result: { ...model.result },
      commonDenominator: model.commonDenominator,
      leftScaledNumerator: model.leftScaledNumerator,
      rightScaledNumerator: model.rightScaledNumerator,
      unreducedSumNumerator: model.unreducedSumNumerator,
    },
    prompt: [
      projectFraction(model.left),
      { type: "operator", symbol: "+", accessibleText: "plus" },
      projectFraction(model.right),
      { type: "operator", symbol: "=", accessibleText: "equals" },
      projectFraction(model.result),
    ],
    steps: [...source.steps],
  };
}

function projectProblemGroup(
  slot: StudentWorksheetSlotV2,
  ordinal: number,
  sourceNodeId: StudentWorksheetDeliveryV2["presentation"]["exercise"]["nodeId"],
): PrintProblemGroupBlockV2 {
  return {
    type: "problem-group",
    id: ordinalId("problem-group", ordinal),
    sourceNodeId,
    ordinal,
    title: `Problem ${String(ordinal)}`,
    problems: [projectProblem(slot, ordinal)],
  };
}

function projectProblem(slot: StudentWorksheetSlotV2, ordinal: number): PrintProblemV2 {
  if (
    slot.provenance.contentId !== "math.fractions.add-unlike-denominators" ||
    slot.provenance.contentRevision !== 2
  ) {
    throw new PrintDocumentV2ProjectionError(
      "invalid-instance",
      "Worksheet problem provenance does not identify the reviewed V2 content.",
    );
  }
  const promptAccessibleText = deriveFractionAdditionPromptAccessibleText(
    slot.prompt.left,
    slot.prompt.right,
  );
  return {
    id: slot.id,
    ordinal,
    instruction: slot.prompt.instruction,
    promptAccessibleText,
    prompt: [
      projectFraction(slot.prompt.left),
      { type: "operator", symbol: "+", accessibleText: "plus" },
      projectFraction(slot.prompt.right),
    ],
    response: {
      type: "fraction",
      label: `Response space for problem ${String(ordinal)}`,
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
  slot: StudentWorksheetSlotV2,
  ordinal: number,
): PrintFallbackBlockV2 {
  const left = toFractionBar(slot.prompt.left);
  const right = toFractionBar(slot.prompt.right);
  return {
    type: "print-fallback",
    id: ordinalId("print-fallback", ordinal),
    problemId: slot.id,
    ordinal,
    content:
      left === undefined || right === undefined
        ? { type: "text", text: slot.printFallback.text }
        : {
            type: "fraction-bars",
            label: slot.prompt.accessibleText,
            caption: slot.printFallback.text,
            bars: [
              { ...left, label: rationalText(slot.prompt.left) },
              { ...right, label: rationalText(slot.prompt.right) },
            ],
          },
  };
}

function projectAnswerKeyBlock(
  slot: WorksheetSlotV2,
  index: number,
): PrintAnswerKeyBlockV2 {
  const ordinal = index + 1;
  return {
    type: "answer-key",
    id: ordinalId("answer-key", ordinal),
    problemId: slot.id,
    ordinal,
    canonicalResponse: [
      {
        type: "fraction",
        numerator: slot.canonicalAnswer.value.numerator,
        denominator: slot.canonicalAnswer.value.denominator,
        accessibleText: `${slot.canonicalAnswer.value.numerator} over ${slot.canonicalAnswer.value.denominator}`,
      },
    ],
    explanation: slot.solutionTrace.map(
      (step) => `${step.explanation} ${step.accessibleText}`,
    ),
  };
}

function projectAttributions(attributions: readonly AttributionV1[]): AttributionV1[] {
  return attributions.map((attribution) => ({
    title: attribution.title,
    author: attribution.author,
    sourceUrl: attribution.sourceUrl,
    licenseId: attribution.licenseId,
    attributionText: attribution.attributionText,
    publicationStatus: attribution.publicationStatus,
    modifications: [...attribution.modifications],
  }));
}

function assertStudentPrintDocumentV2AuthorizationRaw(
  documentValue: StudentPrintDocumentV2,
  deliveryValue: StudentWorksheetDeliveryV2,
  canonicalAnswerValues: readonly CanonicalRationalValue[],
  sourceInstanceValue: WorksheetInstanceV2,
): void {
  assertSafeDataObjectGraph({
    document: documentValue,
    delivery: deliveryValue,
    canonicalAnswers: canonicalAnswerValues,
    sourceInstance: sourceInstanceValue,
  });
  let document: StudentPrintDocumentV2;
  try {
    document = validateStudentPrintDocumentV2(documentValue);
  } catch (error: unknown) {
    throw new Error("Student PrintDocumentV2 mapping or structure is inconsistent", {
      cause: error,
    });
  }
  const delivery = validateStudentWorksheetDeliveryV2(deliveryValue);
  const sourceInstance = validateWorksheetInstanceV2(sourceInstanceValue);
  const canonicalAnswers = validateCanonicalAnswers(
    canonicalAnswerValues,
    sourceInstance.slots,
  );

  if (
    delivery.locale !== PRINT_DOCUMENT_V2_LOCALE ||
    sourceInstance.locale !== PRINT_DOCUMENT_V2_LOCALE ||
    document.locale !== PRINT_DOCUMENT_V2_LOCALE
  ) {
    throw new Error("Student PrintDocumentV2 locale mapping is inconsistent");
  }
  if (
    document.sourceInstanceHash !== delivery.instanceHash ||
    document.title !== delivery.title ||
    document.paper !== PRINT_DOCUMENT_V2_PAPER
  ) {
    throw new Error("Student PrintDocumentV2 source mapping is inconsistent");
  }
  assertDeliveryMatchesSourceInstance(delivery, sourceInstance);

  const expectedBlocks = projectStudentBlocks(delivery);
  if (canonicalizeJson(document.blocks) !== canonicalizeJson(expectedBlocks)) {
    throw new Error(
      "Student PrintDocumentV2 blocks do not exactly map the answer-free delivery",
    );
  }
  if (
    canonicalizeJson(document.attributions) !== canonicalizeJson(delivery.attributions)
  ) {
    throw new Error("Student PrintDocumentV2 attribution mapping is inconsistent");
  }

  const { blocks, attributions, ...globalDocument } = document;
  assertVisibleValueHasNoCanonicalAnswers(globalDocument, canonicalAnswers);
  assertVisibleValueHasNoCanonicalAnswers(attributions, canonicalAnswers);

  const presentationBlockCount = 4 + delivery.presentation.lesson.paragraphs.length;
  const presentationBlocks = blocks.slice(0, presentationBlockCount);
  assertVisibleValueHasNoCanonicalAnswers(presentationBlocks, canonicalAnswers);
  assertPresentationIntermediatesDoNotRevealPracticeAnswers(
    delivery.presentation.workedExample.model,
    canonicalAnswers,
  );
  assertCanonicalAnswersMatchSource(canonicalAnswers, sourceInstance.slots);

  for (const [index, slot] of delivery.slots.entries()) {
    const ownAnswer = canonicalAnswers[index];
    if (ownAnswer === undefined) {
      throw new Error(
        "Student PrintDocumentV2 problem-to-answer mapping is inconsistent",
      );
    }
    const blockOffset = presentationBlockCount + index * 3;
    const group = blocks[blockOffset];
    const fallback = blocks[blockOffset + 1];
    const workingSpace = blocks[blockOffset + 2];
    if (
      group?.type !== "problem-group" ||
      fallback?.type !== "print-fallback" ||
      workingSpace?.type !== "working-space"
    ) {
      throw new Error("Student PrintDocumentV2 problem block mapping is inconsistent");
    }

    const problem = group.problems[0];
    if (
      problem === undefined ||
      problem.id !== slot.id ||
      problem.ordinal !== index + 1
    ) {
      throw new Error("Student PrintDocumentV2 problem mapping is inconsistent");
    }
    const { problems, ...groupMetadata } = group;
    assertVisibleValueHasNoCanonicalAnswers(groupMetadata, canonicalAnswers);

    const { prompt, promptAccessibleText, ...nonPromptProblem } = problem;
    assertVisibleValueHasNoCanonicalAnswers(nonPromptProblem, canonicalAnswers);
    assertProblemPromptAuthorization(prompt, promptAccessibleText, slot, ownAnswer);

    assertFallbackAuthorization(fallback, slot, ownAnswer, canonicalAnswers);
    assertVisibleValueHasNoCanonicalAnswers(workingSpace, canonicalAnswers);
  }
}

function assertDeliveryMatchesSourceInstance(
  delivery: StudentWorksheetDeliveryV2,
  instance: WorksheetInstanceV2,
): void {
  const expected = {
    schema: delivery.schema,
    assignmentId: instance.assignmentId,
    title: instance.title,
    localStudyDate: instance.localStudyDate,
    timeZone: instance.timeZone,
    locale: instance.locale,
    expectedMinutes: instance.expectedMinutes,
    presentation: instance.presentation,
    slots: instance.slots.map((slot) => ({
      id: slot.id,
      skillIds: slot.skillIds,
      selectionReasons: slot.selectionReasons,
      expectedMinutes: slot.expectedMinutes,
      prompt: slot.prompt,
      hints: slot.hints,
      accessibility: slot.accessibility,
      printFallback: slot.printFallback,
      provenance: slot.provenance,
    })),
    attributions: instance.attributions,
  };
  const { instanceHash: _instanceHash, ...actual } = delivery;
  if (canonicalizeJson(actual) !== canonicalizeJson(expected)) {
    throw new Error("Student worksheet delivery does not map the source instance");
  }
}

function validateCanonicalAnswers(
  values: readonly CanonicalRationalValue[],
  slots: readonly WorksheetSlotV2[],
): readonly CanonicalRationalValue[] {
  if (!Array.isArray(values) || values.length !== slots.length) {
    throw new Error("Student PrintDocumentV2 answer mapping is inconsistent");
  }
  return values.map((value, index) => {
    const answer = expectExactRecord(
      value,
      ["numerator", "denominator"],
      "student-authorization-failed",
      `Canonical answer ${String(index + 1)}`,
    );
    if (
      typeof answer.numerator !== "string" ||
      typeof answer.denominator !== "string" ||
      !CANONICAL_INTEGER_PATTERN.test(answer.numerator) ||
      !POSITIVE_CANONICAL_INTEGER_PATTERN.test(answer.denominator)
    ) {
      throw new Error("Student PrintDocumentV2 canonical answer is invalid");
    }
    return {
      numerator: answer.numerator,
      denominator: answer.denominator,
    };
  });
}

function assertCanonicalAnswersMatchSource(
  canonicalAnswers: readonly CanonicalRationalValue[],
  slots: readonly WorksheetSlotV2[],
): void {
  for (const [index, answer] of canonicalAnswers.entries()) {
    const sourceAnswer = slots[index]?.canonicalAnswer.value;
    if (
      sourceAnswer === undefined ||
      answer.numerator !== sourceAnswer.numerator ||
      answer.denominator !== sourceAnswer.denominator
    ) {
      throw new Error(
        "Student PrintDocumentV2 answer-to-source mapping is inconsistent",
      );
    }
  }
}

function assertProblemPromptAuthorization(
  prompt: PrintFractionAdditionPromptV2,
  promptAccessibleText: string,
  slot: StudentWorksheetSlotV2,
  ownAnswer: CanonicalRationalValue,
): void {
  const expectedAccessibleText = deriveFractionAdditionPromptAccessibleText(
    slot.prompt.left,
    slot.prompt.right,
  );
  if (
    promptAccessibleText !== expectedAccessibleText ||
    slot.prompt.accessibleText !== expectedAccessibleText ||
    !printFractionMatchesRational(prompt[0], slot.prompt.left) ||
    !printFractionMatchesRational(prompt[2], slot.prompt.right) ||
    equalRationals(slot.prompt.left, ownAnswer) ||
    equalRationals(slot.prompt.right, ownAnswer)
  ) {
    throw new Error("Student PrintDocumentV2 prompt authorization failed");
  }
  assertVisibleValueHasNoCanonicalAnswers({ prompt, promptAccessibleText }, [
    ownAnswer,
  ]);
}

function assertFallbackAuthorization(
  fallback: PrintFallbackBlockV2,
  slot: StudentWorksheetSlotV2,
  ownAnswer: CanonicalRationalValue,
  canonicalAnswers: readonly CanonicalRationalValue[],
): void {
  if (
    fallback.problemId !== slot.id ||
    fallback.ordinal < 1 ||
    fallback.ordinal > canonicalAnswers.length
  ) {
    throw new Error("Student PrintDocumentV2 fallback mapping is inconsistent");
  }
  if (fallback.content.type === "text") {
    assertVisibleValueHasNoCanonicalAnswers(fallback, canonicalAnswers);
    return;
  }

  const { label, bars, caption, ...fallbackContentMetadata } = fallback.content;
  assertVisibleValueHasNoCanonicalAnswers(
    {
      type: fallback.type,
      id: fallback.id,
      problemId: fallback.problemId,
      ordinal: fallback.ordinal,
      content: { ...fallbackContentMetadata, caption },
    },
    canonicalAnswers,
  );
  assertVisibleValueHasNoCanonicalAnswers({ label, bars }, [ownAnswer]);
}

function assertPresentationIntermediatesDoNotRevealPracticeAnswers(
  model: StudentWorksheetDeliveryV2["presentation"]["workedExample"]["model"],
  canonicalAnswers: readonly CanonicalRationalValue[],
): void {
  assertVisibleValueHasNoCanonicalAnswers(
    [
      {
        numerator: model.leftScaledNumerator,
        denominator: model.commonDenominator,
      },
      {
        numerator: model.rightScaledNumerator,
        denominator: model.commonDenominator,
      },
      {
        numerator: model.unreducedSumNumerator,
        denominator: model.commonDenominator,
      },
    ],
    canonicalAnswers,
  );
}

function assertVisibleValueHasNoCanonicalAnswers(
  value: unknown,
  canonicalAnswers: readonly CanonicalRationalValue[],
): void {
  assertStudentVisibleDataHasNoRecognizedCanonicalAnswers(value, canonicalAnswers);
}

function validateProjectedStudentDocument(value: unknown): StudentPrintDocumentV2 {
  try {
    return validateStudentPrintDocumentV2(value);
  } catch (error: unknown) {
    throw new PrintDocumentV2ProjectionError(
      "invalid-document",
      "Projected student PrintDocumentV2 failed validation.",
      { cause: error },
    );
  }
}

function validateProjectedAnswerKeyDocument(value: unknown): AnswerKeyPrintDocumentV2 {
  try {
    return validateAnswerKeyPrintDocumentV2(value);
  } catch (error: unknown) {
    throw new PrintDocumentV2ProjectionError(
      "invalid-document",
      "Projected answer-key PrintDocumentV2 failed validation.",
      { cause: error },
    );
  }
}

function projectFraction(value: RationalJson) {
  return {
    type: "fraction" as const,
    numerator: value.numerator,
    denominator: value.denominator,
    accessibleText: `${value.numerator} over ${value.denominator}`,
  };
}

function printFractionMatchesRational(
  value: PrintFractionAdditionPromptV2[0],
  expected: RationalJson,
): boolean {
  return (
    value.numerator === expected.numerator &&
    value.denominator === expected.denominator &&
    value.accessibleText === `${expected.numerator} over ${expected.denominator}`
  );
}

function toFractionBar(
  value: RationalJson,
): { readonly numerator: number; readonly denominator: number } | undefined {
  const numerator = BigInt(value.numerator);
  const denominator = BigInt(value.denominator);
  if (numerator < 0n || numerator > denominator || denominator > 100n) {
    return undefined;
  }
  return { numerator: Number(numerator), denominator: Number(denominator) };
}

function rationalText(value: RationalJson): string {
  return `${value.numerator}/${value.denominator}`;
}

function ordinalId(prefix: string, ordinal: number): string {
  return `${prefix}-${String(ordinal).padStart(3, "0")}`;
}

function expectExactRecord(
  value: unknown,
  expectedKeys: readonly string[],
  code: PrintDocumentV2ProjectionErrorCode,
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new PrintDocumentV2ProjectionError(code, `${label} must be a plain object.`);
  }
  const keys = Object.keys(value);
  if (
    keys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new PrintDocumentV2ProjectionError(
      code,
      `${label} must contain exactly the reviewed fields.`,
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
