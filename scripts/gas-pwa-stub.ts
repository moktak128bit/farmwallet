// GAS 웹앱(HtmlService iframe)에는 서비스 워커·PWA 설치가 없다 — scripts/build-gas.mjs가
// "virtual:pwa-register/react"를 이 파일로 바꿔 끼운다.
export function useRegisterSW() {
  return {
    needRefresh: [false, () => {}] as const,
    offlineReady: [false, () => {}] as const,
    updateServiceWorker: async () => {}
  };
}
