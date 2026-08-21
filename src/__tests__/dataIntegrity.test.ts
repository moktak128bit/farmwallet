import { describe, it, expect } from "vitest";
import { runIntegrityCheck, runStructuralChecks } from "../utils/dataIntegrity";
import type { IntegrityIssue, DuplicateTrade, MissingReference, CategoryMismatch } from "../utils/dataIntegrity";
import type { Account, LedgerEntry, StockTrade, CategoryPresets, Loan } from "../types";

/**
 * 무결성 검사(runIntegrityCheck) 행동 테스트.
 *  - 중복: 동일 id(error, 자동 제거 가능) vs 내용 동일·id 상이(warning)
 *  - 참조 누락: 존재하지 않는 계좌 id (from/to/trade.accountId) — 계좌 id별로 1건, usedIn 집계
 *  - 이체 쌍: from/to 누락 → transfer_invalid_reference, 정상 쌍 → 합계 0 (mismatch 없음)
 *  - 날짜/금액/카테고리/USD 증권 일관성
 *  - 깨끗한 데이터 → []
 */

function account(partial: Partial<Account> & Pick<Account, "id" | "type">): Account {
  return { name: partial.id, institution: "테스트", initialBalance: 0, ...partial };
}

function entry(partial: Partial<LedgerEntry> & Pick<LedgerEntry, "id" | "kind">): LedgerEntry {
  return { date: "2026-01-10", description: "", amount: 10_000, category: "", ...partial };
}

function trade(partial: Partial<StockTrade> & Pick<StockTrade, "id">): StockTrade {
  const quantity = partial.quantity ?? 10;
  const price = partial.price ?? 70_000;
  const fee = partial.fee ?? 0;
  const side = partial.side ?? "buy";
  const totalAmount = partial.totalAmount ?? (side === "buy" ? quantity * price + fee : quantity * price - fee);
  return {
    date: "2026-01-10",
    accountId: "S1",
    ticker: "005930",
    name: "삼성전자",
    side,
    quantity,
    price,
    fee,
    totalAmount,
    cashImpact: partial.cashImpact ?? (side === "buy" ? -totalAmount : totalAmount),
    ...partial,
  };
}

const ACCOUNTS: Account[] = [
  account({ id: "A1", type: "checking", name: "입출금" }),
  account({ id: "A2", type: "savings", name: "적금" }),
  account({ id: "C1", type: "card", name: "카드" }),
  account({ id: "S1", type: "securities", name: "증권" }),
];

const PRESETS: CategoryPresets = {
  income: ["급여", "정산"],
  expense: ["식비", "유류교통비"],
  transfer: ["저축이체", "카드결제이체", "환전"],
  expenseDetails: [{ main: "식비", subs: ["시장/마트", "카페"] }],
};

/** 표준 스키마 + 현행 이체 — 문제 없어야 하는 기준 데이터 */
const CLEAN_LEDGER: LedgerEntry[] = [
  entry({ id: "L1", kind: "expense", category: "지출", subCategory: "식비", detailCategory: "시장/마트", fromAccountId: "A1", description: "장보기" }),
  entry({ id: "L2", kind: "income", category: "수입", subCategory: "급여", toAccountId: "A1", amount: 3_000_000, description: "월급" }),
  entry({ id: "L3", kind: "transfer", category: "이체", subCategory: "저축이체", fromAccountId: "A1", toAccountId: "A2", amount: 500_000 }),
  entry({ id: "L4", kind: "transfer", category: "이체", subCategory: "카드결제이체", fromAccountId: "A1", toAccountId: "C1", amount: 200_000 }),
  entry({ id: "L5", kind: "transfer", category: "이체", subCategory: "환전", fromAccountId: "A1", toAccountId: "S1", amount: 100, currency: "USD" }),
];
const CLEAN_TRADES: StockTrade[] = [trade({ id: "T1" })];

function ofType(issues: IntegrityIssue[], type: IntegrityIssue["type"]) {
  return issues.filter((i) => i.type === type);
}

