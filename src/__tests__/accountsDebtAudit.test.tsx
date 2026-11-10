// @vitest-environment jsdom
/**
 * 계좌·부채·대시보드 감사 회귀 — 거래 내역 시작 잔액, 날짜별 계좌 순가치, 0 표기, CMA % 폭주, 마이너스 통장 이자 그룹.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { computeAccountBalances, computeAccountValuesAtDate } from "../calculations";
import { TransactionHistoryModal } from "../features/accounts/sections/TransactionHistoryModal";
import { CmaBalanceTrendCard } from "../features/dashboard/CmaBalanceTrendCard";
import { RepaymentHistorySection } from "../features/debt/RepaymentHistorySection";
import { formatUSD } from "../utils/formatter";
import type { Account, LedgerEntry, Loan, StockTrade } from "../types";

vi.mock("../features/dashboard/DashboardInlineCharts", () => ({ CmaBalanceChart: () => null }));
afterEach(() => cleanup());

const account = (o: Partial<Account> & { id: string }): Account =>
  ({ name: o.id, institution: "", type: "checking", initialBalance: 0, ...o } as Account);

describe("거래 내역 모달 — 시작 잔액은 거래마다 USD 모드 판정", () => {
  it("원화 현금모드 USD 매수(cashImpact 있음)는 원화 러닝밸런스에 되돌린다 → 시작 잔액 = initialCashBalance", () => {
    const toss = account({ id: "toss", type: "securities", initialCashBalance: 3_565, usdBalance: 100 });
    const ledger: LedgerEntry[] = [
      { id: "L1", date: "2026-01-02", kind: "transfer", category: "이체", description: "", toAccountId: "toss", amount: 1_000_000 } as LedgerEntry,
      // USD 이체가 있으면 계좌 단위 판정은 이 계좌를 '달러 잔액모드'로 보았다
      { id: "L2", date: "2026-01-03", kind: "transfer", category: "이체", description: "", toAccountId: "toss", amount: 50, currency: "USD" } as LedgerEntry,
    ];
    const trades: StockTrade[] = [
      // 원화 현금모드 USD 매수 — cashImpact −400,000
      { id: "T1", date: "2026-01-05", accountId: "toss", ticker: "AAPL", name: "Apple", side: "buy", quantity: 1, price: 280, fee: 0, totalAmount: 280, cashImpact: -400_000 } as StockTrade,
      // 달러 잔액모드 매수 — cashImpact 0, 달러에서 빠짐(원화 러닝밸런스 무관)
      { id: "T2", date: "2026-01-06", accountId: "toss", ticker: "MSFT", name: "MSFT", side: "buy", quantity: 1, price: 30, fee: 0, totalAmount: 30, cashImpact: 0 } as StockTrade,
    ];
    const balances = computeAccountBalances([toss], ledger, trades);
    const { container } = render(
      <TransactionHistoryModal
        account={toss}
        ledger={ledger}
        trades={trades}
        safeAccounts={[toss]}
        safeBalances={balances}
        realizedPnlByTradeId={new Map()}
        effectiveFxRate={1400}
        onClose={() => {}}
      />
    );
    const text = container.textContent ?? "";
    expect(text).toContain("시작 잔액3,565 원");
  });
});

describe("computeAccountValuesAtDate — 계좌 순가치(부채 offset 차감)", () => {
  it("카드 이용액은 부채로 빠지고, 시세 없는 보유 종목은 원가 대체로 표시된다", () => {
    const card = account({ id: "card", type: "card", initialBalance: 0, debt: 4_240_000 });
    const sec = account({ id: "sec", type: "securities", initialCashBalance: 100_000 });
    const trades = [
      { id: "T1", date: "2026-01-05", accountId: "sec", ticker: "005930", name: "삼성전자", side: "buy", quantity: 1, price: 50_000, fee: 0, totalAmount: 50_000, cashImpact: -50_000 } as StockTrade,
    ];
    const { byAccount, stockAtCost } = computeAccountValuesAtDate([card, sec], [], trades, "2026-01-31", [], { fxRate: 1400, priceFallback: "cost" });
    expect(byAccount.get("card")).toBe(-4_240_000);
    expect(byAccount.get("sec")).toBe(100_000);
    expect(stockAtCost).toBe(50_000);
  });
});

describe("0 표기", () => {
  it("부동소수 잔여 음수는 −$0.000이 아니라 $0.000", () => {
    expect(formatUSD(-0.0001)).toBe("$0.000");
    expect(formatUSD(-0.0004, { exact: true, maxDecimals: 3 })).toBe("$0");
    expect(formatUSD(-1.5)).toBe("-$1.500");
  });
});

describe("CMA 잔액 추이 — 시작값이 작으면 % 생략", () => {
  it("시작 6,000원 → 1,300만이어도 '+214452%'를 그리지 않는다", () => {
    const snaps = [
      { date: "2025-06-30", label: "06-30", cma: 6_000 },
      { date: "2026-10-31", label: "10-31", cma: 12_900_000 },
      { date: "2026-11-10", label: "11-10", cma: 13_010_739 },
    ];
    const { container } = render(<CmaBalanceTrendCard accountBalanceSnapshots={snaps} accountId="cma" accountName="농협CMA" />);
    const text = container.textContent ?? "";
    expect(text).toContain("기간 시작 대비");
    expect(text).not.toMatch(/\d{4,}\.\d%/);
  });
});

describe("부채 상환 내역 — 마이너스 통장 이자 그룹", () => {
  it("대출에 매칭되지 않는 이자 중 마이너스 계좌에서 나간 것은 '마이너스 통장 이자'로 묶인다", () => {
    const ladder = account({ id: "ladder", initialBalance: -2_650_000 });
    const loans: Loan[] = [
      { id: "LN1", institution: "IBK", loanName: "IBK 대출", loanAmount: 1, annualInterestRate: 4.7, repaymentMethod: "equal_principal", loanDate: "2025-09-18", maturityDate: "2036-09-18" },
    ];
    const ledger: LedgerEntry[] = [
      { id: "R1", date: "2026-10-12", kind: "expense", category: "지출", subCategory: "대출상환", detailCategory: "이자상환", description: "대출결산이자", amount: 8_256, fromAccountId: "ladder" } as LedgerEntry,
    ];
    render(
      <RepaymentHistorySection
        {...({
          loans,
          ledger,
          accounts: [ladder],
          showRepaymentHistory: true,
          setShowRepaymentHistory: () => {},
          repaymentFilterDebtId: null,
          setRepaymentFilterDebtId: () => {},
          matchRepaymentLoan: () => null,
          onEditRepayment: () => {},
        } as unknown as React.ComponentProps<typeof RepaymentHistorySection>)}
      />
    );
    expect(screen.getAllByText(/마이너스 통장 이자/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/매칭 안 됨/)).toBeNull();
  });
});
