import React from "react";
import { formatKRW } from "../../utils/formatter";

export interface MonthlyTrendRow {
  month: string;
  income: number;
  expense: number;
  investing: number;
}

interface Props {
  monthlyTrendData: MonthlyTrendRow[];
}

export const MonthlyTrendCard: React.FC<Props> = ({ monthlyTrendData }) => {
  const maxVal = Math.max(
    ...monthlyTrendData.map((r) => Math.max(r.income, r.expense + r.investing))
  );

  return (
    <div className="card">
      <div className="card-title">월별 추이 (최근 6개월)</div>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        {monthlyTrendData.map((row) => {
          const incPct = maxVal > 0 ? (row.income / maxVal) * 100 : 0;
          const expPct = maxVal > 0 ? (row.expense / maxVal) * 100 : 0;
          const invPct = maxVal > 0 ? (row.investing / maxVal) * 100 : 0;
          return (
            <div key={row.month}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>{row.month}</span>
                <span className="hint" style={{ fontSize: 13 }}>{formatKRW(Math.round(row.income))} / {formatKRW(Math.round(row.expense))}</span>
              </div>
              <div style={{ display: "flex", gap: 2, height: 10 }}>
                <div style={{ width: `${incPct}%`, background: "var(--chart-income)", borderRadius: 4, minWidth: row.income > 0 ? 2 : 0 }} />
                <div style={{ width: `${expPct}%`, background: "var(--chart-expense)", borderRadius: 4, minWidth: row.expense > 0 ? 2 : 0 }} />
                <div style={{ width: `${invPct}%`, background: "var(--chart-primary)", borderRadius: 4, minWidth: row.investing > 0 ? 2 : 0 }} />
              </div>
            </div>
          );
        })}
        <div className="hint" style={{ fontSize: 13, marginTop: 6 }}>
          <span style={{ color: "var(--chart-income)" }}>■</span> 수입 <span style={{ color: "var(--chart-expense)" }}>■</span> 지출 <span style={{ color: "var(--chart-primary)" }}>■</span> 재테크
        </div>
      </div>
    </div>
  );
};
