import { afterEach, describe, expect, it, vi } from "vitest";

import { createDailyPlanPreviewResponseFixture } from "./daily-plan-preview.test-fixture.js";
import {
  MAX_DAILY_PLAN_PREVIEW_RESPONSE_BYTES,
  DAILY_PLAN_PREVIEW_TIMEOUT_MS,
  DAILY_PLAN_PREVIEW_REQUEST_V1_SCHEMA,
  loadDailyPlanPreviewFromApi,
  type DailyPlanPreviewRequestV1,
} from "./daily-plan-preview-loader.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const request: DailyPlanPreviewRequestV1 = {
  schema: DAILY_PLAN_PREVIEW_REQUEST_V1_SCHEMA,
  goalId: "math.fractions.add-unlike",
  practiceMinutes: 8,
  localStudyDate: "2026-07-19",
  timeZone: "Asia/Tokyo",
  locale: "en",
};

function createPendingJsonResponse(): {
  bodyReadStarted: Promise<void>;
  cancel: ReturnType<typeof vi.fn>;
  response: Response;
} {
  let markBodyReadStarted: (() => void) | undefined;
  const bodyReadStarted = new Promise<void>((resolve) => {
    markBodyReadStarted = resolve;
  });
  const cancel = vi.fn();
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull() {
        markBodyReadStarted?.();
        return new Promise<void>(() => undefined);
      },
      cancel,
    }),
    { headers: { "Content-Type": "application/json" } },
  );

  return { bodyReadStarted, cancel, response };
}

