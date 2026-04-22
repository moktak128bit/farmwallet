import React from "react";
import { formatKRW } from "../../utils/formatter";
import { shiftMonth } from "../../utils/date";

export type SpendingCalendarRow = {
  id: string;
  date: string;
  title: string;
  category: string;
  subCategory?: string;
  description?: string;
  amount: number;
  type: "spending" | "investing" | "income";
  fromAccountId?: string;
  fromAccountName?: string;
  toAccountId?: string;
  toAccountName?: string;
  source: "ledger";
};

export type CalendarCell = {
  date: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  spending: number;
  investing: number;
  income: number;
  count: number;
};

export type SpendingFilterType = "" | "spending" | "investing" | "income";

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

interface Props {
  cashflowMonth: string;
  setCashflowMonth: React.Dispatch<React.SetStateAction<string>>;
  spendingFilterType: SpendingFilterType;
  setSpendingFilterType: React.Dispatch<React.SetStateAction<SpendingFilterType>>;
  calendarCells: CalendarCell[];
  selectedMonthTotals: { spending: number; investing: number; income: number };
  selectedMonthSpendingRows: SpendingCalendarRow[];
  selectedCalendarDate: string | null;
  setSelectedCalendarDate: React.Dispatch<React.SetStateAction<string | null>>;
  today: string;
}

