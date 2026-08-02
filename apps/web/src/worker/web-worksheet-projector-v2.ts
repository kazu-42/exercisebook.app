import { equalRationals } from "@exercisebook/domain";
import {
  deriveFractionAdditionPromptAccessibleText,
  type CanonicalRationalValue,
  type MaterializedWorksheetInstanceV2,
} from "@exercisebook/schemas";
import {
  prepareStudentVisibleAnswerGuard,
  projectWorksheetV2ForStudentWithCanonicalAnswers,
  type PreparedStudentVisibleAnswerGuard,
} from "@exercisebook/schemas/trusted-student-projection";
import {
  validateStudentWebWorksheetV2,
  type StudentWebWorksheetV2,
} from "@exercisebook/web-renderer";

/**
 * Project one authenticated V2 instance into the renderer-neutral student Web
 * contract. The trusted projector captures and validates the only source
 * snapshot before its first asynchronous yield; this adapter never rereads the
 * caller-owned materialization after that boundary resolves.
 */
export async function projectStudentWorksheetForWebV2(
  materialized: MaterializedWorksheetInstanceV2,
): Promise<StudentWebWorksheetV2> {
  const { canonicalAnswers, delivery } =
    await projectWorksheetV2ForStudentWithCanonicalAnswers(materialized);

  const worksheet = validateStudentWebWorksheetV2({
    schemaVersion: "web-worksheet.v2",
    instanceHash: delivery.instanceHash,
    assignmentId: delivery.assignmentId,
    title: delivery.title,
    studyDate: delivery.localStudyDate,
    locale: delivery.locale,
    expectedMinutes: delivery.expectedMinutes,
    variant: "student",
    presentation: delivery.presentation,
    items: delivery.slots.map((slot, index) => {
      const accessibleText = deriveFractionAdditionPromptAccessibleText(
        slot.prompt.left,
        slot.prompt.right,
      );
      if (slot.prompt.accessibleText !== accessibleText) {
        throw new Error(
          "V2 Web worksheet prompt accessibleText must equal its exact deterministic derivation",
        );
      }
      return {
        id: slot.id,
        ordinal: index + 1,
        prompt: {
          kind: "fraction-addition",
          left: slot.prompt.left,
          right: slot.prompt.right,
          accessibleText,
        },
        responseLabel: `Your answer for problem ${String(index + 1)}`,
        printFallback: slot.printFallback.text,
      };
    }),
    attributions: delivery.attributions,
  });

  assertStudentWebWorksheetV2DoesNotRevealPracticeAnswersWithPreparedGuard(
    worksheet,
    canonicalAnswers,
    prepareStudentVisibleAnswerGuard(canonicalAnswers),
  );
  return worksheet;
}

/**
 * Final role-sensitive authorization for the validated Web DTO. This remains a
 * Worker-only API because canonical answers must never enter a browser bundle,
 * response, cache, persisted state, analytics event, or log.
 */
export function assertStudentWebWorksheetV2DoesNotRevealPracticeAnswers(
  worksheet: StudentWebWorksheetV2,
  canonicalAnswers: readonly CanonicalRationalValue[],
): void {
  assertStudentWebWorksheetV2DoesNotRevealPracticeAnswersWithPreparedGuard(
    worksheet,
    canonicalAnswers,
    prepareStudentVisibleAnswerGuard(canonicalAnswers),
  );
}

function assertStudentWebWorksheetV2DoesNotRevealPracticeAnswersWithPreparedGuard(
  worksheet: StudentWebWorksheetV2,
  canonicalAnswers: readonly CanonicalRationalValue[],
  answerGuard: PreparedStudentVisibleAnswerGuard,
): void {
  if (worksheet.items.length !== canonicalAnswers.length) {
    throw new Error("V2 Web worksheet item-to-answer mapping is inconsistent");
  }

  const { items, presentation, ...globalWorksheet } = worksheet;
  answerGuard.assertDoesNotRevealAnyAnswer(globalWorksheet);
  answerGuard.assertDoesNotRevealAnyAnswer(presentation);
  assertPresentationIntermediatesDoNotRevealPracticeAnswers(
    presentation.workedExample.model,
    answerGuard,
  );

  for (const [index, item] of items.entries()) {
    const ownAnswer = canonicalAnswers[index];
    if (ownAnswer === undefined) {
      throw new Error("V2 Web worksheet item-to-answer mapping is inconsistent");
    }

    const { prompt, ...nonPromptItem } = item;
    answerGuard.assertDoesNotRevealAnyAnswer(nonPromptItem);

    const accessibleText = deriveFractionAdditionPromptAccessibleText(
      prompt.left,
      prompt.right,
    );
    if (prompt.accessibleText !== accessibleText) {
      throw new Error(
        "V2 Web worksheet prompt accessibleText must equal its exact deterministic derivation",
      );
    }
    if (
      equalRationals(prompt.left, ownAnswer) ||
      equalRationals(prompt.right, ownAnswer)
    ) {
      throw new Error(
        "V2 Web worksheet contains its own canonical-answer value as a prompt operand",
      );
    }

    // A prompt operand may legitimately equal another slot's answer. Exact
    // accessible text is derived from those operands, so only the current
    // slot's answer is forbidden in this role. Every non-prompt field above is
    // checked against the complete answer set.
    answerGuard.assertDoesNotRevealAnswerAt(prompt, index);
  }
}

function assertPresentationIntermediatesDoNotRevealPracticeAnswers(
  model: StudentWebWorksheetV2["presentation"]["workedExample"]["model"],
  answerGuard: PreparedStudentVisibleAnswerGuard,
): void {
  answerGuard.assertDoesNotRevealAnyAnswer([
    {
      numerator: model.leftScaledNumerator,
      denominator: model.commonDenominator,
    },
    {
      numerator: model.rightScaledNumerator,
      denominator: model.commonDenominator,
    },
    {
      numerator: model.unreducedSumNumerator,
      denominator: model.commonDenominator,
    },
  ]);
}
