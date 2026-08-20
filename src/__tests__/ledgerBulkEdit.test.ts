import { describe, it, expect } from "vitest";
import { applyBulkEdit, isBulkEditPatchEmpty, shiftIsoDate, type BulkEditContext } from "../utils/ledgerBulkEdit";
import type { Account, CategoryPresets, LedgerEntry } from "../types";

const entry = (o: Partial<LedgerEntry> & { id: string }): LedgerEntry => ({
  date: "2026-03-15",
  kind: "expense",
  category: "지출",
  subCategory: "식비",
  detailCategory: "카페",
  description: "",
  amount: 5000,
  fromAccountId: "A1",
  ...o,
} as LedgerEntry);

const accounts: Account[] = [
  { id: "A1", name: "신한", institution: "", type: "bank", initialBalance: 0 },
  { id: "A2", name: "국민", institution: "", type: "bank", initialBalance: 0 },
  { id: "C1", name: "카드", institution: "", type: "card", initialBalance: 0 },
] as Account[];

const presets: CategoryPresets = {
  income: ["급여", "배당", "이자", "정산"],
  expense: ["식비", "유류교통비", "재테크", "저축성지출"],
  expenseDetails: [{ main: "식비", subs: ["카페", "외식"] }],
  transfer: ["저축이체", "투자이체", "카드결제이체", "계좌이체"],
  categoryTypes: { savings: ["재테크", "저축성지출"] },
};

const ctx = (ids: string[], extra?: Partial<BulkEditContext>): BulkEditContext => ({
  selectedIds: new Set(ids),
  accounts,
  categoryPresets: presets,
  ...extra,
});

describe("shiftIsoDate", () => {
  it("일 가산/감산", () => {
    expect(shiftIsoDate("2026-03-01", { days: -1 })).toBe("2026-02-28");
    expect(shiftIsoDate("2026-03-31", { days: 1 })).toBe("2026-04-01");
  });
  it("월 가산은 말일 클램프", () => {
    expect(shiftIsoDate("2026-01-31", { months: 1 })).toBe("2026-02-28");
    expect(shiftIsoDate("2024-01-31", { months: 1 })).toBe("2024-02-29");
    expect(shiftIsoDate("2026-03-31", { months: -1 })).toBe("2026-02-28");
    expect(shiftIsoDate("2026-12-15", { months: 1 })).toBe("2027-01-15");
  });
  it("월+일 조합: 월 먼저(클램프) 후 일", () => {
    expect(shiftIsoDate("2026-01-31", { months: 1, days: 1 })).toBe("2026-03-01");
  });
  it("유효하지 않은 날짜는 null", () => {
    expect(shiftIsoDate("2026-02-30", { days: 1 })).toBeNull();
    expect(shiftIsoDate("", { days: 1 })).toBeNull();
  });
});

describe("isBulkEditPatchEmpty", () => {
  it("빈 패치 판정", () => {
    expect(isBulkEditPatchEmpty({})).toBe(true);
    expect(isBulkEditPatchEmpty({ category: { kind: "expense" } })).toBe(true);
    expect(isBulkEditPatchEmpty({ dateShift: { days: 0 } })).toBe(true);
    expect(isBulkEditPatchEmpty({ addTags: [] })).toBe(true);
    expect(isBulkEditPatchEmpty({ category: { kind: "expense", sub: "식비" } })).toBe(false);
    expect(isBulkEditPatchEmpty({ fromAccountId: null })).toBe(false);
    expect(isBulkEditPatchEmpty({ isFixedExpense: false })).toBe(false);
  });
});

