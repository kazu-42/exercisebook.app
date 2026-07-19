import {
  validateDailyPlanPreviewResponseV1,
  type DailyPlanPreviewResponseV1,
} from "../shared/daily-plan-preview-contract.js";
import {
  DAILY_PLAN_PREVIEW_REQUEST_V1_SCHEMA,
  type DailyPlanPreviewRequestV1,
} from "@exercisebook/planner";

export { DAILY_PLAN_PREVIEW_REQUEST_V1_SCHEMA };
export type { DailyPlanPreviewRequestV1 };

export const DAILY_PLAN_PREVIEW_TIMEOUT_MS = 15_000;

export type DailyPlanPreviewLoader = (
  request: DailyPlanPreviewRequestV1,
  signal: AbortSignal,
) => Promise<DailyPlanPreviewResponseV1>;

export const loadDailyPlanPreviewFromApi: DailyPlanPreviewLoader = async (
  request,
  signal,
) => {
  const requestController = new AbortController();
  const timeoutError = new Error("Daily plan preview request timed out.");
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  const throwRequestAbortReason = (): never => {
    if (requestController.signal.reason === timeoutError) {
      throw timeoutError;
    }
    throw requestController.signal.reason;
  };
  const forwardCallerAbort = (): void => {
    if (timeout !== undefined) {
      globalThis.clearTimeout(timeout);
      timeout = undefined;
    }
    requestController.abort(signal.reason);
  };
  if (signal.aborted) {
    forwardCallerAbort();
  } else {
    signal.addEventListener("abort", forwardCallerAbort, { once: true });
    timeout = globalThis.setTimeout(() => {
      requestController.abort(timeoutError);
    }, DAILY_PLAN_PREVIEW_TIMEOUT_MS);
  }

  try {
    let response: Response;
    try {
      response = await fetch("/api/plans/preview", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        signal: requestController.signal,
      });
    } catch (error) {
      if (requestController.signal.aborted) {
        throwRequestAbortReason();
      }
      throw error;
    }

    if (!response.ok) {
      throw new Error(`Daily plan preview request failed: ${String(response.status)}`);
    }

    try {
      const contentType = response.headers
        .get("Content-Type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (contentType !== "application/json") {
        throw new TypeError("Expected an application/json preview response.");
      }
      const payload: unknown = await response.json();
      const validated = validateDailyPlanPreviewResponseV1(payload);
      if (
        validated.plan.goalId !== request.goalId ||
        validated.plan.requestedPracticeMinutes !== request.practiceMinutes ||
        validated.worksheet.studyDate !== request.localStudyDate ||
        validated.worksheet.locale !== request.locale
      ) {
        throw new TypeError("Preview response does not match its request.");
      }
      return validated;
    } catch {
      if (requestController.signal.aborted) {
        throwRequestAbortReason();
      }
      throw new Error("Daily plan preview response was invalid.");
    }
  } finally {
    if (timeout !== undefined) {
      globalThis.clearTimeout(timeout);
    }
    signal.removeEventListener("abort", forwardCallerAbort);
  }
};
