import { createHash } from "node:crypto";
import {
  arithmetic,
  expression,
  equation,
  answerFor,
  promptFor,
  explainFixture,
  type FixtureModel,
} from "../domain/math-model";
export {
  answerFor,
  promptFor,
  explainFixture,
  type FixtureModel,
} from "../domain/math-model";
import { compiledLessonSources } from "./compiled-lessons";
import type {
  GradeItem,
  GradeResult,
  Level,
  Topic,
  TopicId,
  Workbook,
  WorkbookItem,
  WorkbookRequest,
} from "../src/contracts";

// Local, original draft fixtures. These are deliberately separate from the
// reviewed production WorksheetInstance, publication, and evidence contracts.
const FIXTURE_VERSION = "japanese-studio-draft-2";

export class InvalidInputError extends Error {
  constructor(message = "入力内容を確認してください。") {
    super(message);
    this.name = "InvalidInputError";
  }
}

function topicCatalog(): readonly Topic[] {
  return compiledLessonSources.map((source) => ({
    ...source.topic,
    lesson: {
      ...source.lesson,
      example: promptFor(source.exampleModel),
      steps: explainFixture(source.exampleModel),
    },
  }));
}
const fixtures: Readonly<
  Record<TopicId, Readonly<Record<Level, readonly FixtureModel[]>>>
> = {
  "signed-numbers": {
    foundation: [
      arithmetic("add", 3, 5),
      arithmetic("subtract", 4, 8),
      arithmetic("add", -6, -5),
      arithmetic("subtract", 7, -6),
      arithmetic("add", -9, 12),
      arithmetic("subtract", -8, 6),
      arithmetic("add", 11, -6),
      arithmetic("subtract", -5, -3),
    ],
    standard: [
      arithmetic("multiply", -6, 4),
      arithmetic("multiply", -5, -7),
      arithmetic("divide", -24, 4),
      arithmetic("divide", -32, -4),
      arithmetic("multiply", 9, -4),
      arithmetic("multiply", -3, -6),
      arithmetic("divide", 35, -7),
      arithmetic("divide", -42, -7),
    ],
  },
  expressions: {
    foundation: [
      expression(2, 3, 5),
      expression(3, 4, 6),
      expression(4, 2, -5),
      expression(5, 3, 2),
      expression(2, 6, -4),
      expression(3, 5, 4),
      expression(4, 3, -2),
      expression(2, 4, 7),
    ],
    standard: [
      expression(3, -4, 1),
      expression(-2, -5, 4),
      expression(4, -3, -7),
      expression(-3, -6, 2),
      expression(5, -2, 2),
      expression(-4, -3, 5),
      expression(3, -5, -7),
      expression(-2, -4, 5),
    ],
  },
  equations: {
    foundation: [
      equation(2, 3, 11),
      equation(3, 2, 11),
      equation(2, -4, 6),
      equation(4, 5, 13),
      equation(3, -7, 11),
      equation(2, 1, 15),
      equation(2, -5, 11),
      equation(5, 4, 9),
    ],
    standard: [
      equation(-3, 2, 14),
      equation(4, -7, 13),
      equation(5, 6, -9),
      equation(-2, 3, -9),
      equation(-4, -5, 3),
      equation(3, -8, 13),
      equation(2, -3, -13),
      equation(-5, 6, -14),
    ],
  },
};

export const topics = topicCatalog();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseRequest(value: unknown): WorkbookRequest {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 3 ||
    !Object.keys(value).every((key) => ["topicId", "level", "count"].includes(key))
  )
    throw new InvalidInputError();
  const { topicId, level, count } = value;
  if (
    !topics.some((topic) => topic.id === topicId) ||
    (level !== "foundation" && level !== "standard") ||
    (count !== 4 && count !== 6 && count !== 8)
  )
    throw new InvalidInputError();
  return { topicId: topicId as TopicId, level, count };
}

