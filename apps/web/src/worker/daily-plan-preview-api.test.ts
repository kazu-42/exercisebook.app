import { describe, expect, it, vi } from "vitest";

import {
  answerKeyWorksheetFixture,
  studentWorksheetFixture,
} from "@exercisebook/web-renderer/fixtures";

import {
  DAY_ONE_PREVIEW_REGISTRY,
  type DailyPlanPreviewRegistryV1,
} from "@exercisebook/planner";
import {
  DAILY_PLAN_PREVIEW_RESPONSE_V1_SCHEMA,
  validateDailyPlanPreviewResponseV1,
  type DailyPlanPreviewResponseV1,
} from "../shared/daily-plan-preview-contract.js";
import { createApp } from "./app.js";
import type {
  DailyPlanPreviewService,
  DailyPlanPreviewServiceResult,
} from "./daily-plan-preview-service.js";
import { createDailyPlanPreviewService } from "./daily-plan-preview-service.js";
import type { SampleWorksheetService } from "./sample-worksheet-service.js";

const validRequest = {
  schema: "exercisebook.daily-plan-preview-request/v1",
  goalId: "math.fractions.add-unlike",
  practiceMinutes: 8,
  localStudyDate: "2026-07-19",
  timeZone: "Asia/Tokyo",
  locale: "en",
} as const;

const validRequestJson = JSON.stringify(validRequest);
const duplicateSchemaRequest = validRequestJson.replace(
  '"schema":"exercisebook.daily-plan-preview-request/v1"',
  '"schema":"exercisebook.daily-plan-preview-request/v1","schema":"exercisebook.daily-plan-preview-request/v1"',
);
const escapedDuplicateSchemaRequest = validRequestJson.replace(
  '"schema":"exercisebook.daily-plan-preview-request/v1"',
  '"schema":"exercisebook.daily-plan-preview-request/v1","\\u0073chema":"exercisebook.daily-plan-preview-request/v1"',
);

function createReadyResponse(): DailyPlanPreviewResponseV1 {
  const items = Array.from({ length: 4 }, (_, index) => ({
    ...studentWorksheetFixture.items[index % studentWorksheetFixture.items.length]!,
    id: `practice-${String(index + 1).padStart(2, "0")}`,
    ordinal: index + 1,
  }));
  const assignmentId = `preview-${"b".repeat(64)}`;

  return {
    schema: DAILY_PLAN_PREVIEW_RESPONSE_V1_SCHEMA,
    plan: {
      id: assignmentId,
      goalId: "math.fractions.add-unlike",
      requestedPracticeMinutes: 8,
      plannedPracticeMinutes: 8,
      itemCount: 4,
      policy: { id: "day-one-fraction-preview", version: 2 },
      skillGraph: { id: "phase-1-math", revision: 1 },
      evidenceKind: "none",
      selectionReasons: ["current-frontier"],
      selectionExplanation:
        "This focused set practices the fraction goal you selected. It is a preview based on your goal and time limit, not a saved or mastery-based plan.",
      saved: false,
    },
    worksheet: {
      ...studentWorksheetFixture,
      instanceHash: "a".repeat(64),
      assignmentId,
      studyDate: "2026-07-19",
      locale: "en",
      expectedMinutes: 8,
      items,
    },
  };
}

const sampleWorksheetService: SampleWorksheetService = {
  async getSample({ variant }) {
    return variant === "student" ? studentWorksheetFixture : answerKeyWorksheetFixture;
  },
};

function createTestApp(
  result: DailyPlanPreviewServiceResult = {
    status: "ready",
    response: createReadyResponse(),
  },
) {
  const createPreview = vi.fn<DailyPlanPreviewService["createPreview"]>();
  createPreview.mockResolvedValue(result);
  const app = createApp({
    sampleWorksheetService,
    dailyPlanPreviewService: { createPreview },
  });
  return { app, createPreview };
}

function previewRequest(
  body: BodyInit | null = validRequestJson,
  headers: HeadersInit = { "Content-Type": "application/json" },
): Request {
  return new Request("https://exercisebook.app/api/plans/preview", {
    method: "POST",
    headers,
    body,
  });
}

function expectPrivateJsonHeaders(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-type")).toMatch(/^application\/json\b/u);
  expect(response.headers.get("set-cookie")).toBeNull();
}

