import { describe, expect, it } from "vitest";
import type { Account, LedgerEntry } from "../types";
import { computeAccountBalances } from "../calculations";
import { computeBalanceAfterByLedgerId } from "../features/ledger/balanceAfter";

const acc = (o: Partial<Account> & { id: string }): Account => ({ name: o.id, institution: "", type: "securities", initialBalance: 0, ...o } as Account);
const e = (o: Partial<LedgerEntry> & { id: string; date: string; amount: number }): LedgerEntry => ({ kind: "transfer", category: "이체", ...o } as LedgerEntry);

describe("가계부 입·출금 잔액 열 — 통화별 역산", () => {
  const accounts = [acc({ id: "BANK", type: "checking", initialBalance: 1_000_000 }), acc({ id: "CMA", initialCashBalance: 94_611, usdBalance: 100 })];
  // 환전: 원화 출금 다리 + USD 도착 다리 (FxFormSection 쌍)
  const ledger = [
    e({ id: "in", date: "2026-11-01", amount: 50_000, fromAccountId: "BANK", toAccountId: "CMA" }),
    e({ id: "fx-to", date: "2026-11-03", amount: 41.19, currency: "USD", subCategory: "환전이체", toAccountId: "CMA" }),
  ];
  const balances = computeAccountBalances(accounts, ledger, []);
  const map = computeBalanceAfterByLedgerId(ledger, [], balances);

  it("USD 이체는 달러 잔고로 — 원화 잔액에 달러를 섞지 않는다", () => {
    const cell = map.get("fx-to")!.to!;
    expect(cell.currency).toBe("USD");
    expect(cell.amount).toBeCloseTo(41.19);
    expect(cell.balance).toBeCloseTo(141.19); // usdBalance 100 + 41.19
  });

  it("원화 행의 잔액은 USD 이동에 영향받지 않는다 (마지막 원화 잔액 = 계좌 원화 잔액)", () => {
    const cell = map.get("in")!.to!;
    expect(cell.currency).toBe("KRW");
    expect(cell.balance).toBe(94_611 + 50_000);
    expect(balances.find((r) => r.account.id === "CMA")!.currentBalance).toBe(94_611 + 50_000);
  });
});
