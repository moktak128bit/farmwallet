import React, { useMemo } from "react";
import type { LedgerEntry } from "../../types";
import { formatKRW, formatShortDate } from "../../utils/format";

interface FxHistorySectionProps {
  ledger: LedgerEntry[];
}

export const FxHistorySection: React.FC<FxHistorySectionProps> = ({ ledger }) => {
  const fxEntries = useMemo(() => {
    return ledger.filter((entry) => 
      entry.kind === "transfer" && 
      (entry.description.toLowerCase().includes("환전") ||
       entry.description.toLowerCase().includes("fx") ||
       entry.description.toLowerCase().includes("exchange"))
    );
  }, [ledger]);

  if (fxEntries.length === 0) {
    return (
      <div className="card" style={{ padding: 16, textAlign: "center", color: "var(--text-muted)" }}>
        환전 거래 내역이 없습니다.
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>날짜</th>
            <th>출발 계좌</th>
            <th>도착 계좌</th>
            <th>금액</th>
            <th>설명</th>
          </tr>
        </thead>
        <tbody>
          {fxEntries
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((entry) => (
              <tr key={entry.id}>
                <td>{formatShortDate(entry.date)}</td>
                <td>{entry.fromAccountId || "-"}</td>
                <td>{entry.toAccountId || "-"}</td>
                <td className="number">{formatKRW(entry.amount)}</td>
                <td>{entry.description}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
};
