import { z } from "zod";

import { HttpUrlSchema } from "./common.js";

/**
 * Browser-safe attribution schema shared by the historical V1 worksheet lane
 * and presentation contracts. Keep this leaf independent of worksheet and
 * presentation modules so either lane can be rolled back in isolation.
 */
export const AttributionV1Schema = z.strictObject({
  title: z.string().min(1).max(240),
  author: z.string().min(1).max(240),
  sourceUrl: HttpUrlSchema,
  licenseId: z.string().min(1).max(160),
  attributionText: z.string().min(1).max(1_000),
  publicationStatus: z.enum(["draft", "published"]),
  modifications: z.array(z.string().min(1).max(500)).max(50),
});

export type AttributionV1 = z.infer<typeof AttributionV1Schema>;
