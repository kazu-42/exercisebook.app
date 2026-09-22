import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  compileStudioLessonSource,
  compileStudioLessonSources,
  STUDIO_LESSON_SOURCE_PATHS,
  verifyCompiledStudioLessons,
} from "./content-source";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const source = await readFile(
  new URL("../../../content/studio/equations.md", import.meta.url),
  "utf8",
);
const sourcePath = "content/studio/equations.md";

describe("studio lesson source compiler", () => {
  it("compiles original draft sources with exact provenance and semantic examples", () => {
    const result = compileStudioLessonSource(source, sourcePath);
    expect(result).toMatchObject({
      schema: "exercisebook.studio-lesson/v1",
      compilerVersion: "studio-lesson-compiler@1",
      revision: 1,
      locale: "ja",
      topic: { id: "equations", number: "03" },
      lesson: { title: "解を変えない変形で、x を求めよう。" },
      exampleModel: { kind: "equation", coefficient: 4, constant: 1, right: 37 },
      provenance: {
        sourcePath,
        sourceRevision: 1,
        sourceHash: createHash("sha256").update(source).digest("hex"),
        origin: "original",
        status: "draft",
        licenseId: "LicenseRef-ExerciseBook-Review-Only",
      },
    });
    expect(result.lesson.rule).toContain("解の集合は同じ");
    expect(result.lesson).not.toHaveProperty("example");
    expect(result.lesson).not.toHaveProperty("steps");
  });

  it("has six explicitly registered lessons and checks the committed AST", async () => {
    const results = await compileStudioLessonSources(root);
    expect(results.map((entry) => entry.topic.id)).toEqual([
      "signed-numbers",
      "expressions",
      "equations",
      "signed-numbers",
      "expressions",
      "equations",
    ]);
    expect(STUDIO_LESSON_SOURCE_PATHS).toHaveLength(6);
    expect(new Set(results.map((entry) => entry.provenance.sourcePath)).size).toBe(6);
    for (const entry of results) {
      const bytes = await readFile(
        new URL(`../../../${entry.provenance.sourcePath}`, import.meta.url),
      );
      expect(entry.provenance.sourceHash).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
      expect(entry.provenance.status).toBe("draft");
      expect(entry.provenance.licenseId).toBe("LicenseRef-ExerciseBook-Review-Only");
    }
    await expect(verifyCompiledStudioLessons(root)).resolves.toBeUndefined();
  });

  it("preserves the exact three original source revisions", async () => {
    const results = await compileStudioLessonSources(root);
    expect(results.slice(0, 3).map((entry) => entry.provenance.sourceHash)).toEqual([
      "b265376a06bd47a1a205c6fe5e2cc47f76a3b4a90c7824aad9ae6a794c3b6aca",
      "4e7c7c614f393bb4163986d038b9d7744b075ec6e41862e4edc4a9f498e03c2f",
      "c83535b11e11e102b4e395599d55c79faf711bdc832ed51a48321e8874707742",
    ]);
  });

  it.each([
    "content/studio/equations-advanced.md",
    "content/studio/unknown-standard.md",
  ])("rejects unregistered level source paths: %s", (path) => {
    expect(() => compileStudioLessonSource(source, path)).toThrow(
      "unregistered source path",
    );
  });

  it.each([
    [
      "unknown schema",
      (text: string) => text.replace("lesson-source/v1", "lesson-source/v2"),
    ],
    ["unknown topic", (text: string) => text.replace("id: equations", "id: calculus")],
    [
      "source path mismatch",
      (text: string) => text.replace("id: equations", "id: expressions"),
    ],
    [
      "unknown field",
      (text: string) => text.replace("locale: ja", "locale: ja\nrelease: published"),
    ],
    [
      "publication claim",
      (text: string) => text.replace("status: draft", "status: published"),
    ],
    [
      "license absent",
      (text: string) =>
        text.replace("license: LicenseRef-ExerciseBook-Review-Only\n", ""),
    ],
    [
      "unapproved license",
      (text: string) =>
        text.replace("LicenseRef-ExerciseBook-Review-Only", "CC-BY-4.0"),
    ],
    [
      "duplicate keys",
      (text: string) => text.replace("locale: ja", "locale: ja\nlocale: en"),
    ],
    [
      "custom YAML tag",
      (text: string) => text.replace("locale: ja", "locale: !custom ja"),
    ],
    ["YAML anchor", (text: string) => text.replace("locale: ja", "locale: &locale ja")],
    ["YAML alias", (text: string) => text.replace("locale: ja", "locale: *locale")],
    [
      "unsafe key",
      (text: string) => text.replace("locale: ja", "locale: ja\n__proto__: {}"),
    ],
    [
      "unknown model",
      (text: string) => text.replace("kind: equation", "kind: arbitrary"),
    ],
    [
      "zero coefficient",
      (text: string) => text.replace('coefficient: "4"', 'coefficient: "0"'),
    ],
    [
      "nonintegral solution",
      (text: string) => text.replace('right: "37"', 'right: "38"'),
    ],
    [
      "unbounded number",
      (text: string) => text.replace('right: "37"', 'right: "9999999999"'),
    ],
    [
      "unknown relation",
      (text: string) =>
        text.replace("kind: equation", "kind: equation\n  relation: implies"),
    ],
    [
      "HTML in metadata",
      (text: string) => text.replace("一次方程式", "<script>alert(1)</script>"),
    ],
    ["raw HTML", (text: string) => `${text}\n<script>alert(1)</script>`],
    ["directive", (text: string) => `${text}\n::unknown{}`],
    ["MDX", (text: string) => `${text}\n{process.exit()}`],
    ["raw TeX", (text: string) => `${text}\n\\input{secret}`],
    ["remote asset", (text: string) => `${text}\n![x](https://example.com/x.svg)`],
    ["link", (text: string) => `${text}\n[answer](https://example.com/)`],
    ["code block", (text: string) => `${text}\n\x60\x60\x60js\nalert(1)\n\x60\x60\x60`],
    ["extra paragraph", (text: string) => `${text}\nSecond paragraph.`],
    ["second document", (text: string) => `${text}\n---\nlocale: en`],
    ["invalid unicode", (text: string) => `${text}\ud800`],
    ["oversized input", (text: string) => `${text}${"あ".repeat(10_000)}`],
  ])("rejects %s", (_name, mutate) => {
    expect(() => compileStudioLessonSource(mutate(source), sourcePath)).toThrow();
  });

  it("rejects source traversal before reading or compiling", () => {
    expect(() =>
      compileStudioLessonSource(source, "content/studio/../equations.md"),
    ).toThrow();
  });

  it("binds source bytes and authoring revisions without implicit normalization", () => {
    const original = compileStudioLessonSource(source, sourcePath);
    const crlf = compileStudioLessonSource(source.replaceAll("\n", "\r\n"), sourcePath);
    expect(original.lesson).toEqual(crlf.lesson);
    expect(original.provenance.sourceHash).not.toEqual(crlf.provenance.sourceHash);
    const revised = compileStudioLessonSource(
      source.replace('revision: "1"', 'revision: "2"'),
      sourcePath,
    );
    expect(revised.revision).toBe(2);
    expect(revised.provenance.sourceRevision).toBe(2);
    expect(revised.provenance.sourceHash).not.toEqual(original.provenance.sourceHash);
  });
});