describe("dataIntegrity — 기준 데이터", () => {
  it("깨끗한 데이터(표준 스키마·정상 이체 쌍·프리셋 일치)는 이슈 0건", () => {
    expect(runIntegrityCheck(ACCOUNTS, CLEAN_LEDGER, CLEAN_TRADES, PRESETS)).toEqual([]);
  });

  it("빈 입력도 안전 (프리셋 없음)", () => {
    expect(runIntegrityCheck([], [], [])).toEqual([]);
  });

  it("순수 함수: 입력을 변형하지 않는다", () => {
    const ledger = [...CLEAN_LEDGER, entry({ id: "L1", kind: "expense", category: "지출", subCategory: "식비", fromAccountId: "A1" })];
    const snapshot = JSON.parse(JSON.stringify({ ACCOUNTS, ledger, CLEAN_TRADES }));
    runIntegrityCheck(ACCOUNTS, ledger, CLEAN_TRADES, PRESETS);
    expect(JSON.parse(JSON.stringify({ ACCOUNTS, ledger, CLEAN_TRADES }))).toEqual(snapshot);
  });
});

describe("dataIntegrity — 중복 탐지", () => {
  it("가계부 동일 id 중복 → error 1건(sameId=true), 내용도 같지만 내용중복(warning)으로 이중 보고하지 않음", () => {
    const dup = entry({ id: "L1", kind: "expense", category: "지출", subCategory: "식비", detailCategory: "시장/마트", fromAccountId: "A1", description: "장보기" });
    const issues = runIntegrityCheck(ACCOUNTS, [...CLEAN_LEDGER, dup], CLEAN_TRADES, PRESETS);
    const dups = ofType(issues, "duplicate");
    expect(dups).toHaveLength(1);
    expect(dups[0].severity).toBe("error");
    const data = dups[0].data as DuplicateTrade;
    expect(data).toMatchObject({ type: "ledger", sameId: true, similarity: 1.0 });
    expect(data.entries).toHaveLength(2);
    expect(data.entries.map((e) => e.id)).toEqual(["L1", "L1"]);
    expect(dups[0].message).toContain("동일 ID 중복 2건");
  });

  it("동일 id 3건이면 entries 3개로 한 그룹", () => {
    const base = CLEAN_LEDGER[0];
    const issues = runIntegrityCheck(ACCOUNTS, [...CLEAN_LEDGER, { ...base }, { ...base, amount: 1 }], CLEAN_TRADES, PRESETS);
    const dups = ofType(issues, "duplicate");
    expect(dups).toHaveLength(1);
    expect((dups[0].data as DuplicateTrade).entries).toHaveLength(3);
  });

  it("내용 동일·id 상이 → warning(sameId=false), description만 달라도 중복 아님", () => {
    const base = CLEAN_LEDGER[0];
    const sameContent = { ...base, id: "L1b" };
    const differentDesc = { ...base, id: "L1c", description: "다른 설명" };
    const issues = runIntegrityCheck(ACCOUNTS, [...CLEAN_LEDGER, sameContent, differentDesc], CLEAN_TRADES, PRESETS);
    const dups = ofType(issues, "duplicate");
    expect(dups).toHaveLength(1);
    expect(dups[0].severity).toBe("warning");
    const data = dups[0].data as DuplicateTrade;
    expect(data.sameId).toBe(false);
    expect(data.entries.map((e) => e.id).sort()).toEqual(["L1", "L1b"]);
    expect(dups[0].message).toContain("자동 제거하지 않음");
  });

  it("내용 중복 키는 통화를 포함 — KRW/USD만 다르면 중복 아님", () => {
    const base = CLEAN_LEDGER[0];
    const usd = { ...base, id: "L1usd", currency: "USD" as const };
    const issues = runIntegrityCheck(ACCOUNTS, [...CLEAN_LEDGER, usd], CLEAN_TRADES, PRESETS);
    expect(ofType(issues, "duplicate")).toEqual([]);
  });

  it("id가 빈 항목은 동일 id 그룹에서 제외(내용 중복 검사는 계속)", () => {
    const a = entry({ id: "", kind: "expense", category: "지출", subCategory: "식비", fromAccountId: "A1", description: "x" });
    const b = { ...a, date: "2026-01-11" };
    const issues = runIntegrityCheck(ACCOUNTS, [a, b], [], PRESETS);
    expect(ofType(issues, "duplicate")).toEqual([]);
  });

  it("주식 거래: 동일 id → error, 내용(날짜·계좌·티커·side·수량·가격) 동일·id 상이 → warning", () => {
    const t1 = trade({ id: "T1" });
    const issues = runIntegrityCheck(
      ACCOUNTS,
      [],
      [t1, { ...t1 }, trade({ id: "T2" }), trade({ id: "T3", price: 71_000 })],
      PRESETS,
    );
    const dups = ofType(issues, "duplicate");
    const sameId = dups.filter((d) => (d.data as DuplicateTrade).sameId);
    const content = dups.filter((d) => !(d.data as DuplicateTrade).sameId);
    expect(sameId).toHaveLength(1);
    expect(sameId[0].severity).toBe("error");
    expect((sameId[0].data as DuplicateTrade).type).toBe("trade");
    expect(content).toHaveLength(1);
    expect(content[0].severity).toBe("warning");
    // 내용 그룹: T1(2개)+T2 → id 상이 → 3건 entries
    expect((content[0].data as DuplicateTrade).entries.map((e) => e.id).sort()).toEqual(["T1", "T1", "T2"]);
  });
});

