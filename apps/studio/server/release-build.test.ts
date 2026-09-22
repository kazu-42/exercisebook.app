import { describe, expect, it } from "vitest";
import { computeWorkbookHash } from "./release-contract";
import { materializeWorkbooks, releaseIdFor } from "./release-build";

describe("immutable Japanese release materialization", () => {
  it("freezes all 18 conditions and replays the exact same semantic instances", async () => {
    const first = await materializeWorkbooks(["a".repeat(64), "b".repeat(64)]);
    expect(await materializeWorkbooks(["b".repeat(64), "a".repeat(64)])).toEqual(first);
    expect(first).toHaveLength(18);
    expect(new Set(first.map((entry) => entry.workbook.id)).size).toBe(18);
    for (const entry of first) {
      const { id, instanceHash, ...semantic } = entry.workbook;
      expect(id).toBe("studio-" + instanceHash);
      expect(instanceHash).toBe(
        await computeWorkbookHash(semantic, entry.answers, entry.contentSourceHashes),
      );
      expect(entry.answers.map((answer) => answer.id)).toEqual(
        entry.workbook.items.map((item) => item.id),
      );
      expect(entry.workbook).not.toHaveProperty("answers");
      expect(entry.workbook).toMatchObject({
        saved: false,
        schemaVersion: "studio-workbook-v1",
      });
    }
  });

  it("binds answer, reasoning, and source revision to identity", async () => {
    const [entry] = await materializeWorkbooks(["a".repeat(64)]);
    if (!entry) throw new Error("Missing fixture");
    const { id: _id, instanceHash, ...semantic } = entry.workbook;
    const altered = structuredClone(entry.answers);
    altered[0]!.answer = "999";
    expect(
      await computeWorkbookHash(semantic, altered, entry.contentSourceHashes),
    ).not.toBe(instanceHash);
    const changedTrace = structuredClone(entry.answers);
    changedTrace[0]!.steps[0]!.reason = "Altered mathematical justification";
    expect(
      await computeWorkbookHash(semantic, changedTrace, entry.contentSourceHashes),
    ).not.toBe(instanceHash);
    const [newSource] = await materializeWorkbooks(["b".repeat(64)]);
    expect(newSource?.workbook.id).not.toBe(entry.workbook.id);
  });

  it("canonicalizes manifest fields but retains order-sensitive content", async () => {
    expect(await releaseIdFor({ a: 1, b: [2, 3] })).toBe(
      await releaseIdFor({ b: [2, 3], a: 1 }),
    );
    expect(await releaseIdFor({ a: 1, b: [2, 3] })).not.toBe(
      await releaseIdFor({ a: 1, b: [3, 2] }),
    );
  });

  it("rejects unknown, absent, and duplicate source identities", async () => {
    for (const hashes of [[], ["draft"], ["a".repeat(64), "a".repeat(64)]])
      await expect(materializeWorkbooks(hashes)).rejects.toThrow("source hashes");
  });
});
