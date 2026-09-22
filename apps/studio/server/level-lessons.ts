import { explainFixture, promptFor } from "../domain/math-model";
import type { Level, Topic } from "../src/contracts";
import { compiledStandardLessonSources } from "./compiled-lessons";

/** Select the worked example that teaches the generated level's actual operations. */
export function levelLessonCatalog(
  topics: readonly Topic[],
  level: Level,
): readonly Topic[] {
  if (level === "foundation") return topics;
  return topics.map((topic) => {
    const source = compiledStandardLessonSources.find(
      (document) => document.topic.id === topic.id,
    );
    if (!source) throw new Error("Missing standard-level lesson source.");
    return {
      ...topic,
      lesson: {
        ...source.lesson,
        example: promptFor(source.exampleModel),
        steps: explainFixture(source.exampleModel),
      },
    };
  });
}
