// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { computeAccountBalances, computePositions } from "../calculations";
import { AdjustmentModal } from "../features/accounts/sections/AdjustmentModal";
import { AccountTablesSection } from "../features/accounts/sections/AccountTablesSection";
import { BalanceBreakdownSection } from "../features/accounts/sections/BalanceBreakdownSection";
import { TotalAssetTrendCard } from "../features/dashboard/TotalAssetTrendCard";
import { AccountsView } from "../pages/AccountsPage";
import { formatKRW } from "../utils/formatter";
import type { Account, AccountBalanceRow, LedgerEntry, StockTrade } from "../types";

// 차트 본체(recharts)는 jsdom에서 렌더하지 않는다 — 헤더 숫자만 검증
vi.mock("../features/dashboard/DashboardInlineCharts", () => ({ TotalAssetValueChart: () => null }));

afterEach(() => cleanup());

const account = (o: Partial<Account> & { id: string }): Account =>
  ({ name: o.id, institution: "", type: "checking", initialBalance: 0, ...o } as Account);

const usdIn = (to: string, amount: number): LedgerEntry =>
  ({ id: `L-${to}`, date: "2026-01-05", kind: "transfer", category: "이체", description: "", toAccountId: to, amount, currency: "USD" } as LedgerEntry);

describe("A4 TotalAssetTrendCard — 총자산은 계좌 순가치(account.debt 차감)의 양수만", () => {
  it("입출금 +100만(debt 20만) · 마이너스통장 −200만 → 현금+평가액 80만 (BalanceSheetStrip 총자산과 동일)", () => {
    const accounts = [
      account({ id: "chk", initialBalance: 1_000_000, debt: 200_000 }),
      account({ id: "마통", initialBalance: -2_000_000 }),
    ];
    const ledger = [
      { id: "L1", date: "2026-01-10", kind: "income", category: "수입", description: "", toAccountId: "chk", amount: 0 } as LedgerEntry,
    ];
    const { container } = render(
      <TotalAssetTrendCard today="2026-02-01" accounts={accounts} ledger={ledger} trades={[]} prices={[]} fxRate={1300} />
    );
    const text = container.textContent ?? "";
    expect(text).toContain("현금+평가액800,000 원");
  });
});

describe("A6 AdjustmentModal — 직접 목표 잔액 설정에서 빈 칸은 현재값 유지", () => {
  const sec = account({ id: "sec", type: "securities", initialCashBalance: 500_000, usdBalance: 100 });
  const setup = () => {
    const onChangeAccounts = vi.fn();
    render(
      <AdjustmentModal
        adjustingAccount={{ id: "sec", type: "securities" }}
        safeAccounts={[sec]}
        safeBalances={computeAccountBalances([sec], [], [])}
        cardDebtMap={new Map()}
        ledger={[]}
        onChangeAccounts={onChangeAccounts}
        fxRate={1300}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByLabelText(/직접 목표 잔액 설정/));
    return onChangeAccounts;
  };

  it("USD만 입력 → 원화 예수금 50만 유지", () => {
    const onChangeAccounts = setup();
    fireEvent.change(screen.getByPlaceholderText("USD 잔액 (예: 1000.50)"), { target: { value: "650" } });
    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    const [saved] = onChangeAccounts.mock.calls[0][0] as Account[];
    expect(saved.usdBalance).toBe(650);
    expect(saved.initialCashBalance).toBe(500_000);
  });

  it("KRW만 입력 → USD 잔액 $100 유지", () => {
    const onChangeAccounts = setup();
    fireEvent.change(screen.getByPlaceholderText("KRW 잔액 (예: 1000000)"), { target: { value: "800000" } });
    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    const [saved] = onChangeAccounts.mock.calls[0][0] as Account[];
    expect(saved.usdBalance).toBe(100);
    expect(saved.initialCashBalance).toBe(800_000);
  });
});

