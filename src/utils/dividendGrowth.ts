/**
 * 배당 성장 추적 — "버핏의 코카콜라" 시계열.
 * 한 종목을 장기 적립할 때 ① 월 분배금 수령액(보유 증가 + 주당 분배금 성장),
 * ② 분배율(시장가 기준 연환산), ③ YOC(내 평단 기준 연환산), ④ 주가가
 * 시간에 따라 어떻게 변하는지를 월 단위로 만든다.
 *
 * 데이터 소스:
 *  - 분배금: ledger의 배당 수입 기록 (description "TICKER - 이름 배당", note "보유주식: N")
 *  - 보유 수량·평단: trades 누적 (이동평균법 — 매도 시 평단 유지, 원가만 비례 차감)
 *  - 주가: historicalDailyCloses(월말 종가) → 그 달의 마지막 거래가 → marketEnvSnapshots
 *          → (이번 달이면) 현재 시세 순 폴백
 */
import type { HistoricalDailyClose, LedgerEntry, MarketEnvSnapshot, StockPrice, StockTrade } from "../types";
import { canonicalTickerForMatch, isUSDStock } from "./finance";
import { isDividendEntryLoose } from "./categoryMatch";
import { parseQuantityFromNote } from "./dividend";

export interface DividendGrowthPoint {
  month: string; // YYYY-MM
  /** 차트 X축 라벨 — "25.07" 형식 (연도 포함, 12개월 초과 기간에서도 충돌 없음) */
  label: string;
  /** 월 수령 분배금 합 (원) */
  received: number;
  /** 월 주당 분배금 (원) = Σ(기록별 amount ÷ 기록 시점 보유주식) — 주배당이면 월 합산 */
  perShare: number | null;
  /** 월 기준 주가 (월말 종가 우선, 폴백 체인) */
  price: number | null;
  /** 월 분배율(%, 주가 대비) = 월 주당 분배금 ÷ 주가 × 100 */
  monthlyYield: number | null;
  /** 월 분배율(%, 내 매입금 대비) = 월 주당 분배금 ÷ 평단 × 100
   *  — 배당성장 지표: 분배율이 그대로여도 분배금이 자라면 이 선은 우상향 (버핏의 코카콜라) */
  monthlyYoc: number | null;
  /** 월말 보유 수량 */
  shares: number;
  /** 월말 평단 (이동평균, 수수료 포함) */
  avgCost: number | null;
}

export interface DividendGrowthData {
  ticker: string; // canonical
  name: string;
  points: DividendGrowthPoint[];
  /** 분배금 기록 수 */
  recordCount: number;
  current: {
    shares: number;
    avgCost: number | null;
    price: number | null;
    /** 최근 수령 월의 분배금 합 (원) */
    lastMonthReceived: number | null;
    /** 최근 수령 월의 주당 분배금 (원) */
    lastMonthPerShare: number | null;
    /** 최근 수령 월의 월 분배율 (%, 주가 대비) */
    lastMonthYield: number | null;
    /** 최근 수령 월의 월 분배율 (%, 내 매입금 대비) */
    lastMonthYoc: number | null;
    /** 연환산 주당 분배금 (최근 ≤12개월 평균 × 12) */
    annualPerShare: number | null;
    /** 분배율 (연환산, 현재가 기준 %) */
    marketYield: number | null;
    /** YOC (연환산, 평단 기준 %) — 버핏의 코카콜라 지표 */
    yoc: number | null;
  };
}

interface DividendStoryPoint {
  month: string;
  label: string;
  /** 누적 수령 분배금 (배당 눈덩이) */
  cumulativeReceived: number;
  /** 연환산 YOC (월 YOC × 12) — 내 배당률 여정 */
  annualYoc: number | null;
  /** 연환산 시장 분배율 (월 분배율 × 12) */
  annualMarketYield: number | null;
  /** 연간 배당 런레이트 = 그 시점 보유주식 × 연환산 주당분배금(직전 알려진 값 캐리포워드) */
  runRate: number | null;
}

interface DividendStory {
  points: DividendStoryPoint[];
  /** 지금까지 받은 분배금 총합 */
  totalReceived: number;
  /** 배당률 여정 시작 YOC(연환산, %) */
  startYoc: number | null;
  /** 현재 YOC(연환산, %) */
  nowYoc: number | null;
  /** YOC 증가폭 (%p) — '배당율 증가'를 한 숫자로 */
  yocGainPp: number | null;
  /** 현재 연간 배당 런레이트 (보유 × 연환산 주당분배금) */
  annualRunRate: number | null;
  monthlyRunRate: number | null;
}

