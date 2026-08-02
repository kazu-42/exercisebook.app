import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const repositoryRoot = dirname(dirname(modulePath));
const goldenDirectory = join(
  repositoryRoot,
  "packages",
  "test-fixtures",
  "golden",
  "print-v2",
);
const expectedManifestKeys = [
  "schema",
  "sourceHash",
  "contentHash",
  "planId",
  "planHash",
  "sourceInstanceHash",
  "projectorVersion",
  "rendererVersion",
  "semanticSnapshotSchema",
  "artifacts",
];
const expectedArtifactSuffixes = {
  contentDocument: "content-document.json",
  dailyPlan: "daily-plan.json",
  canonicalInstance: "worksheet-instance.json",
  studentPrintDocument: "student.print-document.json",
  answerKeyPrintDocument: "answer-key.print-document.json",
  studentSemanticSnapshot: "student.semantic-snapshot.json",
  answerKeySemanticSnapshot: "answer-key.semantic-snapshot.json",
  studentHtml: "student.html",
  answerKeyHtml: "answer-key.html",
};
const expectedArtifactIdentities = {
  contentDocument: "944225a2dda87ae6ee61e53f21a929301f5264793d665ea2200b65fb0f5a71dd",
  dailyPlan: "a55f578df16f592c13b5d7d8dd03f196a03176af5827bfb2dc0e312d06eff8c3",
  canonicalInstance: "934bd3949b6284bbb4061a29b3075560f9389b096ec4f913ad56788e06ac0d02",
  studentPrintDocument:
    "51892552e00caac748d0ceb2532ed7eb1d7a1e094eef887cb0cc941fd8f80111",
  answerKeyPrintDocument:
    "d5a5b226bb485ed8e3cb8a43ef05695015e2a00bb97fe6a85530c654b7db0ebd",
  studentSemanticSnapshot:
    "313f7dc135ccbb2bc59967c9f78da8b42f1986136f4a2fb32eedb766ebf54d67",
  answerKeySemanticSnapshot:
    "540ae4e7105b030597df2dd0fdfd04b5fb50d562d93d6f71942d45393412d167",
  studentHtml: "13b819ad153d7c0d2313d412720390ed9544bebf7033f5588e2baf86fc0a5f39",
  answerKeyHtml: "b49c3812a26b6754d783207d11b4480e20aef112f89087a808b4a60521cb026d",
};
const expectedArtifactByteLengths = {
  contentDocument: 2_680,
  dailyPlan: 1_527,
  canonicalInstance: 20_941,
  studentPrintDocument: 12_077,
  answerKeyPrintDocument: 16_012,
  studentSemanticSnapshot: 9_055,
  answerKeySemanticSnapshot: 12_450,
  studentHtml: 23_436,
  answerKeyHtml: 29_297,
};
const forbiddenStudentFields = new Set([
  "answerMetadata",
  "baseSeed",
  "canonicalAnswer",
  "canonicalAnswers",
  "canonicalResponse",
  "excludedCanonicalAnswers",
  "incorrectAnswer",
  "misconceptions",
  "scoringRule",
  "seedVersion",
  "seedSecretVersion",
  "slotSeed",
  "solutionTrace",
]);
const NESTED_URI_ENCODED_PERCENT_PATTERN = /%(?:25)+(?=[0-9a-f]{2})/giu;
const URI_ENCODED_BYTE_WITH_PERCENT_LAYERS_PATTERN = /%((?:25)+)([0-9a-f]{2})/giu;
const URI_COMPONENT_UNESCAPED_ASCII_PATTERN = /^[a-z0-9\-_.!~*'()]*$/iu;
const URI_ENCODED_BYTE_RUN_PATTERN = /(?:%[0-9a-f]{2})+/giu;
const UTF8_REPLACEMENT_DECODER = new TextDecoder("utf-8", { fatal: false });
const ANSWER_SCAN_BIDI_CONTROL_PATTERN = /\p{Bidi_Control}/u;
const ANSWER_SCAN_DASH_OR_MINUS_PATTERN =
  /[\p{Dash_Punctuation}\u02D7\u2043\u2212\u2796\u{10D8F}]/gu;
const ANSWER_SCAN_PLUS_PATTERN = /[\u02D6\u16ED\u2795\u{10D8E}]/gu;
const ANSWER_SCAN_DIVISION_OR_SOLIDUS_PATTERN =
  /[\u00F7\u2298\u2571\u2797\u27CB\u29F8\u2A38\u{1F67C}]/gu;
const ANSWER_SCAN_DEFAULT_IGNORABLE_PATTERN = /\p{Default_Ignorable_Code_Point}/gu;
const MAX_ANSWER_SCAN_URI_DECODE_ROUNDS = 3;
const MAX_ANSWER_SCAN_NORMALIZATION_STATES = 24;
const SLOT_SEED_DOMAIN_V1 = "exercisebook/slot-seed/v1";
const MAX_SLOT_GENERATION_ATTEMPT = 127;

if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  await main(process.argv.slice(2));
}

async function main(arguments_) {
  const generatedDirectory = resolveDirectory(arguments_);
  const generated = await verifyArtifactDirectory(generatedDirectory, true);
  const golden = await verifyArtifactDirectory(goldenDirectory, true);
  assert.deepEqual(
    generated.manifest,
    golden.manifest,
    "The generated V2 manifest must equal the reviewed golden manifest.",
  );
  assert.deepEqual(
    generated.manifestBytes,
    golden.manifestBytes,
    "The generated V2 manifest bytes must equal the reviewed golden bytes.",
  );
  for (const key of Object.keys(expectedArtifactSuffixes)) {
    assert.deepEqual(
      generated.artifactBytes[key],
      golden.artifactBytes[key],
      `Generated artifact ${key} must equal the reviewed golden bytes.`,
    );
  }

  console.log(
    `Verified V2 print sample ${generated.manifest.sourceInstanceHash}: nine content-addressed artifacts, parent identities, exact golden bytes, and student leak boundaries are intact.`,
  );
}

async function verifyArtifactDirectory(directory, requireExactFileSet) {
  await assertRegularDirectory(directory);
  const manifestBytes = await readRegularFile(join(directory, "manifest.json"), {
    maxBytes: 64 * 1024,
  });
  const manifestSource = manifestBytes.toString("utf8");
  const manifest = JSON.parse(manifestSource);
  assert.equal(
    manifestSource,
    `${JSON.stringify(manifest, undefined, 2)}\n`,
    "The V2 print sample manifest must use its exact deterministic encoding.",
  );
  assertExactKeys(manifest, expectedManifestKeys, "$manifest");
  assert.equal(manifest.schema, "exercisebook.print-sample-manifest.v2");
  assert.equal(
    manifest.sourceHash,
    "456c8908debd52c7fcc5eba6e2e9a38434b5fcd8343e7a14a427faae34502523",
  );
  assert.equal(manifest.contentHash, expectedArtifactIdentities.contentDocument);
  assert.equal(
    manifest.planId,
    "preview-d8e7bffb76e814cf8fed232ed5817008d9291247f94d4e63bda6fbeb647daf33",
  );
  assert.match(manifest.planHash, /^[0-9a-f]{64}$/u);
  assert.equal(manifest.planHash, expectedArtifactIdentities.dailyPlan);
  assert.equal(
    manifest.sourceInstanceHash,
    expectedArtifactIdentities.canonicalInstance,
  );
  assert.equal(manifest.projectorVersion, "print-projector.v2");
  assert.equal(manifest.rendererVersion, "printable-html.v2");
  assert.equal(
    manifest.semanticSnapshotSchema,
    "exercisebook.print-semantic-snapshot/v2",
  );
  assertExactKeys(
    manifest.artifacts,
    Object.keys(expectedArtifactSuffixes),
    "$manifest.artifacts",
  );

  const artifactBytes = {};
  for (const [key, suffix] of Object.entries(expectedArtifactSuffixes)) {
    const descriptor = manifest.artifacts[key];
    assertExactKeys(
      descriptor,
      ["filename", "sha256", "utf8Bytes"],
      `$manifest.artifacts.${key}`,
    );
    assert.match(descriptor.sha256, /^[0-9a-f]{64}$/u);
    assert.equal(descriptor.filename, `${descriptor.sha256}.${suffix}`);
    assert.equal(Number.isSafeInteger(descriptor.utf8Bytes), true);
    assert.equal(descriptor.utf8Bytes >= 0, true);
    const expectedIdentity = expectedArtifactIdentities[key];
    if (expectedIdentity !== undefined) {
      assert.equal(descriptor.sha256, expectedIdentity);
    }
    const expectedByteLength = expectedArtifactByteLengths[key];
    if (expectedByteLength !== undefined) {
      assert.equal(descriptor.utf8Bytes, expectedByteLength);
    }

    const path = resolve(directory, descriptor.filename);
    assert.equal(dirname(path), resolve(directory), `Unsafe artifact path for ${key}.`);
    const bytes = await readRegularFile(path, {
      exactBytes: descriptor.utf8Bytes,
      maxBytes: 16_000_000,
    });
    assert.equal(sha256(bytes), descriptor.sha256);
    artifactBytes[key] = bytes;
  }

  assert.equal(manifest.artifacts.dailyPlan.sha256, manifest.planHash);
  assert.equal(
    manifest.artifacts.canonicalInstance.sha256,
    manifest.sourceInstanceHash,
  );

  const content = parseArtifactJson(artifactBytes.contentDocument, "contentDocument");
  const plan = parseArtifactJson(artifactBytes.dailyPlan, "dailyPlan");
  const instance = parseArtifactJson(
    artifactBytes.canonicalInstance,
    "canonicalInstance",
  );
  const studentPrint = parseArtifactJson(
    artifactBytes.studentPrintDocument,
    "studentPrintDocument",
  );
  const answerKeyPrint = parseArtifactJson(
    artifactBytes.answerKeyPrintDocument,
    "answerKeyPrintDocument",
  );
  const studentSnapshot = parseArtifactJson(
    artifactBytes.studentSemanticSnapshot,
    "studentSemanticSnapshot",
  );
  const answerKeySnapshot = parseArtifactJson(
    artifactBytes.answerKeySemanticSnapshot,
    "answerKeySemanticSnapshot",
  );
  const studentHtml = artifactBytes.studentHtml.toString("utf8");
  const answerKeyHtml = artifactBytes.answerKeyHtml.toString("utf8");

  assertArtifactRelationships({
    manifest,
    content,
    plan,
    instance,
    studentPrint,
    answerKeyPrint,
    studentSnapshot,
    answerKeySnapshot,
    studentHtml,
    answerKeyHtml,
  });

  if (requireExactFileSet) {
    const expectedFiles = [
      "manifest.json",
      ...Object.values(manifest.artifacts).map((artifact) => artifact.filename),
    ].sort();
    assert.deepEqual(
      (await readExactDirectoryEntries(directory, expectedFiles)).sort(),
      expectedFiles,
    );
  }

  return { manifest, manifestBytes, artifactBytes };
}

