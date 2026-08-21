/**
 * 설명 자동완성 인덱스(ledgerSuggest) — 빈도×최근성 순위, kind 분리, 레거시 분류 정규화, 빈 필드만 채움.
 */
import { describe, it, expect } from "vitest";
import type { LedgerEntry } from "../types";
import {
  buildDescriptionIndex,
  suggestDescriptions,
  recentDescriptionGroups,
  fillEmptyFormFields,
  suggestionToFormFields,
  describeSuggestion,
  descriptionGroupKey,
} from "../utils/ledgerSuggest";

const mk = (over: Partial<LedgerEntry> & { id: string }): LedgerEntry => ({
  date: "2026-08-10",
  kind: "expense",
  category: "지출",
  description: "",
  amount: 5000,
  ...over,
});

const TODAY = "2026-08-20";

describe("buildDescriptionIndex — 그룹·최빈 조합", () => {
  it("같은 설명(표기 변형 포함)을 한 그룹으로 묶고 count·lastDate·최빈 분류/계좌를 기록", () => {
    const ledger = [
      mk({ id: "1", date: "2026-08-01", description: "스타벅스", subCategory: "식비", detailCategory: "카페", fromAccountId: "신한" }),
      mk({ id: "2", date: "2026-08-05", description: "스타벅스 강남점", subCategory: "식비", detailCategory: "카페", fromAccountId: "신한" }),
      mk({ id: "3", date: "2026-08-12", description: "신한카드 스타벅스", subCategory: "문화생활", detailCategory: "기타", fromAccountId: "국민" }),
    ];
    const idx = buildDescriptionIndex(ledger);
    expect(idx.groups).toHaveLength(1);
    const g = idx.groups[0];
    expect(g.count).toBe(3);
    expect(g.lastDate).toBe("2026-08-12");
    expect(g.lastEntry.id).toBe("3");
    expect(g.description).toBe("신한카드 스타벅스"); // 가장 최근 원문
    // 최빈 조합(2회) = 식비>카페·신한
    expect(g.category).toBe("지출");
    expect(g.subCategory).toBe("식비");
    expect(g.detailCategory).toBe("카페");
    expect(g.fromAccountId).toBe("신한");
    expect(g.comboCount).toBe(2);
  });

  it("레거시(cat=대분류 직접, sub=소분류)도 현행 3단으로 정규화해 학습", () => {
    const ledger = [
      mk({ id: "1", description: "이마트", category: "식비", subCategory: "시장/마트", fromAccountId: "농협" }),
      mk({ id: "2", description: "이마트", category: "식비", subCategory: "시장/마트", fromAccountId: "농협" }),
    ];
    const g = buildDescriptionIndex(ledger).groups[0];
    expect(g.category).toBe("지출");
    expect(g.subCategory).toBe("식비");
    expect(g.detailCategory).toBe("시장/마트");
    expect(suggestionToFormFields(g)).toEqual({ mainCategory: "식비", subCategory: "시장/마트", fromAccountId: "농협", toAccountId: "" });
  });

  it("빈 설명은 인덱스 제외, kind가 다르면 별도 그룹", () => {
    const ledger = [
      mk({ id: "1", description: "" }),
      mk({ id: "2", description: "   " }),
      mk({ id: "3", description: "월급", kind: "income", category: "수입", subCategory: "급여", toAccountId: "농협" }),
      mk({ id: "4", description: "월급", kind: "expense", subCategory: "기타" }),
    ];
    const idx = buildDescriptionIndex(ledger);
    expect(idx.groups).toHaveLength(2);
    const income = idx.groups.find((g) => g.kind === "income")!;
    expect(income.subCategory).toBe("급여");
    expect(income.toAccountId).toBe("농협");
    expect(suggestionToFormFields(income)).toEqual({ mainCategory: "", subCategory: "급여", fromAccountId: "", toAccountId: "농협" });
  });

  it("신용결제·재테크 특수 스키마는 분류 채움 대상에서 제외(빈도만 반영)", () => {
    const ledger = [
      mk({ id: "1", description: "카드대금", category: "신용결제", fromAccountId: "농협" }),
      mk({ id: "2", description: "카드대금", category: "신용결제", fromAccountId: "농협" }),
    ];
    const g = buildDescriptionIndex(ledger).groups[0];
    expect(g.count).toBe(2);
    expect(g.category).toBeUndefined();
    expect(g.comboCount).toBe(0);
  });

  it("숫자·기호만인 설명은 소문자 원문을 키로 폴백", () => {
    expect(descriptionGroupKey("1234")).toBe("1234");
    expect(descriptionGroupKey("  ")).toBe("");
  });
});

