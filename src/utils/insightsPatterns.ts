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
import { isCreditPayment } from "./category";
import { expenseMainName } from "./categoryMerge";

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
  // 대분류별 entries — expenseMainName 단일 소스 (raw 폴백은 표준 스키마에서 "지출" 한 덩어리가
  // 되어 z-score 표본군이 뭉개진다). 신용결제 방어는 호출부의 fExp 사전 필터와 별개인 독립 계약
  // (insightsPatterns.test가 필터 안 된 입력으로 직접 검증) — isCreditPayment로 sub 세대까지 커버.
  const bySub = new Map<string, { date: string; desc: string; cat: string; amount: number }[]>();
  for (const l of fExp) {
    if (isCreditPayment(l)) continue;
    const sub = expenseMainName(l); if (!sub) continue;
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
 * 집계 구간 = [max(첫 달 1일, firstSpendIso), min(마지막 달 말일, 오늘, lastRecordedIso)].
 * - 첫 지출 전(초기 잔액 이체만 있던 달)은 "무지출"이 아니라 "기록 전" — 예전엔 2025-06 한 달이 31일 무지출로 잡혀
 *   재미 기록(첫~마지막 지출일 기준 4일)과 최장 무지출이 31일 vs 4일로 어긋났다.
 * - 마지막 기록일 이후(캡처를 모았다가 한꺼번에 입력)도 무지출이 아니다 — "현재 5일 연속 무지출"은 기록 공백이었다.
 */
export function computePatternStats(params: {
  fExp: LedgerEntry[];
  months: string[];
  ml: Record<string, string>;
  todayIso: string;
  /** 장부 첫 지출일 — 이전 날짜는 집계하지 않음 */
  firstSpendIso?: string | null;
  /** 오늘 이하 마지막 기록일(지출·수입·이체 무관) — 이후 날짜는 집계하지 않음 */
  lastRecordedIso?: string | null;
}): PatternStats {
  const { fExp, months, ml, todayIso } = params;
  const capIso = params.lastRecordedIso && params.lastRecordedIso < todayIso ? params.lastRecordedIso : todayIso;
  const floorIso = params.firstSpendIso ?? null;
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
  const capDate = parseIsoLocal(capIso)!;
  let start = parseIsoLocal(months[0] + "-01");
  const floorDate = floorIso ? parseIsoLocal(floorIso) : null;
  if (start && floorDate && floorDate > start) start = floorDate;
  const [ly, lm] = months[months.length - 1].split("-").map(Number);
  let end = new Date(ly, lm, 0); // 마지막 월의 말일
  if (end > capDate) end = capDate; // 오늘·마지막 기록일로 캡 — 기록 없는 날은 집계 대상 아님
  if (!start || end < start) return emptyStats;
  const startIso = formatIsoLocal(start);
  const endIso = formatIsoLocal(end);
  let longestSpend = 0, longestZero = 0, curSpend = 0, curZero = 0;
  for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const iso = formatIsoLocal(cur);
    if (spendDaySet.has(iso)) { curSpend++; curZero = 0; if (curSpend > longestSpend) longestSpend = curSpend; }
    else { curZero++; curSpend = 0; if (curZero > longestZero) longestZero = curZero; }
  }
  const lastIso = formatIsoLocal(end);
  const currentStreakType: "none" | "spend" | "zero" = spendDaySet.has(lastIso) ? "spend" : "zero";
  const currentStreakDays = currentStreakType === "spend" ? curSpend : curZero;

  // 월별 무지출일 — 같은 집계 구간(첫 지출일 ~ 마지막 기록일)만 센다. totalDays = 그 달의 집계 일수
  const zeroDaysPerMonth = months.map((m) => {
    const [y, mo] = m.split("-").map(Number);
    const daysInMonth = new Date(y, mo, 0).getDate();
    let zd = 0, td = 0;
    for (let dd = 1; dd <= daysInMonth; dd++) {
      const iso = `${m}-${String(dd).padStart(2, "0")}`;
      if (iso < startIso || iso > endIso) continue;
      td++;
      if (!spendDaySet.has(iso)) zd++;
    }
    return { month: m, label: ml[m], zeroDays: zd, totalDays: td };
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
