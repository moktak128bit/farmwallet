import { describe, expect, it } from "vitest";
import { applyLedgerDelta, formatDeltaReport, isLedgerDelta, type LedgerDelta } from "../utils/ledgerDelta";
import type { Account, AppData, LedgerEntry, StockTrade } from "../types";

const entry = (o: Partial<LedgerEntry> & { id: string }): LedgerEntry =>
  ({ date: "2026-11-05", kind: "expense", category: "지출", description: "", amount: 1000, ...o }) as LedgerEntry;
const trade = (id: string): StockTrade =>
  ({ id, date: "2026-11-05", accountId: "a", ticker: "458730", name: "T", side: "buy", quantity: 1, price: 1, fee: 0, totalAmount: 1, cashImpact: -1 }) as StockTrade;
const data = (ledger: LedgerEntry[], trades: StockTrade[] = [], accounts: Account[] = []): AppData =>
  ({ ledger, trades, accounts }) as unknown as AppData;
const delta = (o: Omit<LedgerDelta, "format">): LedgerDelta => ({ format: "farmwallet-delta-v1", ...o });

describe("ledgerDelta — Claude 변경분 적용", () => {
  it("형식 판별: format 필드가 정확히 farmwallet-delta-v1일 때만", () => {
    expect(isLedgerDelta({ format: "farmwallet-delta-v1" })).toBe(true);
    expect(isLedgerDelta({ format: "farmwallet-table-backup-v1" })).toBe(false);
    expect(isLedgerDelta(null)).toBe(false);
    expect(isLedgerDelta({ ledger: [] })).toBe(false);
  });

  it("추가: 같은 파일을 두 번 적용해도 한 번만 들어간다 (id 또는 날짜·종류·금액·통화·계좌가 같으면 건너뜀)", () => {
    const d = delta({ ledger: { add: [entry({ id: "n1", amount: 8500, fromAccountId: "card" })] } });
    const once = applyLedgerDelta(data([entry({ id: "old" })]), d);
    expect(once.report.added).toBe(1);
    const twice = applyLedgerDelta(once.next, d);
    expect(twice.report.added).toBe(0);
    expect(twice.report.skippedDuplicates).toHaveLength(1);
    expect(twice.next.ledger).toHaveLength(2);

    // id만 다르고 같은 거래(같은 날·금액·계좌) — 스크린샷 재입력 방지
    const sameTxn = applyLedgerDelta(once.next, delta({ ledger: { add: [entry({ id: "n2", amount: 8500, fromAccountId: "card" })] } }));
    expect(sameTxn.report.added).toBe(0);
    // 같은 날·같은 금액이라도 계좌가 다르면 다른 거래
    const otherAcct = applyLedgerDelta(once.next, delta({ ledger: { add: [entry({ id: "n3", amount: 8500, fromAccountId: "nh" })] } }));
    expect(otherAcct.report.added).toBe(1);
  });

  it("수정·삭제는 id로, 없는 id는 missing으로 보고하고 원본 배열은 바꾸지 않는다", () => {
    const base = data([entry({ id: "a", amount: 100 }), entry({ id: "b", amount: 200 })]);
    const { next, report } = applyLedgerDelta(
      base,
      delta({ ledger: { update: [{ id: "a", amount: 150, description: "수정" }, { id: "zz", amount: 1 }], remove: ["b", "yy"] } })
    );
    expect(report).toMatchObject({ updated: 1, removed: 1, missing: ["zz", "yy"] });
    expect(next.ledger).toEqual([expect.objectContaining({ id: "a", amount: 150, description: "수정" })]);
    expect(base.ledger).toHaveLength(2);
    expect(base.ledger[0].amount).toBe(100);
  });

  it("주식 거래 추가(같은 id 무시)·삭제, 계좌 패치(없는 계좌는 missing)", () => {
    const base = data([], [trade("t1")], [{ id: "acc", name: "A", type: "checking" } as Account]);
    const { next, report } = applyLedgerDelta(
      base,
      delta({ trades: { add: [trade("t1"), trade("t2")], remove: ["t1"] }, accounts: { patch: [{ id: "acc", cashAdjustment: 5 }, { id: "nope", cashAdjustment: 1 }] } })
    );
    // 삭제가 추가보다 먼저 — t1을 지운 뒤 t1·t2를 추가
    expect(next.trades.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(next.accounts[0]).toMatchObject({ id: "acc", cashAdjustment: 5 });
    expect(report.missing).toEqual(["nope"]);
  });

  it("결과 문구", () => {
    expect(formatDeltaReport({ added: 3, updated: 1, removed: 0, skippedDuplicates: [entry({ id: "x" })], missing: [] }))
      .toBe("변경분 적용: 추가 3 · 수정 1 · 삭제 0 · 이미 있어 건너뜀 1");
  });
});
