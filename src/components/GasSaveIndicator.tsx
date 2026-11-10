/**
 * GAS 헤더 저장 상태 — "자동 저장이 된 건지 모르겠다"에 대한 답. 항상 한 줄로 지금 상태를 말한다.
 *   시트 확인 중… → (편집 후 5초 디바운스) 저장 중… → 시트에 저장됨 · 방금/HH:MM
 *   저장 실패 — 다시 시도(경고색은 이때만) · 저장 멈춤(장부 불러오기 실패 등 자동 저장이 막힌 경로)
 * 판정은 순수 함수 deriveGasSaveState로 분리(테스트).
 */
import React, { useMemo } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import type { AppData } from "../types";
import { toUserDataJson } from "../services/dataService";
import { getGistLastPushedHash, hashGistPayload } from "../services/gistSync";
import type { GistSyncHealth } from "../services/gistSyncStatus";

type GasSaveState =
  | { kind: "checking" }
  | { kind: "blocked"; reason: string }
  | { kind: "off" }
  | { kind: "saving" }
  | { kind: "error"; message: string }
  | { kind: "saved"; at: string | null };

export function deriveGasSaveState(input: {
  sheetBootPending: boolean;
  blockedReason: string | null;
  autoSyncEnabled: boolean;
  isSyncing: boolean;
  dirty: boolean;
  health: GistSyncHealth;
  lastPushAt: string | null;
}): GasSaveState {
  if (input.blockedReason) return { kind: "blocked", reason: input.blockedReason };
  if (input.sheetBootPending) return { kind: "checking" };
  if (!input.autoSyncEnabled) return { kind: "off" };
  // 실패가 남아 있고 아직 못 올린 변경이 있으면 실패를 보여 준다 (재시도 중이어도 사용자는 알아야 한다)
  if (input.health.consecutiveFailures > 0 && input.dirty && !input.isSyncing) {
    return { kind: "error", message: input.health.lastError ?? "알 수 없는 오류" };
  }
  if (input.dirty || input.isSyncing) return { kind: "saving" };
  return { kind: "saved", at: input.lastPushAt };
}

/** "방금"(1분 이내) / "HH:MM"(오늘) / "M/D HH:MM" */
export function formatSavedAt(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  if (now.getTime() - t.getTime() < 60_000) return "방금";
  const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" };
  const day = (d: Date) => d.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
  if (day(t) === day(now)) return t.toLocaleTimeString("ko-KR", opts);
  return `${t.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" })} ${t.toLocaleTimeString("ko-KR", opts)}`;
}

interface Props {
  data: AppData;
  sheetBootPending: boolean;
  blockedReason: string | null;
  autoSyncEnabled: boolean;
  isSyncing: boolean;
  health: GistSyncHealth;
  lastPushAt: string | null;
  onRetry: () => void;
}

export const GasSaveIndicator: React.FC<Props> = ({ data, sheetBootPending, blockedReason, autoSyncEnabled, isSyncing, health, lastPushAt, onRetry }) => {
  // 마지막 저장 해시(localStorage)와 화면 데이터 비교 — 저장 성공 시 lastPushAt이 바뀌어 다시 계산된다
  const dirty = useMemo(
    () => hashGistPayload(toUserDataJson(data)) !== getGistLastPushedHash(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lastPushAt·isSyncing: 해시 갱신 시점 트리거
    [data, lastPushAt, isSyncing]
  );
  const state = deriveGasSaveState({ sheetBootPending, blockedReason, autoSyncEnabled, isSyncing, dirty, health, lastPushAt });

  if (state.kind === "error") {
    return (
      <button type="button" className="gas-save-status error" onClick={onRetry} title={`저장 실패: ${state.message} — 눌러서 다시 시도`}>
        <AlertTriangle size={13} aria-hidden />
        <span className="gas-save-full">저장 실패 — 다시 시도</span>
        <span className="gas-save-short">저장 실패</span>
      </button>
    );
  }
  const view = (() => {
    switch (state.kind) {
      case "checking": return { icon: <Loader2 size={13} className="spin" aria-hidden />, text: "시트 확인 중…", short: "확인 중", title: "시트의 최신 장부를 확인하는 중 — 끝날 때까지 자동 저장을 잠시 멈춥니다" };
      case "blocked": return { icon: <AlertTriangle size={13} aria-hidden />, text: "저장 멈춤", short: "저장 멈춤", title: state.reason };
      case "off": return { icon: <AlertTriangle size={13} aria-hidden />, text: "자동 저장 꺼짐", short: "저장 꺼짐", title: "설정 › 동기화에서 자동 저장을 켜세요" };
      case "saving": return { icon: <Loader2 size={13} className="spin" aria-hidden />, text: "저장 중…", short: "저장 중", title: "편집 후 몇 초 안에 시트에 자동 저장됩니다" };
      case "saved": {
        const at = formatSavedAt(state.at);
        return { icon: <Check size={13} aria-hidden />, text: at ? `시트에 저장됨 · ${at}` : "시트에 저장됨", short: "저장됨", title: "변경은 편집 후 몇 초 안에 Drive 시트에 자동 저장됩니다" };
      }
    }
  })();
  return (
    <span className={`gas-save-status${state.kind === "blocked" || state.kind === "off" ? " warn" : ""}`} title={view.title} role="status" aria-live="polite">
      {view.icon}
      <span className="gas-save-full">{view.text}</span>
      <span className="gas-save-short">{view.short}</span>
    </span>
  );
};
