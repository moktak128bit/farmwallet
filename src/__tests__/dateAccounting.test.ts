import { describe, it, expect } from "vitest";
import {
  isDateEntry,
  isMoimAccount,
  getMoimAccountIds,
  computeDatePartnerShare,
  splitDateMoimVsPersonal,
  computeDateAccountUtilization,
  computeMoimAccountFlow,
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

describe("computeDateAccountUtilization", () => {
  it("100% 분담통장 사용 — utilizationRate=1, lostShareSavings=0", () => {
    const r = computeDateAccountUtilization({ dateMoim: 1_000_000, datePersonal: 0 });
    expect(r.utilizationRate).toBe(1);
    expect(r.currentSelfBurden).toBe(500_000);   // 100만 × 50%
    expect(r.optimalSelfBurden).toBe(500_000);   // 동일
    expect(r.lostShareSavings).toBe(0);
  });

  it("0% 분담통장 사용 (전부 본인 카드) — utilizationRate=0, lostShareSavings=절반", () => {
    const r = computeDateAccountUtilization({ dateMoim: 0, datePersonal: 1_000_000 });
    expect(r.utilizationRate).toBe(0);
    expect(r.currentSelfBurden).toBe(1_000_000);  // 100% 본인
    expect(r.optimalSelfBurden).toBe(500_000);    // 분담했다면 50%
    expect(r.lostShareSavings).toBe(500_000);     // 절반이 그냥 새는 중
  });

  it("50/50 사용 (분담통장 절반, 개인 절반)", () => {
    const r = computeDateAccountUtilization({ dateMoim: 500_000, datePersonal: 500_000 });
    expect(r.utilizationRate).toBe(0.5);
    expect(r.currentSelfBurden).toBe(750_000);    // 25만(분담) + 50만(개인)
    expect(r.optimalSelfBurden).toBe(500_000);
    expect(r.lostShareSavings).toBe(250_000);     // 개인 결제 50만의 절반
  });

  it("데이트 지출 0 — 모든 값 0, NaN 없음", () => {
    const r = computeDateAccountUtilization({ dateMoim: 0, datePersonal: 0 });
    expect(r.utilizationRate).toBe(0);
    expect(r.currentSelfBurden).toBe(0);
    expect(r.optimalSelfBurden).toBe(0);
    expect(r.lostShareSavings).toBe(0);
    expect(r.totalDate).toBe(0);
  });

  it("회귀: lostShareSavings = 개인 결제분의 정확히 50%", () => {
    const personalCases = [200_000, 1_500_000, 7_777_777];
    for (const personal of personalCases) {
      const r = computeDateAccountUtilization({ dateMoim: 100_000, datePersonal: personal });
      expect(r.lostShareSavings).toBe(personal / 2);
    }
  });
});

describe("computeMoimAccountFlow", () => {
  const moimId = "moim";
  const months = ["2026-01", "2026-02", "2026-03"];

  it("accountId null → 빈 결과", () => {
    const r = computeMoimAccountFlow([entry({ id: "1", amount: 100, toAccountId: moimId, kind: "transfer" })], null, months);
    expect(r.months).toEqual([]);
    expect(r.cumBalance).toBe(0);
  });

  it("월별 transfer/income/expense 분리 합산", () => {
    const ledger = [
      entry({ id: "t1", date: "2026-01-15", kind: "transfer", amount: 300_000, fromAccountId: "a", toAccountId: moimId }),
      entry({ id: "i1", date: "2026-01-20", kind: "income", amount: 301_600, toAccountId: moimId, category: "이체" }),
      entry({ id: "e1", date: "2026-01-25", kind: "expense", amount: 576_747, fromAccountId: moimId, category: "데이트" }),
      entry({ id: "t2", date: "2026-02-15", kind: "transfer", amount: 300_000, fromAccountId: "a", toAccountId: moimId }),
      entry({ id: "i2", date: "2026-02-20", kind: "income", amount: 300_527, toAccountId: moimId, category: "이체" }),
      entry({ id: "e2", date: "2026-02-25", kind: "expense", amount: 272_300, fromAccountId: moimId, category: "데이트" }),
    ];
    const r = computeMoimAccountFlow(ledger, moimId, months);
    expect(r.months).toHaveLength(3);
    expect(r.months[0]).toEqual({
      month: "2026-01",
      myTransfer: 300_000,
      partnerDeposit: 301_600,
      spending: 576_747,
      balanceChange: 300_000 + 301_600 - 576_747,  // +24,853
    });
    expect(r.months[1].balanceChange).toBe(300_000 + 300_527 - 272_300);
    expect(r.months[2].balanceChange).toBe(0);
    expect(r.cumBalance).toBe(r.months[0].balanceChange + r.months[1].balanceChange);
  });

  it("이상감지: 상대 입금이 평균 50% 미만이면 partner_low 경고", () => {
    const ledger = [
      // 2026-01, 02, 03에 평균 30만원 상대 입금. 04월은 1500원만
      entry({ id: "i1", date: "2026-01-20", kind: "income", amount: 300_000, toAccountId: moimId, category: "이체" }),
      entry({ id: "i2", date: "2026-02-20", kind: "income", amount: 300_000, toAccountId: moimId, category: "이체" }),
      entry({ id: "i3", date: "2026-03-20", kind: "income", amount: 300_000, toAccountId: moimId, category: "이체" }),
      entry({ id: "i4", date: "2026-04-20", kind: "income", amount: 1_500, toAccountId: moimId, category: "이체" }),
    ];
    const r = computeMoimAccountFlow(ledger, moimId, ["2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(r.anomalies).toHaveLength(1);
    expect(r.anomalies[0].month).toBe("2026-04");
    expect(r.anomalies[0].type).toBe("partner_low");
  });

  it("다른 계좌 거래는 무시", () => {
    const ledger = [
      entry({ id: "t1", date: "2026-01-15", kind: "transfer", amount: 100_000, toAccountId: "other" }),
      entry({ id: "e1", date: "2026-01-25", kind: "expense", amount: 50_000, fromAccountId: "other", category: "데이트" }),
    ];
    const r = computeMoimAccountFlow(ledger, moimId, months);
    expect(r.months[0].myTransfer).toBe(0);
    expect(r.months[0].spending).toBe(0);
  });

  it("amount NaN/음수는 무시 (방어적)", () => {
    const ledger = [
      entry({ id: "1", date: "2026-01-01", kind: "transfer", amount: NaN, toAccountId: moimId }),
      entry({ id: "2", date: "2026-01-02", kind: "transfer", amount: -1000, toAccountId: moimId }),
      entry({ id: "3", date: "2026-01-03", kind: "transfer", amount: 100, toAccountId: moimId }),
    ];
    const r = computeMoimAccountFlow(ledger, moimId, months);
    expect(r.months[0].myTransfer).toBe(100);
  });
});
