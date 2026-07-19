import { describe, expect, it, vi } from "vitest";

import {
  MAX_BOUNDED_JSON_RESPONSE_READS,
  readBoundedStrictJsonResponse,
} from "./bounded-json-response.js";

const encoder = new TextEncoder();

function jsonResponse(source: BodyInit | null, headers: HeadersInit = {}): Response {
  return new Response(source, {
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function repeatedChunkStream(
  chunk: Uint8Array,
  count: number,
  cancel: (reason?: unknown) => void,
): ReadableStream<Uint8Array> {
  let emitted = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted === count) {
        controller.close();
        return;
      }
      emitted += 1;
      controller.enqueue(chunk);
    },
    cancel,
  });
}

describe("readBoundedStrictJsonResponse", () => {
  it("reads an ordinary bounded response and permits JSON parameters", async () => {
    const controller = new AbortController();
    const source = '{"schema":"v1","items":[1,true,null]}';

    await expect(
      readBoundedStrictJsonResponse(
        jsonResponse(source, {
          "Content-Length": String(encoder.encode(source).byteLength),
          "Content-Type": "application/json; charset=utf-8",
        }),
        { maximumBytes: 1_024, signal: controller.signal },
      ),
    ).resolves.toEqual({ schema: "v1", items: [1, true, null] });
  });

  it("releases the body reader lock after a successful decode", async () => {
    const response = jsonResponse("{}");

    await expect(
      readBoundedStrictJsonResponse(response, {
        maximumBytes: 64,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({});

    expect(response.body?.locked).toBe(false);
    const reader = response.body?.getReader();
    reader?.releaseLock();
  });

  it("rejects a missing response body", async () => {
    await expect(
      readBoundedStrictJsonResponse(
        new Response(null, { headers: { "Content-Type": "application/json" } }),
        { maximumBytes: 64, signal: new AbortController().signal },
      ),
    ).rejects.toThrow("JSON input is empty");
  });

  it.each(["text/plain", "application/jsonp", "application/json-evil"])(
    "rejects media type %s",
    async (contentType) => {
      await expect(
        readBoundedStrictJsonResponse(
          new Response("{}", { headers: { "Content-Type": contentType } }),
          { maximumBytes: 32, signal: new AbortController().signal },
        ),
      ).rejects.toThrow("application/json");
    },
  );

  it.each([
    '{"schema":"v1","schema":"v2"}',
    '{"schema":"v1","\\u0073chema":"v2"}',
    '{"outer":{"id":1,"\\u0069d":2}}',
  ])("rejects duplicate object keys in %s", async (source) => {
    await expect(
      readBoundedStrictJsonResponse(jsonResponse(source), {
        maximumBytes: 1_024,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("Duplicate JSON object key");
  });

  it("rejects malformed JSON and malformed UTF-8", async () => {
    const signal = new AbortController().signal;

    await expect(
      readBoundedStrictJsonResponse(jsonResponse("{"), {
        maximumBytes: 32,
        signal,
      }),
    ).rejects.toThrow();
    await expect(
      readBoundedStrictJsonResponse(
        jsonResponse(new Uint8Array([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d])),
        { maximumBytes: 32, signal },
      ),
    ).rejects.toThrow();
  });

  it("accepts exactly the measured UTF-8 byte limit", async () => {
    const source = '{"value":"あ"}';
    const bytes = encoder.encode(source);

    await expect(
      readBoundedStrictJsonResponse(jsonResponse(bytes), {
        maximumBytes: bytes.byteLength,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ value: "あ" });
  });

  it("rejects a measured body one byte over the limit and cancels the stream", async () => {
    const bytes = encoder.encode('{"value":"あ"}');
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
      },
      cancel,
    });

    await expect(
      readBoundedStrictJsonResponse(jsonResponse(stream), {
        maximumBytes: bytes.byteLength - 1,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("byte limit");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["empty", new Uint8Array()],
    ["one-byte", encoder.encode(" ")],
  ] as const)(
    "bounds more than 1024 %s non-final reads even below the byte limit",
    async (_label, chunk) => {
      const cancel = vi.fn();
      const response = jsonResponse(
        repeatedChunkStream(chunk, MAX_BOUNDED_JSON_RESPONSE_READS + 1, cancel),
      );

      await expect(
        readBoundedStrictJsonResponse(response, {
          maximumBytes: MAX_BOUNDED_JSON_RESPONSE_READS + 2,
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow("read limit");
      expect(cancel).toHaveBeenCalledTimes(1);
    },
  );

  it("accepts exactly 1024 non-final reads when the final payload is valid", async () => {
    let emitted = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        emitted += 1;
        if (emitted < MAX_BOUNDED_JSON_RESPONSE_READS) {
          controller.enqueue(new Uint8Array());
          return;
        }
        if (emitted === MAX_BOUNDED_JSON_RESPONSE_READS) {
          controller.enqueue(encoder.encode("{}"));
          return;
        }
        controller.close();
      },
    });

    await expect(
      readBoundedStrictJsonResponse(jsonResponse(stream), {
        maximumBytes: 64,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({});
  });

  it("uses a declared length only as an early upper-bound hint", async () => {
    const source = '{"value":1}';
    const cancel = vi.fn();
    const oversizedStream = new ReadableStream<Uint8Array>({ cancel });

    await expect(
      readBoundedStrictJsonResponse(
        jsonResponse(oversizedStream, { "Content-Length": "65" }),
        { maximumBytes: 64, signal: new AbortController().signal },
      ),
    ).rejects.toThrow("declared byte length");
    expect(cancel).toHaveBeenCalledTimes(1);

    await expect(
      readBoundedStrictJsonResponse(
        jsonResponse("{}", { "Content-Length": "9".repeat(100) }),
        { maximumBytes: 64, signal: new AbortController().signal },
      ),
    ).rejects.toThrow("declared byte length");

    await expect(
      readBoundedStrictJsonResponse(jsonResponse(source, { "Content-Length": "2" }), {
        maximumBytes: 64,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ value: 1 });
  });

  it.each(["", "-1", "01", "1.5", "1, 1", "not-a-number"])(
    "rejects malformed Content-Length %j",
    async (contentLength) => {
      await expect(
        readBoundedStrictJsonResponse(
          jsonResponse("{}", { "Content-Length": contentLength }),
          { maximumBytes: 64, signal: new AbortController().signal },
        ),
      ).rejects.toThrow("Content-Length");
    },
  );

  it("still measures a falsely under-declared oversized response", async () => {
    const source = '{"value":"too large"}';

    await expect(
      readBoundedStrictJsonResponse(jsonResponse(source, { "Content-Length": "2" }), {
        maximumBytes: 16,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("byte limit");
  });

  it("preserves a caller abort reason before body access", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Request replaced.", "AbortError");
    const response = jsonResponse("{}");
    const cancelFailure = new Error("cancel failed");
    const cancel = vi.spyOn(response.body!, "cancel").mockImplementation(() => {
      throw cancelFailure;
    });
    controller.abort(reason);

    await expect(
      readBoundedStrictJsonResponse(response, {
        maximumBytes: 64,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledWith(reason);
  });

  it.each([
    ["missing media type", {}, "application/json"],
    ["wrong media type", { "Content-Type": "text/plain" }, "application/json"],
    [
      "malformed length",
      { "Content-Length": "broken", "Content-Type": "application/json" },
      "Content-Length",
    ],
    [
      "declared overflow",
      { "Content-Length": "65", "Content-Type": "application/json" },
      "declared byte length",
    ],
  ] as const)(
    "best-effort cancels %s without letting cancellation rejection shadow it",
    async (_label, headers, expectedMessage) => {
      const cancel = vi.fn(() => {
        throw new Error("cancel cleanup failed");
      });
      const response = new Response(new ReadableStream<Uint8Array>({ cancel }), {
        headers,
      });

      await expect(
        readBoundedStrictJsonResponse(response, {
          maximumBytes: 64,
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(expectedMessage);
      expect(cancel).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects and cancels a non-Uint8Array response chunk", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue("{}" as unknown as Uint8Array);
      },
      cancel,
    });

    await expect(
      readBoundedStrictJsonResponse(jsonResponse(stream), {
        maximumBytes: 64,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("Uint8Array");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("does not let cancel or releaseLock failures shadow the primary read error", async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const cancel = vi.fn(() => {
      throw new Error("cancel failed");
    });
    const releaseLock = vi.fn(() => {
      throw new Error("releaseLock failed");
    });
    const reader = {
      cancel,
      read: vi.fn(async () => ({ done: false, value: encoder.encode("{}") })),
      releaseLock,
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;
    const response = {
      body: {
        getReader: () => reader,
      },
      headers: new Headers({ "Content-Type": "application/json" }),
    } as unknown as Response;

    await expect(
      readBoundedStrictJsonResponse(response, {
        maximumBytes: 1,
        signal: controller.signal,
      }),
    ).rejects.toThrow("byte limit");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("cancels a pending body read and preserves the exact abort reason", async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const reason = new Error("Request timed out.");
    const cancel = vi.fn();
    const response = jsonResponse(new ReadableStream<Uint8Array>({ cancel }));

    const pending = readBoundedStrictJsonResponse(response, {
      maximumBytes: 64,
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toBe(reason);
    await Promise.resolve();

    controller.abort(reason);

    await rejected;
    expect(cancel).toHaveBeenCalledWith(reason);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