describe("daily plan preview loader", () => {
  it("posts the explicit request and returns only a validated response", async () => {
    const response = createDailyPlanPreviewResponseFixture(8);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(response),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(
      loadDailyPlanPreviewFromApi(request, controller.signal),
    ).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/plans/preview", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: expect.any(AbortSignal),
    });
    const fetchSignal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(fetchSignal).not.toBe(controller.signal);
    expect(fetchSignal?.aborted).toBe(false);
  });

  it("fails closed when a successful response contains protected nested data", async () => {
    const response = structuredClone(
      createDailyPlanPreviewResponseFixture(8),
    ) as unknown as Record<string, unknown>;
    const worksheet = response.worksheet as Record<string, unknown>;
    const items = worksheet.items as Record<string, unknown>[];
    items[0]!.slotSeed = "c".repeat(64);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(response)),
    );

    await expect(
      loadDailyPlanPreviewFromApi(request, new AbortController().signal),
    ).rejects.toThrow("Daily plan preview response was invalid.");
  });

  it("rejects malformed JSON and non-success responses without echoing request data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not-json", { status: 200 })),
    );
    await expect(
      loadDailyPlanPreviewFromApi(request, new AbortController().signal),
    ).rejects.toThrow("Daily plan preview response was invalid.");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ code: "preview_unavailable" }, { status: 503 }),
      ),
    );
    await expect(
      loadDailyPlanPreviewFromApi(request, new AbortController().signal),
    ).rejects.toThrow("Daily plan preview request failed: 503");
  });

  it("cancels a non-success response without letting cancel failure shadow status", async () => {
    const cancel = vi.fn(() => {
      throw new Error("cancel failed");
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new ReadableStream<Uint8Array>({ cancel }), {
            status: 503,
          }),
      ),
    );

    await expect(
      loadDailyPlanPreviewFromApi(request, new AbortController().signal),
    ).rejects.toThrow("Daily plan preview request failed: 503");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each(["text/plain", "application/jsonp", "application/json-evil"])(
    "rejects a successful body delivered with media type %s",
    async (contentType) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify(createDailyPlanPreviewResponseFixture(8)), {
              status: 200,
              headers: { "Content-Type": contentType },
            }),
        ),
      );

      await expect(
        loadDailyPlanPreviewFromApi(request, new AbortController().signal),
      ).rejects.toThrow("Daily plan preview response was invalid.");
    },
  );

  it("accepts the exact JSON media type with parameters", async () => {
    const response = createDailyPlanPreviewResponseFixture(8);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(response), {
            status: 200,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
            },
          }),
      ),
    );

    await expect(
      loadDailyPlanPreviewFromApi(request, new AbortController().signal),
    ).resolves.toEqual(response);
  });

  it("rejects duplicate response keys, malformed UTF-8, and oversized bodies", async () => {
    const validJson = JSON.stringify(createDailyPlanPreviewResponseFixture(8));
    const duplicateJson = validJson.replace(
      '"schema":',
      '"schema":"exercisebook.daily-plan-preview-response/v1","schema":',
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(duplicateJson, {
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    await expect(
      loadDailyPlanPreviewFromApi(request, new AbortController().signal),
    ).rejects.toThrow("Daily plan preview response was invalid.");

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d]), {
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    await expect(
      loadDailyPlanPreviewFromApi(request, new AbortController().signal),
    ).rejects.toThrow("Daily plan preview response was invalid.");

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", {
            headers: {
              "Content-Length": String(MAX_DAILY_PLAN_PREVIEW_RESPONSE_BYTES + 1),
              "Content-Type": "application/json",
            },
          }),
      ),
    );
    await expect(
      loadDailyPlanPreviewFromApi(request, new AbortController().signal),
    ).rejects.toThrow("Daily plan preview response was invalid.");

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(validJson.padEnd(MAX_DAILY_PLAN_PREVIEW_RESPONSE_BYTES + 1), {
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    await expect(
      loadDailyPlanPreviewFromApi(request, new AbortController().signal),
    ).rejects.toThrow("Daily plan preview response was invalid.");
  });

  it("sanitizes a successful response whose body is already locked", async () => {
    const response = new Response(
      JSON.stringify(createDailyPlanPreviewResponseFixture(8)),
      { headers: { "Content-Type": "application/json" } },
    );
    const reader = response.body!.getReader();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );

    await expect(
      loadDailyPlanPreviewFromApi(request, new AbortController().signal),
    ).rejects.toThrow("Daily plan preview response was invalid.");

    await reader.cancel();
    reader.releaseLock();
  });

  it("forwards caller abort to fetch without relabeling it as a timeout", async () => {
    vi.useFakeTimers();
    const callerController = new AbortController();
    const callerAbort = new DOMException("Preview replaced.", "AbortError");
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          requestSignal?.addEventListener(
            "abort",
            () => {
              reject(requestSignal?.reason);
            },
            { once: true },
          );
        });
      }),
    );

    const pending = loadDailyPlanPreviewFromApi(request, callerController.signal);
    const rejected = expect(pending).rejects.toBe(callerAbort);

    callerController.abort(callerAbort);

    await rejected;
    expect(requestSignal).toBeDefined();
    expect(requestSignal?.aborted).toBe(true);
    expect(requestSignal?.reason).toBe(callerAbort);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(DAILY_PLAN_PREVIEW_TIMEOUT_MS * 2);

    expect(requestSignal?.reason).toBe(callerAbort);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves caller abort when it races a resolved non-success response", async () => {
    const callerController = new AbortController();
    const callerAbort = new DOMException("Preview replaced.", "AbortError");
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callerController.abort(callerAbort);
        return new Response(new ReadableStream<Uint8Array>({ cancel }), {
          status: 503,
        });
      }),
    );

    await expect(
      loadDailyPlanPreviewFromApi(request, callerController.signal),
    ).rejects.toBe(callerAbort);
    expect(cancel).toHaveBeenCalledWith(callerAbort);
  });

  it("preserves caller abort while a successful response body is pending", async () => {
    vi.useFakeTimers();
    const callerController = new AbortController();
    const removeListener = vi.spyOn(callerController.signal, "removeEventListener");
    const callerAbort = new DOMException("Preview replaced.", "AbortError");
    let requestSignal: AbortSignal | undefined;
    const { bodyReadStarted, cancel, response } = createPendingJsonResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return response;
      }),
    );

    const pending = loadDailyPlanPreviewFromApi(request, callerController.signal);
    const rejected = expect(pending).rejects.toBe(callerAbort);
    await bodyReadStarted;

    callerController.abort(callerAbort);

    await rejected;
    expect(requestSignal?.aborted).toBe(true);
    expect(requestSignal?.reason).toBe(callerAbort);
    expect(cancel).toHaveBeenCalledWith(callerAbort);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(DAILY_PLAN_PREVIEW_TIMEOUT_MS * 2);

    expect(requestSignal?.reason).toBe(callerAbort);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves timeout identity while a successful response body is pending", async () => {
    vi.useFakeTimers();
    const callerController = new AbortController();
    const removeListener = vi.spyOn(callerController.signal, "removeEventListener");
    let requestSignal: AbortSignal | undefined;
    const { bodyReadStarted, cancel, response } = createPendingJsonResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return response;
      }),
    );

    const pending = loadDailyPlanPreviewFromApi(request, callerController.signal);
    const rejection = pending.then(
      () => undefined,
      (error: unknown) => error,
    );
    await bodyReadStarted;

    await vi.advanceTimersByTimeAsync(DAILY_PLAN_PREVIEW_TIMEOUT_MS);

    const error = await rejection;
    expect(error).toBe(requestSignal?.reason);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Daily plan preview request timed out.");
    expect(cancel).toHaveBeenCalledWith(error);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects an internally valid response for a different request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(createDailyPlanPreviewResponseFixture(20))),
    );

    await expect(
      loadDailyPlanPreviewFromApi(request, new AbortController().signal),
    ).rejects.toThrow("Daily plan preview response was invalid.");
  });

  it("aborts and rejects a preview request that exceeds the bounded timeout", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          requestSignal?.addEventListener(
            "abort",
            () => {
              reject(requestSignal?.reason);
            },
            { once: true },
          );
        });
      }),
    );

    const pending = loadDailyPlanPreviewFromApi(request, new AbortController().signal);
    const rejected = expect(pending).rejects.toThrow(
      "Daily plan preview request timed out.",
    );

    await vi.advanceTimersByTimeAsync(DAILY_PLAN_PREVIEW_TIMEOUT_MS);

    await rejected;
    expect(requestSignal?.aborted).toBe(true);
  });
});
