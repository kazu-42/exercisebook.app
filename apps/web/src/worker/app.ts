import { Hono } from "hono";

import { validateDailyPlanPreviewRequestV1 } from "@exercisebook/planner";
import type { WebWorksheetVariant } from "@exercisebook/web-renderer";

import {
  validateDailyPlanPreviewServiceResult,
  type DailyPlanPreviewService,
} from "./daily-plan-preview-service.js";
import type { SampleWorksheetService } from "./sample-worksheet-service.js";
import { parseStrictJson } from "./strict-json.js";

export const DEFAULT_SAMPLE_SEED =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const seedPattern = /^[0-9a-f]{64}$/;
const allowedQueryKeys = new Set(["seed", "variant"]);
export const MAX_DAILY_PLAN_PREVIEW_BODY_BYTES = 4_096;

export interface AppServices {
  readonly sampleWorksheetService: SampleWorksheetService;
  readonly dailyPlanPreviewService: DailyPlanPreviewService;
}

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

export function createApp(services: AppServices) {
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
    .get("/api/worksheets/sample", async (context) => {
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
    })
    .post("/api/plans/preview", async (context) => {
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

      let request: ReturnType<typeof validateDailyPlanPreviewRequestV1>;
      try {
        const body = new TextDecoder("utf-8", { fatal: true }).decode(
          measuredBody.bytes,
        );
        request = validateDailyPlanPreviewRequestV1(parseStrictJson(body));
      } catch {
        return context.json(
          {
            code: "invalid_request",
            message: "Check the preview request and try again.",
          },
          400,
        );
      }

      const result = validateDailyPlanPreviewServiceResult(
        await services.dailyPlanPreviewService.createPreview(request),
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
      return context.json(result.response);
    });

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
  Readonly<{ status: "ok"; bytes: Uint8Array }> | Readonly<{ status: "too-large" }>
> {
  if (request.body === null) {
    return { status: "ok", bytes: new Uint8Array() };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let measuredBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      measuredBytes += chunk.value.byteLength;
      if (measuredBytes > maximumBytes) {
        await reader.cancel("Daily Plan Preview request body is too large");
        return { status: "too-large" };
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(measuredBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { status: "ok", bytes };
}