export function createWorkbook(value: unknown): Workbook {
  const request = parseRequest(value);
  const topic = topics.find((candidate) => candidate.id === request.topicId);
  if (!topic) throw new InvalidInputError();
  const models = fixtures[request.topicId][request.level].slice(0, request.count);
  const items: WorkbookItem[] = models.map((model, index) => ({
    id: `q-${index + 1}`,
    prompt: promptFor(model),
    instruction:
      model.kind === "equation"
        ? "x の値を整数で答えましょう。"
        : model.kind === "expression"
          ? "式の値を整数で答えましょう。"
          : "計算の答えを整数で書きましょう。",
  }));
  // Explicit field order and bounded fixtures make this local identity stable;
  // this is not a production instance manifest or RFC 8785 domain hash.
  const instanceHash = createHash("sha256")
    .update(
      JSON.stringify({
        version: FIXTURE_VERSION,
        request,
        topic,
        models,
        items,
        key: models.map((model) => ({
          answer: answerFor(model),
          steps: explainFixture(model),
        })),
      }),
    )
    .digest("hex");
  return {
    ...request,
    schemaVersion: "studio-workbook-v1",
    saved: false,
    id: `draft-${instanceHash}`,
    instanceHash,
    title: topic.title,
    levelLabel: request.level === "foundation" ? "基礎を固める" : "標準に挑戦",
    minutes: request.count * 2,
    reason:
      "選んだ単元・難しさ・問題数に合わせた練習セットです。学習履歴による自動調整はしていません。",
    lesson: structuredClone(topic.lesson),
    items,
  };
}

export function restoreWorkbook(id: string): Workbook | undefined {
  if (!/^draft-[a-f0-9]{64}$/.test(id)) return undefined;
  // Exactly 18 candidates, with no retained answers or unbounded request cache.
  for (const topic of topics) {
    for (const level of ["foundation", "standard"] as const) {
      for (const count of [4, 6, 8] as const) {
        const workbook = createWorkbook({ topicId: topic.id, level, count });
        if (workbook.id === id) return workbook;
      }
    }
  }
  return undefined;
}

export function getFixtureModels(workbook: Workbook): readonly FixtureModel[] {
  const expected = createWorkbook({
    topicId: workbook.topicId,
    level: workbook.level,
    count: workbook.count,
  });
  if (JSON.stringify(expected) !== JSON.stringify(workbook))
    throw new InvalidInputError("問題集の内容を確認できませんでした。");
  return structuredClone(
    fixtures[workbook.topicId][workbook.level].slice(0, workbook.count),
  );
}

export function getAnswerKey(workbook: Workbook): readonly GradeItem[] {
  return getFixtureModels(workbook).map((model, index) => ({
    id: `q-${index + 1}`,
    status: "unanswered",
    submitted: "",
    answer: String(answerFor(model)),
    steps: explainFixture(model),
  }));
}

export function parseIntegerAnswer(
  value: string,
  allowEquation: boolean,
): number | undefined {
  if (value.length > 64) return undefined;
  let normalized = value.normalize("NFKC").replaceAll("−", "-").trim();
  if (allowEquation) normalized = normalized.replace(/^x\s*=\s*/i, "");
  if (!/^[+-]?\d{1,9}$/.test(normalized)) return undefined;
  const answer = Number(normalized);
  return Number.isSafeInteger(answer) ? answer : undefined;
}

export function gradeWorkbook(workbook: Workbook, value: unknown): GradeResult {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !isRecord(value.answers))
    throw new InvalidInputError();
  const submissions = value.answers;
  const allowedIds = new Set(workbook.items.map((item) => item.id));
  if (
    !Object.entries(submissions).every(
      ([id, submitted]) =>
        allowedIds.has(id) && typeof submitted === "string" && submitted.length <= 64,
    )
  )
    throw new InvalidInputError();
  const items: GradeItem[] = getAnswerKey(workbook).map((item) => {
    const submitted = (submissions[item.id] as string | undefined) ?? "";
    const parsed = parseIntegerAnswer(submitted, workbook.topicId === "equations");
    const status =
      submitted.trim() === ""
        ? "unanswered"
        : parsed === undefined
          ? "invalid"
          : parsed === Number(item.answer)
            ? "correct"
            : "incorrect";
    return { ...item, submitted, status };
  });
  return {
    workbookId: workbook.id,
    correctCount: items.filter((item) => item.status === "correct").length,
    total: workbook.count,
    items,
  };
}
