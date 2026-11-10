/**
 * 다른 화면에서 설정 탭의 특정 하위 탭을 열어 달라는 1회성 요청.
 * 예: 대시보드 "처리 전 사진 N장" → 설정 › 사진 올리기. 설정 탭이 마운트될 때 한 번 소비한다.
 */
let pending: string | null = null;

export function requestSettingsTab(tab: string): void {
  pending = tab;
}

export function consumeSettingsTabRequest(): string | null {
  const t = pending;
  pending = null;
  return t;
}
