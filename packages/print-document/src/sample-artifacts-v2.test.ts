import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { readBoundedRegularUtf8File } from "../../../scripts/render-sample-v2.js";

const verifierModule =
  // @ts-expect-error The executable verifier is intentionally a plain Node ESM script.
  (await import("../../../scripts/verify-sample-artifacts-v2.mjs")) as RelationshipVerifierModule;
const { assertArtifactRelationships, assertRoleSensitiveHtmlHasNoAnswers } =
  verifierModule;

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const goldenDirectory = join(
  repositoryRoot,
  "packages",
  "test-fixtures",
  "golden",
  "print-v2",
);
const verifierPath = join(repositoryRoot, "scripts", "verify-sample-artifacts-v2.mjs");
const rendererPath = join(repositoryRoot, "scripts", "render-sample-v2.ts");
const tsxCliPath = join(
  repositoryRoot,
  "packages",
  "print-document",
  "node_modules",
  "tsx",
  "dist",
  "cli.mjs",
);
const temporaryDirectories: string[] = [];
const MAX_SAMPLE_SOURCE_BYTES = 262_144;
const ADDITIONAL_RAW_SIGN_AND_SEPARATOR_ANSWER_LEAKS = [
  ["modifier-letter plus", "\u02D63/\u02D64"],
  ["Runic-cross plus", "\u16ED3/\u16ED4"],
  ["heavy plus", "\u27953/\u27954"],
  ["Garay plus", "\u{10D8E}3/\u{10D8E}4"],
  ["division sign", "3\u00F74"],
  ["heavy division", "3\u27974"],
  ["circled division slash", "3\u22984"],
  ["box-drawing solidus", "3\u25714"],
  ["mathematical rising diagonal", "3\u27CB4"],
  ["big solidus", "3\u29F84"],
  ["circled division sign", "3\u2A384"],
  ["very heavy solidus", "3\u{1F67C}4"],
  ["divided by", "3 divided by 4"],
  ["division by", "3 division by 4"],
  ["composed heavy plus and division", "\u27953\u00F7\u27954"],
] as const;
const ADDITIONAL_URI_SIGN_AND_SEPARATOR_ANSWER_LEAKS = [
  ["URI-encoded modifier-letter plus", "%CB%963%2F%CB%964"],
  ["URI-encoded Runic-cross plus", "%E1%9B%AD3%2F%E1%9B%AD4"],
  ["URI-encoded heavy plus", "%E2%9E%953%2F%E2%9E%954"],
  ["URI-encoded Garay plus", "%F0%90%B6%8E3%2F%F0%90%B6%8E4"],
  ["URI-encoded division sign", "3%C3%B74"],
  ["URI-encoded heavy division", "3%E2%9E%974"],
  ["URI-encoded circled division slash", "3%E2%8A%984"],
  ["URI-encoded box-drawing solidus", "3%E2%95%B14"],
  ["URI-encoded mathematical rising diagonal", "3%E2%9F%8B4"],
  ["URI-encoded big solidus", "3%E2%A7%B84"],
  ["URI-encoded circled division sign", "3%E2%A8%B84"],
  ["URI-encoded very-heavy solidus", "3%F0%9F%99%BC4"],
  ["URI-encoded divided by", "3%20divided%20by%204"],
  ["URI-encoded division by", "3%20division%20by%204"],
  ["URI-encoded composed heavy plus and division", "%E2%9E%953%C3%B7%E2%9E%954"],
] as const;

