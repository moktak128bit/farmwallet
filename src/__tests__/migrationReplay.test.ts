/**
 * 1-3 리플레이 하네스 — 마스킹 실데이터 형태 픽스처(fixtures/maskedLegacyData.ts)를 schemaVersion 9·10·11로
 * normalizeImportedData에 넣어 (1) 건수·id 집합·금액 합계 보존, (2) 각 버전 블록이 예고한 변경만 일어남,
 * (3) 두 번 적용해도 동일(멱등, v3 할인차감 구간 제외)을 단언한다.
 * 새 마이그레이션 단계(v13 등)를 추가할 때 이 파일에 버전을 늘리고 기대 변경을 적는다 — migrateBySchema 자체는 수정 금지.
 */
import { describe, it, expect } from "vitest";
import { normalizeImportedData } from "../services/dataService";
import { diffAppData, DIFF_COLLECTIONS } from "../services/migrationReport";
import { buildMaskedLegacyData, summarizeMaskedLegacyData } from "./fixtures/maskedLegacyData";
import type { AppData, LedgerEntry } from "../types";

type RawLedger = Array<Record<string, unknown>>;

function sumByKind(ledger: ReadonlyArray<{ kind: string; amount: number }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of ledger) out[l.kind] = (out[l.kind] ?? 0) + l.amount;
  return out;
}

function sumAll(ledger: ReadonlyArray<{ amount: number }>): number {
  return ledger.reduce((s, l) => s + l.amount, 0);
}

function ids(arr: ReadonlyArray<{ id: string }>): string[] {
  return arr.map((x) => x.id).sort();
}

function replay(schemaVersion: number): { input: Record<string, unknown>; output: AppData } {
  const input = buildMaskedLegacyData();
  const output = normalizeImportedData({ ...input, schemaVersion });
  return { input, output };
}

const REPLAY_VERSIONS = [9, 10, 11] as const;

