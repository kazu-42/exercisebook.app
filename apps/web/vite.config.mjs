import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { clientModuleProvenance } from "./scripts/client-module-provenance.ts";

export default defineConfig({
  plugins: [react(), clientModuleProvenance(), cloudflare()],
  build: {
    sourcemap: false,
    target: "es2024",
  },
});