export const SpendingCalendarCard: React.FC<Props> = ({
  cashflowMonth,
  setCashflowMonth,
  spendingFilterType,
  setSpendingFilterType,
  calendarCells,
  selectedMonthTotals,
  selectedMonthSpendingRows,
  selectedCalendarDate,
  setSelectedCalendarDate,
  today,
}) => {
  const dayRows = selectedCalendarDate
    ? selectedMonthSpendingRows.filter((r) => r.date === selectedCalendarDate)
    : [];
  const daySpending = dayRows.filter((r) => r.type === "spending").reduce((s, r) => s + r.amount, 0);
  const dayInvesting = dayRows.filter((r) => r.type === "investing").reduce((s, r) => s + r.amount, 0);
  const dayIncome = dayRows.filter((r) => r.type === "income").reduce((s, r) => s + r.amount, 0);

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div className="card-title" style={{ margin: 0 }}>소비 캘린더</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="hint" style={{ margin: 0, fontSize: 14 }}>분류</span>
          <select
            value={spendingFilterType}
            onChange={(e) => setSpendingFilterType((e.target.value || "") as SpendingFilterType)}
            style={{
              minWidth: 140,
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text)",
              fontSize: 14
            }}
          >
            <option value="">전체</option>
            <option value="spending">내가 쓴 소비</option>
            <option value="investing">재테크</option>
            <option value="income">수입</option>
          </select>
          <button
            type="button"
            className="secondary"
            style={{ fontSize: 15, padding: "8px 16px", fontWeight: 600 }}
            onClick={() => setCashflowMonth((prev) => shiftMonth(prev, -1))}
          >
            ◀ 이전달
          </button>
          <strong style={{ minWidth: 90, textAlign: "center", fontSize: 17 }}>{cashflowMonth}</strong>
          <button
            type="button"
            className="secondary"
            style={{ fontSize: 15, padding: "8px 16px", fontWeight: 600 }}
            onClick={() => setCashflowMonth((prev) => shiftMonth(prev, 1))}
          >
            다음달 ▶
          </button>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 12,
          padding: "12px 16px",
          background: "var(--surface)",
          borderRadius: 8,
          border: "1px solid var(--border)"
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 600, color: "var(--chart-income)" }}>
          수입 {formatKRW(Math.round(selectedMonthTotals.income))}
        </span>
        <span style={{ fontSize: 16, fontWeight: 600, color: "var(--chart-expense)" }}>
          지출 {formatKRW(Math.round(selectedMonthTotals.spending))}
        </span>
        <span style={{ fontSize: 16, fontWeight: 600, color: "var(--chart-primary)" }}>
          재테크 {formatKRW(Math.round(selectedMonthTotals.investing))}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(36px, 1fr))",
          gap: 4,
          overflowX: "auto",
          minWidth: 0,
        }}
      >
        {DAY_LABELS.map((day) => (
          <div key={day} style={{ textAlign: "center", fontSize: 14, fontWeight: 700, color: "var(--text-muted)" }}>
            {day}
          </div>
        ))}
        {calendarCells.map((cell) => {
          const isSelected = selectedCalendarDate === cell.date;
          const clickable = cell.inMonth;
          return (
            <div
              key={cell.date}
              onClick={() => {
                if (!clickable) return;
                setSelectedCalendarDate((prev) => (prev === cell.date ? null : cell.date));
              }}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={(e) => {
                if (!clickable) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedCalendarDate((prev) => (prev === cell.date ? null : cell.date));
                }
              }}
              style={{
                minHeight: 92,
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 6,
                background: isSelected
                  ? "var(--primary-light)"
                  : cell.inMonth ? "var(--surface)" : "var(--bg)",
                opacity: cell.inMonth ? 1 : 0.6,
                outline: isSelected
                  ? "2px solid var(--primary)"
                  : cell.isToday ? "2px solid var(--primary)" : "none",
                cursor: clickable ? "pointer" : "default",
                transition: "background 120ms ease"
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: cell.date < today ? "var(--text-muted)" : "var(--text)" }}>
                {cell.day}
              </div>
              {cell.spending > 0 && (
                <div style={{ marginTop: 4, fontSize: 12, color: "var(--chart-expense)", fontWeight: 600 }}>
                  소비 {formatKRW(Math.round(cell.spending))}
                </div>
              )}
              {cell.investing > 0 && (
                <div style={{ marginTop: 2, fontSize: 12, color: "var(--chart-primary)", fontWeight: 600 }}>
                  재테크 {formatKRW(Math.round(cell.investing))}
                </div>
              )}
              {cell.income > 0 && (
                <div style={{ marginTop: 2, fontSize: 12, color: "var(--chart-income)", fontWeight: 600 }}>
                  수입 {formatKRW(Math.round(cell.income))}
                </div>
              )}
              {cell.count > 0 && (
                <div style={{ marginTop: 2, fontSize: 11, color: "var(--text-muted)" }}>
                  {cell.count}건
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="hint" style={{ marginTop: 12, marginBottom: 8 }}>
        {cashflowMonth} 소비 {formatKRW(Math.round(selectedMonthTotals.spending))} / 재테크 {formatKRW(Math.round(selectedMonthTotals.investing))} / 수입 {formatKRW(Math.round(selectedMonthTotals.income))} · {selectedMonthSpendingRows.length}건
      </p>

      {selectedCalendarDate ? (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 16 }}>{selectedCalendarDate}</strong>
              <span style={{ fontSize: 14, color: "var(--text-muted)" }}>
                소비 {formatKRW(Math.round(daySpending))} · 재테크 {formatKRW(Math.round(dayInvesting))} · 수입 {formatKRW(Math.round(dayIncome))} · {dayRows.length}건
              </span>
            </div>
            <button
              type="button"
              className="secondary"
              style={{ fontSize: 13, padding: "6px 12px" }}
              onClick={() => setSelectedCalendarDate(null)}
            >
              닫기
            </button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="table compact" style={{ width: "100%", fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>분류</th>
                  <th style={{ textAlign: "left" }}>카테고리 (대·중분류)</th>
                  <th style={{ textAlign: "left" }}>내역</th>
                  <th style={{ textAlign: "left" }}>계좌</th>
                  <th style={{ textAlign: "right" }}>금액</th>
                </tr>
              </thead>
              <tbody>
                {dayRows.map((row) => (
                  <tr key={`${row.id}:${row.date}`}>
                    <td>
                      <span
                        style={{
                          color: row.type === "spending" ? "var(--chart-expense)" : row.type === "investing" ? "var(--chart-primary)" : "var(--chart-income)",
                          fontWeight: 600
                        }}
                      >
                        {row.type === "spending" ? "내가 쓴 소비" : row.type === "investing" ? "재테크" : "수입"}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontWeight: 500 }}>{row.category || "-"}</span>
                      {row.subCategory && (
                        <>
                          <span style={{ color: "var(--text-muted)", margin: "0 4px" }}>·</span>
                          <span style={{ color: "var(--text)" }}>{row.subCategory}</span>
                        </>
                      )}
                    </td>
                    <td style={{ color: row.description ? "var(--text)" : "var(--text-muted)" }}>
                      {row.description || "—"}
                    </td>
                    <td>{row.type === "income" ? (row.toAccountName || row.toAccountId || "-") : (row.fromAccountName || row.fromAccountId || "-")}</td>
                    <td
                      className="number"
                      style={{
                        textAlign: "right",
                        color: row.type === "income" ? "var(--chart-income)" : "var(--chart-expense)",
                        fontWeight: 700
                      }}
                    >
                      {row.type === "income" ? "+" : "-"}{formatKRW(Math.round(row.amount))}
                    </td>
                  </tr>
                ))}
                {dayRows.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                      이 날짜에는 기록이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="hint" style={{ marginTop: 8, marginBottom: 0, fontSize: 14, color: "var(--text-muted)" }}>
          캘린더에서 날짜를 클릭하면 해당 날짜의 세부 내역이 표시됩니다.
        </p>
      )}
    </div>
  );
};
