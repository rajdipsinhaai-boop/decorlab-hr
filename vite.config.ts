import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // Vite 8 resolves tsconfig "paths" (the "@/" alias) natively; the old plugin failed in dev.
  resolve: { tsconfigPaths: true },
  plugins: [
    ...tanstackStart(),
    // Finalizing a month and importing an attendance report run the job worker inline for up to
    // 40-45s; the platform default would kill the request first.
    nitro({ preset: "vercel", vercel: { functions: { maxDuration: 60 } } }),
    tailwindcss(),
    react(),
  ],
});