describe.each(REPLAY_VERSIONS)("마스킹 실데이터 리플레이 — schemaVersion %i → 현행", (from) => {
  const { input, output } = replay(from);
  const rawLedger = input.ledger as RawLedger;
  const rawTrades = input.trades as RawLedger;
  const summary = summarizeMaskedLegacyData();

  it("가계부: 건수·id 집합 보존 (sanitize 폐기 0건)", () => {
    expect(output.ledger).toHaveLength(rawLedger.length);
    expect(ids(output.ledger)).toEqual(ids(rawLedger as unknown as LedgerEntry[]));
  });

  it("가계부: 금액 총합 보존, kind별 합계는 예고된 재분류(v11: 재테크 expense 저축/투자 → transfer)만큼만 이동", () => {
    const before = sumByKind(rawLedger as unknown as LedgerEntry[]);
    const after = sumByKind(output.ledger);
    expect(sumAll(output.ledger)).toBeCloseTo(sumAll(rawLedger as unknown as LedgerEntry[]), 6);
    expect(after.income).toBeCloseTo(before.income, 6);
    // from<11 이면 v11 블록이 레거시 재테크 expense(저축/투자)를 transfer로 옮긴다 — 그 금액만큼 expense↓ transfer↑
    const moved = from < 11 ? summary.legacyRecheckExpenseAmount : 0;
    expect(summary.legacyRecheckExpenseAmount).toBeGreaterThan(0);
    expect(after.expense).toBeCloseTo(before.expense - moved, 6);
    expect(after.transfer).toBeCloseTo(before.transfer + moved, 6);
  });

  it("보존 필드: discountAmount·settledLedgerIds·loanId·currency·환전 쌍·fxRateAtTrade가 그대로", () => {
    const byId = new Map(output.ledger.map((l) => [l.id, l]));
    expect(byId.get("L-3g-0001")).toMatchObject({ amount: 23_900, discountAmount: 11_100, detailCategory: "대중교통" });
    expect(byId.get("settle-0001")).toMatchObject({ kind: "income", category: "정산", settledLedgerIds: ["L-3g-0009", "L-3g-0010"], toAccountId: "ACC-DATE" });
    expect(byId.get("L-3g-0104")).toMatchObject({ kind: "income", category: "수입", subCategory: "정산", settledLedgerIds: ["L1690000000002"] });
    expect(byId.get("L-3g-0005")).toMatchObject({ loanId: "LOAN-0001", subCategory: "대출상환", detailCategory: "이자상환" });
    expect(byId.get("L1700000000002")).toMatchObject({ category: "지출", subCategory: "이자상환" });
    expect(byId.get("fx-1773362903191-from")).toMatchObject({ kind: "transfer", subCategory: "환전이체", currency: "KRW", amount: 1_450_000, fromAccountId: "ACC-CMA" });
    expect(byId.get("fx-1773362903191-to")).toMatchObject({ kind: "transfer", subCategory: "환전이체", currency: "USD", amount: 1_000, toAccountId: "ACC-US" });
    expect(byId.get("L1770039576998")).toMatchObject({ currency: "USD", amount: 100 });
    expect(byId.get("D-3g-0103")).toMatchObject({ currency: "USD", amount: 12.34, subCategory: "배당" });
    // v8 이후 버전에서는 레거시 신용결제 expense·저축성지출·평면 지출·현행 투자손실은 건드리지 않는다
    expect(byId.get("L1690000000003")).toMatchObject({ kind: "expense", category: "신용결제" });
    expect(byId.get("L1690000000006")).toMatchObject({ kind: "expense", category: "저축성지출" });
    expect(byId.get("L1690000000001")).toMatchObject({ kind: "expense", category: "식비", subCategory: "외식/배달" });
    expect(byId.get("L-3g-0008")).toMatchObject({ kind: "expense", category: "재테크", subCategory: "투자손실" });

    const tradeById = new Map(output.trades.map((t) => [t.id, t]));
    expect(tradeById.get("T-0004")).toMatchObject({ fxRateAtTrade: 1_452.3, totalAmount: 275.25 });
    expect(tradeById.get("T-0005")).toMatchObject({ fxRateAtTrade: 1_380.0, side: "sell" });
  });

  it("v10 블록: income 데이트비 → 데이트통장 (from<10 에서만), expense 데이트비는 불변", () => {
    const dateIncome = output.ledger.filter((l) => l.kind === "income" && l.category === "데이트비");
    const dateAccountIncome = output.ledger.filter((l) => l.kind === "income" && l.category === "데이트통장");
    expect(summary.legacyDateIncomeCount).toBe(2);
    if (from < 10) {
      expect(dateIncome).toHaveLength(0);
      expect(dateAccountIncome).toHaveLength(summary.legacyDateIncomeCount);
      // subCategory는 유지
      expect(dateAccountIncome.find((l) => l.id === "L1690000000103")?.subCategory).toBe("데이트통장");
      expect(output.categoryPresets.income).toContain("데이트통장");
    } else {
      expect(dateIncome).toHaveLength(summary.legacyDateIncomeCount);
      expect(dateAccountIncome).toHaveLength(0);
    }
    expect(output.ledger.find((l) => l.id === "L1690000000002")).toMatchObject({ kind: "expense", category: "데이트비" });
  });

  it("v11 블록: 재테크 expense 저축/투자·v7 임시 transfer 저축/투자 → 이체/저축이체·투자이체 (from<11), 이후 잔존 0", () => {
    const byId = new Map(output.ledger.map((l) => [l.id, l]));
    if (from < 11) {
      expect(byId.get("L1690000000004")).toMatchObject({ kind: "transfer", category: "이체", subCategory: "저축이체", amount: 100_000, toAccountId: "ACC-SAV" });
      expect(byId.get("L1690000000005")).toMatchObject({ kind: "transfer", category: "이체", subCategory: "투자이체", amount: 300_000 });
      expect(byId.get("L1766467634214-85-b4zpcrt7p")).toMatchObject({ kind: "transfer", subCategory: "투자이체" });
      expect(byId.get("L1766467634214-86-2vfn2askv")).toMatchObject({ kind: "transfer", subCategory: "저축이체" });
      expect(output.ledger.some((l) => l.kind === "transfer" && (l.subCategory === "저축" || l.subCategory === "투자"))).toBe(false);
      expect(output.ledger.some((l) => l.kind === "expense" && l.category === "재테크" && (l.subCategory === "저축" || l.subCategory === "투자"))).toBe(false);
    } else {
      // from=11: v11 블록 미적용 — 원형 그대로 (현행 앱은 이 형태를 isWealthBuildingEntry 등으로 해석)
      expect(byId.get("L1690000000004")).toMatchObject({ kind: "expense", category: "재테크", subCategory: "저축" });
      expect(byId.get("L1766467634214-85-b4zpcrt7p")).toMatchObject({ kind: "transfer", subCategory: "투자" });
    }
  });

  it("v9/v12 블록: 프리셋 보정 — transfer 투자이체 보장, 신용카드 main 제거, 재테크 subs 확장(사용자 sub 보존 규칙)", () => {
    const cp = output.categoryPresets;
    expect(cp.transfer).toContain("투자이체");
    expect(cp.transfer.indexOf("투자이체")).toBe(cp.transfer.indexOf("저축이체") + 1);
    const recheck = cp.expenseDetails?.find((g) => g.main === "재테크");
    expect(recheck).toBeDefined();
    // from<9는 v9 블록이, from≥9는 mergeCategoryPresets의 버전 무관 방어선이 같은 결과로 수렴:
    // 구형 subs(저축/투자/투자수익)는 이체/수입으로 이관돼 제거, 신용카드 main 제거, v12 기본 subs 보충.
    expect(recheck!.subs).toEqual(["투자손실", "수수료", "세금", "환차손", "기타"]);
    expect(cp.expenseDetails?.some((g) => g.main === "신용카드")).toBe(false);
    // 사용자 정의 main/subs는 그대로
    expect(cp.expenseDetails?.find((g) => g.main === "수수료")?.subs).toEqual(["환전수수료"]);
    expect(cp.expenseDetails?.find((g) => g.main === "식비")?.subs).toContain("시장/마트");
  });

  it("거래: 건수·id·totalAmount 합계 보존", () => {
    expect(output.trades).toHaveLength(rawTrades.length);
    expect(ids(output.trades)).toEqual(ids(rawTrades as unknown as AppData["trades"]));
    const before = rawTrades.reduce((s, t) => s + Number(t.totalAmount), 0);
    expect(output.trades.reduce((s, t) => s + t.totalAmount, 0)).toBeCloseTo(before, 6);
  });

  it("계좌·대출·반복·예산·기타 컬렉션: 건수 보존, diffAppData 기준 가계부 외 added/removed/changed 0", () => {
    expect(output.accounts).toHaveLength((input.accounts as unknown[]).length);
    expect(output.loans).toEqual(input.loans);
    expect(output.recurringExpenses).toEqual(input.recurringExpenses);
    expect(output.budgetGoals).toEqual(input.budgetGoals);
    expect(output.targetPortfolios).toEqual(input.targetPortfolios);
    expect(output.workoutWeeks).toEqual(input.workoutWeeks);
    expect(output.workoutRoutines).toEqual(input.workoutRoutines);
    expect(output.customExercises).toEqual(input.customExercises);
    expect(output.isaPortfolio).toEqual(input.isaPortfolio);
    expect(output.investmentGoals).toEqual(input.investmentGoals);
    expect(output.assetSnapshots).toHaveLength(2);

    const diff = diffAppData(input, output);
    for (const name of DIFF_COLLECTIONS) {
      if (name === "ledger") continue;
      expect(diff.collections[name], name).toMatchObject({ added: 0, removed: 0, changed: 0 });
    }
    expect(diff.collections.ledger).toMatchObject({ added: 0, removed: 0 });
    // 예고된 변경 건수: v10(데이트비 income 2) + v11(재테크 2 + v7 임시 2)
    const expectedChanged = (from < 10 ? 2 : 0) + (from < 11 ? 4 : 0);
    expect(diff.collections.ledger.changed).toBe(expectedChanged);
    expect(diff.ledgerAmountTotal.before).toBeCloseTo(diff.ledgerAmountTotal.after, 6);
    expect(diff.tradesTotalAmount.before).toBeCloseTo(diff.tradesTotalAmount.after, 6);
    expect(diff.hasChanges).toBe(expectedChanged > 0);
  });

  it("멱등: 결과를 같은 schemaVersion으로 다시 넣어도 동일", () => {
    const again = normalizeImportedData({ ...output, schemaVersion: from });
    expect(again).toEqual(output);
    // 현행 버전 표기로 재적용(일반 백업 왕복)도 동일
    const asCurrent = normalizeImportedData({ ...output });
    expect(asCurrent).toEqual(output);
  });
});

