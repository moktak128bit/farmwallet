/**
 * 데이트통장 설정 카드 — 데이트통장 계좌 선택. SettingsPage에서 분리.
 * dateAccountId 상태는 이 카드 전용이라 이 컴포넌트가 소유한다
 * (localStorage 저장 + notifyDateAccountChange 통지 포함).
 * (분담 비율은 정산 로직상 50:50 고정 — 입력 컨트롤은 실제 계산에 반영되지 않아 제거함.)
 * React.memo로 감싸므로 부모가 넘기는 accounts는 data 슬라이스(참조 동일성 유지)다.
 */
import React, { useState } from "react";
import { toast } from "react-hot-toast";
import type { Account } from "../../types";
import { STORAGE_KEYS } from "../../constants/config";
import { notifyDateAccountChange } from "../../hooks/useDateAccountSettings";

interface Props {
  accounts: Account[];
}

export const DateAccountCard: React.FC<Props> = React.memo(function DateAccountCard({ accounts }) {
  const [dateAccountId, setDateAccountId] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(STORAGE_KEYS.DATE_ACCOUNT_ID) ?? "";
  });

  return (
    <div className="card">
      <div className="card-title">데이트통장 설정</div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ minWidth: 80 }}>데이트통장</span>
        <select
          value={dateAccountId}
          onChange={(e) => {
            const v = e.target.value;
            setDateAccountId(v);
            localStorage.setItem(STORAGE_KEYS.DATE_ACCOUNT_ID, v);
            notifyDateAccountChange();
            toast.success(v ? `데이트통장: ${v}` : "데이트통장 해제");
          }}
          style={{ flex: 1, padding: "6px 10px", borderRadius: 6 }}
        >
          <option value="">선택 안 함</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.id} ({a.name})</option>
          ))}
        </select>
      </label>
      <p className="hint" style={{ marginTop: 8 }}>
        데이트통장에서 나간 지출은 50:50(본인 부담 50%)으로 분담 계산합니다.
      </p>
    </div>
  );
});
