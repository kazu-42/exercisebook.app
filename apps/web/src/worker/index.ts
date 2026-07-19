import { createApp } from "./app.js";
import { dailyPlanPreviewService } from "./daily-plan-preview-service.js";
import { generatorSampleService } from "./generator-sample-service.js";

const app = createApp({
  sampleWorksheetService: generatorSampleService,
  dailyPlanPreviewService,
});

export default app;
