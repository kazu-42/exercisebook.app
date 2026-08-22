import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/**/*.{test,spec}.{ts,tsx}", "src/**/*.{test,spec}.{ts,tsx}"],
    passWithNoTests: false,
  },
});
