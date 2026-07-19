import type { WebWorksheet, WebWorksheetVariant } from "@exercisebook/web-renderer";

export type SampleWorksheetRequest = Readonly<{
  seed: string;
  variant: WebWorksheetVariant;
}>;

export interface SampleWorksheetService {
  getSample(request: SampleWorksheetRequest): Promise<WebWorksheet>;
}
