import { describe, expect, it } from "vitest";

import {
  createXoshiro128ss,
  deriveSlotSeed,
  initializeXoshiro128ssStateV1,
  validateSeed256,
  XOSHIRO128SS_V1,
} from "./rng.js";

const ZERO_SEED = "0".repeat(64);
const FF_SEED = "f".repeat(64);

describe(XOSHIRO128SS_V1, () => {
  it("rejects any seed that is not exactly 64 lowercase hex characters", () => {
    expect(() => validateSeed256("0".repeat(63))).toThrow();
    expect(() => validateSeed256("A".repeat(64))).toThrow();
    expect(() => validateSeed256(new String(ZERO_SEED) as unknown as string)).toThrow();
    expect(validateSeed256(ZERO_SEED)).toBe(ZERO_SEED);
  });

  it("freezes the custom seed-expansion reference vectors", () => {
    expect(initializeXoshiro128ssStateV1(ZERO_SEED)).toEqual([
      3_998_325_653, 1_233_102_409, 1_166_978_463, 2_566_542_581,
    ]);
    expect(initializeXoshiro128ssStateV1(FF_SEED)).toEqual([
      2_990_597_607, 222_769_137, 832_746_839, 2_946_293_579,
    ]);
    const distinctWords =
      "0000000100000002000000030000000400000005000000060000000700000008";
    expect(initializeXoshiro128ssStateV1(distinctWords)).toEqual([
      1_493_323_359, 1_596_209_297, 967_882_612, 2_322_470_581,
    ]);
    expect(
      initializeXoshiro128ssStateV1(
        "0000000100000002000000030000000400000005000000060000000700000009",
      ),
    ).toEqual([1_493_323_359, 1_596_209_297, 967_882_612, 1_108_061_467]);
  });

  it("freezes the zero-like seed vector", () => {
    const random = createXoshiro128ss(ZERO_SEED);
    expect(Array.from({ length: 8 }, () => random.nextUint32())).toEqual([
      3_088_936_047, 481_158_502, 3_585_405_720, 123_274_019, 1_655_903_699,
      4_112_497_837, 618_897_847, 2_462_657,
    ]);
  });

  it("freezes the all-f boundary seed vector and does not collapse to zero", () => {
    const random = createXoshiro128ss(FF_SEED);
    const values = Array.from({ length: 8 }, () => random.nextUint32());
    expect(values).not.toEqual(Array.from({ length: 8 }, () => 0));
    expect(values).toEqual([
      3_249_975_209, 2_343_516_676, 378_216_944, 903_060_030, 1_144_521_960,
      1_922_757_320, 2_914_714_205, 2_933_789_031,
    ]);
  });

  it("matches the frozen canonical-JSON HMAC-SHA256 slot-seed vector", async () => {
    const first = await deriveSlotSeed({
      baseSeed: ZERO_SEED,
      generatorId: "fractions.add",
      generatorVersion: "1",
      slotId: "practice-01",
    });
    const repeated = await deriveSlotSeed({
      baseSeed: ZERO_SEED,
      generatorId: "fractions.add",
      generatorVersion: "1",
      slotId: "practice-01",
    });
    const otherSlot = await deriveSlotSeed({
      baseSeed: ZERO_SEED,
      generatorId: "fractions.add",
      generatorVersion: "1",
      slotId: "practice-02",
    });

    expect(first).toBe(
      "b849d50bac62b44de273147f2045b228afdbe8494085ab0b9f6829bd4d048a9e",
    );
    expect(first).toBe(repeated);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(otherSlot);
  });

  it("uses unambiguous canonical tuple encoding for delimiter and Unicode text", async () => {
    const seed = "0123456789abcdef".repeat(4);
    const withDelimiter = await deriveSlotSeed({
      baseSeed: seed,
      generatorId: "fractions.add\u0000β",
      generatorVersion: "v:1",
      slotId: "practice/一",
    });
    const shiftedDelimiter = await deriveSlotSeed({
      baseSeed: seed,
      generatorId: "fractions.add",
      generatorVersion: "\u0000βv:1",
      slotId: "practice/一",
    });

    expect(withDelimiter).toBe(
      "9bcc3c050a481849714e0d92803ce92a35af7abb27408af46f990c730979e2ae",
    );
    expect(withDelimiter).not.toBe(shiftedDelimiter);
  });

  it("rejects empty, oversized, and invalid-Unicode derivation fields", async () => {
    await expect(
      deriveSlotSeed({
        baseSeed: ZERO_SEED,
        generatorId: "",
        generatorVersion: "1",
        slotId: "practice-01",
      }),
    ).rejects.toThrow("1 to 160");
    await expect(
      deriveSlotSeed({
        baseSeed: ZERO_SEED,
        generatorId: "fractions.add",
        generatorVersion: "v".repeat(161),
        slotId: "practice-01",
      }),
    ).rejects.toThrow("1 to 160");
    await expect(
      deriveSlotSeed({
        baseSeed: ZERO_SEED,
        generatorId: "fractions.add",
        generatorVersion: "1",
        slotId: "\ud800",
      }),
    ).rejects.toThrow("surrogate");
    await expect(
      deriveSlotSeed({
        baseSeed: ZERO_SEED,
        generatorId: ["fractions.add"] as unknown as string,
        generatorVersion: "1",
        slotId: "practice-01",
      }),
    ).rejects.toThrow("generatorId");
    await expect(
      deriveSlotSeed({
        baseSeed: new String(ZERO_SEED) as unknown as string,
        generatorId: "fractions.add",
        generatorVersion: "1",
        slotId: "practice-01",
      }),
    ).rejects.toThrow("seed");
  });

  it("returns bounded integers with a fixed rejection limit", () => {
    const random = createXoshiro128ss(FF_SEED);
    const { nextInt } = random;
    for (let index = 0; index < 1_000; index += 1) {
      const value = nextInt(3, 17);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThan(17);
    }
    expect(() => random.nextInt(1, 1)).toThrow();
  });
});