describe("리플레이 하네스 경계", () => {
  it("schemaVersion 없이 넣으면 현행 취급 — 레거시 항목 형태를 건드리지 않는다(보수적)", () => {
    const input = buildMaskedLegacyData();
    const output = normalizeImportedData(input);
    const byId = new Map(output.ledger.map((l) => [l.id, l]));
    expect(byId.get("L1690000000004")).toMatchObject({ kind: "expense", category: "재테크", subCategory: "저축" });
    expect(byId.get("L1690000000102")).toMatchObject({ kind: "income", category: "데이트비" });
    expect(output.ledger).toHaveLength((input.ledger as unknown[]).length);
  });

  it("v3 구간(할인 차감)은 비멱등 — 두 번 적용하면 할인이 두 번 빠진다 (그래서 멱등 단언에서 제외·마커 되감기 가드가 필요)", () => {
    const once = normalizeImportedData({ ...buildMaskedLegacyData(), schemaVersion: 2 });
    const twice = normalizeImportedData({ ...once, schemaVersion: 2 });
    const a1 = once.ledger.find((l) => l.id === "L-3g-0001")!.amount;
    const a2 = twice.ledger.find((l) => l.id === "L-3g-0001")!.amount;
    expect(a1).toBe(23_900 - 11_100);
    expect(a2).toBe(a1 - 11_100);
    // 건수·id는 그래도 보존
    expect(twice.ledger).toHaveLength(once.ledger.length);
  });
});
