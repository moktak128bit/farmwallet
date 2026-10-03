// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import type { AppData, LedgerEntry } from "../types";

vi.mock("../context/FxRateContext", () => ({
  useFxRateValue: () => 1400,
  useFxRateInfoValue: () => ({ rate: 1400, fetchedAt: null, isStale: false }),
}));

import { SettlementView } from "../features/dating/SettlementView";

const DA = "date-acc";
const exp = (id: string, date: string, amount: number, extra: Partial<LedgerEntry> = {}): LedgerEntry =>
  ({ id, date, amount, kind: "expense", category: "지출", subCategory: "식비", description: id, fromAccountId: DA, ...extra }) as LedgerEntry;

const dataOf = (ledger: LedgerEntry[]): AppData =>
  ({
    accounts: [{ id: DA, name: "데이트통장", type: "checking", institution: "", initialBalance: 0 }],
    ledger,
    trades: [],
    prices: [],
  }) as unknown as AppData;

const fmt = (n: number) => Math.round(n).toLocaleString();

describe("SettlementView — 정산 시작일·합계 (회귀)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-02T03:00:00Z")); // KST 10/02 정오
    localStorage.clear();
    localStorage.setItem("fw-date-account-id", DA);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    localStorage.clear();
  });

  it("정산을 삭제(undo)한 뒤 다시 열면 되살아난 지출이 정산 대상 — 기기 localStorage 마지막 정산일에 갇히지 않음", () => {
    // 이 기기는 10/02에 정산했다고 기억하지만, 그 정산 항목은 ledger에서 삭제됨
    localStorage.setItem("fw-date-account-last-settle-at", "2026-10-02");
    render(
      <SettlementView
        data={dataOf([exp("e1", "2026-09-10", 40000), exp("e2", "2026-09-20", 20000)])}
        onSettle={() => {}}
        formatNumber={fmt}
      />
    );
    expect(screen.getByText("총 지출 (2건)")).toBeTruthy();
    expect(screen.getByRole("button", { name: /30,000 정산 입금 기록/ })).toHaveProperty("disabled", false);
    // 마지막 정산 배너도 ledger 기준 — 살아있는 정산이 없으면 표시하지 않음
    expect(screen.queryByText(/마지막 정산:/)).toBeNull();
  });

  it("USD 지출은 환율로 원화 환산해 합산한다 ($50 → 70,000원)", () => {
    render(
      <SettlementView
        data={dataOf([exp("e1", "2026-09-20", 50, { currency: "USD" }), exp("e2", "2026-09-21", 10000)])}
        onSettle={() => {}}
        formatNumber={fmt}
      />
    );
    // 총 80,000 → 상대 부담 40,000
    expect(screen.getByRole("button", { name: /40,000 정산 입금 기록/ })).toBeTruthy();
  });
});
