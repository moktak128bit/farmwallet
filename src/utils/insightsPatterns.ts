/**
 * 인사이트 소비 패턴 지표 — 순수 모듈 (useInsightsData에서 분리, 점진적 리팩터).
 *  - computeEntryOutliers: 중분류 내 z-score 단건 지출 이상치 TOP
 *  - computePatternStats: 소비/무지출 스트릭·월별 무지출일·평균 거래 간격
 *
 * 날짜는 KST·parseIsoLocal/formatIsoLocal (UTC 혼용 시 음수 타임존에서 하루 밀림).
 * 시계(todayIso)는 주입받는다 — 순수·테스트 가능, 미래 일자는 집계 대상 아님.
 */
import type { LedgerEntry } from "../types";
import { parseIsoLocal, formatIsoLocal } from "./date";

export interface EntryOutlier {
  date: string;
  desc: string;
  sub: string;
  cat: string;
  amount: number;
  zScore: number;
  avg: number;
}

/** 단건 지출 이상치 TOP — 중분류별 z-score |z|≥2, 표본 4건 미만 카테고리는 건너뜀. */
export function computeEntryOutliers(fExp: LedgerEntry[]): EntryOutlier[] {
  // subCategory별 entries
  const bySub = new Map<string, { date: string; desc: string; cat: string; amount: number }[]>();
  for (const l of fExp) {
    if (l.category === "신용결제") continue;
    const sub = (l.subCategory || l.category || "").trim(); if (!sub) continue;
    if (!bySub.has(sub)) bySub.set(sub, []);
    bySub.get(sub)!.push({ date: l.date || "", desc: l.description || "", cat: l.category || "", amount: Number(l.amount) });
  }
  const outliers: EntryOutlier[] = [];
  for (const [sub, entries] of bySub) {
    if (entries.length < 4) continue; // 표본 작은 카테고리는 건너뜀
    const mean = entries.reduce((s, e) => s + e.amount, 0) / entries.length;
    const variance = entries.reduce((s, e) => s + (e.amount - mean) ** 2, 0) / entries.length;
    const std = Math.sqrt(variance);
    if (std <= 0) continue;
    for (const e of entries) {
      const z = (e.amount - mean) / std;
      if (Math.abs(z) >= 2) outliers.push({ date: e.date, desc: e.desc, sub, cat: e.cat, amount: e.amount, zScore: z, avg: mean });
    }
  }
  return outliers.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore)).slice(0, 10);
}

export interface PatternStats {
  longestSpendStreak: number;
  longestZeroStreak: number;
  currentStreakType: "none" | "spend" | "zero";
  currentStreakDays: number;
  zeroDaysPerMonth: { month: string; label: string; zeroDays: number; totalDays: number }[];
  avgIntervalDays: number;
}

/**
 * 소비 스트릭·월별 무지출일·거래 간격.
 * 루프 끝을 오늘(todayIso)로 캡 — 미래 날짜를 무지출일로 세지 않음.
 */
export function computePatternStats(params: {
  fExp: LedgerEntry[];
  months: string[];
  ml: Record<string, string>;
  todayIso: string;
}): PatternStats {
  const { fExp, months, ml, todayIso } = params;
  const emptyStats: PatternStats = {
    longestSpendStreak: 0,
    longestZeroStreak: 0,
    currentStreakType: "none",
    currentStreakDays: 0,
    zeroDaysPerMonth: [],
    avgIntervalDays: 0,
  };
  const spendDaySet = new Set<string>();
  for (const l of fExp) if (l.date) spendDaySet.add(l.date);
  if (months.length === 0) return emptyStats;
  const todayDate = parseIsoLocal(todayIso)!;
  const start = parseIsoLocal(months[0] + "-01");
  const [ly, lm] = months[months.length - 1].split("-").map(Number);
  let end = new Date(ly, lm, 0); // 마지막 월의 말일
  if (end > todayDate) end = todayDate; // 오늘로 캡 — 미래 일자는 집계 대상 아님
  if (!start || end < start) return emptyStats;
  let longestSpend = 0, longestZero = 0, curSpend = 0, curZero = 0;
  for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const iso = formatIsoLocal(cur);
    if (spendDaySet.has(iso)) { curSpend++; curZero = 0; if (curSpend > longestSpend) longestSpend = curSpend; }
    else { curZero++; curSpend = 0; if (curZero > longestZero) longestZero = curZero; }
  }
  const lastIso = formatIsoLocal(end);
  const currentStreakType: "none" | "spend" | "zero" = spendDaySet.has(lastIso) ? "spend" : "zero";
  const currentStreakDays = currentStreakType === "spend" ? curSpend : curZero;

  const curMonthIso = todayIso.slice(0, 7);
  const zeroDaysPerMonth = months.map((m) => {
    const [y, mo] = m.split("-").map(Number);
    const daysInMonth = new Date(y, mo, 0).getDate();
    // 진행 중인 달은 오늘까지만, 미래 달은 0일 — 미래를 무지출로 세지 않음
    const lastDay = m > curMonthIso ? 0
      : m === curMonthIso ? Math.min(daysInMonth, Number(todayIso.slice(8, 10)))
      : daysInMonth;
    let zd = 0;
    for (let dd = 1; dd <= lastDay; dd++) {
      const iso = `${m}-${String(dd).padStart(2, "0")}`;
      if (!spendDaySet.has(iso)) zd++;
    }
    return { month: m, label: ml[m], zeroDays: zd, totalDays: lastDay };
  });

  const sortedSpendDays = Array.from(spendDaySet).sort();
  let sumGap = 0, gapCount = 0;
  for (let i = 1; i < sortedSpendDays.length; i++) {
    const a = parseIsoLocal(sortedSpendDays[i - 1]);
    const b = parseIsoLocal(sortedSpendDays[i]);
    if (!a || !b) continue;
    sumGap += Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
    gapCount++;
  }
  const avgIntervalDays = gapCount > 0 ? sumGap / gapCount : 0;

  return { longestSpendStreak: longestSpend, longestZeroStreak: longestZero, currentStreakType, currentStreakDays, zeroDaysPerMonth, avgIntervalDays };
}