describe("dataIntegrity — 참조 누락", () => {
  it("존재하지 않는 계좌 참조는 계좌 id별 1건(error), usedIn에 항목·필드 집계", () => {
    const ledger = [
      ...CLEAN_LEDGER,
      entry({ id: "G1", kind: "expense", category: "지출", subCategory: "식비", fromAccountId: "GHOST" }),
      entry({ id: "G2", kind: "income", category: "수입", subCategory: "급여", toAccountId: "GHOST" }),
      entry({ id: "G3", kind: "transfer", category: "이체", subCategory: "저축이체", fromAccountId: "A1", toAccountId: "GHOST2" }),
    ];
    const trades = [...CLEAN_TRADES, trade({ id: "TG", accountId: "GHOST" })];
    const issues = runIntegrityCheck(ACCOUNTS, ledger, trades, PRESETS);
    const refs = ofType(issues, "missing_reference");
    expect(refs).toHaveLength(2);
    for (const r of refs) expect(r.severity).toBe("error");
    const byId = new Map(refs.map((r) => [(r.data as MissingReference).id, r.data as MissingReference]));
    expect(byId.get("GHOST")).toEqual({
      type: "account",
      id: "GHOST",
      usedIn: [
        { type: "ledger", id: "G1", field: "fromAccountId" },
        { type: "ledger", id: "G2", field: "toAccountId" },
        { type: "trade", id: "TG", field: "accountId" },
      ],
    });
    expect(byId.get("GHOST2")).toEqual({
      type: "account",
      id: "GHOST2",
      usedIn: [{ type: "ledger", id: "G3", field: "toAccountId" }],
    });
    // 이체 쌍 검사는 존재하지 않는 계좌를 건너뛰므로 mismatch 없음
    expect(ofType(issues, "transfer_pair_mismatch")).toEqual([]);
    expect(refs[0].message).toContain("계좌");
  });

  it("계좌 참조가 비어 있는(undefined/'') 항목은 누락으로 보지 않음", () => {
    const ledger = [entry({ id: "N1", kind: "expense", category: "지출", subCategory: "식비", fromAccountId: "" })];
    expect(ofType(runIntegrityCheck(ACCOUNTS, ledger, [], PRESETS), "missing_reference")).toEqual([]);
  });
});

