/**
 * 가계부 요약 카드 + 필터 칩 + 월별 비교 카드.
 * LedgerPage에서 분리 — React.memo로 감싸 폼 타이핑 등 무관한 상태 변경 시 재렌더를 건너뛴다.
 * 부모가 넘기는 콜백은 모두 안정적(setState 또는 useCallback)이어야 memo가 효과를 가진다.
 */
import React, { useMemo } from "react";
import { formatKRW } from "../../utils/formatter";
import type { CategoryPresets } from "../../types";
import type { LedgerDisplayRow } from "../../utils/ledgerHelpers";
import { isCreditPayment, isInvestmentEntry, makeIsSavingsExpense } from "../../utils/category";
import { EXPENSE_BOX_EXCLUDED_NAMES } from "../dashboard/summaryMath";
import { useFxRateValue } from "../../context/FxRateContext";

type LedgerFilteredSummary = {
  expenseAmount: number;
  /** 지출 중 제외 대상(데이터비 등) 합계 — '제외 후' 보조 표시용 */
  excludedExpenseAmount?: number;
  savingsAmount: number;
  incomeAmount: number;
  total: number;
  prevExpense: number;
  prevIncome: number;
  hasPrev: boolean;
  prevMonth: string;
  /** 진행 중인 이번 달 비교 시 오늘 일자 — 전월도 같은 기간(1~N일)만 합산됐음을 의미 */
  prevDayCap: number | null;
};

type SetStr = React.Dispatch<React.SetStateAction<string | undefined>>;
type SetNum = React.Dispatch<React.SetStateAction<number | undefined>>;

interface Props {
  hasFilter: boolean;
  viewMode: "all" | "monthly";
  selectedMonthsLabel: string;
  summaryTabLabel: string;
  filteredSummary: LedgerFilteredSummary;
  filterMainCategory?: string;
  filterSubCategory?: string;
  filterDetailCategory?: string;
  filterFromAccountId?: string;
  filterToAccountId?: string;
  filterFromAccountName: string | null;
  filterToAccountName: string | null;
  setFilterMainCategory: SetStr;
  setFilterSubCategory: SetStr;
  setFilterDetailCategory: SetStr;
  setFilterFromAccountId: SetStr;
  setFilterToAccountId: SetStr;
  hasDateFilter: boolean;
  dateFilter: { startDate?: string; endDate?: string };
  clearDateFilter: () => void;
  hasAmountFilter: boolean;
  filterAmountMin?: number;
  filterAmountMax?: number;
  setFilterAmountMin: SetNum;
  setFilterAmountMax: SetNum;
  hasTagFilter: boolean;
  filterTagsInput: string;
  setFilterTagsInput: React.Dispatch<React.SetStateAction<string>>;
  clearAllFilters: () => void;
  selectedMonths: Set<string>;
  filteredLedger: LedgerDisplayRow[];
  /** 월별 비교 카드의 지출 기준(저축성지출 제외)을 요약 카드와 맞추기 위한 프리셋 */
  categoryPresets: CategoryPresets;
}

const chipStyle: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: 600,
  borderRadius: "20px",
  border: "1px solid var(--primary)",
  background: "var(--primary-light)",
  color: "var(--primary)",
  cursor: "pointer"
};

