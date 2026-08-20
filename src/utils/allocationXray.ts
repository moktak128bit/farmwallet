/**
 * 자산 배분 X-ray (1단계) — 순수 모듈.
 *
 * 보유 포지션(computePositions 결과)과 계좌 잔액(computeAccountBalances 결과)을 받아
 * 같은 총자산을 3개 축(+집중도)으로 다시 자른다. 축마다 항목 합계 = totalKRW 가 항상 성립한다.
 *
 *  - 통화:   KRW / USD         — 포지션은 marketCurrency(없으면 isUSDStock), 현금은 원화·달러 잔액 별도
 *  - 시장:   KR / US / CRYPTO  — tickerDatabase.market 우선, 없으면 티커·계좌 타입 규칙으로 추정. 현금은 '현금'
 *  - 자산군: 개별주 / ETF / 코인 / 현금 / 연금 — 연금 = isPension 계좌 보유종목(예수금은 현금에 포함)
 *  - 집중도: 축마다 최대 비중 항목 (maxItem) + 전체에서 가장 큰 단일 비중 (concentration)
 *
 * 현금 = 증권·코인계좌 예수금(KRW + USD×환율). 일반 은행 계좌는 '투자 포트폴리오'가 아니므로 제외
 * (USD 비증권계좌 누락은 의도 설계 — 대시보드와 동일). 음수 예수금은 0으로 클램프(비중 음수 방지).
 *
 * 시세 미로드 중립: marketValue 0(시세 없음) 또는 환율 미로드 USD 포지션은 평가액 0 → 집계에서 빠지고
 * excludedCount로 보고. 합계가 0이면 빈 결과(axes 전부 빈 배열).
 */
import type { Account, AccountBalanceRow, PositionRow, TickerInfo } from "../types";
import { positionMarketValueKRW } from "../calculations";
import { canonicalTickerForMatch, isCryptoStock, isUSDStock } from "./finance";
import { isEtfName } from "./portfolioMetrics";

export interface XrayItem {
  label: string;
  valueKRW: number;
  /** 0~100 (%) */
  pct: number;
}

export type XrayAxisKey = "currency" | "market" | "assetClass";

export interface XrayAxis {
  key: XrayAxisKey;
  title: string;
  items: XrayItem[];
  /** 축 안에서 가장 큰 항목 (집중도). 항목이 없으면 null */
  maxItem: XrayItem | null;
}

interface AllocationXray {
  /** 포지션 평가액 + 현금, KRW */
  totalKRW: number;
  cashKRW: number;
  /** 0~100 (%) */
  cashPct: number;
  axes: XrayAxis[];
  /** 모든 축 통틀어 가장 큰 단일 항목 비중 */
  concentration: { axisTitle: string; label: string; pct: number } | null;
  /** 평가액 0(시세 미로드·환율 미로드 USD)으로 빠진 포지션 수 */
  excludedCount: number;
}

type XrayPosition = Pick<
  PositionRow,
  "accountId" | "ticker" | "name" | "quantity" | "marketValue" | "marketCurrency"
>;
type XrayBalance = Pick<AccountBalanceRow, "account" | "currentBalance" | "usdTransferNet">;

interface BuildAllocationXrayInput {
  positions: XrayPosition[];
  balances: XrayBalance[];
  accounts: Account[];
  tickerDatabase?: TickerInfo[];
  fxRate: number | null;
}

export const XRAY_LABEL = {
  KRW: "KRW",
  USD: "USD",
  KR: "KR",
  US: "US",
  CRYPTO: "CRYPTO",
  STOCK: "개별주",
  ETF: "ETF",
  COIN: "코인",
  CASH: "현금",
  PENSION: "연금",
} as const;

const AXIS_TITLE: Record<XrayAxisKey, string> = {
  currency: "통화",
  market: "시장",
  assetClass: "자산군",
};

/** 축 내부 표시 순서 (라벨이 없으면 뒤로) */
const LABEL_ORDER: Record<XrayAxisKey, string[]> = {
  currency: [XRAY_LABEL.KRW, XRAY_LABEL.USD],
  market: [XRAY_LABEL.KR, XRAY_LABEL.US, XRAY_LABEL.CRYPTO, XRAY_LABEL.CASH],
  assetClass: [XRAY_LABEL.STOCK, XRAY_LABEL.ETF, XRAY_LABEL.COIN, XRAY_LABEL.CASH, XRAY_LABEL.PENSION],
};

const POSITION_DUST = 1e-9;

function add(map: Map<string, number>, label: string, v: number): void {
  if (!(v > 0)) return;
  map.set(label, (map.get(label) ?? 0) + v);
}

