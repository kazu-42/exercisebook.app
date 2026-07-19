import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { z, type ZodType } from "zod";

import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";

import {
  AttributionV1Schema,
  CANONICAL_INTEGER_PATTERN,
  CanonicalIntegerStringSchema,
  CONTENT_DOCUMENT_V1_RUNTIME_INVARIANTS,
  ContentDocumentV1Schema,
  HttpUrlSchema,
  LocalDateSchema,
  LocaleSchema,
  MAX_CANONICAL_INTEGER_DIGITS,
  MAX_SAFE_DATA_NODES,
  MAX_SAFE_DATA_STRING_CODE_UNITS,
  RationalJsonSchema,
  SlotProvenanceV1Schema,
  TimeZoneSchema,
  WORKSHEET_INSTANCE_V1_RUNTIME_INVARIANTS,
  WorksheetInstanceV1Schema,
  assertSafeDataObjectGraph,
  deriveFractionAdditionAccessibilitySummary,
  deriveFractionAdditionPromptAccessibleText,
  derivePhase1MathAccessibleText,
  projectWorksheetForStudent,
  validateContentDocumentV1,
  validateWorksheetInstanceV1,
} from "./index.js";
import { projectWorksheetForStudentWithCanonicalAnswers } from "./trusted-student-projection.js";

interface SchemaFixture {
  readonly fileUrl: URL;
  readonly id: string;
  readonly schema: ZodType;
  readonly runtimeInvariants: readonly string[];
}

const fixtures: readonly SchemaFixture[] = [
  {
    fileUrl: new URL("../json-schema/content-document-v1.schema.json", import.meta.url),
    id: "https://exercisebook.app/schemas/content-document-v1.schema.json",
    schema: ContentDocumentV1Schema,
    runtimeInvariants: CONTENT_DOCUMENT_V1_RUNTIME_INVARIANTS,
  },
  {
    fileUrl: new URL(
      "../json-schema/worksheet-instance-v1.schema.json",
      import.meta.url,
    ),
    id: "https://exercisebook.app/schemas/worksheet-instance-v1.schema.json",
    schema: WorksheetInstanceV1Schema,
    runtimeInvariants: WORKSHEET_INSTANCE_V1_RUNTIME_INVARIANTS,
  },
];

