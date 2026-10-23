import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    globals: true,
    setupFiles: ["../../apps/api/test/setup.ts"],
    include: ["convex/**/*.test.ts", "test/**/*.test.ts"],
    server: {
      deps: {
        inline: ["convex-test"],
      },
    },
  },
});
