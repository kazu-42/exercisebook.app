import {
  canonicalizeJson,
  deriveSlotSeed,
  DeterministicRandomExhaustedError,
  sha256Hex,
} from "@exercisebook/domain";
import { describe, expect, it, vi } from "vitest";
import { topics } from "../server/model";
import type { Level, TopicId, WorkbookRequest } from "../src/contracts";
import {
  generateWorkbook,
  MAXIMUM_GENERATION_ATTEMPTS,
  selectGeneratedModel,
  STUDIO_GENERATOR_ID,
  STUDIO_GENERATOR_VERSION,
  verifyGeneratedWorkbook,
} from "./generator";
import { promptFor, type FixtureModel } from "./math-model";

const seed = (number: number) => number.toString(16).padStart(64, "0");
const source = "studio-test-sources@1";
const choices: [TopicId, Level][] = topics.flatMap((topic) =>
  (["foundation", "standard"] as const).map((level) => [topic.id, level]),
);
const request: WorkbookRequest = { topicId: "equations", level: "standard", count: 8 };

function independentlyCalculatedAnswer(model: FixtureModel): number {
  if (model.kind === "equation")
    return (model.right - model.constant) / model.coefficient;
  if (model.kind === "expression")
    return model.value * model.coefficient + model.constant;
  if (model.operation === "add") return model.left + model.right;
  if (model.operation === "subtract") return model.left - model.right;
  if (model.operation === "multiply") return model.left * model.right;
  return model.left / model.right;
}

