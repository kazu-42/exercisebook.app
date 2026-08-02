import { Hono } from "hono";

import {
  DAILY_PLAN_PREVIEW_REQUEST_V1_SCHEMA,
  DAILY_PLAN_PREVIEW_REQUEST_V2_SCHEMA,
  validateDailyPlanPreviewRequestV1,
  validateDailyPlanPreviewRequestV2,
  type DailyPlanPreviewRequestV1,
  type DailyPlanPreviewRequestV2,
} from "@exercisebook/planner";
import type { WebWorksheetVariant } from "@exercisebook/web-renderer";

import {
  validateDailyPlanPreviewServiceResult,
  type DailyPlanPreviewService,
} from "./daily-plan-preview-service.js";
import {
  validateDailyPlanPreviewServiceResultV2,
  type DailyPlanPreviewServiceV2,
} from "./daily-plan-preview-service-v2.js";
import type { SampleWorksheetService } from "./sample-worksheet-service.js";
import { MAX_DAILY_PLAN_PREVIEW_RESPONSE_BYTES } from "../shared/public-api-response-limits.js";
import { parseStrictJson } from "../shared/strict-json.js";

export const DEFAULT_SAMPLE_SEED =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const seedPattern = /^[0-9a-f]{64}$/;
const allowedQueryKeys = new Set(["seed", "variant"]);
export const MAX_DAILY_PLAN_PREVIEW_BODY_BYTES = 4_096;
export const MAX_DAILY_PLAN_PREVIEW_BODY_READS = 1_024;

export interface AppServices {
  readonly sampleWorksheetService: SampleWorksheetService;
  readonly dailyPlanPreviewService: DailyPlanPreviewService;
  readonly dailyPlanPreviewServiceV2: DailyPlanPreviewServiceV2;
}

export interface UnexpectedWorkerErrorReport {
  readonly event: "exercisebook.worker.unexpected_error";
  readonly route: "daily-plan-preview" | "sample-worksheet" | "unclassified";
  readonly status: 500;
}

export type UnexpectedWorkerErrorReporter = (
  report: UnexpectedWorkerErrorReport,
) => void;

export interface AppOptions {
  readonly reportUnexpectedError?: UnexpectedWorkerErrorReporter;
}

type VersionedDailyPlanPreviewRequest =
  | Readonly<{ version: "v1"; request: DailyPlanPreviewRequestV1 }>
  | Readonly<{ version: "v2"; request: DailyPlanPreviewRequestV2 }>;

function readSampleQuery(url: string): Readonly<{
  seed: string;
  variant: WebWorksheetVariant;
}> | null {
  const search = new URL(url).searchParams;
  const hasUnknownKey = [...search.keys()].some((key) => !allowedQueryKeys.has(key));
  const hasDuplicateKey = [...allowedQueryKeys].some(
    (key) => search.getAll(key).length > 1,
  );
  const seed = search.get("seed") ?? DEFAULT_SAMPLE_SEED;
  const variant = search.get("variant") ?? "student";

  if (
    hasUnknownKey ||
    hasDuplicateKey ||
    !seedPattern.test(seed) ||
    (variant !== "student" && variant !== "answer-key")
  ) {
    return null;
  }

  return { seed, variant };
}

