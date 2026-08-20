/**
 * 환율 이력 backfill(순수) — historicalDailyFx의 결번 날짜를 Yahoo 과거 종가(USDKRW=X)로 보강한다.
 * useDailyFxRecorder는 앱을 연 날만 1건 적립하므로, 안 연 날은 결번 → 과거 TWR·양도세 환산이
 * marketEnvSnapshots(반월)/가장 가까운 날짜로 보간된다. backfill은 **기존 값은 절대 건드리지 않고**
 * 없는 날짜만 append한다(사용자 기기에서 그날 실제 받은 환율이 Yahoo 종가보다 우선).
 *
 * 오늘 날짜는 backfill 대상이 아니다 — Yahoo의 당일 포인트는 장중 값(미확정)이고, 당일은
 * useDailyFxRecorder가 신선값으로 적립한다. 오늘 결번은 다음 날 backfill이 확정 종가로 채운다.
 */
import type { HistoricalDailyFx } from "../types";
import { compactDailyFx } from "./dailyFx";
import { addDaysToIso, parseIsoLocal } from "./date";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface MissingFxDatesOptions {
  /** 오늘 기준 며칠 전까지 결번을 찾을지 (기본 180 = dailyFx 일별 보존 구간) */
  recentDays?: number;
}

/**
 * [today-recentDays, today-1] 구간에서 historicalDailyFx에 없는 날짜 목록(오름차순).
 * 토·일(KST)은 제외 — Yahoo는 영업일만 주므로 어차피 채울 수 없고, 주말만 비어 있을 때
 * 불필요한 fetch를 피하려는 판정에 쓰인다. 공휴일은 남는다(12h throttle로 감당).
 */
export function missingFxDates(
  existing: HistoricalDailyFx[] | undefined,
  today: string,
  options: MissingFxDatesOptions = {}
): string[] {
  const recentDays = options.recentDays ?? 180;
  if (!ISO_DATE.test(today) || !(recentDays > 0)) return [];
  const have = new Set<string>();
  for (const f of existing ?? []) {
    if (f?.date && Number(f.rate) > 0) have.add(f.date);
  }
  const missing: string[] = [];
  for (let back = recentDays; back >= 1; back -= 1) {
    const date = addDaysToIso(today, -back);
    if (have.has(date)) continue;
    const d = parseIsoLocal(date);
    if (!d) continue;
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    missing.push(date);
  }
  return missing;
}

interface FxBackfillMergeResult {
  /** 압축 정책(compactDailyFx)까지 적용된 다음 배열 */
  next: HistoricalDailyFx[];
  /** 새로 append된 날짜 수 */
  added: number;
}

/**
 * Yahoo에서 받은 (date, close) 목록을 historicalDailyFx에 병합한다.
 * - 기존 날짜의 값은 **불변** (신선 적립값 > 종가).
 * - 없는 날짜만 append. today 이후(오늘 포함)·0/NaN·형식 불량은 무시.
 * - 결과는 upsertDailyFx와 같은 보존 압축을 거친다.
 * @returns 추가된 것이 없으면 null (호출부가 기존 참조를 유지)
 */
export function mergeFxBackfill(
  existing: HistoricalDailyFx[] | undefined,
  fetched: Array<{ date: string; close: number }>,
  today: string
): FxBackfillMergeResult | null {
  if (!ISO_DATE.test(today)) return null;
  const map = new Map<string, HistoricalDailyFx>();
  for (const f of existing ?? []) {
    if (!f?.date || !(Number(f.rate) > 0)) continue;
    map.set(f.date, { date: f.date, rate: f.rate });
  }
  let added = 0;
  for (const row of fetched) {
    const date = row?.date;
    const rate = Number(row?.close);
    if (!date || !ISO_DATE.test(date) || !Number.isFinite(rate) || rate <= 0) continue;
    if (date >= today) continue;
    if (map.has(date)) continue;
    map.set(date, { date, rate });
    added += 1;
  }
  if (added === 0) return null;
  return { next: compactDailyFx([...map.values()], today), added };
}
