/**
 * 데이트통장 설정 카드 — 데이트통장 계좌 선택 + 본인 부담 비율. SettingsPage에서 분리.
 * dateAccountId/dateAccountRatio 상태는 이 카드 전용이라 이 컴포넌트가 소유한다
 * (localStorage 저장 + notifyDateAccountChange 통지 포함).
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
  const [dateAccountRatio, setDateAccountRatio] = useState(() => {
    if (typeof window === "undefined") return 50;
    const v = Number(localStorage.getItem(STORAGE_KEYS.DATE_ACCOUNT_RATIO));
    return Number.isFinite(v) ? v : 50;
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
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ minWidth: 80 }}>본인 부담</span>
        <input
          type="number"
          min={0}
          max={100}
          value={dateAccountRatio}
          onChange={(e) => {
            const v = Math.min(100, Math.max(0, Number(e.target.value) || 0));
            setDateAccountRatio(v);
            localStorage.setItem(STORAGE_KEYS.DATE_ACCOUNT_RATIO, String(v));
            notifyDateAccountChange();
          }}
          style={{ width: 70, padding: "6px 10px", borderRadius: 6, textAlign: "right" }}
        />
        <span>%</span>
      </label>
      <p className="hint" style={{ marginTop: 8 }}>
        데이트통장에서 나간 지출은 설정 비율만 본인 부담으로 계산합니다. (기본 50%)
      </p>
    </div>
  );
});