export const LedgerSummarySection: React.FC<Props> = React.memo(function LedgerSummarySection({
  hasFilter,
  viewMode,
  selectedMonthsLabel,
  summaryTabLabel,
  filteredSummary,
  filterMainCategory,
  filterSubCategory,
  filterDetailCategory,
  filterFromAccountId,
  filterToAccountId,
  filterFromAccountName,
  filterToAccountName,
  setFilterMainCategory,
  setFilterSubCategory,
  setFilterDetailCategory,
  setFilterFromAccountId,
  setFilterToAccountId,
  hasDateFilter,
  dateFilter,
  clearDateFilter,
  hasAmountFilter,
  filterAmountMin,
  filterAmountMax,
  setFilterAmountMin,
  setFilterAmountMax,
  hasTagFilter,
  filterTagsInput,
  setFilterTagsInput,
  clearAllFilters,
  selectedMonths,
  filteredLedger,
  categoryPresets
}) {
  // USD 항목 KRW 환산용 환율 (요약 카드와 동일 정책)
  const fxRate = useFxRateValue();

  // 월별 비교 모드: 2개 이상 월 선택 시.
  // 지출 기준은 요약 카드(filteredSummary)와 동일 — 신용결제·재테크(사용자 정의 savings 포함) 제외.
  const monthSummaries = useMemo(() => {
    if (viewMode !== "monthly" || selectedMonths.size < 2) return null;
    const isSavings = makeIsSavingsExpense(categoryPresets);
    const toKrw = (l: LedgerDisplayRow) => (l.currency === "USD" && fxRate ? l.amount * fxRate : l.amount);
    const sortedMonths = Array.from(selectedMonths).sort();
    return sortedMonths.map((monthKey) => {
      const entries = filteredLedger.filter((l) => l.date && l.date.startsWith(monthKey));
      const expenseAmount = entries
        .filter(
          (l) =>
            l.kind === "expense" &&
            !isCreditPayment(l) &&
            !isInvestmentEntry(l) &&
            !isSavings(l)
        )
        .reduce((s, l) => s + toKrw(l), 0);
      const incomeAmount = entries
        .filter((l) => l.kind === "income")
        .reduce((s, l) => s + toKrw(l), 0);
      const total = incomeAmount - expenseAmount;
      return { monthKey, expenseAmount, incomeAmount, total };
    });
  }, [viewMode, selectedMonths, filteredLedger, categoryPresets, fxRate]);

  return (
    <>
      {/* 요약 카드: 항상 표시, 필터 적용 시 해당 결과 합계 */}
      <div style={{
        marginBottom: "16px",
        padding: "20px 24px",
        background: "var(--surface)",
        borderRadius: "12px",
        border: "2px solid var(--border)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.06)"
      }}>
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          alignItems: "stretch"
        }}>
          {/* 전체: 가장 크게, 가운데 */}
          <div style={{ textAlign: "center" }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, display: "block", marginBottom: 4 }}>
              {hasFilter
                ? `필터 적용 · ${viewMode === "monthly" ? selectedMonthsLabel || "월 선택" : "전체"} ${summaryTabLabel}`
                : viewMode === "monthly"
                  ? `${selectedMonthsLabel || "월 선택"} ${summaryTabLabel}`
                  : `전체 ${summaryTabLabel}`}
            </span>
            <span style={{
              fontSize: 28,
              fontWeight: 800,
              color: filteredSummary.total >= 0 ? "var(--primary)" : "var(--danger)",
              letterSpacing: "-0.5px"
            }}>
              {formatKRW(filteredSummary.total)}
            </span>
          </div>
          {/* 지출 / 수입: 나란히, 색상·크기로 구분 */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "16px",
            alignItems: "center"
          }}>
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              padding: "12px 16px",
              background: "rgba(239, 68, 68, 0.08)",
              borderRadius: "8px",
              border: "1px solid rgba(239, 68, 68, 0.2)"
            }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>지출</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: "var(--danger)" }}>
                {formatKRW(filteredSummary.expenseAmount)}
              </span>
              {(filteredSummary.excludedExpenseAmount ?? 0) > 0 && (
                <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>
                  {EXPENSE_BOX_EXCLUDED_NAMES.join("·")} 제외 {formatKRW(filteredSummary.expenseAmount - (filteredSummary.excludedExpenseAmount ?? 0))}
                </span>
              )}
            </div>
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              padding: "12px 16px",
              background: "rgba(245, 158, 11, 0.08)",
              borderRadius: "8px",
              border: "1px solid rgba(245, 158, 11, 0.24)"
            }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>재테크</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: "var(--warning)" }}>
                {formatKRW(filteredSummary.savingsAmount)}
              </span>
            </div>
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              padding: "12px 16px",
              background: "rgba(34, 197, 94, 0.08)",
              borderRadius: "8px",
              border: "1px solid rgba(34, 197, 94, 0.2)"
            }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>수입</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: "var(--success)" }}>
                {formatKRW(filteredSummary.incomeAmount)}
              </span>
            </div>
          </div>
          {/* 전월 대비 비교 */}
          {filteredSummary.hasPrev && !hasFilter && (
            <div style={{
              display: "flex", gap: 16, fontSize: 12, color: "var(--text-muted)",
              paddingTop: 8, borderTop: "1px solid var(--border)", justifyContent: "center"
            }}>
              <span>전월 {filteredSummary.prevDayCap != null ? `동기(1~${filteredSummary.prevDayCap}일) ` : ""}대비 지출: <span style={{
                fontWeight: 700,
                color: filteredSummary.expenseAmount > filteredSummary.prevExpense ? "var(--danger)" : "var(--success)"
              }}>
                {filteredSummary.expenseAmount > filteredSummary.prevExpense ? "+" : ""}
                {formatKRW(filteredSummary.expenseAmount - filteredSummary.prevExpense)}
              </span></span>
              <span>전월 {filteredSummary.prevDayCap != null ? `동기(1~${filteredSummary.prevDayCap}일) ` : ""}대비 수입: <span style={{
                fontWeight: 700,
                color: filteredSummary.incomeAmount >= filteredSummary.prevIncome ? "var(--success)" : "var(--danger)"
              }}>
                {filteredSummary.incomeAmount >= filteredSummary.prevIncome ? "+" : ""}
                {formatKRW(filteredSummary.incomeAmount - filteredSummary.prevIncome)}
              </span></span>
            </div>
          )}
          {/* 필터 칩: 적용된 조건 한 줄에 표시 */}
          {hasFilter && (
            <div style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "8px",
              alignItems: "center",
              paddingTop: "8px",
              borderTop: "1px solid var(--border)"
            }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: 4 }}>필터:</span>
              {filterMainCategory && (
                <button
                  type="button"
                  onClick={() => { setFilterMainCategory(undefined); setFilterSubCategory(undefined); setFilterDetailCategory(undefined); }}
                  style={chipStyle}
                >
                  {filterMainCategory} ×
                </button>
              )}
              {filterSubCategory && (
                <button
                  type="button"
                  onClick={() => { setFilterSubCategory(undefined); setFilterDetailCategory(undefined); }}
                  style={chipStyle}
                >
                  {filterSubCategory} ×
                </button>
              )}
              {filterDetailCategory && (
                <button
                  type="button"
                  onClick={() => { setFilterDetailCategory(undefined); }}
                  style={chipStyle}
                >
                  {filterDetailCategory} ×
                </button>
              )}
              {filterFromAccountId && (
                <button
                  type="button"
                  onClick={() => { setFilterFromAccountId(undefined); }}
                  style={chipStyle}
                >
                  출금: {filterFromAccountName} ×
                </button>
              )}
              {filterToAccountId && (
                <button
                  type="button"
                  onClick={() => { setFilterToAccountId(undefined); }}
                  style={chipStyle}
                >
                  입금: {filterToAccountName} ×
                </button>
              )}
              {hasDateFilter && (
                <button
                  type="button"
                  onClick={clearDateFilter}
                  style={chipStyle}
                >
                  {dateFilter.startDate && dateFilter.endDate
                    ? `${dateFilter.startDate} ~ ${dateFilter.endDate}`
                    : dateFilter.startDate
                      ? `${dateFilter.startDate} ~`
                      : `~ ${dateFilter.endDate}`} ×
                </button>
              )}
              {hasAmountFilter && (
                <button
                  type="button"
                  onClick={() => { setFilterAmountMin(undefined); setFilterAmountMax(undefined); }}
                  style={chipStyle}
                >
                  금액: {filterAmountMin != null && filterAmountMax != null
                    ? `${formatKRW(filterAmountMin)} ~ ${formatKRW(filterAmountMax)}`
                    : filterAmountMin != null
                      ? `${formatKRW(filterAmountMin)} 이상`
                      : filterAmountMax != null
                        ? `${formatKRW(filterAmountMax)} 이하`
                        : ""} ×
                </button>
              )}
              {hasTagFilter && (
                <button
                  type="button"
                  onClick={() => setFilterTagsInput("")}
                  style={chipStyle}
                >
                  태그: {filterTagsInput.trim()} ×
                </button>
              )}
              <button
                type="button"
                onClick={clearAllFilters}
                style={{
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: "20px",
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--text-secondary)",
                  cursor: "pointer"
                }}
              >
                필터 한번에 지우기
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 월별 비교 모드: 2개 이상 월 선택 시 */}
      {monthSummaries && (
        <div style={{
          marginBottom: "16px",
          padding: "16px 20px",
          background: "var(--surface)",
          borderRadius: "12px",
          border: "2px solid var(--border)",
          overflowX: "auto"
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 12 }}>월별 비교</div>
          <div style={{ display: "flex", gap: 16, minWidth: "max-content" }}>
            {monthSummaries.map(({ monthKey, expenseAmount, incomeAmount, total }) => (
              <div
                key={monthKey}
                style={{
                  flex: "0 0 auto",
                  width: 140,
                  padding: 12,
                  background: "var(--bg)",
                  borderRadius: 8,
                  border: "1px solid var(--border)"
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: "var(--primary)" }}>{monthKey}</div>
                <div style={{ fontSize: 11, color: "var(--danger)", marginBottom: 4 }}>지출 {formatKRW(expenseAmount)}</div>
                <div style={{ fontSize: 11, color: "var(--success)", marginBottom: 4 }}>수입 {formatKRW(incomeAmount)}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: total >= 0 ? "var(--primary)" : "var(--danger)", borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 8 }}>
                  순액 {formatKRW(total)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
});
