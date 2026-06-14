/**
 * 일별 종가 적립 — 시세 갱신 때마다 "현재 보유 종목"의 당일 가격을
 * historicalDailyCloses에 쌓는다 (배당 성장 차트의 월말 종가 소스).
 *
 * 무게 관리 (10년 누적해도 수백 KB 수준):
 *  - 보유 종목만, 종목·날짜당 1건 (같은 날 재갱신 시 마지막 값으로 교체)
 *  - 최근 RECENT_DAYS는 일별 유지, 그 이전은 종목·월당 마지막 1건(≈월말 종가)으로 압축
 *  - 저장은 캐시 슬롯(farmwallet-cache-v1)으로 분리 — 메인 데이터·백업·Gist 무게에 영향 없음
 */
import type { HistoricalDailyClose, StockPrice, StockTrade } from "../types";
import { canonicalTickerForMatch, getCurrentHoldingsTickers } from "./finance";
import { formatIsoLocal, parseIsoLocal } from "./date";

/** 이 일수 이내는 일별 보존, 그보다 오래되면 월당 1건으로 압축 */
const RECENT_DAYS = 120;

/**
 * 당일 종가 적립 + 보존 압축. 변경이 없으면 null을 반환해 호출부가 기존 참조를 유지하게 한다.
 * @param today YYYY-MM-DD (KST)
 */
export function upsertDailyCloses(
  existing: HistoricalDailyClose[] | undefined,
  prices: StockPrice[],
  trades: StockTrade[],
  today: string
): HistoricalDailyClose[] | null {
  const held = new Set(getCurrentHoldingsTickers(trades));
  if (held.size === 0 && (existing?.length ?? 0) === 0) return null;

  // key = ticker|date — 종목·날짜당 1건
  const map = new Map<string, HistoricalDailyClose>();
  for (const c of existing ?? []) {
    const t = canonicalTickerForMatch(c.ticker);
    if (!t || !c.date || !(Number(c.close) > 0)) continue; // 손상 항목은 이번 기회에 정리
    map.set(`${t}|${c.date}`, { ...c, ticker: t });
  }

  let changed = map.size !== (existing?.length ?? 0);

  // 보유 종목 시세 upsert — 시세의 체결일(updatedAt, KST) 날짜로 기록.
  // '오늘 날짜'로 고정 기록하면 갱신 실패로 남은 며칠 전 가격이 오늘 종가로 오기록되고,
  // 주말·휴장일 갱신 시 금요일 종가가 버려진다 — 체결일 기록은 둘 다 해결.
  for (const p of prices) {
    const t = canonicalTickerForMatch(p.ticker ?? "");
    if (!t || !held.has(t)) continue;
    const close = Number(p.price);
    if (!Number.isFinite(close) || close <= 0) continue;
    const updatedMs = p.updatedAt ? Date.parse(p.updatedAt) : NaN;
    if (!Number.isFinite(updatedMs)) continue; // 신선도를 알 수 없는 시세는 적립하지 않음
    const closeDay = new Date(updatedMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (closeDay > today) continue; // 시계 왜곡 방어
    const key = `${t}|${closeDay}`;
    const prev = map.get(key);
    if (prev && prev.close === close) continue;
    map.set(key, { ticker: t, date: closeDay, close, currency: p.currency });
    changed = true;
  }

  // 보존 압축: cutoff 이전은 종목·월당 마지막 1건만
  const base = parseIsoLocal(today);
  let cutoff = "";
  if (base) {
    base.setDate(base.getDate() - RECENT_DAYS);
    cutoff = formatIsoLocal(base);
  }
  const keepLatestPerMonth = new Map<string, HistoricalDailyClose>(); // ticker|YYYY-MM → 최신
  const recent: HistoricalDailyClose[] = [];
  for (const c of map.values()) {
    if (!cutoff || c.date >= cutoff) {
      recent.push(c);
      continue;
    }
    const mk = `${c.ticker}|${c.date.slice(0, 7)}`;
    const prev = keepLatestPerMonth.get(mk);
    if (!prev || c.date > prev.date) keepLatestPerMonth.set(mk, c);
  }
  const next = [...keepLatestPerMonth.values(), ...recent].sort(
    (a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker)
  );
  if (next.length !== map.size) changed = true;

  return changed ? next : null;
}
