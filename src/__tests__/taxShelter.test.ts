/** 4-1 — 절세계좌(ISA·연금저축·IRP) 납입 집계·한도·세액공제 (buildShelterContributions) */
import { describe, expect, it } from "vitest";
import type { Account, LedgerEntry } from "../types";
import {
  buildShelterAccountMap,
  buildShelterContributions,
  DEFAULT_TAX_CREDIT_RATE,
  TAX_SHELTER_RULES_2026,
} from "../utils/taxShelter";

const acct = (id: string, taxShelter?: Account["taxShelter"]): Account => ({
  id,
  name: id,
  institution: "",
  type: "securities",
  initialBalance: 0,
  ...(taxShelter ? { taxShelter } : {}),
});

const tr = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: Math.random().toString(36).slice(2),
  date: "2026-03-10",
  kind: "transfer",
  category: "이체",
  subCategory: "투자이체",
  description: "납입",
  amount: 0,
  ...over,
});

const ACCOUNTS = [acct("CHK"), acct("ISA", "isa"), acct("PEN", "pension"), acct("IRP", "irp"), acct("ISA2", "isa")];

describe("buildShelterAccountMap", () => {
  it("taxShelter 지정 계좌만 id→종류", () => {
    const m = buildShelterAccountMap(ACCOUNTS);
    expect([...m.entries()]).toEqual([["ISA", "isa"], ["PEN", "pension"], ["IRP", "irp"], ["ISA2", "isa"]]);
  });
});

describe("buildShelterContributions — 납입 집계", () => {
  it("transfer & toAccountId∈절세계좌만 종류별 합산, 일반 계좌행은 무시", () => {
    const r = buildShelterContributions(
      [
        tr({ fromAccountId: "CHK", toAccountId: "ISA", amount: 1_000_000 }),
        tr({ fromAccountId: "CHK", toAccountId: "ISA2", amount: 500_000 }),
        tr({ fromAccountId: "CHK", toAccountId: "PEN", amount: 2_000_000 }),
        tr({ fromAccountId: "CHK", toAccountId: "IRP", amount: 300_000 }),
        tr({ fromAccountId: "CHK", toAccountId: "OTHER", amount: 9_000_000 }), // 일반 계좌
        tr({ kind: "expense", fromAccountId: "ISA", amount: 9_000_000 }), // transfer 아님
        tr({ kind: "income", toAccountId: "ISA", category: "배당", amount: 9_000_000 }), // 배당 수령 ≠ 납입
      ],
      ACCOUNTS,
      2026
    );
    expect(r.hasShelterAccounts).toBe(true);
    expect(r.isa.accountCount).toBe(2);
    expect(r.pension.accountCount).toBe(2);
    expect(r.isa.paid).toBe(1_500_000);
    expect(r.pension.paidPension).toBe(2_000_000);
    expect(r.pension.paidIrp).toBe(300_000);
    expect(r.pension.paidTotal).toBe(2_300_000);
  });

  it("환전·절세계좌 간 내부 이체·배당/이자 재투자는 제외(진단 카운트)", () => {
    const r = buildShelterContributions(
      [
        tr({ fromAccountId: "CHK", toAccountId: "ISA", amount: 1_000_000 }),
        tr({ fromAccountId: "ISA", toAccountId: "ISA", category: "환전", subCategory: undefined, amount: 700_000 }),
        tr({ fromAccountId: "CHK", toAccountId: "PEN", category: "이체", subCategory: "환전", amount: 700_000 }),
        tr({ fromAccountId: "ISA", toAccountId: "PEN", amount: 5_000_000 }), // 내부 이체
        tr({ fromAccountId: "PEN", toAccountId: "IRP", amount: 5_000_000 }), // 내부 이체
        tr({ fromAccountId: "CHK", toAccountId: "ISA", category: "배당", subCategory: undefined, amount: 80_000 }), // 재투자
        tr({ fromAccountId: "CHK", toAccountId: "PEN", description: "예금 이자 재투자", amount: 80_000 }), // 재투자(loose)
      ],
      ACCOUNTS,
      2026
    );
    expect(r.isa.paid).toBe(1_000_000);
    expect(r.pension.paidTotal).toBe(0);
    expect(r.excluded).toEqual({ exchange: 2, internal: 2, reinvest: 2 });
  });

  it("연도 경계 — 해당 연도(YYYY-)만, 전년 12/31·익년 1/1 제외", () => {
    const r = buildShelterContributions(
      [
        tr({ fromAccountId: "CHK", toAccountId: "ISA", date: "2025-12-31", amount: 1 }),
        tr({ fromAccountId: "CHK", toAccountId: "ISA", date: "2026-01-01", amount: 10 }),
        tr({ fromAccountId: "CHK", toAccountId: "ISA", date: "2026-12-31", amount: 100 }),
        tr({ fromAccountId: "CHK", toAccountId: "ISA", date: "2027-01-01", amount: 1_000 }),
      ],
      ACCOUNTS,
      2026
    );
    expect(r.isa.paid).toBe(110);
  });

  it("USD 납입은 환율 환산(미로드 시 액면 폴백)·0 이하 금액 무시", () => {
    const led = [
      tr({ fromAccountId: "CHK", toAccountId: "IRP", amount: 100, currency: "USD" }),
      tr({ fromAccountId: "CHK", toAccountId: "IRP", amount: 0 }),
      tr({ fromAccountId: "CHK", toAccountId: "IRP", amount: -50 }),
    ];
    expect(buildShelterContributions(led, ACCOUNTS, 2026, 1_400).pension.paidIrp).toBe(140_000);
    expect(buildShelterContributions(led, ACCOUNTS, 2026, null).pension.paidIrp).toBe(100);
  });

  it("절세계좌가 없으면 hasShelterAccounts=false·전부 0", () => {
    const r = buildShelterContributions([tr({ fromAccountId: "CHK", toAccountId: "ISA", amount: 1 })], [acct("CHK"), acct("ISA")], 2026);
    expect(r.hasShelterAccounts).toBe(false);
    expect(r.isa.paid).toBe(0);
    expect(r.pension.estCredit).toBe(0);
  });
});

