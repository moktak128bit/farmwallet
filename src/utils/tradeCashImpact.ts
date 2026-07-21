import type { Account, LedgerEntry, StockTrade } from "../types";
import { isUSDStock } from "./finance";

/**
 * 증권계좌 + USD 종목일 때 "USD 잔액 모드" 사용 여부.
 * - account.currency === "USD" 이거나
 * - 해당 계좌로 USD 이체(ledger)가 있으면 true.
 * true이면 cashImpact=0, account.usdBalance로만 반영.
 */
export function shouldUseUsdBalanceMode(
  accountId: string,
  isSecuritiesAccount: boolean,
  isUSDCurrency: boolean,
  accounts: Account[],
  ledger: LedgerEntry[]
): boolean {
  if (!isSecuritiesAccount || !isUSDCurrency) return false;
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return false;
  const hasUsdTransfers = ledger.some(
    (entry) =>
      entry.kind === "transfer" &&
      entry.currency === "USD" &&
      (entry.fromAccountId === accountId || entry.toAccountId === accountId)
  );
  return account.currency === "USD" || hasUsdTransfers;
}

/**
 * 주식 거래의 계좌 현금 반영액(cashImpact).
 * - KRW 또는 USD 비모드: 매수 -totalAmountKRW, 매도 +totalAmountKRW
 * - USD 잔액 모드: 0 (USD는 account.usdBalance로만 반영)
 */
export function computeTradeCashImpact(
  side: "buy" | "sell",
  totalAmountKRW: number,
  useUsdBalanceMode: boolean
): number {
  if (useUsdBalanceMode) return 0;
  return side === "buy" ? -totalAmountKRW : totalAmountKRW;
}

/**
 * 이 거래가 account.usdBalance에 반영한 달러 증감 (원화 현금모드면 0).
 * 잔액모드 판정은 저장·삭제 경로와 같은 기준(USD 종목 + cashImpact≈0)을 쓴다.
 *
 * ⚠ account.usdBalance는 거래 시점에 이 델타가 더해진 '현재' 보유량이다(applyUsdDeltas).
 *   과거 시점 잔액을 재구성할 때는 반드시 이후 거래분을 되돌리거나 시간순으로 누적할 것 —
 *   현재값을 과거에 그대로 쓰면 매수액이 과거 자산에서 미리 빠져 없던 계단이 생긴다.
 */
export function usdBalanceModeDelta(trade: StockTrade): number {
  if (!isUSDStock(trade.ticker)) return 0;
  const impact = Number(trade.cashImpact);
  if (Number.isFinite(impact) && Math.abs(impact) > 0.000001) return 0; // 원화 현금모드 — usdBalance 미반영
  return trade.side === "buy" ? -trade.totalAmount : trade.totalAmount;
}