export function assertArtifactRelationships({
  manifest,
  content,
  plan,
  instance,
  studentPrint,
  answerKeyPrint,
  studentSnapshot,
  answerKeySnapshot,
  studentHtml,
  answerKeyHtml,
}) {
  assert.equal(content.schema, "exercisebook.content-ast/v2");
  assert.equal(content.sourceHash, manifest.sourceHash);
  assert.equal(plan.schema, "exercisebook.daily-plan-preview/v2");
  assert.equal(plan.id, manifest.planId);
  assert.equal(plan.activities.length, 1);
  const activity = plan.activities[0];
  assert.notEqual(activity, undefined, "The reviewed plan must contain one activity.");
  const contentIdentity = {
    id: content.id,
    revision: content.revision,
    sourceHash: content.sourceHash,
    contentHash: manifest.contentHash,
    compilerVersion: content.compilerVersion,
  };
  assert.deepEqual(activity.content, contentIdentity);
  assert.equal(content.locale, plan.locale, "Content and plan locale must match.");
  assert.equal(
    plan.plannedPracticeMinutes,
    activity.expectedMinutes,
    "Plan and activity expected minutes must match.",
  );
  assert.equal(
    activity.expectedMinutes <= plan.requestedPracticeMinutes,
    true,
    "Planned practice must not exceed the requested minutes.",
  );
  assert.equal(
    content.skills.includes(activity.skillId),
    true,
    "The plan skill must be declared by the selected content.",
  );
  assert.equal(
    plan.goalId,
    activity.skillId,
    "The plan goal must equal the selected activity skill.",
  );

  const selection = activity.presentationSelection;
  const explanationNode = findSelectedContentNode(
    content,
    selection.explanationNodeId,
    "explanation",
    "selected explanation",
  );
  const workedExampleNode = findSelectedContentNode(
    content,
    selection.workedExampleNodeId,
    "worked-example",
    "selected worked example",
  );
  const exerciseNode = findSelectedContentNode(
    content,
    selection.exerciseNodeId,
    "exercise",
    "selected exercise",
  );
  assert.equal(
    exerciseNode.generator.id,
    activity.generatorId,
    "The selected exercise and plan generator ID must match.",
  );
  assert.equal(
    exerciseNode.generator.version,
    activity.generatorVersion,
    "The selected exercise and plan generator version must match.",
  );
  assert.equal(
    activity.itemCount <= exerciseNode.count,
    true,
    "The plan item count exceeds the selected exercise count.",
  );
  assert.equal(
    activity.expectedMinutes,
    activity.itemCount * 2,
    "The reviewed generator must allocate two minutes per item.",
  );
  assert.deepEqual(
    selection.excludedCanonicalAnswers,
    [
      workedExampleNode.model.left,
      workedExampleNode.model.right,
      workedExampleNode.model.result,
    ],
    "The selected exclusion tuple must equal the worked-example operands and result.",
  );

  assert.equal(instance.schema, "exercisebook.worksheet-instance/v2");
  assert.equal(instance.assignmentId, manifest.planId);
  assert.deepEqual(instance.plan, { id: plan.id, version: 2 });
  assert.equal(
    instance.localStudyDate,
    plan.localStudyDate,
    "Instance and plan localStudyDate must match.",
  );
  assert.equal(
    instance.timeZone,
    plan.timeZone,
    "Instance and plan timeZone must match.",
  );
  assert.equal(instance.locale, plan.locale, "Instance and plan locale must match.");
  assert.equal(
    instance.expectedMinutes,
    plan.plannedPracticeMinutes,
    "Instance and plan planned minutes must match.",
  );
  assert.deepEqual(instance.policy, plan.policy);
  assert.deepEqual(instance.skillGraph, plan.skillGraph);
  assert.equal(
    instance.rng.algorithm,
    "xoshiro128ss-v1",
    "Instance RNG algorithm must remain pinned to xoshiro128ss-v1.",
  );
  assert.equal(instance.rng.baseSeed, plan.generation.baseSeed);
  assert.equal(instance.rng.seedSecretVersion, plan.generation.seedVersion);
  assert.equal(instance.content.length, 1);
  assert.deepEqual(instance.content[0], contentIdentity);
  assert.equal(
    instance.title,
    content.title,
    "Instance title must match content title.",
  );

  const expectedPresentation = {
    schema: "exercisebook.worksheet-presentation/v1",
    content: contentIdentity,
    lesson: {
      nodeId: explanationNode.id,
      title: explanationNode.title,
      paragraphs: explanationNode.paragraphs,
    },
    workedExample: {
      nodeId: workedExampleNode.id,
      title: workedExampleNode.title,
      model: workedExampleNode.model,
      steps: workedExampleNode.steps,
    },
    exercise: {
      nodeId: exerciseNode.id,
      instruction: exerciseNode.instruction,
    },
  };
  assert.deepEqual(
    instance.presentation,
    expectedPresentation,
    "Instance presentation must exactly map the selected content nodes.",
  );

  const expectedAttributions = [
    {
      title: content.title,
      author: content.authors.map((author) => author.name).join(", "),
      sourceUrl: content.license.sourceUrl,
      licenseId: content.license.licenseId,
      attributionText: content.license.attributionText,
      publicationStatus: content.publication.status,
      modifications: [],
    },
  ];
  assert.deepEqual(
    instance.attributions,
    expectedAttributions,
    "Instance attribution must exactly map the selected content metadata.",
  );

  assert.equal(instance.slots.length, activity.itemCount);
  assert.equal(
    instance.slots.reduce((total, slot) => total + slot.expectedMinutes, 0),
    activity.expectedMinutes,
    "Slot minutes must sum to the activity expected minutes.",
  );
  for (const slot of instance.slots) {
    assert.equal(
      slot.slotSeed,
      deriveSlotSeedRelationship({
        baseSeed: plan.generation.baseSeed,
        generatorId: activity.generatorId,
        generatorVersion: activity.generatorVersion,
        slotId: slot.id,
        generationAttempt: slot.provenance.generationAttempt,
      }),
      `Slot ${slot.id} slot seed must derive from the plan and retry identity.`,
    );
    const ownAnswerSignature = rationalSignature(
      slot.canonicalAnswer.value.numerator,
      slot.canonicalAnswer.value.denominator,
      `Slot ${slot.id} canonical answer`,
    );
    assert.equal(
      rationalSignature(
        slot.scoringRule.accepted.numerator,
        slot.scoringRule.accepted.denominator,
        `Slot ${slot.id} scoring rule`,
      ),
      ownAnswerSignature,
      `Slot ${slot.id} scoring rule must accept its canonical answer.`,
    );
    const finalSolutionStep = slot.solutionTrace.at(-1);
    assert.notEqual(
      finalSolutionStep,
      undefined,
      `Slot ${slot.id} must contain a final solution step.`,
    );
    assert.notEqual(
      finalSolutionStep.result,
      undefined,
      `Slot ${slot.id} final solution step must contain a result.`,
    );
    assert.equal(
      rationalSignature(
        finalSolutionStep.result.numerator,
        finalSolutionStep.result.denominator,
        `Slot ${slot.id} final solution result`,
      ),
      ownAnswerSignature,
      `Slot ${slot.id} final solution result must equal its canonical answer.`,
    );
    for (const [operandName, operand] of [
      ["left", slot.prompt.left],
      ["right", slot.prompt.right],
    ]) {
      assert.notEqual(
        rationalSignature(
          operand.numerator,
          operand.denominator,
          `Slot ${slot.id} ${operandName} operand`,
        ),
        ownAnswerSignature,
        `Slot ${slot.id} ${operandName} operand must not equal its own canonical answer.`,
      );
    }
    assert.equal(
      ownAnswerSignature,
      rationalSumSignature(
        slot.prompt.left,
        slot.prompt.right,
        `Slot ${slot.id} prompt sum`,
      ),
      `Slot ${slot.id} canonical answer must equal the exact sum of its prompt operands.`,
    );
    assert.deepEqual(
      {
        id: slot.provenance.contentId,
        revision: slot.provenance.contentRevision,
        sourceHash: slot.provenance.sourceHash,
        contentHash: slot.provenance.contentHash,
        compilerVersion: slot.provenance.compilerVersion,
      },
      contentIdentity,
      `Slot ${slot.id} must retain the selected content provenance.`,
    );
    assert.equal(
      slot.provenance.generatorId,
      activity.generatorId,
      `Slot ${slot.id} generator ID must match the plan.`,
    );
    assert.equal(
      slot.provenance.generatorVersion,
      activity.generatorVersion,
      `Slot ${slot.id} generator version must match the plan.`,
    );
    assert.deepEqual(
      slot.skillIds,
      content.skills,
      `Slot ${slot.id} skills must match the selected content.`,
    );
    assert.deepEqual(
      slot.selectionReasons,
      activity.selectionReasons,
      `Slot ${slot.id} selection reasons must match the plan.`,
    );
    assert.equal(
      slot.prompt.instruction,
      exerciseNode.instruction,
      `Slot ${slot.id} instruction must map the selected exercise.`,
    );
    assert.equal(
      slot.expectedMinutes,
      2,
      `Slot ${slot.id} must retain the reviewed two-minute generator allocation.`,
    );
    assert.equal(
      slot.prompt.accessibleText,
      derivePromptAccessibleText(slot.prompt.left, slot.prompt.right),
      `Slot ${slot.id} prompt accessible text must derive from its operands.`,
    );
  }

  assert.equal(studentPrint.schema, "exercisebook.print/v2");
  assert.equal(answerKeyPrint.schema, "exercisebook.print/v2");
  assert.equal(studentPrint.variant, "student");
  assert.equal(answerKeyPrint.variant, "answer-key");
  assert.equal(studentPrint.sourceInstanceHash, manifest.sourceInstanceHash);
  assert.equal(answerKeyPrint.sourceInstanceHash, manifest.sourceInstanceHash);
  assert.equal(studentPrint.projectorVersion, manifest.projectorVersion);
  assert.equal(answerKeyPrint.projectorVersion, manifest.projectorVersion);
  assert.equal(studentPrint.sourceInstanceSchema, instance.schema);
  assert.equal(answerKeyPrint.sourceInstanceSchema, instance.schema);
  assert.equal(studentPrint.paper, "a4");
  assert.equal(answerKeyPrint.paper, "a4");
  assert.equal(studentPrint.locale, instance.locale);
  assert.equal(answerKeyPrint.locale, instance.locale);
  assert.equal(studentPrint.title, instance.title);
  assert.equal(answerKeyPrint.title, `${instance.title} — Answer key`);
  assert.deepEqual(studentPrint.attributions, instance.attributions);
  assert.deepEqual(answerKeyPrint.attributions, instance.attributions);
  assert.deepEqual(
    answerKeyPrint.blocks.slice(0, studentPrint.blocks.length),
    studentPrint.blocks,
    "Answer-key common blocks must equal the student blocks.",
  );

  const expectedPresentationBlocks = projectPresentationBlocks(instance);
  assert.deepEqual(
    studentPrint.blocks.slice(0, expectedPresentationBlocks.length),
    expectedPresentationBlocks,
    "Print presentation blocks must exactly map the instance presentation.",
  );
  const groups = blocksOfType(studentPrint, "problem-group");
  const fallbacks = blocksOfType(studentPrint, "print-fallback");
  const workingSpaces = blocksOfType(studentPrint, "working-space");
  assert.equal(groups.length, instance.slots.length);
  assert.equal(fallbacks.length, instance.slots.length);
  assert.equal(workingSpaces.length, instance.slots.length);

  const expectedSnapshotProblems = [];
  const expectedStudentBlocks = [...expectedPresentationBlocks];
  for (const [index, slot] of instance.slots.entries()) {
    const ordinal = index + 1;
    const expectedProblem = projectProblemRelationship(slot, ordinal);
    const expectedGroup = {
      type: "problem-group",
      id: ordinalId("problem-group", ordinal),
      sourceNodeId: instance.presentation.exercise.nodeId,
      ordinal,
      title: `Problem ${String(ordinal)}`,
      problems: [expectedProblem],
    };
    const expectedFallback = projectFallbackRelationship(slot, ordinal);
    const expectedWorkingSpace = {
      type: "working-space",
      id: ordinalId("working-space", ordinal),
      problemId: slot.id,
      ordinal,
      label: `Working space for problem ${String(ordinal)}`,
      lines: 3,
    };
    expectedStudentBlocks.push(expectedGroup, expectedFallback, expectedWorkingSpace);
    assert.deepEqual(
      groups[index],
      expectedGroup,
      `Print problem prompt ${slot.id} must exactly map the instance slot.`,
    );
    assert.deepEqual(
      fallbacks[index],
      expectedFallback,
      `Print fallback ${slot.id} must exactly map the instance slot.`,
    );
    assert.deepEqual(
      workingSpaces[index],
      expectedWorkingSpace,
      `Print working space ${slot.id} must exactly map the instance slot.`,
    );
    expectedSnapshotProblems.push({
      id: expectedProblem.id,
      ordinal: expectedProblem.ordinal,
      instruction: expectedProblem.instruction,
      prompt: {
        type: "fraction-addition",
        left: { ...slot.prompt.left },
        right: { ...slot.prompt.right },
        accessibleText: expectedProblem.promptAccessibleText,
      },
      response: {
        label: expectedProblem.response.label,
        lines: expectedProblem.response.lines,
      },
      fallback: expectedFallback.content,
      workingSpace: {
        label: expectedWorkingSpace.label,
        lines: expectedWorkingSpace.lines,
      },
      provenance: expectedProblem.provenance,
    });
  }
  assert.deepEqual(
    studentPrint.blocks,
    expectedStudentBlocks,
    "The complete student PrintDocument block order must map the instance exactly.",
  );

  assert.deepEqual(
    answerKeyPrint.blocks.slice(
      studentPrint.blocks.length,
      studentPrint.blocks.length + 2,
    ),
    [
      { type: "page-break", id: "answer-key-page-break" },
      {
        type: "heading",
        id: "answer-key-title",
        level: 1,
        content: [{ type: "text", text: "Answer key" }],
      },
    ],
    "Answer-key appendix prefix is inconsistent.",
  );
  const keyBlocks = blocksOfType(answerKeyPrint, "answer-key");
  assert.equal(keyBlocks.length, instance.slots.length);
  const expectedSnapshotKeyEntries = [];
  const expectedKeyBlocks = [];
  for (const [index, slot] of instance.slots.entries()) {
    const ordinal = index + 1;
    const answer = slot.canonicalAnswer.value;
    const expectedExplanation = slot.solutionTrace.map(
      (step) => `${step.explanation} ${step.accessibleText}`,
    );
    const expectedResponse = {
      type: "fraction",
      numerator: answer.numerator,
      denominator: answer.denominator,
      accessibleText: `${answer.numerator} over ${answer.denominator}`,
    };
    const expectedKeyBlock = {
      type: "answer-key",
      id: ordinalId("answer-key", ordinal),
      problemId: slot.id,
      ordinal,
      canonicalResponse: [expectedResponse],
      explanation: expectedExplanation,
    };
    expectedKeyBlocks.push(expectedKeyBlock);
    const keyBlock = keyBlocks[index];
    assert.deepEqual(
      keyBlock?.canonicalResponse,
      [expectedResponse],
      `Answer-key canonical response ${slot.id} must exactly map the instance answer.`,
    );
    assert.deepEqual(
      keyBlock?.explanation,
      expectedExplanation,
      `Answer-key explanation ${slot.id} must exactly map the solution trace.`,
    );
    assert.deepEqual(
      {
        type: keyBlock?.type,
        id: keyBlock?.id,
        problemId: keyBlock?.problemId,
        ordinal: keyBlock?.ordinal,
      },
      {
        type: "answer-key",
        id: ordinalId("answer-key", ordinal),
        problemId: slot.id,
        ordinal,
      },
      `Answer-key entry ${slot.id} has inconsistent identity.`,
    );
    expectedSnapshotKeyEntries.push({
      problemId: slot.id,
      ordinal,
      canonicalResponse: {
        numerator: expectedResponse.numerator,
        denominator: expectedResponse.denominator,
        accessibleText: expectedResponse.accessibleText,
      },
      explanation: expectedExplanation,
    });
  }
  assert.deepEqual(
    answerKeyPrint.blocks,
    [
      ...expectedStudentBlocks,
      { type: "page-break", id: "answer-key-page-break" },
      {
        type: "heading",
        id: "answer-key-title",
        level: 1,
        content: [{ type: "text", text: "Answer key" }],
      },
      ...expectedKeyBlocks,
    ],
    "The complete answer-key PrintDocument block order must map the instance exactly.",
  );

  assert.equal(studentSnapshot.schema, manifest.semanticSnapshotSchema);
  assert.equal(answerKeySnapshot.schema, manifest.semanticSnapshotSchema);
  assert.equal(studentSnapshot.variant, "student");
  assert.equal(answerKeySnapshot.variant, "answer-key");
  assert.equal(studentSnapshot.sourceInstanceHash, manifest.sourceInstanceHash);
  assert.equal(answerKeySnapshot.sourceInstanceHash, manifest.sourceInstanceHash);
  assert.equal(studentSnapshot.projectorVersion, manifest.projectorVersion);
  assert.equal(answerKeySnapshot.projectorVersion, manifest.projectorVersion);
  assert.equal(studentSnapshot.printDocumentSchema, studentPrint.schema);
  assert.equal(answerKeySnapshot.printDocumentSchema, answerKeyPrint.schema);
  assert.equal(studentSnapshot.sourceInstanceSchema, instance.schema);
  assert.equal(answerKeySnapshot.sourceInstanceSchema, instance.schema);
  assert.equal(studentSnapshot.paper, studentPrint.paper);
  assert.equal(answerKeySnapshot.paper, answerKeyPrint.paper);
  assert.equal(studentSnapshot.locale, studentPrint.locale);
  assert.equal(answerKeySnapshot.locale, answerKeyPrint.locale);
  assert.equal(studentSnapshot.worksheetTitle, instance.title);
  assert.equal(answerKeySnapshot.worksheetTitle, instance.title);
  const expectedSummary = `${instance.localStudyDate} · ${String(instance.expectedMinutes)} minutes`;
  assert.equal(studentSnapshot.worksheetSummary, expectedSummary);
  assert.equal(answerKeySnapshot.worksheetSummary, expectedSummary);
  assert.deepEqual(studentSnapshot.presentation, instance.presentation);
  assert.deepEqual(answerKeySnapshot.presentation, instance.presentation);
  assert.deepEqual(studentSnapshot.attributions, instance.attributions);
  assert.deepEqual(answerKeySnapshot.attributions, instance.attributions);
  assert.deepEqual(
    studentSnapshot.problems,
    expectedSnapshotProblems,
    "Student semantic snapshot problems must exactly map the PrintDocument.",
  );
  assert.deepEqual(
    answerKeySnapshot.problems,
    expectedSnapshotProblems,
    "Answer-key semantic snapshot problems must exactly map the PrintDocument.",
  );
  assert.deepEqual(studentSnapshot.keyEntries, []);
  assert.deepEqual(
    answerKeySnapshot.keyEntries,
    expectedSnapshotKeyEntries,
    "Answer-key semantic snapshot entries must exactly map the PrintDocument.",
  );
  const {
    keyEntries: _studentEntries,
    variant: _studentVariant,
    ...studentShared
  } = studentSnapshot;
  const {
    keyEntries: _keyEntries,
    variant: _keyVariant,
    ...answerKeyShared
  } = answerKeySnapshot;
  assert.deepEqual(answerKeyShared, studentShared);

  assert.equal(studentHtml.startsWith("<!doctype html>"), true);
  assert.equal(answerKeyHtml.startsWith("<!doctype html>"), true);
  assert.equal(studentHtml.includes(manifest.sourceInstanceHash), true);
  assert.equal(answerKeyHtml.includes(manifest.sourceInstanceHash), true);
  assertNoForbiddenStudentFields(studentPrint, "$studentPrint");
  assertNoForbiddenStudentFields(studentSnapshot, "$studentSnapshot");
  assertStudentArtifactsHaveNoProtectedValues(
    studentPrint,
    studentSnapshot,
    studentHtml,
    instance,
  );
  assertHtmlMapsPrintDocument(studentHtml, studentPrint, "studentHtml");
  assertHtmlMapsPrintDocument(answerKeyHtml, answerKeyPrint, "answerKeyHtml");
  assertSelfContainedHtml(studentHtml, "studentHtml");
  assertSelfContainedHtml(answerKeyHtml, "answerKeyHtml");
}

