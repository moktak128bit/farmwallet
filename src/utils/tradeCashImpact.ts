import type { Account, LedgerEntry } from "../types";

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
