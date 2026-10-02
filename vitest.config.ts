import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: the TanStack Start / Nitro plugins are not needed in unit tests.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 90_000 },
});
