import { describe, expect, it } from "vitest";

import worker, { PRIMARY_CREATE_URL } from "./index.js";

function expectRedirectHeaders(response: Response): void {
  expect(response.headers.get("location")).toBe(PRIMARY_CREATE_URL);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-frame-options")).toBe("DENY");
  expect(response.headers.get("content-security-policy")).toBe(
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect(response.headers.get("set-cookie")).toBeNull();
}

describe("learning.new action-domain redirect", () => {
  it.each(["GET", "HEAD"])(
    "redirects %s / directly to the exact primary create URL",
    async (method) => {
      const response = await worker.fetch(
        new Request("https://learning.new/", { method }),
      );

      expect(response.status).toBe(302);
      expectRedirectHeaders(response);
      expect(await response.text()).toBe("");
    },
  );

  it("drops every query parameter and incoming cookie", async () => {
    const response = await worker.fetch(
      new Request("https://learning.new/?learner=Ada&token=secret&prompt=private", {
        headers: { Cookie: "session=private" },
      }),
    );

    expect(response.status).toBe(302);
    expectRedirectHeaders(response);
    expect(response.headers.get("location")).not.toContain("?");
    expect(JSON.stringify([...response.headers])).not.toContain("private");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])(
    "returns 405 without redirecting for %s /",
    async (method) => {
      const response = await worker.fetch(
        new Request("https://learning.new/?token=secret", { method }),
      );

      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD");
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        code: "method_not_allowed",
        message: "Method not allowed.",
      });
    },
  );

  it.each(["/new", "/anything", "/robots.txt"])(
    "does not redirect an unsupported path %s",
    async (pathname) => {
      const response = await worker.fetch(
        new Request(`https://learning.new${pathname}?token=secret`),
      );

      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        code: "not_found",
        message: "Route not found.",
      });
    },
  );

  it.each([
    "https://www.learning.new/",
    "https://learning.new.example/",
    "https://example.com/",
  ])("does not redirect an ambiguous host %s", async (url) => {
    const response = await worker.fetch(new Request(url));

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  });

  it("permits the Cloudflare preview hostname test seam", async () => {
    const response = await worker.fetch(
      new Request("https://learning-new-redirect-preview.account.workers.dev/"),
    );

    expect(response.status).toBe(302);
    expectRedirectHeaders(response);
  });
});
