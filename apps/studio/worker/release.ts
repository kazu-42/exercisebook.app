import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import type { ReleaseCatalog } from "../server/release-contract";
import { computeWorkbookHash } from "../server/release-contract";

const HASH = /^[a-f0-9]{64}$/;
const TOPICS = ["signed-numbers", "expressions", "equations"];
const ASSET_PATH = /^\/assets\/[a-zA-Z0-9_-]+-[a-zA-Z0-9_-]{8,}\.(?:js|css)$/;

function check(condition: unknown): asserts condition {
  if (!condition) throw new TypeError("Invalid studio release");
}

function record(
  value: unknown,
  keys: readonly string[],
): asserts value is Record<string, unknown> {
  check(value !== null && typeof value === "object" && !Array.isArray(value));
  check(
    Object.keys(value).length === keys.length &&
      Object.keys(value).every((key) => keys.includes(key)),
  );
}

function text(value: unknown, maximum = 1200): asserts value is string {
  check(typeof value === "string" && value.length > 0 && value.length <= maximum);
}

function hash(value: unknown): asserts value is string {
  check(typeof value === "string" && HASH.test(value));
}

function steps(value: unknown): void {
  check(Array.isArray(value) && value.length >= 1 && value.length <= 8);
  for (const step of value) {
    record(step, ["relation", "math", "reason"]);
    check(
      [
        "expression-equality",
        "equivalent-equation",
        "substitution",
        "verification",
      ].includes(String(step.relation)),
    );
    text(step.math);
    text(step.reason);
  }
}

function lesson(value: unknown): void {
  record(value, ["title", "rule", "example", "steps"]);
  text(value.title);
  text(value.rule);
  text(value.example);
  steps(value.steps);
}

function artifact(value: unknown): void {
  record(value, ["path", "sha256", "bytes"]);
  hash(value.sha256);
  check(value.path === `/artifacts/${value.sha256}.pdf`);
  check(
    Number.isSafeInteger(value.bytes) &&
      Number(value.bytes) > 8 &&
      Number(value.bytes) <= 5 * 1024 * 1024,
  );
}