describe("POST /api/plans/preview", () => {
  it.each([
    [8, 4, 8],
    [12, 6, 12],
    [20, 8, 16],
  ] as const)(
    "runs the real planner/content/generator/student projection chain for %i minutes",
    async (practiceMinutes, itemCount, plannedPracticeMinutes) => {
      const app = createApp({
        sampleWorksheetService,
        dailyPlanPreviewService: createDailyPlanPreviewService(),
      });
      const body = JSON.stringify({ ...validRequest, practiceMinutes });

      const first = await app.request(previewRequest(body));
      const repeated = await app.request(previewRequest(body));

      expect(first.status).toBe(200);
      expectPrivateJsonHeaders(first);
      const firstText = await first.text();
      expect(await repeated.text()).toBe(firstText);
      const payload = validateDailyPlanPreviewResponseV1(JSON.parse(firstText));
      expect(payload.plan).toMatchObject({
        requestedPracticeMinutes: practiceMinutes,
        plannedPracticeMinutes,
        itemCount,
      });
      expect(payload.worksheet.items).toHaveLength(itemCount);
      expect(payload.worksheet.expectedMinutes).toBe(plannedPracticeMinutes);
      for (const protectedName of [
        "canonicalAnswer",
        "accepted",
        "scoringRule",
        "solutionTrace",
        "baseSeed",
        "slotSeed",
      ]) {
        expect(firstText).not.toContain(protectedName);
      }
    },
  );

  it("validates and returns a deterministic student-only response", async () => {
    const { app, createPreview } = createTestApp();

    const first = await app.request(previewRequest());
    const second = await app.request(previewRequest());

    expect(first.status).toBe(200);
    expectPrivateJsonHeaders(first);
    expect(await first.text()).toBe(await second.text());
    expect(createPreview).toHaveBeenNthCalledWith(1, validRequest);
    expect(createPreview).toHaveBeenNthCalledWith(2, validRequest);
  });

  it("produces the same real response for reordered request properties", async () => {
    const app = createApp({
      sampleWorksheetService,
      dailyPlanPreviewService: createDailyPlanPreviewService(),
    });
    const reorderedRequestJson = JSON.stringify({
      locale: validRequest.locale,
      timeZone: validRequest.timeZone,
      localStudyDate: validRequest.localStudyDate,
      practiceMinutes: validRequest.practiceMinutes,
      goalId: validRequest.goalId,
      schema: validRequest.schema,
    });

    const canonical = await app.request(previewRequest(validRequestJson));
    const reordered = await app.request(previewRequest(reorderedRequestJson));

    expect(canonical.status).toBe(200);
    expect(reordered.status).toBe(200);
    expect(await reordered.text()).toBe(await canonical.text());
  });

  it.each([
    [undefined, ""],
    ["application/json", ""],
    ["application/json", "{"],
    ["application/json", JSON.stringify({ ...validRequest, learnerName: "Ada" })],
    ["application/json", duplicateSchemaRequest],
    ["application/json", escapedDuplicateSchemaRequest],
  ])("returns sanitized 400 for an invalid JSON request", async (contentType, body) => {
    const { app, createPreview } = createTestApp();
    const headers = contentType === undefined ? {} : { "Content-Type": contentType };

    const response = await app.request(previewRequest(body, headers));

    expect(response.status).toBe(contentType === undefined ? 415 : 400);
    expectPrivateJsonHeaders(response);
    expect(await response.json()).toEqual(
      contentType === undefined
        ? {
            code: "unsupported_media_type",
            message: "Use application/json for preview requests.",
          }
        : {
            code: "invalid_request",
            message: "Check the preview request and try again.",
          },
    );
    expect(createPreview).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON media type before reading the body", async () => {
    const { app, createPreview } = createTestApp();

    const response = await app.request(
      previewRequest("not json", { "Content-Type": "text/plain" }),
    );

    expect(response.status).toBe(415);
    expectPrivateJsonHeaders(response);
    expect(await response.json()).toEqual({
      code: "unsupported_media_type",
      message: "Use application/json for preview requests.",
    });
    expect(createPreview).not.toHaveBeenCalled();
  });

  it.each([
    [
      "declared",
      "{}",
      { "Content-Type": "application/json", "Content-Length": "4097" },
    ],
    [
      "measured",
      JSON.stringify({ ...validRequest, padding: "x".repeat(4096) }),
      { "Content-Type": "application/json" },
    ],
    [
      "UTF-8 measured",
      JSON.stringify({ ...validRequest, padding: "あ".repeat(1_400) }),
      { "Content-Type": "application/json" },
    ],
    [
      "falsely under-declared",
      JSON.stringify({ ...validRequest, padding: "x".repeat(4096) }),
      { "Content-Type": "application/json", "Content-Length": "2" },
    ],
  ])("returns 413 for an oversized %s body", async (_kind, body, headers) => {
    const { app, createPreview } = createTestApp();

    const response = await app.request(previewRequest(body, headers));

    expect(response.status).toBe(413);
    expectPrivateJsonHeaders(response);
    expect(await response.json()).toEqual({
      code: "request_too_large",
      message: "The preview request must be 4096 bytes or less.",
    });
    expect(createPreview).not.toHaveBeenCalled();
  });

  it("accepts an exactly 4096-byte JSON body", async () => {
    const { app, createPreview } = createTestApp();
    const body = validRequestJson.padEnd(4096, " ");
    expect(new TextEncoder().encode(body)).toHaveLength(4096);

    const response = await app.request(
      previewRequest(body, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": "4096",
      }),
    );

    expect(response.status).toBe(200);
    expectPrivateJsonHeaders(response);
    expect(createPreview).toHaveBeenCalledWith(validRequest);
  });

  it("returns a sanitized 503 when a required revision is unavailable", async () => {
    const { app } = createTestApp({
      status: "unavailable",
      code: "goal-unavailable",
    });

    const response = await app.request(previewRequest());

    expect(response.status).toBe(503);
    expectPrivateJsonHeaders(response);
    expect(await response.json()).toEqual({
      code: "preview_unavailable",
      message: "This preview is temporarily unavailable.",
    });
  });

  it("maps the real planner kill switch to a sanitized 503", async () => {
    const registry: DailyPlanPreviewRegistryV1 = {
      ...DAY_ONE_PREVIEW_REGISTRY,
      generator: { ...DAY_ONE_PREVIEW_REGISTRY.generator, enabled: false },
    };
    const app = createApp({
      sampleWorksheetService,
      dailyPlanPreviewService: createDailyPlanPreviewService({ registry }),
    });

    const response = await app.request(previewRequest());

    expect(response.status).toBe(503);
    expectPrivateJsonHeaders(response);
    expect(await response.json()).toEqual({
      code: "preview_unavailable",
      message: "This preview is temporarily unavailable.",
    });
  });

  it.each([
    [
      "plan/worksheet invariant mismatch",
      () => {
        const response = structuredClone(createReadyResponse());
        response.worksheet.assignmentId = "preview-wrong";
        return {
          status: "ready",
          response,
        } as unknown as DailyPlanPreviewServiceResult;
      },
    ],
    [
      "deep answer leak",
      () => {
        const response = structuredClone(createReadyResponse()) as unknown as {
          worksheet: { items: Record<string, unknown>[] };
        };
        response.worksheet.items[0]!.answer = "7/12";
        return {
          status: "ready",
          response,
        } as unknown as DailyPlanPreviewServiceResult;
      },
    ],
  ])("fails closed with a sanitized 500 for %s", async (_name, result) => {
    const { app } = createTestApp(result());

    const response = await app.request(previewRequest());

    expect(response.status).toBe(500);
    expectPrivateJsonHeaders(response);
    expect(await response.json()).toEqual({
      code: "internal_error",
      message: "The preview could not be prepared.",
    });
  });

  it("sanitizes an unexpected service failure", async () => {
    const createPreview = vi
      .fn<DailyPlanPreviewService["createPreview"]>()
      .mockRejectedValue(new Error("secret generator details"));
    const app = createApp({
      sampleWorksheetService,
      dailyPlanPreviewService: { createPreview },
    });

    const response = await app.request(previewRequest());
    const body = await response.text();

    expect(response.status).toBe(500);
    expectPrivateJsonHeaders(response);
    expect(JSON.parse(body)).toEqual({
      code: "internal_error",
      message: "The preview could not be prepared.",
    });
    expect(body).not.toContain("secret generator details");
  });
});
