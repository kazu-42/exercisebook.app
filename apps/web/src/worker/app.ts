import { Hono, type Context } from "hono";

import { validateDailyPlanPreviewRequestV1 } from "@exercisebook/planner";

import { parseStrictJson } from "../shared/strict-json.js";
import {
  validateDailyPlanPreviewServiceResult,
  type DailyPlanPreviewService,
} from "./daily-plan-preview-service.js";

export const MAX_DAILY_PLAN_PREVIEW_BODY_BYTES = 4_096;
export const PREVIEW_RATE_LIMIT_KEY = "anonymous-preview-v1";

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");
const EMITTED_ASSET_PATH =
  /^\/assets\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:css|js|mjs|png|svg|woff|woff2)$/u;

export interface AssetBinding {
  fetch(input: Request | string | URL): Promise<Response>;
}

export interface RateLimitBinding {
  limit(input: { readonly key: string }): Promise<{ readonly success: boolean }>;
}

export interface ExerciseBookWorkerBindings {
  readonly ASSETS: AssetBinding;
  readonly PREVIEW_RATE_LIMITER: RateLimitBinding;
}

export interface AppServices {
  readonly dailyPlanPreviewService: DailyPlanPreviewService;
  readonly allowDevelopmentAssets?: boolean;
}

type ExerciseBookWorkerEnvironment = {
  Bindings: ExerciseBookWorkerBindings;
};
type ExerciseBookWorkerContext = Context<ExerciseBookWorkerEnvironment>;

export function createApp(services: AppServices) {
  const app = new Hono<ExerciseBookWorkerEnvironment>()
    .use("*", async (context, next) => {
      applySecurityHeaders(context.header.bind(context));
      await next();
      applySecurityHeaders(context.header.bind(context));
    })
    .on("HEAD", "/", (context) => methodNotAllowed(context, "GET"))
    .get("/", (context) => {
      context.header("Cache-Control", "no-store");
      return context.redirect("/new", 302);
    })
    .all("/", (context) => methodNotAllowed(context, "GET"))
    .on(["GET", "HEAD"], "/new", async (context) => {
      context.header("Cache-Control", "no-store");
      if (new URL(context.req.url).search !== "") {
        return notFound(context);
      }
      const response = await fetchRequiredAsset(
        context.env?.ASSETS,
        new URL("/index.html", context.req.url),
        context.req.method,
      );
      if (!response.ok) {
        return notFound(context);
      }
      return cloneResponse(response, context.req.method === "HEAD", {
        "Cache-Control": "no-store",
      });
    })
    .all("/new", (context) => methodNotAllowed(context, "GET, HEAD"))
    .on(["GET", "HEAD"], "/assets/*", async (context) => {
      const url = new URL(context.req.url);
      if (url.search !== "" || !EMITTED_ASSET_PATH.test(url.pathname)) {
        return notFound(context);
      }
      const response = await fetchRequiredAsset(
        context.env?.ASSETS,
        url,
        context.req.method,
      );
      if (!response.ok) {
        return notFound(context);
      }
      return cloneResponse(response, context.req.method === "HEAD");
    })
    .all("/assets/*", (context) => methodNotAllowed(context, "GET, HEAD"))
    .on(["GET", "HEAD"], "/api/health", (context) => {
      context.header("Cache-Control", "no-store");
      const response = context.json({
        service: "exercisebook-web",
        status: "ok",
        version: "learning-new-v1",
      });
      return context.req.method === "HEAD" ? cloneResponse(response, true) : response;
    })
    .all("/api/health", (context) => methodNotAllowed(context, "GET, HEAD"))
    .post("/api/plans/preview", async (context) => {
      context.header("Cache-Control", "no-store");
      const limiter = context.env?.PREVIEW_RATE_LIMITER;
      if (limiter === undefined || typeof limiter.limit !== "function") {
        throw new TypeError("Preview rate limiter binding is unavailable");
      }
      const rateLimitResult = await limiter.limit({ key: PREVIEW_RATE_LIMIT_KEY });
      if (
        rateLimitResult === null ||
        typeof rateLimitResult !== "object" ||
        typeof rateLimitResult.success !== "boolean"
      ) {
        throw new TypeError("Preview rate limiter returned an invalid result");
      }
      if (!rateLimitResult.success) {
        context.header("Retry-After", "60");
        return context.json(
          {
            code: "rate_limited",
            message: "Too many preview requests. Try again shortly.",
          },
          429,
        );
      }

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
    })
    .all("/api/plans/preview", (context) => methodNotAllowed(context, "POST"))
    .on(["GET", "HEAD"], "*", async (context) => {
      if (services.allowDevelopmentAssets !== true) {
        return notFound(context);
      }
      const response = await fetchRequiredAsset(
        context.env?.ASSETS,
        new URL(context.req.url),
        context.req.method,
      );
      return response.ok
        ? cloneResponse(response, context.req.method === "HEAD")
        : notFound(context);
    });

  app.notFound((context) => notFound(context));

  app.onError((error, context) => {
    console.error(
      JSON.stringify({
        event: "worker_unexpected_error",
        route: classifyRoute(context.req.path),
        method: context.req.method,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    context.header("Cache-Control", "no-store");
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
        message: "The page could not be served.",
      },
      500,
    );
  });

  return app;
}

function applySecurityHeaders(
  setHeader: (name: string, value: string, options?: { append?: boolean }) => void,
): void {
  setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  setHeader("Cross-Origin-Opener-Policy", "same-origin");
  setHeader("Cross-Origin-Resource-Policy", "same-origin");
  setHeader(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  );
  setHeader("Referrer-Policy", "no-referrer");
  setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  setHeader("X-Content-Type-Options", "nosniff");
  setHeader("X-Frame-Options", "DENY");
}

async function fetchRequiredAsset(
  binding: AssetBinding | undefined,
  url: URL,
  method: string,
): Promise<Response> {
  if (binding === undefined || typeof binding.fetch !== "function") {
    throw new TypeError("Static asset binding is unavailable");
  }
  return binding.fetch(new Request(url, { method }));
}

function cloneResponse(
  response: Response,
  omitBody: boolean,
  headers: HeadersInit = {},
): Response {
  const clonedHeaders = new Headers(response.headers);
  for (const [name, value] of new Headers(headers)) {
    clonedHeaders.set(name, value);
  }
  return new Response(omitBody ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: clonedHeaders,
  });
}

function methodNotAllowed(context: ExerciseBookWorkerContext, allow: string) {
  context.header("Allow", allow);
  context.header("Cache-Control", "no-store");
  return context.json(
    {
      code: "method_not_allowed",
      message: "Method not allowed.",
    },
    405,
  );
}

function notFound(context: ExerciseBookWorkerContext) {
  context.header("Cache-Control", "no-store");
  return context.json(
    {
      code: "not_found",
      message: "Route not found.",
    },
    404,
  );
}

function classifyRoute(pathname: string): string {
  if (pathname === "/new") {
    return "launch-page";
  }
  if (pathname === "/api/plans/preview") {
    return "preview-api";
  }
  if (pathname === "/api/health") {
    return "health-api";
  }
  if (pathname.startsWith("/assets/")) {
    return "static-asset";
  }
  return "denied-route";
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