function namedTextCases(
  cases: ReadonlyArray<readonly [name: string, text: string]>,
): ReadonlyArray<readonly [name: string, text: string]> {
  return cases;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("V2 sample artifact bundle", () => {
  it("binds the reviewed plan, instance, print documents, and snapshots by value", async () => {
    const fixture = await readRelationshipFixture();
    expect(() => assertArtifactRelationships(fixture)).not.toThrow();
  });

  it("rejects answer-key answer and explanation drift", async () => {
    const wrongAnswer = await readRelationshipFixture();
    const answerBlock = record(
      blocksOfType(wrongAnswer.answerKeyPrint, "answer-key")[0],
    );
    const response = arrayAt(answerBlock, "canonicalResponse")[0];
    record(response).numerator = "999";
    expect(() => assertArtifactRelationships(wrongAnswer)).toThrow(
      /answer-key canonical response/iu,
    );

    const wrongExplanation = await readRelationshipFixture();
    const explanationBlock = record(
      blocksOfType(wrongExplanation.answerKeyPrint, "answer-key")[0],
    );
    arrayAt(explanationBlock, "explanation")[0] = "Unrelated explanation.";
    expect(() => assertArtifactRelationships(wrongExplanation)).toThrow(
      /answer-key explanation/iu,
    );
  });

  it("rejects a swapped print prompt and semantic snapshot drift", async () => {
    const swappedPrompt = await readRelationshipFixture();
    const groups = blocksOfType(swappedPrompt.studentPrint, "problem-group");
    const firstProblem = record(arrayAt(record(groups[0]), "problems")[0]);
    const secondProblem = record(arrayAt(record(groups[1]), "problems")[0]);
    firstProblem.prompt = structuredClone(secondProblem.prompt);
    const answerKeyGroups = blocksOfType(swappedPrompt.answerKeyPrint, "problem-group");
    record(arrayAt(record(answerKeyGroups[0]), "problems")[0]).prompt = structuredClone(
      secondProblem.prompt,
    );
    expect(() => assertArtifactRelationships(swappedPrompt)).toThrow(
      /problem prompt/iu,
    );

    const snapshotDrift = await readRelationshipFixture();
    const snapshotProblem = record(
      arrayAt(snapshotDrift.studentSnapshot, "problems")[0],
    );
    snapshotProblem.instruction = "Drifted snapshot instruction.";
    expect(() => assertArtifactRelationships(snapshotDrift)).toThrow(
      /student semantic snapshot problem/iu,
    );
  });

  it("rejects plan scalar, generator, and selected-presentation drift", async () => {
    const scalarDrift = await readRelationshipFixture();
    scalarDrift.plan.localStudyDate = "2026-07-20";
    expect(() => assertArtifactRelationships(scalarDrift)).toThrow(
      /plan localStudyDate/iu,
    );

    const generatorDrift = await readRelationshipFixture();
    const activity = record(arrayAt(generatorDrift.plan, "activities")[0]);
    activity.generatorVersion = "999";
    expect(() => assertArtifactRelationships(generatorDrift)).toThrow(/generator/iu);

    const presentationDrift = await readRelationshipFixture();
    const selectedActivity = record(arrayAt(presentationDrift.plan, "activities")[0]);
    recordAt(selectedActivity, "presentationSelection").explanationNodeId =
      "missing-explanation";
    expect(() => assertArtifactRelationships(presentationDrift)).toThrow(
      /selected explanation/iu,
    );

    const rngDrift = await readRelationshipFixture();
    recordAt(rngDrift.instance, "rng").algorithm = "different-rng";
    expect(() => assertArtifactRelationships(rngDrift)).toThrow(/RNG algorithm/iu);
  });

  it("rejects a slot seed that is not derived from the plan and retry identity", async () => {
    const fixture = await readRelationshipFixture();
    const firstSlot = record(arrayAt(fixture.instance, "slots")[0]);
    firstSlot.slotSeed = "0".repeat(64);

    expect(() => assertArtifactRelationships(fixture)).toThrow(/slot seed/iu);
  });

  it("rejects a coherently changed answer, scoring rule, and final trace result", async () => {
    const fixture = await readRelationshipFixture();
    const firstSlot = record(arrayAt(fixture.instance, "slots")[0]);
    const wrongAnswer = { numerator: "999", denominator: "1" };
    recordAt(firstSlot, "canonicalAnswer").value = structuredClone(wrongAnswer);
    recordAt(firstSlot, "scoringRule").accepted = structuredClone(wrongAnswer);
    const finalStep = record(arrayAt(firstSlot, "solutionTrace").at(-1));
    finalStep.result = structuredClone(wrongAnswer);

    expect(() => assertArtifactRelationships(fixture)).toThrow(/exact sum/iu);
  });

  it("rejects an equivalent own-answer split fraction in student HTML", async () => {
    const fixture = await readRelationshipFixture();
    fixture.studentHtml = fixture.studentHtml.replace(
      '<div class="response-space"',
      '<span class="fraction"><span class="fraction-numerator">-6</span><span class="fraction-denominator">-8</span></span><div class="response-space"',
    );

    expect(() => assertArtifactRelationships(fixture)).toThrow(
      /canonical answer 3\/4/iu,
    );
  });

  it("rejects an own canonical answer used as an exact prompt operand", async () => {
    const fixture = await readRelationshipFixture();
    const firstSlot = record(arrayAt(fixture.instance, "slots")[0]);
    const prompt = recordAt(firstSlot, "prompt");
    prompt.left = { numerator: "3", denominator: "4" };
    prompt.accessibleText =
      "Add 3 over 4 and 1 over 2. Give the answer in lowest terms.";

    expect(() => assertArtifactRelationships(fixture)).toThrow(
      /own canonical answer/iu,
    );
  });

  it("allows cross-slot answers only as exact mapped operands", async () => {
    const fixture = await readRelationshipFixture();
    const studentPrint = structuredClone(fixture.studentPrint);
    const secondGroup = record(blocksOfType(studentPrint, "problem-group")[1]);
    const secondProblem = record(arrayAt(secondGroup, "problems")[0]);
    const secondPrompt = arrayAt(secondProblem, "prompt");
    record(secondPrompt[0]).numerator = "3";
    record(secondPrompt[0]).denominator = "4";
    record(secondPrompt[0]).accessibleText = "3 over 4";
    secondProblem.promptAccessibleText =
      "Add 3 over 4 and 7 over 8. Give the answer in lowest terms.";
    const secondFallback = record(blocksOfType(studentPrint, "print-fallback")[1]);
    const fallbackContent = recordAt(secondFallback, "content");
    fallbackContent.label = secondProblem.promptAccessibleText;
    const firstBar = record(arrayAt(fallbackContent, "bars")[0]);
    firstBar.numerator = 3;
    firstBar.label = "3/4";

    const promptMappedHtml = fixture.studentHtml
      .replace(
        'aria-label="Add 1 over 4 and 7 over 8. Give the answer in lowest terms."><span class="math-expression"',
        'aria-label="Add 3 over 4 and 7 over 8. Give the answer in lowest terms."><span class="math-expression"',
      )
      .replace(
        '<span class="fraction-numerator">1</span><span class="fraction-denominator">4</span></span><span class="operator">+</span><span class="fraction"><span class="fraction-numerator">7</span><span class="fraction-denominator">8</span>',
        '<span class="fraction-numerator">3</span><span class="fraction-denominator">4</span></span><span class="operator">+</span><span class="fraction"><span class="fraction-numerator">7</span><span class="fraction-denominator">8</span>',
      )
      .replace(
        'class="fraction-bar-diagram" role="img" aria-label="Add 1 over 4 and 7 over 8. Give the answer in lowest terms."',
        'class="fraction-bar-diagram" role="img" aria-label="Add 3 over 4 and 7 over 8. Give the answer in lowest terms."',
      );
    const secondProblemMarker = 'data-print-block-id="problem-group-002"';
    const secondProblemStart = promptMappedHtml.indexOf(secondProblemMarker);
    expect(secondProblemStart).toBeGreaterThan(-1);
    const oneQuarterRow =
      '<div class="fraction-bar-row"><span class="fraction-bar-segment filled"></span><span class="fraction-bar-segment"></span><span class="fraction-bar-segment"></span><span class="fraction-bar-segment"></span></div>';
    const threeQuarterRow =
      '<div class="fraction-bar-row"><span class="fraction-bar-segment filled"></span><span class="fraction-bar-segment filled"></span><span class="fraction-bar-segment filled"></span><span class="fraction-bar-segment"></span></div>';
    const allowedHtml = `${promptMappedHtml.slice(0, secondProblemStart)}${promptMappedHtml
      .slice(secondProblemStart)
      .replace(oneQuarterRow, threeQuarterRow)}`;
    const answersByProblemId = canonicalAnswersByProblemId(fixture.instance);

    expect(() =>
      assertRoleSensitiveHtmlHasNoAnswers(
        allowedHtml,
        studentPrint,
        answersByProblemId,
      ),
    ).not.toThrow();

    const proseLeak = `${allowedHtml.slice(0, secondProblemStart)}${allowedHtml
      .slice(secondProblemStart)
      .replace(
        "Draw equal fraction bars for both addends",
        "A previous answer is 3/4. Draw equal fraction bars for both addends",
      )}`;
    expect(() =>
      assertRoleSensitiveHtmlHasNoAnswers(proseLeak, studentPrint, answersByProblemId),
    ).toThrow(/canonical answer 3\/4/iu);
  });

  it("does not confuse a larger rational token with a substring answer", async () => {
    const fixture = await readRelationshipFixture();
    const html = fixture.studentHtml.replace(
      "Draw equal fraction bars for both addends",
      "The unrelated value 13/40 is safe here. Draw equal fraction bars for both addends",
    );
    expect(() =>
      assertRoleSensitiveHtmlHasNoAnswers(
        html,
        fixture.studentPrint,
        canonicalAnswersByProblemId(fixture.instance),
      ),
    ).not.toThrow();
  });

  it("normalizes fullwidth rational text before checking student HTML", async () => {
    const fixture = await readRelationshipFixture();
    const html = fixture.studentHtml.replace(
      "Draw equal fraction bars for both addends",
      "A leaked equivalent is ３／４. Draw equal fraction bars for both addends",
    );
    expect(() =>
      assertRoleSensitiveHtmlHasNoAnswers(
        html,
        fixture.studentPrint,
        canonicalAnswersByProblemId(fixture.instance),
      ),
    ).toThrow(/canonical answer 3\/4/iu);
  });

  it.each(
    namedTextCases([
      ["overlapping slash suffix", "1/3/4"],
      ["URI-encoded slash", "3%2F4"],
      ["unquoted object keys", "{numerator:3,denominator:4}"],
      ["Unicode mathematical minus", "−3/−4"],
      ["heavy minus", "➖3/➖4"],
      ["modifier letter minus", "˗3/˗4"],
      ["hyphen bullet", "\u20433/\u20434"],
      ["Garay minus", "\u{10D8F}3/\u{10D8F}4"],
      ["default-ignorable separators", "3\u200B/\u200B4"],
      ["URI-encoded Unicode mathematical minus", "%E2%88%923%2F%E2%88%924"],
      ["URI-encoded heavy minus", "%E2%9E%963%2F%E2%9E%964"],
      ["URI-encoded modifier letter minus", "%CB%973%2F%CB%974"],
      ["URI-encoded hyphen bullet", "%E2%81%833%2F%E2%81%834"],
      ["URI-encoded Garay minus", "%F0%90%B6%8F3%2F%F0%90%B6%8F4"],
      ["URI-encoded default ignorables", "3%E2%80%8B%2F%E2%80%8B4"],
      ...ADDITIONAL_RAW_SIGN_AND_SEPARATOR_ANSWER_LEAKS,
      ...ADDITIONAL_URI_SIGN_AND_SEPARATOR_ANSWER_LEAKS,
    ]),
  )("rejects a canonical answer hidden as %s", async (_case, leak) => {
    const fixture = await readRelationshipFixture();
    const html = fixture.studentHtml.replace(
      "Draw equal fraction bars for both addends",
      `A leaked value is ${leak}. Draw equal fraction bars for both addends`,
    );
    expect(() =>
      assertRoleSensitiveHtmlHasNoAnswers(
        html,
        fixture.studentPrint,
        canonicalAnswersByProblemId(fixture.instance),
      ),
    ).toThrow(/canonical answer 3\/4/iu);
  });

  it("checks an own answer in the mapped prompt accessible label", async () => {
    const fixture = await readRelationshipFixture();
    const studentPrint = structuredClone(fixture.studentPrint);
    const firstProblem = record(
      arrayAt(record(blocksOfType(studentPrint, "problem-group")[0]), "problems")[0],
    );
    firstProblem.promptAccessibleText = "Add 1 over 4 and 1 over 2. The answer is 3/4.";

    expect(() =>
      assertRoleSensitiveHtmlHasNoAnswers(
        fixture.studentHtml,
        studentPrint,
        canonicalAnswersByProblemId(fixture.instance),
      ),
    ).toThrow(/canonical answer 3\/4/iu);
  });

  it.each(
    namedTextCases([
      ["Unicode-minus answer", "−3/−4"],
      ["heavy-minus answer", "➖3/➖4"],
      ["modifier-letter-minus answer", "˗3/˗4"],
      ["hyphen-bullet answer", "\u20433/\u20434"],
      ["Garay-minus answer", "\u{10D8F}3/\u{10D8F}4"],
      ["default-ignorable answer", "3\u200B/\u200B4"],
      ["URI-encoded Unicode-minus answer", "%E2%88%923%2F%E2%88%924"],
      ["URI-encoded heavy-minus answer", "%E2%9E%963%2F%E2%9E%964"],
      ["URI-encoded modifier-letter-minus answer", "%CB%973%2F%CB%974"],
      ["URI-encoded hyphen-bullet answer", "%E2%81%833%2F%E2%81%834"],
      ["URI-encoded Garay-minus answer", "%F0%90%B6%8F3%2F%F0%90%B6%8F4"],
      ["URI-encoded default-ignorable answer", "3%E2%80%8B%2F%E2%80%8B4"],
      ...ADDITIONAL_RAW_SIGN_AND_SEPARATOR_ANSWER_LEAKS,
      ...ADDITIONAL_URI_SIGN_AND_SEPARATOR_ANSWER_LEAKS,
    ]),
  )("checks an own %s in prompt accessible text", async (_case, leak) => {
    const fixture = await readRelationshipFixture();
    const studentPrint = structuredClone(fixture.studentPrint);
    const firstProblem = record(
      arrayAt(record(blocksOfType(studentPrint, "problem-group")[0]), "problems")[0],
    );
    firstProblem.promptAccessibleText = `The answer is ${leak}.`;

    expect(() =>
      assertRoleSensitiveHtmlHasNoAnswers(
        fixture.studentHtml,
        studentPrint,
        canonicalAnswersByProblemId(fixture.instance),
      ),
    ).toThrow(/canonical answer 3\/4/iu);
  });

  it.each([
    ["raw", "\u202E4/3\u202C"],
    ["URI-encoded", "%E2%80%AE4%2F3%E2%80%AC"],
  ])(
    "fails closed on %s bidi controls that can visually reorder student HTML",
    async (_case, value) => {
      const fixture = await readRelationshipFixture();
      const html = fixture.studentHtml.replace(
        "Draw equal fraction bars for both addends",
        `The reordered value is ${value}. Draw equal fraction bars for both addends`,
      );

      expect(() =>
        assertRoleSensitiveHtmlHasNoAnswers(
          html,
          fixture.studentPrint,
          canonicalAnswersByProblemId(fixture.instance),
        ),
      ).toThrow(/unsupported bidi control/iu);
    },
  );

  it("rejects student and key HTML semantic drift", async () => {
    const instructionDrift = await readRelationshipFixture();
    instructionDrift.studentHtml = instructionDrift.studentHtml.replace(
      "Add each pair of fractions. Give every answer in lowest terms.",
      "Changed instruction.",
    );
    expect(() => assertArtifactRelationships(instructionDrift)).toThrow(
      /studentHtml main content/iu,
    );

    const fallbackDrift = await readRelationshipFixture();
    fallbackDrift.studentHtml = fallbackDrift.studentHtml.replace(
      "Draw equal fraction bars for both addends",
      "Changed fallback caption",
    );
    expect(() => assertArtifactRelationships(fallbackDrift)).toThrow(
      /studentHtml main content/iu,
    );

    const keyDrift = await readRelationshipFixture();
    keyDrift.answerKeyHtml = keyDrift.answerKeyHtml.replace(
      "Use 4 as the least common denominator.",
      "Changed key explanation.",
    );
    expect(() => assertArtifactRelationships(keyDrift)).toThrow(
      /answerKeyHtml main content/iu,
    );

    const attributionDrift = await readRelationshipFixture();
    attributionDrift.studentHtml = attributionDrift.studentHtml.replace(
      "Draft original lesson by Exercise Book contributors.",
      "Changed attribution.",
    );
    expect(() => assertArtifactRelationships(attributionDrift)).toThrow(
      /studentHtml main content/iu,
    );
  });

  it("verifies a byte-exact copy of the reviewed bundle", async () => {
    const bundle = await copyGoldenBundle();

    await expect(runNode(verifierPath, bundle)).resolves.toMatchObject({
      code: 0,
      stderr: "",
    });
  });

  it("rejects tampered, missing, and unmanifested artifact bytes", async () => {
    const tampered = await copyGoldenBundle();
    const manifest = await readManifest(tampered);
    const studentHtml = manifest.artifacts.studentHtml.filename;
    await writeFile(join(tampered, studentHtml), "tampered", "utf8");
    await expect(runNode(verifierPath, tampered)).resolves.toMatchObject({ code: 1 });

    const missing = await copyGoldenBundle();
    await rm(join(missing, studentHtml));
    await expect(runNode(verifierPath, missing)).resolves.toMatchObject({ code: 1 });

    const extra = await copyGoldenBundle();
    await writeFile(join(extra, "unmanifested.txt"), "stale", "utf8");
    const result = await runNode(verifierPath, extra);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unmanifested.txt");
  });

  it("rejects symlinked artifacts without following them", async () => {
    if (process.platform === "win32") {
      return;
    }
    const bundle = await copyGoldenBundle();
    const manifest = await readManifest(bundle);
    const studentHtml = manifest.artifacts.studentHtml.filename;
    const artifactPath = join(bundle, studentHtml);
    await rm(artifactPath);
    await symlink(join(goldenDirectory, studentHtml), artifactPath);

    const result = await runNode(verifierPath, bundle);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/ELOOP|symbolic link/iu);

    const parent = await createTemporaryDirectory();
    const output = join(parent, "bundle");
    const first = await runNode(tsxCliPath, rendererPath, "--", output);
    expect(first.code).toBe(0);
    const report = JSON.parse(first.stdout) as RenderReport;
    const target = report.artifacts.find((artifact) =>
      artifact.filename.endsWith(".student.html"),
    );
    expect(target).toBeDefined();
    if (target === undefined) {
      throw new Error("The generated bundle has no student HTML artifact.");
    }
    const original = await readFile(target.path);
    const externalTarget = join(parent, "external-student.html");
    await writeFile(externalTarget, original);
    await rm(target.path);
    await symlink(externalTarget, target.path);

    const replayed = await runNode(tsxCliPath, rendererPath, "--", output);
    expect(replayed.code).toBe(1);
    expect(replayed.stderr).toMatch(/ELOOP|symbolic link/iu);
    await expect(readFile(externalTarget)).resolves.toEqual(original);
  });

  it("rejects FIFO artifacts promptly in verification and immutable replay", async () => {
    if (process.platform === "win32") {
      return;
    }

    const bundle = await copyGoldenBundle();
    const manifest = await readManifest(bundle);
    const studentHtml = manifest.artifacts.studentHtml.filename;
    const artifactPath = join(bundle, studentHtml);
    await rm(artifactPath);
    await createFifo(artifactPath);

    const verified = await runNodeWithTimeout(10_000, verifierPath, bundle);
    expect(verified.timedOut).toBe(false);
    expect(verified.code).toBe(1);
    expect(verified.stderr).toContain("must be a regular file");

    const parent = await createTemporaryDirectory();
    const output = join(parent, "bundle");
    const first = await runNode(tsxCliPath, rendererPath, "--", output);
    expect(first.code).toBe(0);
    const report = JSON.parse(first.stdout) as RenderReport;
    const target = report.artifacts.find((artifact) =>
      artifact.filename.endsWith(".student.html"),
    );
    expect(target).toBeDefined();
    if (target === undefined) {
      throw new Error("The generated bundle has no student HTML artifact.");
    }
    await rm(target.path);
    await createFifo(target.path);

    const replayed = await runNodeWithTimeout(
      10_000,
      tsxCliPath,
      rendererPath,
      "--",
      output,
    );
    expect(replayed.timedOut).toBe(false);
    expect(replayed.code).toBe(1);
    expect(replayed.stderr).toContain("is not a regular file");
  });

  it("rejects oversized or nondeterministically encoded manifests before trust", async () => {
    const oversized = await copyGoldenBundle();
    await writeFile(join(oversized, "manifest.json"), " ".repeat(65_537), "utf8");
    const oversizedResult = await runNode(verifierPath, oversized);
    expect(oversizedResult.code).toBe(1);
    expect(oversizedResult.stderr).toContain("exceeds 65536 bytes");

    const reencoded = await copyGoldenBundle();
    const manifest = await readManifest(reencoded);
    await writeFile(join(reencoded, "manifest.json"), JSON.stringify(manifest), "utf8");
    const reencodedResult = await runNode(verifierPath, reencoded);
    expect(reencodedResult.code).toBe(1);
    expect(reencodedResult.stderr).toContain("exact deterministic encoding");
  });

  it("rejects parent-identity and descriptor-path drift", async () => {
    const parentDrift = await copyGoldenBundle();
    const parentManifest = await readManifest(parentDrift);
    parentManifest.planId = `preview-${"0".repeat(64)}`;
    await writeManifest(parentDrift, parentManifest);
    await expect(runNode(verifierPath, parentDrift)).resolves.toMatchObject({
      code: 1,
    });

    const unsafePath = await copyGoldenBundle();
    const pathManifest = await readManifest(unsafePath);
    pathManifest.artifacts.studentHtml.filename = "../student.html";
    await writeManifest(unsafePath, pathManifest);
    await expect(runNode(verifierPath, unsafePath)).resolves.toMatchObject({ code: 1 });
  });

  it("publishes a complete immutable bundle and replays every artifact unchanged", async () => {
    const parent = await createTemporaryDirectory();
    const output = join(parent, "bundle");
    const first = await runNode(tsxCliPath, rendererPath, "--", output);
    expect(first).toMatchObject({ code: 0, stderr: "" });
    const firstReport = JSON.parse(first.stdout) as RenderReport;
    expect(
      firstReport.artifacts.every((artifact) => artifact.status === "created"),
    ).toBe(true);

    const second = await runNode(tsxCliPath, rendererPath, "--", output);
    expect(second).toMatchObject({ code: 0, stderr: "" });
    const secondReport = JSON.parse(second.stdout) as RenderReport;
    expect(
      secondReport.artifacts.every((artifact) => artifact.status === "unchanged"),
    ).toBe(true);
    await expect(runNode(verifierPath, output)).resolves.toMatchObject({ code: 0 });
  });

  it("never overwrites a conflicting immutable artifact", async () => {
    const parent = await createTemporaryDirectory();
    const output = join(parent, "bundle");
    const first = await runNode(tsxCliPath, rendererPath, "--", output);
    expect(first.code).toBe(0);
    const report = JSON.parse(first.stdout) as RenderReport;
    const target = report.artifacts.find((artifact) =>
      artifact.filename.endsWith(".student.html"),
    );
    expect(target).toBeDefined();
    if (target === undefined) {
      throw new Error("The generated bundle has no student HTML artifact.");
    }
    const original = await readFile(target.path);
    expect(original.byteLength).toBeGreaterThan(0);
    const conflicting = Buffer.from(original);
    const mutationIndex = Math.floor(conflicting.byteLength / 2);
    const originalByte = conflicting[mutationIndex];
    if (originalByte === undefined) {
      throw new Error("The generated student HTML artifact is empty.");
    }
    conflicting[mutationIndex] = originalByte ^ 1;
    await writeFile(target.path, conflicting);

    const second = await runNode(tsxCliPath, rendererPath, "--", output);
    expect(second.code).toBe(1);
    expect(second.stderr).toContain("Refusing to overwrite immutable output");
    await expect(readFile(target.path)).resolves.toEqual(conflicting);
  });

  it("bounds reads of oversized conflicting immutable artifacts", async () => {
    const parent = await createTemporaryDirectory();
    const output = join(parent, "bundle");
    const first = await runNode(tsxCliPath, rendererPath, "--", output);
    expect(first.code).toBe(0);
    const report = JSON.parse(first.stdout) as RenderReport;
    const target = report.artifacts.find((artifact) =>
      artifact.filename.endsWith(".student.html"),
    );
    expect(target).toBeDefined();
    if (target === undefined) {
      throw new Error("The generated bundle has no student HTML artifact.");
    }
    await writeFile(target.path, "x".repeat(1_000_000), "utf8");

    const second = await runNodeWithTimeout(
      10_000,
      tsxCliPath,
      rendererPath,
      "--",
      output,
    );
    expect(second.timedOut).toBe(false);
    expect(second.code).toBe(1);
    expect(second.stderr).toContain("exceeds its expected size");
  });

  it("reads only bounded, strictly encoded regular Markdown sources", async () => {
    const directory = await createTemporaryDirectory();
    const valid = join(directory, "valid.md");
    await writeFile(valid, "# Fractions\n\nAdd 1/2 and 1/3.\n", "utf8");
    await expect(readBoundedRegularUtf8File(valid)).resolves.toBe(
      "# Fractions\n\nAdd 1/2 and 1/3.\n",
    );

    const oversized = join(directory, "oversized.md");
    await writeFile(oversized, Buffer.alloc(MAX_SAMPLE_SOURCE_BYTES + 1, 0x61));
    await expect(readBoundedRegularUtf8File(oversized)).rejects.toThrow(
      /exceeds 262144 bytes/iu,
    );

    const invalidUtf8 = join(directory, "invalid-utf8.md");
    await writeFile(invalidUtf8, Buffer.from([0x23, 0x20, 0xc3, 0x28, 0x0a]));
    await expect(readBoundedRegularUtf8File(invalidUtf8)).rejects.toThrow(
      /valid UTF-8/iu,
    );
  });

  it("rejects symlinked and FIFO Markdown sources without following or blocking", async () => {
    if (process.platform === "win32") {
      return;
    }

    const directory = await createTemporaryDirectory();
    const regular = join(directory, "regular.md");
    const linked = join(directory, "linked.md");
    await writeFile(regular, "# Fractions\n", "utf8");
    await symlink(regular, linked);
    await expect(readBoundedRegularUtf8File(linked)).rejects.toThrow(
      /ELOOP|symbolic link/iu,
    );

    const fifo = join(directory, "source.fifo");
    await createFifo(fifo);
    const probe = join(directory, "read-source-probe.ts");
    await writeFile(
      probe,
      [
        `import { readBoundedRegularUtf8File } from ${JSON.stringify(pathToFileURL(rendererPath).href)};`,
        "void readBoundedRegularUtf8File(process.argv[2]!).catch((error: unknown) => {",
        "  console.error(error);",
        "  process.exitCode = 1;",
        "});",
      ].join("\n"),
      "utf8",
    );
    const result = await runNodeWithTimeout(5_000, tsxCliPath, probe, fifo);
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("must be a regular file");
  });
});

