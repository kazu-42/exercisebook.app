import { useState } from "react";

type BarProps = Readonly<{
  denominator: number;
  numerator: number;
  label: string;
}>;

function FractionBar({ denominator, numerator, label }: BarProps) {
  const segments = Array.from({ length: denominator }, (_, index) => index);

  return (
    <div className="bar-row">
      <span className="bar-row__label">{label}</span>
      <span
        aria-hidden="true"
        className="fraction-bar"
        style={{ gridTemplateColumns: `repeat(${denominator}, minmax(0, 1fr))` }}
      >
        {segments.map((segment) => (
          <span
            className={
              segment < numerator
                ? "fraction-bar__segment fraction-bar__segment--filled"
                : "fraction-bar__segment"
            }
            key={segment}
          />
        ))}
      </span>
    </div>
  );
}

const options = [5, 6, 12] as const;

export function FractionBarExplorer() {
  const [choice, setChoice] = useState<number | null>(null);
  const isCorrect = choice === 6;
  const feedback =
    choice === null
      ? "Choose a denominator to check your idea."
      : isCorrect
        ? "Exactly. 1/2 becomes 3/6 and 1/3 becomes 2/6."
        : "Not yet. Both 2 and 3 must divide evenly into the denominator.";

  return (
    <section aria-labelledby="fraction-lab-title" className="fraction-lab">
      <div className="fraction-lab__heading">
        <p className="eyebrow">Fraction lab</p>
        <h2 id="fraction-lab-title">Make the pieces the same size</h2>
        <p>
          Before we add, both bars need equal-size pieces. Find the smallest denominator
          that works for both fractions.
        </p>
      </div>

      <figure className="bar-figure">
        <FractionBar denominator={2} label="one half" numerator={1} />
        <FractionBar denominator={3} label="one third" numerator={1} />
        <figcaption>
          The shaded lengths stay the same when we rename the fractions.
        </figcaption>
      </figure>

      <fieldset className="denominator-choice">
        <legend>Choose a common denominator</legend>
        <div className="denominator-choice__options">
          {options.map((option) => (
            <label className="denominator-choice__option" key={option}>
              <input
                checked={choice === option}
                name="common-denominator"
                onChange={() => {
                  setChoice(option);
                }}
                type="radio"
                value={option}
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <p
        className={
          choice === null
            ? "fraction-lab__feedback"
            : isCorrect
              ? "fraction-lab__feedback fraction-lab__feedback--correct"
              : "fraction-lab__feedback fraction-lab__feedback--retry"
        }
        role="status"
      >
        {feedback}
      </p>

      {isCorrect ? (
        <div className="equivalent-bars">
          <FractionBar denominator={6} label="three sixths" numerator={3} />
          <FractionBar denominator={6} label="two sixths" numerator={2} />
        </div>
      ) : null}

      <p className="print-fallback">
        <strong>Print fallback:</strong> Draw six equal boxes. Shade three for the first
        fraction and two for the second: 1/2 = 3/6 and 1/3 = 2/6.
      </p>
    </section>
  );
}