describe("applyBulkEdit — 분류", () => {
  it("지출 대분류/소분류 변경은 현행 3단 형태로 기록", () => {
    const ledger = [entry({ id: "1" }), entry({ id: "2", description: "미선택" })];
    const r = applyBulkEdit(ledger, { category: { kind: "expense", sub: "유류교통비", detail: "택시" } }, ctx(["1"]));
    expect(r.next[0]).toMatchObject({ category: "지출", subCategory: "유류교통비", detailCategory: "택시", kind: "expense" });
    expect(r.next[1]).toBe(ledger[1]); // 미선택 참조 유지
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0].fields).toEqual(["category"]);
    expect(r.changes[0].promoted).toBe(false);
    expect(r.skipped).toHaveLength(0);
  });

  it("detail=null이면 소분류 비움, undefined면 유지", () => {
    const ledger = [entry({ id: "1" }), entry({ id: "2" })];
    const r1 = applyBulkEdit(ledger, { category: { kind: "expense", sub: "식비", detail: null } }, ctx(["1"]));
    expect(r1.next[0].detailCategory).toBeUndefined();
    expect(r1.next[0].subCategory).toBe("식비");
    const r2 = applyBulkEdit(ledger, { category: { kind: "expense", sub: "유류교통비" } }, ctx(["2"]));
    expect(r2.next[1].detailCategory).toBe("카페"); // 유지(명시 안 함)
  });

  it("레거시(category=대분류 직접) 지출은 현행 형태로 승격 + promoted 표시 + 경고", () => {
    const ledger = [entry({ id: "L", category: "식비", subCategory: undefined, detailCategory: undefined })];
    const r = applyBulkEdit(ledger, { category: { kind: "expense", sub: "유류교통비" } }, ctx(["L"]));
    expect(r.next[0]).toMatchObject({ category: "지출", subCategory: "유류교통비" });
    expect(r.changes[0].promoted).toBe(true);
    expect(r.warnings.some((w) => w.includes("승격"))).toBe(true);
  });

  it("레거시 항목은 sub 미지정(소분류만)이어도 승격되며 대분류는 expenseMainName 유지", () => {
    const ledger = [entry({ id: "L", category: "식비", subCategory: undefined, detailCategory: undefined })];
    const r = applyBulkEdit(ledger, { category: { kind: "expense", detail: "외식" } }, ctx(["L"]));
    expect(r.next[0]).toMatchObject({ category: "지출", subCategory: "식비", detailCategory: "외식" });
    expect(r.changes[0].promoted).toBe(true);
  });

  it("수입/이체 중분류 변경 — category는 kind 라벨, detailCategory 없음", () => {
    const ledger = [
      entry({ id: "I", kind: "income", category: "수입", subCategory: "급여", detailCategory: undefined, fromAccountId: undefined, toAccountId: "A1" }),
      entry({ id: "T", kind: "transfer", category: "계좌이체", subCategory: undefined, detailCategory: undefined, toAccountId: "A2" }),
    ];
    const ri = applyBulkEdit(ledger, { category: { kind: "income", sub: "기타수입" } }, ctx(["I"]));
    expect(ri.next[0]).toMatchObject({ kind: "income", category: "수입", subCategory: "기타수입" });
    const rt = applyBulkEdit(ledger, { category: { kind: "transfer", sub: "계좌이체" } }, ctx(["T"]));
    expect(rt.next[1]).toMatchObject({ kind: "transfer", category: "이체", subCategory: "계좌이체" });
    expect(rt.next[1].detailCategory).toBeUndefined();
    expect(rt.changes[0].promoted).toBe(true);
  });

  it("patch.kind와 다른 kind 항목은 분류 변경 제외(사유)", () => {
    const ledger = [entry({ id: "I", kind: "income", category: "수입", subCategory: "급여" })];
    const r = applyBulkEdit(ledger, { category: { kind: "expense", sub: "식비" } }, ctx(["I"]));
    expect(r.next[0]).toBe(ledger[0]);
    expect(r.skipped).toEqual([{ id: "I", reason: expect.stringContaining("수입 항목") }]);
  });

  it("재테크(투자수익/투자손실/배당/이자/저축·투자이체/저축성지출)는 분류 변경 제외", () => {
    const ledger = [
      entry({ id: "gain", kind: "income", category: "수입", subCategory: "투자수익" }),
      entry({ id: "loss", kind: "expense", category: "재테크", subCategory: "투자손실" }),
      entry({ id: "div", kind: "income", category: "수입", subCategory: "배당" }),
      entry({ id: "int", kind: "income", category: "수입", subCategory: "이자" }),
      entry({ id: "sav", kind: "transfer", category: "이체", subCategory: "저축이체" }),
      entry({ id: "inv", kind: "transfer", category: "이체", subCategory: "투자이체" }),
      entry({ id: "savexp", kind: "expense", category: "저축성지출", subCategory: "적금" }),
      entry({ id: "legacyInv", kind: "expense", category: "재테크", subCategory: "투자" }),
    ];
    for (const kind of ["income", "expense", "transfer"] as const) {
      const r = applyBulkEdit(ledger, { category: { kind, sub: "X" } }, ctx(ledger.map((l) => l.id)));
      expect(r.changes).toHaveLength(0);
      expect(r.next.every((l, i) => l === ledger[i])).toBe(true);
      const wealth = r.skipped.filter((s) => s.reason.includes("재테크")).map((s) => s.id);
      const sameKind = ledger.filter((l) => l.kind === kind).map((l) => l.id);
      expect(wealth.sort()).toEqual(sameKind.sort());
    }
  });

  it("정산·환전·카드결제이체·레거시 신용결제는 분류 변경 제외", () => {
    const ledger = [
      entry({ id: "settle", kind: "income", category: "수입", subCategory: "정산", toAccountId: "A1", settledLedgerIds: ["x"] }),
      entry({ id: "settle2", kind: "income", category: "수입", subCategory: "기타수입", toAccountId: "A1", settledLedgerIds: ["x"] }),
      entry({ id: "fx", kind: "expense", category: "지출", subCategory: "환전" }),
      entry({ id: "card", kind: "transfer", category: "이체", subCategory: "카드결제이체", toAccountId: "C1" }),
      entry({ id: "credit", kind: "expense", category: "신용결제", subCategory: undefined }),
    ];
    const ri = applyBulkEdit(ledger, { category: { kind: "income", sub: "급여" } }, ctx(["settle", "settle2"]));
    expect(ri.changes).toHaveLength(0);
    expect(ri.skipped.map((s) => s.id).sort()).toEqual(["settle", "settle2"]);
    const re = applyBulkEdit(ledger, { category: { kind: "expense", sub: "식비" } }, ctx(["fx", "credit"]));
    expect(re.changes).toHaveLength(0);
    expect(re.skipped.map((s) => s.id).sort()).toEqual(["credit", "fx"]);
    const rt = applyBulkEdit(ledger, { category: { kind: "transfer", sub: "계좌이체" } }, ctx(["card"]));
    expect(rt.changes).toHaveLength(0);
    expect(rt.skipped[0].reason).toContain("카드결제이체");
  });

  it("이미 동일한 분류면 변경 없음(참조 유지)으로 skipped", () => {
    const ledger = [entry({ id: "1" })];
    const r = applyBulkEdit(ledger, { category: { kind: "expense", sub: "식비", detail: "카페" } }, ctx(["1"]));
    expect(r.next[0]).toBe(ledger[0]);
    expect(r.skipped[0].reason).toContain("동일");
  });
});