/**
 * 배당 '모으는 재미' 스토리 — buildDividendGrowth 결과에서 누적 눈덩이·연환산 YOC 여정·연간 런레이트를 파생.
 * 작은 월 퍼센트에 묻힌 배당성장/배당율증가를 큰 숫자와 우상향 곡선으로 드러내기 위한 표시용 가공.
 */
export function buildDividendStory(data: DividendGrowthData): DividendStory {
  let cum = 0;
  let lastPerShare: number | null = null;
  const points: DividendStoryPoint[] = data.points.map((p) => {
    cum += p.received;
    if (p.perShare != null) lastPerShare = p.perShare;
    const annualYoc = p.monthlyYoc != null ? p.monthlyYoc * 12 : null;
    const annualMarketYield = p.monthlyYield != null ? p.monthlyYield * 12 : null;
    const runRate = lastPerShare != null && p.shares > 0 ? p.shares * lastPerShare * 12 : null;
    return { month: p.month, label: p.label, cumulativeReceived: cum, annualYoc, annualMarketYield, runRate };
  });
  const yocVals = points.filter((p) => p.annualYoc != null);
  const startYoc = yocVals.length ? yocVals[0].annualYoc : null;
  const nowYoc = yocVals.length ? yocVals[yocVals.length - 1].annualYoc : null;
  const yocGainPp = startYoc != null && nowYoc != null ? nowYoc - startYoc : null;
  const annualRunRate =
    data.current.annualPerShare != null && data.current.shares > 0
      ? data.current.shares * data.current.annualPerShare
      : null;
  return {
    points,
    totalReceived: cum,
    startYoc,
    nowYoc,
    yocGainPp,
    annualRunRate,
    monthlyRunRate: annualRunRate != null ? annualRunRate / 12 : null,
  };
}

/** description "458730 - TIGER 미국배당다우존스 배당"에서 티커 추출 */
const tickerFromDividendDesc = (desc: string | undefined): string | null => {
  const m = (desc || "").match(/^([A-Za-z0-9.-]+)\s*-/);
  return m ? canonicalTickerForMatch(m[1]) : null;
};

/** 배당 수입 기록 판정 — 분류 단일소스(categoryMatch.isDividendEntryLoose) + 양수 금액 */
const isDividendRecord = (l: LedgerEntry): boolean =>
  l.kind === "income" && Number(l.amount) > 0 && isDividendEntryLoose(l);

const monthSeq = (from: string, to: string): string[] => {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
};

/**
 * 추적 대상 티커 결정: 설정값(쉼표·공백 구분 복수 허용) 우선, min개 미만이면
 * "현재 보유 중 + 분배금 기록 ≥2건" 종목을 최근 수령일 순으로 보충. 최대 max개.
 */
export function resolveTrackedTickers(
  configured: string | undefined,
  ledger: LedgerEntry[],
  trades: StockTrade[],
  min = 2,
  max = 4
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tok of (configured || "").split(/[,\s]+/)) {
    const c = canonicalTickerForMatch(tok);
    if (c && !seen.has(c)) { seen.add(c); out.push(c); }
    if (out.length >= max) return out;
  }
  if (out.length >= min) return out;

  // 보유 중 수량
  const held = new Map<string, number>();
  for (const t of trades) {
    const c = canonicalTickerForMatch(t.ticker);
    if (!c) continue;
    const q = Number(t.quantity) || 0;
    held.set(c, (held.get(c) ?? 0) + (t.side === "buy" ? q : -q));
  }
  // 분배금 기록 수·최근 수령일
  const stats = new Map<string, { count: number; last: string }>();
  for (const l of ledger) {
    if (!isDividendRecord(l)) continue;
    const c = tickerFromDividendDesc(l.description);
    if (!c) continue;
    const cur = stats.get(c) ?? { count: 0, last: "" };
    cur.count += 1;
    if ((l.date || "") > cur.last) cur.last = l.date || "";
    stats.set(c, cur);
  }
  const candidates = [...stats.entries()]
    .filter(([c, s]) => (held.get(c) ?? 0) > 1e-8 && s.count >= 2 && !seen.has(c))
    .sort((a, b) => (b[1].last !== a[1].last ? b[1].last.localeCompare(a[1].last) : b[1].count - a[1].count));
  for (const [c] of candidates) {
    if (out.length >= min) break;
    out.push(c);
  }
  return out;
}

