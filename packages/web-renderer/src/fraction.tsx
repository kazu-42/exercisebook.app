import * as React from "react";

import type { WebFraction } from "./model.js";

type FractionProps = Readonly<{
  value: WebFraction;
  accessibleText?: string;
}>;

export function Fraction({ value, accessibleText }: FractionProps) {
  const plainText = `${value.numerator}/${value.denominator}`;

  return (
    <span aria-label={accessibleText ?? plainText} className="fraction" role="math">
      <span aria-hidden="true" className="fraction__stack">
        <span className="fraction__numerator">{value.numerator}</span>
        <span className="fraction__denominator">{value.denominator}</span>
      </span>
      <span aria-hidden="true" className="fraction__plain">
        {plainText}
      </span>
    </span>
  );
}

type FractionAdditionProps = Readonly<{
  left: WebFraction;
  right: WebFraction;
  accessibleText: string;
  result?: WebFraction;
}>;

export function FractionAddition({
  left,
  right,
  accessibleText,
  result,
}: FractionAdditionProps) {
  return (
    <span aria-label={accessibleText} className="fraction-expression" role="math">
      <span aria-hidden="true" className="fraction-expression__visual">
        <Fraction value={left} />
        <span className="fraction-expression__operator">+</span>
        <Fraction value={right} />
        <span className="fraction-expression__operator">=</span>
        {result === undefined ? (
          <span className="fraction-expression__blank" />
        ) : (
          <Fraction value={result} />
        )}
      </span>
    </span>
  );
}
