import * as React from "react";

import { Fraction, FractionAddition } from "./fraction.js";
import type {
  AnswerKeyWebWorksheetItem,
  StudentWebWorksheetItem,
  WebWorksheet,
} from "./model.js";

type WorksheetViewProps = Readonly<{
  worksheet: WebWorksheet;
  printMode?: boolean;
}>;

function StudentResponse({ item }: Readonly<{ item: StudentWebWorksheetItem }>) {
  return (
    <label className="student-response">
      <span>{item.responseLabel}</span>
      <input
        autoComplete="off"
        inputMode="text"
        name={`response-${item.id}`}
        spellCheck={false}
        type="text"
      />
    </label>
  );
}

function Answer({ item }: Readonly<{ item: AnswerKeyWebWorksheetItem }>) {
  return (
    <div className="worked-answer" data-answer="revealed">
      <p className="worked-answer__result">
        <span>Answer</span>
        <Fraction accessibleText={item.answer.accessibleText} value={item.answer} />
        <span className="worked-answer__plain">
          {item.answer.numerator}/{item.answer.denominator}
        </span>
      </p>
      <ol className="solution-steps" data-solution="revealed">
        {item.solution.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

type WorksheetProblemProps =
  | Readonly<{
      item: StudentWebWorksheetItem;
      variant: "student";
    }>
  | Readonly<{
      item: AnswerKeyWebWorksheetItem;
      variant: "answer-key";
    }>;

function WorksheetProblem(props: WorksheetProblemProps) {
  const { item } = props;

  return (
    <fieldset className="worksheet-problem" data-problem-id={item.id}>
      <legend>Problem {item.ordinal}</legend>
      <FractionAddition
        accessibleText={item.prompt.accessibleText}
        left={item.prompt.left}
        right={item.prompt.right}
      />
      {props.variant === "student" ? (
        <StudentResponse item={props.item} />
      ) : (
        <Answer item={props.item} />
      )}
      <p className="worksheet-problem__print-note">{item.printFallback}</p>
    </fieldset>
  );
}

export function WorksheetView({ worksheet, printMode = false }: WorksheetViewProps) {
  return (
    <article
      className={printMode ? "worksheet worksheet--print" : "worksheet"}
      data-instance-hash={worksheet.instanceHash}
      lang={worksheet.locale}
    >
      <header className="worksheet__header">
        <div>
          <p className="eyebrow">{worksheet.skillTitle}</p>
          <h1>{worksheet.title}</h1>
          {worksheet.variant === "answer-key" ? <h2>Answer key</h2> : null}
        </div>
        <dl className="worksheet__meta">
          <div>
            <dt>Date</dt>
            <dd>{worksheet.studyDate}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{worksheet.expectedMinutes} minutes</dd>
          </div>
          <div>
            <dt>Problems</dt>
            <dd>{worksheet.items.length}</dd>
          </div>
        </dl>
      </header>

      <p className="worksheet__introduction">{worksheet.introduction}</p>

      <section aria-labelledby="worked-example-title" className="worked-example">
        <div>
          <p className="eyebrow">One to study</p>
          <h2 id="worked-example-title">Worked example</h2>
          <FractionAddition
            accessibleText={`${worksheet.workedExample.left.numerator}/${worksheet.workedExample.left.denominator} plus ${worksheet.workedExample.right.numerator}/${worksheet.workedExample.right.denominator} equals ${worksheet.workedExample.result.numerator}/${worksheet.workedExample.result.denominator}`}
            left={worksheet.workedExample.left}
            result={worksheet.workedExample.result}
            right={worksheet.workedExample.right}
          />
        </div>
        <ol>
          {worksheet.workedExample.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="practice-title" className="worksheet__practice">
        <div className="section-heading">
          <p className="eyebrow">
            {worksheet.variant === "student" ? "Now you try" : "Check the work"}
          </p>
          <h2 id="practice-title">Practice</h2>
        </div>
        <div className="problem-list">
          {worksheet.variant === "student"
            ? worksheet.items.map((item) => (
                <WorksheetProblem item={item} key={item.id} variant="student" />
              ))
            : worksheet.items.map((item) => (
                <WorksheetProblem item={item} key={item.id} variant="answer-key" />
              ))}
        </div>
      </section>

      <footer className="worksheet__footer">
        <ul aria-label="Attribution" className="worksheet__attributions">
          {worksheet.attributions.map((attribution) => (
            <li key={`${attribution.label}:${attribution.license}`}>
              {attribution.label} · {attribution.license}
            </li>
          ))}
        </ul>
        <p className="instance-reference">
          Instance <code data-testid="instance-hash">{worksheet.instanceHash}</code>
        </p>
      </footer>
    </article>
  );
}