describe("structural JSON Schema and normative Zod runtime contracts", () => {
  it.each([null, 42, ["1"], new String("1")])(
    "rejects non-primitive runtime safe-math source input: %j",
    (source) => {
      expect(() => derivePhase1MathAccessibleText(source as unknown as string)).toThrow(
        "primitive string",
      );
    },
  );

  it.each(fixtures)(
    "keeps $id byte-equivalent to the checked-in Zod 4 projection",
    async (fixture) => {
      const committed = JSON.parse(await readFile(fixture.fileUrl, "utf8")) as unknown;
      const generated = {
        ...z.toJSONSchema(fixture.schema, {
          io: "output",
          reused: "ref",
          target: "draft-2020-12",
          unrepresentable: "throw",
        }),
        $id: fixture.id,
        "x-exercisebook-runtime-invariants": fixture.runtimeInvariants,
      };

      expect(committed).toEqual(generated);
    },
  );

  it("rejects invalid Gregorian dates without the Date year-0-to-99 coercion", () => {
    expect(LocalDateSchema.safeParse("0000-02-29").success).toBe(false);
    expect(LocalDateSchema.safeParse("0099-01-01").success).toBe(true);
    expect(LocalDateSchema.safeParse("1900-02-29").success).toBe(false);
    expect(LocalDateSchema.safeParse("2000-02-29").success).toBe(true);
    expect(LocalDateSchema.safeParse("2026-99-99").success).toBe(false);
  });

  it("rejects a time zone that the runtime does not recognize as IANA", () => {
    expect(TimeZoneSchema.safeParse("Asia/Tokyo").success).toBe(true);
    expect(TimeZoneSchema.safeParse("Mars/Olympus").success).toBe(false);
  });

  it.each(["en", "ja-JP", "en-US-u-nu-latn"])(
    "accepts a canonical BCP 47 locale tag: %s",
    (value) => {
      expect(LocaleSchema.safeParse(value).success).toBe(true);
    },
  );

  it.each(["en-AB-CD", "ja-jp", "iw"])(
    "rejects an invalid or noncanonical locale tag: %s",
    (value) => {
      expect(LocaleSchema.safeParse(value).success).toBe(false);
    },
  );

  it.each([
    { numerator: "2", denominator: "4" },
    { numerator: "1", denominator: "0" },
    { numerator: "01", denominator: "2" },
    { numerator: "-0", denominator: "1" },
  ])("rejects a noncanonical rational: %j", (value) => {
    expect(RationalJsonSchema.safeParse(value).success).toBe(false);
  });

  it("bounds canonical integers before rational BigInt/GCD validation", () => {
    expect(MAX_CANONICAL_INTEGER_DIGITS).toBe(128);

    const positiveBoundary = "9".repeat(128);
    const negativeBoundary = `-${positiveBoundary}`;
    expect(CanonicalIntegerStringSchema.safeParse(positiveBoundary).success).toBe(true);
    expect(CanonicalIntegerStringSchema.safeParse(negativeBoundary).success).toBe(true);
    expect(
      RationalJsonSchema.safeParse({
        numerator: positiveBoundary,
        denominator: "1",
      }).success,
    ).toBe(true);

    expect(CanonicalIntegerStringSchema.safeParse("9".repeat(129)).success).toBe(false);
    expect(CanonicalIntegerStringSchema.safeParse("9".repeat(100_000)).success).toBe(
      false,
    );
  });

  it("encodes the machine-representable integer rules, including negative zero", () => {
    const structuralPattern = new RegExp(CANONICAL_INTEGER_PATTERN);
    expect(structuralPattern.test("0")).toBe(true);
    expect(structuralPattern.test("-1")).toBe(true);
    expect(structuralPattern.test("-0")).toBe(false);
    expect(structuralPattern.test("01")).toBe(false);
    expect(structuralPattern.test("9".repeat(129))).toBe(false);
  });

  it("enumerates every semantic invariant that structural JSON Schema cannot enforce", () => {
    expect(CONTENT_DOCUMENT_V1_RUNTIME_INVARIANTS).toEqual([
      "Original input is a plain data-object graph limited to 50,000 graph nodes, depth 128, and 1,000,000 aggregate property-name and string-value code units, with valid Unicode and without prototype-sensitive own keys, accessors, symbols, or cycles.",
      "Every math node uses the bounded Phase-1 math language and its accessibleText equals the deterministic derivation from source.",
      "Content node IDs are unique.",
      "Taught skill IDs and prerequisite IDs are unique within their respective lists.",
      "A prerequisite is not duplicated in the taught skill list.",
      "Comma-separated author names fit the 240-character worksheet attribution author field.",
      "License source URLs use HTTP(S) and contain no credentials.",
      "locale is a canonical BCP 47 tag accepted by Intl.Locale.",
    ]);
    expect(WORKSHEET_INSTANCE_V1_RUNTIME_INVARIANTS).toEqual([
      "Original input is a plain data-object graph limited to 50,000 graph nodes, depth 128, and 1,000,000 aggregate property-name and string-value code units, with valid Unicode and without prototype-sensitive own keys, accessors, symbols, or cycles.",
      "Slot IDs are unique.",
      "Each slot has unique skill IDs, selection reasons, hint IDs, solution-step IDs, and misconception IDs.",
      "The scoring rule equals the canonical answer.",
      "The final solution result equals the canonical answer.",
      "Top-level expectedMinutes equals the sum of slot expectedMinutes.",
      "Top-level content references are unique by content ID and revision.",
      "Each slot provenance content ID, revision, source hash, compiled content hash, and compiler version matches exactly one top-level content reference.",
      "localStudyDate is a real Gregorian calendar date.",
      "timeZone is recognized as an IANA time-zone identifier by the runtime.",
      "locale is a canonical BCP 47 tag accepted by Intl.Locale.",
      "Rational values are reduced and have positive denominators.",
      "Attribution source URLs use HTTP(S) and contain no credentials.",
      "Student delivery projection rejects recognized canonical-answer representations in visible strings.",
    ]);
  });

  it("rejects unknown fields at the content boundary", () => {
    const schema = ContentDocumentV1Schema.safeParse({
      schema: "exercisebook.content-ast/v1",
      unknown: true,
    });
    expect(schema.success).toBe(false);
    if (!schema.success) {
      expect(
        schema.error.issues.some((issue) => issue.code === "unrecognized_keys"),
      ).toBe(true);
    }
  });

  it.each(["__proto__", "constructor", "prototype"])(
    "rejects a JSON own property that Zod could otherwise strip: %s",
    (key) => {
      const topLevel = JSON.parse(`{"${key}":"blocked"}`) as unknown;
      const nested = JSON.parse(`{"safe":{"${key}":"blocked"}}`) as unknown;

      expect(() => assertSafeDataObjectGraph(topLevel)).toThrow(
        "Forbidden data property",
      );
      expect(() => assertSafeDataObjectGraph(nested)).toThrow(
        "Forbidden data property",
      );
    },
  );

  it("runs the dangerous-key guard before exported content and worksheet validators", () => {
    const content = contentDocumentFixture("https://example.org/source") as Record<
      string,
      unknown
    >;
    content.license = JSON.parse(
      '{"licenseId":"CC-BY-4.0","sourceUrl":"https://example.org/source","attributionText":"Exercisebook content.","copyrightHolder":"Exercisebook","__proto__":"blocked"}',
    ) as unknown;
    expect(() => validateContentDocumentV1(content)).toThrow("Forbidden data property");

    const worksheet = worksheetInstanceFixture({}) as Record<string, unknown>;
    const slots = worksheet.slots as Array<Record<string, unknown>>;
    const firstSlot = slots[0];
    if (firstSlot === undefined) {
      throw new Error("Expected worksheet fixture slot");
    }
    firstSlot.prompt = JSON.parse(
      '{"type":"fraction-addition","instruction":"Add.","left":{"numerator":"2","denominator":"5"},"right":{"numerator":"5","denominator":"7"},"accessibleText":"Add two fifths and five sevenths.","__proto__":"blocked"}',
    ) as unknown;
    expect(() => validateWorksheetInstanceV1(worksheet)).toThrow(
      "Forbidden data property",
    );
  });

  it.each([
    ["a TeX command", String.raw`\input{secret}`],
    ["TeX comment syntax", "1% ignored payload"],
    ["a TeX encoded control sequence", "^^5cinput{secret}"],
    ["a raw ASCII control character", "1\u0000"],
    ["unbalanced groups", String.raw`\frac{1}{2`],
    ["an empty fraction argument", String.raw`\frac{}{2}`],
    ["whitespace-only fraction arguments", String.raw`\frac{   }{ }`],
    ["math nesting above the Phase-1 limit", nestedFractionSource(33)],
  ])("rejects ContentDocumentV1 math containing %s", (_name, source) => {
    expect(() =>
      validateContentDocumentV1(
        contentDocumentWithMath(source, "author-controlled alternative"),
      ),
    ).toThrow();
  });

  it("requires ContentDocumentV1 math accessible text to equal its deterministic derivation", () => {
    expect(() =>
      validateContentDocumentV1(
        contentDocumentWithMath(
          String.raw`\frac{\frac{1}{2}}{3}`,
          "author-controlled alternative",
        ),
      ),
    ).toThrow("deterministic Phase-1 derivation");
  });

  it("accepts safe nested ContentDocumentV1 fractions with exact accessible text", () => {
    const document = contentDocumentWithMath(
      String.raw`\frac{\frac{1}{2}}{3}`,
      "(1 over 2) over 3",
    );

    expect(validateContentDocumentV1(document)).toEqual(document);
  });

  it("fails closed on cyclic, accessor, symbol-keyed, non-plain, and too-deep graphs", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => assertSafeDataObjectGraph(cyclic)).toThrow("Cyclic");

    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, "value", {
      enumerable: true,
      get: () => "blocked",
    });
    expect(() => assertSafeDataObjectGraph(accessor)).toThrow("Accessor");

    expect(() => assertSafeDataObjectGraph({ [Symbol("blocked")]: true })).toThrow(
      "Symbol-keyed",
    );
    expect(() => assertSafeDataObjectGraph(new Date())).toThrow("Non-plain");

    let tooDeep: Record<string, unknown> = {};
    const root = tooDeep;
    for (let depth = 0; depth < 130; depth += 1) {
      const child: Record<string, unknown> = {};
      tooDeep.child = child;
      tooDeep = child;
    }
    expect(() => assertSafeDataObjectGraph(root)).toThrow("exceeds depth");

    expect(() =>
      assertSafeDataObjectGraph({
        first: "a".repeat(MAX_SAFE_DATA_STRING_CODE_UNITS),
        second: "b",
      }),
    ).toThrow("string code units");
    expect(() =>
      assertSafeDataObjectGraph(Array.from({ length: MAX_SAFE_DATA_NODES }, () => 0)),
    ).toThrow("nodes");
    expect(() =>
      assertSafeDataObjectGraph({
        ["x".repeat(MAX_SAFE_DATA_STRING_CODE_UNITS + 1)]: true,
      }),
    ).toThrow("string code units");
    expect(() => assertSafeDataObjectGraph({ value: "\ud800" })).toThrow(
      "Lone high surrogate",
    );
    expect(() => assertSafeDataObjectGraph({ ["\udc00"]: true })).toThrow(
      "Lone low surrogate",
    );
  });

  it.each([
    [
      "duplicate content node IDs",
      contentDocumentFixture("https://example.org/source", {
        duplicateNodeId: true,
      }),
    ],
    [
      "a prerequisite that is also taught",
      contentDocumentFixture("https://example.org/source", {
        prerequisiteAlsoTaught: true,
      }),
    ],
    [
      "duplicate taught skill IDs",
      contentDocumentFixture("https://example.org/source", {
        duplicateSkill: true,
      }),
    ],
    [
      "duplicate prerequisite IDs",
      contentDocumentFixture("https://example.org/source", {
        duplicatePrerequisite: true,
      }),
    ],
  ])("rejects content with %s", (_scenario, value) => {
    expect(ContentDocumentV1Schema.safeParse(value).success).toBe(false);
  });

  it("rejects author lists that cannot cross the worksheet attribution boundary", () => {
    const content = contentDocumentFixture("https://example.org/source") as Record<
      string,
      unknown
    >;
    content.authors = [
      { name: "a".repeat(120), role: "author" },
      { name: "b".repeat(120), role: "reviewer" },
    ];

    expect(() => validateContentDocumentV1(content)).toThrow("Combined author names");
  });

  it.each([
    "not an absolute URL",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "https://user:password@example.com/private",
  ])("rejects a non-public attribution URL: %s", (value) => {
    expect(HttpUrlSchema.safeParse(value).success).toBe(false);
    expect(
      AttributionV1Schema.safeParse({
        title: "Test",
        author: "Test",
        sourceUrl: value,
        licenseId: "LicenseRef-Test",
        attributionText: "Test attribution.",
        publicationStatus: "draft",
        modifications: [],
      }).success,
    ).toBe(false);
  });

  it.each(["https://exercisebook.app/content/test", "http://example.org/source"])(
    "accepts an absolute HTTP(S) attribution URL: %s",
    (value) => {
      expect(HttpUrlSchema.safeParse(value).success).toBe(true);
    },
  );

  it("uses the HTTP(S)-without-credentials contract at the content boundary", () => {
    expect(
      ContentDocumentV1Schema.safeParse(contentDocumentFixture("javascript:alert(1)"))
        .success,
    ).toBe(false);
    expect(
      ContentDocumentV1Schema.safeParse(
        contentDocumentFixture("https://user@example.org/source"),
      ).success,
    ).toBe(false);
    expect(
      ContentDocumentV1Schema.safeParse(
        contentDocumentFixture("https://example.org/source"),
      ).success,
    ).toBe(true);
  });

  it.each([0, 127])(
    "accepts generationAttempt at the inclusive retry boundary: %i",
    (generationAttempt) => {
      expect(
        SlotProvenanceV1Schema.safeParse(slotProvenanceFixture(generationAttempt))
          .success,
      ).toBe(true);
    },
  );

  it.each([-1, 128, 1.5])(
    "rejects generationAttempt outside the bounded integer contract: %s",
    (generationAttempt) => {
      expect(
        SlotProvenanceV1Schema.safeParse(slotProvenanceFixture(generationAttempt))
          .success,
      ).toBe(false);
    },
  );

  it("rejects duplicate top-level content identity even when hashes differ", () => {
    expect(
      WorksheetInstanceV1Schema.safeParse(
        worksheetInstanceFixture({ duplicateContentReference: true }),
      ).success,
    ).toBe(false);
  });

  it.each([
    ["source hash", { provenanceSourceHash: "f".repeat(64) }],
    ["compiled content hash", { provenanceContentHash: "f".repeat(64) }],
  ] satisfies readonly [string, WorksheetFixtureOverrides][])(
    "rejects slot provenance whose %s has no exact top-level content match",
    (_field, overrides) => {
      expect(
        WorksheetInstanceV1Schema.safeParse(worksheetInstanceFixture(overrides))
          .success,
      ).toBe(false);
    },
  );

  it.each([
    ["duplicate slot IDs", { duplicateSlotId: true }],
    ["a scoring answer mismatch", { scoringNumerator: "38" }],
    ["a final solution result mismatch", { finalResultNumerator: "38" }],
    ["a duration sum mismatch", { expectedMinutes: 3 }],
  ] satisfies readonly [string, WorksheetFixtureOverrides][])(
    "rejects a worksheet with %s",
    (_scenario, overrides) => {
      expect(
        WorksheetInstanceV1Schema.safeParse(worksheetInstanceFixture(overrides))
          .success,
      ).toBe(false);
    },
  );

  it.each([
    "skillIds",
    "selectionReasons",
    "hints",
    "solutionTrace",
    "misconceptions",
  ] as const)("rejects duplicate per-slot %s values", (field) => {
    expect(
      WorksheetInstanceV1Schema.safeParse(worksheetWithDuplicateSlotCollection(field))
        .success,
    ).toBe(false);
  });

  it.each([
    "The answer is 39/35",
    "The answer is 39 / 35",
    "The answer is 39⁄35",
    "The answer is 39∕35",
    "The answer is 39 over 35",
    String.raw`The answer is \frac{39}{35}`,
    "The%20answer%20is%2039%2F35",
    String.raw`{"numerator":"39","denominator":"35"}`,
  ])(
    "rejects a hash-correct student projection with an answer-bearing hint: %s",
    async (hintText) => {
      const materialized = await materializeWorksheetFixture({ hintText });
      await expect(projectWorksheetForStudent(materialized)).rejects.toThrow(
        "canonical-answer",
      );
    },
  );

  it("recursively scans accessibility and percent-decoded URL strings", async () => {
    const accessibilityLeak = await materializeWorksheetFixture({
      accessibilitySummary: "Equivalent to 39 over 35.",
    });
    await expect(projectWorksheetForStudent(accessibilityLeak)).rejects.toThrow(
      "deterministic fraction-addition",
    );

    const urlLeak = await materializeWorksheetFixture({
      sourceUrl: "https://example.org/%33%39%2F%33%35",
    });
    await expect(projectWorksheetForStudent(urlLeak)).rejects.toThrow(
      "canonical-answer",
    );
  });

  it("rejects an accessor-bearing materialization envelope before invoking it", async () => {
    const materialized = await materializeWorksheetFixture({});
    let getterRan = false;
    const hostile = { ...materialized } as Record<string, unknown>;
    Object.defineProperty(hostile, "instance", {
      enumerable: true,
      get() {
        getterRan = true;
        return materialized.instance;
      },
    });

    await expect(projectWorksheetForStudent(hostile as never)).rejects.toThrow(
      "Accessor",
    );
    expect(getterRan).toBe(false);
  });

  it("allows a hash-correct projection whose visible strings do not disclose answers", async () => {
    const materialized = await materializeWorksheetFixture({});
    await expect(projectWorksheetForStudent(materialized)).resolves.toMatchObject({
      assignmentId: "assignment-1",
      slots: [{ id: "practice-01" }],
    });
  });

  it("authorizes one detached snapshot when the caller mutates during hashing", async () => {
    const materialized = await materializeWorksheetFixture({});
    const expectedAnswer = structuredClone(
      materialized.instance.slots[0]!.canonicalAnswer.value,
    );
    const expectedHash = materialized.instanceHash;

    const pending = projectWorksheetForStudentWithCanonicalAnswers(materialized);
    materialized.instance.slots[0]!.canonicalAnswer.value = {
      numerator: "1",
      denominator: "2",
    };

    const projection = await pending;
    expect(projection.canonicalAnswers).toEqual([expectedAnswer]);
    expect(projection.delivery.instanceHash).toBe(expectedHash);
  });

  it("allows one slot to display an operand equal to another slot's answer", async () => {
    const base = await materializeWorksheetFixture({
      includeCrossSlotCollision: true,
    });
    const instance = structuredClone(base.instance);
    const targetSlot = instance.slots[1];
    if (targetSlot === undefined) {
      throw new Error("Expected a two-slot worksheet fixture");
    }
    targetSlot.accessibility.summary =
      "Fraction addition problem: 39 over 35 plus 1 over 2.";
    const materialized = await rematerializeWorksheetFixture(instance);

    await expect(projectWorksheetForStudent(materialized)).resolves.toMatchObject({
      assignmentId: "assignment-1",
      slots: [
        { id: "practice-01" },
        {
          id: "practice-02",
          prompt: {
            left: { numerator: "39", denominator: "35" },
            accessibleText:
              "Add 39 over 35 and 1 over 2. Give the answer in lowest terms.",
          },
          accessibility: {
            summary: "Fraction addition problem: 39 over 35 plus 1 over 2.",
          },
        },
      ],
    });
  });

  it("rejects one slot's answer in another slot's non-prompt fields", async () => {
    const materialized = await materializeWorksheetFixture({
      includeCrossSlotCollision: true,
    });
    const instance = structuredClone(materialized.instance);
    const leakedAnswer = instance.slots[1]?.canonicalAnswer.value;
    const targetSlot = instance.slots[0];
    if (leakedAnswer === undefined || targetSlot === undefined) {
      throw new Error("Expected a two-slot worksheet fixture");
    }
    targetSlot.printFallback.text = `A leaked answer is ${leakedAnswer.numerator}/${leakedAnswer.denominator}.`;

    await expect(
      projectWorksheetForStudent(await rematerializeWorksheetFixture(instance)),
    ).rejects.toThrow("canonical-answer");
  });

  it.each(["prompt accessible text", "accessibility summary"] as const)(
    "rejects cross-slot answer prose in %s when it is not backed by a prompt operand",
    async (field) => {
      const materialized = await materializeWorksheetFixture({
        includeCrossSlotCollision: true,
      });
      const instance = structuredClone(materialized.instance);
      const leakedAnswer = instance.slots[1]?.canonicalAnswer.value;
      const targetSlot = instance.slots[0];
      if (leakedAnswer === undefined || targetSlot === undefined) {
        throw new Error("Expected a two-slot worksheet fixture");
      }
      const leakedText =
        `A leaked answer is ${leakedAnswer.numerator} over ` +
        `${leakedAnswer.denominator}.`;
      if (field === "prompt accessible text") {
        targetSlot.prompt.accessibleText = leakedText;
      } else {
        targetSlot.accessibility.summary = leakedText;
      }

      await expect(
        projectWorksheetForStudent(await rematerializeWorksheetFixture(instance)),
      ).rejects.toThrow("deterministic fraction-addition");
    },
  );

  it.each(["prompt accessible text", "accessibility summary"] as const)(
    "rejects appended answer prose in exact %s even when the value is a prompt operand",
    async (field) => {
      const materialized = await materializeWorksheetFixture({
        includeCrossSlotCollision: true,
      });
      const instance = structuredClone(materialized.instance);
      const answer = instance.slots[0]?.canonicalAnswer.value;
      const targetSlot = instance.slots[1];
      if (answer === undefined || targetSlot === undefined) {
        throw new Error("Expected a two-slot worksheet fixture");
      }
      const appendedAnswer = ` The answer is ${answer.numerator}/${answer.denominator}.`;
      if (field === "prompt accessible text") {
        targetSlot.prompt.accessibleText += appendedAnswer;
      } else {
        targetSlot.accessibility.summary += appendedAnswer;
      }

      await expect(
        projectWorksheetForStudent(await rematerializeWorksheetFixture(instance)),
      ).rejects.toThrow("deterministic fraction-addition");
    },
  );

  it("checks prompt instructions against every answer without an operand exception", async () => {
    const materialized = await materializeWorksheetFixture({
      includeCrossSlotCollision: true,
    });
    const instance = structuredClone(materialized.instance);
    const answer = instance.slots[0]?.canonicalAnswer.value;
    const targetSlot = instance.slots[1];
    if (answer === undefined || targetSlot === undefined) {
      throw new Error("Expected a two-slot worksheet fixture");
    }
    targetSlot.prompt.instruction = `Add the fractions. The answer is ${answer.numerator}/${answer.denominator}.`;

    await expect(
      projectWorksheetForStudent(await rematerializeWorksheetFixture(instance)),
    ).rejects.toThrow("canonical-answer");
  });

  it("rejects an own-answer prompt operand when another slot has the same answer", async () => {
    const materialized = await materializeWorksheetFixture({
      includeCrossSlotCollision: true,
    });
    const instance = structuredClone(materialized.instance);
    const duplicateAnswer = instance.slots[1]?.canonicalAnswer.value;
    const targetSlot = instance.slots[0];
    const finalStep = targetSlot?.solutionTrace.at(-1);
    if (
      duplicateAnswer === undefined ||
      targetSlot === undefined ||
      finalStep === undefined
    ) {
      throw new Error("Expected a two-slot worksheet fixture with a solution");
    }
    targetSlot.canonicalAnswer.value = { ...duplicateAnswer };
    targetSlot.scoringRule.accepted = { ...duplicateAnswer };
    finalStep.result = { ...duplicateAnswer };
    targetSlot.prompt.left = { ...duplicateAnswer };
    targetSlot.prompt.accessibleText = deriveFractionAdditionPromptAccessibleText(
      targetSlot.prompt.left,
      targetSlot.prompt.right,
    );
    targetSlot.accessibility.summary = deriveFractionAdditionAccessibilitySummary(
      targetSlot.prompt.left,
      targetSlot.prompt.right,
    );

    await expect(
      projectWorksheetForStudent(await rematerializeWorksheetFixture(instance)),
    ).rejects.toThrow("canonical-answer");
  });

  it("checks global attribution strings against every slot answer", async () => {
    const materialized = await materializeWorksheetFixture({
      includeCrossSlotCollision: true,
      sourceUrl: "https://example.org/%31%31%33%2F%37%30",
    });

    await expect(projectWorksheetForStudent(materialized)).rejects.toThrow(
      "canonical-answer",
    );
  });
});

