/**
 * 데이트통장 미설정 경고 — 장부에 dateAccountId가 아예 없을 때(undefined)만.
 * 미설정이면 데이트통장 지출이 100% 내 지출로 잡혀 리포트·인사이트의 실질 지출·저축률이 달라진다.
 * "선택 안 함"("")을 고른 경우는 의도이므로 경고하지 않는다.
 */
import { AlertTriangle } from "lucide-react";
import { useDateAccountUnset } from "../../hooks/useDateAccountSettings";

export function DateAccountUnsetNotice({ where }: { where?: string }) {
  const unset = useDateAccountUnset();
  if (!unset) return null;
  return (
    <div role="status" style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 12px", marginBottom: 10, borderRadius: 8, background: "var(--warning-light)", fontSize: 13, lineHeight: 1.6 }}>
      <AlertTriangle size={16} style={{ color: "var(--warning)", flexShrink: 0, marginTop: 3 }} aria-hidden />
      <span>
        데이트통장이 설정되지 않았습니다 — 데이트통장 지출이 50% 분담 없이 전액 내 지출로 계산됩니다{where ? ` (${where})` : ""}.
        설정 › 데이트통장에서 계좌를 고르거나 "선택 안 함"을 저장하세요.
      </span>
    </div>
  );
}
