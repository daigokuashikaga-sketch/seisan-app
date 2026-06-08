import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./src/api/__tests__/setup.ts"],
    include: ["src/**/*.test.ts"],
  },
})
