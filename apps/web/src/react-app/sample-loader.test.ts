import { afterEach, describe, expect, it, vi } from "vitest";

import { studentWorksheetFixture } from "@exercisebook/web-renderer/fixtures";

import {
  MAX_SAMPLE_WORKSHEET_RESPONSE_BYTES,
  SAMPLE_WORKSHEET_TIMEOUT_MS,
  loadSampleFromApi,
} from "./sample-loader.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function loadStudent(signal = new AbortController().signal) {
  return loadSampleFromApi("student", signal);
}

describe("sample worksheet loader", () => {
  it("returns a strictly validated student worksheet", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(studentWorksheetFixture, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadStudent()).resolves.toEqual(studentWorksheetFixture);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/worksheets/sample?variant=student",
      expect.objectContaining({
        headers: { Accept: "application/json" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    ["unknown top-level field", { ...studentWorksheetFixture, extra: true }],
    [
      "nested protected field",
      {
        ...studentWorksheetFixture,
        items: studentWorksheetFixture.items.map((item, index) =>
          index === 0 ? { ...item, slotSeed: "a".repeat(64) } : item,
        ),
      },
    ],
    [
      "missing required collection",
      Object.fromEntries(
        Object.entries(studentWorksheetFixture).filter(
          ([key]) => key !== "attributions",
        ),
      ),
    ],
  ])("rejects a 200 response with %s", async (_label, payload) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(payload, { status: 200 })),
    );

    await expect(loadStudent()).rejects.toThrow(
      "Sample worksheet response did not match its projection.",
    );
  });

  it("rejects malformed JSON and non-success status responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 200 })),
    );
    await expect(loadStudent()).rejects.toThrow();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ code: "internal_error" }, { status: 500 })),
    );
    await expect(loadStudent()).rejects.toThrow("Sample worksheet request failed: 500");
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
            status: 500,
          }),
      ),
    );

    await expect(loadStudent()).rejects.toThrow("Sample worksheet request failed: 500");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects wrong media, duplicate keys, malformed UTF-8, and oversized bodies", async () => {
    const validJson = JSON.stringify(studentWorksheetFixture);
    const duplicateJson = validJson.replace(
      '"schemaVersion":',
      '"schemaVersion":"web-worksheet.v1","schemaVersion":',
    );
    const responses = [
      new Response(validJson, { headers: { "Content-Type": "text/plain" } }),
      new Response(duplicateJson, {
        headers: { "Content-Type": "application/json" },
      }),
      new Response(new Uint8Array([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d]), {
        headers: { "Content-Type": "application/json" },
      }),
      new Response("{}", {
        headers: {
          "Content-Length": String(MAX_SAMPLE_WORKSHEET_RESPONSE_BYTES + 1),
          "Content-Type": "application/json",
        },
      }),
      new Response(validJson.padEnd(MAX_SAMPLE_WORKSHEET_RESPONSE_BYTES + 1), {
        headers: { "Content-Type": "application/json" },
      }),
    ];

    for (const response of responses) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response),
      );
      await expect(loadStudent()).rejects.toThrow(
        "Sample worksheet response did not match its projection.",
      );
    }
  });

  it("sanitizes a successful response whose body was already disturbed", async () => {
    const response = new Response(JSON.stringify(studentWorksheetFixture), {
      headers: { "Content-Type": "application/json" },
    });
    const reader = response.body!.getReader();
    while (!(await reader.read()).done) {
      // Deliberately consume the producer body before the loader receives it.
    }
    reader.releaseLock();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );

    await expect(loadStudent()).rejects.toThrow(
      "Sample worksheet response did not match its projection.",
    );
  });

  it("preserves caller abort identity while the response body is pending", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reason = new DOMException("Sample replaced.", "AbortError");
    const cancel = vi.fn();
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return new Response(new ReadableStream<Uint8Array>({ cancel }), {
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const pending = loadStudent(controller.signal);
    const rejected = expect(pending).rejects.toBe(reason);
    await Promise.resolve();
    controller.abort(reason);

    await rejected;
    expect(requestSignal?.reason).toBe(reason);
    expect(cancel).toHaveBeenCalledWith(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves caller abort when it races a resolved non-success response", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Sample replaced.", "AbortError");
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        controller.abort(reason);
        return new Response(new ReadableStream<Uint8Array>({ cancel }), {
          status: 500,
        });
      }),
    );

    await expect(loadStudent(controller.signal)).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledWith(reason);
  });

  it("times out a pending response body without relabeling the timeout", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return new Response(new ReadableStream<Uint8Array>({ cancel }), {
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const pending = loadStudent();
    const rejection = pending.then(
      () => undefined,
      (error: unknown) => error,
    );
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(SAMPLE_WORKSHEET_TIMEOUT_MS);

    const error = await rejection;
    expect(error).toBe(requestSignal?.reason);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Sample worksheet request timed out.");
    expect(cancel).toHaveBeenCalledWith(error);
    expect(vi.getTimerCount()).toBe(0);
  });
});