interface ContentDocumentFixtureOverrides {
  readonly duplicateNodeId?: boolean;
  readonly duplicatePrerequisite?: boolean;
  readonly duplicateSkill?: boolean;
  readonly prerequisiteAlsoTaught?: boolean;
}

function contentDocumentFixture(
  sourceUrl: string,
  overrides: ContentDocumentFixtureOverrides = {},
): unknown {
  return {
    schema: "exercisebook.content-ast/v1",
    id: "math.fractions.add",
    revision: 1,
    locale: "en",
    title: "Add fractions",
    skills: [
      "math.fractions.add",
      ...(overrides.duplicateSkill ? ["math.fractions.add"] : []),
    ],
    prerequisites: [
      overrides.prerequisiteAlsoTaught
        ? "math.fractions.add"
        : "math.fractions.equivalent",
      ...(overrides.duplicatePrerequisite ? ["math.fractions.equivalent"] : []),
    ],
    authors: [{ name: "Exercisebook", role: "author" }],
    license: {
      licenseId: "CC-BY-4.0",
      sourceUrl,
      attributionText: "Exercisebook content.",
      copyrightHolder: "Exercisebook",
    },
    publication: { status: "draft" },
    estimatedMinutes: 10,
    nodes: [
      {
        type: "paragraph",
        children: [{ type: "text", value: "Add fractions." }],
      },
      ...(overrides.duplicateNodeId
        ? [
            contentDirectiveFixture("duplicate-node"),
            contentDirectiveFixture("duplicate-node"),
          ]
        : []),
    ],
    sourceHash: "0".repeat(64),
    compilerVersion: "exercisebook-content-compiler/1",
  };
}

