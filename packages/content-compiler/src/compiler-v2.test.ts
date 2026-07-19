import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { sha256Hex } from "@exercisebook/domain";
import {
  CONTENT_COMPILER_V2,
  CONTENT_DOCUMENT_V2_SCHEMA,
  validateContentDocumentV2,
} from "@exercisebook/schemas";

import {
  ContentCompilationError,
  compileContentSource,
  compileContentSourceV2,
} from "./compiler.js";
import { normalizePresentationPlainTextParts } from "./presentation-normalization.js";

const v1FixtureUrl = new URL(
  "../../../content/en/math/fractions/add-unlike-denominators.md",
  import.meta.url,
);
const v2FixtureUrl = new URL(
  "../../../content/en/math/fractions/add-unlike-denominators.v2.md",
  import.meta.url,
);
const v1ArtifactUrl = new URL(
  "../../../content/compiled/math.fractions.add-unlike-denominators.v1.json",
  import.meta.url,
);

describe("ContentDocumentV2 compiler", () => {
  it("compiles a normalized typed presentation with exact derived arithmetic", async () => {
    const source = await readFile(v2FixtureUrl, "utf8");
    const first = await compileContentSourceV2(source);
    const second = await compileContentSourceV2(source);

    expect(first.document.schema).toBe(CONTENT_DOCUMENT_V2_SCHEMA);
    expect(first.document.compilerVersion).toBe(CONTENT_COMPILER_V2);
    expect(first.document.revision).toBe(2);
    expect(validateContentDocumentV2(first.document)).toEqual(first.document);
    expect(first.canonicalJson).toBe(second.canonicalJson);
    expect(first.contentHash).toBe(second.contentHash);

    const explanation = first.document.nodes.find(
      (node) => node.type === "explanation",
    );
    expect(explanation).toEqual({
      type: "explanation",
      id: "lesson-explanation-01",
      title: "The three moves",
      paragraphs: [
        "Find a denominator both fractions can use.",
        "Rename each fraction without changing its value.",
        "Add the numerators and keep the shared denominator.",
      ],
    });

    const workedExample = first.document.nodes.find(
      (node) => node.type === "worked-example",
    );
    expect(workedExample).toMatchObject({
      id: "worked-example-01",
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
    });
  });

  it("normalizes selected plain-text paragraph whitespace before hashing", async () => {
    const compiled = await compileContentSourceV2(
      validV2Source({
        explanationBody: "Find a denominator both\nfractions can use.\n",
        workedExampleBody: "  Find   the least common denominator.  \n",
      }),
    );
    const explanation = compiled.document.nodes.find(
      (node) => node.type === "explanation",
    );
    const workedExample = compiled.document.nodes.find(
      (node) => node.type === "worked-example",
    );

    expect(explanation?.type === "explanation" ? explanation.paragraphs : []).toEqual([
      "Find a denominator both fractions can use.",
    ]);
    expect(workedExample?.type === "worked-example" ? workedExample.steps : []).toEqual(
      ["Find the least common denominator."],
    );
  });

  it("owns tabs and Unicode whitespace normalization in compiler v2", async () => {
    const compiled = await compileContentSourceV2(
      validV2Source({
        explanationBody:
          "\u00a0Find\t a\u0085denominator\u2003both\nfractions can use.\u00a0\n",
        workedExampleBody:
          "\u202fFind\vthe\fform-feed\u205fand carriage\rreturn.\u3000\n",
      }),
    );
    const explanation = compiled.document.nodes.find(
      (node) => node.type === "explanation",
    );
    const workedExample = compiled.document.nodes.find(
      (node) => node.type === "worked-example",
    );

    expect(explanation?.type === "explanation" ? explanation.paragraphs : []).toEqual([
      "Find a denominator both fractions can use.",
    ]);
    expect(workedExample?.type === "worked-example" ? workedExample.steps : []).toEqual(
      ["Find the form-feed and carriage return."],
    );
  });

  it("joins every plain-text AST child before compiler-owned normalization", () => {
    expect(
      normalizePresentationPlainTextParts([
        "\u00a0Find",
        "\t",
        "a denominator ",
        "both\nfractions can use.\u2003",
      ]),
    ).toBe("Find a denominator both fractions can use.");
  });

  it("normalizes CRLF source before source and content hashing", async () => {
    const source = validV2Source();
    const canonical = await compileContentSourceV2(source);
    const crlf = await compileContentSourceV2(source.replaceAll("\n", "\r\n"));

    expect(crlf.document.sourceHash).toBe(canonical.document.sourceHash);
    expect(crlf.canonicalJson).toBe(canonical.canonicalJson);
    expect(crlf.contentHash).toBe(canonical.contentHash);
  });

  it("rejects a presentation paragraph that normalizes to empty", async () => {
    await expect(
      compileContentSourceV2(validV2Source({ explanationBody: "\u00a0\t\u2003\n" })),
    ).rejects.toMatchObject({
      name: "ContentCompilationError",
      code: "presentation-plain-text",
    });
  });

  it("derives and runtime-validates an example whose sum requires reduction", async () => {
    const compiled = await compileContentSourceV2(
      validV2Source({ left: "1/6", right: "1/3", result: "1/2" }),
    );
    const workedExample = compiled.document.nodes.find(
      (node) => node.type === "worked-example",
    );
    if (workedExample?.type !== "worked-example") {
      throw new Error("Expected a typed worked example");
    }
    expect(workedExample.model).toEqual({
      type: "fraction-addition",
      left: { numerator: "1", denominator: "6" },
      right: { numerator: "1", denominator: "3" },
      result: { numerator: "1", denominator: "2" },
      commonDenominator: "6",
      leftScaledNumerator: "1",
      rightScaledNumerator: "2",
      unreducedSumNumerator: "3",
    });

    expect(() =>
      validateContentDocumentV2({
        ...compiled.document,
        nodes: compiled.document.nodes.map((node) =>
          node.type === "worked-example"
            ? {
                ...node,
                model: { ...node.model, unreducedSumNumerator: "4" },
              }
            : node,
        ),
      }),
    ).toThrow(/unreduced sum numerator/u);
  });

  it("derives signed intermediate integers without floating-point arithmetic", async () => {
    const compiled = await compileContentSourceV2(
      validV2Source({ left: "-1/2", right: "1/3", result: "-1/6" }),
    );
    const workedExample = compiled.document.nodes.find(
      (node) => node.type === "worked-example",
    );

    expect(
      workedExample?.type === "worked-example" ? workedExample.model : null,
    ).toEqual({
      type: "fraction-addition",
      left: { numerator: "-1", denominator: "2" },
      right: { numerator: "1", denominator: "3" },
      result: { numerator: "-1", denominator: "6" },
      commonDenominator: "6",
      leftScaledNumerator: "-3",
      rightScaledNumerator: "2",
      unreducedSumNumerator: "-1",
    });
  });

  it("runtime-validates every exact arithmetic field independently", async () => {
    const compiled = await compileContentSourceV2(validV2Source());
    const workedExample = compiled.document.nodes.find(
      (node) => node.type === "worked-example",
    );
    if (workedExample?.type !== "worked-example") {
      throw new Error("Expected a typed worked example");
    }

    const mutations = [
      [{ ...workedExample.model, commonDenominator: "12" }, /common denominator/u],
      [{ ...workedExample.model, leftScaledNumerator: "6" }, /left scaled numerator/u],
      [
        { ...workedExample.model, rightScaledNumerator: "4" },
        /right scaled numerator/u,
      ],
      [
        { ...workedExample.model, unreducedSumNumerator: "10" },
        /unreduced sum numerator/u,
      ],
      [
        {
          ...workedExample.model,
          result: { numerator: "1", denominator: "1" },
        },
        /exact sum/u,
      ],
    ] as const;

    for (const [model, expectedMessage] of mutations) {
      expect(() =>
        validateContentDocumentV2({
          ...compiled.document,
          nodes: compiled.document.nodes.map((node) =>
            node.type === "worked-example" ? { ...node, model } : node,
          ),
        }),
      ).toThrow(expectedMessage);
    }
  });

  it("fails invalid runtime rationals closed without leaking arithmetic errors", async () => {
    const compiled = await compileContentSourceV2(validV2Source());

    const invalidRationals = [
      [{ numerator: "1", denominator: "0" }, /denominator must be positive/u],
      [{ numerator: "1", denominator: "not-an-integer" }, /canonical base-10 integer/u],
      [{ numerator: "not-an-integer", denominator: "2" }, /canonical base-10 integer/u],
    ] as const;

    for (const [left, expectedMessage] of invalidRationals) {
      let caught: unknown;
      try {
        validateContentDocumentV2({
          ...compiled.document,
          nodes: compiled.document.nodes.map((node) =>
            node.type === "worked-example"
              ? { ...node, model: { ...node.model, left } }
              : node,
          ),
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ name: "ZodError" });
      expect(String(caught)).toMatch(expectedMessage);
    }
  });

  it("rejects a malformed derived integer through validation rather than BigInt", async () => {
    const compiled = await compileContentSourceV2(validV2Source());
    let caught: unknown;
    try {
      validateContentDocumentV2({
        ...compiled.document,
        nodes: compiled.document.nodes.map((node) =>
          node.type === "worked-example"
            ? {
                ...node,
                model: { ...node.model, commonDenominator: "not-an-integer" },
              }
            : node,
        ),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ name: "ZodError" });
    expect(caught).not.toBeInstanceOf(SyntaxError);
  });

  it("fails bounded arithmetic growth through typed compiler and schema diagnostics", async () => {
    const largeDenominator = `1${"0".repeat(127)}`;
    const coprimeDenominator = "9".repeat(127);

    await expect(
      compileContentSourceV2(
        validV2Source({
          left: `1/${largeDenominator}`,
          right: `1/${coprimeDenominator}`,
          result: "0/1",
        }),
      ),
    ).rejects.toMatchObject({
      name: "ContentCompilationError",
      code: "worked-example-arithmetic",
    });

    const compiled = await compileContentSourceV2(validV2Source());
    expect(() =>
      validateContentDocumentV2({
        ...compiled.document,
        nodes: compiled.document.nodes.map((node) =>
          node.type === "worked-example"
            ? {
                ...node,
                model: {
                  ...node.model,
                  left: { numerator: "1", denominator: largeDenominator },
                  right: { numerator: "1", denominator: coprimeDenominator },
                },
              }
            : node,
        ),
      }),
    ).toThrow(/bounded canonical integer contract/u);
  });

  it("runtime-rejects presentation strings outside compiler normalization", async () => {
    const compiled = await compileContentSourceV2(validV2Source());

    for (const paragraph of ["Find  a denominator.", "Find\u0085a denominator."]) {
      expect(() =>
        validateContentDocumentV2({
          ...compiled.document,
          nodes: compiled.document.nodes.map((node) =>
            node.type === "explanation" ? { ...node, paragraphs: [paragraph] } : node,
          ),
        }),
      ).toThrow(/canonical whitespace normalization/u);
    }
  });

  it.each([
    ["leading-zero numerator", "01/2"],
    ["negative zero", "-0/2"],
    ["zero denominator", "1/0"],
    ["negative denominator", "1/-2"],
    ["unreduced", "2/4"],
    ["embedded whitespace", "1 /2"],
    ["decimal", "0.5/1"],
    ["leading plus", "+1/2"],
    ["entity-encoded slash", "1&#47;2"],
    ["named-entity slash", "1&sol;2"],
    ["oversized numerator", `${"9".repeat(129)}/2`],
    ["oversized denominator", `1/${"9".repeat(129)}`],
  ])("rejects a noncanonical %s rational attribute", async (_name, left) => {
    await expect(compileContentSourceV2(validV2Source({ left }))).rejects.toMatchObject(
      {
        name: "ContentCompilationError",
        code: "worked-example-rational",
      },
    );
  });

  it("rejects a canonical but arithmetically wrong result", async () => {
    await expect(
      compileContentSourceV2(validV2Source({ result: "1/1" })),
    ).rejects.toMatchObject({
      name: "ContentCompilationError",
      code: "worked-example-result",
    });
  });

  it.each([
    ["inline math", "Use $2$ as the denominator."],
    ["emphasis", "Use *equal-sized* pieces."],
    ["strong", "Use **equal-sized** pieces."],
    ["link", "Use [reviewed guidance](https://example.org)."],
    ["image", "Use ![a remote diagram](https://example.org/fraction.svg)."],
    ["inline directive", "Use :unreviewed[arbitrary data]."],
    ["raw HTML", "Use <span>equal-sized</span> pieces."],
    ["list", "- First move\n- Second move"],
    ["block quote", "> First move"],
    ["fenced code", "```text\n1/2 + 1/3\n```"],
    ["display math", "$$\n\\frac{1}{2} + \\frac{1}{3}\n$$"],
    ["GFM-style table", "| Part | Value |\n| --- | --- |\n| left | 1/2 |"],
    ["one-column GFM-style table", "| Part |\n| --- |\n| left |"],
  ])("rejects unsupported %s in selected presentation prose", async (_name, body) => {
    await expect(
      compileContentSourceV2(validV2Source({ explanationBody: `${body}\n` })),
    ).rejects.toMatchObject({
      name: "ContentCompilationError",
      code: "presentation-plain-text",
    });
  });

  it("rejects presentation bodies outside the one-to-eight paragraph bound", async () => {
    const nineParagraphs = Array.from(
      { length: 9 },
      (_, index) => `Paragraph ${String(index + 1)}.`,
    ).join("\n\n");
    await expect(
      compileContentSourceV2(validV2Source({ explanationBody: `${nineParagraphs}\n` })),
    ).rejects.toMatchObject({
      name: "ContentCompilationError",
      code: "presentation-paragraph-count",
    });
  });

  it.each([
    ["unknown model", 'model="fraction-addition"', 'model="subtraction"'],
    ["missing result", ' result="5/6"', ""],
    ["extra attribute", ' result="5/6"', ' result="5/6" extra="blocked"'],
  ])("rejects %s in the worked-example header", async (_name, from, to) => {
    await expect(
      compileContentSourceV2(validV2Source().replace(from, to)),
    ).rejects.toBeInstanceOf(ContentCompilationError);
  });

  it.each([
    ["two-colon", "::"],
    ["four-colon", "::::"],
    ["five-colon", ":::::"],
    ["suffixed", "::: trailing"],
  ])("rejects a noncanonical %s presentation closing fence", async (_name, fence) => {
    const source = validV2Source().replace(
      "\n:::\n\n:::worked-example",
      `\n${fence}\n\n:::worked-example`,
    );

    await expect(compileContentSourceV2(source)).rejects.toMatchObject({
      name: "ContentCompilationError",
      code: "directive-closing-syntax",
    });
  });

  it("rejects a missing presentation closing fence instead of relying on parser recovery", async () => {
    const source = validV2Source().replace(
      "\n:::\n\n:::worked-example",
      "\n\n:::worked-example",
    );

    await expect(compileContentSourceV2(source)).rejects.toMatchObject({
      name: "ContentCompilationError",
      code: "directive-closing-balance",
    });
  });

  it("keeps hostile v2 Markdown and publication claims fail-closed", async () => {
    await expect(
      compileContentSourceV2(validV2Source({ tail: "<script>alert(1)</script>\n" })),
    ).rejects.toThrow("Raw HTML");
    await expect(
      compileContentSourceV2(
        validV2Source().replace("status: draft", "status: published"),
      ),
    ).rejects.toThrow("trusted release approval");
    await expect(
      compileContentSourceV2(
        validV2Source().replace(
          'id="lesson-explanation-01"',
          'id="lesson-explanation-01" __proto__="blocked"',
        ),
      ),
    ).rejects.toThrow("Forbidden directive attribute name");
  });

  it("does not accept a source schema through the wrong compiler version", async () => {
    const [v1Source, v2Source] = await Promise.all([
      readFile(v1FixtureUrl, "utf8"),
      readFile(v2FixtureUrl, "utf8"),
    ]);
    await expect(compileContentSourceV2(v1Source)).rejects.toThrow("frontmatter");
    await expect(compileContentSource(v2Source)).rejects.toBeInstanceOf(
      ContentCompilationError,
    );
  });

  it("preserves the immutable v1 source and content identities", async () => {
    const [source, artifact] = await Promise.all([
      readFile(v1FixtureUrl, "utf8"),
      readFile(v1ArtifactUrl, "utf8"),
    ]);
    const compiled = await compileContentSource(source);

    expect(await sha256Hex(source)).toBe(
      "79e734ec88fd0f5803c3063645726fb6934522a78ef79523112abd16dd3b78bb",
    );
    expect(compiled.document.sourceHash).toBe(
      "79e734ec88fd0f5803c3063645726fb6934522a78ef79523112abd16dd3b78bb",
    );
    expect(compiled.contentHash).toBe(
      "336ce8c164c92f836f3ba6ab2f3c1ed0b7230433b950c8c39e6f01ce84d1fbb5",
    );
    expect(await sha256Hex(artifact)).toBe(
      "336ce8c164c92f836f3ba6ab2f3c1ed0b7230433b950c8c39e6f01ce84d1fbb5",
    );
    expect(compiled.canonicalJson).toBe(artifact);
  });
});

interface ValidV2SourceOptions {
  readonly explanationBody?: string;
  readonly left?: string;
  readonly result?: string;
  readonly right?: string;
  readonly tail?: string;
  readonly workedExampleBody?: string;
}

function validV2Source(options: ValidV2SourceOptions = {}): string {
  const explanationBody =
    options.explanationBody ?? "Find a denominator both fractions can use.\n";
  const workedExampleBody =
    options.workedExampleBody ?? "Find the least common denominator.\n";
  const left = options.left ?? "1/2";
  const right = options.right ?? "1/3";
  const result = options.result ?? "5/6";
  const tail = options.tail ?? "";

  return `---
schema: exercisebook.content-source/v2
id: math.fractions.test
revision: 2
locale: en
title: Test lesson
skills:
  - math.fractions.add-unlike
prerequisites:
  - math.fractions.equivalent
authors:
  - name: Test author
    role: author
license:
  licenseId: LicenseRef-ExerciseBook-Draft
  sourceUrl: https://exercisebook.app/content/test
  attributionText: Draft test content.
  copyrightHolder: Test author
publication:
  status: draft
estimatedMinutes: 5
---

:::explanation{id="lesson-explanation-01" title="The three moves"}
${explanationBody}:::

:::worked-example{id="worked-example-01" title="One half plus one third" model="fraction-addition" left="${left}" right="${right}" result="${result}"}
${workedExampleBody}:::

:::exercise{id="practice-01" generator="fractions.add" version="1" count="8" difficulty="2" instruction="Add each pair of fractions. Give every answer in lowest terms."}
:::

${tail}`;
}
