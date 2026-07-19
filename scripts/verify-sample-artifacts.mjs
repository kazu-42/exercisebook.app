import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const webDirectory = join(repositoryRoot, "output", "web-sample");
const printDirectory = join(repositoryRoot, "output", "print-sample");

const forbiddenStudentFields = new Set([
  "baseSeed",
  "canonicalAnswer",
  "misconceptions",
  "scoringRule",
  "seedSecretVersion",
  "slotSeed",
  "solutionTrace",
]);

const manifest = await readJson(join(webDirectory, "manifest.json"));
assert.equal(manifest.schema, "exercisebook.web-sample-manifest.v1");
assert.match(manifest.instanceHash, /^[0-9a-f]{64}$/u);

for (const artifact of Object.values(manifest.artifacts)) {
  assert.equal(typeof artifact, "string");
  await readFile(join(webDirectory, artifact));
}

const webInstanceBytes = await readFile(
  join(webDirectory, manifest.artifacts.canonicalInstance),
);
assert.equal(sha256(webInstanceBytes), manifest.instanceHash);
const instance = JSON.parse(webInstanceBytes.toString("utf8"));

const printNames = await readdir(printDirectory);
const printManifest = await readJson(join(printDirectory, "manifest.json"));
assert.equal(printManifest.schema, "exercisebook.print-sample-manifest.v1");
assert.equal(printManifest.contentHash, instance.content[0].contentHash);
assert.equal(printManifest.sourceInstanceHash, manifest.instanceHash);
for (const artifact of Object.values(printManifest.artifacts)) {
  assert.equal(typeof artifact, "string");
  assert.equal(printNames.includes(artifact), true);
}

const printInstanceName = printManifest.artifacts.canonicalInstance;
const printInstanceBytes = await readFile(join(printDirectory, printInstanceName));
assert.equal(printInstanceName, `${manifest.instanceHash}.worksheet-instance.json`);
assert.deepEqual(printInstanceBytes, webInstanceBytes);

for (const name of Object.values(printManifest.artifacts)) {
  const contentAddress = /^([0-9a-f]{64})\..+/u.exec(name)?.[1];
  assert.notEqual(contentAddress, undefined);
  assert.equal(
    sha256(await readFile(join(printDirectory, name))),
    contentAddress,
    `${name} must be named by the SHA-256 of its exact bytes`,
  );
}

const webStudent = await readJson(join(webDirectory, manifest.artifacts.studentData));
const webAnswerKey = await readJson(
  join(webDirectory, manifest.artifacts.answerKeyData),
);
const printStudentName = printManifest.artifacts.studentPrintDocument;
const printAnswerKeyName = printManifest.artifacts.answerKeyPrintDocument;
const printStudent = await readJson(join(printDirectory, printStudentName));
const printAnswerKey = await readJson(join(printDirectory, printAnswerKeyName));

assert.equal(webStudent.variant, "student");
assert.equal(webAnswerKey.variant, "answer-key");
assert.equal(webStudent.instanceHash, manifest.instanceHash);
assert.equal(webAnswerKey.instanceHash, manifest.instanceHash);
assert.equal(printStudent.variant, "student");
assert.equal(printAnswerKey.variant, "answer-key");
assert.equal(printStudent.sourceInstanceHash, manifest.instanceHash);
assert.equal(printAnswerKey.sourceInstanceHash, manifest.instanceHash);

assertNoForbiddenStudentFields(webStudent, "$webStudent");
assertNoForbiddenStudentFields(printStudent, "$printStudent");

const studentArtifacts = [
  JSON.stringify(webStudent),
  await readFile(join(webDirectory, manifest.artifacts.studentHtml), "utf8"),
  JSON.stringify(printStudent),
  await readFile(join(printDirectory, printManifest.artifacts.studentHtml), "utf8"),
];
const secretValues = [
  instance.rng.baseSeed,
  instance.rng.seedSecretVersion,
  ...instance.slots.map((slot) => slot.slotSeed),
];
for (const [artifactIndex, artifact] of studentArtifacts.entries()) {
  for (const secret of secretValues) {
    assert.equal(
      artifact.includes(secret),
      false,
      `student artifact ${artifactIndex} contains a seed or seed-version value`,
    );
  }
  for (const field of forbiddenStudentFields) {
    assert.equal(
      artifact.includes(field),
      false,
      `student artifact ${artifactIndex} contains forbidden field ${field}`,
    );
  }
  const compactArtifact = artifact.replaceAll(/\s+/gu, "");
  for (const slot of instance.slots) {
    const { denominator, numerator } = slot.canonicalAnswer.value;
    const answerRepresentations = [
      `"numerator":"${numerator}","denominator":"${denominator}"`,
      `${numerator}/${denominator}`,
      `${numerator}over${denominator}`,
      `\\frac{${numerator}}{${denominator}}`,
    ];
    for (const representation of answerRepresentations) {
      assert.equal(
        compactArtifact.includes(representation),
        false,
        `student artifact ${artifactIndex} contains a canonical answer representation for ${slot.id}`,
      );
    }
  }
}

console.log(
  `Verified Web and print sample artifacts for ${manifest.instanceHash}: content addresses, shared instance identity, variants, and student leak boundaries are intact.`,
);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertNoForbiddenStudentFields(value, path) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertNoForbiddenStudentFields(item, `${path}[${index}]`);
    }
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    assert.equal(
      forbiddenStudentFields.has(key),
      false,
      `Forbidden student field ${key} at ${path}`,
    );
    assertNoForbiddenStudentFields(child, `${path}.${key}`);
  }
}