describe("dataIntegrity — 이체 쌍", () => {
  it("from/to 한쪽이 없는 이체 → transfer_invalid_reference(warning) + hasFrom/hasTo", () => {
    const ledger = [
      entry({ id: "X1", kind: "transfer", category: "이체", subCategory: "저축이체", fromAccountId: "A1" }),
      entry({ id: "X2", kind: "transfer", category: "이체", subCategory: "저축이체", toAccountId: "A2" }),
      entry({ id: "X3", kind: "transfer", category: "이체", subCategory: "저축이체" }),
      // 지출/수입은 한쪽만 있어도 정상
      entry({ id: "X4", kind: "expense", category: "지출", subCategory: "식비", fromAccountId: "A1" }),
    ];
    const issues = runIntegrityCheck(ACCOUNTS, ledger, [], PRESETS);
    const refs = ofType(issues, "transfer_invalid_reference");
    expect(refs.map((r) => r.data)).toEqual([
      { entryId: "X1", hasFrom: true, hasTo: false },
      { entryId: "X2", hasFrom: false, hasTo: true },
      { entryId: "X3", hasFrom: false, hasTo: false },
    ]);
    for (const r of refs) expect(r.severity).toBe("warning");
    expect(ofType(issues, "transfer_pair_mismatch")).toEqual([]);
  });

  it("양쪽 계좌가 있는 내부 이체(KRW/USD 혼재, 카드결제이체 포함)는 합계 0 → mismatch 없음", () => {
    const ledger = [
      ...CLEAN_LEDGER,
      entry({ id: "P1", kind: "transfer", category: "이체", subCategory: "저축이체", fromAccountId: "A2", toAccountId: "A1", amount: 123_456 }),
      entry({ id: "P2", kind: "transfer", category: "이체", subCategory: "환전", fromAccountId: "S1", toAccountId: "A1", amount: 33.33, currency: "USD" }),
    ];
    const issues = runIntegrityCheck(ACCOUNTS, ledger, [], PRESETS);
    expect(ofType(issues, "transfer_pair_mismatch")).toEqual([]);
    expect(ofType(issues, "transfer_invalid_reference")).toEqual([]);
  });

  it("이체가 하나도 없으면 pair 검사 자체가 없음", () => {
    const issues = runIntegrityCheck(ACCOUNTS, [CLEAN_LEDGER[0], CLEAN_LEDGER[1]], [], PRESETS);
    expect(ofType(issues, "transfer_pair_mismatch")).toEqual([]);
  });

  // 관찰: validateTransferPairConsistency는 같은 항목의 amount를 from에서 빼고 to에 더하므로
  // 유한 금액이면 합계가 구조적으로 항상 0 — transfer_pair_mismatch는 현재 도달 불가 경로다.
  // (amount가 NaN이어도 Math.abs(NaN) >= 1 이 false라 보고되지 않는다.)
  it.todo("transfer_pair_mismatch — 도달 가능한 입력이 없음(구조적 항상 0). 검사 의도(쌍 누락 탐지)라면 별도 구현 필요");
});

describe("dataIntegrity — 날짜·금액", () => {
  it("미래 날짜(가계부·거래) → date_order warning, 오늘/과거는 정상", () => {
    const ledger = [...CLEAN_LEDGER, entry({ id: "F1", kind: "expense", category: "지출", subCategory: "식비", fromAccountId: "A1", date: "2999-12-31" })];
    const trades = [...CLEAN_TRADES, trade({ id: "FT", date: "2999-01-01" })];
    const issues = ofType(runIntegrityCheck(ACCOUNTS, ledger, trades, PRESETS), "date_order");
    expect(issues.map((i) => i.data)).toEqual([
      { entryId: "F1", date: "2999-12-31" },
      { tradeId: "FT", date: "2999-01-01" },
    ]);
    for (const i of issues) expect(i.severity).toBe("warning");
  });

  it("거래 총액: 매수 qty*price+fee / 매도 qty*price-fee 와 1원 이상 차이 → amount_consistency warning", () => {
    const trades = [
      trade({ id: "OK_BUY", quantity: 10, price: 1000, fee: 15, totalAmount: 10_015 }),
      trade({ id: "OK_SELL", side: "sell", quantity: 10, price: 1000, fee: 15, totalAmount: 9_985 }),
      trade({ id: "OK_TOL", quantity: 10, price: 1000, fee: 0, totalAmount: 10_000.5 }), // 1원 미만 허용
      trade({ id: "BAD_BUY", quantity: 10, price: 1000, fee: 15, totalAmount: 10_000 }),
      trade({ id: "BAD_SELL", side: "sell", quantity: 10, price: 1000, fee: 15, totalAmount: 10_015 }),
      trade({ id: "NO_FEE", quantity: 2, price: 100, fee: undefined as unknown as number, totalAmount: 200 }), // fee 누락 = 0
    ];
    const issues = ofType(runIntegrityCheck(ACCOUNTS, [], trades), "amount_consistency");
    expect(issues.map((i) => i.data)).toEqual([
      { tradeId: "BAD_BUY", expected: 10_015, actual: 10_000, difference: 15 },
      { tradeId: "BAD_SELL", expected: 9_985, actual: 10_015, difference: 30 },
    ]);
    for (const i of issues) expect(i.severity).toBe("warning");
  });
});

