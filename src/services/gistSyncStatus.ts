/** Gist 동기화 건강 상태 — 훅이 기록하고 헤더 상태 메뉴가 표시한다. */
export interface GistSyncHealth {
  /** 마지막으로 원격 확인/푸시/풀이 성공한 시각(ISO) */
  lastCheckAt: string | null;
  /** 연속 실패 횟수 — 성공 1회로 0 리셋 */
  consecutiveFailures: number;
  lastError: string | null;
}

export type GistSyncStatusKind = "ok" | "off" | "disconnected" | "error";

/** 오류 경보 임계값: 연속 실패 2회 이상 (1회는 일시적 네트워크 흔들림으로 본다) */
const ERROR_FAILURE_THRESHOLD = 2;

export function deriveGistSyncStatus(input: {
  autoSyncEnabled: boolean;
  hasToken: boolean;
  hasGistId: boolean;
  health: GistSyncHealth;
}): { kind: GistSyncStatusKind; message: string | null } {
  const { autoSyncEnabled, hasToken, hasGistId, health } = input;
  if (hasGistId && autoSyncEnabled && !hasToken) {
    return {
      kind: "disconnected",
      message: "토큰이 없어 동기화가 멈췄어요. PC에서 연결 QR을 다시 찍거나 설정에서 토큰을 입력하세요.",
    };
  }
  if (!autoSyncEnabled || !hasToken || !hasGistId) return { kind: "off", message: null };
  if (health.consecutiveFailures >= ERROR_FAILURE_THRESHOLD) {
    return { kind: "error", message: `동기화 오류: ${health.lastError ?? "알 수 없는 오류"}` };
  }
  return { kind: "ok", message: null };
}