function finalizeAxis(key: XrayAxisKey, buckets: Map<string, number>, total: number): XrayAxis {
  const order = LABEL_ORDER[key];
  const items: XrayItem[] = [...buckets.entries()]
    .filter(([, v]) => v > 0)
    .map(([label, valueKRW]) => ({ label, valueKRW, pct: total > 0 ? (valueKRW / total) * 100 : 0 }))
    .sort((a, b) => {
      const ia = order.indexOf(a.label);
      const ib = order.indexOf(b.label);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  let maxItem: XrayItem | null = null;
  for (const it of items) if (!maxItem || it.valueKRW > maxItem.valueKRW) maxItem = it;
  return { key, title: AXIS_TITLE[key], items, maxItem };
}

/** 포지션의 표시 통화 — positionMarketValueKRW와 같은 규칙 (marketCurrency 우선, 없으면 티커 추정) */
function positionIsUsd(p: XrayPosition): boolean {
  return (
    p.marketCurrency === "USD" ||
    (p.marketCurrency !== "KRW" && Boolean(p.ticker && isUSDStock(p.ticker)))
  );
}

export function buildAllocationXray(input: BuildAllocationXrayInput): AllocationXray {
  const { positions, balances, accounts, tickerDatabase, fxRate } = input;
  const rate = fxRate != null && fxRate > 0 ? fxRate : null;

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const marketByTicker = new Map<string, TickerInfo["market"]>();
  for (const t of tickerDatabase ?? []) {
    const k = canonicalTickerForMatch(t.ticker);
    if (k && !marketByTicker.has(k)) marketByTicker.set(k, t.market);
  }

  const currency = new Map<string, number>();
  const market = new Map<string, number>();
  const assetClass = new Map<string, number>();
  let total = 0;
  let excludedCount = 0;

  // --- 포지션 ---
  for (const p of positions) {
    if (!(p.quantity > POSITION_DUST)) continue;
    const v = positionMarketValueKRW(p, rate);
    if (!(v > 0)) {
      excludedCount += 1;
      continue;
    }
    total += v;
    const acct = accountById.get(p.accountId);
    const isCryptoAcct = acct?.type === "crypto";
    const tickerNorm = canonicalTickerForMatch(p.ticker);
    const dbMarket = marketByTicker.get(tickerNorm);
    const isCoin = dbMarket === "CRYPTO" || isCryptoAcct || isCryptoStock(p.ticker);
    const usd = positionIsUsd(p);

    add(currency, usd ? XRAY_LABEL.USD : XRAY_LABEL.KRW, v);

    const mkt: TickerInfo["market"] =
      dbMarket ?? (isCoin ? "CRYPTO" : usd || isUSDStock(p.ticker) ? "US" : "KR");
    add(market, mkt, v);

    if (acct?.isPension) add(assetClass, XRAY_LABEL.PENSION, v);
    else if (isCoin) add(assetClass, XRAY_LABEL.COIN, v);
    else if (isEtfName(p.name ?? "")) add(assetClass, XRAY_LABEL.ETF, v);
    else add(assetClass, XRAY_LABEL.STOCK, v);
  }

  // --- 현금 (증권·코인계좌 예수금) ---
  let cashKRW = 0;
  for (const row of balances) {
    const a = row.account;
    if (a.type !== "securities" && a.type !== "crypto") continue;
    const krw = Math.max(0, row.currentBalance);
    const usdAmt = (a.usdBalance ?? 0) + (row.usdTransferNet ?? 0);
    const usdKrw = rate != null && usdAmt > 0 ? usdAmt * rate : 0;
    if (krw > 0) {
      add(currency, XRAY_LABEL.KRW, krw);
      cashKRW += krw;
    }
    if (usdKrw > 0) {
      add(currency, XRAY_LABEL.USD, usdKrw);
      cashKRW += usdKrw;
    }
  }
  add(market, XRAY_LABEL.CASH, cashKRW);
  add(assetClass, XRAY_LABEL.CASH, cashKRW);
  total += cashKRW;

  if (!(total > 0)) {
    return {
      totalKRW: 0,
      cashKRW: 0,
      cashPct: 0,
      axes: [],
      concentration: null,
      excludedCount,
    };
  }

  const axes: XrayAxis[] = [
    finalizeAxis("currency", currency, total),
    finalizeAxis("market", market, total),
    finalizeAxis("assetClass", assetClass, total),
  ];

  let concentration: AllocationXray["concentration"] = null;
  for (const ax of axes) {
    if (ax.maxItem && (!concentration || ax.maxItem.pct > concentration.pct)) {
      concentration = { axisTitle: ax.title, label: ax.maxItem.label, pct: ax.maxItem.pct };
    }
  }

  return {
    totalKRW: total,
    cashKRW,
    cashPct: (cashKRW / total) * 100,
    axes,
    concentration,
    excludedCount,
  };
}
