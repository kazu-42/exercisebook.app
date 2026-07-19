import { describe, expect, it } from "vitest";

import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import {
  validateContentDocumentV2,
  type ContentDocumentV2,
} from "@exercisebook/schemas";

import compiledFractionLessonV2 from "../../../content/compiled/math.fractions.add-unlike-denominators.v2.json" with { type: "json" };

import {
  PresentationResolutionError,
  resolveWorksheetPresentationV1,
  type ResolveWorksheetPresentationV1Input,
} from "./fraction-presentation-v1.js";

const FINAL_SOURCE_HASH =
  "456c8908debd52c7fcc5eba6e2e9a38434b5fcd8343e7a14a427faae34502523";
const FINAL_CONTENT_HASH =
  "944225a2dda87ae6ee61e53f21a929301f5264793d665ea2200b65fb0f5a71dd";

const REVIEWED_FRACTION_LESSON_V2 = validateContentDocumentV2(compiledFractionLessonV2);

const EXPECTED_CONTENT = {
  id: "math.fractions.add-unlike-denominators",
  revision: 2,
  sourceHash: FINAL_SOURCE_HASH,
  contentHash: FINAL_CONTENT_HASH,
  compilerVersion: "exercisebook-content-compiler/2",
} as const;

const PRESENTATION_SELECTION = {
  explanationNodeId: "lesson-explanation-01",
  workedExampleNodeId: "worked-example-01",
  exerciseNodeId: "practice-01",
  excludedCanonicalAnswers: [
    { numerator: "1", denominator: "2" },
    { numerator: "1", denominator: "3" },
    { numerator: "5", denominator: "6" },
  ],
} as const;

