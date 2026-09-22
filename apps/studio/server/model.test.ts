import { describe, expect, it } from "vitest";
import type { Level, TopicId } from "../src/contracts";
import {
  createWorkbook,
  explainFixture,
  getAnswerKey,
  getFixtureModels,
  gradeWorkbook,
  parseIntegerAnswer,
  restoreWorkbook,
  topics,
  type FixtureModel,
} from "./model";

// Parse the displayed affine equations independently of the fixture renderer.
function affineEquation(text: string) {
  const match = /^(−?\d*)x(?: ([+−]) (\d+))? = (−?\d+)$/.exec(text);
  if (!match) throw new Error(`Not an affine equation: ${text}`);
  return {
    coefficient: match[1] === "" ? 1 : Number(match[1]?.replace("−", "-")),
    constant: Number(match[3] ?? 0) * (match[2] === "−" ? -1 : 1),
    right: Number(match[4]?.replace("−", "-")),
  };
}

function expectSameSolutionSet(first: string, second: string) {
  const a = affineEquation(first);
  const b = affineEquation(second);
  expect(a.coefficient).not.toBe(0);
  expect(b.coefficient).not.toBe(0);
  // With both coefficients nonzero, equality of the roots is equivalent to
  // equality of the entire real solution sets, not just one sampled input.
  expect(
    (a.right - a.constant) * b.coefficient === (b.right - b.constant) * a.coefficient,
  ).toBe(true);
}

