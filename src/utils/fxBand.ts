/**
 * 환율 밴드(G2) — "지금 USD/KRW 환율이 최근 1년 분포의 어디쯤인가"를 순수 계산한다.
 *
 * 입력은 buildFxHistory(portfolioHistory.ts)가 합본한 환율 이력(일별 historicalDailyFx + 반월
 * marketEnvSnapshots). 보존 압축 정책상 최근 180일은 일별, 그 이전은 월당 1건(≈월말)만 남는다.
 *
 * ── 일수 가중 규칙(최근 편향 방지) ──────────────────────────────────────────
 * 표본을 "그 날부터 다음 표본 전날까지" 대표하는 계단 함수로 보고, 각 표본에 **대표 일수**를
 * 가중치로 준다(일별 구간은 1일, 월말 1건은 ≈30일). 그래야 1년 창에서 최근 180일(180표본)이
 * 이전 185일(≈6표본)을 압도하지 않는다. 단, 한 표본이 무한정 구간을 대표하면 오래된 값 하나가
 * 창 전체를 채울 수 있으므로 대표 일수는 MAX_SPAN_DAYS(31 — 월말 1건의 정당한 범위)로 자른다.
 * 창 시작일 이전의 마지막 표본도 같은 규칙으로 창 안쪽을 대표한다.
 *
 * coverage = 대표되는 일수 합 / 창 일수. MIN_COVERAGE(60%) 미만이면 분포가 의미 없으므로 band=null.
 *
 * 현재 환율(current)은 '오늘' 표본으로 분포에 포함한다(이력의 오늘자 값은 current로 대체).
 * percentileOfCurrent = (현재보다 낮은 일수 + 같은 일수/2) / 전체 일수 × 100.
 *
 * 소비처: 주식 탭 환율 pill 툴팁, 환전 폼 힌트, USD 매수 힌트 (읽기 전용).
 */
import type { FxPoint } from "./portfolioHistory";
import { addDaysToIso, parseIsoLocal } from "./date";

/** 한 표본이 대표할 수 있는 최대 일수 — 월말 1건 압축 정책의 정당한 범위 */
const MAX_SPAN_DAYS = 31;
/** 이 비율 미만으로 창이 채워지면 분포를 신뢰하지 않는다 */
const MIN_COVERAGE = 0.6;
const DEFAULT_WINDOW_DAYS = 365;

export interface FxBand {
  min: number;
  max: number;
  p25: number;
  p50: number;
  p75: number;
  /** 현재 환율의 분포 내 위치 0~100 (낮을수록 원화 강세=달러가 쌈). current 미로드면 null */
  percentileOfCurrent: number | null;
  /** 최근 20/60일 단순 이동평균(일수 가중·current 포함). 해당 구간 coverage 부족이면 null */
  ma20: number | null;
  ma60: number | null;
  /** 창 안에서 실제로 쓰인 표본(날짜) 수 */
  sampleDays: number;
  /** 창 일수 대비 표본이 대표하는 일수 비율 0~1 */
  coverage: number;
  windowDays: number;
}

export interface FxBandResult {
  band: FxBand | null;
  /** band=null 사유 (표시용). band가 있으면 null */
  reason: string | null;
  coverage: number;
  sampleDays: number;
}

interface FxBandOptions {
  windowDays?: number;
}

interface WeightedSample {
  rate: number;
  weight: number;
}

interface WindowStats {
  samples: WeightedSample[];
  coveredDays: number;
  totalDays: number;
}

/** 두 ISO 날짜 차이(일). b-a. 파싱 실패 시 0 */
function diffDays(a: string, b: string): number {
  const da = parseIsoLocal(a);
  const db = parseIsoLocal(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

/**
 * [start, end] 창에서 각 표본의 대표 일수를 계산. points는 날짜 오름차순·중복 없음 가정.
 * 표본 i의 대표 구간 = [date_i, min(date_{i+1}-1, date_i+MAX_SPAN-1, end)] ∩ [start, end].
 */
function weighWindow(points: FxPoint[], start: string, end: string): WindowStats {
  const totalDays = diffDays(start, end) + 1;
  const samples: WeightedSample[] = [];
  let coveredDays = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.date > end) break;
    const next = points[i + 1];
    // 대표 구간 끝(포함): 다음 표본 전날 / 최대 대표일 / 창 끝 중 가장 이른 날
    const spanEndByNext = next ? addDaysToIso(next.date, -1) : end;
    const spanEndByCap = addDaysToIso(p.date, MAX_SPAN_DAYS - 1);
    let spanEnd = spanEndByNext < spanEndByCap ? spanEndByNext : spanEndByCap;
    if (spanEnd > end) spanEnd = end;
    const spanStart = p.date < start ? start : p.date;
    if (spanEnd < spanStart) continue; // 창 밖
    const w = diffDays(spanStart, spanEnd) + 1;
    samples.push({ rate: p.rate, weight: w });
    coveredDays += w;
  }
  return { samples, coveredDays, totalDays };
}

/** 가중 분위수 — 환율 오름차순 누적 가중치가 p×총합에 처음 도달하는 표본의 환율 */
function weightedQuantile(sorted: WeightedSample[], total: number, p: number): number {
  const target = p * total;
  let acc = 0;
  for (const s of sorted) {
    acc += s.weight;
    if (acc >= target - 1e-9) return s.rate;
  }
  return sorted[sorted.length - 1].rate;
}

