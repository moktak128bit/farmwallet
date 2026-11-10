import { describe, expect, it } from "vitest";
import type { AppData, LedgerEntry } from "../types";
import { planInboxApply } from "../hooks/useGasInbox";
import { getEmptyData } from "../storage";
import { LEDGER_DELTA_FORMAT } from "../utils/ledgerDelta";

const entry = (id: string, amount: number): LedgerEntry =>
  ({ id, date: "2026-11-06", kind: "expense", category: "지출", subCategory: "식비", description: "x", amount, fromAccountId: "NH신용카드" }) as LedgerEntry;

describe("Claude 받은 편지함 — 적용 계획", () => {
  const base: AppData = { ...getEmptyData(), ledger: [entry("L-old", 1000)] };
  const delta = { format: LEDGER_DELTA_FORMAT, ledger: { add: [entry("L-a", 5900), entry("L-b", 4000)] } };

  it("처음 열기: 거래가 더해지고 changed=true", () => {
    const r = planInboxApply(base, delta);
    expect(r.changed).toBe(true);
    expect(r.report.added).toBe(2);
    expect(r.after.ledger.map((l) => l.id)).toEqual(["L-old", "L-a", "L-b"]);
  });

  it("시트에 이미 들어간 뒤 다시 열기: 바뀌는 게 없어 changed=false(→ 적용 완료 표시)", () => {
    const once = planInboxApply(base, delta).after;
    const again = planInboxApply(once, delta);
    expect(again.changed).toBe(false);
    expect(again.report.added).toBe(0);
    expect(again.report.skippedDuplicates).toHaveLength(2);
    expect(again.after).toBe(once);
  });

  it("다른 id로 같은 거래가 이미 있으면 중복으로 건너뛴다", () => {
    const manual = { ...base, ledger: [...base.ledger, { ...entry("L-manual", 5900) }] };
    const r = planInboxApply(manual, delta);
    expect(r.report.added).toBe(1);
    expect(r.after.ledger.some((l) => l.id === "L-a")).toBe(false);
  });

  it("같은 변경분 안의 똑같은 거래 두 건은 둘 다 들어가고, 다시 적용하면 둘 다 건너뛴다", () => {
    const twice = { format: LEDGER_DELTA_FORMAT, ledger: { add: [{ ...entry("L-t1", 7000), time: "15:55" }, { ...entry("L-t2", 7000), time: "15:58" }, entry("L-n1", 3000), entry("L-n2", 3000)] } };
    const once = planInboxApply(base, twice);
    expect(once.report.added).toBe(4);
    const again = planInboxApply(once.after, twice);
    expect(again.changed).toBe(false);
    expect(again.report.skippedDuplicates).toHaveLength(4);
  });
});
