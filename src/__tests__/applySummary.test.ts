import { describe, it, expect } from "vitest";
import { buildApplySummary, countNewIntegrityErrors } from "../utils/applySummary";
import { getEmptyData } from "../services/dataService";
import type { AppData, LedgerEntry } from "../types";

/**
 * applySummary(ApplyConfirmModal 게이트의 순수 계산) 행동 테스트.
 *  - 차이 없음 → hasChanges=false (모달 생략 신호)
 *  - 컬렉션 건수 변화 → diff.collections에 반영, hasChanges=true
 *  - 최신 가계부 날짜 변화 감지
 *  - 새로 생기는 무결성 오류만 카운트(기존에 있던 오류는 상쇄)
 */

function entry(partial: Partial<LedgerEntry> & Pick<LedgerEntry, "id" | "kind">): LedgerEntry {
  return { date: "2026-01-10", description: "", amount: 10_000, category: "", ...partial };
}

describe("applySummary — buildApplySummary", () => {
  it("완전히 동일한 데이터는 차이 없음(hasChanges=false)", () => {
    const data = getEmptyData();
    const summary = buildApplySummary(data, { ...data });
    expect(summary.hasChanges).toBe(false);
    expect(summary.newIntegrityErrorCount).toBe(0);
  });

  it("가계부 항목 추가는 collections.ledger.added로 반영되고 hasChanges=true", () => {
    const before = getEmptyData();
    const after: AppData = { ...before, ledger: [entry({ id: "L1", kind: "expense" })] };
    const summary = buildApplySummary(before, after);
    expect(summary.hasChanges).toBe(true);
    expect(summary.diff.collections.ledger.added).toBe(1);
    expect(summary.diff.collections.ledger.removed).toBe(0);
  });

  it("최신 가계부 날짜가 바뀌면 감지된다", () => {
    const before: AppData = { ...getEmptyData(), ledger: [entry({ id: "L1", kind: "expense", date: "2026-01-01" })] };
    const after: AppData = { ...before, ledger: [entry({ id: "L1", kind: "expense", date: "2026-02-15" })] };
    const summary = buildApplySummary(before, after);
    expect(summary.latestLedgerDateBefore).toBe("2026-01-01");
    expect(summary.latestLedgerDateAfter).toBe("2026-02-15");
    expect(summary.hasChanges).toBe(true);
  });

  it("계좌가 사라지는 변경은 실제 diff로 잡힌다(계좌 위축은 조용히 넘기면 안 됨)", () => {
    const before: AppData = {
      ...getEmptyData(),
      accounts: [{ id: "A1", name: "입출금", institution: "테스트", type: "checking", initialBalance: 0 }]
    };
    const after: AppData = { ...before, accounts: [] };
    const summary = buildApplySummary(before, after);
    expect(summary.diff.collections.accounts.removed).toBe(1);
    expect(summary.hasChanges).toBe(true);
  });
});

describe("applySummary — countNewIntegrityErrors", () => {
  it("이미 있던 오류(존재하지 않는 계좌 참조)는 상쇄되어 새 오류로 세지 않는다", () => {
    const brokenLedger: LedgerEntry[] = [entry({ id: "L1", kind: "expense", fromAccountId: "GHOST" })];
    const before: AppData = { ...getEmptyData(), ledger: brokenLedger };
    const after: AppData = { ...getEmptyData(), ledger: brokenLedger };
    expect(countNewIntegrityErrors(before, after)).toBe(0);
  });

  it("적용 후에만 생기는 존재하지 않는 계좌 참조는 새 오류로 센다", () => {
    const before: AppData = { ...getEmptyData(), ledger: [] };
    const after: AppData = {
      ...getEmptyData(),
      ledger: [entry({ id: "L1", kind: "expense", fromAccountId: "GHOST" })]
    };
    expect(countNewIntegrityErrors(before, after)).toBe(1);
    const summary = buildApplySummary(before, after);
    expect(summary.newIntegrityErrorCount).toBe(1);
    expect(summary.hasChanges).toBe(true);
  });

  it("오류가 오히려 줄어드는 경우(정리) 새 오류는 0 — 음수로 상쇄하지 않는다", () => {
    const before: AppData = {
      ...getEmptyData(),
      ledger: [
        entry({ id: "L1", kind: "expense", fromAccountId: "GHOST1" }),
        entry({ id: "L2", kind: "expense", fromAccountId: "GHOST2" })
      ]
    };
    const after: AppData = { ...getEmptyData(), ledger: [] };
    expect(countNewIntegrityErrors(before, after)).toBe(0);
  });
});