describe("WorksheetPresentationV1 resolver", () => {
  it("resolves the exact pinned presentation without application-owned copy", () => {
    const presentation = resolveFixture();

    expect(presentation).toEqual({
      schema: "exercisebook.worksheet-presentation/v1",
      content: EXPECTED_CONTENT,
      lesson: {
        nodeId: "lesson-explanation-01",
        title: "The three moves",
        paragraphs: [
          "Find a denominator both fractions can use.",
          "Rename each fraction without changing its value.",
          "Add the numerators and keep the shared denominator.",
        ],
      },
      workedExample: {
        nodeId: "worked-example-01",
        title: "One half plus one third",
        model: {
          type: "fraction-addition",
          left: { numerator: "1", denominator: "2" },
          right: { numerator: "1", denominator: "3" },
          result: { numerator: "5", denominator: "6" },
          commonDenominator: "6",
          leftScaledNumerator: "3",
          rightScaledNumerator: "2",
          unreducedSumNumerator: "5",
        },
        steps: [
          "Find the least common denominator.",
          "Rewrite both addends as equivalent fractions.",
          "Add the numerators and reduce if needed.",
        ],
      },
      exercise: {
        nodeId: "practice-01",
        instruction: "Add each pair of fractions. Give every answer in lowest terms.",
      },
    });
  });

  it("returns a detached presentation and never normalizes compiler-owned prose", () => {
    const document = structuredClone(REVIEWED_FRACTION_LESSON_V2);
    const input = fixtureInput({ document });
    const presentation = resolveWorksheetPresentationV1(input);
    const explanation = document.nodes.find((node) => node.type === "explanation");
    const workedExample = document.nodes.find((node) => node.type === "worked-example");
    if (
      explanation?.type !== "explanation" ||
      workedExample?.type !== "worked-example"
    ) {
      throw new Error("Expected selected presentation nodes");
    }

    explanation.title = "Caller-mutated lesson";
    explanation.paragraphs[0] = "Caller-mutated paragraph";
    workedExample.model.left = { numerator: "1", denominator: "4" };

    expect(presentation.lesson.title).toBe("The three moves");
    expect(presentation.lesson.paragraphs[0]).toBe(
      "Find a denominator both fractions can use.",
    );
    expect(presentation.workedExample.model.left).toEqual({
      numerator: "1",
      denominator: "2",
    });
  });

  it("does not fall back to another node when a selected node is missing", () => {
    const document = mutateDocument((value) => {
      value.nodes = value.nodes
        .filter(
          (node) =>
            !("id" in node && node.id === PRESENTATION_SELECTION.explanationNodeId),
        )
        .concat({
          type: "explanation",
          id: "alternate-explanation",
          title: "Alternate copy",
          paragraphs: ["This must never be selected as a fallback."],
        });
    });

    expectResolutionError(() => resolveFixture({ document }), "selected-node-count");
  });

  it("classifies a duplicated selected ID as an exact-count failure", () => {
    const document = mutateDocument((value) => {
      const explanation = value.nodes.find(
        (node) => node.type === "explanation" && node.id === "lesson-explanation-01",
      );
      if (explanation === undefined || explanation.type !== "explanation") {
        throw new Error("Expected the selected explanation fixture");
      }
      value.nodes.push(structuredClone(explanation));
    });

    expectResolutionError(() => resolveFixture({ document }), "selected-node-count");
  });

  it.each([
    ["explanation", "lesson-explanation-01", "selected-node-type"],
    ["worked example", "worked-example-01", "selected-node-type"],
    ["exercise", "practice-01", "selected-node-type"],
  ] as const)("rejects a selected %s with the wrong node type", (_name, id, code) => {
    const document = mutateDocument((value) => {
      value.nodes = value.nodes.map((node) =>
        "id" in node && node.id === id
          ? {
              type: "reflection",
              id,
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", value: "Wrong selected type." }],
                },
              ],
            }
          : node,
      );
    });

    expectResolutionError(() => resolveFixture({ document }), code);
  });

  it.each([
    ["content ID", { id: "math.fractions.other" }],
    ["content revision", { revision: 3 }],
    ["source hash", { sourceHash: "0".repeat(64) }],
    ["content hash", { contentHash: "f".repeat(64) }],
    ["compiler", { compilerVersion: "exercisebook-content-compiler/1" }],
  ] as const)("rejects a mismatched pinned %s", (_name, patch) => {
    expectResolutionError(
      () =>
        resolveFixture({
          expectedContent: { ...EXPECTED_CONTENT, ...patch } as never,
        }),
      "content-identity-mismatch",
    );
  });

  it("rejects a computed content hash that disagrees with the policy lock", () => {
    expectResolutionError(
      () => resolveFixture({ computedContentHash: "0".repeat(64) }),
      "content-identity-mismatch",
    );
  });

  it.each([
    ["generator ID", { id: "fractions.subtract" }],
    ["generator version", { version: "2" }],
    ["reviewed count", { count: 7 }],
    ["difficulty lower bound", { parameters: { difficulty: 0 } }],
    ["difficulty upper bound", { parameters: { difficulty: 6 } }],
    ["difficulty integer", { parameters: { difficulty: 2.5 } }],
    ["difficulty missing", { parameters: {} }],
    ["difficulty shape", { parameters: { difficulty: 2, extra: true } }],
  ] as const)("rejects an exercise with the wrong %s", (_name, generatorPatch) => {
    const document = mutateDocument((value) => {
      value.nodes = value.nodes.map((node) => {
        if (node.type !== "exercise" || node.id !== "practice-01") {
          return node;
        }
        if ("count" in generatorPatch) {
          return { ...node, count: generatorPatch.count };
        }
        return {
          ...node,
          generator: { ...node.generator, ...generatorPatch },
        };
      });
    });

    expectResolutionError(
      () => resolveFixture({ document }),
      "exercise-contract-mismatch",
    );
  });

  it("accepts a supported numeric difficulty without owning its reviewed value", () => {
    const document = mutateDocument((value) => {
      value.nodes = value.nodes.map((node) =>
        node.type === "exercise" && node.id === "practice-01"
          ? {
              ...node,
              generator: {
                ...node.generator,
                parameters: { difficulty: 3 },
              },
            }
          : node,
      );
    });

    expect(resolveFixture({ document }).exercise.instruction).toBe(
      "Add each pair of fractions. Give every answer in lowest terms.",
    );
  });

  it("independently rejects inconsistent worked-example arithmetic", () => {
    const document = mutateDocument((value) => {
      value.nodes = value.nodes.map((node) =>
        node.type === "worked-example" && node.id === "worked-example-01"
          ? {
              ...node,
              model: { ...node.model, commonDenominator: "12" },
            }
          : node,
      );
    });

    expectResolutionError(
      () => resolveFixture({ document }),
      "worked-example-arithmetic-mismatch",
    );
  });

  it.each([
    [
      "wrong order",
      [
        { numerator: "1", denominator: "3" },
        { numerator: "1", denominator: "2" },
        { numerator: "5", denominator: "6" },
      ],
    ],
    [
      "wrong value",
      [
        { numerator: "1", denominator: "2" },
        { numerator: "1", denominator: "3" },
        { numerator: "7", denominator: "6" },
      ],
    ],
    [
      "wrong length",
      [
        { numerator: "1", denominator: "2" },
        { numerator: "1", denominator: "3" },
      ],
    ],
  ] as const)("rejects a %s exclusion tuple", (_name, excludedCanonicalAnswers) => {
    expectResolutionError(
      () =>
        resolveFixture({
          selection: {
            ...PRESENTATION_SELECTION,
            excludedCanonicalAnswers,
          } as never,
        }),
      excludedCanonicalAnswers.length === 3
        ? "excluded-answer-tuple-mismatch"
        : "invalid-selection",
    );
  });

  it.each([
    ["invalid numerator", { numerator: "1e999999", denominator: "2" }],
    ["zero denominator", { numerator: "1", denominator: "0" }],
    ["oversized numerator", { numerator: "9".repeat(129), denominator: "2" }],
    ["unreduced rational", { numerator: "2", denominator: "4" }],
  ] as const)(
    "maps a hostile %s to a typed sanitized error without leaking BigInt errors",
    (_name, hostileRational) => {
      const action = () =>
        resolveFixture({
          selection: {
            ...PRESENTATION_SELECTION,
            excludedCanonicalAnswers: [
              hostileRational,
              PRESENTATION_SELECTION.excludedCanonicalAnswers[1],
              PRESENTATION_SELECTION.excludedCanonicalAnswers[2],
            ],
          } as never,
        });

      expectResolutionError(action, "invalid-selection");
      expect(action).not.toThrow(SyntaxError);
      expect(action).not.toThrow(RangeError);
    },
  );

  it("rejects an accessor-bearing input without invoking the getter", () => {
    let getterRan = false;
    const hostile = { ...fixtureInput() } as Record<string, unknown>;
    Object.defineProperty(hostile, "document", {
      enumerable: true,
      get() {
        getterRan = true;
        return REVIEWED_FRACTION_LESSON_V2;
      },
    });

    expectResolutionError(
      () => resolveWorksheetPresentationV1(hostile as never),
      "unsafe-input",
    );
    expect(getterRan).toBe(false);
  });

  it.each([
    ["scalar", "unexpected-envelope-value"],
    ["function", () => "DO-NOT-RUN"],
    ["symbol", Symbol("unexpected-envelope-value")],
  ] as const)(
    "rejects an extra top-level %s without envelope drift",
    (_name, value) => {
      const hostile = {
        ...fixtureInput(),
        unexpected: value,
      };

      expectResolutionError(
        () => resolveWorksheetPresentationV1(hostile as never),
        "unsafe-input",
      );
    },
  );

  it("uses fixed bounded diagnostics that do not echo trusted content", () => {
    const secretMarker = "DO-NOT-ECHO-TRUSTED-CONTENT";
    const document = mutateDocument((value) => {
      value.nodes = value.nodes.filter(
        (node) => !("id" in node && node.id === "lesson-explanation-01"),
      );
      value.title = secretMarker;
    });

    let captured: unknown;
    try {
      resolveFixture({ document });
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(PresentationResolutionError);
    expect((captured as PresentationResolutionError).message).not.toContain(
      secretMarker,
    );
    expect((captured as PresentationResolutionError).message.length).toBeLessThan(160);
  });
});