describe("buildShelterContributions — 한도·세액공제(2026 개략)", () => {
  const R = TAX_SHELTER_RULES_2026;

  it("ISA 연 2,000만 한도 잔여, 초과 납입 시 0", () => {
    const a = buildShelterContributions([tr({ fromAccountId: "CHK", toAccountId: "ISA", amount: 15_000_000 })], ACCOUNTS, 2026);
    expect(a.isa.annualLimit).toBe(R.isa.annualLimit);
    expect(a.isa.limitLeft).toBe(5_000_000);
    const b = buildShelterContributions([tr({ fromAccountId: "CHK", toAccountId: "ISA", amount: 25_000_000 })], ACCOUNTS, 2026);
    expect(b.isa.limitLeft).toBe(0);
  });

  it("연금저축 600만 캡·합산 900만 캡 — 연금저축 800만 + IRP 200만 → 공제대상 800만(600+200)", () => {
    const r = buildShelterContributions(
      [
        tr({ fromAccountId: "CHK", toAccountId: "PEN", amount: 8_000_000 }),
        tr({ fromAccountId: "CHK", toAccountId: "IRP", amount: 2_000_000 }),
      ],
      ACCOUNTS,
      2026
    );
    expect(r.pension.creditable).toBe(8_000_000);
    expect(r.pension.creditableLeft).toBe(1_000_000);
    expect(r.pension.limitLeft).toBe(R.pensionAccount.annualLimit - 10_000_000);
    expect(r.pension.creditRate).toBe(DEFAULT_TAX_CREDIT_RATE);
    expect(r.pension.estCredit).toBeCloseTo(8_000_000 * 0.132, 6);
  });

  it("IRP만 900만 초과 납입 → 공제대상 900만 캡, 공제율 16.5% 선택 반영", () => {
    const r = buildShelterContributions(
      [tr({ fromAccountId: "CHK", toAccountId: "IRP", amount: 12_000_000 })],
      ACCOUNTS,
      2026,
      null,
      { creditRate: 0.165 }
    );
    expect(r.pension.creditable).toBe(9_000_000);
    expect(r.pension.creditableLeft).toBe(0);
    expect(r.pension.estCredit).toBeCloseTo(9_000_000 * 0.165, 6);
    expect(r.pension.limitLeft).toBe(6_000_000);
  });

  it("연금저축만 1,800만 초과 → 납입한도 잔여 0, 공제대상은 600만", () => {
    const r = buildShelterContributions([tr({ fromAccountId: "CHK", toAccountId: "PEN", amount: 20_000_000 })], ACCOUNTS, 2026);
    expect(r.pension.limitLeft).toBe(0);
    expect(r.pension.creditable).toBe(6_000_000);
    expect(r.pension.creditableLeft).toBe(3_000_000);
  });
});
