import { describe, expect, it } from "vitest";

import {
  AttributionV1Schema as PackageAttributionV1Schema,
  type AttributionV1,
} from "@exercisebook/schemas/attribution-v1";

import { AttributionV1Schema as RootAttributionV1Schema } from "./index.js";
import { AttributionV1Schema as LeafAttributionV1Schema } from "./attribution-v1.js";
import { AttributionV1Schema as PresentationAttributionV1Schema } from "./presentation-contract-v1.js";
import { AttributionV1Schema as WorksheetAttributionV1Schema } from "./worksheet-instance-v1.js";

const validAttribution = {
  title: "Adding fractions with unlike denominators",
  author: "Exercise Book",
  sourceUrl: "https://exercisebook.app/content/fractions",
  licenseId: "LicenseRef-ExerciseBook",
  attributionText: "Created for Exercise Book.",
  publicationStatus: "draft",
  modifications: [],
} as const satisfies AttributionV1;

describe("AttributionV1 browser-safe leaf contract", () => {
  it("preserves one runtime schema identity through every public V1 route", () => {
    expect(PackageAttributionV1Schema).toBe(LeafAttributionV1Schema);
    expect(PresentationAttributionV1Schema).toBe(LeafAttributionV1Schema);
    expect(WorksheetAttributionV1Schema).toBe(LeafAttributionV1Schema);
    expect(RootAttributionV1Schema).toBe(LeafAttributionV1Schema);
  });

  it("retains the strict attribution validation behavior", () => {
    expect(LeafAttributionV1Schema.parse(validAttribution)).toEqual(validAttribution);
    expect(
      LeafAttributionV1Schema.safeParse({
        ...validAttribution,
        sourceUrl: "javascript:alert(1)",
      }).success,
    ).toBe(false);
    expect(
      LeafAttributionV1Schema.safeParse({
        ...validAttribution,
        answer: "5/6",
      }).success,
    ).toBe(false);
  });
});