function contentDocumentWithMath(source: string, accessibleText: string): unknown {
  const document = contentDocumentFixture("https://example.org/source") as Record<
    string,
    unknown
  >;
  document.nodes = [
    {
      type: "paragraph",
      children: [{ type: "math", source, accessibleText }],
    },
  ];
  return document;
}

function nestedFractionSource(depth: number): string {
  let source = "1";
  for (let index = 0; index < depth; index += 1) {
    source = String.raw`\frac{${source}}{2}`;
  }
  return source;
}

function contentDirectiveFixture(id: string): unknown {
  return {
    type: "hint",
    id,
    children: [
      {
        type: "paragraph",
        children: [{ type: "text", value: "Use equivalent fractions." }],
      },
    ],
  };
}

function slotProvenanceFixture(generationAttempt: number) {
  return {
    contentId: "math.fractions.add",
    contentRevision: 1,
    sourceHash: "0".repeat(64),
    contentHash: "1".repeat(64),
    compilerVersion: "exercisebook-content-compiler/1",
    generatorId: "fractions.add",
    generatorVersion: "1",
    generationAttempt,
  };
}

interface WorksheetFixtureOverrides {
  readonly hintText?: string;
  readonly accessibilitySummary?: string;
  readonly sourceUrl?: string;
  readonly includeCrossSlotCollision?: boolean;
  readonly duplicateContentReference?: boolean;
  readonly provenanceSourceHash?: string;
  readonly provenanceContentHash?: string;
  readonly duplicateSlotId?: boolean;
  readonly scoringNumerator?: string;
  readonly finalResultNumerator?: string;
  readonly expectedMinutes?: number;
}

