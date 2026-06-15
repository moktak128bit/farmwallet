/**
 * 인사이트 추세 지표 — 진행 중인 달의 '같은 기간(1~오늘 일)' 비교를 다루는 순수 모듈.
 * (useInsightsData에서 분리, 점진적 리팩터)
 *
 * 셋 다 같은 함정을 피한다: 진행 중인 이번 달을 완료된 전월 '전체'와 비교하면
 * 월급일(예: 25일) 전까지 내내 급감/절약으로 왜곡됨 → 대상이 이번 달이면 전월·전년의
 * 같은 기간(1~오늘 일, partialDay)만 합산해 비교한다.
 *
 * 시계(todayDayNum)·이번달(curMonthStr)은 주입받는다 — 순수·테스트 가능.
 */
import type { LedgerEntry } from "../types";
import { isCarryOverIncomeEntry } from "./savingsRate";
import { isInvestmentEntry, isCreditPayment } from "./category";

export interface IncomeGrowth {
  series: { l: string; month: string; income: number; momPct: number | null }[];
  mom: number | null;
  yoy: number | null;
  avg3MoM: number | null;
  targetInc: number;
  prevInc: number;
  /** 대상 월이 진행 중인 이번 달이면 오늘 일자(1~N) — MoM/YoY가 전월·전년의 같은 기간(1~N일)과 비교됐음을 의미 */
  partialDay: number | null;
}

/**
 * 수입 성장률 시계열(MoM %) + 핵심 지표 MoM/YoY. 근로소득(salaryMonthly) 단일 기준.
 * 진행 중인 이번 달이 대상이면 전월·전년 동월의 같은 기간(1~오늘 일)과 비교.
 */
export function computeIncomeGrowth(params: {
  ledger: LedgerEntry[];
  months: string[];
  ml: Record<string, string>;
  salaryMonthly: Record<string, number>;
  salaryKeys: Set<string>;
  curMonthStr: string;
  anomalyTargetMonth: string | null;
  todayDayNum: number;
}): IncomeGrowth {
  const { ledger, months, ml, salaryMonthly, salaryKeys, curMonthStr, anomalyTargetMonth, todayDayNum } = params;
  /** month의 1~dayCap일 근로소득 합 — salaryMonthly와 동일 분류(이월 제외, salaryKeys만) */
  const incomeUpTo = (month: string, dayCap: number) => {
    let s = 0;
    for (const l of ledger) {
      if (l.kind !== "income" || !l.date?.startsWith(month)) continue;
      const a = Number(l.amount);
      if (a <= 0 || isCarryOverIncomeEntry(l)) continue;
      if (!salaryKeys.has(l.subCategory || l.category || "")) continue;
      if (Number(l.date.slice(8, 10)) > dayCap) continue;
      s += a;
    }
    return s;
  };
  const series = months.map((m, i) => {
    const cur = salaryMonthly[m] ?? 0;
    const prev = i > 0 ? salaryMonthly[months[i - 1]] ?? 0 : 0;
    // 진행 중인 달은 시계열에서 MoM 점 생략 (부분 vs 전체 비교 왜곡)
    const mom = m === curMonthStr ? null : prev > 0 ? ((cur - prev) / prev) * 100 : null;
    return { l: ml[m], month: m, income: cur, momPct: mom };
  });
  const targetMonth = anomalyTargetMonth ?? (months.length ? months[months.length - 1] : null);
  const targetIdx = targetMonth ? months.indexOf(targetMonth) : -1;
  const partialDay = targetMonth === curMonthStr ? todayDayNum : null;
  let targetInc = targetIdx >= 0 ? salaryMonthly[months[targetIdx]] : 0;
  let prevInc = targetIdx > 0 ? salaryMonthly[months[targetIdx - 1]] : 0;
  if (partialDay != null && targetMonth && targetIdx > 0) {
    // 전월 동기(1~오늘 일) 비교
    targetInc = incomeUpTo(targetMonth, partialDay);
    prevInc = incomeUpTo(months[targetIdx - 1], partialDay);
  }
  const mom = prevInc > 0 ? ((targetInc - prevInc) / prevInc) * 100 : null;
  // YoY: 12개월 전 같은 달 (진행 중인 달이면 작년 동월도 같은 기간으로)
  let yoy: number | null = null;
  if (targetMonth) {
    const [y, mo] = targetMonth.split("-").map(Number);
    const yoyKey = `${y - 1}-${String(mo).padStart(2, "0")}`;
    const yoyInc = partialDay != null ? incomeUpTo(yoyKey, partialDay) : salaryMonthly[yoyKey] ?? 0;
    if (yoyInc > 0) yoy = ((targetInc - yoyInc) / yoyInc) * 100;
  }
  // 3-month avg MoM growth — 완결 월의 momPct만 사용
  const last3Moms = series.map((s) => s.momPct).filter((x): x is number => x != null).slice(-3);
  const avg3MoM = last3Moms.length > 0 ? last3Moms.reduce((s, x) => s + x, 0) / last3Moms.length : null;
  return { series, mom, yoy, avg3MoM, targetInc, prevInc, partialDay };
}

export interface SpendingInertia {
  curExp: number;
  avg: number;
  deviation: number | null;
  lookbackMonths: number;
  /** 진행 중인 달이면 오늘 일자 — avg가 과거 3개월의 같은 기간(1~N일) 평균임을 의미 */
  partialDay: number | null;
}