describe("dataIntegrity — 카테고리 일관성", () => {
  function catIssues(ledger: LedgerEntry[], presets: CategoryPresets = PRESETS) {
    return ofType(runIntegrityCheck(ACCOUNTS, ledger, [], presets), "category_mismatch");
  }

  it("프리셋을 넘기지 않으면 카테고리 검사 생략", () => {
    const ledger = [entry({ id: "U1", kind: "expense", category: "지출", subCategory: "없는대분류", fromAccountId: "A1" })];
    expect(ofType(runIntegrityCheck(ACCOUNTS, ledger, []), "category_mismatch")).toEqual([]);
    expect(catIssues(ledger)).toHaveLength(1);
  });

  it("수입: 래퍼(수입)+sub, 레거시 cat 직접 모두 인정 / 프리셋에 없으면 warning", () => {
    const ledger = [
      entry({ id: "I1", kind: "income", category: "수입", subCategory: "급여", toAccountId: "A1" }),
      entry({ id: "I2", kind: "income", category: "급여", toAccountId: "A1" }),
      entry({ id: "I3", kind: "income", category: "수입", subCategory: "복권", toAccountId: "A1" }),
      entry({ id: "I4", kind: "income", category: "", toAccountId: "A1" }),
    ];
    const issues = catIssues(ledger);
    expect(issues.map((i) => (i.data as CategoryMismatch).entryId)).toEqual(["I3", "I4"]);
    expect(issues[0].message).toContain('"복권"');
    expect(issues[1].message).toContain("(빈값)");
    expect((issues[0].data as CategoryMismatch).expectedMain).toEqual(PRESETS.income);
  });

  it("이체: 래퍼(이체)+sub / cat 직접 인정, 없으면 warning", () => {
    const ledger = [
      entry({ id: "T1", kind: "transfer", category: "이체", subCategory: "저축이체", fromAccountId: "A1", toAccountId: "A2" }),
      entry({ id: "T2", kind: "transfer", category: "환전", fromAccountId: "A1", toAccountId: "S1" }),
      entry({ id: "T3", kind: "transfer", category: "이체", subCategory: "증여", fromAccountId: "A1", toAccountId: "A2" }),
    ];
    const issues = catIssues(ledger);
    expect(issues.map((i) => (i.data as CategoryMismatch).entryId)).toEqual(["T3"]);
    expect((issues[0].data as CategoryMismatch).kind).toBe("transfer");
  });

  it("지출: 래퍼(지출)+sub+det 와 레거시(cat=대분류, sub=소분류) 동일 취급", () => {
    const ledger = [
      entry({ id: "E1", kind: "expense", category: "지출", subCategory: "식비", detailCategory: "카페", fromAccountId: "A1" }),
      entry({ id: "E2", kind: "expense", category: "식비", subCategory: "카페", fromAccountId: "A1" }),
      // 대분류 미등록
      entry({ id: "E3", kind: "expense", category: "지출", subCategory: "의료비", detailCategory: "약국", fromAccountId: "A1" }),
      entry({ id: "E4", kind: "expense", category: "의료비", subCategory: "약국", fromAccountId: "A1" }),
      // 대분류 등록·소분류 미등록 (expenseDetails 그룹 존재)
      entry({ id: "E5", kind: "expense", category: "지출", subCategory: "식비", detailCategory: "배달", fromAccountId: "A1" }),
      // 대분류 등록·expenseDetails 그룹 없음 → 소분류는 검사 안 함
      entry({ id: "E6", kind: "expense", category: "지출", subCategory: "유류교통비", detailCategory: "아무거나", fromAccountId: "A1" }),
    ];
    const issues = catIssues(ledger);
    expect(issues.map((i) => (i.data as CategoryMismatch).entryId)).toEqual(["E3", "E4", "E5"]);
    expect(issues[0].message).toContain('대분류 "의료비"');
    expect(issues[2].message).toContain('"식비 > 배달"');
    expect((issues[2].data as CategoryMismatch).expectedSubs).toEqual(["시장/마트", "카페"]);
  });

  it("시스템/저축성/미분류/대분류=소분류/공백차이는 경고하지 않음", () => {
    const ledger = [
      // 신용결제 — cat 세대·sub 세대 모두 스킵
      entry({ id: "S1", kind: "expense", category: "신용결제", subCategory: "카드대금", fromAccountId: "A1" }),
      entry({ id: "S2", kind: "expense", category: "지출", subCategory: "신용결제", fromAccountId: "A1" }),
      // 저축성지출 (categoryTypes 미설정 시 기본 "저축성지출")
      entry({ id: "S3", kind: "expense", category: "지출", subCategory: "저축성지출", detailCategory: "아무거나", fromAccountId: "A1" }),
      // 미분류 소분류
      entry({ id: "S4", kind: "expense", category: "지출", subCategory: "식비", detailCategory: "(미분류)", fromAccountId: "A1" }),
      entry({ id: "S5", kind: "expense", category: "지출", subCategory: "식비", detailCategory: "-", fromAccountId: "A1" }),
      // 대분류==소분류
      entry({ id: "S6", kind: "expense", category: "지출", subCategory: "식비", detailCategory: "식 비", fromAccountId: "A1" }),
      // 공백 차이 정규화
      entry({ id: "S7", kind: "expense", category: "지출", subCategory: "식 비", detailCategory: "시장 / 마트", fromAccountId: "A1" }),
      // 대분류 빈값 → 검사 대상 아님
      entry({ id: "S8", kind: "expense", category: "지출", fromAccountId: "A1" }),
      entry({ id: "S9", kind: "expense", category: "", fromAccountId: "A1" }),
    ];
    expect(catIssues(ledger)).toEqual([]);
  });

  it("categoryTypes.savings 지정 시 그 이름이 저축성 대분류로 인정", () => {
    const presets: CategoryPresets = { ...PRESETS, categoryTypes: { savings: ["적립식"] } as CategoryPresets["categoryTypes"] };
    const ledger = [
      entry({ id: "V1", kind: "expense", category: "지출", subCategory: "적립식", fromAccountId: "A1" }),
      entry({ id: "V2", kind: "expense", category: "지출", subCategory: "저축성지출", fromAccountId: "A1" }), // 더 이상 기본값 아님
    ];
    const issues = catIssues(ledger, presets);
    expect(issues.map((i) => (i.data as CategoryMismatch).entryId)).toEqual(["V2"]);
  });
});

