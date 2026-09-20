/**
 * 배당 포트폴리오 집계 — "내 배당주 전체가 원금 대비 몇 %를 뱉고, 월에 얼마가 들어오는가".
 *
 * utils/dividendGrowth.ts가 **한 종목**의 시계열(버핏의 코카콜라)을 만든다면, 이 모듈은
 * **배당을 지급한 전 종목의 합**을 만든다. 판정·티커 추출은 dividendGrowth의 export를 그대로
 * 쓴다(분류 단일 소스 — 정규식을 다시 쓰면 한쪽만 고쳐졌을 때 집계가 갈린다).
 *
 * 핵심 규칙
 *  - 분모(원가)는 **KRW 원가**다 (CLAUDE.md: 배당율은 totalBuyAmountKRW 기준).
 *    USD 종목은 매입 당시 환율(fxRateAtTrade) 우선 — 현재 환율로 환산하면 원금이 환율 따라
 *    출렁여 YOC가 배당과 무관하게 흔들린다.
 *  - 연환산은 "최근 ≤12개월 창의 합 ÷ 유효 월수 × 12". 유효 월수는 그 종목의 첫 수령월부터
 *    세되 최대 12, 무배당 달도 0으로 포함한다. 지급한 달만 평균 내면 분기·연배당이 3~12배
 *    부풀고, 반대로 5개월 전에 시작한 종목을 12로 나누면 절반 이하로 과소평가된다.
 *  - 이번 달은 아직 안 끝났다. 연환산·평균 계산에서 제외하고 차트에는 "진행 중"으로 표시한다
 *    (CLAUDE.md #13 — 진행 중인 달을 완료된 달과 나란히 두면 항상 급감처럼 보인다).
 */
import type { LedgerEntry, StockTrade } from "../types";
import { canonicalTickerForMatch, tradeAmountKRW } from "./finance";
import { isDividendRecord, tickerFromDividendDesc } from "./dividendGrowth";

/** 차트에서 개별 색을 받는 종목 수 — 나머지는 "기타"로 합친다 */
const TOP_N = 4;
/** 연환산 창 최대 개월 */
const ANNUALIZE_WINDOW = 12;
/** 연환산을 신뢰할 최소 관측 개월 — 1~2회 받은 걸 12배 하면 한 번의 특별배당이 연 5%로 둔갑한다 */
const MIN_ANNUALIZE_MONTHS = 3;

export interface DividendPortfolioMonth {
  month: string;
  /** "25.07" */
  label: string;
  /** 그 달 배당 총액 (KRW) */
  total: number;
  /** 상위 종목별 금액 + 기타 — 스택 막대용 (key = ticker 또는 "기타") */
  byTicker: Record<string, number>;
  /**
   * 그 달까지 최근 12개월 누적 수령 (KRW) — 성장 추세선.
   *
   * ⚠ 예전엔 여기에 "그 시점 원금 대비 배당률(%)"을 그렸는데 못 쓴다. 분모가 월말 원가 한 점이라
   * 매매 타이밍에 터진다 — 실데이터에서 TIGER를 거의 전량 매도한 2026-04에 원가가 40,662원으로
   * 떨어지며 배당률이 124.92%를 찍어 차트 축을 통째로 망가뜨렸다. 원금이 급변하는 구간에서는
   * '과거 창의 배당'과 '현재 원가'가 애초에 대응하지 않는다.
   * 원금 대비 배당률은 현재 시점 하나만(히어로) 내고, 추세는 금액으로 본다.
   */
  rolling: number | null;
  /** 아직 끝나지 않은 달 */
  partial: boolean;
}

export interface DividendPortfolioTicker {
  ticker: string;
  name: string;
  /** 현재 보유 원가 (KRW) */
  cost: number;
  /** 연환산 배당 (KRW) */
  annual: number;
  /** 누적 수령 (KRW) */
  total: number;
  /** YOC (%, 연환산 ÷ 원가) — 원가가 0이면 null */
  yoc: number | null;
  /** 연환산 계산에 쓴 유효 월수 */
  months: number;
  /** 첫 수령월 */
  firstMonth: string;
  /**
   * 총 배당률(분자·분모) 집계에 포함됐는지. 제외 사유:
   *  - "sold"     : 전량 매도(원가 0) — 지금 원금이 뱉는 배당이 아니다.
   *                 분자에만 남기면 총 배당률이 부풀려진다(분모엔 원가가 없으므로).
   *  - "tooShort" : 관측 3개월 미만 — 연환산을 신뢰할 수 없다.
   */
  excluded: "sold" | "tooShort" | null;
}

