/**
 * 시세 환경 박제 소급(backfill) — 순수 모듈.
 *
 * useMarketEnvSnapshotRecorder는 정확히 1일·15일에 앱을 열었을 때만 박제한다.
 * 그날 앱을 안 열면 그 점은 영구 결번이 되어 차트가 '현재가'로 폴백했다(과거 점이 매일 흔들림).
 * 하지만 일별 종가(historicalDailyCloses)와 일별 환율(historicalDailyFx)이 이미 쌓이므로,
 * 놓친 1일·15일을 **그 날짜 이전 가장 가까운 실측 종가·환율**로 소급 박제할 수 있다.
 *
 * 원칙:
 *  - 이미 있는 박제는 절대 덮어쓰지 않는다 (과거 시세 환경 불변).
 *  - 오늘은 제외 — 정시 기록기(당일 실시간 시세)의 몫.
 *  - 종가는 대상일 이전 MAX_CLOSE_LOOKBACK_DAYS 이내만 인정 — 그보다 오래된 값으로
 *    "박제"라 부르는 건 거짓이다. 없는 종목은 스냅샷에서 빠지고, 읽는 쪽
 *    (buildStockCostSnapshots)이 현재가 폴백 + "현재" 라벨로 정직하게 표시한다.
 *  - recordedAt은 주입(nowIso) — 소급 여부는 recordedAt과 date의 간격으로 감사 가능.
 */
import type { HistoricalDailyClose, MarketEnvSnapshot, StockTrade } from "../types";
import { buildHalfMonthSnapshotDates } from "./date";
import { canonicalTickerForMatch } from "./finance";
import { fxAsOf, type FxPoint } from "./portfolioHistory";

/** 종가 소급 인정 한도 — 월말 압축(120일 이전은 종목·월당 1건) 간격을 덮되 과도한 낡은 값 방지 */
const MAX_CLOSE_LOOKBACK_DAYS = 45;

const DUST = 1e-6;

function daysBetween(a: string, b: string): number {
  // YYYY-MM-DD 두 날짜의 일수 차 (b - a). UTC 파싱 금지 규칙과 무관한 순수 산술이 필요해
  // Date.UTC로 자정 고정 — 타임존 영향 없음.
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

interface BackfillParams {
  trades: StockTrade[];
  historicalDailyCloses: HistoricalDailyClose[] | undefined;
  fxHistory: FxPoint[];
  existingSnapshots: MarketEnvSnapshot[] | undefined;
  /** 환율 이력에 대상일 이전 값이 없을 때의 폴백 (현재 환율) */
  fallbackFxRate: number | null;
  today: string; // YYYY-MM-DD (KST)
  /** recordedAt에 기록할 현재 시각 (ISO) — 주입해 순수성 유지 */
  nowIso: string;
}

/**
 * 결번인 1일·15일의 소급 박제 목록을 만든다. 추가할 것이 없으면 빈 배열.
 * 반환된 스냅샷은 기존과 합쳐 date 정렬해 저장하면 된다 (기존 항목 불변).
 */
export function buildMissingMarketEnvSnapshots(params: BackfillParams): MarketEnvSnapshot[] {
  const { trades, historicalDailyCloses, fxHistory, existingSnapshots, fallbackFxRate, today, nowIso } = params;

  const dated = trades.filter((t) => !!t.date && !!t.ticker);
  if (dated.length === 0) return [];
  const firstTradeDate = dated.reduce((min, t) => (t.date < min ? t.date : min), dated[0].date).slice(0, 10);

  const existing = new Set((existingSnapshots ?? []).map((s) => s.date));
  const candidates = buildHalfMonthSnapshotDates(firstTradeDate, today)
    .filter((d) => d < today && !existing.has(d));
  if (candidates.length === 0) return [];

  // 종목·날짜별 종가 인덱스 (정규 티커)
  const closesByTicker = new Map<string, { date: string; close: number; currency?: string }[]>();
  for (const c of historicalDailyCloses ?? []) {
    const t = canonicalTickerForMatch(c.ticker);
    if (!t || !c.date || !(Number(c.close) > 0)) continue;
    let arr = closesByTicker.get(t);
    if (!arr) {
      arr = [];
      closesByTicker.set(t, arr);
    }
    arr.push({ date: c.date, close: c.close, currency: c.currency });
  }
  for (const arr of closesByTicker.values()) arr.sort((a, b) => a.date.localeCompare(b.date));
  if (closesByTicker.size === 0) return [];

  /** 대상일 이전 가장 가까운 종가 (한도 초과 시 null) */
  const closeAsOf = (ticker: string, date: string): { close: number; currency?: string } | null => {
    const arr = closesByTicker.get(ticker);
    if (!arr) return null;
    let best: { date: string; close: number; currency?: string } | null = null;
    for (const c of arr) {
      if (c.date > date) break;
      best = c;
    }
    if (!best) return null;
    if (daysBetween(best.date, date) > MAX_CLOSE_LOOKBACK_DAYS) return null;
    return { close: best.close, currency: best.currency };
  };

  // 시간순 거래를 날짜별로 누적하며 각 후보일의 보유 티커(순수량 > 0)를 구한다
  const sortedTrades = [...dated].sort((a, b) => a.date.localeCompare(b.date));
  const qtyByTicker = new Map<string, number>();
  let idx = 0;

  const out: MarketEnvSnapshot[] = [];
  for (const date of candidates) {
    while (idx < sortedTrades.length && sortedTrades[idx].date.slice(0, 10) <= date) {
      const t = sortedTrades[idx];
      const norm = canonicalTickerForMatch(t.ticker);
      if (norm) {
        const delta = t.side === "buy" ? t.quantity : -t.quantity;
        qtyByTicker.set(norm, (qtyByTicker.get(norm) ?? 0) + delta);
      }
      idx += 1;
    }

    const prices: MarketEnvSnapshot["prices"] = [];
    for (const [ticker, qty] of qtyByTicker.entries()) {
      if (qty <= DUST) continue;
      const c = closeAsOf(ticker, date);
      if (!c) continue; // 종가 없는 종목은 제외 — 읽는 쪽이 현재가 폴백 + 출처 라벨
      prices.push({ ticker, price: c.close, currency: c.currency });
    }
    if (prices.length === 0) continue; // 실측 근거가 하나도 없으면 박제하지 않는다

    const fx = fxAsOf(fxHistory, date, fallbackFxRate);
    if (!fx || fx <= 0) continue; // MarketEnvSnapshot.fxRate는 필수 — 환율 근거 없으면 보류

    out.push({ date, fxRate: fx, prices, recordedAt: nowIso });
  }

  return out;
}
