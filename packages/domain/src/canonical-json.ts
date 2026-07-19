export type JsonPrimitive = boolean | null | number | string;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

const textEncoder = new TextEncoder();

/**
 * Serializes the I-JSON data model with the RFC 8785 ordering and ECMAScript
 * number/string rules. Values outside that data model fail closed.
 */
export function canonicalizeJson(value: unknown): string {
  return serialize(value, "$");
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes: Uint8Array<ArrayBuffer> =
    typeof input === "string" ? textEncoder.encode(input) : new Uint8Array(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(
  key: Uint8Array,
  input: string | Uint8Array,
): Promise<string> {
  const keyBytes = new Uint8Array(key);
  const inputBytes: Uint8Array<ArrayBuffer> =
    typeof input === "string" ? textEncoder.encode(input) : new Uint8Array(input);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await globalThis.crypto.subtle.sign("HMAC", cryptoKey, inputBytes);
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function serialize(value: unknown, path: string): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return serializeNumber(value, path);
    case "string":
      assertValidUnicode(value, path);
      return JSON.stringify(value);
    case "object":
      return Array.isArray(value)
        ? serializeArray(value, path)
        : serializeObject(value, path);
    default:
      throw new TypeError(`Unsupported canonical JSON value at ${path}`);
  }
}

function serializeNumber(value: number, path: string): string {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Non-finite number at ${path}`);
  }
  if (Object.is(value, -0)) {
    return "0";
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError(`Unserializable number at ${path}`);
  }
  return serialized;
}

function serializeArray(value: readonly unknown[], path: string): string {
  assertNoSymbolKeys(value, path);
  const enumerableKeys = Object.keys(value);
  for (const key of enumerableKeys) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) {
      throw new TypeError(`Unexpected array property ${key} at ${path}`);
    }
  }

  const items: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError(`Sparse array entry at ${path}[${index}]`);
    }
    items.push(serialize(value[index], `${path}[${index}]`));
  }
  return `[${items.join(",")}]`;
}

function serializeObject(value: object, path: string): string {
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Non-plain object at ${path}`);
  }
  assertNoSymbolKeys(value, path);

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const fields = keys.map((key) => {
    assertValidUnicode(key, `${path} key`);
    const serializedKey = JSON.stringify(key);
    return `${serializedKey}:${serialize(record[key], `${path}.${key}`)}`;
  });
  return `{${fields.join(",")}}`;
}

function assertNoSymbolKeys(value: object, path: string): void {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`Symbol-keyed property at ${path}`);
  }
}

function assertValidUnicode(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) {
        throw new TypeError(`Lone high surrogate at ${path}`);
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError(`Lone low surrogate at ${path}`);
    }
  }
}