export interface DividendPortfolio {
  months: DividendPortfolioMonth[];
  /** 연환산 배당 큰 순 */
  tickers: DividendPortfolioTicker[];
  /** 차트 스택에 쓸 상위 종목 (색 배정 순서) */
  topTickers: Array<{ key: string; name: string }>;
  /** 배당주 원가 합 (KRW) */
  totalCost: number;
  /** 연환산 배당 합 (KRW) */
  annualTotal: number;
  /** 총 배당률 (%, 연환산 ÷ 배당주 원가) — 집계 제외 종목은 분자·분모 모두에서 빠짐 */
  yoc: number | null;
  /** 집계에서 빠진 종목 수 (매도 완료 / 관측 부족) */
  excludedCount: number;
  /**
   * 월 배당 = 최근 완료 3개월 실수령 평균.
   * 12개월 평균은 성장 중인 포트폴리오에서 과거에 눌려 "지금 얼마 들어오는지"를 못 보여주고,
   * 직전 한 달만 쓰면 특별배당 한 번에 출렁인다. 3개월 평균이 둘 사이의 정직한 절충.
   */
  monthlyAvg: number;
  /** 최근 완료 월의 실수령액 */
  lastMonth: { month: string; amount: number } | null;
  /** 누적 수령 총액 */
  receivedTotal: number;
  /** 완료된 최근 12개월 실수령 합 (연환산 아님 — 사실 그대로) */
  received12: number;
}

const monthLabel = (m: string): string => `${m.slice(2, 4)}.${m.slice(5, 7)}`;

const addMonths = (m: string, n: number): string => {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7)) + n;
  const ny = y + Math.floor((mo - 1) / 12);
  const nm = ((mo - 1) % 12 + 12) % 12 + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
};

const monthDiff = (from: string, to: string): number =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
  (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));

/**
 * 종목별 월말 KRW 원가(이동평균) 시계열.
 * 매도는 평단을 유지한 채 원가만 비례 차감한다 — dividendGrowth와 같은 규칙(수익률 정의 통일).
 */
function costByMonth(
  trades: StockTrade[],
  months: string[],
  fxRate?: number | null
): Map<string, number[]> {
  const byTicker = new Map<string, StockTrade[]>();
  for (const t of trades) {
    const c = canonicalTickerForMatch(t.ticker);
    if (!c) continue;
    const list = byTicker.get(c) ?? [];
    list.push(t);
    byTicker.set(c, list);
  }

  const out = new Map<string, number[]>();
  for (const [ticker, list] of byTicker) {
    const sorted = [...list].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const series: number[] = [];
    let qty = 0;
    let cost = 0;
    let i = 0;
    for (const m of months) {
      const end = `${m}-31`;
      while (i < sorted.length && (sorted[i].date || "") <= end) {
        const t = sorted[i];
        const q = Number(t.quantity) || 0;
        if (t.side === "buy") {
          qty += q;
          cost += tradeAmountKRW(t, fxRate);
        } else {
          // 매도: 평단 유지, 원가만 비례 차감 (전량 매도면 0)
          const unit = qty > 0 ? cost / qty : 0;
          const use = Math.min(q, qty);
          qty -= use;
          cost = qty > 0 ? unit * qty : 0;
        }
        i += 1;
      }
      series.push(Math.max(0, cost));
    }
    out.set(ticker, series);
  }
  return out;
}

