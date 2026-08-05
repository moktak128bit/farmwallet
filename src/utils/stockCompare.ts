/**
 * 종목 비교 차트 — 여러 종목의 일별 종가를 기준일=1 배수로 정규화해 한 차트에 겹치는 순수 로직.
 * 네트워크 없음: closes는 fetchStockLookup/fetchHistoricalCloses 결과를 그대로 받는다.
 * KR·US 혼합 시 거래일 캘린더가 달라 합집합 날짜를 쓰고, 빠진 날은 recharts connectNulls로 잇는다.
 */
import type { DailyClose } from "./stockLookup";

export interface CompareSeries {
  ticker: string;
  closes: DailyClose[];
}

export interface CompareRow {
  date: string;
  /** ticker → 기준일 대비 배수 (해당 날짜에 거래가 없으면 키 자체가 없음) */
  [ticker: string]: number | string;
}

interface CompareResult {
  rows: CompareRow[];
  /** 각 시리즈의 정규화 기준점 (기준일 종가 = 1) */
  bases: Record<string, DailyClose>;
  /** 모든 시리즈가 데이터를 갖기 시작하는 공통 시작일 (시리즈가 없으면 null) */
  commonStart: string | null;
}

/** 모든 시리즈가 공통으로 데이터를 갖기 시작하는 날짜 = 각 시리즈 첫 거래일 중 가장 늦은 날. */
export function computeCommonStart(seriesList: CompareSeries[]): string | null {
  let latest: string | null = null;
  for (const s of seriesList) {
    const first = s.closes[0]?.date;
    if (!first) return null; // 빈 시리즈가 있으면 공통 구간 없음
    if (latest === null || first > latest) latest = first;
  }
  return latest;
}

/**
 * 비교 행 구성 — 공통 시작일 이후로 잘라 각 시리즈를 (자기 첫 종가 = 1)로 정규화.
 * 기준점은 공통 시작일 "이후 그 시리즈의 첫 거래일" 종가 (휴장일 어긋남 대비).
 */
export function buildCompareRows(seriesList: CompareSeries[]): CompareResult {
  const nonEmpty = seriesList.filter((s) => s.closes.length > 0);
  const commonStart = computeCommonStart(nonEmpty);
  if (!commonStart || nonEmpty.length === 0) return { rows: [], bases: {}, commonStart: null };

  const bases: Record<string, DailyClose> = {};
  const byDate = new Map<string, CompareRow>();
  for (const s of nonEmpty) {
    const window = s.closes.filter((c) => c.date >= commonStart);
    const base = window[0];
    if (!base || base.close <= 0) continue;
    bases[s.ticker] = base;
    for (const c of window) {
      let row = byDate.get(c.date);
      if (!row) {
        row = { date: c.date };
        byDate.set(c.date, row);
      }
      row[s.ticker] = c.close / base.close;
    }
  }
  const rows = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { rows, bases, commonStart };
}

/** 장기 구간 렌더 부담 완화 — 균등 샘플링하되 마지막 행은 항상 유지. */
export function downsampleRows<T>(rows: T[], maxPoints: number): T[] {
  if (rows.length <= maxPoints) return rows;
  const step = Math.ceil(rows.length / maxPoints);
  return rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
}

/** 마지막(최신) 배수 — 요약 칩용. 해당 티커 값이 있는 가장 최근 행에서 읽는다. */
export function latestMultiple(rows: CompareRow[], ticker: string): number | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i][ticker];
    if (typeof v === "number") return v;
  }
  return null;
}
