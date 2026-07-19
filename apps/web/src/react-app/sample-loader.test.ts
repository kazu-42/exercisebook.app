import { afterEach, describe, expect, it, vi } from "vitest";

import { studentWorksheetFixture } from "@exercisebook/web-renderer/fixtures";

import { loadSampleFromApi } from "./sample-loader.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sample worksheet loader", () => {
  it("returns a strictly validated student worksheet", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(studentWorksheetFixture, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadSampleFromApi("student")).resolves.toEqual(
      studentWorksheetFixture,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/worksheets/sample?variant=student",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
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

    await expect(loadSampleFromApi("student")).rejects.toThrow(
      "Sample worksheet response did not match its projection.",
    );
  });

  it("rejects malformed JSON and non-success status responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 200 })),
    );
    await expect(loadSampleFromApi("student")).rejects.toThrow();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ code: "internal_error" }, { status: 500 })),
    );
    await expect(loadSampleFromApi("student")).rejects.toThrow(
      "Sample worksheet request failed: 500",
    );
  });
});
