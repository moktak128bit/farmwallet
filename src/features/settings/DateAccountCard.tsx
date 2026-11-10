/**
 * 데이트통장 설정 카드 — 데이트통장 계좌 선택. SettingsPage에서 분리.
 * 값은 장부(AppData.dateAccountId)에 저장돼 시트와 동기화된다(기기 localStorage 아님).
 * (분담 비율은 정산 로직상 50:50 고정 — 입력 컨트롤은 실제 계산에 반영되지 않아 제거함.)
 * React.memo로 감싸므로 부모가 넘기는 accounts는 data 슬라이스(참조 동일성 유지)다.
 */
import React from "react";
import { toast } from "react-hot-toast";
import type { Account } from "../../types";
import { useAppStore } from "../../store/appStore";
import { DateAccountUnsetNotice } from "./DateAccountUnsetNotice";

interface Props {
  accounts: Account[];
}

export const DateAccountCard: React.FC<Props> = React.memo(function DateAccountCard({ accounts }) {
  const dateAccountId = useAppStore((s) => s.data.dateAccountId);
  const setData = useAppStore((s) => s.setData);

  return (
    <div className="card">
      <div className="card-title">데이트통장 설정</div>
      <DateAccountUnsetNotice />
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ minWidth: 80 }}>데이트통장</span>
        <select
          aria-label="데이트통장 계좌"
          value={dateAccountId ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            setData((prev) => ({ ...prev, dateAccountId: v }));
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
        데이트통장에서 나간 지출은 50:50(본인 부담 50%)으로 분담 계산합니다. 이 설정은 장부와 함께 저장·동기화됩니다.
      </p>
    </div>
  );
});
