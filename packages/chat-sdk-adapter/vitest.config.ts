import { defineConfig } from "vitest/config";

export default defineConfig({
  // Pin an inline (empty) PostCSS config so Vite does not walk up the
  // filesystem and pick up an unrelated postcss config from a parent directory.
  css: { postcss: { plugins: [] } },
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
