import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FRACTION_ADDITION_SAMPLE_INPUT,
  materializeFractionAdditionWorksheetFromContent,
} from "@exercisebook/generators";
import { WorksheetView, type WebWorksheet } from "@exercisebook/web-renderer";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  projectAnswerKeyWorksheetForWeb,
  projectStudentWorksheetForWeb,
} from "../src/worker/web-worksheet-projector.js";
import { SAMPLE_CONTENT_DOCUMENT } from "../src/worker/sample-content.js";
import { escapeHtmlTextAndAttribute } from "./html-escape.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const outputDirectory = resolve(repositoryRoot, "output/web-sample");

function serializePrettyJson(value: unknown): string {
  return `${JSON.stringify(value, undefined, 2)}\n`;
}

function renderHtml(
  worksheet: WebWorksheet,
  applicationStyles: string,
  rendererStyles: string,
): string {
  const title =
    worksheet.variant === "answer-key"
      ? `${worksheet.title} — answer key`
      : worksheet.title;
  const body = renderToStaticMarkup(
    createElement(WorksheetView, { printMode: true, worksheet }),
  );
  const escapedLocale = escapeHtmlTextAndAttribute(worksheet.locale);
  const escapedTitle = escapeHtmlTextAndAttribute(title);

  return `<!doctype html>
<html lang="${escapedLocale}">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light">
    <meta name="robots" content="noindex">
    <title>${escapedTitle}</title>
    <style>
${applicationStyles}
${rendererStyles}
    </style>
  </head>
  <body>
    <main class="page-frame">
${body}
    </main>
  </body>
</html>
`;
}

const materialized = await materializeFractionAdditionWorksheetFromContent(
  SAMPLE_CONTENT_DOCUMENT,
  {
    assignmentId: FRACTION_ADDITION_SAMPLE_INPUT.assignmentId,
    localStudyDate: FRACTION_ADDITION_SAMPLE_INPUT.localStudyDate,
    timeZone: FRACTION_ADDITION_SAMPLE_INPUT.timeZone,
    locale: FRACTION_ADDITION_SAMPLE_INPUT.locale,
    seed: FRACTION_ADDITION_SAMPLE_INPUT.seed,
    seedSecretVersion: FRACTION_ADDITION_SAMPLE_INPUT.seedSecretVersion,
    requestedItemCount: FRACTION_ADDITION_SAMPLE_INPUT.itemCount,
    plan: FRACTION_ADDITION_SAMPLE_INPUT.plan,
    policy: FRACTION_ADDITION_SAMPLE_INPUT.policy,
    skillGraph: FRACTION_ADDITION_SAMPLE_INPUT.skillGraph,
    selectionReasons: FRACTION_ADDITION_SAMPLE_INPUT.selectionReasons,
  },
);
const studentWorksheet = await projectStudentWorksheetForWeb(materialized);
const answerKeyWorksheet = await projectAnswerKeyWorksheetForWeb(materialized);

const [applicationStyles, rendererStyles] = await Promise.all([
  readFile(resolve(repositoryRoot, "apps/web/src/react-app/styles.css"), "utf8"),
  readFile(resolve(repositoryRoot, "packages/web-renderer/src/styles.css"), "utf8"),
]);

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  // Keep this byte-for-byte canonical: its SHA-256 is the instance hash.
  writeFile(
    resolve(outputDirectory, "worksheet-instance.json"),
    materialized.canonicalJson,
    "utf8",
  ),
  writeFile(
    resolve(outputDirectory, "web-student.json"),
    serializePrettyJson(studentWorksheet),
    "utf8",
  ),
  writeFile(
    resolve(outputDirectory, "web-answer-key.json"),
    serializePrettyJson(answerKeyWorksheet),
    "utf8",
  ),
  writeFile(
    resolve(outputDirectory, "web-student.html"),
    renderHtml(studentWorksheet, applicationStyles, rendererStyles),
    "utf8",
  ),
  writeFile(
    resolve(outputDirectory, "web-answer-key.html"),
    renderHtml(answerKeyWorksheet, applicationStyles, rendererStyles),
    "utf8",
  ),
  writeFile(
    resolve(outputDirectory, "manifest.json"),
    serializePrettyJson({
      schema: "exercisebook.web-sample-manifest.v1",
      instanceHash: materialized.instanceHash,
      artifacts: {
        canonicalInstance: "worksheet-instance.json",
        studentData: "web-student.json",
        answerKeyData: "web-answer-key.json",
        studentHtml: "web-student.html",
        answerKeyHtml: "web-answer-key.html",
      },
    }),
    "utf8",
  ),
]);

process.stdout.write(
  `Wrote deterministic Web sample ${materialized.instanceHash} to ${outputDirectory}\n`,
);
