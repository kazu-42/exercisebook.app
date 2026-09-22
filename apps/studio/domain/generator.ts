import {
  canonicalizeJson,
  createXoshiro128ss,
  DeterministicRandomExhaustedError,
  deriveSlotSeed,
  sha256Hex,
  validateSeed256,
  XOSHIRO128SS_V1,
  type DeterministicRandom,
} from "@exercisebook/domain";
import type {
  GradeItem,
  Level,
  Topic,
  TopicId,
  Workbook,
  WorkbookRequest,
} from "../src/contracts";
import { answerFor, explainFixture, promptFor, type FixtureModel } from "./math-model";

export const STUDIO_GENERATOR_ID = "japanese-integer-workbook";
export const STUDIO_GENERATOR_VERSION = "1.0.0";
export const MAXIMUM_GENERATION_ATTEMPTS = 16;
const MAXIMUM_FALLBACK_CANDIDATES = 64;
const SNAPSHOT_SCHEMA = "exercisebook.generated-studio-workbook/v1";
const MAXIMUM_SNAPSHOT_BYTES = 131_072;

export interface GeneratedSlot {
  readonly slotId: string;
  readonly subseed: string;
  readonly family: string;
  readonly model: FixtureModel;
  readonly attempts: number;
  readonly fallback: boolean;
}

export interface GenerationManifest {
  readonly generatorId: typeof STUDIO_GENERATOR_ID;
  readonly generatorVersion: typeof STUDIO_GENERATOR_VERSION;
  readonly rngAlgorithm: typeof XOSHIRO128SS_V1;
  readonly rngVersion: 1;
  readonly baseSeed: string;
  readonly maximumAttempts: typeof MAXIMUM_GENERATION_ATTEMPTS;
  readonly slots: readonly GeneratedSlot[];
}

// Persist the entire snapshot server-side. Only `workbook` is a student DTO;
// the manifest and detached answer key must never enter a student response.
export interface GeneratedWorkbookSnapshot {
  readonly schemaVersion: typeof SNAPSHOT_SCHEMA;
  readonly sourceRevision: string;
  readonly workbook: Workbook;
  readonly answers: readonly GradeItem[];
  readonly manifest: GenerationManifest;
}

function familyFor(topicId: TopicId, level: Level, index: number): string {
  const alternate = index % 2 === 1;
  if (topicId === "signed-numbers")
    return level === "foundation"
      ? alternate
        ? "integer-subtraction"
        : "integer-addition"
      : alternate
        ? "integer-division"
        : "integer-multiplication";
  if (level === "foundation")
    return `${topicId}-${alternate ? "subtract" : "add"}-constant`;
  return `${topicId}-${alternate ? "positive" : "negative"}-coefficient`;
}

function nonzero(random: DeterministicRandom, maximum: number): number {
  const magnitude = random.nextInt(1, maximum + 1);
  return random.nextInt(0, 2) === 0 ? -magnitude : magnitude;
}

function candidate(
  topicId: TopicId,
  level: Level,
  index: number,
  random: DeterministicRandom,
): FixtureModel {
  const alternate = index % 2 === 1;
  if (topicId === "signed-numbers") {
    if (level === "foundation")
      return {
        kind: "arithmetic",
        operation: alternate ? "subtract" : "add",
        left: nonzero(random, 20),
        right: nonzero(random, 20),
      };
    const left = nonzero(random, 9);
    const right = nonzero(random, 9);
    return {
      kind: "arithmetic",
      operation: alternate ? "divide" : "multiply",
      left: alternate ? left * right : left,
      right,
    };
  }
  const coefficient =
    random.nextInt(2, 10) * (level === "standard" && !alternate ? -1 : 1);
  const constant =
    level === "foundation"
      ? random.nextInt(1, 13) * (alternate ? -1 : 1)
      : nonzero(random, 12);
  if (topicId === "expressions")
    return {
      kind: "expression",
      coefficient,
      value: random.nextInt(1, 10) * (level === "standard" ? -1 : 1),
      constant,
    };
  const solution =
    level === "foundation" ? random.nextInt(1, 10) : random.nextInt(-9, 10);
  return {
    kind: "equation",
    coefficient,
    constant,
    right: coefficient * solution + constant,
  };
}

