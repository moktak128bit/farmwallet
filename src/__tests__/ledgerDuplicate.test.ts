/**
 * 중복 의심 탐지(findProbableDuplicates) — 같은 날·금액·계좌·통화·kind, 설명 일치 분리, excludeId, 옵션.
 */
import { describe, it, expect } from "vitest";
import type { LedgerEntry } from "../types";
import { findProbableDuplicates } from "../utils/ledgerDuplicate";

const mk = (over: Partial<LedgerEntry> & { id: string }): LedgerEntry => ({
  date: "2026-08-20",
  kind: "expense",
  category: "지출",
  subCategory: "식비",
  description: "",
  amount: 4500,
  fromAccountId: "신한",
  ...over,
});

const probe = { date: "2026-08-20", amount: 4500, kind: "expense" as const, fromAccountId: "신한", description: "" };

describe("findProbableDuplicates", () => {
  it("같은 날·같은 금액·같은 계좌·같은 kind만 matches", () => {
    const ledger = [
      mk({ id: "a" }),
      mk({ id: "b", date: "2026-08-19" }), // 다른 날
      mk({ id: "c", amount: 4600 }), // 다른 금액
      mk({ id: "d", fromAccountId: "국민" }), // 다른 계좌
      mk({ id: "e", kind: "income", fromAccountId: undefined, toAccountId: "신한" }), // 다른 kind
      mk({ id: "f", currency: "USD" }), // 다른 통화
    ];
    const r = findProbableDuplicates(probe, ledger);
    expect(r.matches.map((l) => l.id)).toEqual(["a"]);
    expect(r.exactDescription).toEqual([]);
  });

  it("설명까지(정규화) 같을 때만 exactDescription — 빈 설명끼리는 제외", () => {
    const ledger = [
      mk({ id: "a", description: "스타벅스 강남점" }),
      mk({ id: "b", description: "신한카드 스타벅스" }),
      mk({ id: "c", description: "이디야" }),
      mk({ id: "d", description: "" }),
    ];
    const r = findProbableDuplicates({ ...probe, description: "스타벅스" }, ledger);
    expect(r.matches.map((l) => l.id)).toEqual(["a", "b", "c", "d"]);
    expect(r.exactDescription.map((l) => l.id)).toEqual(["a", "b"]);
    const empty = findProbableDuplicates({ ...probe, description: "" }, ledger);
    expect(empty.matches).toHaveLength(4);
    expect(empty.exactDescription).toEqual([]);
  });

  it("excludeId(수정 중 자기 자신) 제외, 금액 0 이하는 빈 결과", () => {
    const ledger = [mk({ id: "a", description: "x" }), mk({ id: "b", description: "x" })];
    expect(findProbableDuplicates({ ...probe, description: "x", excludeId: "a" }, ledger).matches.map((l) => l.id)).toEqual(["b"]);
    expect(findProbableDuplicates({ ...probe, amount: 0 }, ledger).matches).toEqual([]);
  });

  it("옵션: sameDay=false면 날짜 무관, sameAccount=false면 계좌 무관", () => {
    const ledger = [mk({ id: "a", date: "2026-01-01" }), mk({ id: "b", fromAccountId: "국민" })];
    expect(findProbableDuplicates(probe, ledger).matches).toEqual([]);
    expect(findProbableDuplicates(probe, ledger, { sameDay: false }).matches.map((l) => l.id)).toEqual(["a"]);
    expect(findProbableDuplicates(probe, ledger, { sameAccount: false }).matches.map((l) => l.id)).toEqual(["b"]);
  });

  it("이체는 출금·입금 둘 다 같아야 하고, USD 소수 금액은 0.005 오차 내 동일", () => {
    const ledger = [
      mk({ id: "a", kind: "transfer", category: "이체", subCategory: "환전", fromAccountId: "농협", toAccountId: "달러", amount: 33.33, currency: "USD" }),
      mk({ id: "b", kind: "transfer", category: "이체", subCategory: "환전", fromAccountId: "농협", toAccountId: "적금", amount: 33.33, currency: "USD" }),
    ];
    const r = findProbableDuplicates(
      { date: "2026-08-20", amount: 33.334, kind: "transfer", fromAccountId: "농협", toAccountId: "달러", currency: "USD" },
      ledger
    );
    expect(r.matches.map((l) => l.id)).toEqual(["a"]);
  });
});
