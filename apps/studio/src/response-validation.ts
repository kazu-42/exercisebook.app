import {
  cancelResponseBodyBestEffort,
  readBoundedStrictJsonResponse,
} from "../../web/src/shared/bounded-json-response";
import type {
  ExplanationStep,
  GradeItem,
  GradeResult,
  Lesson,
  Topic,
  TopicId,
  Workbook,
} from "./contracts";

const topicIds = ["signed-numbers", "expressions", "equations"] as const;
const relations: Record<TopicId, readonly ExplanationStep["relation"][]> = {
  "signed-numbers": ["expression-equality"],
  expressions: ["substitution", "expression-equality"],
  equations: ["equivalent-equation", "verification"],
};

function invalid(): never {
  throw new TypeError("Unexpected studio response structure.");
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key)))
    invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum = 512): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    value.trim().length === 0 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  )
    invalid();
  return value;
}

function choice<T extends string | number | boolean>(
  value: unknown,
  options: readonly T[],
): T {
  const found = options.find((option) => option === value);
  if (found === undefined) invalid();
  return found;
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    invalid();
  return value;
}

function array(value: unknown, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
    invalid();
  return value;
}

function steps(value: unknown, topicId: TopicId): ExplanationStep[] {
  return array(value, 1, 8).map((entry) => {
    const step = record(entry, ["relation", "math", "reason"]);
    return {
      relation: choice(step.relation, relations[topicId]),
      math: text(step.math, 1024),
      reason: text(step.reason, 2048),
    };
  });
}

function lesson(value: unknown, topicId: TopicId): Lesson {
  const source = record(value, ["title", "rule", "example", "steps"]);
  return {
    title: text(source.title),
    rule: text(source.rule, 2048),
    example: text(source.example, 1024),
    steps: steps(source.steps, topicId),
  };
}

export function parseCatalog(value: unknown): { topics: Topic[] } {
  const source = record(value, ["topics"]);
  const topics = array(source.topics, 1, topicIds.length).map((entry): Topic => {
    const topic = record(entry, [
      "id",
      "number",
      "title",
      "subtitle",
      "description",
      "prerequisite",
      "sample",
      "lesson",
    ]);
    const id = choice(topic.id, topicIds);
    const number = text(topic.number, 2);
    if (number !== `0${topicIds.indexOf(id) + 1}`) invalid();
    return {
      id,
      number,
      title: text(topic.title),
      subtitle: text(topic.subtitle),
      description: text(topic.description, 2048),
      prerequisite: text(topic.prerequisite),
      sample: text(topic.sample, 1024),
      lesson: lesson(topic.lesson, id),
    };
  });
  if (new Set(topics.map((topic) => topic.id)).size !== topics.length) invalid();
  return { topics };
}

export function parseWorkbook(value: unknown): Workbook {
  const source = record(value, [
    "schemaVersion",
    "saved",
    "topicId",
    "level",
    "count",
    "id",
    "instanceHash",
    "title",
    "levelLabel",
    "minutes",
    "reason",
    "lesson",
    "items",
  ]);
  const schemaVersion = choice(source.schemaVersion, ["studio-workbook-v1"] as const);
  const saved = choice(source.saved, [false] as const);
  const topicId = choice(source.topicId, topicIds);
  const count = choice(source.count, [4, 6, 8] as const);
  const instanceHash = text(source.instanceHash, 64);
  const id = text(source.id, 71);
  if (
    !/^[a-f0-9]{64}$/u.test(instanceHash) ||
    (id !== `draft-${instanceHash}` && id !== `studio-${instanceHash}`)
  )
    invalid();
  return {
    schemaVersion,
    saved,
    topicId,
    count,
    id,
    instanceHash,
    level: choice(source.level, ["foundation", "standard"] as const),
    title: text(source.title),
    levelLabel: text(source.levelLabel),
    minutes: integer(source.minutes, 1, 60),
    reason: text(source.reason, 2048),
    lesson: lesson(source.lesson, topicId),
    items: array(source.items, count, count).map((entry, index) => {
      const item = record(entry, ["id", "prompt", "instruction"]);
      if (item.id !== `q-${index + 1}`) invalid();
      return {
        id: item.id,
        prompt: text(item.prompt, 1024),
        instruction: text(item.instruction),
      };
    }),
  };
}

export function parseGradeResult(value: unknown, workbook: Workbook): GradeResult {
  const source = record(value, ["workbookId", "correctCount", "total", "items"]);
  if (source.workbookId !== workbook.id || source.total !== workbook.count) invalid();
  const items = array(source.items, workbook.count, workbook.count).map(
    (entry, index): GradeItem => {
      const item = record(entry, ["id", "status", "submitted", "answer", "steps"]);
      if (item.id !== workbook.items[index]?.id) invalid();
      const status = choice(item.status, [
        "correct",
        "incorrect",
        "unanswered",
        "invalid",
      ] as const);
      // Echoed learner input may be invalid mathematical text; preserve it so
      // the learner still receives the server's explicit invalid-input result.
      const submitted = item.submitted;
      if (typeof submitted !== "string" || submitted.length > 64) invalid();
      if ((status === "unanswered") !== (submitted.trim() === "")) invalid();
      const answer = text(item.answer, 10);
      if (!/^(?:0|-?[1-9][0-9]{0,8})$/u.test(answer)) invalid();
      return {
        id: text(item.id, 3),
        status,
        submitted,
        answer,
        steps: steps(item.steps, workbook.topicId),
      };
    },
  );
  const correctCount = integer(source.correctCount, 0, workbook.count);
  if (correctCount !== items.filter((item) => item.status === "correct").length)
    invalid();
  return { workbookId: workbook.id, total: workbook.count, correctCount, items };
}

/** Keep one signal alive through fetch and bounded decoding, including slow bodies. */
export async function readResponseJson(
  response: Response,
  signal: AbortSignal = AbortSignal.timeout(15_000),
): Promise<unknown> {
  if (!response.ok) {
    const error = new TypeError("Studio request failed.");
    cancelResponseBodyBestEffort(response, error);
    throw error;
  }
  return readBoundedStrictJsonResponse(response, { maximumBytes: 65_536, signal });
}