function findSelectedContentNode(content, nodeId, type, label) {
  const matches = content.nodes.filter((node) => node.id === nodeId);
  assert.equal(matches.length, 1, `The ${label} must resolve exactly once.`);
  const node = matches[0];
  assert.equal(node?.type, type, `The ${label} has the wrong content-node type.`);
  return node;
}

function projectPresentationBlocks(instance) {
  const presentation = instance.presentation;
  const model = presentation.workedExample.model;
  return [
    {
      type: "heading",
      id: "worksheet-title",
      level: 1,
      content: [{ type: "text", text: instance.title }],
    },
    {
      type: "paragraph",
      id: "worksheet-summary",
      content: [
        {
          type: "text",
          text: `${instance.localStudyDate} · ${String(instance.expectedMinutes)} minutes`,
        },
      ],
    },
    {
      type: "heading",
      id: "lesson-heading",
      sourceNodeId: presentation.lesson.nodeId,
      level: 2,
      content: [{ type: "text", text: presentation.lesson.title }],
    },
    ...presentation.lesson.paragraphs.map((paragraph, index) => ({
      type: "paragraph",
      id: ordinalId("lesson-paragraph", index + 1),
      sourceNodeId: presentation.lesson.nodeId,
      paragraphOrdinal: index + 1,
      content: [{ type: "text", text: paragraph }],
    })),
    {
      type: "worked-example",
      id: "worked-example",
      sourceNodeId: presentation.workedExample.nodeId,
      title: presentation.workedExample.title,
      model,
      prompt: [
        projectFractionRelationship(model.left),
        { type: "operator", symbol: "+", accessibleText: "plus" },
        projectFractionRelationship(model.right),
        { type: "operator", symbol: "=", accessibleText: "equals" },
        projectFractionRelationship(model.result),
      ],
      steps: presentation.workedExample.steps,
    },
  ];
}

