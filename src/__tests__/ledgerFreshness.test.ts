import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "../types";
import { dayCapLabel, daysSinceLastRecord, latestRecordedDate, recordedDayCap } from "../utils/ledgerFreshness";

const e = (date: string): LedgerEntry => ({ id: date, date, kind: "expense", category: "지출", amount: 1000 } as LedgerEntry);

describe("ledgerFreshness", () => {
  const ledger = [e("2026-10-30"), e("2026-11-05"), e("2026-11-20")]; // 11-20은 예약(미래)

  it("미래 날짜를 무시한 최근 기록일", () => {
    expect(latestRecordedDate(ledger, "2026-11-09")).toBe("2026-11-05");
    expect(latestRecordedDate([], "2026-11-09")).toBeNull();
  });

  it("이번 달 dayCap = min(오늘, 마지막 기록일)", () => {
    expect(recordedDayCap(ledger, "2026-11", "2026-11-09")).toBe(5);
    expect(recordedDayCap([e("2026-11-09")], "2026-11", "2026-11-09")).toBe(9);
  });

  it("지난 달은 null(월 전체), 이번 달 기록 전이면 0", () => {
    expect(recordedDayCap(ledger, "2026-10", "2026-11-09")).toBeNull();
    expect(recordedDayCap([e("2026-10-30")], "2026-11", "2026-11-03")).toBe(0);
  });

  it("마지막 기록 후 경과일과 라벨", () => {
    expect(daysSinceLastRecord(ledger, "2026-11-09")).toBe(4);
    expect(dayCapLabel(5, "2026-11-09")).toBe("1~5일 · 5일까지 기록");
    expect(dayCapLabel(9, "2026-11-09")).toBe("1~9일");
  });
});