describe("A7 AccountTablesSection — USD 셀 인라인 편집은 표시값(usdBalance + usdTransferNet) 기준", () => {
  it("표시 $600(이체 +$1000, usdBalance −400)에서 $650 입력 → usdBalance −350 (셀 $650)", () => {
    const sec = account({ id: "sec", type: "securities", usdBalance: -400 });
    const rows = computeAccountBalances([sec], [usdIn("sec", 1000)], []);
    const onChangeAccounts = vi.fn();
    render(
      <AccountTablesSection
        safeAccounts={[sec]}
        accountsByType={new Map([["securities", rows]])}
        stockMap={new Map()}
        cardDebtMap={new Map()}
        fxRate={1300}
        ledger={[usdIn("sec", 1000)]}
        trades={[]}
        onChangeAccounts={onChangeAccounts}
        onRenameAccountId={vi.fn()}
        onSelectAccount={vi.fn()}
        onOpenAdjust={vi.fn()}
      />
    );
    fireEvent.doubleClick(screen.getByTitle("더블클릭하여 USD 잔액 수정"));
    const input = screen.getByDisplayValue("600");
    fireEvent.change(input, { target: { value: "650" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const [saved] = onChangeAccounts.mock.calls[0][0] as Account[];
    expect(saved.usdBalance).toBe(-350);
  });
});

describe("K6 계좌 거래 내역 — USD 매도 실현손익은 원화(거래시점 환율)", () => {
  it("$1000(@1000) 매수 → $1320(@1100) 매도: 실현 +452,000원 (달러 액면 +320원 아님)", async () => {
    const sec = account({ id: "sec", name: "증권", type: "securities", initialCashBalance: 0 });
    const trades = [
      { id: "T1", date: "2026-01-10", accountId: "sec", ticker: "AAPL", name: "Apple", side: "buy", quantity: 10, price: 100, fee: 0, totalAmount: 1000, cashImpact: -1_000_000, fxRateAtTrade: 1000 },
      { id: "T2", date: "2026-02-10", accountId: "sec", ticker: "AAPL", name: "Apple", side: "sell", quantity: 10, price: 132, fee: 0, totalAmount: 1320, cashImpact: 1_452_000, fxRateAtTrade: 1100 },
    ] as StockTrade[];
    render(
      <AccountsView
        accounts={[sec]}
        balances={computeAccountBalances([sec], [], trades)}
        positions={computePositions(trades, [], [sec])}
        ledger={[]}
        trades={trades}
        fxRate={1300}
        onChangeAccounts={vi.fn()}
        onRenameAccountId={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTitle("클릭: 거래 내역 · 더블클릭: 이름 수정"));
    expect(await screen.findByText(/실현 \+452,000 원/)).toBeTruthy();
  });
});

describe("A8 BalanceBreakdownSection — 행 합 = 현재 잔액 (저축성지출 유입·savings 포함)", () => {
  it("레거시 저축성지출 30만 입금 + savings 5만 → '저축 유입' 35만 열이 생긴다", () => {
    const sv = account({ id: "sv", name: "적금", type: "savings", initialBalance: 100_000, savings: 50_000 });
    const ledger = [
      { id: "L1", date: "2026-01-10", kind: "expense", category: "저축성지출", description: "", fromAccountId: "chk", toAccountId: "sv", amount: 300_000 } as LedgerEntry,
    ];
    const rows: AccountBalanceRow[] = computeAccountBalances([sv], ledger, []);
    expect(rows[0].currentBalance).toBe(450_000);
    render(
      <BalanceBreakdownSection
        safeBalances={rows}
        orderedRowsForInitialReverse={rows}
        safeAccounts={[sv]}
        onChangeAccounts={vi.fn()}
        formatKRW={formatKRW}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /계좌별 잔액 구성/ }));
    const cells = Array.from(document.querySelectorAll("tbody tr:first-child td")).map((td) => td.textContent);
    // 계좌 | 시작 10만 | 보정 - | 수입 - | 지출 - | 이체 - | 매매 - | 저축 유입 35만 | 현재 45만
    expect(cells.slice(1)).toEqual(["100,000 원", "-", "-", "-", "-", "-", "350,000 원", "450,000 원"]);
  });
});
