/**
 * 소비 캘린더 카드 — DashboardPage에서 분리.
 * 월 이동/분류 필터/선택 날짜 상태와 캘린더 집계(±1년 창 내 ledger → 일별 합계)를
 * 카드가 전부 소유한다. 분류는 summaryMath.classifyLedgerFlow 단일 기준 —
 * 신용결제 제외(이중계상 방지), "재테크" = 저축·투자 이체 + 레거시 저축성지출.
 * React.memo로 감싸므로 부모가 넘기는 props는
 * 안정적(부모 useMemo 결과 또는 원시값)이어야 한다.
 */
import React, { useMemo, useState } from "react";
import type { Account, CategoryPresets, LedgerEntry } from "../../types";
import { formatKRW } from "../../utils/formatter";
import { addDaysToIso, formatIsoLocal, shiftMonth } from "../../utils/date";
import { classifyLedgerFlow, toKrwAmount } from "./summaryMath";

type SpendingCalendarRow = {
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

type SpendingByDate = { spending: number; investing: number; income: number; count: number };

type CalendarCell = {
  date: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  spending: number;
  investing: number;
  income: number;
  count: number;
};

type SpendingFilterType = "" | "spending" | "investing" | "income";

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function buildCalendarCells(
  month: string,
  byDate: Map<string, SpendingByDate>,
  today: string
): CalendarCell[] {
  const [year, monthNum] = month.split("-").map(Number);
  if (!year || !monthNum) return [];

  const firstDay = new Date(year, monthNum - 1, 1);
  const startOffset = firstDay.getDay();
  const start = new Date(year, monthNum - 1, 1 - startOffset);

  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + i);
    const date = formatIsoLocal(current);
    const summary = byDate.get(date);
    cells.push({
      date,
      day: current.getDate(),
      inMonth: date.slice(0, 7) === month,
      isToday: date === today,
      spending: summary?.spending ?? 0,
      investing: summary?.investing ?? 0,
      income: summary?.income ?? 0,
      count: summary?.count ?? 0
    });
  }
  return cells;
}

interface Props {
  ledger: LedgerEntry[];
  accounts: Account[];
  categoryPresets: CategoryPresets;
  fxRate: number | null;
  currentMonth: string;
  today: string;
}