describe("dataIntegrity — USD 증권 계좌", () => {
  const SEC: Account = account({ id: "S1", type: "securities", name: "증권" });

  it("USD 장부 없음(usdBalance·USD 이체 0) + 모든 USD 거래 cashImpact≠0 → 검사 생략", () => {
    const trades = [trade({ id: "U1", accountId: "S1", ticker: "AAPL", quantity: 10, price: 100 })];
    expect(ofType(runIntegrityCheck([SEC], [], trades), "usd_securities_mismatch")).toEqual([]);
  });

  it("비증권(checking) 계좌·KRW 티커만 있는 계좌는 검사 대상 아님", () => {
    const trades = [
      trade({ id: "K1", accountId: "S1", ticker: "005930" }),
      trade({ id: "K2", accountId: "A1", ticker: "AAPL", cashImpact: 0 }),
    ];
    const accounts = [SEC, account({ id: "A1", type: "checking", usdBalance: 999 })];
    expect(ofType(runIntegrityCheck(accounts, [], trades), "usd_securities_mismatch")).toEqual([]);
  });

  it("cashImpact=0인 USD 거래가 있고 거래 순합과 usdBalance+usdTransferNet이 1 이상 다르면 warning", () => {
    const trades = [trade({ id: "Z1", accountId: "S1", ticker: "AAPL", quantity: 1, price: 100, cashImpact: 0 })];
    const issues = ofType(runIntegrityCheck([SEC], [], trades), "usd_securities_mismatch");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].data).toEqual({ accountId: "S1", tradeUsdNet: -100, reportedUsd: 0 });
  });

  it("usdBalance가 거래 순합(매도−매수)과 일치하면 이슈 없음", () => {
    const trades = [
      trade({ id: "B1", accountId: "S1", ticker: "AAPL", quantity: 1, price: 100 }),
      trade({ id: "S1t", accountId: "S1", ticker: "AAPL", side: "sell", quantity: 1, price: 150 }),
    ];
    const matched = { ...SEC, usdBalance: 50 };
    expect(ofType(runIntegrityCheck([matched], [], trades), "usd_securities_mismatch")).toEqual([]);
    const off = { ...SEC, usdBalance: 52 };
    expect(ofType(runIntegrityCheck([off], [], trades), "usd_securities_mismatch")).toHaveLength(1);
  });

  it("USD 이체 입금(usdTransferNet)은 reportedUsd에 합산된다", () => {
    const ledger = [entry({ id: "FX", kind: "transfer", category: "이체", subCategory: "환전", fromAccountId: "A1", toAccountId: "S1", amount: 1000, currency: "USD" })];
    const trades = [trade({ id: "B1", accountId: "S1", ticker: "AAPL", quantity: 1, price: 100 })];
    const accounts = [account({ id: "A1", type: "checking" }), SEC];
    const issues = ofType(runIntegrityCheck(accounts, ledger, trades), "usd_securities_mismatch");
    expect(issues).toHaveLength(1);
    expect(issues[0].data).toEqual({ accountId: "S1", tradeUsdNet: -100, reportedUsd: 1000 });
  });

  // 관찰: reportedUsd(=usdBalance+usdTransferNet, 계좌의 USD '현금')와 tradeUsdNet(=매도−매수)을 직접 비교한다.
  // USD 1,000 입금 후 USD 1,000 매수(현금 0, 정합) 같은 정상 시나리오도 diff=2,000 으로 경고된다.
  // 의도가 "USD 현금 = 입금 + 매도 − 매수" 검증이라면 비교식이 reportedUsd − tradeUsdNet ≠ usdTransferNet 꼴이어야 한다.
  it.todo("usd_securities_mismatch — USD 입금 1,000 + 매수 1,000(정합)인데 경고되는 비교식 확인 필요");
});

