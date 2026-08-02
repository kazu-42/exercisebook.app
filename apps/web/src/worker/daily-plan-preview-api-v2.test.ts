import { describe, expect, it, vi } from "vitest";

import {
  DAILY_PLAN_PREVIEW_REQUEST_V1_SCHEMA,
  DAILY_PLAN_PREVIEW_REQUEST_V2_SCHEMA,
  type DailyPlanPreviewRequestV1,
  type DailyPlanPreviewRequestV2,
} from "@exercisebook/planner";
import {
  answerKeyWorksheetFixture,
  studentWorksheetFixture,
} from "@exercisebook/web-renderer/fixtures";

import {
  validateDailyPlanPreviewResponseV2,
  type DailyPlanPreviewResponseV2,
} from "../shared/daily-plan-preview-contract-v2.js";
import { MAX_DAILY_PLAN_PREVIEW_RESPONSE_BYTES } from "../shared/public-api-response-limits.js";
import { createApp } from "./app.js";
import {
  createDailyPlanPreviewService,
  type DailyPlanPreviewService,
} from "./daily-plan-preview-service.js";
import {
  createDailyPlanPreviewServiceV2,
  type DailyPlanPreviewServiceResultV2,
  type DailyPlanPreviewServiceV2,
} from "./daily-plan-preview-service-v2.js";
import type { SampleWorksheetService } from "./sample-worksheet-service.js";

const requestV1: DailyPlanPreviewRequestV1 = {
  schema: DAILY_PLAN_PREVIEW_REQUEST_V1_SCHEMA,
  goalId: "math.fractions.add-unlike",
  practiceMinutes: 8,
  localStudyDate: "2026-07-21",
  timeZone: "Asia/Tokyo",
  locale: "en",
};

const requestV2: DailyPlanPreviewRequestV2 = {
  ...requestV1,
  schema: DAILY_PLAN_PREVIEW_REQUEST_V2_SCHEMA,
};

const sampleWorksheetService: SampleWorksheetService = {
  async getSample({ variant }) {
    return variant === "student" ? studentWorksheetFixture : answerKeyWorksheetFixture;
  },
};

const unavailableV1Service: DailyPlanPreviewService = {
  async createPreview() {
    return { status: "unavailable", code: "goal-unavailable" };
  },
};

