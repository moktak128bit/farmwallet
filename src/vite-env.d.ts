/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  /** "1" = GAS 웹앱용 단일 HTML 빌드(scripts/build-gas.mjs) — 워커·PWA 없음 */
  readonly VITE_GAS_BUILD?: string;
}
