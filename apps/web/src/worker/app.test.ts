import { describe, expect, it, vi } from "vitest";

import { createApp, type ExerciseBookWorkerBindings } from "./app.js";
import type { DailyPlanPreviewService } from "./daily-plan-preview-service.js";

const dailyPlanPreviewService: DailyPlanPreviewService = {
  async createPreview() {
    return { status: "unavailable", code: "goal-unavailable" };
  },
};

function testBindings(options: { rateLimitSuccess?: boolean } = {}) {
  const fetch = vi.fn(async (request: Request | string | URL) => {
    const url = new URL(
      request instanceof Request ? request.url : request.toString(),
      "https://exercisebook.app",
    );
    if (url.pathname === "/index.html") {
      return new Response("<!doctype html><title>Launch preview</title>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/assets/launch-a1b2c3.js") {
      return new Response("export {};", {
        headers: {
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Type": "text/javascript; charset=utf-8",
        },
      });
    }
    return new Response("Not found", { status: 404 });
  });
  const limit = vi.fn(async () => ({
    success: options.rateLimitSuccess ?? true,
  }));
  return {
    bindings: {
      ASSETS: { fetch },
      PREVIEW_RATE_LIMITER: { limit },
    } satisfies ExerciseBookWorkerBindings,
    fetch,
    limit,
  };
}

function expectSecurityHeaders(response: Response): void {
  expect(response.headers.get("content-security-policy")).toBe(
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  );
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-frame-options")).toBe("DENY");
  expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  expect(response.headers.get("strict-transport-security")).toBe(
    "max-age=31536000; includeSubDomains",
  );
  expect(response.headers.get("permissions-policy")).toBe(
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  );
  expect(response.headers.get("set-cookie")).toBeNull();
}

describe("Exercise Book launch Worker", () => {
  const app = createApp({ dailyPlanPreviewService });

  it("temporarily redirects only GET / to the creation flow", async () => {
    const { bindings } = testBindings();
    const response = await app.request(
      "https://exercisebook.app/?learner=Ada",
      undefined,
      bindings,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/new");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expectSecurityHeaders(response);
  });

  it("returns the same side-effect-free redirect metadata for HEAD /", async () => {
    const { bindings } = testBindings();
    const response = await app.request(
      "https://exercisebook.app/",
      { method: "HEAD" },
      bindings,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/new");
    expect(await response.text()).toBe("");
    expectSecurityHeaders(response);
  });

  it.each(["GET", "HEAD"])(
    "serves the reviewed launch shell for %s /new",
    async (method) => {
      const { bindings, fetch } = testBindings();
      const response = await app.request(
        "https://exercisebook.app/new",
        { method },
        bindings,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expectSecurityHeaders(response);
      expect(fetch).toHaveBeenCalledTimes(1);
      const assetRequest = fetch.mock.calls[0]?.[0];
      expect(assetRequest).toBeInstanceOf(Request);
      expect(new URL((assetRequest as Request).url).pathname).toBe("/index.html");
      if (method === "HEAD") {
        expect(await response.text()).toBe("");
      }
    },
  );

  it("serves only emitted hashed assets through the asset binding", async () => {
    const { bindings, fetch } = testBindings();
    const response = await app.request(
      "https://exercisebook.app/assets/launch-a1b2c3.js",
      undefined,
      bindings,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expectSecurityHeaders(response);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports a stable launch health response without ambient timestamps", async () => {
    const { bindings } = testBindings();
    const response = await app.request(
      "https://exercisebook.app/api/health",
      undefined,
      bindings,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      service: "exercisebook-web",
      status: "ok",
      version: "learning-new-v1",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expectSecurityHeaders(response);
  });

  it.each([
    "/lessons/fractions/add-unlike-denominators",
    "/worksheet/sample",
    "/worksheet/sample/answers",
    "/api/worksheets/sample",
    "/src/react-app/App.tsx",
    "/new?prototype=true",
    "/robots.txt",
  ])("does not publish prototype or arbitrary path %s", async (pathname) => {
    const { bindings, fetch } = testBindings();
    const response = await app.request(
      `https://exercisebook.app${pathname}`,
      undefined,
      bindings,
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expectSecurityHeaders(response);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["POST", "/new"],
    ["GET", "/api/plans/preview"],
    ["POST", "/api/health"],
    ["POST", "/assets/launch-a1b2c3.js"],
  ])("returns 405 for disallowed %s %s", async (method, pathname) => {
    const { bindings } = testBindings();
    const response = await app.request(
      `https://exercisebook.app${pathname}`,
      { method },
      bindings,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).not.toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expectSecurityHeaders(response);
  });

  it("fails closed and logs only aggregate fields when an asset binding is absent", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await app.request(
        "https://exercisebook.app/new",
        undefined,
        {} as ExerciseBookWorkerBindings,
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        code: "internal_error",
        message: "The page could not be served.",
      });
      expect(consoleError).toHaveBeenCalledWith(
        JSON.stringify({
          event: "worker_unexpected_error",
          route: "launch-page",
          method: "GET",
          errorName: "TypeError",
        }),
      );
      expect(consoleError.mock.calls.flat().join(" ")).not.toContain(
        "exercisebook.app/new",
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
