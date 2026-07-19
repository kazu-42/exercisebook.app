import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import {
  projectWorksheetForStudent,
  validateWorksheetInstanceV1,
  type MaterializedWorksheetInstanceV1,
} from "@exercisebook/schemas";
import { describe, expect, it } from "vitest";

import {
  projectAnswerKeyWorksheetForWeb,
  projectStudentWorksheetForWeb,
} from "./web-worksheet-projector.js";

const hash = "0".repeat(64);

async function createMaterializedFixture(): Promise<MaterializedWorksheetInstanceV1> {
  const instance = validateWorksheetInstanceV1({
    schema: "exercisebook.worksheet-instance/v1",
    assignmentId: "assignment.web-projector",
    title: "Adding fractions with unlike denominators",
    localStudyDate: "2026-07-19",
    timeZone: "Asia/Tokyo",
    locale: "en",
    expectedMinutes: 4,
    plan: { id: "plan.sample", version: 1 },
    policy: { id: "policy.sample", version: 1 },
    skillGraph: { id: "math.fractions", revision: 1 },
    rng: {
      algorithm: "xoshiro128ss-v1",
      baseSeed: "1".repeat(64),
      seedSecretVersion: "public-sample",
    },
    content: [
      {
        id: "fractions.add-unlike",
        revision: 1,
        sourceHash: hash,
        contentHash: "3".repeat(64),
        compilerVersion: "exercisebook-content-compiler/1",
      },
    ],
    slots: [
      {
        id: "practice-01",
        skillIds: ["math.fractions.add"],
        slotSeed: "2".repeat(64),
        selectionReasons: ["current-frontier"],
        expectedMinutes: 4,
        prompt: {
          type: "fraction-addition",
          instruction: "Rename the fractions, then add.",
          left: { numerator: "1", denominator: "4" },
          right: { numerator: "1", denominator: "3" },
          accessibleText: "one fourth plus one third",
        },
        canonicalAnswer: {
          type: "rational",
          value: { numerator: "7", denominator: "12" },
        },
        scoringRule: {
          type: "rational-equals",
          accepted: { numerator: "7", denominator: "12" },
          requireReduced: true,
        },
        hints: [{ id: "hint-01", text: "Find a multiple of 4 and 3." }],
        solutionTrace: [
          {
            id: "solution-01",
            kind: "common-denominator",
            explanation: "The least common denominator is 12.",
            expression: "lcd(4,3)=12",
            accessibleText: "The least common denominator is twelve.",
          },
          {
            id: "solution-02",
            kind: "add-numerators",
            explanation: "Add three twelfths and four twelfths.",
            expression: "3/12 + 4/12 = 7/12",
            accessibleText: "Three twelfths plus four twelfths is seven twelfths.",
            result: { numerator: "7", denominator: "12" },
          },
        ],
        misconceptions: [
          {
            id: "add-denominators",
            description: "Adds both denominators.",
            incorrectAnswer: { numerator: "2", denominator: "7" },
          },
        ],
        accessibility: {
          summary: "Add one fourth and one third.",
        },
        printFallback: {
          type: "text",
          text: "Write one reduced fraction.",
        },
        provenance: {
          contentId: "fractions.add-unlike",
          contentRevision: 1,
          sourceHash: hash,
          contentHash: "3".repeat(64),
          compilerVersion: "exercisebook-content-compiler/1",
          generatorId: "fractions.add",
          generatorVersion: "1",
          generationAttempt: 0,
        },
      },
    ],
    attributions: [
      {
        title: "Adding unlike denominators",
        author: "Exercise Book contributors",
        sourceUrl: "https://exercisebook.app/",
        licenseId: "LicenseRef-ExerciseBook-Draft",
        attributionText: "Exercise Book original lesson",
        publicationStatus: "draft",
        modifications: [],
      },
    ],
  });
  const canonicalJson = canonicalizeJson(instance);

  return {
    instance,
    canonicalJson,
    instanceHash: await sha256Hex(canonicalJson),
  };
}

describe("Web worksheet projector", () => {
  it("uses the integrity-checked student delivery and never reintroduces secrets", async () => {
    const materialized = await createMaterializedFixture();
    const delivery = await projectWorksheetForStudent(materialized);
    const worksheet = projectStudentWorksheetForWeb(delivery);
    const serialized = JSON.stringify(worksheet);

    expect(worksheet.instanceHash).toBe(materialized.instanceHash);
    expect(worksheet.items.map((item) => item.id)).toEqual(["practice-01"]);
    expect(serialized).not.toContain("baseSeed");
    expect(serialized).not.toContain("slotSeed");
    expect(serialized).not.toContain("canonicalAnswer");
    expect(serialized).not.toContain("scoringRule");
    expect(serialized).not.toContain("solutionTrace");
    expect(serialized).not.toContain("misconceptions");
    expect(serialized).not.toContain("7/12");
  });

  it("projects the explicit answer key from the same materialized instance", async () => {
    const materialized = await createMaterializedFixture();
    const worksheet = await projectAnswerKeyWorksheetForWeb(materialized);

    expect(worksheet.variant).toBe("answer-key");
    expect(worksheet.items[0]?.answer).toEqual({
      numerator: "7",
      denominator: "12",
      accessibleText: "Three twelfths plus four twelfths is seven twelfths.",
    });
    expect(worksheet.attributions).toEqual([
      {
        label: "Exercise Book original lesson",
        license: "LicenseRef-ExerciseBook-Draft · draft",
      },
    ]);
  });
});