describe("applyBulkEdit — 계좌", () => {
  it("지출 출금 계좌 변경 / 수입 입금 계좌 변경 / kind에 없는 축은 제외", () => {
    const ledger = [
      entry({ id: "E" }),
      entry({ id: "I", kind: "income", category: "수입", subCategory: "급여", fromAccountId: undefined, toAccountId: "A1" }),
    ];
    const r = applyBulkEdit(ledger, { fromAccountId: "A2", toAccountId: "A2" }, ctx(["E", "I"]));
    expect(r.next[0].fromAccountId).toBe("A2");
    expect(r.next[0].toAccountId).toBeUndefined(); // 지출에 입금 계좌 생기지 않음
    expect(r.next[1].toAccountId).toBe("A2");
    expect(r.next[1].fromAccountId).toBeUndefined();
    const e = r.changes.find((c) => c.id === "E")!;
    expect(e.fields).toEqual(["fromAccount"]);
    expect(e.partialSkips.map((p) => p.field)).toEqual(["toAccount"]);
  });

  it("계좌 비움(null)", () => {
    const ledger = [entry({ id: "E" })];
    const r = applyBulkEdit(ledger, { fromAccountId: null }, ctx(["E"]));
    expect("fromAccountId" in r.next[0]).toBe(false);
    expect(r.changes[0].fields).toEqual(["fromAccount"]);
  });

  it("이체 출금·입금이 같아지면 제외", () => {
    const ledger = [entry({ id: "T", kind: "transfer", category: "이체", subCategory: "계좌이체", fromAccountId: "A1", toAccountId: "A2" })];
    const r = applyBulkEdit(ledger, { fromAccountId: "A2" }, ctx(["T"]));
    expect(r.next[0]).toBe(ledger[0]);
    expect(r.skipped[0].reason).toContain("같아짐");
  });

  it("정산 항목·정산으로 청산된 지출·환전·카드결제이체·신용결제는 계좌 변경 제외", () => {
    const ledger = [
      entry({ id: "paid", description: "정산 대상 지출" }),
      entry({ id: "settle", kind: "income", category: "수입", subCategory: "정산", fromAccountId: undefined, toAccountId: "A1", settledLedgerIds: ["paid"] }),
      entry({ id: "settle2", kind: "income", category: "수입", subCategory: "기타수입", fromAccountId: undefined, toAccountId: "A1", settledLedgerIds: ["paid"] }),
      entry({ id: "fx", kind: "transfer", category: "이체", subCategory: "환전", toAccountId: "A2" }),
      entry({ id: "card", kind: "transfer", category: "이체", subCategory: "카드결제이체", toAccountId: "C1" }),
      entry({ id: "credit", kind: "expense", category: "신용결제", subCategory: undefined }),
      entry({ id: "ok" }),
    ];
    const r = applyBulkEdit(ledger, { fromAccountId: "A2", toAccountId: "A2" }, ctx(ledger.map((l) => l.id)));
    expect(r.changes.map((c) => c.id)).toEqual(["ok"]);
    expect(r.next[6].fromAccountId).toBe("A2");
    const skippedIds = r.skipped.map((s) => s.id).sort();
    expect(skippedIds).toEqual(["card", "credit", "fx", "paid", "settle", "settle2"]);
    expect(r.skipped.find((s) => s.id === "paid")!.reason).toContain("청산");
    expect(r.skipped.find((s) => s.id === "settle2")!.reason).toContain("정산");
    // settledLedgerIds 보존
    expect(r.next[1].settledLedgerIds).toEqual(["paid"]);
  });

  it("존재하지 않는 계좌 id는 경고 + 무시", () => {
    const ledger = [entry({ id: "E" })];
    const r = applyBulkEdit(ledger, { fromAccountId: "NOPE" }, ctx(["E"]));
    expect(r.next[0]).toBe(ledger[0]);
    expect(r.warnings.some((w) => w.includes("출금 계좌"))).toBe(true);
  });
});

