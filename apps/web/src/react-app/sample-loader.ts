import {
  validateWebWorksheet,
  type WebWorksheet,
  type WebWorksheetVariant,
} from "@exercisebook/web-renderer";
import {
  cancelResponseBodyBestEffort,
  readBoundedStrictJsonResponse,
} from "../shared/bounded-json-response.js";
import { MAX_SAMPLE_WORKSHEET_RESPONSE_BYTES } from "../shared/public-api-response-limits.js";

export const SAMPLE_WORKSHEET_TIMEOUT_MS = 15_000;
export { MAX_SAMPLE_WORKSHEET_RESPONSE_BYTES };

export type SampleLoader = (
  variant: WebWorksheetVariant,
  signal: AbortSignal,
) => Promise<WebWorksheet>;

export async function loadSampleFromApi(
  variant: WebWorksheetVariant,
  signal: AbortSignal,
): Promise<WebWorksheet> {
  const requestController = new AbortController();
  const timeoutError = new Error("Sample worksheet request timed out.");
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  const throwRequestAbortReason = (): never => {
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
    }, SAMPLE_WORKSHEET_TIMEOUT_MS);
  }

  try {
    let response: Response;
    try {
      response = await fetch(
        `/api/worksheets/sample?variant=${encodeURIComponent(variant)}`,
        {
          headers: {
            Accept: "application/json",
          },
          signal: requestController.signal,
        },
      );
    } catch (error) {
      if (requestController.signal.aborted) {
        throwRequestAbortReason();
      }
      throw error;
    }

    if (requestController.signal.aborted) {
      cancelResponseBodyBestEffort(response, requestController.signal.reason);
      throwRequestAbortReason();
    }

    if (!response.ok) {
      const error = new Error(
        `Sample worksheet request failed: ${String(response.status)}`,
      );
      cancelResponseBodyBestEffort(response, error);
      throw error;
    }

    try {
      const payload = await readBoundedStrictJsonResponse(response, {
        maximumBytes: MAX_SAMPLE_WORKSHEET_RESPONSE_BYTES,
        signal: requestController.signal,
      });
      return validateWebWorksheet(payload, variant);
    } catch {
      if (requestController.signal.aborted) {
        throwRequestAbortReason();
      }
      throw new Error("Sample worksheet response did not match its projection.");
    }
  } finally {
    if (timeout !== undefined) {
      globalThis.clearTimeout(timeout);
    }
    signal.removeEventListener("abort", forwardCallerAbort);
  }
}