export const SpendingCalendarCard: React.FC<Props> = React.memo(function SpendingCalendarCard({
  ledger,
  accounts,
  categoryPresets,
  fxRate,
  currentMonth,
  today,
}) {
  const [cashflowMonth, setCashflowMonth] = useState<string>(currentMonth);
  const [spendingFilterType, setSpendingFilterType] = useState<SpendingFilterType>("");
  // 캘린더에서 선택한 날짜 — null이면 상세 표 숨김, 값이 있으면 해당 날짜 항목만 표시.
  // cashflowMonth가 바뀌면 자동 초기화 (월이 변경되면 이전 달 선택은 무의미).
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  React.useEffect(() => { setSelectedCalendarDate(null); }, [cashflowMonth]);

  const accountNameById = useMemo(() => {
    return new Map(accounts.map((account) => [account.id, account.name || account.id]));
  }, [accounts]);

  const calendarWindowStart = useMemo(() => addDaysToIso(today, -365), [today]);
  const calendarWindowEnd = useMemo(() => addDaysToIso(today, 89), [today]);

  // 집계 창(−365일~+89일) 밖의 달은 기록이 있어도 0으로 보여 오해 소지 —
  // 달 이동을 창 안의 달로 제한한다 (창 경계 달은 일부만 집계될 수 있어 하단에 안내).
  const minNavMonth = calendarWindowStart.slice(0, 7);
  const maxNavMonth = calendarWindowEnd.slice(0, 7);
  const canGoPrev = cashflowMonth > minNavMonth;
  const canGoNext = cashflowMonth < maxNavMonth;
  const isEdgeMonth = cashflowMonth === minNavMonth || cashflowMonth === maxNavMonth;

  const spendingCalendarRows = useMemo(() => {
    const rows: SpendingCalendarRow[] = [];

    ledger.forEach((entry) => {
      if (!entry.date || entry.date < calendarWindowStart || entry.date > calendarWindowEnd) return;
      // 단일 분류 기준 (classifyLedgerFlow):
      //  - 신용결제 expense 제외 (카드 사용 시점에 이미 잡힘 — 이중계상 방지)
      //  - 재테크 = 저축·투자 이체 + 레거시 저축성지출 (요약 카드·월별 추이와 동일 정의)
      //  - 재테크가 아닌 일반 이체는 제외
      //  달력은 거래 내역(현금 흐름) 뷰 — 수입은 정산·용돈 포함 전체. 근로소득 필터(salaryKeys)는
      //  분석 지표(요약·추이·비교·저축률)에만 적용하고 여기엔 적용하지 않는다(실제 입금일 누락 방지).
      const flow = classifyLedgerFlow(entry, categoryPresets);
      if (!flow) return;

      const amount = toKrwAmount(entry, fxRate);
      if (amount <= 0) return;

      const title = entry.subCategory || entry.description || entry.category || "미분류";
      const category = entry.category || "";
      const subCategory = entry.subCategory || undefined;
      const description = entry.description || undefined;

      if (flow === "income") {
        rows.push({
          id: entry.id,
          date: entry.date,
          title,
          category,
          subCategory,
          description,
          amount,
          type: "income",
          toAccountId: entry.toAccountId,
          toAccountName: entry.toAccountId ? accountNameById.get(entry.toAccountId) : undefined,
          source: "ledger"
        });
        return;
      }

      // 지출(expense)은 기존 정책대로 출금 계좌 없는 항목 제외. 재테크 이체는 계좌 없어도 표시.
      if (entry.kind === "expense" && !entry.fromAccountId) return;
      rows.push({
        id: entry.id,
        date: entry.date,
        title,
        category,
        subCategory,
        description,
        amount,
        type: flow === "investing" ? "investing" : "spending",
        fromAccountId: entry.fromAccountId,
        fromAccountName: entry.fromAccountId ? accountNameById.get(entry.fromAccountId) : undefined,
        source: "ledger"
      });
    });

    return rows.sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate !== 0) return byDate;
      return b.amount - a.amount;
    });
  }, [ledger, calendarWindowStart, calendarWindowEnd, fxRate, accountNameById, categoryPresets]);

  const filteredSpendingRows = useMemo(() => {
    if (!spendingFilterType) return spendingCalendarRows;
    return spendingCalendarRows.filter((row) => row.type === spendingFilterType);
  }, [spendingCalendarRows, spendingFilterType]);

  const spendingByDate = useMemo(() => {
    const map = new Map<string, SpendingByDate>();
    spendingCalendarRows.forEach((row) => {
      const prev = map.get(row.date) ?? { spending: 0, investing: 0, income: 0, count: 0 };
      if (row.type === "spending") {
        map.set(row.date, { ...prev, spending: prev.spending + row.amount, count: prev.count + 1 });
      } else if (row.type === "investing") {
        map.set(row.date, { ...prev, investing: prev.investing + row.amount, count: prev.count + 1 });
      } else {
        map.set(row.date, { ...prev, income: prev.income + row.amount, count: prev.count + 1 });
      }
    });
    return map;
  }, [spendingCalendarRows]);

  const calendarCells = useMemo(
    () => buildCalendarCells(cashflowMonth, spendingByDate, today),
    [cashflowMonth, spendingByDate, today]
  );

  const selectedMonthSpendingRows = useMemo(
    () => filteredSpendingRows.filter((row) => row.date.slice(0, 7) === cashflowMonth),
    [filteredSpendingRows, cashflowMonth]
  );

  const selectedMonthTotals = useMemo(
    () => {
      const t = { spending: 0, investing: 0, income: 0 };
      selectedMonthSpendingRows.forEach((row) => {
        t[row.type] += row.amount;
      });
      return t;
    },
    [selectedMonthSpendingRows]
  );

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
            onClick={() => setCashflowMonth((prev) => (prev > minNavMonth ? shiftMonth(prev, -1) : prev))}
            disabled={!canGoPrev}
            title={canGoPrev ? undefined : "캘린더 집계 범위(오늘 기준 1년 전)까지만 이동할 수 있습니다"}
          >
            ◀ 이전달
          </button>
          <strong style={{ minWidth: 90, textAlign: "center", fontSize: 17 }}>{cashflowMonth}</strong>
          <button
            type="button"
            className="secondary"
            style={{ fontSize: 15, padding: "8px 16px", fontWeight: 600 }}
            onClick={() => setCashflowMonth((prev) => (prev < maxNavMonth ? shiftMonth(prev, 1) : prev))}
            disabled={!canGoNext}
            title={canGoNext ? undefined : "캘린더 집계 범위(오늘 기준 약 3개월 후)까지만 이동할 수 있습니다"}
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
        {isEdgeMonth && (
          <span style={{ marginLeft: 6, color: "var(--warning)" }}>
            · 이 달은 집계 범위 경계라 일부 날짜만 집계될 수 있습니다
          </span>
        )}
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
});
