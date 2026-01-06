/**
 * 계좌별 수익률 계산 검증 유틸리티
 * 
 * 이 파일은 계좌별 수익률 계산의 정확성을 보장하기 위한 검증 로직을 제공합니다.
 * 
 * 계산 규칙:
 * 1. 총 원금 = 실제로 투입한 현금 (cashImpact < 0인 buy 거래) + 초기 현금
 * 2. 초기 보유 주식(cashImpact=0)은 원금에 포함하지 않음
 * 3. 총 평가액 = 주식 평가액 + 순현금 (초기 현금 + 주식 거래 현금 변화)
 * 4. 중복 계산 방지: currentBalance 대신 순현금을 직접 계산
 */

import type { Account, StockTrade } from "../types";

export interface AccountPerformanceInput {
  account: Account;
  trades: StockTrade[];
  stockValue: number;
  currentBalance: number;
}

export interface AccountPerformanceResult {
  totalCost: number; // 총 투자 원금
  totalValue: number; // 총 평가액
  pnl: number; // 평가손익
  pnlRate: number; // 수익률 (%)
  isValid: boolean; // 계산 결과가 유효한지
  warnings: string[]; // 경고 메시지
}

/**
 * 계좌별 수익률을 계산하고 검증합니다.
 */
export function calculateAccountPerformance(
  input: AccountPerformanceInput
): AccountPerformanceResult {
  const { account, trades, stockValue, currentBalance } = input;
  const warnings: string[] = [];

  // 1. 총 매입금액 계산 (모든 buy 거래 포함, 초기 보유 포함)
  // 실제 계좌 화면에서 보이는 "총매입금액"과 동일하게 계산
  const allBuyTrades = trades.filter(t => t.side === "buy");
  const totalBuyAmount = allBuyTrades.reduce((sum, t) => sum + t.totalAmount, 0);

  // 2. 초기 보유 거래 확인 (참고용)
  const initialHoldings = trades.filter(
    t => t.side === "buy" && t.cashImpact === 0
  );
  const initialHoldingsAmount = initialHoldings.reduce((sum, t) => sum + t.totalAmount, 0);

  if (initialHoldings.length > 0) {
    warnings.push(
      `초기 보유 주식 ${initialHoldings.length}건 발견 (총액: ${initialHoldingsAmount.toLocaleString()}원, 원금에 포함됨)`
    );
  }

  // 3. 초기 현금 잔액
  const initialCash = account.type === "securities" 
    ? (account.initialCashBalance ?? account.initialBalance ?? 0)
    : 0;

  // 4. 총 투자 원금 = 총 매입금액 + 초기 현금
  // 주의: 초기 보유 주식도 매입금액에 포함됨 (실제 계좌 화면과 동일)
  const totalCost = totalBuyAmount + Math.max(0, initialCash);

  if (totalCost <= 0) {
    warnings.push("총 투자 원금이 0 이하입니다. 수익률 계산이 불가능합니다.");
  }

  // 5. 주식 거래로 인한 현금 변화
  const tradeCashImpact = trades.reduce((sum, t) => sum + t.cashImpact, 0);

  // 6. 순현금 = 초기 현금 + 주식 거래 현금 변화
  const netCash = initialCash + tradeCashImpact;

  // 7. 총 평가액 = 주식 평가액 + 순현금
  const totalValue = stockValue + netCash;

  // 8. 평가손익 및 수익률
  const pnl = totalValue - totalCost;
  const pnlRate = totalCost > 0 ? (pnl / totalCost) * 100 : 0;

  // 9. 검증
  const isValid = (
    totalCost >= 0 &&
    totalValue >= 0 &&
    !isNaN(pnlRate) &&
    isFinite(pnlRate) &&
    Math.abs(pnlRate) < 10000 // 수익률이 10000%를 넘지 않아야 함 (비정상적인 값)
  );

  if (!isValid) {
    warnings.push("계산 결과가 유효하지 않습니다. 데이터를 확인해주세요.");
  }

  // 10. 합리성 검증
  if (totalCost > 0 && Math.abs(pnlRate) > 1000) {
    warnings.push(
      `수익률이 ${pnlRate.toFixed(2)}%로 비정상적으로 높습니다. 데이터를 확인해주세요.`
    );
  }

  // 11. 현금 잔액 일관성 검증
  // currentBalance와 계산된 netCash가 크게 다르면 경고
  const balanceDiff = Math.abs(currentBalance - netCash);
  if (balanceDiff > 1000000) { // 100만원 이상 차이
    warnings.push(
      `현금 잔액 불일치: 계산된 순현금(${netCash.toLocaleString()}원)과 현재 잔액(${currentBalance.toLocaleString()}원)의 차이가 큽니다.`
    );
  }

  return {
    totalCost,
    totalValue,
    pnl,
    pnlRate,
    isValid,
    warnings
  };
}

/**
 * 계산 결과를 콘솔에 출력합니다 (디버깅용)
 */
export function logAccountPerformance(
  accountName: string,
  result: AccountPerformanceResult,
  details?: {
    actualBuyAmount: number;
    initialCash: number;
    stockValue: number;
    tradeCashImpact: number;
    netCash: number;
  }
) {
  // 디버깅 로그 비활성화 (프로덕션에서 불필요한 로그 출력 방지)
  return;
}