function affine(text: string) {
  const match = /^(−?\d*)x(?: ([+−]) (\d+))? = (−?\d+)$/.exec(text);
  if (!match) throw new Error(`Invalid displayed affine equation: ${text}`);
  return {
    coefficient: match[1] === "" ? 1 : Number(match[1]!.replace("−", "-")),
    constant: Number(match[3] ?? 0) * (match[2] === "−" ? -1 : 1),
    right: Number(match[4]!.replace("−", "-")),
  };
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

describe("bounded Japanese integer generation v1", () => {
  it("pins the semantic vector including the seed, source, relations and model manifest", async () => {
    const result = await generateWorkbook(request, seed(42), topics, source);
    expect(result.workbook.instanceHash).toBe(
      "00cb18c6ba1cbdc7a04555145058b9111d0d1848f83d2d7bee857a47aa6c0f8f",
    );
  });

  it("accepts and pins the actual git-commit plus lesson-hash release revision", async () => {
    const revision = `${"a".repeat(40)}+${"b".repeat(64)}`;
    const result = await generateWorkbook(request, seed(42), topics, revision);
    expect(result.sourceRevision).toBe(revision);
    expect(await verifyGeneratedWorkbook(result)).toBe(true);
    expect(result.workbook.instanceHash).toBe(
      "ff682b689fa3e329cbab9cdbbe72c0200fa2d3f1a51b9d7a7ab45c0dfa74ca20",
    );
  });

  it.each(choices)(
    "checks 128 seeds across all %s / %s constraints independently",
    async (topicId, level) => {
      const distinct = new Set<string>();
      const exampleAnswer =
        topicId === "equations" ? 9 : topicId === "expressions" ? 23 : -7;
      for (let base = 0; base < 128; base += 1) {
        const result = await generateWorkbook(
          { topicId, level, count: 8 },
          seed(base),
          topics,
          source,
        );
        expect(await verifyGeneratedWorkbook(result)).toBe(true);
        distinct.add(result.workbook.items.map((item) => item.prompt).join("|"));
        expect(new Set(result.workbook.items.map((item) => item.prompt)).size).toBe(8);
        expect(result.manifest.slots).toHaveLength(8);
        expect(new Set(result.manifest.slots.map((slot) => slot.family)).size).toBe(2);
        result.manifest.slots.forEach((slot, index) => {
          const model = slot.model;
          const answer = Number(result.answers[index]!.answer);
          expect(answer === independentlyCalculatedAnswer(model)).toBe(true);
          expect(Number.isSafeInteger(answer)).toBe(true);
          expect(Math.abs(answer)).toBeLessThanOrEqual(100);
          expect(answer).not.toBe(exampleAnswer);
          expect(slot.attempts).toBeGreaterThanOrEqual(1);
          expect(slot.attempts).toBeLessThanOrEqual(MAXIMUM_GENERATION_ATTEMPTS);
          expect(result.workbook.items[index]!.prompt).not.toBe(
            result.workbook.lesson.example,
          );
          if (model.kind === "arithmetic") {
            if (level === "foundation") {
              expect(["add", "subtract"]).toContain(model.operation);
              expect(Math.abs(model.left)).toBeLessThanOrEqual(20);
              expect(Math.abs(model.right)).toBeLessThanOrEqual(20);
            } else {
              expect(["multiply", "divide"]).toContain(model.operation);
              expect(model.right).not.toBe(0);
              expect(Math.abs(model.right)).toBeLessThanOrEqual(9);
              expect(Math.abs(model.left)).toBeLessThanOrEqual(
                model.operation === "divide" ? 81 : 9,
              );
            }
          } else {
            expect(Math.abs(model.coefficient)).toBeGreaterThanOrEqual(2);
            expect(Math.abs(model.coefficient)).toBeLessThanOrEqual(9);
            expect(Math.abs(model.constant)).toBeLessThanOrEqual(12);
            if (level === "foundation") expect(model.coefficient).toBeGreaterThan(0);
            if (model.kind === "expression") {
              expect(Math.abs(model.value)).toBeLessThanOrEqual(9);
              expect(model.value).toBe(
                level === "foundation" ? Math.abs(model.value) : -Math.abs(model.value),
              );
            } else {
              expect(Math.abs(answer)).toBeLessThanOrEqual(9);
              expect(model.coefficient * answer + model.constant).toBe(model.right);
              let previous = affine(result.workbook.items[index]!.prompt);
              for (const step of result.answers[index]!.steps) {
                if (step.relation !== "equivalent-equation") continue;
                const next = affine(step.math);
                expect(next.coefficient).not.toBe(0);
                expect(
                  (previous.right - previous.constant) * next.coefficient ===
                    (next.right - next.constant) * previous.coefficient,
                ).toBe(true);
                expect(step.reason).toContain("解は変わりません");
                previous = next;
              }
            }
          }
          expect(
            result.answers[index]!.steps.some((step) => /[→⇒⇔]/.test(step.math)),
          ).toBe(false);
          const x = model.kind === "expression" ? model.value : answer;
          for (const step of result.answers[index]!.steps) {
            const [left, right, extra] = step.math.split("=");
            expect(extra).toBeUndefined();
            expect(
              evaluateDisplayedExpression(left!, x) ===
                evaluateDisplayedExpression(right!, x),
            ).toBe(true);
          }
        });
      }
      expect(distinct.size).toBe(128);
    },
    30_000,
  );

  it("reproduces identical seeds, retains slot prefixes across counts and hashes the source", async () => {
    const first = await generateWorkbook(request, seed(12), topics, source);
    const repeated = await generateWorkbook(
      { count: 8, level: "standard", topicId: "equations" },
      seed(12),
      [...topics].reverse(),
      source,
    );
    expect(repeated).toEqual(first);
    const shorter = await generateWorkbook(
      { ...request, count: 4 },
      seed(12),
      topics,
      source,
    );
    expect(first.workbook.items.slice(0, 4)).toEqual(shorter.workbook.items);
    expect(first.answers.slice(0, 4)).toEqual(shorter.answers);
    expect(first.manifest.slots.slice(0, 4)).toEqual(shorter.manifest.slots);
    const revised = await generateWorkbook(
      request,
      seed(12),
      topics,
      "studio-test-sources@2",
    );
    expect(revised.workbook.instanceHash).not.toBe(first.workbook.instanceHash);
    expect(revised.workbook.items).toEqual(first.workbook.items);
    for (const slot of first.manifest.slots)
      expect(slot.subseed).toBe(
        await deriveSlotSeed({
          baseSeed: seed(12),
          generatorId: STUDIO_GENERATOR_ID,
          generatorVersion: STUDIO_GENERATOR_VERSION,
          slotId: slot.slotId,
        }),
      );
  });

  it.each(choices)(
    "terminates rejection at 16 and uses deterministic unique fallback for %s / %s",
    (topicId, level) => {
      const random = { nextUint32: () => 0, nextInt: (minimum: number) => minimum };
      const selected = selectGeneratedModel({
        topicId,
        level,
        index: 0,
        random,
        usedPrompts: new Set(),
        excludedPrompt: "",
        excludedAnswer: 999,
      });
      const excludedAnswer = independentlyCalculatedAnswer(selected.model);
      const usedPrompts = new Set<string>();
      for (let count = 0; count < 8; count += 1) {
        const options = {
          topicId,
          level,
          index: 0,
          random,
          usedPrompts,
          excludedPrompt: "",
          excludedAnswer,
        };
        const next = selectGeneratedModel(options);
        expect(next).toEqual(selectGeneratedModel(options));
        expect(next.attempts).toBe(16);
        expect(next.fallback).toBe(true);
        expect(independentlyCalculatedAnswer(next.model)).not.toBe(excludedAnswer);
        const prompt = promptFor(next.model);
        expect(usedPrompts.has(prompt)).toBe(false);
        usedPrompts.add(prompt);
      }
      expect(usedPrompts.size).toBe(8);
    },
  );

  it("does not use ambient randomness and captures caller-owned source before awaiting", async () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Ambient randomness");
    });
    try {
      const mutableTopics = structuredClone(topics);
      const expected = await generateWorkbook(request, seed(19), topics, source);
      const pending = generateWorkbook(request, seed(19), mutableTopics, source);
      mutableTopics[2]!.lesson.title = "Changed after entry";
      expect(await pending).toEqual(expected);
    } finally {
      random.mockRestore();
    }
  });

  it("uses deterministic fallback for bounded RNG exhaustion and propagates unrelated errors", () => {
    const exhausted = vi.fn((): number => {
      throw new DeterministicRandomExhaustedError("128 attempts");
    });
    const options = {
      topicId: "equations" as const,
      level: "standard" as const,
      index: 0,
      random: { nextUint32: () => 0, nextInt: exhausted },
      usedPrompts: new Set<string>(),
      excludedPrompt: "",
      excludedAnswer: 9,
    };
    const selected = selectGeneratedModel(options);
    expect(selected.fallback).toBe(true);
    expect(selected.attempts).toBe(1);
    expect(exhausted).toHaveBeenCalledTimes(1);
    expect(selectGeneratedModel(options)).toEqual(selected);
    const failure = new Error("unexpected infrastructure failure");
    expect(() =>
      selectGeneratedModel({
        ...options,
        random: {
          nextUint32: () => 0,
          nextInt: () => {
            throw failure;
          },
        },
      }),
    ).toThrow(failure);
  });

  it.each([
    [{ ...request, count: 9 }, seed(1), source],
    [{ ...request, topicId: "unknown" }, seed(1), source],
    [{ ...request, level: "unknown" }, seed(1), source],
    [{ ...request, extra: true }, seed(1), source],
    [request, "bad seed", source],
    [request, seed(1), ""],
    [request, seed(1), "a".repeat(161)],
    [request, seed(1), "source revision"],
  ])(
    "rejects inputs outside the reviewed forms",
    async (invalidRequest, baseSeed, revision) => {
      await expect(
        generateWorkbook(
          invalidRequest as WorkbookRequest,
          baseSeed as string,
          topics,
          revision as string,
        ),
      ).rejects.toThrow();
    },
  );

  it("student DTO does not carry semantic models, random seeds or practice answers", async () => {
    const result = await generateWorkbook(request, seed(21), topics, source);
    expect(result.workbook.schemaVersion).toBe("studio-workbook-v1");
    expect(result.workbook.saved).toBe(false);
    expect(result.workbook.id).toMatch(/^studio-[a-f0-9]{64}$/);
    expect(JSON.stringify(result.workbook)).not.toMatch(
      /"answer"|"submitted"|"baseSeed"|"coefficient"|"manifest"/,
    );
  });

  it("verifies persisted content without consulting the generator or current lesson revision", async () => {
    const result = await generateWorkbook(request, seed(21), topics, source);
    const encoded = canonicalizeJson(result);
    const parsed = JSON.parse(encoded);
    expect(await verifyGeneratedWorkbook(parsed)).toBe(true);
    const { id: _id, instanceHash, ...workbook } = result.workbook;
    expect(await sha256Hex(canonicalizeJson({ ...result, workbook }))).toBe(
      instanceHash,
    );
    const future = await generateWorkbook(
      request,
      seed(21),
      topics,
      "future-release@2",
    );
    expect(future.workbook.instanceHash).not.toBe(instanceHash);
    expect(await verifyGeneratedWorkbook(parsed)).toBe(true);
  });

  it("rejects corruption throughout the persisted envelope and mismatched IDs", async () => {
    const result = await generateWorkbook(request, seed(21), topics, source);
    const mutations = [
      (copy: any) => {
        copy.sourceRevision = "changed";
      },
      (copy: any) => {
        copy.workbook.items[0].prompt = "different";
      },
      (copy: any) => {
        copy.answers[0].answer = "123";
      },
      (copy: any) => {
        copy.answers[0].steps[0].reason = "changed";
      },
      (copy: any) => {
        copy.answers[0].submitted = "private learner answer";
      },
      (copy: any) => {
        copy.manifest.slots[0].model.coefficient = 4;
      },
      (copy: any) => {
        copy.manifest.slots[0].subseed = seed(13);
      },
      (copy: any) => {
        copy.manifest.baseSeed = seed(23);
      },
      (copy: any) => {
        copy.workbook.id = `studio-${"f".repeat(64)}`;
      },
      (copy: any) => {
        copy.workbook.unknown = "unhashed";
      },
    ];
    for (const mutate of mutations) {
      const copy = structuredClone(result);
      mutate(copy);
      expect(await verifyGeneratedWorkbook(copy)).toBe(false);
    }
    expect(await verifyGeneratedWorkbook(null)).toBe(false);
    expect(await verifyGeneratedWorkbook({})).toBe(false);
  });
});
