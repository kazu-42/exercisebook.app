import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4178,
    strictPort: true,
    fs: {
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem}",
        "**/.git/**",
        "**/server/**",
        "**/scripts/**",
        "**/worker/**",
        "**/.release/**",
        "**/.release-build-*/**",
      ],
    },
  },
  preview: { host: "127.0.0.1", port: 4178, strictPort: true },
});
