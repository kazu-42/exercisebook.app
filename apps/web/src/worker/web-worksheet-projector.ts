import { equalRationals } from "@exercisebook/domain";
import { DAY_ONE_PREVIEW_RESERVED_CANONICAL_ANSWERS } from "@exercisebook/planner";
import type {
  AttributionV1,
  CanonicalRationalValue,
  MaterializedWorksheetInstanceV1,
} from "@exercisebook/schemas";
import {
  assertSafeDataObjectGraph,
  assertStudentVisibleDataHasNoRecognizedCanonicalAnswers,
  deriveFractionAdditionPromptAccessibleText,
  validateWorksheetInstanceV1,
} from "@exercisebook/schemas";
import { projectWorksheetForStudentWithCanonicalAnswers } from "@exercisebook/schemas/trusted-student-projection";
import type {
  AnswerKeyWebWorksheet,
  StudentWebWorksheet,
  WebAttribution,
  WebWorkedExample,
} from "@exercisebook/web-renderer";
import {
  validateAnswerKeyWebWorksheet,
  validateStudentWebWorksheet,
} from "@exercisebook/web-renderer";

const reviewedWorkedExample: WebWorkedExample = {
  left: { ...DAY_ONE_PREVIEW_RESERVED_CANONICAL_ANSWERS[0] },
  right: { ...DAY_ONE_PREVIEW_RESERVED_CANONICAL_ANSWERS[1] },
  result: { ...DAY_ONE_PREVIEW_RESERVED_CANONICAL_ANSWERS[2] },
  steps: [
    "The least common denominator of 2 and 3 is 6.",
    "Rename 1/2 as 3/6 and 1/3 as 2/6.",
    "Add 3/6 + 2/6 to get 5/6.",
  ],
};
Object.freeze(reviewedWorkedExample.left);
Object.freeze(reviewedWorkedExample.right);
Object.freeze(reviewedWorkedExample.result);
Object.freeze(reviewedWorkedExample.steps);
export const REVIEWED_WORKED_EXAMPLE = Object.freeze(reviewedWorkedExample);

function projectAttribution(attribution: AttributionV1): WebAttribution {
  return {
    label: attribution.attributionText,
    license:
      attribution.publicationStatus === "draft"
        ? `${attribution.licenseId} · draft`
        : attribution.licenseId,
  };
}

export async function projectStudentWorksheetForWeb(
  materialized: MaterializedWorksheetInstanceV1,
): Promise<StudentWebWorksheet> {
  const { canonicalAnswers, delivery } =
    await projectWorksheetForStudentWithCanonicalAnswers(materialized);
  const firstSlot = delivery.slots[0];
  if (firstSlot === undefined) {
    throw new TypeError("A Web worksheet requires at least one slot.");
  }

  const worksheet = validateStudentWebWorksheet({
    schemaVersion: "web-worksheet.v1",
    instanceHash: delivery.instanceHash,
    assignmentId: delivery.assignmentId,
    title: delivery.title,
    skillTitle: "Fraction addition",
    studyDate: delivery.localStudyDate,
    locale: delivery.locale,
    expectedMinutes: delivery.expectedMinutes,
    variant: "student",
    introduction: firstSlot.prompt.instruction,
    workedExample: REVIEWED_WORKED_EXAMPLE,
    items: delivery.slots.map((slot, index) => ({
      id: slot.id,
      ordinal: index + 1,
      prompt: {
        kind: "fraction-addition",
        left: slot.prompt.left,
        right: slot.prompt.right,
        accessibleText: deriveFractionAdditionPromptAccessibleText(
          slot.prompt.left,
          slot.prompt.right,
        ),
      },
      responseLabel: `Your answer for problem ${index + 1}`,
      printFallback: slot.printFallback.text,
    })),
    attributions: delivery.attributions.map(projectAttribution),
  });
  assertWorkedExampleDoesNotRevealPracticeAnswers(
    worksheet.workedExample,
    canonicalAnswers,
  );
  assertFinalStudentWorksheetDoesNotRevealPracticeAnswers(worksheet, canonicalAnswers);
  return worksheet;
}

/**
 * Scan the final validated Web DTO, not an earlier intermediate projection.
 * Global fields and every non-prompt item field are checked against every
 * answer. Structured prompt operands may legitimately equal a different
 * problem's result; their accessible text is therefore derived locally from
 * those operands and the prompt is checked only against its own answer.
 */
