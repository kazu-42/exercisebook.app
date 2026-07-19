import { canonicalizeJson, hmacSha256Hex } from "./canonical-json.js";

export const XOSHIRO128SS_V1 = "xoshiro128ss-v1";
export const SLOT_SEED_DOMAIN_V1 = "exercisebook/slot-seed/v1";

const UINT32_RANGE = 0x1_0000_0000;
const MAX_REJECTION_ATTEMPTS = 128;
const SEED_PATTERN = /^[0-9a-f]{64}$/;

export interface DeterministicRandom {
  nextUint32(): number;
  nextInt(minimumInclusive: number, maximumExclusive: number): number;
}

export interface SlotSeedInput {
  readonly baseSeed: string;
  readonly generatorId: string;
  readonly generatorVersion: string;
  readonly slotId: string;
}

export type Xoshiro128ssStateV1 = [number, number, number, number];

export class DeterministicRandomExhaustedError extends Error {
  override readonly name = "DeterministicRandomExhaustedError";
}

export function validateSeed256(value: string): string {
  if (typeof value !== "string" || !SEED_PATTERN.test(value)) {
    throw new TypeError("A seed must be exactly 64 lowercase hexadecimal characters");
  }
  return value;
}

export function createXoshiro128ss(seed: string): DeterministicRandom {
  const state = initializeXoshiro128ssStateV1(seed);

  const nextUint32 = (): number => {
    const result = Math.imul(rotateLeft(Math.imul(state[1] ?? 0, 5), 7), 9) >>> 0;
    const temporary = ((state[1] ?? 0) << 9) >>> 0;

    state[2] = ((state[2] ?? 0) ^ (state[0] ?? 0)) >>> 0;
    state[3] = ((state[3] ?? 0) ^ (state[1] ?? 0)) >>> 0;
    state[1] = ((state[1] ?? 0) ^ (state[2] ?? 0)) >>> 0;
    state[0] = ((state[0] ?? 0) ^ (state[3] ?? 0)) >>> 0;
    state[2] = ((state[2] ?? 0) ^ temporary) >>> 0;
    state[3] = rotateLeft(state[3] ?? 0, 11);

    return result;
  };

  const nextInt = (minimumInclusive: number, maximumExclusive: number): number => {
    assertSafeInteger(minimumInclusive, "minimumInclusive");
    assertSafeInteger(maximumExclusive, "maximumExclusive");
    const range = maximumExclusive - minimumInclusive;
    if (range <= 0 || range > UINT32_RANGE) {
      throw new RangeError("The integer range must be between 1 and 2^32");
    }

    const acceptedUpperBound = UINT32_RANGE - (UINT32_RANGE % range);
    for (let attempt = 0; attempt < MAX_REJECTION_ATTEMPTS; attempt += 1) {
      const candidate = nextUint32();
      if (candidate < acceptedUpperBound) {
        return minimumInclusive + (candidate % range);
      }
    }
    throw new DeterministicRandomExhaustedError(
      `Integer rejection sampling exceeded ${MAX_REJECTION_ATTEMPTS} attempts`,
    );
  };

  return {
    nextUint32,
    nextInt,
  };
}

export async function deriveSlotSeed(input: SlotSeedInput): Promise<string> {
  const { baseSeed, generatorId, generatorVersion, slotId } = input;
  validateSeed256(baseSeed);
  for (const [name, value] of [
    ["generatorId", generatorId],
    ["generatorVersion", generatorVersion],
    ["slotId", slotId],
  ] as const) {
    if (typeof value !== "string" || value.length === 0 || value.length > 160) {
      throw new TypeError(`${name} must contain from 1 to 160 UTF-16 code units`);
    }
  }

  return hmacSha256Hex(
    hexToBytes(baseSeed),
    canonicalizeJson([SLOT_SEED_DOMAIN_V1, generatorId, generatorVersion, slotId]),
  );
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function initializeXoshiro128ssStateV1(seed: string): Xoshiro128ssStateV1 {
  const validatedSeed = validateSeed256(seed);
  const words = Array.from({ length: 8 }, (_, index) =>
    Number.parseInt(validatedSeed.slice(index * 8, index * 8 + 8), 16),
  );
  const state: Xoshiro128ssStateV1 = [0x243f6a88, 0x85a308d3, 0x13198a2e, 0x03707344];

  for (let index = 0; index < words.length; index += 1) {
    const lane = index & 3;
    const prior = state[lane] ?? 0;
    const word = words[index] ?? 0;
    state[lane] = mix32((prior + word + Math.imul(index + 1, 0x9e3779b9)) >>> 0);
  }

  if ((state[0] | state[1] | state[2] | state[3]) === 0) {
    state[0] = 0x6d2b79f5;
  }
  return state;
}

function mix32(value: number): number {
  let mixed = value >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97) >>> 0;
  return (mixed ^ (mixed >>> 15)) >>> 0;
}

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function assertSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be a safe integer`);
  }
}
