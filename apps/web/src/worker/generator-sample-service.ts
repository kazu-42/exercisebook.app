import {
  FRACTION_ADDITION_SAMPLE_INPUT,
  materializeFractionAdditionWorksheetFromContent,
} from "@exercisebook/generators";
import { sha256Hex } from "@exercisebook/domain";
import { projectWorksheetForStudent } from "@exercisebook/schemas";

import type { SampleWorksheetService } from "./sample-worksheet-service.js";
import {
  projectAnswerKeyWorksheetForWeb,
  projectStudentWorksheetForWeb,
} from "./web-worksheet-projector.js";
import { SAMPLE_CONTENT_DOCUMENT } from "./sample-content.js";

export const generatorSampleService: SampleWorksheetService = {
  async getSample({ seed, variant }) {
    const assignmentId =
      seed === FRACTION_ADDITION_SAMPLE_INPUT.seed
        ? FRACTION_ADDITION_SAMPLE_INPUT.assignmentId
        : `sample-${await sha256Hex(
            `exercisebook.public-sample-assignment/v1\u0000${seed}`,
          )}`;
    const materialized = await materializeFractionAdditionWorksheetFromContent(
      SAMPLE_CONTENT_DOCUMENT,
      {
        assignmentId,
        localStudyDate: FRACTION_ADDITION_SAMPLE_INPUT.localStudyDate,
        timeZone: FRACTION_ADDITION_SAMPLE_INPUT.timeZone,
        locale: FRACTION_ADDITION_SAMPLE_INPUT.locale,
        seed,
        seedSecretVersion: FRACTION_ADDITION_SAMPLE_INPUT.seedSecretVersion,
      },
    );

    if (variant === "student") {
      const delivery = await projectWorksheetForStudent(materialized);
      return projectStudentWorksheetForWeb(delivery);
    }

    return projectAnswerKeyWorksheetForWeb(materialized);
  },
};