function weightedMean(samples: WeightedSample[]): number {
  let sum = 0;
  let w = 0;
  for (const s of samples) {
    sum += s.rate * s.weight;
    w += s.weight;
  }
  return w > 0 ? sum / w : 0;
}

/** 최근 n일 이동평균 — 구간 coverage가 MIN_COVERAGE 미만이면 null */
function movingAverage(points: FxPoint[], today: string, n: number): number | null {
  const stats = weighWindow(points, addDaysToIso(today, -(n - 1)), today);
  if (stats.totalDays <= 0 || stats.coveredDays / stats.totalDays < MIN_COVERAGE) return null;
  return weightedMean(stats.samples);
}

/**
 * 환율 밴드 계산.
 * @param fxHistory buildFxHistory 결과(정렬 불문 — 내부에서 정리)
 * @param current 현재 환율(null=미로드). 오늘 표본으로 분포에 포함
 * @param today YYYY-MM-DD (KST) — 호출부가 주입(순수성)
 */
export function buildFxBand(
  fxHistory: FxPoint[],
  current: number | null,
  today: string,
  options: FxBandOptions = {}
): FxBandResult {
  const windowDays = Math.max(1, Math.floor(options.windowDays ?? DEFAULT_WINDOW_DAYS));
  const empty = (reason: string, coverage = 0, sampleDays = 0): FxBandResult => ({
    band: null,
    reason,
    coverage,
    sampleDays,
  });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !parseIsoLocal(today)) return empty("기준일이 올바르지 않습니다");

  // 날짜별 단일화 + 손상 항목 제거 + 현재 환율을 오늘 표본으로
  const byDate = new Map<string, number>();
  for (const f of fxHistory) {
    if (!f?.date || !(Number(f.rate) > 0) || f.date > today) continue;
    byDate.set(f.date, f.rate);
  }
  const hasCurrent = current != null && Number(current) > 0;
  if (hasCurrent) byDate.set(today, current);
  const points: FxPoint[] = Array.from(byDate.entries())
    .map(([date, rate]) => ({ date, rate }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const start = addDaysToIso(today, -(windowDays - 1));
  const stats = weighWindow(points, start, today);
  const coverage = stats.totalDays > 0 ? stats.coveredDays / stats.totalDays : 0;
  const sampleDays = stats.samples.length;

  if (sampleDays === 0) return empty("환율 이력이 없습니다", 0, 0);
  if (coverage < MIN_COVERAGE) {
    return empty(
      `환율 이력이 최근 ${windowDays}일의 ${Math.round(coverage * 100)}%만 있어 밴드를 계산하지 않습니다`,
      coverage,
      sampleDays
    );
  }

  const sorted = [...stats.samples].sort((a, b) => a.rate - b.rate);
  const total = stats.coveredDays;
  const min = sorted[0].rate;
  const max = sorted[sorted.length - 1].rate;

  let percentileOfCurrent: number | null = null;
  if (hasCurrent) {
    let below = 0;
    let equal = 0;
    for (const s of sorted) {
      if (s.rate < current) below += s.weight;
      else if (s.rate === current) equal += s.weight;
    }
    percentileOfCurrent = ((below + equal / 2) / total) * 100;
  }

  return {
    band: {
      min,
      max,
      p25: weightedQuantile(sorted, total, 0.25),
      p50: weightedQuantile(sorted, total, 0.5),
      p75: weightedQuantile(sorted, total, 0.75),
      percentileOfCurrent,
      ma20: movingAverage(points, today, 20),
      ma60: movingAverage(points, today, 60),
      sampleDays,
      coverage,
      windowDays,
    },
    reason: null,
    coverage,
    sampleDays,
  };
}

export type FxBandTone = "cheap" | "expensive" | "neutral";

export interface FxBandLabel {
  /** 예: "최근 1년 하위 28% — 쌈" */
  text: string;
  tone: FxBandTone;
}

/** 싸다/비싸다 판정 문턱(백분위) */
const CHEAP_PCT = 30;
const EXPENSIVE_PCT = 70;

/** 밴드 → 한 줄 라벨. percentileOfCurrent 없으면 null. 색 의미: 쌈=--accent(파랑), 비쌈=--danger(빨강) */
export function describeFxBand(band: FxBand | null): FxBandLabel | null {
  if (!band || band.percentileOfCurrent == null) return null;
  const pct = band.percentileOfCurrent;
  const periodLabel = band.windowDays >= 360 ? "최근 1년" : `최근 ${band.windowDays}일`;
  const tone: FxBandTone = pct <= CHEAP_PCT ? "cheap" : pct >= EXPENSIVE_PCT ? "expensive" : "neutral";
  const posText =
    pct <= 50 ? `하위 ${Math.round(pct)}%` : `상위 ${Math.round(100 - pct)}%`;
  const verdict = tone === "cheap" ? "쌈" : tone === "expensive" ? "비쌈" : "중간";
  return { text: `${periodLabel} ${posText} — ${verdict}`, tone };
}

/** 라벨 톤 → CSS 변수 색 */
export function fxBandToneColor(tone: FxBandTone): string {
  return tone === "cheap" ? "var(--accent)" : tone === "expensive" ? "var(--danger)" : "var(--text-muted)";
}