function fallbackCandidate(
  topicId: TopicId,
  level: Level,
  index: number,
  ordinal: number,
): FixtureModel {
  const alternate = index % 2 === 1;
  // Eight answers cycle within each coefficient/constant group. There are
  // at most seven used prompts and one excluded example answer, so this
  // bounded catalog always retains a candidate for every supported slot.
  const value = (ordinal % 8) + 1;
  const group = Math.floor(ordinal / 8) + 2;
  if (topicId === "signed-numbers") {
    if (level === "foundation")
      return {
        kind: "arithmetic",
        operation: alternate ? "subtract" : "add",
        left: value,
        right: -group,
      };
    return {
      kind: "arithmetic",
      operation: alternate ? "divide" : "multiply",
      left: alternate ? -value * group : -value,
      right: group,
    };
  }
  const coefficient = group * (level === "standard" && !alternate ? -1 : 1);
  const constant = (alternate ? -1 : 1) * group;
  if (topicId === "expressions")
    return {
      kind: "expression",
      coefficient,
      value: level === "standard" ? -value : value,
      constant,
    };
  const solution = level === "standard" && !alternate ? -value : value;
  return {
    kind: "equation",
    coefficient,
    constant,
    right: coefficient * solution + constant,
  };
}

export function selectGeneratedModel(input: {
  topicId: TopicId;
  level: Level;
  index: number;
  random: DeterministicRandom;
  usedPrompts: ReadonlySet<string>;
  excludedPrompt: string;
  excludedAnswer: number;
}): { model: FixtureModel; attempts: number; fallback: boolean } {
  if (
    !Number.isInteger(input.index) ||
    input.index < 0 ||
    input.index > 7 ||
    input.usedPrompts.size > 7
  )
    throw new TypeError("Generation slots and prior prompts must remain bounded.");
  const accepts = (model: FixtureModel) => {
    const prompt = promptFor(model);
    return (
      !input.usedPrompts.has(prompt) &&
      prompt !== input.excludedPrompt &&
      answerFor(model) !== input.excludedAnswer
    );
  };
  let attempts = 0;
  for (let attempt = 1; attempt <= MAXIMUM_GENERATION_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    try {
      const model = candidate(input.topicId, input.level, input.index, input.random);
      if (accepts(model)) return { model, attempts: attempt, fallback: false };
    } catch (error) {
      // The versioned RNG itself caps unbiased integer rejection at 128.
      // Its explicit exhaustion is a deterministic event, not infrastructure
      // failure. Unknown errors must still fail loudly.
      if (!(error instanceof DeterministicRandomExhaustedError)) throw error;
      break;
    }
  }
  for (let ordinal = 0; ordinal < MAXIMUM_FALLBACK_CANDIDATES; ordinal += 1) {
    const model = fallbackCandidate(input.topicId, input.level, input.index, ordinal);
    if (accepts(model)) return { model, attempts, fallback: true };
  }
  throw new Error("No valid integer workbook fallback candidate remains.");
}

function validatedRequest(value: WorkbookRequest): WorkbookRequest {
  const data = exactRecord(value, ["topicId", "level", "count"]);
  if (
    !["signed-numbers", "expressions", "equations"].includes(String(data.topicId)) ||
    (data.level !== "foundation" && data.level !== "standard") ||
    (data.count !== 4 && data.count !== 6 && data.count !== 8)
  )
    throw new TypeError("Unsupported integer workbook request.");
  return { topicId: data.topicId as TopicId, level: data.level, count: data.count };
}

function exampleAnswer(topic: Topic): number {
  const step =
    topic.id === "equations"
      ? topic.lesson.steps.findLast((item) => item.relation === "equivalent-equation")
      : topic.lesson.steps.at(-1);
  const match = step && / = (−?\d+)$/.exec(step.math);
  if (!match) throw new TypeError("Reviewed example has no bounded integer result.");
  const answer = Number(match[1]!.replace("−", "-"));
  if (!Number.isSafeInteger(answer) || Math.abs(answer) > 1_000)
    throw new TypeError("Reviewed example result is out of range.");
  return answer;
}