interface MutableManifest {
  planId: string;
  artifacts: {
    studentHtml: {
      filename: string;
    };
  };
}

interface RenderReport {
  readonly artifacts: readonly {
    readonly filename: string;
    readonly path: string;
    readonly status: "created" | "unchanged";
  }[];
}

type MutableJsonRecord = Record<string, unknown>;

interface RelationshipFixture {
  manifest: MutableJsonRecord;
  content: MutableJsonRecord;
  plan: MutableJsonRecord;
  instance: MutableJsonRecord;
  studentPrint: MutableJsonRecord;
  answerKeyPrint: MutableJsonRecord;
  studentSnapshot: MutableJsonRecord;
  answerKeySnapshot: MutableJsonRecord;
  studentHtml: string;
  answerKeyHtml: string;
}

interface RelationshipVerifierModule {
  assertArtifactRelationships(fixture: RelationshipFixture): void;
  assertRoleSensitiveHtmlHasNoAnswers(
    html: string,
    studentPrint: MutableJsonRecord,
    answersByProblemId: ReadonlyMap<string, unknown>,
  ): void;
}

async function readRelationshipFixture(): Promise<RelationshipFixture> {
  const manifest = record(
    JSON.parse(await readFile(join(goldenDirectory, "manifest.json"), "utf8")),
  );
  const artifacts = recordAt(manifest, "artifacts");
  const readArtifactJson = async (key: string): Promise<MutableJsonRecord> => {
    const descriptor = recordAt(artifacts, key);
    return record(
      JSON.parse(
        await readFile(join(goldenDirectory, stringAt(descriptor, "filename")), "utf8"),
      ),
    );
  };
  const readArtifactText = async (key: string): Promise<string> => {
    const descriptor = recordAt(artifacts, key);
    return readFile(join(goldenDirectory, stringAt(descriptor, "filename")), "utf8");
  };
  const [
    content,
    plan,
    instance,
    studentPrint,
    answerKeyPrint,
    studentSnapshot,
    answerKeySnapshot,
    studentHtml,
    answerKeyHtml,
  ] = await Promise.all([
    readArtifactJson("contentDocument"),
    readArtifactJson("dailyPlan"),
    readArtifactJson("canonicalInstance"),
    readArtifactJson("studentPrintDocument"),
    readArtifactJson("answerKeyPrintDocument"),
    readArtifactJson("studentSemanticSnapshot"),
    readArtifactJson("answerKeySemanticSnapshot"),
    readArtifactText("studentHtml"),
    readArtifactText("answerKeyHtml"),
  ]);
  return {
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
  };
}