describe("applyBulkEdit — 날짜", () => {
  it("±N일 이동, 월 경계 건수 경고", () => {
    const ledger = [entry({ id: "a", date: "2026-03-31" }), entry({ id: "b", date: "2026-03-10" })];
    const r = applyBulkEdit(ledger, { dateShift: { days: 1 } }, ctx(["a", "b"]));
    expect(r.next[0].date).toBe("2026-04-01");
    expect(r.next[1].date).toBe("2026-03-11");
    expect(r.warnings.some((w) => w.startsWith("1건") && w.includes("월 경계"))).toBe(true);
  });

  it("±N월 이동 말일 클램프, 월 경계 경고는 전건", () => {
    const ledger = [entry({ id: "a", date: "2026-01-31" }), entry({ id: "b", date: "2026-01-15" })];
    const r = applyBulkEdit(ledger, { dateShift: { months: 1 } }, ctx(["a", "b"]));
    expect(r.next[0].date).toBe("2026-02-28");
    expect(r.next[1].date).toBe("2026-02-15");
    expect(r.warnings.some((w) => w.startsWith("2건"))).toBe(true);
  });

  it("0 이동은 변경 없음, 잘못된 날짜는 제외 사유", () => {
    const ledger = [entry({ id: "a" }), entry({ id: "bad", date: "2026-02-30" })];
    const r0 = applyBulkEdit(ledger, { dateShift: { days: 0 } }, ctx(["a"]));
    expect(r0.next[0]).toBe(ledger[0]);
    const r = applyBulkEdit(ledger, { dateShift: { days: 1 } }, ctx(["bad"]));
    expect(r.next[1]).toBe(ledger[1]);
    expect(r.skipped[0].reason).toContain("날짜 형식");
  });
});

