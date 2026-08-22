import {
  FRACTION_ADDITION_SAMPLE_INPUT,
  materializeFractionAdditionWorksheetFromContent,
} from "@exercisebook/generators";
import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import { DAY_ONE_PREVIEW_RESERVED_CANONICAL_ANSWERS } from "@exercisebook/planner";

import type { SampleWorksheetService } from "./sample-worksheet-service.js";
import {
  projectAnswerKeyWorksheetForWeb,
  projectStudentWorksheetForWeb,
} from "./web-worksheet-projector.js";
import { SAMPLE_CONTENT_DOCUMENT } from "./sample-content.js";

const PUBLIC_SAMPLE_WEB_POLICY = Object.freeze({
  id: "public-sample-web",
  version: 2,
} as const);

export const generatorSampleService: SampleWorksheetService = {
  async getSample({ seed, variant }) {
    const isFixedPhaseOneSample = seed === FRACTION_ADDITION_SAMPLE_INPUT.seed;
    const assignmentId = isFixedPhaseOneSample
      ? FRACTION_ADDITION_SAMPLE_INPUT.assignmentId
      : `sample-${await sha256Hex(
          canonicalizeJson({
            domain: "exercisebook/public-sample-assignment/v2",
            seed,
            policy: PUBLIC_SAMPLE_WEB_POLICY,
            excludedCanonicalAnswers: DAY_ONE_PREVIEW_RESERVED_CANONICAL_ANSWERS,
          }),
        )}`;
    const versionedCollisionPolicy = isFixedPhaseOneSample
      ? {}
      : {
          policy: PUBLIC_SAMPLE_WEB_POLICY,
          excludedCanonicalAnswers: DAY_ONE_PREVIEW_RESERVED_CANONICAL_ANSWERS,
        };
    const materialized = await materializeFractionAdditionWorksheetFromContent(
      SAMPLE_CONTENT_DOCUMENT,
      {
        assignmentId,
        localStudyDate: FRACTION_ADDITION_SAMPLE_INPUT.localStudyDate,
        timeZone: FRACTION_ADDITION_SAMPLE_INPUT.timeZone,
        locale: FRACTION_ADDITION_SAMPLE_INPUT.locale,
        seed,
        seedSecretVersion: FRACTION_ADDITION_SAMPLE_INPUT.seedSecretVersion,
        requestedItemCount: FRACTION_ADDITION_SAMPLE_INPUT.itemCount,
        plan: FRACTION_ADDITION_SAMPLE_INPUT.plan,
        policy: FRACTION_ADDITION_SAMPLE_INPUT.policy,
        skillGraph: FRACTION_ADDITION_SAMPLE_INPUT.skillGraph,
        selectionReasons: FRACTION_ADDITION_SAMPLE_INPUT.selectionReasons,
        ...versionedCollisionPolicy,
      },
    );

    if (variant === "student") {
      return projectStudentWorksheetForWeb(materialized);
    }

    return projectAnswerKeyWorksheetForWeb(materialized);
  },
};
