import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalizeJson } from "@exercisebook/domain";
import {
  generateWorkbook,
  verifyGeneratedWorkbook,
  type GeneratedWorkbookSnapshot,
} from "../domain/generator";
import {
  compiledLessonSources,
  compiledStandardLessonSources,
} from "../server/compiled-lessons";
import { levelLessonCatalog } from "../server/level-lessons";
import { topics } from "../server/model";
import { renderPdf } from "../server/pdf";
import { projectPrintDocument } from "../server/print";
import type { Level, TopicId } from "../src/contracts";

// This is a local build-time gate. It writes no cloud state and renders exactly
// six selected semantic snapshots, rather than regenerating during projection.
const output = resolve("output/studio-generated-pdf");
const candidateCount = 256;
const sourceRevision = "generated-pdf-verification@1";
const sources = [
  "apps/studio/domain/generator.ts",
  "apps/studio/domain/math-model.ts",
  "apps/studio/server/compiled-lessons.ts",
  "apps/studio/server/compiled-lessons.json",
  "apps/studio/server/level-lessons.ts",
  "apps/studio/server/print.ts",
  "apps/studio/scripts/render-pdf.py",
  "apps/studio/assets/fonts/noto-sans-jp/metadata.json",
];

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function sourceHashes(): Promise<Record<string, string>> {
  return Object.fromEntries(
    await Promise.all(
      sources.map(async (path) => [path, sha256(await readFile(path))]),
    ),
  );
}

function independentAnswer(
  model: GeneratedWorkbookSnapshot["manifest"]["slots"][number]["model"],
): number {
  if (model.kind === "equation")
    return (model.right - model.constant) / model.coefficient;
  if (model.kind === "expression")
    return model.coefficient * model.value + model.constant;
  if (model.operation === "add") return model.left + model.right;
  if (model.operation === "subtract") return model.left - model.right;
  if (model.operation === "multiply") return model.left * model.right;
  return model.left / model.right;
}

function checkSnapshot(snapshot: GeneratedWorkbookSnapshot): void {
  const { workbook, answers, manifest } = snapshot;
  assert.equal(workbook.items.length, 8);
  assert.equal(new Set(workbook.items.map((item) => item.prompt)).size, 8);
  const lessonSources =
    workbook.level === "standard"
      ? compiledStandardLessonSources
      : compiledLessonSources;
  const lessonSource = lessonSources.find(
    (source) => source.topic.id === workbook.topicId,
  );
  assert.ok(lessonSource, "The selected level must have a reviewed example model.");
  const exampleAnswer = independentAnswer(lessonSource.exampleModel);
  const selectedTopic = levelLessonCatalog(topics, workbook.level).find(
    (topic) => topic.id === workbook.topicId,
  );
  assert.deepEqual(workbook.lesson, selectedTopic?.lesson);
  for (const [index, slot] of manifest.slots.entries()) {
    // Integer answers identify 0 and IEEE-754 -0 as the same mathematical value.
    assert.ok(Number(answers[index]!.answer) === independentAnswer(slot.model));
    assert.notEqual(Number(answers[index]!.answer), exampleAnswer);
    assert.notEqual(workbook.items[index]!.prompt, workbook.lesson.example);
    assert.ok(Number.isSafeInteger(Number(answers[index]!.answer)));
  }
  const student = projectPrintDocument(workbook, answers, "student");
  assert.deepEqual(student.items, workbook.items);
  assert.ok(student.items.every((item) => !Object.hasOwn(item, "answer")));
  assert.ok(
    !/"baseSeed"|"subseed"|"submitted"|"status"|"manifest"/.test(
      JSON.stringify(student),
    ),
  );
}

function coverage(snapshot: GeneratedWorkbookSnapshot) {
  const values = snapshot.answers.map((answer) => Number(answer.answer));
  const numbers = snapshot.manifest.slots.flatMap((slot) =>
    Object.values(slot.model).filter(
      (value): value is number => typeof value === "number",
    ),
  );
  return {
    zero: values.includes(0),
    negativeAnswers: values.filter((value) => value < 0).length,
    maxAbsoluteAnswer: Math.max(...values.map(Math.abs)),
    maxAbsoluteModelValue: Math.max(...numbers.map(Math.abs)),
    maxPromptLength: Math.max(
      ...snapshot.workbook.items.map((item) => item.prompt.length),
    ),
    maxStepMathLength: Math.max(
      ...snapshot.answers.flatMap((answer) =>
        answer.steps.map((step) => step.math.length),
      ),
    ),
    maxExplanationLength: Math.max(
      ...snapshot.answers.map(
        (answer) => answer.steps.map((step) => step.reason).join("").length,
      ),
    ),
  };
}

