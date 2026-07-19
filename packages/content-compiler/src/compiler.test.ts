import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { materializeFractionAdditionWorksheetFromContent } from "@exercisebook/generators";
import { validateContentDocumentV1 } from "@exercisebook/schemas";

import { ContentCompilationError, compileContentSource } from "./compiler.js";

const fixtureUrl = new URL(
  "../../../content/en/math/fractions/add-unlike-denominators.md",
  import.meta.url,
);

describe("ContentDocumentV1 compiler", () => {
  it.each([null, 42, ["source"], new String("source")])(
    "rejects non-primitive runtime source input: %j",
    async (source) => {
      await expect(
        compileContentSource(source as unknown as string),
      ).rejects.toMatchObject({
        name: "ContentCompilationError",
        code: "source-type",
      });
    },
  );

  it("compiles the reviewed fraction lesson into byte-stable canonical data", async () => {
    const source = await readFile(fixtureUrl, "utf8");
    const first = await compileContentSource(source);
    const second = await compileContentSource(source);

    expect(validateContentDocumentV1(first.document)).toEqual(first.document);
    expect(first.canonicalJson).toBe(second.canonicalJson);
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.contentHash).toBe(
      "336ce8c164c92f836f3ba6ab2f3c1ed0b7230433b950c8c39e6f01ce84d1fbb5",
    );
    expect(first.document.sourceHash).toBe(
      "79e734ec88fd0f5803c3063645726fb6934522a78ef79523112abd16dd3b78bb",
    );
    expect(first.document.publication.status).toBe("draft");
    expect(first.document.license.licenseId).toBe("LicenseRef-ExerciseBook-Draft");
    expect(first.document.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "worked-example" }),
        expect.objectContaining({
          type: "exercise",
          generator: expect.objectContaining({ id: "fractions.add", version: "1" }),
          count: 8,
        }),
        expect.objectContaining({
          type: "interactive",
          printFallback: expect.any(String),
        }),
      ]),
    );
  });

  it("resolves the reviewed generator directive into the concrete 8-item instance", async () => {
    const source = await readFile(fixtureUrl, "utf8");
    const compiled = await compileContentSource(source);
    const materialized = await materializeFractionAdditionWorksheetFromContent(
      compiled.document,
      {
        assignmentId: "compiler-integration-01",
        localStudyDate: "2026-07-19",
        timeZone: "Asia/Tokyo",
        locale: "en",
        seed: "0123456789abcdef".repeat(4),
        seedSecretVersion: "test-secret-v1",
      },
    );

    expect(materialized.instance.slots).toHaveLength(8);
    expect(
      materialized.instance.slots.every(
        (slot) =>
          slot.prompt.instruction ===
          "Add each pair of fractions. Give every answer in lowest terms.",
      ),
    ).toBe(true);
    expect(materialized.instance.content[0]?.sourceHash).toBe(
      compiled.document.sourceHash,
    );
    expect(materialized.instance.content[0]?.contentHash).toBe(compiled.contentHash);
    expect(materialized.instance.content[0]?.compilerVersion).toBe(
      compiled.document.compilerVersion,
    );
    expect(
      materialized.instance.slots.every((slot) => slot.id.startsWith("practice-")),
    ).toBe(true);
  });

  it.each([
    ["unknown directive", ':::surprise{id="x"}\nNo.\n:::\n', "directive"],
    ["raw HTML", "<script>alert(1)</script>\n", "HTML"],
    ["remote image", "![remote](https://example.com/a.png)\n", "image"],
    ["executable fence", "```js\nalert(1)\n```\n", "code"],
    ["dangerous TeX", "Use $\\input{secret}$.\n", "math"],
    ["TeX hexadecimal control-sequence escape", "Use $^^5cinput{secret}$.\n", "math"],
    ["TeX comment syntax", "Use $1% ignored payload$.\n", "math"],
    [
      "JavaScript URL in math",
      "Use $\\href{javascript:alert(1)}{click}$.\n",
      "allowlist",
    ],
    [
      "remote image in math",
      "Use $\\includegraphics{https://example.com/a.png}$.\n",
      "allowlist",
    ],
    ["unbalanced math", "Use $\\frac{1}{2$.\n", "unbalanced"],
    ["empty fraction numerator", "Use $\\frac{}{2}$.\n", "must not be empty"],
    [
      "whitespace-only fraction arguments",
      "Use $\\frac{   }{ }$.\n",
      "must not be empty",
    ],
  ])("fails closed for %s", async (_name, body, expectedMessage) => {
    const source = validSourceWithBody(body);
    await expect(compileContentSource(source)).rejects.toThrow(expectedMessage);
  });

  it("rejects unknown frontmatter fields and YAML aliases", async () => {
    await expect(
      compileContentSource(
        validSourceWithBody("Safe.\n").replace(
          "estimatedMinutes: 5",
          "estimatedMinutes: 5\nunknown: blocked",
        ),
      ),
    ).rejects.toBeInstanceOf(ContentCompilationError);

    await expect(
      compileContentSource(
        validSourceWithBody("Safe.\n").replace(
          "skills:\n  - math.fractions.add-unlike",
          "skills: &skills\n  - math.fractions.add-unlike\nprerequisites: *skills",
        ),
      ),
    ).rejects.toThrow("YAML");
  });

  it.each(["__proto__", "constructor", "prototype"])(
    "rejects a prototype-sensitive YAML frontmatter key before Zod parsing: %s",
    async (key) => {
      await expect(
        compileContentSource(
          validSourceWithBody("Safe.\n").replace(
            "estimatedMinutes: 5",
            `estimatedMinutes: 5\n${key}: blocked`,
          ),
        ),
      ).rejects.toThrow("Forbidden data property");
    },
  );

  it("enforces source byte limits before parsing", async () => {
    await expect(compileContentSource("x".repeat(262_145))).rejects.toThrow(
      "source-bytes-limit",
    );
  });

  it.each([
    ["frontmatter", validSourceWithBody("Safe.\n").replace("Test lesson", "\ud800")],
    ["body", validSourceWithBody("Unsafe \udc00 body.\n")],
  ])("rejects invalid Unicode in %s before UTF-8 hashing", async (_area, source) => {
    await expect(compileContentSource(source)).rejects.toMatchObject({
      name: "ContentCompilationError",
      code: "source-unicode",
    });
  });

  it("bounds nested allowlisted math before recursive parsing can exhaust the host", async () => {
    let nestedMath = "1";
    for (let depth = 0; depth < 33; depth += 1) {
      nestedMath = `\\frac{${nestedMath}}{2}`;
    }
    await expect(
      compileContentSource(validSourceWithBody(`Use $${nestedMath}$.\n`)),
    ).rejects.toThrow("math-depth-limit");
  });

  it("preserves nested fraction relationships in accessible math text", async () => {
    const compiled = await compileContentSource(
      validSourceWithBody("Use $\\frac{\\frac{1}{2}}{3}$.\n"),
    );
    const paragraph = compiled.document.nodes.find((node) => node.type === "paragraph");
    const math =
      paragraph?.type === "paragraph"
        ? paragraph.children.find((child) => child.type === "math")
        : undefined;

    expect(math).toEqual({
      type: "math",
      source: "\\frac{\\frac{1}{2}}{3}",
      accessibleText: "(1 over 2) over 3",
    });
  });

  it("rejects an exercise count above the generator's operational retry cap", async () => {
    await expect(
      compileContentSource(
        validSourceWithBody(
          ':::exercise{id="practice" generator="fractions.add" version="1" count="97" difficulty="1" instruction="Add."}\n:::\n',
        ),
      ),
    ).rejects.toThrow("must not exceed 96");
  });

  it("rejects an exercise instruction that cannot cross the worksheet boundary", async () => {
    await expect(
      compileContentSource(
        validSourceWithBody(
          `:::exercise{id="practice" generator="fractions.add" version="1" count="8" difficulty="1" instruction="${"a".repeat(501)}"}\n:::\n`,
        ),
      ),
    ).rejects.toThrow("content-schema");
  });

  it("rejects a generator revision in a locale it cannot materialize", async () => {
    await expect(
      compileContentSource(
        validSourceWithBody(
          ':::exercise{id="practice" generator="fractions.add" version="1" count="8" difficulty="1" instruction="Add."}\n:::\n',
        ).replace("locale: en", "locale: ja-JP"),
      ),
    ).rejects.toThrow("unsupported-generator-locale");
  });

  it("rejects multiple exercise directives that the Phase-1 resolver cannot combine", async () => {
    await expect(
      compileContentSource(
        validSourceWithBody(
          [
            ':::exercise{id="practice-a" generator="fractions.add" version="1" count="4" difficulty="1" instruction="Add."}',
            ":::",
            "",
            ':::exercise{id="practice-b" generator="fractions.add" version="1" count="4" difficulty="1" instruction="Add."}',
            ":::",
            "",
          ].join("\n"),
        ),
      ),
    ).rejects.toThrow("generator-directive-count");
  });

  it("rejects author lists that cannot cross the worksheet attribution boundary", async () => {
    const oversizedAuthors = `authors:
  - name: ${"a".repeat(120)}
    role: author
  - name: ${"b".repeat(120)}
    role: reviewer`;
    await expect(
      compileContentSource(
        validSourceWithBody("Safe.\n").replace(
          `authors:
  - name: Test author
    role: author`,
          oversizedAuthors,
        ),
      ),
    ).rejects.toThrow("content-schema");
  });

  it("rejects duplicate taught skills before generator materialization", async () => {
    await expect(
      compileContentSource(
        validSourceWithBody("Safe.\n").replace(
          `skills:
  - math.fractions.add-unlike`,
          `skills:
  - math.fractions.add-unlike
  - math.fractions.add-unlike`,
        ),
      ),
    ).rejects.toThrow("Duplicate taught skill ID");
  });

  it("does not swallow prototype-named directive attributes", async () => {
    await expect(
      compileContentSource(
        validSourceWithBody(
          ':::exercise{id="practice" generator="fractions.add" version="1" count="8" difficulty="1" instruction="Add." __proto__="blocked"}\n:::\n',
        ),
      ),
    ).rejects.toThrow("Forbidden directive attribute name: __proto__");
  });

  it("does not mistake a prototype-like phrase inside a quoted value for a key", async () => {
    const compiled = await compileContentSource(
      validSourceWithBody(
        ':::exercise{id="practice" generator="fractions.add" version="1" count="8" difficulty="1" instruction="Explain __proto__=x safely."}\n:::\n',
      ),
    );

    expect(compiled.document.nodes[0]).toMatchObject({
      type: "exercise",
      instruction: "Explain __proto__=x safely.",
    });
  });

  it.each(['id="first" id="second"', 'instruction="First." instruction="Second."'])(
    "rejects duplicate directive attributes before parser last-wins: %s",
    async (duplicate) => {
      const attributes = [
        'generator="fractions.add"',
        'version="1"',
        'count="8"',
        'difficulty="1"',
        'instruction="Add."',
      ];
      if (duplicate.includes("instruction=")) {
        attributes.pop();
      }
      await expect(
        compileContentSource(
          validSourceWithBody(
            `:::exercise{${duplicate} ${attributes.join(" ")}}\n:::\n`,
          ),
        ),
      ).rejects.toThrow("Duplicate directive attribute name");
    },
  );

  it("treats a backslash as ordinary quoted-value data and still sees a following forbidden attribute", async () => {
    await expect(
      compileContentSource(
        validSourceWithBody(
          String.raw`:::exercise{id="practice-01" generator="fractions.add" version="1" count="8" difficulty="2" instruction="Add.\" __proto__="blocked"}
:::
`,
        ),
      ),
    ).rejects.toThrow("Forbidden directive attribute name: __proto__");
  });

  it("treats a backslash as ordinary quoted-value data and still sees a duplicate instruction", async () => {
    await expect(
      compileContentSource(
        validSourceWithBody(
          String.raw`:::exercise{id="practice-01" generator="fractions.add" version="1" count="8" difficulty="2" instruction="Add.\" instruction="Second."}
:::
`,
        ),
      ),
    ).rejects.toThrow("Duplicate directive attribute name: instruction");
  });

  it.each([
    [
      "adjacent repeated ID shorthand",
      ':::exercise{#first#second generator="fractions.add" version="1" count="8" difficulty="2" instruction="Add."}\n:::\n',
    ],
    [
      "three adjacent ID shorthands",
      ':::exercise{#first#second#third generator="fractions.add" version="1" count="8" difficulty="2" instruction="Add."}\n:::\n',
    ],
    [
      "ordinary name followed by shorthand punctuation",
      ':::exercise{id#second generator="fractions.add" version="1" count="8" difficulty="2" instruction="Add."}\n:::\n',
    ],
    [
      "prototype name followed by shorthand punctuation",
      ':::exercise{__proto__#practice-01 generator="fractions.add" version="1" count="8" difficulty="2" instruction="Add."}\n:::\n',
    ],
    [
      "valueless prototype and ID shorthand",
      ':::exercise{__proto__ #practice-01 generator="fractions.add" version="1" count="8" difficulty="2" instruction="Add."}\n:::\n',
    ],
    [
      "two valueless ID forms",
      ':::exercise{id id=second generator="fractions.add" version="1" count="8" difficulty="2" instruction="Add."}\n:::\n',
    ],
    [
      "valueless ID and ID shorthand",
      ':::exercise{id #second generator="fractions.add" version="1" count="8" difficulty="2" instruction="Add."}\n:::\n',
    ],
    [
      "explicit ID after ID shorthand",
      ':::exercise{#first id="second" generator="fractions.add" version="1" count="8" difficulty="2" instruction="Add."}\n:::\n',
    ],
    [
      "optional directive label",
      ':::worked-example[label]{id="x" title="T" __proto__="blocked"}\nBody.\n:::\n',
    ],
    [
      "optional directive label with duplicate ID",
      ':::worked-example[label]{id="first" id="second" title="T"}\nBody.\n:::\n',
    ],
    [
      "four-colon container fence",
      '::::worked-example{id="first" id="second" title="T" __proto__="blocked"}\nBody.\n::::\n',
    ],
  ])("rejects noncanonical Phase-1 directive headers: %s", async (_name, body) => {
    await expect(compileContentSource(validSourceWithBody(body))).rejects.toMatchObject(
      {
        name: "ContentCompilationError",
        code: expect.stringMatching(/^directive-(?:attribute|header)-syntax$/),
      },
    );
  });

  it("does not treat source frontmatter as a trusted publication approval", async () => {
    const selfPublished = validSourceWithBody("Safe.\n")
      .replace("licenseId: LicenseRef-ExerciseBook-Draft", "licenseId: CC-BY-4.0")
      .replace("status: draft", "status: published");

    await expect(compileContentSource(selfPublished)).rejects.toThrow(
      "trusted release approval",
    );
  });

  it("does not materialize a self-asserted published ContentDocument", async () => {
    const source = await readFile(fixtureUrl, "utf8");
    const compiled = await compileContentSource(source);

    await expect(
      materializeFractionAdditionWorksheetFromContent(
        {
          ...compiled.document,
          publication: { status: "published" },
          license: {
            ...compiled.document.license,
            licenseId: "CC-BY-4.0",
          },
        },
        {
          assignmentId: "compiler-integration-01",
          localStudyDate: "2026-07-19",
          timeZone: "Asia/Tokyo",
          locale: "en",
          seed: "0123456789abcdef".repeat(4),
          seedSecretVersion: "test-secret-v1",
        },
      ),
    ).rejects.toThrow("trusted release approval");
  });

  it("rejects non-HTTP attribution URLs at the compilation boundary", async () => {
    const unsafeUrl = validSourceWithBody("Safe.\n").replace(
      "sourceUrl: https://exercisebook.app/content/test",
      "sourceUrl: javascript:alert(1)",
    );

    await expect(compileContentSource(unsafeUrl)).rejects.toThrow("schema");
  });

  it.each([
    [
      "invalid content ID",
      validSourceWithBody("Safe.\n").replace(
        "id: math.fractions.test",
        "id: Math.Fractions.Test",
      ),
    ],
    ["oversized paragraph", validSourceWithBody(`${"x".repeat(20_001)}\n`)],
  ])("wraps %s as a bounded compiler diagnostic", async (_name, source) => {
    try {
      await compileContentSource(source);
      throw new Error("Expected compilation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ContentCompilationError);
      expect((error as Error).message.length).toBeLessThanOrEqual(4_100);
    }
  });

  it("bounds frontmatter diagnostics with many simultaneous unknown keys", async () => {
    const unknownKeys = Array.from(
      { length: 1_200 },
      (_, index) => `unknown${String(index).padStart(4, "0")}: value`,
    ).join("\n");
    const source = validSourceWithBody("Safe.\n").replace(
      "estimatedMinutes: 5",
      `estimatedMinutes: 5\n${unknownKeys}`,
    );

    try {
      await compileContentSource(source);
      throw new Error("Expected compilation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ContentCompilationError);
      expect((error as ContentCompilationError).code).toBe("frontmatter-schema");
      expect((error as Error).message.length).toBeLessThanOrEqual(4_100);
    }
  });
});

function validSourceWithBody(body: string): string {
  return `---
schema: exercisebook.content-source/v1
id: math.fractions.test
revision: 1
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

${body}`;
}
