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
 * 보존 압축(순수): today 기준 최근 RECENT_DAYS는 일별 유지, 그 이전은 월당 마지막 1건(≈월말)만 남기고
 * 날짜 오름차순으로 정렬한다. upsertDailyFx(당일 적립)와 fxBackfill(결번 보강)이 같은 정책을 공유한다.
 * 입력에 같은 날짜가 중복되면 뒤의 항목이 이긴다.
 */
export function compactDailyFx(entries: HistoricalDailyFx[], today: string): HistoricalDailyFx[] {
  const map = new Map<string, HistoricalDailyFx>();
  for (const f of entries) map.set(f.date, f);
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
  return [...keepLatestPerMonth.values(), ...recent].sort((a, b) => a.date.localeCompare(b.date));
}

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

  const next = compactDailyFx([...map.values()], today);
  if (next.length !== map.size) changed = true;

  return changed ? next : null;
}

/** 환율 수신 시각(ISO)을 KST 날짜(YYYY-MM-DD)로 환산. 파싱 불가면 null. */
export function fxFetchedAtToKstDate(fetchedAt: string | null | undefined): string | null {
  if (!fetchedAt) return null;
  const ms = new Date(fetchedAt).getTime();
  if (!Number.isFinite(ms)) return null;
  const kst = new Date(ms + 9 * 60 * 60_000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

interface DailyFxRecordInput {
  /** 현재 컨텍스트 환율 (null=미로드) */
  rate: number | null;
  /** 환율 수신 시각 ISO (localStorage 캐시면 며칠 전일 수 있음) */
  fetchedAt: string | null;
  /** 오늘 YYYY-MM-DD (KST) */
  today: string;
  /** 이번 세션에서 '신선값'으로 이미 적립한 날짜 (없으면 null) */
  recordedFor: string | null;
}

/**
 * 오늘자 환율을 historicalDailyFx에 적립할지 판정.
 * - fetchedAt이 **오늘(KST)** 인 신선값만 적립 — localStorage 캐시(어제 이전 수신)를 오늘 날짜로 박제하지 않는다.
 * - 같은 날 이미 신선값으로 적립했으면 재적립하지 않는다(하루 1회). 날짜가 넘어가면(KST 자정) 다시 적립 대상.
 */
export function shouldRecordDailyFx(input: DailyFxRecordInput): boolean {
  const { rate, fetchedAt, today, recordedFor } = input;
  if (!(Number(rate) > 0)) return false;
  if (recordedFor === today) return false;
  const fetchedDate = fxFetchedAtToKstDate(fetchedAt);
  return fetchedDate !== null && fetchedDate === today;
}
