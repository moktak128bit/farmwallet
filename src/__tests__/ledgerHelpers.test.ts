import { describe, it, expect } from "vitest";
import {
  ledgerEntryGross,
  tradeToLedgerRow,
  createDefaultLedgerForm,
} from "../utils/ledgerHelpers";

describe("ledgerEntryGross", () => {
  it("수입은 amount + discountAmount", () => {
    expect(ledgerEntryGross({ kind: "income", amount: 10000, discountAmount: 1000 })).toBe(11000);
  });

  it("지출은 amount + discountAmount", () => {
    expect(ledgerEntryGross({ kind: "expense", amount: 9000, discountAmount: 1000 })).toBe(10000);
  });

  it("이체는 amount만", () => {
    expect(ledgerEntryGross({ kind: "transfer", amount: 5000, discountAmount: 999 })).toBe(5000);
  });

  it("discountAmount 없으면 amount", () => {
    expect(ledgerEntryGross({ kind: "expense", amount: 7000 })).toBe(7000);
  });
});

describe("tradeToLedgerRow", () => {
  it("매수 거래 → 재테크/주식매수 expense", () => {
    const row = tradeToLedgerRow(
      {
        id: "t1",
        date: "2026-01-01",
        accountId: "acc1",
        ticker: "005930",
        name: "삼성전자",
        side: "buy",
        quantity: 10,
        price: 70000,
        fee: 0,
        totalAmount: 700000,
        cashImpact: -700000,
      },
      new Map()
    );
    expect(row.kind).toBe("expense");
    expect(row.category).toBe("재테크");
    expect(row.subCategory).toBe("주식매수");
    expect(row.fromAccountId).toBe("acc1");
    expect(row.toAccountId).toBeUndefined();
    expect(row._tradeId).toBe("t1");
    expect(row.amount).toBe(700000);
  });

  it("매도 + 수익 → 재테크/투자수익, toAccountId 세팅", () => {
    const row = tradeToLedgerRow(
      {
        id: "t2",
        date: "2026-01-01",
        accountId: "acc1",
        ticker: "005930",
        name: "삼성전자",
        side: "sell",
        quantity: 10,
        price: 80000,
        fee: 0,
        totalAmount: 800000,
        cashImpact: 800000,
      },
      new Map([["t2", 100000]])
    );
    expect(row.subCategory).toBe("투자수익");
    expect(row.amount).toBe(100000);
    expect(row.toAccountId).toBe("acc1");
    expect(row.fromAccountId).toBeUndefined();
  });

  it("매도 + 손실 → 투자손실, fromAccountId 세팅", () => {
    const row = tradeToLedgerRow(
      {
        id: "t3",
        date: "2026-01-01",
        accountId: "acc1",
        ticker: "005930",
        name: "삼성전자",
        side: "sell",
        quantity: 10,
        price: 50000,
        fee: 0,
        totalAmount: 500000,
        cashImpact: 500000,
      },
      new Map([["t3", -50000]])
    );
    expect(row.subCategory).toBe("투자손실");
    expect(row.amount).toBe(50000);
    expect(row.fromAccountId).toBe("acc1");
    expect(row.toAccountId).toBeUndefined();
  });

  it("USD 종목은 currency=USD", () => {
    const row = tradeToLedgerRow(
      {
        id: "t4",
        date: "2026-01-01",
        accountId: "acc1",
        ticker: "AAPL",
        name: "Apple",
        side: "buy",
        quantity: 1,
        price: 150,
        fee: 0,
        totalAmount: 150,
        cashImpact: -150,
      },
      new Map()
    );
    expect(row.currency).toBe("USD");
  });
});

describe("createDefaultLedgerForm", () => {
  it("기본 폼은 income/KRW/빈 필드", () => {
    const form = createDefaultLedgerForm();
    expect(form.kind).toBe("income");
    expect(form.currency).toBe("KRW");
    expect(form.mainCategory).toBe("");
    expect(form.amount).toBe("");
    expect(form.tags).toEqual([]);
    expect(form.isFixedExpense).toBe(false);
  });

  it("date는 오늘 날짜(ISO yyyy-mm-dd)", () => {
    const form = createDefaultLedgerForm();
    expect(form.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
