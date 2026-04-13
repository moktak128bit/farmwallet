import React, { useMemo, useState } from "react";
import type { Account, AppData, LedgerEntry } from "../../types";
import { STORAGE_KEYS } from "../../constants/config";

interface Props {
  data: AppData;
  onSettle: (entry: LedgerEntry) => void;
  formatNumber: (n: number) => string;
}

const SETTLE_LAST_KEY = "fw-date-account-last-settle-at";

export const SettlementView: React.FC<Props> = ({ data, onSettle, formatNumber }) => {
  const dateAccountId = typeof window !== "undefined"
    ? localStorage.getItem(STORAGE_KEYS.DATE_ACCOUNT_ID) ?? ""
    : "";
  const ratio = typeof window !== "undefined"
    ? Number(localStorage.getItem(STORAGE_KEYS.DATE_ACCOUNT_RATIO) ?? "50")
    : 50;
  const lastSettleAt = typeof window !== "undefined"
    ? localStorage.getItem(SETTLE_LAST_KEY) ?? ""
    : "";

  const dateAccount: Account | undefined = data.accounts.find((a) => a.id === dateAccountId);

  const [sinceDate, setSinceDate] = useState(lastSettleAt || (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  })());

  const settlement = useMemo(() => {
    if (!dateAccount) return null;
    const items = data.ledger.filter((l) =>
      l.kind === "expense" &&
      l.fromAccountId === dateAccount.id &&
      l.date >= sinceDate
    );
    const total = items.reduce((s, l) => s + l.amount, 0);
    const myShare = total * (ratio / 100);
    const partnerShare = total - myShare;
    return { items, total, myShare, partnerShare };
  }, [data.ledger, dateAccount, sinceDate, ratio]);

  if (!dateAccount) {
    return (
      <div style={{ padding: 16, color: "var(--text-muted)" }}>
        데이트 계좌가 설정되어 있지 않습니다. 설정 탭에서 데이트 통장 계좌와 본인 부담 비율을 지정해주세요.
      </div>
    );
  }

  const handleSettle = () => {
    if (!settlement || settlement.partnerShare <= 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const entry: LedgerEntry = {
      id: `settle-${Date.now()}`,
      date: today,
      kind: "transfer",
      category: "정산",
      subCategory: "데이트통장",
      description: `${sinceDate} 이후 정산 (상대 부담분 입금)`,
      amount: settlement.partnerShare,
      toAccountId: dateAccount.id,
      note: `합계 ${settlement.total.toLocaleString()}원 / 본인비율 ${ratio}%`
    };
    onSettle(entry);
    if (typeof window !== "undefined") localStorage.setItem(SETTLE_LAST_KEY, today);
  };

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 18, marginBottom: 4 }}>데이트 계좌 정산</h2>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
        계좌: <strong>{dateAccount.name}</strong> · 본인 부담 비율: <strong>{ratio}%</strong>
        {lastSettleAt && <> · 마지막 정산: {lastSettleAt}</>}
      </p>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 13, marginRight: 8 }}>정산 시작일</label>
        <input type="date" value={sinceDate} onChange={(e) => setSinceDate(e.target.value)} />
      </div>
      {settlement && (
        <div style={{
          display: "grid", gap: 8, gridTemplateColumns: "repeat(3, 1fr)",
          marginBottom: 16
        }}>
          <Card label="총 지출" value={formatNumber(settlement.total)} />
          <Card label={`내 부담 (${ratio}%)`} value={formatNumber(settlement.myShare)} />
          <Card label={`상대 부담 (${100 - ratio}%)`} value={formatNumber(settlement.partnerShare)} accent />
        </div>
      )}
      <button type="button" className="primary" onClick={handleSettle}
        disabled={!settlement || settlement.partnerShare <= 0}>
        상대 부담분 정산 입금 기록
      </button>
      <p style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
        클릭 시 가계부에 "이체(정산 송금)" 항목으로 추가되고 마지막 정산일이 갱신됩니다.
      </p>
    </div>
  );
};

const Card: React.FC<{ label: string; value: string; accent?: boolean }> = ({ label, value, accent }) => (
  <div style={{
    border: "1px solid var(--border)", borderRadius: 8, padding: 12,
    background: accent ? "var(--success-bg, var(--surface))" : "var(--surface)"
  }}>
    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
  </div>
);
