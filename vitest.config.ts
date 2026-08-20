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
    // 기본은 node(빠름). DOM/localStorage가 필요한 파일만 상단 `// @vitest-environment jsdom` 프라그마 사용.
    // jsdom 전역이면 환경 생성만 ~300초(테스트 자체 3.6초)라 CI에 넣을 수 없었다.
    environment: "node",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    pool: "forks",
    forks: { singleFork: true, maxForks: 1, minForks: 1 },
    fileParallelism: false,
  },
});