describe("applyBulkEdit — 태그·고정지출", () => {
  it("태그 추가(중복 제거·trim)/제거, 비면 필드 삭제", () => {
    const ledger = [entry({ id: "a", tags: ["여행", "식사"] }), entry({ id: "b" })];
    const r = applyBulkEdit(ledger, { addTags: [" 여행 ", "출장", "출장"], removeTags: ["식사"] }, ctx(["a", "b"]));
    expect(r.next[0].tags).toEqual(["여행", "출장"]);
    expect(r.next[1].tags).toEqual(["여행", "출장"]);
    const r2 = applyBulkEdit(r.next, { removeTags: ["여행", "출장"] }, ctx(["a"]));
    expect("tags" in r2.next[0]).toBe(false);
  });

  it("태그 변화 없으면 skipped", () => {
    const ledger = [entry({ id: "a", tags: ["여행"] })];
    const r = applyBulkEdit(ledger, { addTags: ["여행"] }, ctx(["a"]));
    expect(r.next[0]).toBe(ledger[0]);
    expect(r.skipped).toHaveLength(1);
  });

  it("고정지출 플래그는 지출만", () => {
    const ledger = [entry({ id: "E" }), entry({ id: "I", kind: "income", category: "수입", subCategory: "급여" })];
    const r = applyBulkEdit(ledger, { isFixedExpense: true }, ctx(["E", "I"]));
    expect(r.next[0].isFixedExpense).toBe(true);
    expect(r.next[1]).toBe(ledger[1]);
    expect(r.skipped[0]).toEqual({ id: "I", reason: expect.stringContaining("지출 항목만") });
  });
});

describe("applyBulkEdit — 불변 규칙", () => {
  it("kind·amount·currency·discountAmount·loanId·settledLedgerIds는 어떤 패치로도 바뀌지 않음(USD 포함)", () => {
    const ledger = [
      entry({ id: "usd", kind: "transfer", category: "이체", subCategory: "계좌이체", currency: "USD", amount: 12.5, toAccountId: "C1" }),
      entry({ id: "krw", amount: 3000, discountAmount: 500, loanId: "LN1" }),
    ];
    const r = applyBulkEdit(
      ledger,
      {
        category: { kind: "expense", sub: "유류교통비", detail: "택시" },
        fromAccountId: "A2",
        dateShift: { days: 3 },
        addTags: ["t"],
        isFixedExpense: true,
      },
      ctx(["usd", "krw"])
    );
    for (let i = 0; i < ledger.length; i++) {
      expect(r.next[i].kind).toBe(ledger[i].kind);
      expect(r.next[i].amount).toBe(ledger[i].amount);
      expect(r.next[i].currency).toBe(ledger[i].currency);
      expect(r.next[i].discountAmount).toBe(ledger[i].discountAmount);
      expect(r.next[i].loanId).toBe(ledger[i].loanId);
      expect(r.next[i].id).toBe(ledger[i].id);
    }
    expect(r.next[0].fromAccountId).toBe("A2");
    expect(r.next[0].date).toBe("2026-03-18");
  });

  it("주식 가상 행(_tradeId)·가계부에 없는 선택 id는 제외", () => {
    const virtual = { ...entry({ id: "v" }), _tradeId: "T1" } as LedgerEntry;
    const ledger = [entry({ id: "a" }), virtual];
    const r = applyBulkEdit(ledger, { addTags: ["x"] }, ctx(["a", "v", "ghost"]));
    expect(r.next[1]).toBe(virtual);
    expect(r.changes.map((c) => c.id)).toEqual(["a"]);
    expect(r.skipped.map((s) => s.id).sort()).toEqual(["ghost", "v"]);
  });

  it("원본 배열·원본 항목을 변이하지 않음, 순서 유지", () => {
    const ledger = [entry({ id: "a", tags: ["k"] }), entry({ id: "b" })];
    const snapshot = JSON.stringify(ledger);
    const r = applyBulkEdit(ledger, { addTags: ["z"], dateShift: { days: 1 } }, ctx(["a", "b"]));
    expect(JSON.stringify(ledger)).toBe(snapshot);
    expect(r.next.map((l) => l.id)).toEqual(["a", "b"]);
    expect(r.changes[0].before).toBe(ledger[0]);
  });

  it("여러 필드 동시 적용 시 fields에 모두 기록", () => {
    const ledger = [entry({ id: "a" })];
    const r = applyBulkEdit(
      ledger,
      { category: { kind: "expense", sub: "유류교통비", detail: null }, fromAccountId: "A2", dateShift: { days: -1 }, addTags: ["t"], isFixedExpense: true },
      ctx(["a"])
    );
    expect(r.changes[0].fields).toEqual(["category", "fromAccount", "date", "tags", "fixed"]);
  });
});