function loan(partial: Partial<Loan> & Pick<Loan, "id">): Loan {
  return {
    institution: "테스트은행",
    loanName: "테스트대출",
    loanAmount: 10_000_000,
    annualInterestRate: 3,
    repaymentMethod: "equal_payment",
    loanDate: "2025-01-01",
    maturityDate: "2030-01-01",
    ...partial,
  };
}

describe("dataIntegrity — 대출 참조(loanId, 1-10)", () => {
  const LOANS: Loan[] = [loan({ id: "LOAN1" })];

  it("존재하는 대출을 참조하면 이슈 없음", () => {
    const ledger = [entry({ id: "L1", kind: "expense", loanId: "LOAN1" })];
    expect(ofType(runIntegrityCheck(ACCOUNTS, ledger, [], PRESETS, LOANS), "missing_reference")).toEqual([]);
  });

  it("loanId가 없으면(레거시 description 폴백) 이슈 없음", () => {
    const ledger = [entry({ id: "L1", kind: "expense" })];
    expect(ofType(runIntegrityCheck(ACCOUNTS, ledger, [], PRESETS, LOANS), "missing_reference")).toEqual([]);
  });

  it("존재하지 않는 대출을 참조하면 error 1건(type=loan)", () => {
    const ledger = [entry({ id: "L1", kind: "expense", loanId: "GHOST" })];
    const issues = ofType(runIntegrityCheck(ACCOUNTS, ledger, [], PRESETS, LOANS), "missing_reference");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect((issues[0].data as MissingReference).type).toBe("loan");
    expect((issues[0].data as MissingReference).id).toBe("GHOST");
  });

  it("loans를 넘기지 않으면(하위 호환) 대출 참조 검사를 건너뛴다", () => {
    const ledger = [entry({ id: "L1", kind: "expense", loanId: "GHOST" })];
    expect(ofType(runIntegrityCheck(ACCOUNTS, ledger, [], PRESETS), "missing_reference")).toEqual([]);
  });
});

