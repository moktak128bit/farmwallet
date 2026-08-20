/**
 * vite-plugin-pwa 가상 모듈 재수출.
 * PWAStatus가 가상 모듈을 직접 import하면 vitest의 import-analysis가 해석에 실패해 테스트에서 vi.mock이 불가능하고,
 * vitest alias로 우회하면 knip이 "virtual:pwa-register/react"를 미등록 의존성으로 보고한다.
 * 이 래퍼를 mock 대상으로 삼으면 가상 모듈은 테스트에서 변환되지 않는다.
 */
export { useRegisterSW } from "virtual:pwa-register/react";