export function createApp(services: AppServices, options: AppOptions = {}) {
  const reportUnexpectedError =
    options.reportUnexpectedError ?? defaultUnexpectedErrorReporter;
  const app = new Hono()
    .use("/api/plans/preview", async (context, next) => {
      context.header("Cache-Control", "no-store");
      context.header("X-Content-Type-Options", "nosniff");
      await next();
    })
    .get("/api/health", (context) => {
      context.header("Cache-Control", "no-store");
      return context.json({
        service: "exercisebook-web",
        status: "ok",
        version: "phase-1",
      });
    })
    .get("/api/worksheets/sample", (context) =>
      withNormalizedRouteErrors(async () => {
        const request = readSampleQuery(context.req.url);
        if (request === null) {
          return context.json(
            {
              code: "invalid_query",
              message:
                "Use a 64-character lowercase hexadecimal seed and a supported variant.",
            },
            400,
          );
        }

        const worksheet = await services.sampleWorksheetService.getSample(request);
        if (worksheet.variant !== request.variant) {
          throw new Error("Sample service returned the wrong projection variant.");
        }

        context.header("Cache-Control", "public, max-age=300, s-maxage=86400");
        context.header(
          "ETag",
          `W/"${worksheet.instanceHash}-web-v1-${worksheet.variant}"`,
        );
        context.header("X-Content-Type-Options", "nosniff");
        return context.json(worksheet);
      }),
    )
    .post("/api/plans/preview", (context) =>
      withNormalizedRouteErrors(async () => {
        const contentType = context.req.header("Content-Type");
        if (!isApplicationJson(contentType)) {
          return context.json(
            {
              code: "unsupported_media_type",
              message: "Use application/json for preview requests.",
            },
            415,
          );
        }

        const declaredLength = context.req.header("Content-Length");
        const declaredSize = readDeclaredBodySize(declaredLength);
        if (declaredSize === "invalid") {
          return context.json(
            {
              code: "invalid_request",
              message: "Check the preview request and try again.",
            },
            400,
          );
        }
        if (
          declaredSize !== undefined &&
          declaredSize > MAX_DAILY_PLAN_PREVIEW_BODY_BYTES
        ) {
          return context.json(
            {
              code: "request_too_large",
              message: "The preview request must be 4096 bytes or less.",
            },
            413,
          );
        }

        const measuredBody = await readBoundedRequestBody(
          context.req.raw,
          MAX_DAILY_PLAN_PREVIEW_BODY_BYTES,
        );
        if (measuredBody.status === "too-large") {
          return context.json(
            {
              code: "request_too_large",
              message: "The preview request must be 4096 bytes or less.",
            },
            413,
          );
        }
        if (measuredBody.status === "invalid") {
          return context.json(
            {
              code: "invalid_request",
              message: "Check the preview request and try again.",
            },
            400,
          );
        }

        let request: VersionedDailyPlanPreviewRequest;
        try {
          const body = new TextDecoder("utf-8", { fatal: true }).decode(
            measuredBody.bytes,
          );
          request = validateVersionedDailyPlanPreviewRequest(parseStrictJson(body));
        } catch {
          return context.json(
            {
              code: "invalid_request",
              message: "Check the preview request and try again.",
            },
            400,
          );
        }

        const result =
          request.version === "v1"
            ? validateDailyPlanPreviewServiceResult(
                await services.dailyPlanPreviewService.createPreview(request.request),
              )
            : validateDailyPlanPreviewServiceResultV2(
                await services.dailyPlanPreviewServiceV2.createPreview(request.request),
              );
        if (result.status === "unavailable") {
          return context.json(
            {
              code: "preview_unavailable",
              message: "This preview is temporarily unavailable.",
            },
            503,
          );
        }
        const serialized = serializeBoundedDailyPlanPreviewResponse(result.response);
        return context.body(serialized, 200, {
          "Content-Type": "application/json; charset=UTF-8",
        });
      }),
    );

  app.notFound((context) =>
    context.json(
      {
        code: "not_found",
        message: "API route not found.",
      },
      404,
    ),
  );

  app.onError((_error, context) => {
    reportUnexpectedErrorSafely(
      reportUnexpectedError,
      createUnexpectedErrorReport(context.req.path),
    );
    context.header("Cache-Control", "no-store");
    context.header("X-Content-Type-Options", "nosniff");
    if (context.req.path === "/api/plans/preview") {
      return context.json(
        {
          code: "internal_error",
          message: "The preview could not be prepared.",
        },
        500,
      );
    }
    return context.json(
      {
        code: "internal_error",
        message: "The worksheet could not be prepared.",
      },
      500,
    );
  });

  return app;
}

async function withNormalizedRouteErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    // Hono 4.12 dispatches only Error instances to app.onError.
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("A route dependency failed with a non-Error value.");
  }
}

function createUnexpectedErrorReport(path: string): UnexpectedWorkerErrorReport {
  const route =
    path === "/api/plans/preview"
      ? "daily-plan-preview"
      : path === "/api/worksheets/sample"
        ? "sample-worksheet"
        : "unclassified";
  return Object.freeze({
    event: "exercisebook.worker.unexpected_error",
    route,
    status: 500,
  });
}

