import { describe, it, expect } from "vitest";
import {
  isDateEntry,
  isMoimAccount,
  getMoimAccountIds,
  computeDatePartnerShare,
  splitDateMoimVsPersonal,
} from "../utils/dateAccounting";
import type { Account, LedgerEntry } from "../types";

function entry(o: Partial<LedgerEntry> & { id: string; amount: number }): LedgerEntry {
  return {
    date: "2026-04-15",
    kind: "expense",
    category: "",
    description: "",
    ...o,
  } as LedgerEntry;
}

function acc(o: Partial<Account> & { id: string; name: string }): Account {
  return { type: "checking", institution: "", initialBalance: 0, ...o };
}

describe("isDateEntry", () => {
  it("category에 '데이트' 포함 → true", () => {
    expect(isDateEntry(entry({ id: "1", amount: 1, category: "데이트비" }))).toBe(true);
    expect(isDateEntry(entry({ id: "2", amount: 1, category: "주말데이트" }))).toBe(true);
  });

  it("subCategory에 '데이트' 포함 → true", () => {
    expect(isDateEntry(entry({ id: "1", amount: 1, category: "외식", subCategory: "데이트저녁" }))).toBe(true);
  });

  it("'데이트' 키워드 없으면 false", () => {
    expect(isDateEntry(entry({ id: "1", amount: 1, category: "외식" }))).toBe(false);
    expect(isDateEntry(entry({ id: "2", amount: 1, category: "통신", subCategory: "휴대폰" }))).toBe(false);
  });

  it("expense가 아니면 false (수입/이체)", () => {
    expect(isDateEntry(entry({ id: "1", amount: 1, kind: "income", category: "데이트비" }))).toBe(false);
    expect(isDateEntry(entry({ id: "2", amount: 1, kind: "transfer", subCategory: "데이트" }))).toBe(false);
  });

  it("좌우 공백은 trim — ' 데이트 ' 도 매칭", () => {
    expect(isDateEntry(entry({ id: "1", amount: 1, category: " 데이트비 " }))).toBe(true);
  });

  it("category·subCategory 모두 비어 있으면 false", () => {
    expect(isDateEntry(entry({ id: "1", amount: 1, category: "" }))).toBe(false);
    expect(isDateEntry(entry({ id: "2", amount: 1 }))).toBe(false);
  });
});

describe("isMoimAccount / getMoimAccountIds", () => {
  it("계좌명에 '모임' 포함 → 모임 계좌", () => {
    expect(isMoimAccount(acc({ id: "a", name: "모임통장" }))).toBe(true);
    expect(isMoimAccount(acc({ id: "b", name: "우리모임" }))).toBe(true);
    expect(isMoimAccount(acc({ id: "c", name: "주거래" }))).toBe(false);
  });

  it("getMoimAccountIds: 모임 계좌 id만 모음", () => {
    const accounts = [
      acc({ id: "a", name: "주거래" }),
      acc({ id: "b", name: "모임통장" }),
      acc({ id: "c", name: "데이트모임" }),
    ];
    const ids = getMoimAccountIds(accounts);
    expect(ids.has("a")).toBe(false);
    expect(ids.has("b")).toBe(true);
    expect(ids.has("c")).toBe(true);
    expect(ids.size).toBe(2);
  });
});

describe("computeDatePartnerShare", () => {
  it("dateAccountId null → 0/0", () => {
    const fExp = [entry({ id: "1", amount: 50_000, fromAccountId: "any" })];
    expect(computeDatePartnerShare(fExp, null)).toEqual({ dateAccountSpend: 0, datePartnerShare: 0 });
  });

  it("매칭되는 항목만 합산, 절반이 상대 부담분", () => {
    const fExp = [
      entry({ id: "1", amount: 100_000, fromAccountId: "date" }),
      entry({ id: "2", amount: 50_000, fromAccountId: "date" }),
      entry({ id: "3", amount: 30_000, fromAccountId: "other" }),
    ];
    const r = computeDatePartnerShare(fExp, "date");
    expect(r.dateAccountSpend).toBe(150_000);
    expect(r.datePartnerShare).toBe(75_000);
  });

  it("빈 fExp → 0/0", () => {
    expect(computeDatePartnerShare([], "date")).toEqual({ dateAccountSpend: 0, datePartnerShare: 0 });
  });

  it("매칭 없으면 0/0", () => {
    const fExp = [entry({ id: "1", amount: 10, fromAccountId: "other" })];
    expect(computeDatePartnerShare(fExp, "date")).toEqual({ dateAccountSpend: 0, datePartnerShare: 0 });
  });
});

describe("splitDateMoimVsPersonal", () => {
  const moimIds = new Set(["moim1", "moim2"]);

  it("모임 계좌 출처 → dateMoim, 그 외 → datePersonal", () => {
    const dateEntries = [
      entry({ id: "1", amount: 10_000, fromAccountId: "moim1" }),
      entry({ id: "2", amount: 20_000, fromAccountId: "moim2" }),
      entry({ id: "3", amount: 30_000, fromAccountId: "personal" }),
    ];
    const r = splitDateMoimVsPersonal(dateEntries, moimIds);
    expect(r.dateMoim).toBe(30_000);
    expect(r.datePersonal).toBe(30_000);
  });

  it("fromAccountId 없으면 datePersonal로 분류", () => {
    const dateEntries = [entry({ id: "1", amount: 5_000 })];
    const r = splitDateMoimVsPersonal(dateEntries, moimIds);
    expect(r.dateMoim).toBe(0);
    expect(r.datePersonal).toBe(5_000);
  });

  it("빈 배열 → 0/0", () => {
    expect(splitDateMoimVsPersonal([], moimIds)).toEqual({ dateMoim: 0, datePersonal: 0 });
  });
});
