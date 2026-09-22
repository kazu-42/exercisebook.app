import { parseStrictJson } from "./strict-json.js";

export class BoundedJsonResponseError extends TypeError {
  override readonly name = "BoundedJsonResponseError";
}

/**
 * Maximum non-final `reader.read()` results accepted for one response. Empty
 * chunks count, so a tiny or zero-byte chunk stream cannot consume unbounded
 * CPU or grow the chunk list while remaining under the byte cap.
 */
export const MAX_BOUNDED_JSON_RESPONSE_READS = 1_024;

export type BoundedStrictJsonResponseOptions = Readonly<{
  maximumBytes: number;
  maximumValues?: number;
  signal: AbortSignal;
}>;

export function cancelResponseBodyBestEffort(
  response: Response,
  reason: unknown,
): void {
  cancelStream(response.body, reason);
}

/**
 * Read one JSON response without allowing Fetch's convenience decoders to
 * allocate an unbounded body or silently resolve duplicate object keys.
 *
 * Content-Length is only an early rejection hint. The delivered byte stream is
 * always measured because intermediaries can omit or under-declare the header,
 * and Fetch may expose decompressed bytes whose length differs from the header.
 */
export async function readBoundedStrictJsonResponse(
  response: Response,
  options: BoundedStrictJsonResponseOptions,
): Promise<unknown> {
  const { maximumBytes, signal } = options;
  throwIfAbortedAndCancel(response.body, signal);
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new RangeError("maximumBytes must be a positive safe integer.");
  }

  if (readMediaType(response.headers.get("Content-Type")) !== "application/json") {
    rejectResponse(response, "Expected an application/json response media type.");
  }

  const declaredLength = response.headers.get("Content-Length");
  if (declaredLength !== null) {
    const normalized = declaredLength.trim();
    if (!/^(?:0|[1-9][0-9]*)$/u.test(normalized)) {
      rejectResponse(response, "Response Content-Length is invalid.");
    }
    if (decimalExceeds(normalized, maximumBytes)) {
      rejectResponse(response, "Response declared byte length exceeds its limit.");
    }
  }

  const bytes = await readBoundedBytes(response.body, maximumBytes, signal);
  throwIfAborted(signal);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return parseStrictJson(source, options);
}

function readMediaType(contentType: string | null): string | undefined {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase();
}

function decimalExceeds(source: string, limit: number): boolean {
  const renderedLimit = String(limit);
  return (
    source.length > renderedLimit.length ||
    (source.length === renderedLimit.length && source > renderedLimit)
  );
}

async function readBoundedBytes(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (body === null) {
    return new Uint8Array();
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let measuredBytes = 0;
  let nonFinalReads = 0;
  const abortRead = (): void => {
    cancelReader(reader, signal.reason);
  };
  signal.addEventListener("abort", abortRead, { once: true });

  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (signal.aborted) {
          throw signal.reason;
        }
        throw error;
      }
      throwIfAborted(signal);
      if (chunk.done) {
        break;
      }

      nonFinalReads += 1;
      if (nonFinalReads > MAX_BOUNDED_JSON_RESPONSE_READS) {
        rejectReader(reader, "Response body exceeds its read limit.");
      }

      const value: unknown = chunk.value;
      if (!(value instanceof Uint8Array)) {
        rejectReader(reader, "Response body chunks must be Uint8Array values.");
      }

      measuredBytes += value.byteLength;
      if (measuredBytes > maximumBytes) {
        rejectReader(reader, "Response body exceeds its byte limit.");
      }
      if (value.byteLength > 0) {
        chunks.push(value);
      }
    }
  } finally {
    signal.removeEventListener("abort", abortRead);
    releaseReaderLock(reader);
  }

  const bytes = new Uint8Array(measuredBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: unknown,
): void {
  try {
    void reader.cancel(reason).catch(() => undefined);
  } catch {
    // Cleanup is best effort and must never replace the primary failure.
  }
}

function cancelStream(body: ReadableStream<Uint8Array> | null, reason: unknown): void {
  if (body !== null) {
    try {
      void body.cancel(reason).catch(() => undefined);
    } catch {
      // A locked or hostile stream cannot replace the primary failure.
    }
  }
}

function releaseReaderLock(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    reader.releaseLock();
  } catch {
    // Cleanup is best effort and must never replace the primary failure.
  }
}

function rejectReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  message: string,
): never {
  const error = new BoundedJsonResponseError(message);
  cancelReader(reader, error);
  throw error;
}

function rejectResponse(response: Response, message: string): never {
  const error = new BoundedJsonResponseError(message);
  cancelStream(response.body, error);
  throw error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason;
  }
}

function throwIfAbortedAndCancel(
  body: ReadableStream<Uint8Array> | null,
  signal: AbortSignal,
): void {
  if (signal.aborted) {
    cancelStream(body, signal.reason);
    throw signal.reason;
  }
}