function resolveFixture(overrides: Partial<ResolveWorksheetPresentationV1Input> = {}) {
  return resolveWorksheetPresentationV1(fixtureInput(overrides));
}

function fixtureInput(
  overrides: Partial<ResolveWorksheetPresentationV1Input> = {},
): ResolveWorksheetPresentationV1Input {
  return {
    document: REVIEWED_FRACTION_LESSON_V2,
    computedContentHash: FINAL_CONTENT_HASH,
    expectedContent: EXPECTED_CONTENT,
    selection: PRESENTATION_SELECTION,
    ...overrides,
  };
}

function mutateDocument(
  mutate: (document: MutableContentDocumentV2) => void,
): ContentDocumentV2 {
  const document = structuredClone(
    REVIEWED_FRACTION_LESSON_V2,
  ) as MutableContentDocumentV2;
  mutate(document);
  return document;
}

function expectResolutionError(
  action: () => unknown,
  code: PresentationResolutionError["code"],
): void {
  let captured: unknown;
  try {
    action();
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(PresentationResolutionError);
  expect((captured as PresentationResolutionError).code).toBe(code);
  expect(captured).not.toBeInstanceOf(SyntaxError);
  expect(captured).not.toBeInstanceOf(RangeError);
}

type MutableContentDocumentV2 = {
  -readonly [Key in keyof ContentDocumentV2]: Key extends "nodes"
    ? Array<ContentDocumentV2["nodes"][number]>
    : ContentDocumentV2[Key];
};

// The fixture constants are independently checked here so a stale checked-in
// artifact cannot make resolver tests silently authorize the wrong policy lock.
it("uses the reviewed canonical ContentDocumentV2 hash", async () => {
  expect(REVIEWED_FRACTION_LESSON_V2.sourceHash).toBe(FINAL_SOURCE_HASH);
  expect(await sha256Hex(canonicalizeJson(REVIEWED_FRACTION_LESSON_V2))).toBe(
    FINAL_CONTENT_HASH,
  );
});
