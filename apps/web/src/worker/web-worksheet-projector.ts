import type {
  AttributionV1,
  MaterializedWorksheetInstanceV1,
  StudentWorksheetDeliveryV1,
} from "@exercisebook/schemas";
import { projectWorksheetForStudent } from "@exercisebook/schemas";
import type {
  AnswerKeyWebWorksheet,
  StudentWebWorksheet,
  WebAttribution,
  WebWorkedExample,
} from "@exercisebook/web-renderer";

const reviewedWorkedExample: WebWorkedExample = {
  left: { numerator: "1", denominator: "2" },
  right: { numerator: "1", denominator: "3" },
  result: { numerator: "5", denominator: "6" },
  steps: [
    "The least common denominator of 2 and 3 is 6.",
    "Rename 1/2 as 3/6 and 1/3 as 2/6.",
    "Add 3/6 + 2/6 to get 5/6.",
  ],
};

function projectAttribution(attribution: AttributionV1): WebAttribution {
  return {
    label: attribution.attributionText,
    license:
      attribution.publicationStatus === "draft"
        ? `${attribution.licenseId} · draft`
        : attribution.licenseId,
  };
}

export function projectStudentWorksheetForWeb(
  delivery: StudentWorksheetDeliveryV1,
): StudentWebWorksheet {
  const firstSlot = delivery.slots[0];
  if (firstSlot === undefined) {
    throw new TypeError("A Web worksheet requires at least one slot.");
  }

  return {
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
    workedExample: reviewedWorkedExample,
    items: delivery.slots.map((slot, index) => ({
      id: slot.id,
      ordinal: index + 1,
      prompt: {
        kind: "fraction-addition",
        left: slot.prompt.left,
        right: slot.prompt.right,
        accessibleText: slot.prompt.accessibleText,
      },
      responseLabel: `Your answer for problem ${index + 1}`,
      printFallback: slot.printFallback.text,
    })),
    attributions: delivery.attributions.map(projectAttribution),
  };
}

export async function projectAnswerKeyWorksheetForWeb(
  materialized: MaterializedWorksheetInstanceV1,
): Promise<AnswerKeyWebWorksheet> {
  // The student projector is the shared integrity gate for canonical bytes and
  // the instance hash. The answer key then projects the same verified instance.
  await projectWorksheetForStudent(materialized);
  const { instance, instanceHash } = materialized;
  const firstSlot = instance.slots[0];
  if (firstSlot === undefined) {
    throw new TypeError("A Web worksheet requires at least one slot.");
  }

  return {
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
    workedExample: reviewedWorkedExample,
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
  };
}