async function materializeWorksheetFixture(overrides: WorksheetFixtureOverrides) {
  const instance = WorksheetInstanceV1Schema.parse(worksheetInstanceFixture(overrides));
  return rematerializeWorksheetFixture(instance);
}

async function rematerializeWorksheetFixture(instanceValue: unknown) {
  const instance = validateWorksheetInstanceV1(instanceValue);
  const canonicalJson = canonicalizeJson(instance);
  return {
    instance,
    canonicalJson,
    instanceHash: await sha256Hex(canonicalJson),
  };
}

function worksheetInstanceFixture(overrides: WorksheetFixtureOverrides): unknown {
  const includeSecondSlot =
    overrides.includeCrossSlotCollision === true || overrides.duplicateSlotId === true;
  return {
    schema: "exercisebook.worksheet-instance/v1",
    assignmentId: "assignment-1",
    title: "Fraction addition practice",
    localStudyDate: "2026-07-19",
    timeZone: "Asia/Tokyo",
    locale: "en",
    expectedMinutes: overrides.expectedMinutes ?? (includeSecondSlot ? 4 : 2),
    plan: { id: "phase-1", version: 1 },
    policy: { id: "daily-plan", version: 1 },
    skillGraph: { id: "phase-1-math", revision: 1 },
    rng: {
      algorithm: "xoshiro128ss-v1",
      baseSeed: "1".repeat(64),
      seedSecretVersion: "fixture-v1",
    },
    content: [
      {
        id: "math.fractions.add",
        revision: 1,
        sourceHash: "0".repeat(64),
        contentHash: "1".repeat(64),
        compilerVersion: "exercisebook-content-compiler/1",
      },
      ...(overrides.duplicateContentReference
        ? [
            {
              id: "math.fractions.add",
              revision: 1,
              sourceHash: "f".repeat(64),
              contentHash: "e".repeat(64),
              compilerVersion: "exercisebook-content-compiler/1",
            },
          ]
        : []),
    ],
    slots: [
      {
        id: "practice-01",
        skillIds: ["math.fractions.add"],
        slotSeed: "2".repeat(64),
        selectionReasons: ["current-frontier"],
        expectedMinutes: 2,
        prompt: {
          type: "fraction-addition",
          instruction: "Add the fractions.",
          left: { numerator: "2", denominator: "5" },
          right: { numerator: "5", denominator: "7" },
          accessibleText: "Add 2 over 5 and 5 over 7. Give the answer in lowest terms.",
        },
        canonicalAnswer: {
          type: "rational",
          value: { numerator: "39", denominator: "35" },
        },
        scoringRule: {
          type: "rational-equals",
          accepted: {
            numerator: overrides.scoringNumerator ?? "39",
            denominator: "35",
          },
          requireReduced: true,
        },
        hints: [
          {
            id: "hint-common-denominator",
            text:
              overrides.hintText ??
              "Find a common denominator before adding the numerators.",
          },
        ],
        solutionTrace: [
          {
            id: "step-reduce",
            kind: "reduce",
            explanation: "The result is already in lowest terms.",
            expression: "39/35",
            accessibleText: "Thirty-nine thirty-fifths.",
            result: {
              numerator: overrides.finalResultNumerator ?? "39",
              denominator: "35",
            },
          },
        ],
        misconceptions: [],
        accessibility: {
          summary:
            overrides.accessibilitySummary ??
            "Fraction addition problem: 2 over 5 plus 5 over 7.",
        },
        printFallback: {
          type: "text",
          text: "Draw fraction bars and combine equal-sized parts.",
        },
        provenance: {
          ...slotProvenanceFixture(0),
          sourceHash: overrides.provenanceSourceHash ?? "0".repeat(64),
          contentHash: overrides.provenanceContentHash ?? "1".repeat(64),
        },
      },
      ...(includeSecondSlot
        ? [
            crossSlotCollisionWorksheetSlotFixture(
              overrides.duplicateSlotId ? "practice-01" : "practice-02",
            ),
          ]
        : []),
    ],
    attributions: [
      {
        title: "Fixture source",
        author: "Exercisebook",
        sourceUrl: overrides.sourceUrl ?? "https://example.org/source",
        licenseId: "CC-BY-4.0",
        attributionText: "Adapted for testing.",
        publicationStatus: "draft",
        modifications: ["Created a deterministic fixture."],
      },
    ],
  };
}