export async function generateWorkbook(
  request: WorkbookRequest,
  baseSeed: string,
  topics: readonly Topic[],
  sourceRevision: string,
): Promise<GeneratedWorkbookSnapshot> {
  const selection = validatedRequest(request);
  validateSeed256(baseSeed);
  if (
    typeof sourceRevision !== "string" ||
    !/^[A-Za-z0-9._@:/+-]{1,160}$/.test(sourceRevision)
  )
    throw new TypeError("A stable bounded source revision is required.");
  // Capture all caller-owned content before the first asynchronous hash.
  const matchingTopics = topics.filter((item) => item.id === selection.topicId);
  if (matchingTopics.length !== 1)
    throw new TypeError("Unknown or ambiguous reviewed topic.");
  const topic = structuredClone(matchingTopics[0]!);
  const excludedAnswer = exampleAnswer(topic);
  const usedPrompts = new Set<string>();
  const slots: GeneratedSlot[] = [];
  for (let index = 0; index < selection.count; index += 1) {
    const slotId = `${selection.topicId}/${selection.level}/q-${index + 1}`;
    const subseed = await deriveSlotSeed({
      baseSeed,
      generatorId: STUDIO_GENERATOR_ID,
      generatorVersion: STUDIO_GENERATOR_VERSION,
      slotId,
    });
    const selected = selectGeneratedModel({
      ...selection,
      index,
      random: createXoshiro128ss(subseed),
      usedPrompts,
      excludedPrompt: topic.lesson.example,
      excludedAnswer,
    });
    usedPrompts.add(promptFor(selected.model));
    slots.push({
      slotId,
      subseed,
      family: familyFor(selection.topicId, selection.level, index),
      ...selected,
    });
  }
  const answers: GradeItem[] = slots.map(({ model }, index) => ({
    id: `q-${index + 1}`,
    status: "unanswered",
    submitted: "",
    answer: String(answerFor(model)),
    steps: explainFixture(model),
  }));
  const workbook: Workbook = {
    ...selection,
    schemaVersion: "studio-workbook-v1",
    saved: false,
    id: "",
    instanceHash: "",
    title: topic.title,
    levelLabel: selection.level === "foundation" ? "基礎を固める" : "標準に挑戦",
    minutes: selection.count * 2,
    reason:
      "選んだ単元・難しさ・問題数に合わせた練習セットです。学習履歴による自動調整はしていません。",
    lesson: topic.lesson,
    items: slots.map(({ model }, index) => ({
      id: `q-${index + 1}`,
      prompt: promptFor(model),
      instruction:
        model.kind === "equation"
          ? "x の値を整数で答えましょう。"
          : model.kind === "expression"
            ? "式の値を整数で答えましょう。"
            : "計算の答えを整数で書きましょう。",
    })),
  };
  const snapshot: GeneratedWorkbookSnapshot = {
    schemaVersion: SNAPSHOT_SCHEMA,
    sourceRevision,
    workbook,
    answers,
    manifest: {
      generatorId: STUDIO_GENERATOR_ID,
      generatorVersion: STUDIO_GENERATOR_VERSION,
      rngAlgorithm: XOSHIRO128SS_V1,
      rngVersion: 1,
      baseSeed,
      maximumAttempts: MAXIMUM_GENERATION_ATTEMPTS,
      slots,
    },
  };
  const hash = await snapshotHash(snapshot);
  workbook.instanceHash = hash;
  workbook.id = `studio-${hash}`;
  return snapshot;
}

function snapshotHash(snapshot: GeneratedWorkbookSnapshot): Promise<string> {
  const { id: _id, instanceHash: _hash, ...content } = snapshot.workbook;
  return sha256Hex(canonicalizeJson({ ...snapshot, workbook: content }));
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Expected a plain object.");
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key)))
    throw new TypeError("Unexpected snapshot fields.");
  return record;
}

function text(value: unknown, maximum = 1_000): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum)
    throw new TypeError("Expected bounded text.");
}

function steps(value: unknown): void {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3)
    throw new TypeError("Invalid solution trace.");
  for (const step of value) {
    const record = exactRecord(step, ["relation", "math", "reason"]);
    if (
      ![
        "expression-equality",
        "equivalent-equation",
        "substitution",
        "verification",
      ].includes(String(record.relation))
    )
      throw new TypeError("Invalid mathematical relation.");
    text(record.math, 160);
    text(record.reason, 800);
  }
}