function projectProblemRelationship(slot, ordinal) {
  return {
    id: slot.id,
    ordinal,
    instruction: slot.prompt.instruction,
    promptAccessibleText: slot.prompt.accessibleText,
    prompt: [
      projectFractionRelationship(slot.prompt.left),
      { type: "operator", symbol: "+", accessibleText: "plus" },
      projectFractionRelationship(slot.prompt.right),
    ],
    response: {
      type: "fraction",
      label: `Response space for problem ${String(ordinal)}`,
      lines: 3,
    },
    provenance: {
      contentId: slot.provenance.contentId,
      contentRevision: slot.provenance.contentRevision,
      sourceHash: slot.provenance.sourceHash,
      contentHash: slot.provenance.contentHash,
      compilerVersion: slot.provenance.compilerVersion,
      generatorId: slot.provenance.generatorId,
      generatorVersion: slot.provenance.generatorVersion,
      generationAttempt: slot.provenance.generationAttempt,
    },
  };
}

function projectFallbackRelationship(slot, ordinal) {
  const left = projectFractionBarRelationship(slot.prompt.left);
  const right = projectFractionBarRelationship(slot.prompt.right);
  return {
    type: "print-fallback",
    id: ordinalId("print-fallback", ordinal),
    problemId: slot.id,
    ordinal,
    content:
      left === undefined || right === undefined
        ? { type: "text", text: slot.printFallback.text }
        : {
            type: "fraction-bars",
            label: slot.prompt.accessibleText,
            caption: slot.printFallback.text,
            bars: [left, right],
          },
  };
}

function projectFractionRelationship(value) {
  return {
    type: "fraction",
    numerator: value.numerator,
    denominator: value.denominator,
    accessibleText: `${value.numerator} over ${value.denominator}`,
  };
}

function projectFractionBarRelationship(value) {
  const numeratorValue = BigInt(value.numerator);
  const denominatorValue = BigInt(value.denominator);
  if (
    numeratorValue < 0n ||
    numeratorValue > denominatorValue ||
    denominatorValue > 100n
  ) {
    return undefined;
  }
  return {
    numerator: Number(numeratorValue),
    denominator: Number(denominatorValue),
    label: `${value.numerator}/${value.denominator}`,
  };
}

function derivePromptAccessibleText(left, right) {
  return `Add ${left.numerator} over ${left.denominator} and ${right.numerator} over ${right.denominator}. Give the answer in lowest terms.`;
}

function deriveSlotSeedRelationship({
  baseSeed,
  generatorId,
  generatorVersion,
  slotId,
  generationAttempt,
}) {
  assert.match(
    baseSeed,
    /^[0-9a-f]{64}$/u,
    "The plan base seed must be 64 lowercase hexadecimal characters.",
  );
  assert.equal(
    Number.isInteger(generationAttempt) &&
      generationAttempt >= 0 &&
      generationAttempt <= MAX_SLOT_GENERATION_ATTEMPT,
    true,
    `Slot ${slotId} generation attempt must be between 0 and ${MAX_SLOT_GENERATION_ATTEMPT}.`,
  );
  const derivationSlotId =
    generationAttempt === 0 ? slotId : `${slotId}:retry-${generationAttempt}`;
  for (const [name, value] of [
    ["generator ID", generatorId],
    ["generator version", generatorVersion],
    ["derivation slot ID", derivationSlotId],
  ]) {
    assert.equal(
      typeof value === "string" && value.length >= 1 && value.length <= 160,
      true,
      `The slot-seed ${name} must contain from 1 to 160 UTF-16 code units.`,
    );
  }
  const canonicalInput = JSON.stringify([
    SLOT_SEED_DOMAIN_V1,
    generatorId,
    generatorVersion,
    derivationSlotId,
  ]);
  return createHmac("sha256", Buffer.from(baseSeed, "hex"))
    .update(canonicalInput, "utf8")
    .digest("hex");
}