function canonicalAnswersByProblemId(
  instance: MutableJsonRecord,
): ReadonlyMap<string, unknown> {
  return new Map(
    arrayAt(instance, "slots").map((slot) => {
      const slotRecord = record(slot);
      return [
        stringAt(slotRecord, "id"),
        recordAt(recordAt(slotRecord, "canonicalAnswer"), "value"),
      ];
    }),
  );
}

function blocksOfType(document: MutableJsonRecord, type: string): MutableJsonRecord[] {
  return arrayAt(document, "blocks")
    .map((block) => record(block))
    .filter((block) => block.type === type);
}

function record(value: unknown): MutableJsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object in the reviewed fixture.");
  }
  return value as MutableJsonRecord;
}

function recordAt(value: MutableJsonRecord, key: string): MutableJsonRecord {
  return record(value[key]);
}

function arrayAt(value: MutableJsonRecord, key: string): unknown[] {
  const child = value[key];
  if (!Array.isArray(child)) {
    throw new Error(`Expected ${key} to be an array in the reviewed fixture.`);
  }
  return child;
}

function stringAt(value: MutableJsonRecord, key: string): string {
  const child = value[key];
  if (typeof child !== "string") {
    throw new Error(`Expected ${key} to be a string in the reviewed fixture.`);
  }
  return child;
}