function assertFinalStudentWorksheetDoesNotRevealPracticeAnswers(
  worksheet: StudentWebWorksheet,
  canonicalAnswers: readonly CanonicalRationalValue[],
): void {
  if (worksheet.items.length !== canonicalAnswers.length) {
    throw new Error("Web worksheet item-to-answer mapping is inconsistent");
  }

  const { items, ...globalWorksheet } = worksheet;
  assertStudentVisibleDataHasNoRecognizedCanonicalAnswers(
    globalWorksheet,
    canonicalAnswers,
  );
  for (const [index, item] of items.entries()) {
    const answer = canonicalAnswers[index];
    if (answer === undefined) {
      throw new Error("Web worksheet item-to-answer mapping is inconsistent");
    }
    const { prompt, ...nonPromptItem } = item;
    assertStudentVisibleDataHasNoRecognizedCanonicalAnswers(
      nonPromptItem,
      canonicalAnswers,
    );
    if (
      prompt.accessibleText !==
      deriveFractionAdditionPromptAccessibleText(prompt.left, prompt.right)
    ) {
      throw new Error(
        "Web worksheet prompt accessibleText must equal its deterministic fraction-addition derivation",
      );
    }
    if (equalRationals(prompt.left, answer) || equalRationals(prompt.right, answer)) {
      throw new Error(
        "Web worksheet contains its own canonical-answer value as a prompt operand",
      );
    }
    assertStudentVisibleDataHasNoRecognizedCanonicalAnswers(prompt, [answer]);
  }
}

export function assertWorkedExampleDoesNotRevealPracticeAnswers(
  workedExample: WebWorkedExample,
  canonicalAnswers: readonly CanonicalRationalValue[],
): void {
  const structuredExampleValues = [
    workedExample.left,
    workedExample.right,
    workedExample.result,
  ];
  if (
    canonicalAnswers.some((answer) =>
      structuredExampleValues.some((value) => equalRationals(answer, value)),
    )
  ) {
    throw new TypeError(
      "The student worked example reveals a generated practice answer value.",
    );
  }
  assertStudentVisibleDataHasNoRecognizedCanonicalAnswers(
    workedExample,
    canonicalAnswers,
  );
}

export async function projectAnswerKeyWorksheetForWeb(
  materialized: MaterializedWorksheetInstanceV1,
): Promise<AnswerKeyWebWorksheet> {
  // Capture a detached instance and every envelope field before the first
  // asynchronous yield. The shared projector then authenticates that one
  // snapshot, so caller mutation cannot change the answer-key source later.
  assertSafeDataObjectGraph(materialized);
  const snapshot = {
    instance: validateWorksheetInstanceV1(materialized.instance),
    canonicalJson: materialized.canonicalJson,
    instanceHash: materialized.instanceHash,
  };
  await projectWorksheetForStudentWithCanonicalAnswers(snapshot);
  const { instance, instanceHash } = snapshot;
  const firstSlot = instance.slots[0];
  if (firstSlot === undefined) {
    throw new TypeError("A Web worksheet requires at least one slot.");
  }

  return validateAnswerKeyWebWorksheet({
    schemaVersion: "web-worksheet.v1",
    instanceHash,
    assignmentId: instance.assignmentId,
    title: instance.title,
    skillTitle: "Fraction addition",
    studyDate: instance.localStudyDate,
    locale: instance.locale,
    expectedMinutes: instance.expectedMinutes,
    variant: "answer-key",
    introduction: firstSlot.prompt.instruction,
    workedExample: REVIEWED_WORKED_EXAMPLE,
    items: instance.slots.map((slot, index) => ({
      id: slot.id,
      ordinal: index + 1,
      prompt: {
        kind: "fraction-addition",
        left: slot.prompt.left,
        right: slot.prompt.right,
        accessibleText: slot.prompt.accessibleText,
      },
      responseLabel: `Answer for problem ${index + 1}`,
      printFallback: slot.printFallback.text,
      answer: {
        ...slot.canonicalAnswer.value,
        accessibleText:
          slot.solutionTrace.at(-1)?.accessibleText ??
          `${slot.canonicalAnswer.value.numerator}/${slot.canonicalAnswer.value.denominator}`,
      },
      solution: slot.solutionTrace.map(
        (step) => `${step.explanation} ${step.accessibleText}`,
      ),
    })),
    attributions: instance.attributions.map(projectAttribution),
  });
}