function ordinalId(prefix, ordinal) {
  return `${prefix}-${String(ordinal).padStart(3, "0")}`;
}

function blocksOfType(document, type) {
  return document.blocks.filter((block) => block.type === type);
}

function assertStudentArtifactsHaveNoProtectedValues(
  studentPrint,
  studentSnapshot,
  studentHtml,
  instance,
) {
  const serializedArtifacts = [
    JSON.stringify(studentPrint),
    JSON.stringify(studentSnapshot),
    studentHtml,
  ];
  const protectedValues = [
    instance.rng.baseSeed,
    instance.rng.seedSecretVersion,
    ...instance.slots.map((slot) => slot.slotSeed),
    ...instance.slots.flatMap((slot) =>
      slot.solutionTrace.flatMap((step) => [
        step.accessibleText,
        step.explanation,
        step.expression,
      ]),
    ),
    ...instance.slots.flatMap((slot) =>
      slot.misconceptions.map((misconception) => misconception.description),
    ),
  ];
  for (const [artifactIndex, artifact] of serializedArtifacts.entries()) {
    for (const value of protectedValues) {
      assert.equal(
        artifact.includes(value),
        false,
        `Student artifact ${artifactIndex} contains a seed or seed-version value.`,
      );
    }
    for (const field of forbiddenStudentFields) {
      assert.equal(
        artifact.includes(field),
        false,
        `Student artifact ${artifactIndex} contains forbidden field ${field}.`,
      );
    }
  }

  const answersByProblemId = new Map(
    instance.slots.map((slot) => [slot.id, slot.canonicalAnswer.value]),
  );
  const allAnswers = [...answersByProblemId.values()];
  const problemBlockTypes = new Set([
    "problem-group",
    "print-fallback",
    "working-space",
  ]);
  assertAnswerRepresentationsAbsent(
    JSON.stringify({
      ...studentPrint,
      blocks: studentPrint.blocks.filter((block) => !problemBlockTypes.has(block.type)),
    }),
    allAnswers,
    "student PrintDocument shared fields",
  );
  assertAnswerRepresentationsAbsent(
    JSON.stringify({ ...studentSnapshot, problems: [] }),
    allAnswers,
    "student semantic snapshot shared fields",
  );

  for (const slot of instance.slots) {
    const group = studentPrint.blocks.find(
      (block) =>
        block.type === "problem-group" &&
        block.problems.some((problem) => problem.id === slot.id),
    );
    const fallback = studentPrint.blocks.find(
      (block) => block.type === "print-fallback" && block.problemId === slot.id,
    );
    const workingSpace = studentPrint.blocks.find(
      (block) => block.type === "working-space" && block.problemId === slot.id,
    );
    assert.notEqual(group, undefined, `Missing problem group for ${slot.id}.`);
    assert.notEqual(fallback, undefined, `Missing fallback for ${slot.id}.`);
    assert.notEqual(workingSpace, undefined, `Missing working space for ${slot.id}.`);
    const problem = group.problems[0];
    assert.notEqual(problem, undefined, `Missing print problem for ${slot.id}.`);
    const {
      prompt: _prompt,
      promptAccessibleText: _accessible,
      ...nonPrompt
    } = problem;
    assertAnswerRepresentationsAbsent(
      JSON.stringify({
        ...group,
        problems: [nonPrompt],
        fallback: answerScannableFallback(fallback),
        workingSpace,
      }),
      allAnswers,
      `student PrintDocument non-operand fields for ${slot.id}`,
    );

    const snapshotProblems = studentSnapshot.problems.filter(
      (problem) => problem.id === slot.id,
    );
    assert.equal(
      snapshotProblems.length,
      1,
      `Expected one semantic snapshot problem for ${slot.id}.`,
    );
    const snapshotProblem = snapshotProblems[0];
    const {
      prompt: _snapshotPrompt,
      fallback: snapshotFallback,
      ...snapshotNonOperand
    } = snapshotProblem;
    assertAnswerRepresentationsAbsent(
      JSON.stringify({
        ...snapshotNonOperand,
        fallback: answerScannableFallbackContent(snapshotFallback),
      }),
      allAnswers,
      `student semantic snapshot non-operand fields for ${slot.id}`,
    );
  }

  assertRoleSensitiveHtmlHasNoAnswers(studentHtml, studentPrint, answersByProblemId);
}

function answerScannableFallback(fallback) {
  return {
    ...fallback,
    content: answerScannableFallbackContent(fallback.content),
  };
}

function answerScannableFallbackContent(content) {
  if (content.type === "text") {
    return content;
  }
  return { type: content.type, caption: content.caption };
}

export function assertRoleSensitiveHtmlHasNoAnswers(
  studentHtml,
  studentPrint,
  answersByProblemId,
) {
  const problemGroups = studentPrint.blocks.filter(
    (block) => block.type === "problem-group",
  );
  const footerIndex = studentHtml.indexOf('<footer class="attributions">');
  assert.notEqual(footerIndex, -1, "Student HTML is missing its attribution footer.");
  const firstMarker = problemGroups[0]
    ? `data-print-block-id="${problemGroups[0].id}"`
    : undefined;
  assert.notEqual(firstMarker, undefined, "Student HTML has no problem groups.");
  const firstProblemIndex = studentHtml.indexOf(firstMarker);
  assert.notEqual(firstProblemIndex, -1, "Student HTML is missing its first problem.");
  const allAnswers = [...answersByProblemId.values()];
  assertAnswerRepresentationsAbsent(
    `${studentHtml.slice(0, firstProblemIndex)}${studentHtml.slice(footerIndex)}`,
    allAnswers,
    "student HTML shared regions",
  );

  for (const [index, group] of problemGroups.entries()) {
    const problem = group.problems[0];
    assert.notEqual(problem, undefined, `Problem group ${group.id} is empty.`);
    const ownAnswer = answersByProblemId.get(problem.id);
    assert.notEqual(ownAnswer, undefined, `No source answer exists for ${problem.id}.`);
    assertAnswerRepresentationsAbsent(
      JSON.stringify({
        prompt: problem.prompt,
        promptAccessibleText: problem.promptAccessibleText,
      }),
      [ownAnswer],
      `student HTML mapped prompt operands for ${problem.id}`,
    );
    const marker = `data-print-block-id="${group.id}"`;
    const start = studentHtml.indexOf(marker);
    const nextGroup = problemGroups[index + 1];
    const end =
      nextGroup === undefined
        ? footerIndex
        : studentHtml.indexOf(`data-print-block-id="${nextGroup.id}"`, start + 1);
    assert.notEqual(start, -1, `Student HTML is missing ${group.id}.`);
    assert.notEqual(end, -1, `Student HTML has no end boundary for ${group.id}.`);
    assert.equal(start < end, true, `Student HTML reordered ${group.id}.`);
    let problemRegion = studentHtml.slice(start, end);
    const promptMatches = [
      ...problemRegion.matchAll(
        /<p class="problem-prompt" role="math" aria-label="([^"]*)">([\s\S]*?)<\/p>/gu,
      ),
    ];
    assert.equal(
      promptMatches.length,
      1,
      `Student HTML problem ${problem.id} must contain one exact prompt region.`,
    );
    const promptMatch = promptMatches[0];
    assert.notEqual(promptMatch, undefined);
    assert.equal(
      promptMatch[1],
      escapeAttribute(problem.promptAccessibleText),
      `Student HTML prompt label for ${problem.id} must map the PrintDocument.`,
    );
    assert.equal(
      promptMatch[2],
      renderPromptBody(problem.prompt),
      `Student HTML prompt body for ${problem.id} must map the PrintDocument.`,
    );
    problemRegion = replaceOnce(
      problemRegion,
      promptMatch[0],
      "",
      `Student HTML prompt region for ${problem.id}`,
    );

    const fallback = studentPrint.blocks.find(
      (block) => block.type === "print-fallback" && block.problemId === problem.id,
    );
    assert.notEqual(fallback, undefined, `Missing print fallback for ${problem.id}.`);
    if (fallback.content.type === "fraction-bars") {
      assertAnswerRepresentationsAbsent(
        JSON.stringify({ label: fallback.content.label, bars: fallback.content.bars }),
        [ownAnswer],
        `student HTML mapped fallback operands for ${problem.id}`,
      );
      problemRegion = replaceOnce(
        problemRegion,
        renderFractionBarDiagram(fallback.content),
        "",
        `Student HTML fraction-bar diagram for ${problem.id}`,
      );
    }
    assertAnswerRepresentationsAbsent(
      problemRegion,
      allAnswers,
      `student HTML non-operand fields for ${problem.id}`,
    );
  }
}

