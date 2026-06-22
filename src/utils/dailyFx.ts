/**
 * 일별 USD/KRW 환율 적립 — 하루 1회, 그날의 환율을 historicalDailyFx에 쌓는다.
 * 과거 시점 USD 평가액을 일별로 복원(portfolioHistory)하기 위한 환율 백본.
 *
 * 보존 압축(utils/dailyCloses와 동일 정책): 최근 RECENT_DAYS는 일별 유지, 그 이전은
 * 월당 마지막 1건(≈월말 환율)으로 압축 — 10년 누적해도 수 KB. marketEnvSnapshots(반월)와
 * 함께 메인 데이터에 저장되어 Gist·백업에 그대로 동기화된다.
 */
import type { HistoricalDailyFx } from "../types";
import { formatIsoLocal, parseIsoLocal } from "./date";

const RECENT_DAYS = 180;

/**
 * 당일 환율 적립 + 보존 압축. 변경이 없으면 null을 반환해 호출부가 기존 참조를 유지하게 한다.
 * @param today YYYY-MM-DD (KST)
 */
export function upsertDailyFx(
  existing: HistoricalDailyFx[] | undefined,
  rate: number,
  today: string
): HistoricalDailyFx[] | null {
  if (!(Number(rate) > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;

  const map = new Map<string, HistoricalDailyFx>();
  for (const f of existing ?? []) {
    if (!f?.date || !(Number(f.rate) > 0)) continue; // 손상 항목 정리
    map.set(f.date, { date: f.date, rate: f.rate });
  }

  let changed = map.size !== (existing?.length ?? 0);

  const prev = map.get(today);
  if (!prev || prev.rate !== rate) {
    map.set(today, { date: today, rate });
    changed = true;
  }

  // 보존 압축: cutoff 이전은 월당 마지막 1건만
  const base = parseIsoLocal(today);
  let cutoff = "";
  if (base) {
    base.setDate(base.getDate() - RECENT_DAYS);
    cutoff = formatIsoLocal(base);
  }
  const keepLatestPerMonth = new Map<string, HistoricalDailyFx>(); // YYYY-MM → 최신
  const recent: HistoricalDailyFx[] = [];
  for (const f of map.values()) {
    if (!cutoff || f.date >= cutoff) {
      recent.push(f);
      continue;
    }
    const mk = f.date.slice(0, 7);
    const prevMonth = keepLatestPerMonth.get(mk);
    if (!prevMonth || f.date > prevMonth.date) keepLatestPerMonth.set(mk, f);
  }
  const next = [...keepLatestPerMonth.values(), ...recent].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  if (next.length !== map.size) changed = true;

  return changed ? next : null;
}