describe("suggestDescriptions — 빈도×최근성, kind 분리", () => {
  const ledger = [
    // 스타벅스: 5회, 최근 (30일 내)
    ...[1, 2, 3, 4, 5].map((i) => mk({ id: `s${i}`, date: `2026-08-0${i}`, description: "스타벅스", subCategory: "식비", detailCategory: "카페" })),
    // 스시집: 8회지만 1년 넘음 → 8×0.3=2.4 < 5×1.0
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => mk({ id: `o${i}`, date: `2024-01-0${i}`, description: "스시집", subCategory: "식비", detailCategory: "외식" })),
    // '투썸' — 부분 일치 테스트용 (접두 아님)
    mk({ id: "t1", date: "2026-08-15", description: "카페 투썸스", subCategory: "식비", detailCategory: "카페" }),
    // 수입 kind
    mk({ id: "i1", date: "2026-08-15", description: "스톡옵션", kind: "income", category: "수입", subCategory: "기타" }),
  ];
  const idx = buildDescriptionIndex(ledger);

  it("접두 일치 + 최근 빈도가 높은 순", () => {
    const r = suggestDescriptions(idx, "스", "expense", { today: TODAY });
    expect(r.map((x) => x.description)).toEqual(["스타벅스", "스시집", "카페 투썸스"]);
  });

  it("kind가 다른 그룹은 제외", () => {
    const r = suggestDescriptions(idx, "스", "income", { today: TODAY });
    expect(r.map((x) => x.description)).toEqual(["스톡옵션"]);
  });

  it("빈 prefix는 [] / limit 적용 / 대소문자 무시", () => {
    expect(suggestDescriptions(idx, "  ", "expense", { today: TODAY })).toEqual([]);
    expect(suggestDescriptions(idx, "스", "expense", { today: TODAY, limit: 1 })).toHaveLength(1);
    const ledger2 = [mk({ id: "a", description: "GS25" })];
    expect(suggestDescriptions(buildDescriptionIndex(ledger2), "gs", "expense", { today: TODAY })).toHaveLength(1);
  });

  it("표기 변형 입력(카드사 접두)도 정규화 키로 매칭", () => {
    const r = suggestDescriptions(idx, "신한카드 스타벅스", "expense", { today: TODAY });
    expect(r[0]?.description).toBe("스타벅스");
  });
});

describe("recentDescriptionGroups — 최근 30일 상위 N", () => {
  it("30일 밖은 제외, 횟수 desc → 최근 desc, limit", () => {
    const ledger = [
      mk({ id: "1", date: "2026-08-19", description: "A" }),
      mk({ id: "2", date: "2026-08-18", description: "B" }),
      mk({ id: "3", date: "2026-08-17", description: "B" }),
      mk({ id: "4", date: "2026-06-01", description: "C" }), // 80일 전
      mk({ id: "5", date: "2026-08-19", description: "D" }),
    ];
    const r = recentDescriptionGroups(buildDescriptionIndex(ledger), { today: TODAY, limit: 2 });
    expect(r.map((g) => g.description)).toEqual(["B", "A"]);
    const all = recentDescriptionGroups(buildDescriptionIndex(ledger), { today: TODAY });
    expect(all.map((g) => g.description)).toEqual(["B", "A", "D"]);
  });
});

describe("fillEmptyFormFields — 비어 있는 필드만 채움", () => {
  const sug = { kind: "expense" as const, subCategory: "식비", detailCategory: "카페", fromAccountId: "신한", toAccountId: undefined };

  it("전부 비어 있으면 대/소분류·출금계좌 채움", () => {
    const { next, applied } = fillEmptyFormFields({ mainCategory: "", subCategory: "", fromAccountId: "", toAccountId: "" }, sug);
    expect(next).toEqual({ mainCategory: "식비", subCategory: "카페", fromAccountId: "신한", toAccountId: "" });
    expect(applied).toEqual(["mainCategory", "subCategory", "fromAccountId"]);
  });

  it("사용자가 고른 값은 덮지 않음 — 다른 대분류면 소분류도 안 채움", () => {
    const { next, applied } = fillEmptyFormFields({ mainCategory: "문화생활", subCategory: "", fromAccountId: "국민", toAccountId: "" }, sug);
    expect(next).toEqual({ mainCategory: "문화생활", subCategory: "", fromAccountId: "국민", toAccountId: "" });
    expect(applied).toEqual([]);
  });

  it("같은 대분류면 비어 있는 소분류만 채움", () => {
    const { next, applied } = fillEmptyFormFields({ mainCategory: "식비", subCategory: "", fromAccountId: "국민", toAccountId: "" }, sug);
    expect(next.subCategory).toBe("카페");
    expect(next.fromAccountId).toBe("국민");
    expect(applied).toEqual(["subCategory"]);
  });

  it("이체 추천은 from/to 둘 다, 수입 추천은 to만", () => {
    const tr = fillEmptyFormFields(
      { mainCategory: "이체", subCategory: "", fromAccountId: "", toAccountId: "" },
      { kind: "transfer", subCategory: "저축이체", fromAccountId: "농협", toAccountId: "적금" }
    );
    expect(tr.next).toEqual({ mainCategory: "이체", subCategory: "저축이체", fromAccountId: "농협", toAccountId: "적금" });
    const inc = fillEmptyFormFields(
      { mainCategory: "", subCategory: "", fromAccountId: "", toAccountId: "" },
      { kind: "income", subCategory: "급여", toAccountId: "농협" }
    );
    expect(inc.next).toEqual({ mainCategory: "", subCategory: "급여", fromAccountId: "", toAccountId: "농협" });
  });

  it("describeSuggestion 라벨", () => {
    expect(describeSuggestion(sug)).toBe("식비>카페 · 신한");
    expect(describeSuggestion({ kind: "transfer", subCategory: "저축이체", fromAccountId: "농협", toAccountId: "적금" })).toBe("저축이체 · 농협→적금");
    expect(describeSuggestion({ kind: "income", subCategory: "급여" })).toBe("급여");
  });
});
