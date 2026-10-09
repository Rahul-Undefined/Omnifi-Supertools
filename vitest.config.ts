import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: { provider: "v8", reporter: ["text"] },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Server modules import "server-only" which throws outside Next; stub it for unit tests.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});