async function selectSnapshot(topicId: TopicId, level: Level) {
  const candidates = [];
  for (let value = 0; value < candidateCount; value += 1) {
    const snapshot = await generateWorkbook(
      { topicId, level, count: 8 },
      value.toString(16).padStart(64, "0"),
      levelLessonCatalog(topics, level),
      sourceRevision,
    );
    checkSnapshot(snapshot);
    const metrics = coverage(snapshot);
    // Exercise zero where supported, then favor long explanations, wide
    // mathematical strings, large values and mixed signs. Ties keep first seed.
    const score =
      Number(metrics.zero) * 1_000_000 +
      metrics.maxExplanationLength * 1_000 +
      metrics.maxStepMathLength * 100 +
      metrics.maxPromptLength * 10 +
      metrics.maxAbsoluteModelValue +
      metrics.negativeAnswers;
    candidates.push({ snapshot, metrics, score });
  }
  candidates.sort((left, right) => right.score - left.score);
  const selected = candidates[0]!;
  assert.equal(await verifyGeneratedWorkbook(selected.snapshot), true);
  assert.deepEqual(
    await generateWorkbook(
      { topicId, level, count: 8 },
      selected.snapshot.manifest.baseSeed,
      levelLessonCatalog(topics, level),
      sourceRevision,
    ),
    selected.snapshot,
  );
  return {
    ...selected,
    pool: {
      seeds: candidateCount,
      hasZero: candidates.some((candidate) => candidate.metrics.zero),
      maxAbsoluteAnswer: Math.max(
        ...candidates.map((candidate) => candidate.metrics.maxAbsoluteAnswer),
      ),
      maxAbsoluteModelValue: Math.max(
        ...candidates.map((candidate) => candidate.metrics.maxAbsoluteModelValue),
      ),
      maxPromptLength: Math.max(
        ...candidates.map((candidate) => candidate.metrics.maxPromptLength),
      ),
      maxStepMathLength: Math.max(
        ...candidates.map((candidate) => candidate.metrics.maxStepMathLength),
      ),
      maxExplanationLength: Math.max(
        ...candidates.map((candidate) => candidate.metrics.maxExplanationLength),
      ),
    },
  };
}

async function main(): Promise<void> {
  const before = await sourceHashes();
  await mkdir(resolve(output, "public/artifacts"), { recursive: true });
  const workbooks = [];
  for (const topic of topics) {
    for (const level of ["foundation", "standard"] as const) {
      const selected = await selectSnapshot(topic.id, level);
      const { snapshot, metrics, pool } = selected;
      const pdfs: Record<
        string,
        { path: string; sha256: string; bytes: number; printDocumentHash: string }
      > = {};
      await Promise.all(
        (["student", "answers"] as const).map(async (variant) => {
          const bytes = await renderPdf(snapshot.workbook, snapshot.answers, variant);
          const hash = sha256(bytes);
          const path = `/artifacts/${hash}.pdf`;
          await writeFile(resolve(output, "public", path.slice(1)), bytes);
          pdfs[variant] = {
            path,
            sha256: hash,
            bytes: bytes.byteLength,
            printDocumentHash: sha256(
              canonicalizeJson(
                projectPrintDocument(snapshot.workbook, snapshot.answers, variant),
              ),
            ),
          };
        }),
      );
      workbooks.push({
        ...snapshot,
        selectedCoverage: metrics,
        candidatePool: pool,
        pdfs,
      });
      console.log(
        JSON.stringify({
          topic: topic.id,
          level,
          seed: snapshot.manifest.baseSeed,
          selectedCoverage: metrics,
          pdfs: Object.values(pdfs).map((pdf) => pdf.bytes),
        }),
      );
    }
  }
  assert.deepEqual(
    await sourceHashes(),
    before,
    "Generator or renderer source changed during verification; rerun the gate.",
  );
  await writeFile(
    resolve(output, "catalog.json"),
    `${JSON.stringify({ schemaVersion: "studio-generated-pdf-verification-v1", sourceHashes: before, generatorCases: candidateCount * 6, workbooks }, null, 2)}\n`,
  );
  console.log(
    `Rendered 12 PDFs after independently checking ${candidateCount * 6} deterministic eight-item sets.`,
  );
}

await main();