/**
 * 지출 관성: 현재월 지출 vs 최근 3개월 평균.
 * 진행 중인 달이면 과거 3개월도 같은 기간(1~오늘 일)만 합산 — 월중 항상 "절약 모드" 왜곡 방지.
 */
export function computeSpendingInertia(params: {
  ledger: LedgerEntry[];
  months: string[];
  monthly: Record<string, { income: number; expense: number; investment: number }>;
  curMonthStr: string;
  anomalyTargetMonth: string | null;
  todayDayNum: number;
}): SpendingInertia | null {
  const { ledger, months, monthly, curMonthStr, anomalyTargetMonth, todayDayNum } = params;
  const targetMonth = anomalyTargetMonth ?? (months.length ? months[months.length - 1] : null);
  if (!targetMonth) return null;
  const idx = months.indexOf(targetMonth);
  if (idx < 0) return null;
  const partialDay = targetMonth === curMonthStr ? todayDayNum : null;
  /** month의 1~dayCap일 지출 합 — monthly[].expense와 동일 분류(재테크·신용결제 제외) */
  const expenseUpTo = (month: string, dayCap: number) => {
    let s = 0;
    for (const l of ledger) {
      if (l.kind !== "expense" || !l.date?.startsWith(month)) continue;
      const a = Number(l.amount);
      if (a <= 0 || isInvestmentEntry(l) || isCreditPayment(l)) continue;
      if (Number(l.date.slice(8, 10)) > dayCap) continue;
      s += a;
    }
    return s;
  };
  const curExp = monthly[targetMonth]?.expense ?? 0;
  const lookback = months.slice(Math.max(0, idx - 3), idx);
  if (lookback.length === 0) return null;
  const avg =
    partialDay != null
      ? lookback.reduce((s, m) => s + expenseUpTo(m, partialDay), 0) / lookback.length
      : lookback.reduce((s, m) => s + (monthly[m]?.expense ?? 0), 0) / lookback.length;
  const deviation = avg > 0 ? ((curExp - avg) / avg) * 100 : null;
  return { curExp, avg, deviation, lookbackMonths: lookback.length, partialDay };
}

export interface CategoryGrowthRow {
  sub: string;
  cur: number;
  avg3: number;
  /** 신규 카테고리(avg3=0)의 경우 Infinity — UI는 isNew로 분기 */
  pctChange: number;
  isNew: boolean;
}
interface CategoryGrowthResult {
  up: CategoryGrowthRow[];
  down: CategoryGrowthRow[];
  partialDay: number | null;
}

/**
 * 카테고리 성장률 TOP — 현재월 중분류 지출 vs 최근 3개월 평균.
 * 진행 중인 달이면 과거 3개월도 같은 기간(1~오늘 일)만 집계 — 월중 전부 "감소" 왜곡 방지.
 */
export function computeCategoryGrowth(params: {
  ledger: LedgerEntry[];
  months: string[];
  curMonthStr: string;
  anomalyTargetMonth: string | null;
  todayDayNum: number;
}): CategoryGrowthResult {
  const { ledger, months, curMonthStr, anomalyTargetMonth, todayDayNum } = params;
  const emptyRet: CategoryGrowthResult = { up: [], down: [], partialDay: null };
  const targetMonth = anomalyTargetMonth;
  if (!targetMonth) return emptyRet;
  const idx = months.indexOf(targetMonth);
  if (idx < 0) return emptyRet;
  const prevMonths = months.slice(Math.max(0, idx - 3), idx);
  if (prevMonths.length === 0) return emptyRet;
  const partialDay = targetMonth === curMonthStr ? todayDayNum : null;
  // subCategory별 월별 지출
  const subMonthly = new Map<string, Map<string, number>>();
  for (const l of ledger) {
    if (l.kind !== "expense" || Number(l.amount) <= 0) continue;
    if (l.category === "신용결제" || l.category === "재테크" || l.category === "환전") continue;
    const sub = (l.subCategory || l.category || "").trim(); if (!sub) continue;
    const mo = l.date?.slice(0, 7); if (!mo) continue;
    if (mo !== targetMonth && !prevMonths.includes(mo)) continue;
    if (partialDay != null && Number(l.date!.slice(8, 10)) > partialDay) continue;
    if (!subMonthly.has(sub)) subMonthly.set(sub, new Map());
    subMonthly.get(sub)!.set(mo, (subMonthly.get(sub)!.get(mo) ?? 0) + Number(l.amount));
  }
  const rows: CategoryGrowthRow[] = [];
  for (const [sub, mm] of subMonthly) {
    const cur = mm.get(targetMonth) ?? 0;
    const avg3 = prevMonths.reduce((s, m) => s + (mm.get(m) ?? 0), 0) / prevMonths.length;
    if (cur === 0 && avg3 === 0) continue;
    const isNew = avg3 === 0 && cur > 0;
    // pctChange: 신규 카테고리(avg3=0)는 정렬 편의상 큰 양수로 기록하되 isNew 플래그로 UI 구분
    const pct = avg3 > 0 ? ((cur - avg3) / avg3) * 100 : isNew ? Number.POSITIVE_INFINITY : 0;
    rows.push({ sub, cur, avg3, pctChange: pct, isNew });
  }
  const upRows = [...rows].filter((r) => r.cur > 50000 || r.avg3 > 50000).sort((a, b) => b.pctChange - a.pctChange).slice(0, 5);
  const downRows = [...rows].filter((r) => r.avg3 > 50000).sort((a, b) => a.pctChange - b.pctChange).slice(0, 5);
  return { up: upRows, down: downRows, partialDay };
}
