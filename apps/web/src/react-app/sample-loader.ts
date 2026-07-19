import type { WebWorksheet, WebWorksheetVariant } from "@exercisebook/web-renderer";

export type SampleLoader = (variant: WebWorksheetVariant) => Promise<WebWorksheet>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasSafeWorksheetShape(
  value: unknown,
  variant: WebWorksheetVariant,
): value is WebWorksheet {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "web-worksheet.v1" ||
    value.variant !== variant ||
    typeof value.instanceHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.instanceHash) ||
    !Array.isArray(value.items)
  ) {
    return false;
  }

  return value.items.every((item) => {
    if (!isRecord(item)) {
      return false;
    }

    if (variant === "student") {
      return !("answer" in item) && !("solution" in item);
    }

    return isRecord(item.answer) && Array.isArray(item.solution);
  });
}

export async function loadSampleFromApi(
  variant: WebWorksheetVariant,
): Promise<WebWorksheet> {
  const response = await fetch(
    `/api/worksheets/sample?variant=${encodeURIComponent(variant)}`,
    {
      headers: {
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Sample worksheet request failed: ${response.status}`);
  }

  const payload: unknown = await response.json();
  if (!hasSafeWorksheetShape(payload, variant)) {
    throw new Error("Sample worksheet response did not match its projection.");
  }

  return payload;
}
