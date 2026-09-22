import documents from "./compiled-lessons.json";
import type { StudioLessonDocument } from "./content-source";

// The build/check gate compiles the original sources and verifies this exact AST.
// Runtime consumers import data only; the authoring parser is never served.
const compiledDocuments = documents as readonly StudioLessonDocument[];

// Exact paths keep the preserved fixture catalog independent of level additions.
export const compiledLessonSources = compiledDocuments.filter((document) =>
  [
    "content/studio/signed-numbers.md",
    "content/studio/expressions.md",
    "content/studio/equations.md",
  ].includes(document.provenance.sourcePath),
);

export const compiledStandardLessonSources = compiledDocuments.filter((document) =>
  [
    "content/studio/signed-numbers-standard.md",
    "content/studio/expressions-standard.md",
    "content/studio/equations-standard.md",
  ].includes(document.provenance.sourcePath),
);
