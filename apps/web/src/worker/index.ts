import { createApp } from "./app.js";
import { dailyPlanPreviewService } from "./daily-plan-preview-service.js";
import { dailyPlanPreviewServiceV2 } from "./daily-plan-preview-service-v2.js";
import { generatorSampleService } from "./generator-sample-service.js";

const app = createApp({
  sampleWorksheetService: generatorSampleService,
  dailyPlanPreviewService,
  dailyPlanPreviewServiceV2,
});

export default app;