function previewRequest(value: unknown): Request {
  return new Request("https://exercisebook.app/api/plans/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

function expectPrivateJsonHeaders(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-type")).toMatch(/^application\/json\b/u);
  expect(response.headers.get("set-cookie")).toBeNull();
}

describe("POST /api/plans/preview V2 dispatch", () => {
  it.each([
    [8, 4, 8],
    [12, 6, 12],
    [20, 8, 16],
  ] as const)(
    "serves the real request-v2 chain for %i minutes as %i items and %i planned minutes",
    async (practiceMinutes, itemCount, plannedPracticeMinutes) => {
      const app = createApp({
        sampleWorksheetService,
        dailyPlanPreviewService: unavailableV1Service,
        dailyPlanPreviewServiceV2: createDailyPlanPreviewServiceV2(),
      });
      const request = { ...requestV2, practiceMinutes };

      const first = await app.request(previewRequest(request));
      const repeated = await app.request(previewRequest(request));

      expect(first.status).toBe(200);
      expectPrivateJsonHeaders(first);
      const firstText = await first.text();
      expect(await repeated.text()).toBe(firstText);
      expect(new TextEncoder().encode(firstText).byteLength).toBeLessThanOrEqual(
        MAX_DAILY_PLAN_PREVIEW_RESPONSE_BYTES,
      );
      const payload = validateDailyPlanPreviewResponseV2(JSON.parse(firstText));
      expect(payload).toMatchObject({
        schema: "exercisebook.daily-plan-preview-response/v2",
        plan: {
          requestedPracticeMinutes: practiceMinutes,
          plannedPracticeMinutes,
          itemCount,
          policy: { id: "day-one-fraction-preview", version: 3 },
        },
        worksheet: {
          schemaVersion: "web-worksheet.v2",
          variant: "student",
          expectedMinutes: plannedPracticeMinutes,
        },
      });
      expect(payload.worksheet.items).toHaveLength(itemCount);
      for (const protectedName of [
        "canonicalAnswer",
        "scoringRule",
        "solutionTrace",
        "baseSeed",
        "slotSeed",
        "seedSecretVersion",
        "activities",
        "presentationSelection",
        "excludedCanonicalAnswers",
      ]) {
        expect(firstText).not.toContain(`\"${protectedName}\"`);
      }
    },
  );

  it("dispatches each exact request schema only to its matching service", async () => {
    const readyV2 = await createDailyPlanPreviewServiceV2().createPreview(requestV2);
    if (readyV2.status !== "ready") {
      throw new Error("Expected the pinned V2 preview to be ready");
    }
    const createPreviewV1 = vi
      .fn<DailyPlanPreviewService["createPreview"]>()
      .mockResolvedValue({ status: "unavailable", code: "goal-unavailable" });
    const createPreviewV2 = vi
      .fn<DailyPlanPreviewServiceV2["createPreview"]>()
      .mockResolvedValue(readyV2);
    const app = createApp({
      sampleWorksheetService,
      dailyPlanPreviewService: { createPreview: createPreviewV1 },
      dailyPlanPreviewServiceV2: { createPreview: createPreviewV2 },
    });

    const v1Response = await app.request(previewRequest(requestV1));
    expect(v1Response.status).toBe(503);
    expect(createPreviewV1).toHaveBeenCalledExactlyOnceWith(requestV1);
    expect(createPreviewV2).not.toHaveBeenCalled();

    const v2Response = await app.request(previewRequest(requestV2));
    expect(v2Response.status).toBe(200);
    expect(createPreviewV1).toHaveBeenCalledTimes(1);
    expect(createPreviewV2).toHaveBeenCalledExactlyOnceWith(requestV2);
    expect((await v2Response.json()).schema).toBe(
      "exercisebook.daily-plan-preview-response/v2",
    );
  });

  it.each([
    ["missing", (({ schema: _schema, ...request }) => request)(requestV2)],
    ["non-string", { ...requestV2, schema: 2 }],
    ["unknown", { ...requestV2, schema: "exercisebook.daily-plan-preview-request/v3" }],
    [
      "mixed V1/V2 fields",
      {
        ...requestV2,
        schema: DAILY_PLAN_PREVIEW_REQUEST_V1_SCHEMA,
        presentationRevision: 2,
      },
    ],
  ])("rejects a %s discriminator before either service runs", async (_name, body) => {
    const createPreviewV1 = vi.fn<DailyPlanPreviewService["createPreview"]>();
    const createPreviewV2 = vi.fn<DailyPlanPreviewServiceV2["createPreview"]>();
    const app = createApp({
      sampleWorksheetService,
      dailyPlanPreviewService: { createPreview: createPreviewV1 },
      dailyPlanPreviewServiceV2: { createPreview: createPreviewV2 },
    });

    const response = await app.request(previewRequest(body));

    expect(response.status).toBe(400);
    expectPrivateJsonHeaders(response);
    expect(await response.json()).toEqual({
      code: "invalid_request",
      message: "Check the preview request and try again.",
    });
    expect(createPreviewV1).not.toHaveBeenCalled();
    expect(createPreviewV2).not.toHaveBeenCalled();
  });

  it("rejects a V1 producer result on the V2 lane", async () => {
    const wrongLaneResult =
      await createDailyPlanPreviewService().createPreview(requestV1);
    const app = createApp({
      sampleWorksheetService,
      dailyPlanPreviewService: unavailableV1Service,
      dailyPlanPreviewServiceV2: {
        async createPreview() {
          return wrongLaneResult as unknown as DailyPlanPreviewServiceResultV2;
        },
      },
    });

    const response = await app.request(previewRequest(requestV2));
    const body = await response.text();

    expect(response.status).toBe(500);
    expectPrivateJsonHeaders(response);
    expect(JSON.parse(body)).toEqual({
      code: "internal_error",
      message: "The preview could not be prepared.",
    });
    expect(body).not.toContain("web-worksheet.v1");
  });

  it("rejects a V2 producer result on the V1 lane", async () => {
    const wrongLaneResult =
      await createDailyPlanPreviewServiceV2().createPreview(requestV2);
    const app = createApp({
      sampleWorksheetService,
      dailyPlanPreviewService: {
        async createPreview() {
          return wrongLaneResult as never;
        },
      },
      dailyPlanPreviewServiceV2: createDailyPlanPreviewServiceV2(),
    });

    const response = await app.request(previewRequest(requestV1));

    expect(response.status).toBe(500);
    expectPrivateJsonHeaders(response);
    expect(await response.json()).toEqual({
      code: "internal_error",
      message: "The preview could not be prepared.",
    });
  });

  it("maps a strict V2 unavailable result to a sanitized 503", async () => {
    const app = createApp({
      sampleWorksheetService,
      dailyPlanPreviewService: unavailableV1Service,
      dailyPlanPreviewServiceV2: {
        async createPreview() {
          return { status: "unavailable", code: "goal-unavailable" };
        },
      },
    });

    const response = await app.request(previewRequest(requestV2));

    expect(response.status).toBe(503);
    expectPrivateJsonHeaders(response);
    expect(await response.json()).toEqual({
      code: "preview_unavailable",
      message: "This preview is temporarily unavailable.",
    });
  });

  it("sanitizes an unexpected V2 service failure", async () => {
    const app = createApp({
      sampleWorksheetService,
      dailyPlanPreviewService: unavailableV1Service,
      dailyPlanPreviewServiceV2: {
        async createPreview() {
          throw new Error("secret V2 content hash and resolver diagnostics");
        },
      },
    });

    const response = await app.request(previewRequest(requestV2));
    const body = await response.text();

    expect(response.status).toBe(500);
    expectPrivateJsonHeaders(response);
    expect(JSON.parse(body)).toEqual({
      code: "internal_error",
      message: "The preview could not be prepared.",
    });
    expect(body).not.toContain("secret V2 content hash");
  });

  it("returns exactly 32768 validated bytes and rejects 32769 bytes", async () => {
    const exact = await createSizedReadyV2Result(MAX_DAILY_PLAN_PREVIEW_RESPONSE_BYTES);
    const oversized = await createSizedReadyV2Result(
      MAX_DAILY_PLAN_PREVIEW_RESPONSE_BYTES + 1,
    );
    const exactApp = createApp({
      sampleWorksheetService,
      dailyPlanPreviewService: unavailableV1Service,
      dailyPlanPreviewServiceV2: {
        async createPreview() {
          return exact;
        },
      },
    });
    const oversizedApp = createApp({
      sampleWorksheetService,
      dailyPlanPreviewService: unavailableV1Service,
      dailyPlanPreviewServiceV2: {
        async createPreview() {
          return oversized;
        },
      },
    });

    const exactResponse = await exactApp.request(previewRequest(requestV2));
    expect(exactResponse.status).toBe(200);
    expectPrivateJsonHeaders(exactResponse);
    expect(new TextEncoder().encode(await exactResponse.text())).toHaveLength(
      MAX_DAILY_PLAN_PREVIEW_RESPONSE_BYTES,
    );

    const oversizedResponse = await oversizedApp.request(previewRequest(requestV2));
    expect(oversizedResponse.status).toBe(500);
    expectPrivateJsonHeaders(oversizedResponse);
    expect(await oversizedResponse.json()).toEqual({
      code: "internal_error",
      message: "The preview could not be prepared.",
    });
  });
});

async function createSizedReadyV2Result(
  targetBytes: number,
): Promise<DailyPlanPreviewServiceResultV2> {
  const result = await createDailyPlanPreviewServiceV2().createPreview(requestV2);
  if (result.status !== "ready") {
    throw new Error("Expected the pinned V2 preview to be ready");
  }
  const mutable = structuredClone(result.response) as unknown as {
    worksheet: {
      presentation: {
        lesson: {
          paragraphs: string[];
        };
      };
    };
  };
  const paragraphs = ["x"];
  mutable.worksheet.presentation.lesson.paragraphs = paragraphs;

  let response: DailyPlanPreviewResponseV2 =
    validateDailyPlanPreviewResponseV2(mutable);
  let measuredBytes = measureJsonBytes(response);
  while (measuredBytes < targetBytes) {
    const lastIndex = paragraphs.length - 1;
    const last = paragraphs[lastIndex]!;
    const capacity = 20_000 - last.length;
    if (capacity === 0) {
      if (paragraphs.length >= 8) {
        throw new Error("Could not construct a schema-valid sized V2 response");
      }
      paragraphs.push("x");
    } else {
      paragraphs[lastIndex] = `${last}${"x".repeat(
        Math.min(capacity, targetBytes - measuredBytes),
      )}`;
    }
    response = validateDailyPlanPreviewResponseV2(mutable);
    measuredBytes = measureJsonBytes(response);
  }
  if (measuredBytes !== targetBytes) {
    throw new Error(
      `Sized V2 response measured ${String(measuredBytes)}, expected ${String(targetBytes)}`,
    );
  }
  return { status: "ready", response };
}

function measureJsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