function crossSlotCollisionWorksheetSlotFixture(id: string): unknown {
  return {
    id,
    skillIds: ["math.fractions.add"],
    slotSeed: "3".repeat(64),
    selectionReasons: ["current-frontier"],
    expectedMinutes: 2,
    prompt: {
      type: "fraction-addition",
      instruction: "Add the fractions.",
      left: { numerator: "39", denominator: "35" },
      right: { numerator: "1", denominator: "2" },
      accessibleText: "Add 39 over 35 and 1 over 2. Give the answer in lowest terms.",
    },
    canonicalAnswer: {
      type: "rational",
      value: { numerator: "113", denominator: "70" },
    },
    scoringRule: {
      type: "rational-equals",
      accepted: { numerator: "113", denominator: "70" },
      requireReduced: true,
    },
    hints: [
      {
        id: "hint-common-denominator-02",
        text: "Find a common denominator before adding the numerators.",
      },
    ],
    solutionTrace: [
      {
        id: "step-reduce-02",
        kind: "reduce",
        explanation: "The result is already in lowest terms.",
        expression: "113/70",
        accessibleText: "One hundred thirteen seventieths.",
        result: { numerator: "113", denominator: "70" },
      },
    ],
    misconceptions: [],
    accessibility: {
      summary: "Fraction addition problem: 39 over 35 plus 1 over 2.",
    },
    printFallback: {
      type: "text",
      text: "Draw fraction bars and combine equal-sized parts.",
    },
    provenance: slotProvenanceFixture(0),
  };
}

