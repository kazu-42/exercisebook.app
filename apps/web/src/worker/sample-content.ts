import phase1Content from "../../../../content/compiled/math.fractions.add-unlike-denominators.v1.json" with { type: "json" };
import {
  validateContentDocumentV1,
  type ContentDocumentV1,
} from "@exercisebook/schemas";

export const SAMPLE_CONTENT_DOCUMENT: ContentDocumentV1 =
  validateContentDocumentV1(phase1Content);