const defaultUnexpectedErrorReporter: UnexpectedWorkerErrorReporter = (report) => {
  console.error(report);
};

function reportUnexpectedErrorSafely(
  reporter: UnexpectedWorkerErrorReporter,
  report: UnexpectedWorkerErrorReport,
): void {
  try {
    reporter(report);
  } catch {
    try {
      console.error({
        event: "exercisebook.worker.unexpected_error_report_failed",
        route: report.route,
        status: 500,
      });
    } catch {
      // Observability failure must not replace the sanitized HTTP response.
    }
  }
}

function validateVersionedDailyPlanPreviewRequest(
  value: unknown,
): VersionedDailyPlanPreviewRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Preview request must be an object.");
  }

  const schema = (value as Record<string, unknown>).schema;
  if (schema === DAILY_PLAN_PREVIEW_REQUEST_V1_SCHEMA) {
    return {
      version: "v1",
      request: validateDailyPlanPreviewRequestV1(value),
    };
  }
  if (schema === DAILY_PLAN_PREVIEW_REQUEST_V2_SCHEMA) {
    return {
      version: "v2",
      request: validateDailyPlanPreviewRequestV2(value),
    };
  }
  throw new TypeError("Preview request schema is unsupported.");
}

/**
 * Serialize exactly once, then measure and return those same bytes through
 * Hono. Re-serializing after the budget check would make the check advisory.
 */
export function serializeBoundedDailyPlanPreviewResponse(value: unknown): string {
  const serialized: unknown = JSON.stringify(value);
  if (typeof serialized !== "string") {
    throw new TypeError("Preview response must be JSON serializable.");
  }
  if (
    new TextEncoder().encode(serialized).byteLength >
    MAX_DAILY_PLAN_PREVIEW_RESPONSE_BYTES
  ) {
    throw new RangeError("Preview response exceeds its public byte limit.");
  }
  return serialized;
}

function isApplicationJson(contentType: string | undefined): boolean {
  if (contentType === undefined) {
    return false;
  }
  return contentType.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function readDeclaredBodySize(
  contentLength: string | undefined,
): number | "invalid" | undefined {
  if (contentLength === undefined) {
    return undefined;
  }
  const normalized = contentLength.trim();
  if (!/^(?:0|[1-9][0-9]*)$/u.test(normalized)) {
    return "invalid";
  }
  if (normalized.length > String(MAX_DAILY_PLAN_PREVIEW_BODY_BYTES).length) {
    return MAX_DAILY_PLAN_PREVIEW_BODY_BYTES + 1;
  }
  return Number(normalized);
}

async function readBoundedRequestBody(
  request: Request,
  maximumBytes: number,
): Promise<
  | Readonly<{ status: "ok"; bytes: Uint8Array }>
  | Readonly<{ status: "too-large" }>
  | Readonly<{ status: "invalid" }>
> {
  if (request.body === null) {
    return { status: "ok", bytes: new Uint8Array() };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let measuredBytes = 0;
  let nonFinalReads = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      nonFinalReads += 1;
      if (nonFinalReads > MAX_DAILY_PLAN_PREVIEW_BODY_READS) {
        cancelReaderBestEffort(
          reader,
          new TypeError("Daily Plan Preview request body exceeds its read limit."),
        );
        return { status: "invalid" };
      }

      const value: unknown = chunk.value;
      if (!(value instanceof Uint8Array)) {
        cancelReaderBestEffort(
          reader,
          new TypeError("Daily Plan Preview request body chunk is invalid."),
        );
        return { status: "invalid" };
      }

      measuredBytes += value.byteLength;
      if (measuredBytes > maximumBytes) {
        cancelReaderBestEffort(
          reader,
          new TypeError("Daily Plan Preview request body is too large."),
        );
        return { status: "too-large" };
      }
      if (value.byteLength > 0) {
        chunks.push(value);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Cleanup is best effort and must not replace the primary route result.
    }
  }

  const bytes = new Uint8Array(measuredBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { status: "ok", bytes };
}

function cancelReaderBestEffort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: unknown,
): void {
  try {
    void reader.cancel(reason).catch(() => undefined);
  } catch {
    // A hostile stream cannot replace the primary bounded-body result.
  }
}