describe("dataIntegrity — 정산 참조(settledLedgerIds, 1-10)", () => {
  it("정산 항목이 존재하는 가계부 항목들을 참조하면 이슈 없음", () => {
    const expense = entry({ id: "EXP1", kind: "expense" });
    const settlement = entry({ id: "S1", kind: "income", settledLedgerIds: ["EXP1"] });
    expect(ofType(runIntegrityCheck(ACCOUNTS, [expense, settlement], []), "missing_reference")).toEqual([]);
  });

  it("정산 항목이 존재하지 않는 가계부 항목을 참조하면 warning 1건(type=ledger)", () => {
    const settlement = entry({ id: "S1", kind: "income", settledLedgerIds: ["GHOST"] });
    const issues = ofType(runIntegrityCheck(ACCOUNTS, [settlement], []), "missing_reference");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
    expect((issues[0].data as MissingReference).type).toBe("ledger");
    expect((issues[0].data as MissingReference).id).toBe("GHOST");
  });
});

describe("dataIntegrity — 매입 환율 유효성(fxRateAtTrade, 1-10)", () => {
  it("USD 종목 거래에 fxRateAtTrade가 없으면(레거시) 이슈 없음", () => {
    const trades = [trade({ id: "T1", accountId: "S1", ticker: "AAPL" })];
    expect(ofType(runIntegrityCheck(ACCOUNTS, [], trades), "amount_consistency")).toEqual([]);
  });

  it("USD 종목 거래에 fxRateAtTrade > 0 이면 이슈 없음", () => {
    const trades = [trade({ id: "T1", accountId: "S1", ticker: "AAPL", fxRateAtTrade: 1350 })];
    expect(ofType(runIntegrityCheck(ACCOUNTS, [], trades), "amount_consistency")).toEqual([]);
  });

  it("USD 종목 거래의 fxRateAtTrade가 0 이하면 warning", () => {
    const trades = [trade({ id: "T1", accountId: "S1", ticker: "AAPL", fxRateAtTrade: 0 })];
    const issues = ofType(runIntegrityCheck(ACCOUNTS, [], trades), "amount_consistency");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].data).toEqual({ tradeId: "T1", fxRateAtTrade: 0 });
  });

  it("KRW 종목(005930)의 fxRateAtTrade는 값이 이상해도 검사하지 않는다", () => {
    const trades = [trade({ id: "T1", accountId: "S1", ticker: "005930", fxRateAtTrade: -1 })];
    expect(ofType(runIntegrityCheck(ACCOUNTS, [], trades), "amount_consistency")).toEqual([]);
  });
});

describe("dataIntegrity — runStructuralChecks (1-10, 잔액 계산 없음)", () => {
  it("runIntegrityCheck와 동일 입력이면 usd_securities_mismatch만 빠진 부분집합을 낸다", () => {
    const structural = runStructuralChecks({ accounts: ACCOUNTS, ledger: CLEAN_LEDGER, trades: CLEAN_TRADES, categoryPresets: PRESETS });
    expect(structural).toEqual([]);
    const full = runIntegrityCheck(ACCOUNTS, CLEAN_LEDGER, CLEAN_TRADES, PRESETS);
    expect(full).toEqual([]);
  });

  it("USD 증권 잔액 불일치는 runStructuralChecks에는 없고 runIntegrityCheck에만 있다", () => {
    const SEC = account({ id: "S1", type: "securities", usdBalance: 999 });
    const trades = [trade({ id: "Z1", accountId: "S1", ticker: "AAPL", quantity: 1, price: 100, cashImpact: 0 })];
    expect(ofType(runStructuralChecks({ accounts: [SEC], ledger: [], trades }), "usd_securities_mismatch")).toEqual([]);
    expect(ofType(runIntegrityCheck([SEC], [], trades), "usd_securities_mismatch")).toHaveLength(1);
  });
});
