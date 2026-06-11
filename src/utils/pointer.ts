/**
 * 터치 등 coarse 포인터 환경 여부.
 * 더블클릭 인라인 편집은 터치 화면에서 동작하지 않으므로,
 * coarse 포인터에서는 단일 탭을 편집 진입의 대체 경로로 쓸 때 판단용으로 사용한다.
 * (모듈 로드 시점 고정이 아니라 호출 시점 평가 — 외부 모니터 연결 등 변화 대응)
 */
export const isCoarsePointer = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;
