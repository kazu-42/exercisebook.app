import {
  validateWebWorksheet,
  type WebWorksheet,
  type WebWorksheetVariant,
} from "@exercisebook/web-renderer";

export type SampleLoader = (variant: WebWorksheetVariant) => Promise<WebWorksheet>;

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
  try {
    return validateWebWorksheet(payload, variant);
  } catch {
    throw new Error("Sample worksheet response did not match its projection.");
  }
}
