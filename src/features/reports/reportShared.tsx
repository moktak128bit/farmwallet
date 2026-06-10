/**
 * 보고서 공용 헬퍼 — ReportPage와 features/reports/* 가 함께 쓰는 포맷터·기간 선택 UI.
 * MonthRangePicker/DateRangePicker는 React.memo — 부모가 넘기는 setter는 setState 그대로(참조 고정).
 */
import React from "react";
import { formatKRW } from "../../utils/formatter";
import type { useReportWorker } from "../../hooks/useReportWorker";

/** useReportWorker가 돌려주는 기간 비교 결과 타입 (훅 내부 비공개 타입을 파생) */
export type PeriodCompareResult = ReturnType<typeof useReportWorker>["periodCompare"];

export type ReportType =
  | "comprehensive"
  | "investment"
  | "monthly"
  | "yearly"
  | "category"
  | "stock"
  | "account"
  | "daily"
  | "periodCompare"
  | "closing"
  | "performanceAdvanced"
  | "tax";

export function toPercent(rate?: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return "-";
  return `${(rate * 100).toFixed(2)}%`;
}

export function signedKRW(value: number): string {
  return `${value > 0 ? "+" : ""}${formatKRW(value)}`;
}

/** 월 이동 헬퍼 */
export function shiftMonthKey(monthKey: string, offset: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface RangeProps {
  startDate: string;
  endDate: string;
  setStartDate: React.Dispatch<React.SetStateAction<string>>;
  setEndDate: React.Dispatch<React.SetStateAction<string>>;
}

export const MonthRangePicker: React.FC<RangeProps> = React.memo(function MonthRangePicker({
  startDate,
  endDate,
  setStartDate,
  setEndDate
}) {
  return (
    <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
      <span>시작</span>
      <input type="month" value={startDate.slice(0, 7)} onChange={(e) => setStartDate(`${e.target.value}-01`)} />
      <span>종료</span>
      <input
        type="month"
        value={endDate.slice(0, 7)}
        onChange={(e) => {
          const [year, month] = e.target.value.split("-").map(Number);
          const lastDay = new Date(year, month, 0).getDate();
          setEndDate(`${e.target.value}-${String(lastDay).padStart(2, "0")}`);
        }}
      />
    </label>
  );
});

export const DateRangePicker: React.FC<RangeProps> = React.memo(function DateRangePicker({
  startDate,
  endDate,
  setStartDate,
  setEndDate
}) {
  return (
    <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
      <span>시작</span>
      <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      <span>종료</span>
      <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
    </label>
  );
});