export function buildDividendPortfolio(args: {
  ledger: LedgerEntry[];
  trades: StockTrade[];
  /** YYYY-MM (KST) — 진행 중인 달 판정 */
  currentMonth: string;
  /** USD 배당 기록·USD 종목 원가 환산용 */
  fxRate?: number | null;
  /**
   * 집계 대상 종목 (canonical). 주면 이 종목만 본다 — 대시보드는 '배당 성장 추적 티커' 설정과
   * 같은 목록을 넘겨, 두 배당 위젯이 항상 같은 종목을 본다.
   * 안 주면 배당을 지급한 전 종목. 성장 ETF의 소액 분배금(연 0.5%대)까지 섞이면 배당주 전략의
   * 배당률이 심하게 희석돼(4.12% → 1.64%) "내 배당주가 얼마나 주는가"를 못 읽는다.
   */
  tickers?: string[];
}): DividendPortfolio | null {
  const { ledger, trades, currentMonth } = args;
  const fx = args.fxRate ?? null;
  const scope = args.tickers?.length
    ? new Set(args.tickers.map((t) => canonicalTickerForMatch(t)).filter((t): t is string => !!t))
    : null;

  // ── 배당 기록을 (월, 티커)로 집계 ──────────────────────────────────────
  const amountByMonthTicker = new Map<string, Map<string, number>>();
  const nameByTicker = new Map<string, string>();
  const firstMonthByTicker = new Map<string, string>();
  let earliest = "";

  for (const l of ledger) {
    if (!isDividendRecord(l)) continue;
    const ticker = tickerFromDividendDesc(l.description);
    if (!ticker) continue;
    if (scope && !scope.has(ticker)) continue;
    const month = (l.date || "").slice(0, 7);
    if (!month) continue;

    // USD 배당 기록은 환율로 KRW 정규화 (불변식 #5). 환율이 없으면 원화 기록만 집계한다.
    const raw = Number(l.amount) || 0;
    if (l.currency === "USD" && !(fx && fx > 0)) continue;
    const amount = l.currency === "USD" && fx ? raw * fx : raw;

    if (!nameByTicker.has(ticker)) {
      const nm = (l.description || "").match(/^[A-Za-z0-9.-]+\s*-\s*(.+?)\s*배당\s*$/);
      nameByTicker.set(ticker, nm ? nm[1] : ticker);
    }
    const prevFirst = firstMonthByTicker.get(ticker);
    if (!prevFirst || month < prevFirst) firstMonthByTicker.set(ticker, month);
    if (!earliest || month < earliest) earliest = month;

    let row = amountByMonthTicker.get(month);
    if (!row) {
      row = new Map();
      amountByMonthTicker.set(month, row);
    }
    row.set(ticker, (row.get(ticker) ?? 0) + amount);
  }

  if (!earliest) return null;

  // ── 월 축 (첫 배당월 ~ 이번 달) ────────────────────────────────────────
  const months: string[] = [];
  for (let m = earliest; monthDiff(m, currentMonth) >= 0; m = addMonths(m, 1)) months.push(m);
  const lastComplete = addMonths(currentMonth, -1);

  const costSeries = costByMonth(trades, months, fx);

  /**
   * 특정 시점(asOf 월 인덱스)의 종목별 연환산·원가 스냅샷.
   *
   * 월별 배당률 선과 상단 히어로가 **같은 함수**를 쓴다. 예전엔 선만 "롤링합 ÷ 창 × 12"로
   * 따로 계산해서, 이력이 1~2개월뿐인 초기 구간이 12배로 뻥튀기돼 2025-10에 8% 스파이크가
   * 생겼고(실제로는 비트코인 ETF 배당 1회), 선의 끝값과 히어로 숫자도 서로 달랐다.
   */
  const snapshotAt = (asOfIdx: number) => {
    const asOf = months[asOfIdx];
    const rows: DividendPortfolioTicker[] = [];
    for (const [ticker, first] of firstMonthByTicker) {
      if (first > asOf) continue; // 그 시점엔 아직 배당을 시작하지 않음
      const span = monthDiff(first, asOf) + 1;
      const window = Math.max(0, Math.min(ANNUALIZE_WINDOW, span));
      let windowSum = 0;
      let total = 0;
      for (const [month, row] of amountByMonthTicker) {
        const v = row.get(ticker) ?? 0;
        if (!v) continue;
        if (month <= asOf) total += v;
        const back = monthDiff(month, asOf);
        if (back >= 0 && back < window) windowSum += v;
      }
      const annual = window > 0 ? (windowSum / window) * 12 : 0;
      const cost = costSeries.get(ticker)?.[asOfIdx] ?? 0;
      const excluded: "sold" | "tooShort" | null =
        cost <= 0 ? "sold" : window < MIN_ANNUALIZE_MONTHS ? "tooShort" : null;
      rows.push({
        ticker,
        name: nameByTicker.get(ticker) ?? ticker,
        cost,
        annual,
        total,
        yoc: cost > 0 && !excluded ? (annual / cost) * 100 : null,
        months: window,
        firstMonth: first,
        excluded,
      });
    }
    const counted = rows.filter((t) => !t.excluded);
    const cost = counted.reduce((x, t) => x + t.cost, 0);
    const annual = counted.reduce((x, t) => x + t.annual, 0);
    return { rows, counted, cost, annual, yoc: cost > 0 ? (annual / cost) * 100 : null };
  };

  /** 실제 받은 누적 (진행 중인 달 포함) — 표의 '누적' 열과 헤더의 누적 수령이 쓰는 값.
   *  스냅샷의 total은 "그 시점까지"라 진행 중인 달이 빠진다. 누적은 사실이므로 자르면 안 된다. */
  const cumulativeByTicker = new Map<string, number>();
  for (const row of amountByMonthTicker.values()) {
    for (const [t, v] of row) cumulativeByTicker.set(t, (cumulativeByTicker.get(t) ?? 0) + v);
  }

  const lastCompleteIdx = months.indexOf(lastComplete);
  // 직전 완료월 기준 스냅샷 = 히어로·종목표의 단일 소스 (= 배당률 선의 마지막 점)
  const snap = snapshotAt(lastCompleteIdx >= 0 ? lastCompleteIdx : months.length - 1);
  const tickers: DividendPortfolioTicker[] = snap.rows.map((t) => ({
    ...t,
    total: cumulativeByTicker.get(t.ticker) ?? t.total,
  }));
  // 집계에 포함된 종목을 먼저 — 제외 종목이 연배당만 크게 잡혀 상위에 뜨면 오독을 부른다
  tickers.sort((a, b) => {
    if (!a.excluded !== !b.excluded) return a.excluded ? 1 : -1;
    return b.annual - a.annual || b.total - a.total;
  });

  const topKeys = tickers.slice(0, TOP_N).map((t) => t.ticker);
  const topSet = new Set(topKeys);
  const topTickers = [
    ...tickers.slice(0, TOP_N).map((t) => ({ key: t.ticker, name: t.name })),
    ...(tickers.length > TOP_N ? [{ key: "기타", name: "기타" }] : []),
  ];

  // ── 월 시계열 ──────────────────────────────────────────────────────────
  const totalsByMonth = months.map((m) => {
    const row = amountByMonthTicker.get(m);
    if (!row) return 0;
    let s = 0;
    for (const v of row.values()) s += v;
    return s;
  });

  const out: DividendPortfolioMonth[] = months.map((m, idx) => {
    const row = amountByMonthTicker.get(m);
    const byTicker: Record<string, number> = {};
    if (row) {
      for (const [t, v] of row) {
        const key = topSet.has(t) ? t : "기타";
        byTicker[key] = (byTicker[key] ?? 0) + v;
      }
    }
    const partial = m === currentMonth;
    // 진행 중인 달은 추세선에서 뺀다 — 아직 안 받은 달을 나란히 두면 항상 급감처럼 보인다
    let rollingSum = 0;
    const window = Math.min(ANNUALIZE_WINDOW, idx + 1);
    for (let k = idx - window + 1; k <= idx; k += 1) rollingSum += totalsByMonth[k] ?? 0;

    return {
      month: m,
      label: monthLabel(m),
      total: totalsByMonth[idx],
      byTicker,
      rolling: partial ? null : rollingSum,
      partial,
    };
  });

  // 총 배당률은 "지금 보유 중이고 충분히 관측된" 종목만으로 낸다 — 분자·분모 기준을 같게 유지.
  const totalCost = snap.cost;
  const annualTotal = snap.annual;
  let receivedTotal = 0;
  for (const v of cumulativeByTicker.values()) receivedTotal += v;

  let received12 = 0;
  for (let k = months.length - 1; k >= 0; k -= 1) {
    if (months[k] === currentMonth) continue;
    if (monthDiff(months[k], lastComplete) >= ANNUALIZE_WINDOW) break;
    received12 += totalsByMonth[k];
  }

  // 최근 완료 3개월 평균 (이번 달 제외)
  const completeTotals: number[] = [];
  for (let k = 0; k < months.length; k += 1) {
    if (months[k] === currentMonth) continue;
    completeTotals.push(totalsByMonth[k]);
  }
  const recent3 = completeTotals.slice(-3);
  const monthlyAvg = recent3.length > 0 ? recent3.reduce((x, y) => x + y, 0) / recent3.length : 0;

  const lastIdx = months.indexOf(lastComplete);
  const lastMonth =
    lastIdx >= 0 ? { month: lastComplete, amount: totalsByMonth[lastIdx] } : null;

  return {
    months: out,
    tickers,
    topTickers,
    totalCost,
    annualTotal,
    yoc: totalCost > 0 ? (annualTotal / totalCost) * 100 : null,
    monthlyAvg,
    excludedCount: tickers.length - snap.counted.length,
    lastMonth,
    receivedTotal,
    received12,
  };
}
