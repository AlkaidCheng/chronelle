import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["infrastructure/test/**/*.test.mts"] },
});
