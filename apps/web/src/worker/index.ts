import { createApp } from "./app.js";
import { dailyPlanPreviewService } from "./daily-plan-preview-service.js";

const app = createApp({
  dailyPlanPreviewService,
  allowDevelopmentAssets: import.meta.env.DEV,
});

export default app;
