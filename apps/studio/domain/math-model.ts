import type { ExplanationStep } from "../src/contracts";

export type ArithmeticModel = {
  kind: "arithmetic";
  operation: "add" | "subtract" | "multiply" | "divide";
  left: number;
  right: number;
};
export type ExpressionModel = {
  kind: "expression";
  coefficient: number;
  value: number;
  constant: number;
};
export type EquationModel = {
  kind: "equation";
  coefficient: number;
  constant: number;
  right: number;
};
export type FixtureModel = ArithmeticModel | ExpressionModel | EquationModel;

export const arithmetic = (
  operation: ArithmeticModel["operation"],
  left: number,
  right: number,
): ArithmeticModel => ({ kind: "arithmetic", operation, left, right });
export const expression = (
  coefficient: number,
  value: number,
  constant: number,
): ExpressionModel => ({ kind: "expression", coefficient, value, constant });
export const equation = (
  coefficient: number,
  constant: number,
  right: number,
): EquationModel => ({ kind: "equation", coefficient, constant, right });

const display = (value: number): string => String(value).replace("-", "−");
const signed = (value: number): string => `(${value >= 0 ? "+" : ""}${display(value)})`;
const factor = (value: number): string =>
  value < 0 ? `(${display(value)})` : display(value);
const constantTerm = (value: number): string =>
  value < 0 ? ` − ${Math.abs(value)}` : ` + ${value}`;
const linear = (coefficient: number, constant: number): string =>
  `${display(coefficient)}x${constantTerm(constant)}`;

export function answerFor(model: FixtureModel): number {
  const numbers = Object.values(model).filter((value) => typeof value === "number");
  if (numbers.some((value) => !Number.isSafeInteger(value)))
    throw new Error("Fixture values must be safe integers.");
  if (
    (model.kind === "equation" && model.coefficient === 0) ||
    (model.kind === "arithmetic" && model.operation === "divide" && model.right === 0)
  )
    throw new Error("Fixture division requires a nonzero divisor.");
  if (model.kind === "equation")
    return (model.right - model.constant) / model.coefficient;
  if (model.kind === "expression")
    return model.coefficient * model.value + model.constant;
  switch (model.operation) {
    case "add":
      return model.left + model.right;
    case "subtract":
      return model.left - model.right;
    case "multiply":
      return model.left * model.right;
    case "divide":
      return model.left / model.right;
  }
}

export function promptFor(model: FixtureModel): string {
  if (model.kind === "equation")
    return `${linear(model.coefficient, model.constant)} = ${display(model.right)}`;
  if (model.kind === "expression")
    return `x = ${display(model.value)} のとき、${linear(model.coefficient, model.constant)}`;
  const operator = { add: "+", subtract: "−", multiply: "×", divide: "÷" }[
    model.operation
  ];
  return `${signed(model.left)} ${operator} ${signed(model.right)}`;
}

export function explainFixture(model: FixtureModel): readonly ExplanationStep[] {
  const answer = answerFor(model);
  if (!Number.isSafeInteger(answer))
    throw new Error("Fixture answers must be safe integers.");
  if (model.kind === "equation") {
    const remainder = model.right - model.constant;
    const operation =
      model.constant < 0
        ? `両辺に ${Math.abs(model.constant)} をたす`
        : `両辺から ${model.constant} をひく`;
    const inverse =
      model.constant < 0
        ? `両辺から ${Math.abs(model.constant)} をひく`
        : `両辺に ${model.constant} をたす`;
    return [
      {
        relation: "equivalent-equation",
        math: `${display(model.coefficient)}x = ${display(remainder)}`,
        reason: `${operation}操作をします。逆に${inverse}操作で戻せるので、解は変わりません。`,
      },
      {
        relation: "equivalent-equation",
        math: `x = ${display(answer)}`,
        reason: `両辺を ${factor(model.coefficient)} でわります。${factor(model.coefficient)} は 0 でなく、逆に両辺に ${factor(model.coefficient)} をかけて戻せるので、解は変わりません。`,
      },
      {
        relation: "verification",
        math: `${factor(model.coefficient)} × ${factor(answer)}${constantTerm(model.constant)} = ${display(model.right)}`,
        reason: `x = ${display(answer)} を元の方程式に代入すると、左辺と右辺が等しくなります。これは得られた解の確認です。`,
      },
    ];
  }
  if (model.kind === "expression") {
    const product = model.coefficient * model.value;
    const substitution = `${factor(model.coefficient)} × ${factor(model.value)}${constantTerm(model.constant)}`;
    const multiplied = `${display(product)}${constantTerm(model.constant)}`;
    return [
      {
        relation: "substitution",
        math: `${linear(model.coefficient, model.constant)} = ${substitution}`,
        reason: `x = ${display(model.value)} のときの式の値を求めます。x に ${factor(model.value)} を代入した等式です。`,
      },
      {
        relation: "expression-equality",
        math: `${substitution} = ${multiplied}`,
        reason: "かけ算を先に計算します。等号で結んだ両側の式の値は同じです。",
      },
      {
        relation: "expression-equality",
        math: `${multiplied} = ${display(answer)}`,
        reason: "残りのたし算・ひき算を計算して、式の値を求めます。",
      },
    ];
  }
  if (model.operation === "multiply" || model.operation === "divide") {
    const sameSign = Math.sign(model.left) === Math.sign(model.right);
    const symbol = model.operation === "multiply" ? "×" : "÷";
    const zero = answer === 0;
    return [
      {
        relation: "expression-equality",
        math: `${Math.abs(model.left)} ${symbol} ${Math.abs(model.right)} = ${Math.abs(answer)}`,
        reason: "まず、絶対値どうしを計算します。",
      },
      {
        relation: "expression-equality",
        math: `${promptFor(model)} = ${display(answer)}`,
        reason: zero
          ? "答えは 0 です。0 は正の数でも負の数でもありません。"
          : `0 でない${sameSign ? "同じ" : "異なる"}符号の数どうしなので、答えの符号は${sameSign ? "正" : "負"}です。`,
      },
    ];
  }
  const right = model.operation === "subtract" ? -model.right : model.right;
  const sameSign = Math.sign(model.left) === Math.sign(right);
  const sum = `${signed(model.left)} + ${signed(right)}`;
  const zero = answer === 0;
  return [
    {
      relation: "expression-equality",
      math:
        model.operation === "subtract"
          ? `${promptFor(model)} = ${sum}`
          : `${Math.max(Math.abs(model.left), Math.abs(right))} ${sameSign ? "+" : "−"} ${Math.min(Math.abs(model.left), Math.abs(right))} = ${Math.abs(answer)}`,
      reason:
        model.operation === "subtract"
          ? "ひく数の符号を変えてたし算に直しても、式の値は変わりません。"
          : zero
            ? "数と、その符号を変えた数の和は 0 になります。"
            : model.left === 0 || right === 0
              ? "0 をたしても、もとの数の値は変わりません。"
              : sameSign
                ? "同じ符号どうしのたし算なので、絶対値をたします。"
                : "異なる符号どうしのたし算なので、絶対値の差を求めます。",
    },
    {
      relation: "expression-equality",
      math: `${sum} = ${display(answer)}`,
      reason: zero
        ? "和は 0 です。0 は正の数でも負の数でもありません。"
        : model.left === 0 || right === 0
          ? "0 をたしても、もとの数の値は変わりません。"
          : sameSign
            ? "絶対値の和に、共通の符号をつけます。"
            : "絶対値の差に、絶対値が大きい数の符号をつけます。",
    },
  ];
}
