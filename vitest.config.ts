import { defineConfig } from "vitest/config";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    alias: {
      // vite-plugin-pwa 가상 모듈 — 테스트에서는 vi.mock으로 대체하지만 vite import-analysis가 먼저 해석해야 함
      "virtual:pwa-register/react": require.resolve("vite-plugin-pwa/dist/client/build/react.js"),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify("test"),
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    pool: "forks",
    forks: { singleFork: true, maxForks: 1, minForks: 1 },
    fileParallelism: false,
  },
});