export async function validateReleaseCatalog(input: unknown): Promise<ReleaseCatalog> {
  // Clone canonical JSON: a caller cannot mutate the checked catalog afterward.
  const value: unknown = JSON.parse(canonicalizeJson(input));
  record(value, [
    "schemaVersion",
    "releaseId",
    "sourceRevision",
    "topics",
    "workbooks",
    "assets",
  ]);
  check(value.schemaVersion === "studio-release-v1");
  check(
    typeof value.releaseId === "string" &&
      /^studio-rc-[a-f0-9]{64}$/.test(value.releaseId),
  );
  text(value.sourceRevision, 200);
  const { releaseId, ...identity } = value;
  check(releaseId === `studio-rc-${await sha256Hex(canonicalizeJson(identity))}`);
  check(Array.isArray(value.topics) && value.topics.length === 3);
  const topicIds = new Set<string>();
  for (const topic of value.topics) {
    record(topic, [
      "id",
      "number",
      "title",
      "subtitle",
      "description",
      "prerequisite",
      "sample",
      "lesson",
    ]);
    check(
      typeof topic.id === "string" &&
        TOPICS.includes(topic.id) &&
        !topicIds.has(topic.id),
    );
    topicIds.add(topic.id);
    for (const key of [
      "number",
      "title",
      "subtitle",
      "description",
      "prerequisite",
      "sample",
    ])
      text(topic[key]);
    lesson(topic.lesson);
  }

  check(Array.isArray(value.workbooks) && value.workbooks.length === 18);
  const selections = new Set<string>();
  const ids = new Set<string>();
  const pdfPaths = new Set<string>();
  for (const entry of value.workbooks) {
    record(entry, ["workbook", "answers", "contentSourceHashes", "pdfs"]);
    const workbook = entry.workbook;
    record(workbook, [
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
    check(workbook.schemaVersion === "studio-workbook-v1" && workbook.saved === false);
    check(typeof workbook.topicId === "string" && topicIds.has(workbook.topicId));
    check(workbook.level === "foundation" || workbook.level === "standard");
    check(workbook.count === 4 || workbook.count === 6 || workbook.count === 8);
    hash(workbook.instanceHash);
    check(
      workbook.id === `studio-${workbook.instanceHash}` &&
        !ids.has(String(workbook.id)),
    );
    ids.add(String(workbook.id));
    const selection = `${workbook.topicId}/${workbook.level}/${workbook.count}`;
    check(!selections.has(selection));
    selections.add(selection);
    for (const key of ["title", "levelLabel", "reason"]) text(workbook[key]);
    check(workbook.minutes === workbook.count * 2);
    lesson(workbook.lesson);
    const topic = value.topics.find((candidate) => candidate.id === workbook.topicId);
    check(
      topic &&
        workbook.title === topic.title &&
        canonicalizeJson(workbook.lesson) === canonicalizeJson(topic.lesson),
    );
    check(Array.isArray(workbook.items) && workbook.items.length === workbook.count);
    for (const [index, item] of workbook.items.entries()) {
      record(item, ["id", "prompt", "instruction"]);
      check(item.id === `q-${index + 1}`);
      text(item.prompt);
      text(item.instruction);
    }
    check(Array.isArray(entry.answers) && entry.answers.length === workbook.count);
    for (const [index, answer] of entry.answers.entries()) {
      record(answer, ["id", "status", "submitted", "answer", "steps"]);
      check(
        answer.id === `q-${index + 1}` &&
          answer.status === "unanswered" &&
          answer.submitted === "",
      );
      check(
        typeof answer.answer === "string" &&
          /^-?(?:0|[1-9]\d{0,8})$/.test(answer.answer),
      );
      steps(answer.steps);
    }
    check(
      Array.isArray(entry.contentSourceHashes) &&
        entry.contentSourceHashes.length > 0 &&
        entry.contentSourceHashes.length <= 32,
    );
    for (const sourceHash of entry.contentSourceHashes) hash(sourceHash);
    check(new Set(entry.contentSourceHashes).size === entry.contentSourceHashes.length);
    check(
      canonicalizeJson(entry.contentSourceHashes) ===
        canonicalizeJson([...entry.contentSourceHashes].sort()),
    );
    const { id: _id, instanceHash, ...semanticWorkbook } = workbook;
    const typedEntry = entry as unknown as ReleaseCatalog["workbooks"][number];
    check(
      instanceHash ===
        (await computeWorkbookHash(
          semanticWorkbook as Omit<typeof typedEntry.workbook, "id" | "instanceHash">,
          typedEntry.answers,
          typedEntry.contentSourceHashes,
        )),
    );
    record(entry.pdfs, ["student", "answers"]);
    for (const pdf of [entry.pdfs.student, entry.pdfs.answers]) {
      artifact(pdf);
      const path = (pdf as { path: string }).path;
      check(!pdfPaths.has(path));
      pdfPaths.add(path);
    }
  }

  check(
    Array.isArray(value.assets) &&
      value.assets.length >= 3 &&
      value.assets.length <= 24,
  );
  const assetPaths = new Set<string>();
  for (const asset of value.assets) {
    record(asset, ["path", "sha256", "bytes", "contentType"]);
    check(
      typeof asset.path === "string" &&
        (asset.path === "/index.html" || ASSET_PATH.test(asset.path)) &&
        !assetPaths.has(asset.path),
    );
    assetPaths.add(asset.path);
    hash(asset.sha256);
    check(
      Number.isSafeInteger(asset.bytes) &&
        Number(asset.bytes) > 0 &&
        Number(asset.bytes) <= 2 * 1024 * 1024,
    );
    check(
      asset.contentType ===
        (asset.path === "/index.html"
          ? "text/html"
          : asset.path.endsWith(".js")
            ? "text/javascript"
            : "text/css"),
    );
  }
  check(
    assetPaths.has("/index.html") &&
      [...assetPaths].some((path) => path.endsWith(".js")) &&
      [...assetPaths].some((path) => path.endsWith(".css")),
  );
  return value as unknown as ReleaseCatalog;
}
