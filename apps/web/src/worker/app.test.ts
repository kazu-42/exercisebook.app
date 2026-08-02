import { describe, expect, it, vi } from "vitest";

import {
  answerKeyWorksheetFixture,
  studentWorksheetFixture,
} from "@exercisebook/web-renderer/fixtures";

import { createApp } from "./app.js";
import type { DailyPlanPreviewService } from "./daily-plan-preview-service.js";
import type { SampleWorksheetService } from "./sample-worksheet-service.js";

const service: SampleWorksheetService = {
  async getSample({ variant }) {
    return variant === "student" ? studentWorksheetFixture : answerKeyWorksheetFixture;
  },
};

const dailyPlanPreviewService: DailyPlanPreviewService = {
  async createPreview() {
    return { status: "unavailable", code: "goal-unavailable" };
  },
};

const dailyPlanPreviewServiceV2 = {
  async createPreview() {
    return { status: "unavailable", code: "goal-unavailable" } as const;
  },
};

describe("Exercise Book Worker", () => {
  const app = createApp({
    sampleWorksheetService: service,
    dailyPlanPreviewService,
    dailyPlanPreviewServiceV2,
  });

  it("reports a stable health response without ambient timestamps", async () => {
    const response = await app.request("https://exercisebook.app/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      service: "exercisebook-web",
      status: "ok",
      version: "phase-1",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns a deterministic student projection and cache metadata", async () => {
    const seed = "a".repeat(64);
    const first = await app.request(
      `https://exercisebook.app/api/worksheets/sample?seed=${seed}&variant=student`,
    );
    const second = await app.request(
      `https://exercisebook.app/api/worksheets/sample?seed=${seed}&variant=student`,
    );

    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe(
      "public, max-age=300, s-maxage=86400",
    );
    expect(first.headers.get("etag")).toBe(
      `W/"${studentWorksheetFixture.instanceHash}-web-v1-student"`,
    );
    expect(await first.text()).toBe(await second.text());
  });

  it("selects the answer-key projection explicitly", async () => {
    const response = await app.request(
      `https://exercisebook.app/api/worksheets/sample?seed=${"b".repeat(64)}&variant=answer-key`,
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      variant: "answer-key",
    });
  });

  it.each([
    ["seed", "too-short"],
    ["seed", "A".repeat(64)],
    ["variant", "teacher"],
    ["unknown", "value"],
    ["variant", "student&variant=answer-key"],
  ])("rejects invalid %s query input", async (key, value) => {
    const response = await app.request(
      `https://exercisebook.app/api/worksheets/sample?${key}=${value}`,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "invalid_query",
      message: "Use a 64-character lowercase hexadecimal seed and a supported variant.",
    });
  });

  it("does not expose an answer key from the default student request", async () => {
    const response = await app.request(
      "https://exercisebook.app/api/worksheets/sample",
    );
    const body = await response.text();

    expect(body).not.toContain("7/12");
    expect(body).not.toContain("solution");
    expect(body).not.toContain("canonicalAnswer");
  });

  it("normalizes a non-Error service throw and reports only fixed metadata once", async () => {
    const reportUnexpectedError = vi.fn();
    const unsafeFailure = {
      message: "secret service message",
      stack: "secret service stack",
      body: { canonicalAnswer: "7/12" },
      seed: "a".repeat(64),
      instanceHash: "b".repeat(64),
    };
    const failingService: SampleWorksheetService = {
      async getSample() {
        throw unsafeFailure;
      },
    };
    const failingApp = createApp(
      {
        sampleWorksheetService: failingService,
        dailyPlanPreviewService,
        dailyPlanPreviewServiceV2,
      },
      { reportUnexpectedError },
    );

    const response = await failingApp.request(
      "https://exercisebook.app/api/worksheets/sample",
    );
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-type")).toMatch(/^application\/json\b/u);
    expect(JSON.parse(body)).toEqual({
      code: "internal_error",
      message: "The worksheet could not be prepared.",
    });
    expect(body).not.toContain(unsafeFailure.message);
    expect(body).not.toContain(unsafeFailure.body.canonicalAnswer);
    expect(reportUnexpectedError).toHaveBeenCalledExactlyOnceWith({
      event: "exercisebook.worker.unexpected_error",
      route: "sample-worksheet",
      status: 500,
    });
    expect(JSON.stringify(reportUnexpectedError.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(reportUnexpectedError.mock.calls)).not.toContain("7/12");
    expect(JSON.stringify(reportUnexpectedError.mock.calls)).not.toContain(
      unsafeFailure.seed,
    );
    expect(JSON.stringify(reportUnexpectedError.mock.calls)).not.toContain(
      unsafeFailure.instanceHash,
    );
  });

  it("uses the same sanitized structured report through the default console hook", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const failingService: SampleWorksheetService = {
      async getSample() {
        throw new Error(
          "secret message stack body answer seed instanceHash must not be logged",
        );
      },
    };
    const failingApp = createApp({
      sampleWorksheetService: failingService,
      dailyPlanPreviewService,
      dailyPlanPreviewServiceV2,
    });

    try {
      const response = await failingApp.request(
        "https://exercisebook.app/api/worksheets/sample",
      );

      expect(response.status).toBe(500);
      expect(consoleError).toHaveBeenCalledExactlyOnceWith({
        event: "exercisebook.worker.unexpected_error",
        route: "sample-worksheet",
        status: 500,
      });
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret");
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain("instanceHash");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps the sanitized response when an injected reporter fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const reportUnexpectedError = vi.fn(() => {
      throw new Error("secret reporter failure");
    });
    const failingService: SampleWorksheetService = {
      async getSample() {
        throw new Error("secret service failure");
      },
    };
    const failingApp = createApp(
      {
        sampleWorksheetService: failingService,
        dailyPlanPreviewService,
        dailyPlanPreviewServiceV2,
      },
      { reportUnexpectedError },
    );

    try {
      const response = await failingApp.request(
        "https://exercisebook.app/api/worksheets/sample",
      );

      expect(response.status).toBe(500);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(reportUnexpectedError).toHaveBeenCalledOnce();
      expect(consoleError).toHaveBeenCalledExactlyOnceWith({
        event: "exercisebook.worker.unexpected_error_report_failed",
        route: "sample-worksheet",
        status: 500,
      });
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("returns a JSON 404 under the API boundary", async () => {
    const response = await app.request("https://exercisebook.app/api/not-a-route");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: "not_found",
      message: "API route not found.",
    });
  });
});