/** 월 단위 배당 성장 시계열 생성. 분배금 기록이 하나도 없으면 null. */
export function buildDividendGrowth(args: {
  ticker: string;
  ledger: LedgerEntry[];
  trades: StockTrade[];
  prices: StockPrice[];
  historicalDailyCloses?: HistoricalDailyClose[];
  marketEnvSnapshots?: MarketEnvSnapshot[];
  /** YYYY-MM (KST) — 호출부에서 getThisMonthKST() 전달 (테스트 주입용) */
  currentMonth: string;
  /** 현재 환율(USD→KRW). USD 종목의 분배금·주가·평단을 KRW로 정규화하는 데 사용 (불변식 #5). */
  fxRate?: number | null;
}): DividendGrowthData | null {
  const canonical = canonicalTickerForMatch(args.ticker);
  if (!canonical) return null;

  // USD 종목은 분배금/주가/평단이 모두 달러 → 카드가 "원"으로 표시하면 환율배수(~1400)만큼 왜곡.
  // 환율로 KRW 정규화한다. (분배율·YOC는 분자/분모가 같은 통화라 비율은 원래도 정확했음 — 절대값만 보정)
  const isUsd = isUSDStock(canonical);
  const fx = args.fxRate ?? null;
  // USD 종목인데 환율이 없으면 KRW 정규화 불가 → 왜곡된 숫자를 보여주느니 미표시(null).
  if (isUsd && !(fx != null && fx > 0)) return null;
  const toKrwPrice = (v: number): number => (isUsd && fx ? v * fx : v);

  // ── 분배금 기록 (월별 집계)
  type DivAgg = { received: number; perShare: number; perShareKnown: boolean };
  const divByMonth = new Map<string, DivAgg>();
  let recordCount = 0;
  let name = "";
  for (const l of args.ledger) {
    if (!isDividendRecord(l)) continue;
    if (tickerFromDividendDesc(l.description) !== canonical) continue;
    const m = (l.date || "").slice(0, 7);
    if (!m) continue;
    recordCount += 1;
    if (!name) {
      const nm = (l.description || "").match(/^[A-Za-z0-9.-]+\s*-\s*(.+?)\s*배당\s*$/);
      if (nm) name = nm[1];
    }
    const agg = divByMonth.get(m) ?? { received: 0, perShare: 0, perShareKnown: false };
    // 분배금: USD 기록이면 환율로 환산 (KRW 기록은 그대로 — 혼재 대비 per-entry 판정)
    const rawAmount = Number(l.amount) || 0;
    const amount = l.currency === "USD" && fx ? rawAmount * fx : rawAmount;
    agg.received += amount;
    const qty = parseQuantityFromNote(l.note);
    if (qty != null && qty > 0) {
      agg.perShare += amount / qty;
      agg.perShareKnown = true;
    }
    divByMonth.set(m, agg);
  }
  if (recordCount === 0) return null;

  // ── 거래 (보유 수량·평단 이동평균, 수수료 포함)
  const myTrades = args.trades
    .filter((t) => canonicalTickerForMatch(t.ticker) === canonical && t.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!name && myTrades.length > 0) name = myTrades[myTrades.length - 1].name || "";

  // ── 주가 폴백 체인 데이터 준비
  const closesByMonth = new Map<string, { date: string; close: number }>();
  for (const c of args.historicalDailyCloses ?? []) {
    if (canonicalTickerForMatch(c.ticker) !== canonical || !c.date) continue;
    const m = c.date.slice(0, 7);
    const prev = closesByMonth.get(m);
    if (!prev || c.date > prev.date) closesByMonth.set(m, { date: c.date, close: c.close });
  }
  const snapPriceByMonth = new Map<string, { date: string; price: number }>();
  for (const s of args.marketEnvSnapshots ?? []) {
    const m = (s.date || "").slice(0, 7);
    if (!m) continue;
    const hit = s.prices?.find((p) => canonicalTickerForMatch(p.ticker) === canonical);
    if (!hit || !(Number(hit.price) > 0)) continue;
    const prev = snapPriceByMonth.get(m);
    if (!prev || s.date > prev.date) snapPriceByMonth.set(m, { date: s.date, price: Number(hit.price) });
  }
  const currentPriceRow = args.prices.find((p) => canonicalTickerForMatch(p.ticker) === canonical);
  // 주가 소스는 모두 네이티브(USD 종목이면 달러)로 보관 — 최종 사용 지점에서 toKrwPrice로 1회 환산.
  const currentPriceRaw = currentPriceRow && Number(currentPriceRow.price) > 0 ? Number(currentPriceRow.price) : null;

  // ── 월 시퀀스: 첫 이벤트(거래/분배금) ~ 이번 달
  const firstTradeMonth = myTrades[0]?.date.slice(0, 7);
  const firstDivMonth = [...divByMonth.keys()].sort()[0];
  const firstMonth = [firstTradeMonth, firstDivMonth].filter(Boolean).sort()[0]!;
  const months = monthSeq(firstMonth, args.currentMonth);

  // ── 월말 보유 수량·평단 누적 (이동평균법)
  const points: DividendGrowthPoint[] = [];
  let qty = 0;
  let costBasis = 0; // 보유분 총원가 (수수료 포함)
  let ti = 0;
  for (const m of months) {
    const monthEnd = `${m}-31`;
    let lastTradePriceInMonth: number | null = null;
    while (ti < myTrades.length && myTrades[ti].date <= monthEnd) {
      const t = myTrades[ti];
      const q = Number(t.quantity) || 0;
      if (t.side === "buy") {
        qty += q;
        // 원가: USD 거래면 환율로 KRW 환산 (분배금·주가와 같은 단위 — YOC 비율 보존)
        costBasis += toKrwPrice(Number(t.totalAmount) || q * (Number(t.price) || 0));
      } else {
        const avg = qty > 1e-8 ? costBasis / qty : 0;
        qty = Math.max(0, qty - q);
        costBasis = qty * avg;
      }
      // 월말 종가 폴백용 — 네이티브(달러) 그대로 보관, price 계산 시 1회 환산
      if (t.date.slice(0, 7) === m && Number(t.price) > 0) lastTradePriceInMonth = Number(t.price);
      ti += 1;
    }
    const avgCost = qty > 1e-8 ? costBasis / qty : null;

    // 주가: 월말 종가 → 그 달 마지막 거래가 → 시장환경 스냅샷 → (이번 달) 현재 시세 (모두 네이티브 → 1회 환산)
    const rawPrice =
      closesByMonth.get(m)?.close ??
      lastTradePriceInMonth ??
      snapPriceByMonth.get(m)?.price ??
      (m === args.currentMonth ? currentPriceRaw : null);
    const price = rawPrice == null ? null : toKrwPrice(rawPrice);

    const div = divByMonth.get(m);
    const received = div?.received ?? 0;
    const perShare = div?.perShareKnown ? div.perShare : null;
    points.push({
      month: m,
      label: `${m.slice(2, 4)}.${m.slice(5, 7)}`,
      received,
      perShare,
      price,
      monthlyYield: perShare != null && price ? (perShare / price) * 100 : null,
      monthlyYoc: perShare != null && avgCost ? (perShare / avgCost) * 100 : null,
      shares: qty,
      avgCost,
    });
  }

  // ── 현재 KPI
  const last = points[points.length - 1];
  const lastPaid = [...points].reverse().find((p) => p.received > 0) ?? null;
  // 연환산 주당 분배금: 첫 분배 월부터 최근 12개월 창에서 "주당 분배금을 아는 달"만 평균 × 12.
  // 보유주식 미기재 기록(perShare 불명) 달을 0으로 섞으면 체계적으로 과소되므로 제외.
  const sinceFirstDiv = points.filter((p) => p.month >= firstDivMonth);
  const windowPts = sinceFirstDiv.slice(-12);
  const knownPerShare = windowPts.filter((p) => p.perShare != null);
  const annualPerShare =
    knownPerShare.length > 0
      ? (knownPerShare.reduce((s, p) => s + (p.perShare ?? 0), 0) / knownPerShare.length) * 12
      : null;
  // last?.price는 이미 KRW 환산됨 — currentPriceRaw도 동일 단위로 환산해 사용
  const curPrice = currentPriceRaw != null ? toKrwPrice(currentPriceRaw) : last?.price ?? null;
  const curAvgCost = last?.avgCost ?? null;

  return {
    ticker: canonical,
    name: name || canonical,
    points,
    recordCount,
    current: {
      shares: last?.shares ?? 0,
      avgCost: curAvgCost,
      price: curPrice,
      lastMonthReceived: lastPaid?.received ?? null,
      lastMonthPerShare: lastPaid?.perShare ?? null,
      lastMonthYield: lastPaid?.monthlyYield ?? null,
      lastMonthYoc: lastPaid?.monthlyYoc ?? null,
      annualPerShare,
      marketYield: annualPerShare != null && curPrice ? (annualPerShare / curPrice) * 100 : null,
      yoc: annualPerShare != null && curAvgCost ? (annualPerShare / curAvgCost) * 100 : null,
    },
  };
}