function assertAnswerRepresentationsAbsent(source, answers, label) {
  assert.equal(
    answers.length <= 256,
    true,
    `${label} exceeds the 256-answer scan limit.`,
  );
  const protectedSignatures = new Map(
    answers.map(({ denominator, numerator }) => [
      rationalSignature(numerator, denominator, label),
      `${numerator}/${denominator}`,
    ]),
  );
  for (const candidate of extractRationalCandidates(source, label)) {
    const protectedAnswer = protectedSignatures.get(candidate.signature);
    if (protectedAnswer !== undefined) {
      assert.fail(`${label} contains canonical answer ${protectedAnswer}.`);
    }
  }
}

function extractRationalCandidates(source, label) {
  const candidates = [];
  const matchers = [
    {
      pattern:
        /\{\s*["']?numerator["']?(?![\p{L}\p{N}_$])\s*:\s*["']?([+-]?[0-9]+)["']?\s*,\s*["']?denominator["']?(?![\p{L}\p{N}_$])\s*:\s*["']?([+-]?[0-9]+)["']?\s*\}/giu,
      numeratorIndex: 1,
      denominatorIndex: 2,
    },
    {
      pattern:
        /\{\s*["']?denominator["']?(?![\p{L}\p{N}_$])\s*:\s*["']?([+-]?[0-9]+)["']?\s*,\s*["']?numerator["']?(?![\p{L}\p{N}_$])\s*:\s*["']?([+-]?[0-9]+)["']?\s*\}/giu,
      numeratorIndex: 2,
      denominatorIndex: 1,
    },
    {
      pattern:
        /<span class="fraction-numerator">([+-]?[0-9]+)<\/span>\s*<span class="fraction-denominator">([+-]?[0-9]+)<\/span>/giu,
      numeratorIndex: 1,
      denominatorIndex: 2,
    },
    {
      pattern: /\\frac\s*\{\s*([+-]?[0-9]+)\s*\}\s*\{\s*([+-]?[0-9]+)\s*\}/giu,
      numeratorIndex: 1,
      denominatorIndex: 2,
    },
    {
      // Zero-width lookahead preserves overlapping suffixes such as 3/4 in
      // 1/3/4 while retaining token boundaries around each integer.
      pattern:
        /(?=(?<![0-9+-])([+-]?[0-9]+)(?:\s*([\/⁄∕]+)\s*|\s+(over|divided\s+by|division\s+by)\s+)([+-]?[0-9]+)(?![0-9]))/giu,
      numeratorIndex: 1,
      denominatorIndex: 4,
      slashIndex: 2,
    },
  ];
  for (const normalizedSource of normalizedAnswerScanVariants(source, label)) {
    for (const matcher of matchers) {
      for (const match of normalizedSource.matchAll(matcher.pattern)) {
        const numerator = match[matcher.numeratorIndex];
        const denominator = match[matcher.denominatorIndex];
        assert.notEqual(
          numerator,
          undefined,
          `${label} has an invalid rational candidate.`,
        );
        assert.notEqual(
          denominator,
          undefined,
          `${label} has an invalid rational candidate.`,
        );
        if (matcher.slashIndex !== undefined) {
          const slash = match[matcher.slashIndex];
          if (slash !== undefined) {
            assert.equal(
              slash.length,
              1,
              `${label} contains an unsupported repeated rational separator.`,
            );
          }
        }
        candidates.push({
          signature: rationalSignature(numerator, denominator, label),
        });
        assert.equal(
          candidates.length <= 65_536,
          true,
          `${label} exceeds the 65536-rational candidate scan limit.`,
        );
      }
    }
  }
  return candidates;
}

function normalizedAnswerScanVariants(value, label) {
  const variants = new Set();
  const pending = [];
  const scheduledRoundsByValue = new Map();
  const maximumNormalizedLength = value.length * 4 + 1_024;
  let scheduledStateCount = 0;

  const schedule = (candidate, uriDecodeRound) => {
    assert.equal(
      candidate.length <= maximumNormalizedLength,
      true,
      `${label} exceeds the Unicode-normalized scan limit.`,
    );
    const roundBit = 1 << uriDecodeRound;
    const scheduledRounds = scheduledRoundsByValue.get(candidate) ?? 0;
    if ((scheduledRounds & roundBit) !== 0) {
      return;
    }
    assert.equal(
      scheduledStateCount < MAX_ANSWER_SCAN_NORMALIZATION_STATES,
      true,
      `${label} answer normalization exceeds ${MAX_ANSWER_SCAN_NORMALIZATION_STATES} states.`,
    );
    scheduledRoundsByValue.set(candidate, scheduledRounds | roundBit);
    scheduledStateCount += 1;
    pending.push({ value: candidate, uriDecodeRound });
  };

  schedule(value, 0);
  while (pending.length > 0) {
    const current = pending.pop();
    assert.notEqual(current, undefined, `${label} normalization state is missing.`);
    variants.add(current.value);
    schedule(normalizeAnswerScanText(current.value, label), current.uriDecodeRound);
    schedule(current.value.replaceAll("+", " "), current.uriDecodeRound);

    if (!current.value.includes("%")) {
      continue;
    }
    const commonLayerCollapsed = collapseCommonUriPercentEncodingLayers(current.value);
    if (commonLayerCollapsed !== current.value) {
      schedule(commonLayerCollapsed, current.uriDecodeRound);
      continue;
    }
    const collapsed = current.value.replace(NESTED_URI_ENCODED_PERCENT_PATTERN, "%");
    schedule(collapsed, current.uriDecodeRound);
    for (const decodeInput of new Set([current.value, collapsed])) {
      const decoded = decodeUriComponentWithoutThrowing(decodeInput);
      if (decoded === decodeInput) {
        continue;
      }
      assert.equal(
        current.uriDecodeRound < MAX_ANSWER_SCAN_URI_DECODE_ROUNDS,
        true,
        `${label} answer normalization exceeds ${MAX_ANSWER_SCAN_URI_DECODE_ROUNDS} URI decode rounds.`,
      );
      schedule(decoded, current.uriDecodeRound + 1);
    }
  }
  return variants;
}

function normalizeAnswerScanText(value, label) {
  const normalized = value.normalize("NFKC");
  assert.equal(
    ANSWER_SCAN_BIDI_CONTROL_PATTERN.test(normalized),
    false,
    `${label} contains an unsupported bidi control in student-visible text.`,
  );
  return normalized
    .replace(ANSWER_SCAN_DASH_OR_MINUS_PATTERN, "-")
    .replace(ANSWER_SCAN_PLUS_PATTERN, "+")
    .replace(ANSWER_SCAN_DIVISION_OR_SOLIDUS_PATTERN, "/")
    .replace(ANSWER_SCAN_DEFAULT_IGNORABLE_PATTERN, "");
}

function collapseCommonUriPercentEncodingLayers(value) {
  const encodedBytes = [
    ...value.matchAll(URI_ENCODED_BYTE_WITH_PERCENT_LAYERS_PATTERN),
  ];
  if (encodedBytes.length === 0) {
    return value;
  }

  let cursor = 0;
  let commonLayerCount = Number.POSITIVE_INFINITY;
  for (const encodedByte of encodedBytes) {
    if (
      encodedByte.index === undefined ||
      !URI_COMPONENT_UNESCAPED_ASCII_PATTERN.test(
        value.slice(cursor, encodedByte.index),
      )
    ) {
      return value;
    }
    commonLayerCount = Math.min(commonLayerCount, (encodedByte[1]?.length ?? 0) / 2);
    cursor = encodedByte.index + encodedByte[0].length;
  }
  if (
    !URI_COMPONENT_UNESCAPED_ASCII_PATTERN.test(value.slice(cursor)) ||
    commonLayerCount <= 1
  ) {
    return value;
  }

  const removableLayerLength = (commonLayerCount - 1) * 2;
  return value.replace(
    URI_ENCODED_BYTE_WITH_PERCENT_LAYERS_PATTERN,
    (_match, percentLayers, encodedByte) =>
      `%${percentLayers.slice(removableLayerLength)}${encodedByte}`,
  );
}

function decodeUriComponentWithoutThrowing(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return decodeValidUriByteRuns(value);
  }
}

function decodeValidUriByteRuns(value) {
  return value.replace(URI_ENCODED_BYTE_RUN_PATTERN, (encodedBytes) => {
    const bytes = new Uint8Array(encodedBytes.length / 3);
    for (let offset = 0; offset < encodedBytes.length; offset += 3) {
      bytes[offset / 3] = Number.parseInt(
        encodedBytes.slice(offset + 1, offset + 3),
        16,
      );
    }
    return UTF8_REPLACEMENT_DECODER.decode(bytes);
  });
}

function rationalSignature(numerator, denominator, label) {
  const [numeratorValue, denominatorValue] = parseBoundedRational(
    numerator,
    denominator,
    label,
  );
  return normalizedRationalSignature(numeratorValue, denominatorValue, label);
}

function rationalSumSignature(left, right, label) {
  const [leftNumerator, leftDenominator] = parseBoundedRational(
    left.numerator,
    left.denominator,
    `${label} left operand`,
  );
  const [rightNumerator, rightDenominator] = parseBoundedRational(
    right.numerator,
    right.denominator,
    `${label} right operand`,
  );
  return normalizedRationalSignature(
    leftNumerator * rightDenominator + rightNumerator * leftDenominator,
    leftDenominator * rightDenominator,
    label,
  );
}

function parseBoundedRational(numerator, denominator, label) {
  const unsignedNumerator =
    numerator.startsWith("-") || numerator.startsWith("+")
      ? numerator.slice(1)
      : numerator;
  const unsignedDenominator =
    denominator.startsWith("-") || denominator.startsWith("+")
      ? denominator.slice(1)
      : denominator;
  assert.equal(
    unsignedNumerator.length >= 1 && unsignedNumerator.length <= 128,
    true,
    `${label} contains an out-of-bounds rational numerator.`,
  );
  assert.equal(
    unsignedDenominator.length >= 1 && unsignedDenominator.length <= 128,
    true,
    `${label} contains an out-of-bounds rational denominator.`,
  );
  const numeratorValue = BigInt(numerator);
  const denominatorValue = BigInt(denominator);
  assert.equal(
    denominatorValue !== 0n,
    true,
    `${label} contains a zero rational denominator.`,
  );
  return [numeratorValue, denominatorValue];
}

function normalizedRationalSignature(numerator, denominator, label) {
  let numeratorValue = numerator;
  let denominatorValue = denominator;
  assert.equal(
    denominatorValue !== 0n,
    true,
    `${label} contains a zero rational denominator.`,
  );
  if (denominatorValue < 0n) {
    numeratorValue = -numeratorValue;
    denominatorValue = -denominatorValue;
  }
  if (numeratorValue === 0n) {
    return "0/1";
  }
  const divisor = greatestCommonDivisor(
    numeratorValue < 0n ? -numeratorValue : numeratorValue,
    denominatorValue,
  );
  numeratorValue /= divisor;
  return `${numeratorValue}/${denominatorValue / divisor}`;
}

function greatestCommonDivisor(left, right) {
  let a = left;
  let b = right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function renderPromptBody(prompt) {
  return (
    '<span class="math-expression" aria-hidden="true">' +
    prompt
      .map((inline) => {
        if (inline.type === "fraction") {
          return (
            '<span class="fraction">' +
            `<span class="fraction-numerator">${escapeText(inline.numerator)}</span>` +
            `<span class="fraction-denominator">${escapeText(inline.denominator)}</span>` +
            "</span>"
          );
        }
        return `<span class="operator">${escapeText(inline.symbol)}</span>`;
      })
      .join("") +
    "</span>"
  );
}

function replaceOnce(source, expected, replacement, label) {
  const first = source.indexOf(expected);
  assert.notEqual(first, -1, `${label} is missing.`);
  assert.equal(
    source.indexOf(expected, first + expected.length),
    -1,
    `${label} occurs more than once.`,
  );
  return `${source.slice(0, first)}${replacement}${source.slice(first + expected.length)}`;
}

function escapeText(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeText(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function assertHtmlMapsPrintDocument(html, document, label) {
  assert.equal(
    Buffer.byteLength(html, "utf8") <= 16_000_000,
    true,
    `${label} exceeds the reviewed HTML relationship limit.`,
  );
  const emittedBlockIds = [
    ...html.matchAll(/<[a-z][^>]*\sdata-print-block-id="([^"]+)"[^>]*>/gu),
  ].map((match) => match[1]);
  assert.equal(
    emittedBlockIds.length <= 65_536,
    true,
    `${label} exceeds the reviewed block relationship limit.`,
  );
  assert.deepEqual(
    emittedBlockIds,
    document.blocks.map((block) => block.id),
    `${label} block order must exactly map the PrintDocument.`,
  );
  assertSingleOccurrence(
    html,
    `<html lang="${escapeAttribute(document.locale)}">`,
    `${label} locale`,
  );
  assertSingleOccurrence(
    html,
    `<title>${escapeText(document.title)}</title>`,
    `${label} title`,
  );
  const mainOpening = '<main aria-labelledby="eb-v2-worksheet-title">';
  const mainStart = html.indexOf(mainOpening);
  const mainEnd = html.indexOf("</main>", mainStart + mainOpening.length);
  assert.notEqual(mainStart, -1, `${label} is missing its main region.`);
  assert.notEqual(mainEnd, -1, `${label} is missing its main closing tag.`);
  assert.equal(
    html.slice(mainEnd),
    "</main></body></html>",
    `${label} contains unexpected content outside its main region.`,
  );
  assert.equal(
    html.indexOf(mainOpening, mainStart + mainOpening.length),
    -1,
    `${label} contains more than one main region.`,
  );
  const actualMain = html.slice(mainStart + mainOpening.length, mainEnd);
  const expectedMain =
    document.blocks.map((block) => renderBlockRelationship(block)).join("") +
    renderAttributionsRelationship(document);
  assert.equal(
    actualMain,
    expectedMain,
    `${label} main content must exactly map the PrintDocument semantics.`,
  );
}

function renderBlockRelationship(block) {
  switch (block.type) {
    case "heading": {
      const tag = block.level === 1 ? "h1" : "h2";
      return (
        `<${tag} id="${domIdForHeadingRelationship(block.id)}" data-print-block-id="${escapeAttribute(block.id)}">` +
        renderInlinesRelationship(block.content) +
        `</${tag}>`
      );
    }
    case "paragraph":
      return (
        `<p id="${domIdForParagraphRelationship(block.id)}" data-print-block-id="${escapeAttribute(block.id)}" class="print-paragraph">` +
        renderInlinesRelationship(block.content) +
        "</p>"
      );
    case "worked-example": {
      const steps = block.steps.map((step) => `<li>${escapeText(step)}</li>`).join("");
      return (
        `<section id="eb-v2-worked-example" data-print-block-id="${escapeAttribute(block.id)}" class="worked-example" aria-labelledby="eb-v2-worked-example-title">` +
        `<h2 id="eb-v2-worked-example-title">${escapeText(block.title)}</h2>` +
        renderMathExpressionRelationship(
          block.prompt,
          inlineAccessibleTextRelationship(block.prompt),
        ) +
        `<ol>${steps}</ol></section>`
      );
    }
    case "problem-group": {
      const ordinal = String(block.ordinal).padStart(3, "0");
      const problem = block.problems[0];
      assert.notEqual(problem, undefined, `Problem group ${block.id} is empty.`);
      return (
        `<section id="eb-v2-problem-group-${ordinal}" data-print-block-id="${escapeAttribute(block.id)}" class="problem-group" aria-labelledby="eb-v2-problem-group-${ordinal}-title">` +
        `<h2 id="eb-v2-problem-group-${ordinal}-title">${escapeText(block.title)}</h2>` +
        `<section class="problem" data-problem-id="${escapeAttribute(problem.id)}" aria-labelledby="eb-v2-problem-group-${ordinal}-title eb-v2-problem-${ordinal}-instruction">` +
        `<h3 id="eb-v2-problem-${ordinal}-heading" class="problem-heading">` +
        `<span class="problem-number" aria-hidden="true">${String(problem.ordinal)}.</span>` +
        `<span id="eb-v2-problem-${ordinal}-instruction" class="problem-instruction">${escapeText(problem.instruction)}</span>` +
        "</h3>" +
        renderMathExpressionRelationship(problem.prompt, problem.promptAccessibleText) +
        `<div class="response-space" role="group" aria-label="${escapeAttribute(problem.response.label)}">` +
        renderLinesRelationship(problem.response.lines, "response-line") +
        "</div></section></section>"
      );
    }
    case "print-fallback": {
      const ordinal = String(block.ordinal).padStart(3, "0");
      if (block.content.type === "text") {
        return (
          `<aside id="eb-v2-print-fallback-${ordinal}" data-print-block-id="${escapeAttribute(block.id)}" data-problem-id="${escapeAttribute(block.problemId)}" class="print-fallback-text" aria-label="Print fallback for problem ${String(block.ordinal)}">` +
          `<p>${escapeText(block.content.text)}</p></aside>`
        );
      }
      return (
        `<figure id="eb-v2-print-fallback-${ordinal}" data-print-block-id="${escapeAttribute(block.id)}" data-problem-id="${escapeAttribute(block.problemId)}" class="fraction-bar-figure">` +
        renderFractionBarDiagram(block.content) +
        `<figcaption>${escapeText(block.content.caption)}</figcaption></figure>`
      );
    }
    case "working-space": {
      const ordinal = String(block.ordinal).padStart(3, "0");
      return (
        `<section id="eb-v2-working-space-${ordinal}" data-print-block-id="${escapeAttribute(block.id)}" data-problem-id="${escapeAttribute(block.problemId)}" class="working-space" role="group" aria-label="${escapeAttribute(block.label)}">` +
        `<h3 id="eb-v2-working-space-${ordinal}-title">${escapeText(block.label)}</h3>` +
        `<div class="working-lines">${renderLinesRelationship(block.lines, "working-line")}</div>` +
        "</section>"
      );
    }
    case "page-break":
      return `<div data-print-block-id="${escapeAttribute(block.id)}" class="page-break" aria-hidden="true"></div>`;
    case "answer-key": {
      const ordinal = String(block.ordinal).padStart(3, "0");
      const explanation = block.explanation
        .map((step) => `<li>${escapeText(step)}</li>`)
        .join("");
      return (
        `<section id="eb-v2-answer-key-${ordinal}" data-print-block-id="${escapeAttribute(block.id)}" data-problem-id="${escapeAttribute(block.problemId)}" class="key-entry" aria-labelledby="eb-v2-answer-key-title eb-v2-answer-key-${ordinal}-title">` +
        `<h2 id="eb-v2-answer-key-${ordinal}-title">Problem ${String(block.ordinal)}</h2>` +
        `<p class="key-response" role="math" aria-label="${escapeAttribute(inlineAccessibleTextRelationship(block.canonicalResponse))}">` +
        renderPromptBody(block.canonicalResponse) +
        `</p><ol>${explanation}</ol></section>`
      );
    }
    default:
      assert.fail(`Unsupported PrintDocument block ${String(block.type)}.`);
  }
}

function renderMathExpressionRelationship(inlines, accessibleText) {
  return (
    `<p class="problem-prompt" role="math" aria-label="${escapeAttribute(accessibleText)}">` +
    renderPromptBody(inlines) +
    "</p>"
  );
}

function renderInlinesRelationship(inlines) {
  return inlines
    .map((inline) => {
      if (inline.type === "text") {
        return escapeText(inline.text);
      }
      if (inline.type === "fraction") {
        return (
          `<span class="fraction" role="math" aria-label="${escapeAttribute(inline.accessibleText)}">` +
          `<span class="fraction-numerator" aria-hidden="true">${escapeText(inline.numerator)}</span>` +
          `<span class="fraction-denominator" aria-hidden="true">${escapeText(inline.denominator)}</span>` +
          "</span>"
        );
      }
      return (
        `<span class="operator" role="math" aria-label="${escapeAttribute(inline.accessibleText)}">` +
        `<span aria-hidden="true">${escapeText(inline.symbol)}</span></span>`
      );
    })
    .join("");
}

function renderFractionBarDiagram(content) {
  assert.equal(
    Array.isArray(content.bars) && content.bars.length <= 2,
    true,
    "Fraction-bar HTML relationship exceeds the reviewed bar limit.",
  );
  const rows = content.bars
    .map((bar) => {
      assert.equal(
        Number.isSafeInteger(bar.numerator) &&
          Number.isSafeInteger(bar.denominator) &&
          bar.numerator >= 0 &&
          bar.numerator <= bar.denominator &&
          bar.denominator >= 1 &&
          bar.denominator <= 100,
        true,
        "Fraction-bar HTML relationship exceeds the reviewed segment limit.",
      );
      let segments = "";
      for (let index = 0; index < bar.denominator; index += 1) {
        const className =
          index < bar.numerator
            ? "fraction-bar-segment filled"
            : "fraction-bar-segment";
        segments += `<span class="${className}"></span>`;
      }
      return `<div class="fraction-bar-row">${segments}</div>`;
    })
    .join("");
  return (
    `<div class="fraction-bar-diagram" role="img" aria-label="${escapeAttribute(content.label)}">` +
    `<div class="fraction-bar-rows" aria-hidden="true">${rows}</div></div>`
  );
}

function renderLinesRelationship(count, className) {
  return `<span class="${className}" aria-hidden="true"></span>`.repeat(count);
}

function renderAttributionsRelationship(document) {
  const items = document.attributions
    .map((attribution) => {
      const modifications =
        attribution.modifications.length === 0
          ? ""
          : `<div><dt>Modifications</dt><dd><ul>${attribution.modifications
              .map((modification) => `<li>${escapeText(modification)}</li>`)
              .join("")}</ul></dd></div>`;
      return (
        `<li><p class="attribution-text">${escapeText(attribution.attributionText)}</p>` +
        '<dl class="attribution-details">' +
        renderDefinitionRelationship("Title", attribution.title) +
        renderDefinitionRelationship("Author", attribution.author) +
        renderDefinitionRelationship("Source", attribution.sourceUrl) +
        renderDefinitionRelationship("License", attribution.licenseId) +
        renderDefinitionRelationship("Status", attribution.publicationStatus) +
        `${modifications}</dl></li>`
      );
    })
    .join("");
  return (
    '<footer class="attributions"><h2 id="eb-v2-attribution-heading">Attribution and provenance</h2>' +
    `<ul>${items}</ul><p class="document-provenance">Source instance: ${escapeText(document.sourceInstanceHash)}</p></footer>`
  );
}

function renderDefinitionRelationship(term, description) {
  return `<div><dt>${term}</dt><dd>${escapeText(description)}</dd></div>`;
}

function inlineAccessibleTextRelationship(inlines) {
  return inlines
    .map((inline) => inline.accessibleText)
    .join(" ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function domIdForHeadingRelationship(blockId) {
  const ids = {
    "worksheet-title": "eb-v2-worksheet-title",
    "lesson-heading": "eb-v2-lesson-heading",
    "answer-key-title": "eb-v2-answer-key-title",
  };
  const id = ids[blockId];
  assert.notEqual(id, undefined, `Unsupported heading ID ${blockId}.`);
  return id;
}

function domIdForParagraphRelationship(blockId) {
  if (blockId === "worksheet-summary") {
    return "eb-v2-worksheet-summary";
  }
  const ordinal = /^lesson-paragraph-([0-9]{3})$/u.exec(blockId)?.[1];
  assert.notEqual(ordinal, undefined, `Unsupported paragraph ID ${blockId}.`);
  return `eb-v2-lesson-paragraph-${ordinal}`;
}

function assertSingleOccurrence(source, expected, label) {
  const first = source.indexOf(expected);
  assert.notEqual(first, -1, `${label} is missing.`);
  assert.equal(
    source.indexOf(expected, first + expected.length),
    -1,
    `${label} occurs more than once.`,
  );
}

function assertSelfContainedHtml(html, label) {
  const lowercase = html.toLowerCase();
  for (const forbidden of [
    "<script",
    "<link",
    "<base",
    "<iframe",
    "<object",
    "<embed",
    "<form",
    "<audio",
    "<video",
    "<source",
    "@import",
    "@font-face",
    "url(",
  ]) {
    assert.equal(
      lowercase.includes(forbidden),
      false,
      `${label} contains ${forbidden}.`,
    );
  }
  assert.doesNotMatch(lowercase, /<a(?:\s|>)/u);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/iu);
}

function parseArtifactJson(bytes, label) {
  const source = bytes.toString("utf8");
  const value = JSON.parse(source);
  assert.equal(
    canonicalizeJson(value),
    source,
    `${label} must contain canonical JSON bytes.`,
  );
  return value;
}

function canonicalizeJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    assert.equal(Number.isFinite(value), true);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
  }
  assert.equal(typeof value, "object");
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`);
  return `{${entries.join(",")}}`;
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
      `Forbidden student field ${key} at ${path}.`,
    );
    assertNoForbiddenStudentFields(child, `${path}.${key}`);
  }
}

function assertExactKeys(value, expectedKeys, path) {
  assert.equal(
    value !== null && typeof value === "object" && !Array.isArray(value),
    true,
  );
  assert.deepEqual(Object.keys(value), expectedKeys, `${path} has unexpected keys.`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function assertRegularDirectory(directory) {
  const stats = await lstat(directory);
  assert.equal(stats.isSymbolicLink(), false, `${directory} must not be a symlink.`);
  assert.equal(stats.isDirectory(), true, `${directory} must be a directory.`);
}

async function readExactDirectoryEntries(directory, expectedFiles) {
  const expected = new Set(expectedFiles);
  const entries = [];
  const handle = await opendir(directory);
  for await (const entry of handle) {
    assert.equal(
      expected.has(entry.name),
      true,
      `${entry.name} is not part of the reviewed V2 artifact set.`,
    );
    entries.push(entry.name);
    assert.equal(
      entries.length <= expectedFiles.length,
      true,
      `${directory} exceeds the reviewed ${expectedFiles.length}-entry limit.`,
    );
  }
  return entries;
}

async function readRegularFile(path, limits) {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stats = await handle.stat();
    assert.equal(stats.isFile(), true, `${path} must be a regular file.`);
    assert.equal(
      stats.size <= limits.maxBytes,
      true,
      `${path} exceeds ${limits.maxBytes} bytes.`,
    );
    if (limits.exactBytes !== undefined) {
      assert.equal(stats.size, limits.exactBytes, `${path} has an unexpected size.`);
    }
    const maximumAcceptedBytes = limits.exactBytes ?? limits.maxBytes;
    const bytes = Buffer.allocUnsafe(maximumAcceptedBytes + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        null,
      );
      if (bytesRead === 0) {
        break;
      }
      offset += bytesRead;
    }
    assert.equal(
      offset <= limits.maxBytes,
      true,
      `${path} exceeds ${limits.maxBytes} bytes.`,
    );
    if (limits.exactBytes !== undefined) {
      assert.equal(offset, limits.exactBytes, `${path} has an unexpected size.`);
    }
    return bytes.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

function resolveDirectory(arguments_) {
  const positional = arguments_.filter((argument) => argument !== "--");
  assert.equal(
    positional.length <= 1,
    true,
    "Usage: verify-sample-artifacts-v2.mjs [--] [generated-directory]",
  );
  return resolve(positional[0] ?? join(repositoryRoot, "output", "print-sample-v2"));
}
