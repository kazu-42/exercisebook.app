import { Hono } from "hono";

import type { WebWorksheetVariant } from "@exercisebook/web-renderer";

import type { SampleWorksheetService } from "./sample-worksheet-service.js";

export const DEFAULT_SAMPLE_SEED =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const seedPattern = /^[0-9a-f]{64}$/;
const allowedQueryKeys = new Set(["seed", "variant"]);

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

export function createApp(service: SampleWorksheetService) {
  const app = new Hono()
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

      const worksheet = await service.getSample(request);
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
