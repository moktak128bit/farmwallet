// @vitest-environment jsdom
/**
 * 배당 UI 회귀 (감사 V6·V7)
 *  - V6 종목 상세 모달은 계좌별 — 다른 계좌의 배당을 이 계좌 원가로 나누면 배당율이 부풀었다
 *  - V7 빠른 입력(원화 주당 배당금)이 USD 모드를 그대로 두면 595원이 $595로 저장돼 1,400배가 됐다
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StockDetailModal } from "../components/StockDetailModal";
import { DividendFormSection } from "../features/dividends/DividendFormSection";
import type { Account, LedgerEntry, PositionRow, StockTrade } from "../types";

const acct = (id: string) => ({ id, name: `계좌${id}`, institution: "", type: "securities", initialBalance: 0 }) as Account;

const buy = (accountId: string, quantity: number, totalAmount: number): StockTrade => ({
  id: `t-${accountId}`,
  date: "2026-01-05",
  accountId,
  ticker: "458730",
  name: "TIGER",
  side: "buy",
  quantity,
  price: totalAmount / quantity,
  fee: 0,
  totalAmount,
  cashImpact: -totalAmount,
});

const dividend = (id: string, toAccountId: string, amount: number, ticker = "458730", name = "TIGER"): LedgerEntry => ({
  id,
  date: "2026-05-27",
  kind: "income",
  category: "수입",
  subCategory: "배당",
  description: `${ticker} - ${name} 배당`,
  amount,
  toAccountId,
});

describe("StockDetailModal — 배당 내역은 이 계좌 것만 (V6)", () => {
  it("다른 계좌 배당을 이 계좌 원가로 나누지 않는다", () => {
    render(
      <StockDetailModal
        position={{
          accountId: "B",
          accountName: "계좌B",
          ticker: "458730",
          name: "TIGER",
          quantity: 50,
          avgPrice: 7600,
          totalBuyAmount: 380_000,
          displayMarketPrice: 8000,
          hasQuote: true,
        }}
        accounts={[acct("A"), acct("B")]}
        trades={[buy("A", 100, 3_790_000), buy("B", 50, 380_000)]}
        prices={[]}
        ledger={[dividend("dA", "A", 59_500), dividend("dB", "B", 29_750)]}
        tickerDatabase={[]}
        onClose={() => {}}
        onChangeLedger={() => {}}
        fxRate={1400}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "배당" }));
    expect(screen.getByText("7.83%")).toBeInTheDocument(); // 29,750 ÷ 380,000
    expect(screen.queryByText("15.66%")).toBeNull(); // A의 59,500 ÷ B 원가 380,000
  });
});

describe("DividendFormSection — 빠른 입력은 원화 모드로 (V7)", () => {
  it("USD 모드에서 빠른 입력을 눌러도 원화 주당 배당금이 달러로 저장되지 않는다", () => {
    const onChangeLedger = vi.fn();
    const position = {
      accountId: "S1",
      accountName: "증권",
      ticker: "SCHD",
      name: "Schwab",
      quantity: 100,
      avgPrice: 27,
      totalBuyAmount: 2700,
      totalBuyAmountKRW: 3_780_000,
      marketPrice: 28,
      marketValue: 2800,
      pnl: 100,
      pnlRate: 0.037,
    } as PositionRow;
    const { container } = render(
      <DividendFormSection
        visible
        accounts={[acct("S1")]}
        ledger={[{ ...dividend("d1", "S1", 59_500, "SCHD", "Schwab"), date: "2026-09-27" }]}
        trades={[]}
        tickerDatabase={[]}
        positions={[position]}
        latestPriceByCanonicalTicker={new Map()}
        fxRate={1400}
        onChangeLedger={onChangeLedger}
      />
    );
    const chip = () => screen.getAllByRole("button").find((b) => b.textContent?.startsWith("SCHD"))!;
    fireEvent.click(chip());
    fireEvent.click(screen.getByRole("button", { name: "원화 표시" })); // USD 모드로 전환
    fireEvent.click(chip()); // 원화 주당 배당금(595)으로 다시 채움
    fireEvent.submit(container.querySelector("form")!);
    expect(onChangeLedger).toHaveBeenCalledTimes(1);
    const saved = onChangeLedger.mock.calls[0][0][0] as LedgerEntry;
    expect(saved.amount).toBe(59_500); // 595 × 100주 (× 환율 1,400 = 83,300,000원 아님)
  });
});
