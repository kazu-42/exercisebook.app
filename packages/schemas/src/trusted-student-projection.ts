/**
 * Trusted server-projector API.
 *
 * This module exposes canonical answers only for final server-side Web and
 * PrintDocument authorization. It must never be imported by browser UI code or
 * used as an HTTP response, persisted state, log value, or cache value.
 * Prepared guards are stateful and phase-local; create and discard one within
 * each synchronous authorization phase rather than sharing it across artifacts.
 */
export {
  prepareStudentVisibleAnswerGuard,
  projectWorksheetForStudentWithCanonicalAnswers,
} from "./worksheet-instance-v1.js";
export type {
  PreparedStudentVisibleAnswerGuard,
  StudentWorksheetProjectionV1,
} from "./worksheet-instance-v1.js";
export { projectWorksheetV2ForStudentWithCanonicalAnswers } from "./student-worksheet-delivery-v2.js";
export type { StudentWorksheetProjectionV2 } from "./student-worksheet-delivery-v2.js";