// A small independent evaluator for the allowlisted displayed arithmetic. It
// never executes authored code and honors parentheses and operator precedence.
function evaluateDisplayedExpression(source: string, x: number): number {
  const input = source
    .replaceAll("−", "-")
    .replace(/(\d+)x/g, `$1×(${x})`)
    .replaceAll("x", `(${x})`)
    .replaceAll(/\s/g, "");
  const tokens = input.match(/\d+|[+\-×÷()]/g) ?? [];
  if (tokens.join("") !== input) throw new Error(`Unsupported expression: ${source}`);
  let position = 0;
  const primary = (): number => {
    const token = tokens[position++];
    if (token === "+") return primary();
    if (token === "-") return -primary();
    if (token === "(") {
      const value = sum();
      if (tokens[position++] !== ")") throw new Error("Unclosed parentheses");
      return value;
    }
    if (!token || !/^\d+$/.test(token)) throw new Error("Expected number");
    return Number(token);
  };
  const product = (): number => {
    let value = primary();
    while (tokens[position] === "×" || tokens[position] === "÷") {
      const operator = tokens[position++];
      const right = primary();
      if (operator === "÷" && right === 0) throw new Error("Division by zero");
      value = operator === "×" ? value * right : value / right;
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (tokens[position] === "+" || tokens[position] === "-") {
      const operator = tokens[position++];
      const right = product();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };
  const value = sum();
  if (position !== tokens.length) throw new Error("Unconsumed arithmetic");
  return value;
}

describe("explicit mathematical relationships", () => {
  it("independently evaluates every displayed equality in all 48 solution traces", () => {
    for (const topic of topics) {
      for (const level of ["foundation", "standard"] as const) {
        const workbook = createWorkbook({ topicId: topic.id, level, count: 8 });
        const models = getFixtureModels(workbook);
        getAnswerKey(workbook).forEach((key, index) => {
          const model = models[index]!;
          const x = model.kind === "expression" ? model.value : Number(key.answer);
          for (const step of key.steps) {
            const [left, right, excess] = step.math.split("=");
            expect(excess).toBeUndefined();
            expect(
              evaluateDisplayedExpression(left!, x) ===
                evaluateDisplayedExpression(right!, x),
            ).toBe(true);
          }
        });
      }
    }
  });

  it("preserves the real solution set at every displayed equation transformation", () => {
    const examples = [
      ...(["foundation", "standard"] as const)
        .map((level) => {
          const workbook = createWorkbook({ topicId: "equations", level, count: 8 });
          return getAnswerKey(workbook).map((key, i) => ({
            start: workbook.items[i]!.prompt,
            steps: key.steps,
          }));
        })
        .flat(),
      { start: topics[2]!.lesson.example, steps: topics[2]!.lesson.steps },
    ];
    for (const example of examples) {
      let previous = example.start;
      expect(example.steps.map((step) => step.relation)).toEqual([
        "equivalent-equation",
        "equivalent-equation",
        "verification",
      ]);
      for (const step of example.steps) {
        expect(step.math).not.toMatch(/[→⇒⇔]/);
        expect(step.reason).not.toMatch(/[→⇒⇔]/);
        if (step.relation === "equivalent-equation") {
          expectSameSolutionSet(previous, step.math);
          expect(step.reason).toContain("解は変わりません");
          previous = step.math;
        }
      }
      expect(example.steps[1]!.reason).toContain("0 でなく");
      expect(example.steps[2]!.reason).toContain("代入");
    }
    expect(topics[2]!.lesson.rule).toContain("実数");
  });

  it("distinguishes substitution from equal-valued expression calculation", () => {
    for (const level of ["foundation", "standard"] as const) {
      const workbook = createWorkbook({ topicId: "expressions", level, count: 8 });
      for (const key of getAnswerKey(workbook)) {
        expect(key.steps.map((step) => step.relation)).toEqual([
          "substitution",
          "expression-equality",
          "expression-equality",
        ]);
        expect(key.steps[0]!.reason).toContain("のとき");
        expect(key.steps[0]!.reason).toContain("代入");
      }
    }
  });

  it.each([
    { kind: "arithmetic", operation: "add", left: 5, right: -5 },
    { kind: "arithmetic", operation: "subtract", left: -5, right: -5 },
    { kind: "arithmetic", operation: "multiply", left: 0, right: -5 },
    { kind: "arithmetic", operation: "divide", left: 0, right: -5 },
  ] satisfies FixtureModel[])(
    "explains zero without assigning it a positive or negative sign: %o",
    (model) => {
      const steps = explainFixture(model);
      expect(steps.at(-1)!.math).toMatch(/= 0$/);
      expect(steps.map((step) => step.reason).join(" ")).toContain("0");
      expect(steps.map((step) => step.reason).join(" ")).not.toMatch(
        /答えの符号は[正負]|大きい数の符号/,
      );
    },
  );

  it("keeps zero solutions and negative divisors reversible", () => {
    const steps = explainFixture({
      kind: "equation",
      coefficient: -3,
      constant: 0,
      right: 0,
    });
    expect(steps[0]!.math).toBe("−3x = 0");
    expect(steps[1]!.math).toBe("x = 0");
    expectSameSolutionSet("−3x + 0 = 0", steps[0]!.math);
    expectSameSolutionSet(steps[0]!.math, steps[1]!.math);
    expect(steps[1]!.reason).toContain("(−3)");
  });

  it.each([
    { kind: "equation", coefficient: 0, constant: 3, right: 3 },
    { kind: "arithmetic", operation: "divide", left: 3, right: 0 },
  ] satisfies FixtureModel[])(
    "rejects undefined division rather than describing an equivalent equation: %o",
    (model) => {
      expect(() => explainFixture(model)).toThrow();
    },
  );
});

describe("draft Japanese workbook fixtures", () => {
  it("pins the draft-2 semantic vector; fixture changes require a version bump", () => {
    expect(
      createWorkbook({ topicId: "equations", level: "foundation", count: 4 })
        .instanceHash,
    ).toBe("8c2b30e1548924387d799ec143e5095e66aaeda440cdb2d3603d063e1f0fd2c8");
  });

  it("has deterministic, distinct identities for every bounded selection", () => {
    const ids = new Set<string>();
    for (const topic of topics) {
      for (const level of ["foundation", "standard"] as const) {
        for (const count of [4, 6, 8] as const) {
          const request = { topicId: topic.id, level, count };
          const workbook = createWorkbook(request);
          expect(createWorkbook(request)).toEqual(workbook);
          expect(restoreWorkbook(workbook.id)).toEqual(workbook);
          expect(workbook.items).toHaveLength(count);
          expect(workbook.instanceHash).toMatch(/^[a-f0-9]{64}$/);
          ids.add(workbook.id);
        }
      }
    }
    expect(ids.size).toBe(18);
    expect(restoreWorkbook("unknown")).toBeUndefined();
  });

  it.each([
    ["signed-numbers", "foundation", [8, -4, -11, 13, 3, -14, 5, -2]],
    ["signed-numbers", "standard", [-24, 35, -6, 8, -36, 18, -5, 6]],
    ["expressions", "foundation", [11, 18, 3, 17, 8, 19, 10, 15]],
    ["expressions", "standard", [-11, 14, -19, 20, -8, 17, -22, 13]],
    ["equations", "foundation", [4, 3, 5, 2, 6, 7, 8, 1]],
    ["equations", "standard", [-4, 5, -3, 6, -2, 7, -5, 4]],
  ] satisfies [TopicId, Level, number[]][])(
    "independently verifies all %s / %s answers and equation substitution",
    (topicId, level, expected) => {
      const workbook = createWorkbook({ topicId, level, count: 8 });
      const key = getAnswerKey(workbook);
      expect(key.map((item) => Number(item.answer))).toEqual(expected);
      const semantics = getFixtureModels(workbook);
      semantics.forEach((model, index) => {
        const answer = Number(key[index]?.answer);
        if (model.kind === "equation") {
          expect(model.coefficient * answer + model.constant).toBe(model.right);
        } else if (model.kind === "expression") {
          expect(model.value * model.coefficient + model.constant).toBe(answer);
        } else if (model.operation === "add") {
          expect(answer - model.right).toBe(model.left);
        } else if (model.operation === "subtract") {
          expect(answer + model.right).toBe(model.left);
        } else if (model.operation === "multiply") {
          expect(answer / model.right).toBe(model.left);
        } else {
          expect(answer * model.right).toBe(model.left);
        }
        expect(Number.isSafeInteger(answer)).toBe(true);
        expect(key[index]?.steps.length).toBeGreaterThanOrEqual(2);
        expect(JSON.stringify(key[index]?.steps)).not.toMatch(/NaN|undefined|Infinity/);
      });
      expect(new Set(workbook.items.map((item) => item.prompt)).size).toBe(8);
    },
  );

  it("projects only public prompts, with no private answer or semantic model fields", () => {
    const workbook = createWorkbook({
      topicId: "equations",
      level: "standard",
      count: 8,
    });
    for (const item of workbook.items) {
      expect(Object.keys(item).sort()).toEqual(["id", "instruction", "prompt"]);
    }
    expect(JSON.stringify(workbook)).not.toMatch(
      /"answer"|"solution"|"coefficient"|"right"|"submitted"/,
    );
    expect(Object.keys(workbook).sort()).toEqual([
      "count",
      "id",
      "instanceHash",
      "items",
      "lesson",
      "level",
      "levelLabel",
      "minutes",
      "reason",
      "saved",
      "schemaVersion",
      "title",
      "topicId",
    ]);
  });

  it("distinguishes incorrect, invalid, unanswered and correct without retaining submissions", () => {
    const workbook = createWorkbook({
      topicId: "equations",
      level: "foundation",
      count: 4,
    });
    const result = gradeWorkbook(workbook, {
      answers: { "q-1": " ｘ ＝ ＋４ ", "q-2": "8", "q-3": "0x5", "q-4": " " },
    });
    expect(result.items.map((item) => item.status)).toEqual([
      "correct",
      "incorrect",
      "invalid",
      "unanswered",
    ]);
    expect(result.correctCount).toBe(1);
    expect(result.total).toBe(4);
    expect(getAnswerKey(workbook).every((item) => item.submitted === "")).toBe(true);
    expect(gradeWorkbook(workbook, { answers: {} }).correctCount).toBe(0);
  });

  it.each([
    "1e1",
    "0x10",
    "NaN",
    "Infinity",
    "1/2",
    "1.0",
    "1junk",
    "1 2",
    "--1",
    "1\n2",
    "9".repeat(80),
  ])("rejects invalid numeric syntax: %s", (answer) => {
    expect(parseIntegerAnswer(answer, false)).toBeUndefined();
  });

  it("normalizes fullwidth digits and mathematical minus, allowing x= only for equations", () => {
    expect(parseIntegerAnswer(" −１２ ", false)).toBe(-12);
    expect(parseIntegerAnswer("＋００４", false)).toBe(4);
    expect(parseIntegerAnswer(" x = −3 ", true)).toBe(-3);
    expect(parseIntegerAnswer("x=3", false)).toBeUndefined();
  });

  it.each([
    null,
    [],
    {},
    { topicId: "missing", level: "foundation", count: 4 },
    { topicId: "equations", level: "hard", count: 4 },
    { topicId: "equations", level: "foundation", count: 1000 },
    { topicId: "equations", level: "foundation", count: 4, seed: "user" },
  ])("rejects non-allowlisted create payloads", (request) => {
    expect(() => createWorkbook(request)).toThrow();
  });

  it.each([
    null,
    [],
    {},
    { answers: [] },
    { answers: { "q-99": "4" } },
    { answers: { "q-1": 4 } },
    { answers: {}, learner: "private" },
  ])("rejects malformed grade payloads", (request) => {
    const workbook = createWorkbook({
      topicId: "equations",
      level: "foundation",
      count: 4,
    });
    expect(() => gradeWorkbook(workbook, request)).toThrow();
  });
});
