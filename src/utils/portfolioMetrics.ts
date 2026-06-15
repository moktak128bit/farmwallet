/**
 * 보유 포지션 기반 파생 지표 — 순수 모듈 (useInsightsData에서 분리, 점진적 리팩터).
 *
 * 입력은 이미 계산된 현재 포지션(computePositions 결과)으로, 여기서는 그것을 집계만 한다.
 *  - portfolio: 자산 유형별(개별주식/ETF/암호화폐) 현재 시세 평가액 합 (배분 차트용)
 *  - holdingsByStock: 종목별 FIFO 매입원가·평가액(KRW) — 누적 매수액(gross)이 아닌 실제 보유분
 *    (매도 후 재매수·부분 매도 시 부풀려지는 것을 방지)
 *  - totalHoldingsCost: 보유 매입원가 합(KRW) = 투자 '원금' (배당률·회전율·집중도 분모)
 */
import type { Account, PositionRow } from "../types";
import { positionMarketValueKRW } from "../calculations";

interface PortfolioMetrics {
  portfolio: { name: string; value: number }[];
  holdingsByStock: { name: string; costKRW: number; valueKRW: number }[];
  totalHoldingsCost: number;
}

/** ETF 종목명 정규식 — 국내 주요 ETF 브랜드 접두. 암호화폐는 계좌 타입으로 판정하므로 여기엔 없음. */
const ETF_NAME_RE = /tiger|kodex|rise|sol |1q |ace |kbstar|hanaro/i;

/** 포지션 원가 KRW — USD 종목은 매입 당시 환율(없으면 현재 환율)로 환산. */
function positionCostKRW(p: PositionRow, fxRate: number | null): number {
  if (p.marketCurrency === "USD") {
    return p.totalBuyAmountKRW ?? p.totalBuyAmount * (fxRate ?? 0);
  }
  return p.totalBuyAmount;
}

export function computePortfolioMetrics(
  positions: PositionRow[],
  accounts: Account[],
  fxRate: number | null
): PortfolioMetrics {
  const acctTypeById = new Map(accounts.map((a) => [a.id, a.type]));

  // 자산 유형별 평가액 (배분 차트)
  const byType = new Map<string, number>();
  for (const p of positions) {
    if (p.quantity <= 1e-9) continue;
    const v = positionMarketValueKRW(p, fxRate);
    if (v <= 0) continue;
    let tp = "개별주식";
    if (acctTypeById.get(p.accountId) === "crypto") tp = "암호화폐";
    else if (ETF_NAME_RE.test(p.name)) tp = "ETF";
    byType.set(tp, (byType.get(tp) ?? 0) + v);
  }
  const portfolio = Array.from(byType.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  // 종목별 FIFO 매입원가·평가액 (같은 종목이 여러 계좌면 합산)
  const byName = new Map<string, { costKRW: number; valueKRW: number }>();
  for (const p of positions) {
    if (p.quantity <= 1e-9) continue;
    const costKRW = positionCostKRW(p, fxRate);
    if (!(costKRW > 0)) continue;
    const valueKRW = positionMarketValueKRW(p, fxRate);
    const prev = byName.get(p.name) ?? { costKRW: 0, valueKRW: 0 };
    byName.set(p.name, { costKRW: prev.costKRW + costKRW, valueKRW: prev.valueKRW + valueKRW });
  }
  const holdingsByStock = [...byName.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.costKRW - a.costKRW);
  const totalHoldingsCost = holdingsByStock.reduce((s, h) => s + h.costKRW, 0);

  return { portfolio, holdingsByStock, totalHoldingsCost };
}

/**
 * 미실현 손익 — 보유 종목 × (현재가 − 평단), KRW 환산. 손실은 양의 절대값으로 분리.
 * 입력 positions는 priceFallback 없이 계산된 것(실제 시세만) — 시세 미로드 종목은 cost로 대체하지 않음.
 * (투자 손익 4분할 카드: 실현=FIFO 청산 누적, 미실현=여기.)
 */
export function computeUnrealizedPL(
  positions: PositionRow[],
  fxRate: number | null
): { unrealizedGain: number; unrealizedLoss: number } {
  let unrealizedGain = 0;
  let unrealizedLoss = 0;
  for (const p of positions) {
    if (!p.quantity || p.quantity <= 0) continue;
    const isUsd = p.marketCurrency === "USD";
    const costKrw = isUsd ? (p.totalBuyAmountKRW ?? p.totalBuyAmount * (fxRate ?? 0)) : p.totalBuyAmount;
    const marketKrw = isUsd ? p.marketValue * (fxRate ?? 0) : p.marketValue;
    const pnlKrw = marketKrw - costKrw;
    if (pnlKrw > 0) unrealizedGain += pnlKrw;
    else if (pnlKrw < 0) unrealizedLoss += -pnlKrw;
  }
  return { unrealizedGain, unrealizedLoss };
}
