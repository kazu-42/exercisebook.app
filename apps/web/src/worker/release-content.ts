import releaseContent from "../../../../content/compiled/math.fractions.add-unlike-denominators.public-v3.json" with { type: "json" };
import {
  validateContentDocumentV1,
  type ContentDocumentV1,
} from "@exercisebook/schemas";

/**
 * The only content candidate included in the learning.new V1 launch bundle.
 * Its authoring status remains draft; the trusted release manifest is the
 * separate authority that may project it to a published worksheet instance.
 */
export const RELEASE_CONTENT_DOCUMENT: ContentDocumentV1 =
  validateContentDocumentV1(releaseContent);
