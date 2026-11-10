import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "../types";
import { buildIncomeFacts, pairText } from "../features/insights/tabs/IncomeTab";

const inc = (id: string, date: string, amount: number, sub: string): LedgerEntry =>
  ({ id, date, kind: "income", category: "수입", subCategory: sub, description: "", amount } as LedgerEntry);

describe("수입원 사실(buildIncomeFacts) — 상투 문구 대신 근거", () => {
  const months = ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12"];
  const ledger = [
    inc("c1", "2025-08-03", 30_000, "캐시백"),
    inc("c2", "2025-09-03", 20_000, "캐시백"),
    inc("c3", "2025-10-03", 25_000, "캐시백"),
    inc("c4", "2025-11-03", 2_650_000, "캐시백"), // 실장부 2025.11 265만 같은 이상치
    inc("c5", "2025-12-02", 10_000, "캐시백"), // 진행 중인 달 — 완료월 통계 제외
  ];

  it("마지막 발생일·완료월 발생 패턴·직전 두 완료월", () => {
    const f = buildIncomeFacts(ledger, months, null, "2025-12").get("캐시백")!;
    expect(f.lastDate).toBe("2025-12-02");
    expect(f.doneMonths).toBe(4);
    expect(f.activeMonths).toBe(4);
    expect(f.prevPair).toEqual([{ m: "2025-10", v: 25_000 }, { m: "2025-11", v: 2_650_000 }]);
  });

  it("평소 달(중앙값)의 4배 이상인 달은 확인 필요 플래그", () => {
    const f = buildIncomeFacts(ledger, months, null, "2025-12").get("캐시백")!;
    expect(f.outlier?.m).toBe("2025-11");
    expect(f.outlier?.v).toBe(2_650_000);
  });

  it("두 달 비교: 3배 넘는 변화·0원 기준은 %를 숨기고 금액만 (103900% 방지)", () => {
    expect(pairText([{ m: "2025-10", v: 25_000 }, { m: "2025-11", v: 2_650_000 }])).not.toMatch(/%/);
    expect(pairText([{ m: "2025-10", v: 0 }, { m: "2025-11", v: 50_000 }])).toContain("없음");
    expect(pairText([{ m: "2025-10", v: 100_000 }, { m: "2025-11", v: 150_000 }])).toContain("+50%");
  });
});
