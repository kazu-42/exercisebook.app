export { canonicalizePrintDocumentV1, createArtifactFilename } from "./canonical.js";
export { renderPrintableHtml, snapshotPrintSemantics } from "./render-html.js";
export {
  PrintDocumentProjectionError,
  projectPrintDocumentV1,
  verifyMaterializedWorksheetInstanceV1,
} from "./project.js";
export type {
  PrintDocumentProjectionErrorCode,
  ProjectPrintDocumentV1Options,
} from "./project.js";
export { PRINT_DOCUMENT_SCHEMA, PRINT_PROJECTOR_VERSION } from "./types.js";
export type {
  AnswerKeyPrintBlockV1,
  AnswerKeyPrintDocumentV1,
  PrintAnswerKeyBlockV1,
  PrintAttributionV1,
  PrintDocumentV1,
  PrintFractionBarBlockV1,
  PrintFractionV1,
  PrintInlineV1,
  PrintPaper,
  PrintProblemGroupBlockV1,
  PrintProblemV1,
  PrintSemanticSnapshotV1,
  PrintVariant,
  StudentPrintBlockV1,
  StudentPrintDocumentV1,
} from "./types.js";
export {
  assertStudentDocumentHasNoAnswerData,
  PrintDocumentValidationError,
  validatePrintDocumentV1,
} from "./validate.js";

export { canonicalizePrintDocumentV2 } from "./canonical-v2.js";
export {
  PRINTABLE_HTML_V2_RENDERER_VERSION,
  PrintDocumentV2RenderError,
  renderPrintableHtmlV2,
  snapshotPrintSemanticsV2,
} from "./render-html-v2.js";
export type { PrintDocumentV2RenderErrorCode } from "./render-html-v2.js";
export {
  PrintDocumentV2ProjectionError,
  projectAnswerKeyPrintDocumentV2,
  projectStudentPrintDocumentV2,
  verifyMaterializedWorksheetInstanceV2,
} from "./project-v2.js";
export type {
  PrintDocumentV2ProjectionErrorCode,
  ProjectAnswerKeyPrintDocumentV2Options,
  ProjectStudentPrintDocumentV2Options,
} from "./project-v2.js";
export {
  PRINT_DOCUMENT_V2_SCHEMA,
  PRINT_DOCUMENT_V2_SOURCE_INSTANCE_SCHEMA,
  PRINT_PROJECTOR_V2_VERSION,
  PRINT_SEMANTIC_SNAPSHOT_V2_SCHEMA,
} from "./types-v2.js";
export type {
  AnswerKeyPrintDocumentV2,
  AnswerKeyPrintSemanticSnapshotV2,
  MaterializedAnswerKeyPrintDocumentV2,
  MaterializedPrintDocumentV2,
  MaterializedStudentPrintDocumentV2,
  PrintDocumentV2,
  PrintPaperV2,
  PrintSemanticSnapshotV2,
  StudentPrintDocumentV2,
  StudentPrintSemanticSnapshotV2,
} from "./types-v2.js";
export {
  PrintDocumentV2ValidationError,
  validatePrintDocumentV2,
} from "./validate-v2.js";