function worksheetWithDuplicateSlotCollection(
  field: "skillIds" | "selectionReasons" | "hints" | "solutionTrace" | "misconceptions",
): unknown {
  const worksheet = structuredClone(worksheetInstanceFixture({})) as {
    slots: Array<Record<string, unknown>>;
  };
  const slot = worksheet.slots[0];
  if (slot === undefined) {
    throw new Error("Expected worksheet fixture slot");
  }
  switch (field) {
    case "skillIds":
      slot.skillIds = ["math.fractions.add", "math.fractions.add"];
      break;
    case "selectionReasons":
      slot.selectionReasons = ["current-frontier", "current-frontier"];
      break;
    case "hints": {
      const hints = slot.hints as unknown[];
      slot.hints = [...hints, structuredClone(hints[0])];
      break;
    }
    case "solutionTrace": {
      const steps = slot.solutionTrace as unknown[];
      slot.solutionTrace = [...steps, structuredClone(steps[0])];
      break;
    }
    case "misconceptions":
      slot.misconceptions = [
        {
          id: "same-misconception",
          description: "First duplicate.",
          incorrectAnswer: { numerator: "1", denominator: "2" },
        },
        {
          id: "same-misconception",
          description: "Second duplicate.",
          incorrectAnswer: { numerator: "1", denominator: "3" },
        },
      ];
      break;
  }
  return worksheet;
}