function validateSnapshot(value: unknown): asserts value is GeneratedWorkbookSnapshot {
  const snapshot = exactRecord(value, [
    "schemaVersion",
    "sourceRevision",
    "workbook",
    "answers",
    "manifest",
  ]);
  if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA)
    throw new TypeError("Invalid snapshot schema.");
  text(snapshot.sourceRevision, 160);
  if (!/^[A-Za-z0-9._@:/+-]{1,160}$/.test(snapshot.sourceRevision))
    throw new TypeError("Invalid source revision.");
  const workbook = exactRecord(snapshot.workbook, [
    "topicId",
    "level",
    "count",
    "schemaVersion",
    "saved",
    "id",
    "instanceHash",
    "title",
    "levelLabel",
    "minutes",
    "reason",
    "lesson",
    "items",
  ]);
  const request = validatedRequest({
    topicId: workbook.topicId as TopicId,
    level: workbook.level as Level,
    count: workbook.count as WorkbookRequest["count"],
  });
  if (
    workbook.schemaVersion !== "studio-workbook-v1" ||
    workbook.saved !== false ||
    workbook.minutes !== request.count * 2
  )
    throw new TypeError("Invalid public workbook metadata.");
  text(workbook.instanceHash, 64);
  if (
    !/^[a-f0-9]{64}$/.test(workbook.instanceHash) ||
    workbook.id !== `studio-${workbook.instanceHash}`
  )
    throw new TypeError("Invalid workbook identity.");
  for (const field of ["title", "levelLabel", "reason"] as const) text(workbook[field]);
  const lesson = exactRecord(workbook.lesson, ["title", "rule", "example", "steps"]);
  for (const field of ["title", "rule", "example"] as const) text(lesson[field]);
  steps(lesson.steps);
  if (
    !Array.isArray(workbook.items) ||
    workbook.items.length !== request.count ||
    !Array.isArray(snapshot.answers) ||
    snapshot.answers.length !== request.count
  )
    throw new TypeError("Invalid workbook item count.");
  const manifest = exactRecord(snapshot.manifest, [
    "generatorId",
    "generatorVersion",
    "rngAlgorithm",
    "rngVersion",
    "baseSeed",
    "maximumAttempts",
    "slots",
  ]);
  if (
    manifest.generatorId !== STUDIO_GENERATOR_ID ||
    manifest.generatorVersion !== STUDIO_GENERATOR_VERSION ||
    manifest.rngAlgorithm !== XOSHIRO128SS_V1 ||
    manifest.rngVersion !== 1 ||
    manifest.maximumAttempts !== MAXIMUM_GENERATION_ATTEMPTS
  )
    throw new TypeError("Unsupported generation manifest.");
  validateSeed256(manifest.baseSeed as string);
  if (!Array.isArray(manifest.slots) || manifest.slots.length !== request.count)
    throw new TypeError("Invalid generation slots.");
  const prompts = new Set<string>();
  for (let index = 0; index < request.count; index += 1) {
    const id = `q-${index + 1}`;
    const item = exactRecord(workbook.items[index], ["id", "prompt", "instruction"]);
    if (item.id !== id) throw new TypeError("Invalid item identity.");
    text(item.prompt, 160);
    text(item.instruction, 160);
    if (prompts.has(item.prompt) || item.prompt === lesson.example)
      throw new TypeError("Duplicate practice prompt.");
    prompts.add(item.prompt);
    const answer = exactRecord(snapshot.answers[index], [
      "id",
      "status",
      "submitted",
      "answer",
      "steps",
    ]);
    if (
      answer.id !== id ||
      answer.status !== "unanswered" ||
      answer.submitted !== "" ||
      typeof answer.answer !== "string" ||
      !/^-?(?:0|[1-9]\d{0,2})$/.test(answer.answer)
    )
      throw new TypeError("Invalid detached answer key.");
    steps(answer.steps);
    const slot = exactRecord(manifest.slots[index], [
      "slotId",
      "subseed",
      "family",
      "model",
      "attempts",
      "fallback",
    ]);
    if (
      slot.slotId !== `${request.topicId}/${request.level}/${id}` ||
      slot.family !== familyFor(request.topicId, request.level, index) ||
      typeof slot.attempts !== "number" ||
      !Number.isInteger(slot.attempts) ||
      slot.attempts < 1 ||
      slot.attempts > MAXIMUM_GENERATION_ATTEMPTS ||
      typeof slot.fallback !== "boolean"
    )
      throw new TypeError("Invalid slot provenance.");
    validateSeed256(slot.subseed as string);
    const model = slot.model;
    if (model === null || typeof model !== "object" || !("kind" in model))
      throw new TypeError("Missing semantic model.");
    const fields =
      model.kind === "arithmetic"
        ? ["kind", "operation", "left", "right"]
        : model.kind === "expression"
          ? ["kind", "coefficient", "value", "constant"]
          : model.kind === "equation"
            ? ["kind", "coefficient", "constant", "right"]
            : [];
    if (fields.length === 0) throw new TypeError("Unknown semantic model.");
    const parsed = exactRecord(model, fields);
    for (const field of fields.filter(
      (name) => name !== "kind" && name !== "operation",
    )) {
      const number = parsed[field];
      if (
        typeof number !== "number" ||
        !Number.isSafeInteger(number) ||
        Math.abs(number) > 100
      )
        throw new TypeError("Semantic number is outside the publication bounds.");
    }
    if (request.topicId === "signed-numbers") {
      const operation =
        request.level === "foundation"
          ? index % 2 === 0
            ? "add"
            : "subtract"
          : index % 2 === 0
            ? "multiply"
            : "divide";
      if (parsed.kind !== "arithmetic" || parsed.operation !== operation)
        throw new TypeError("Semantic arithmetic family mismatch.");
      const left = parsed.left as number;
      const right = parsed.right as number;
      const maximumLeft =
        request.level === "foundation" ? 20 : operation === "divide" ? 81 : 9;
      if (
        left === 0 ||
        right === 0 ||
        Math.abs(left) > maximumLeft ||
        Math.abs(right) > (request.level === "foundation" ? 20 : 9) ||
        (operation === "divide" && left % right !== 0)
      )
        throw new TypeError("Semantic arithmetic constraints failed.");
    } else {
      const expectedKind =
        request.topicId === "expressions" ? "expression" : "equation";
      const coefficient = parsed.coefficient as number;
      const constant = parsed.constant as number;
      const coefficientSign = request.level === "standard" && index % 2 === 0 ? -1 : 1;
      if (
        parsed.kind !== expectedKind ||
        coefficient * coefficientSign < 2 ||
        coefficient * coefficientSign > 9 ||
        constant === 0 ||
        Math.abs(constant) > 12 ||
        (request.level === "foundation" &&
          Math.sign(constant) !== (index % 2 === 0 ? 1 : -1))
      )
        throw new TypeError("Semantic affine family mismatch.");
      if (expectedKind === "expression") {
        const value = parsed.value as number;
        if (
          value === 0 ||
          Math.abs(value) > 9 ||
          Math.sign(value) !== (request.level === "foundation" ? 1 : -1)
        )
          throw new TypeError("Semantic substitution constraints failed.");
      } else {
        const numerator = (parsed.right as number) - constant;
        if (
          numerator % coefficient !== 0 ||
          Math.abs(numerator) > Math.abs(coefficient) * 9 ||
          (request.level === "foundation" && numerator / coefficient < 1)
        )
          throw new TypeError("Semantic equation constraints failed.");
      }
    }
  }
}

/** Verify the exact persisted snapshot; never regenerate or reinterpret it. */
export async function verifyGeneratedWorkbook(value: unknown): Promise<boolean> {
  try {
    const canonical = canonicalizeJson(value);
    if (new TextEncoder().encode(canonical).byteLength > MAXIMUM_SNAPSHOT_BYTES)
      return false;
    const snapshot: unknown = JSON.parse(canonical);
    validateSnapshot(snapshot);
    return (await snapshotHash(snapshot)) === snapshot.workbook.instanceHash;
  } catch {
    return false;
  }
}