async function copyGoldenBundle(): Promise<string> {
  const parent = await createTemporaryDirectory();
  const bundle = join(parent, "bundle");
  await cp(goldenDirectory, bundle, { recursive: true });
  return bundle;
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "exercisebook-print-v2-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function readManifest(directory: string): Promise<MutableManifest> {
  return JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  ) as MutableManifest;
}

async function writeManifest(
  directory: string,
  manifest: MutableManifest,
): Promise<void> {
  await writeFile(
    join(directory, "manifest.json"),
    `${JSON.stringify(manifest, undefined, 2)}\n`,
    "utf8",
  );
}

async function runNode(
  entrypoint: string,
  ...arguments_: readonly string[]
): Promise<Readonly<{ code: number; stdout: string; stderr: string }>> {
  const result = await runChild(30_000, entrypoint, arguments_);
  if (result.timedOut) {
    throw new Error(`Child process ${entrypoint} exceeded 30000ms.`);
  }
  return { code: result.code, stdout: result.stdout, stderr: result.stderr };
}

async function runNodeWithTimeout(
  timeoutMs: number,
  entrypoint: string,
  ...arguments_: readonly string[]
): Promise<
  Readonly<{ code: number; stdout: string; stderr: string; timedOut: boolean }>
> {
  return runChild(timeoutMs, entrypoint, arguments_);
}

async function runChild(
  timeoutMs: number | undefined,
  entrypoint: string,
  arguments_: readonly string[],
): Promise<
  Readonly<{ code: number; stdout: string; stderr: string; timedOut: boolean }>
> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [entrypoint, ...arguments_], {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      if (signal !== null && !timedOut) {
        reject(new Error(`Child process terminated by ${signal}.`));
        return;
      }
      resolvePromise({ code: code ?? 1, stdout, stderr, timedOut });
    });
  });
}

async function createFifo(path: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("mkfifo", [path], {
      cwd: repositoryRoot,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal !== null) {
        reject(new Error(`mkfifo terminated by ${signal}.`));
      } else if (code !== 0) {
        reject(new Error(`mkfifo failed: ${stderr}`));
      } else {
        resolvePromise();
      }
    });
  });
}
