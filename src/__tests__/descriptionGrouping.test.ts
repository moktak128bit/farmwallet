import { describe, it, expect } from "vitest";
import {
  levenshtein,
  normalizeForGrouping,
  areSimilar,
  findDescriptionGroups,
  applyDescriptionMerge,
  buildVariantsByContext,
} from "../utils/descriptionGrouping";
import type { LedgerEntry } from "../types";

function entry(o: Partial<LedgerEntry> & { id: string; amount: number }): LedgerEntry {
  return {
    date: "2026-04-01",
    kind: "expense",
    category: "지출",
    subCategory: "식비",
    description: "",
    ...o,
  } as LedgerEntry;
}

describe("levenshtein", () => {
  it("동일 문자열 거리 0", () => {
    expect(levenshtein("휘발유", "휘발유")).toBe(0);
    expect(levenshtein("", "")).toBe(0);
  });

  it("빈 문자열은 다른 쪽 길이", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });

  it("한 글자 차이 = 거리 1", () => {
    expect(levenshtein("휘발유", "휘발류")).toBe(1);
    expect(levenshtein("kitten", "sitten")).toBe(1);
  });

  it("일반적인 케이스", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("휘발유", "기름값")).toBeGreaterThan(2);
  });
});

describe("normalizeForGrouping", () => {
  it("trim + lowercase", () => {
    expect(normalizeForGrouping("  Café  ")).toBe("café");
  });

  it("[원래소분류:xxx] 같은 메타 태그 제거", () => {
    expect(normalizeForGrouping("휘발유 [원래소분류:유류비/충전비]")).toBe("휘발유");
    expect(normalizeForGrouping("기름값[메모]")).toBe("기름값");
  });

  it("연속 공백은 하나로", () => {
    expect(normalizeForGrouping("스시   소라")).toBe("스시 소라");
  });
});

describe("areSimilar", () => {
  it("정규화 후 같으면 유사", () => {
    expect(areSimilar("휘발유", "휘발유 [원래소분류:유류비/충전비]")).toBe(true);
  });

  it("4자 이상은 편집거리 ≤ 2 까지 유사", () => {
    expect(areSimilar("스시소라", "스시조라")).toBe(true);  // 거리 1
    expect(areSimilar("스타벅스", "스타벅수")).toBe(true);  // 거리 1
  });

  it("짧은 단어(≤ 3)는 편집거리로 안 묶음 — false positive 방지", () => {
    // 휘발유/휘발류는 의도적으로 자동 묶임 X — 모달의 '다른 변형 추가'로 수동 처리
    expect(areSimilar("휘발유", "휘발류")).toBe(false);
    // 핵심 false positive 케이스: 세차비 vs 주차비 (거리 1, 완전 다른 단어)
    expect(areSimilar("세차비", "주차비")).toBe(false);
    expect(areSimilar("커피", "녹차")).toBe(false);
    expect(areSimilar("차", "책")).toBe(false);
  });

  it("포함 관계도 유사 ('휘발유 카드결제' ⊃ '휘발유')", () => {
    expect(areSimilar("휘발유 카드결제", "휘발유")).toBe(true);
    expect(areSimilar("스타벅스 강남점", "스타벅스")).toBe(true);
  });

  it("완전히 다른 단어는 비유사", () => {
    expect(areSimilar("휘발유", "기름값")).toBe(false);  // 의미는 같지만 글자 다름 (사람 판단 영역)
    expect(areSimilar("점심", "저녁")).toBe(false);
  });

  it("빈 문자열은 비유사", () => {
    expect(areSimilar("", "휘발유")).toBe(false);
  });
});

describe("findDescriptionGroups", () => {
  it("같은 (kind/cat/sub) 안에서 유사 description들 묶음 — 부분 일치(메타 태그) 케이스", () => {
    const ledger = [
      entry({ id: "1", amount: 50000, subCategory: "유류교통비", description: "휘발유" }),
      entry({ id: "2", amount: 60000, subCategory: "유류교통비", description: "휘발유 [원래소분류:유류비/충전비]" }),
      entry({ id: "3", amount: 30000, subCategory: "유류교통비", description: "주차비" }),
    ];
    const groups = findDescriptionGroups(ledger);
    expect(groups).toHaveLength(1);
    expect(groups[0].variants).toHaveLength(2);  // 휘발유 + 휘발유 [원래...]
    expect(groups[0].totalAmount).toBe(110000);
  });

  it("회귀: 세차비/주차비 false positive 안 됨 (3자 + 거리 1)", () => {
    const ledger = [
      entry({ id: "1", amount: 50000, subCategory: "유지보수비", description: "세차비" }),
      entry({ id: "2", amount: 30000, subCategory: "유지보수비", description: "주차비" }),
    ];
    const groups = findDescriptionGroups(ledger);
    expect(groups).toHaveLength(0);  // 자동 묶임 X
  });

  it("다른 카테고리 간 유사해도 묶지 않음", () => {
    const ledger = [
      entry({ id: "1", amount: 50000, subCategory: "유류교통비", description: "휘발유" }),
      entry({ id: "2", amount: 60000, subCategory: "식비",      description: "휘발유" }),  // 다른 sub
    ];
    const groups = findDescriptionGroups(ledger);
    expect(groups).toHaveLength(0);
  });

  it("단일 description은 그룹 X (통합할 게 없음)", () => {
    const ledger = [entry({ id: "1", amount: 50000, description: "휘발유" })];
    expect(findDescriptionGroups(ledger)).toEqual([]);
  });

  it("빈 description은 그룹핑 제외", () => {
    const ledger = [
      entry({ id: "1", amount: 50000, description: "" }),
      entry({ id: "2", amount: 60000, description: "" }),
      entry({ id: "3", amount: 70000, description: "스타벅스" }),
      entry({ id: "4", amount: 80000, description: "스타벅수" }),
    ];
    const groups = findDescriptionGroups(ledger);
    expect(groups).toHaveLength(1);
    expect(groups[0].variants.every(v => v.description !== "")).toBe(true);
  });

  it("그룹 내 변형은 count 큰 순 정렬, suggestedCanonical은 1위", () => {
    const ledger = [
      entry({ id: "1", amount: 1000, description: "스타벅스" }),
      entry({ id: "2", amount: 1000, description: "스타벅스" }),
      entry({ id: "3", amount: 1000, description: "스타벅스" }),
      entry({ id: "4", amount: 1000, description: "스타벅수" }),
    ];
    const groups = findDescriptionGroups(ledger);
    expect(groups[0].variants[0].description).toBe("스타벅스");
    expect(groups[0].variants[0].count).toBe(3);
    expect(groups[0].suggestedCanonical).toBe("스타벅스");
  });

  it("contextKey가 모든 그룹에 포함됨 (수동 추가 조회용)", () => {
    const ledger = [
      entry({ id: "1", amount: 1000, kind: "expense", category: "지출", subCategory: "식비", description: "스시소라" }),
      entry({ id: "2", amount: 1000, kind: "expense", category: "지출", subCategory: "식비", description: "스시조라" }),
    ];
    const groups = findDescriptionGroups(ledger);
    expect(groups[0].contextKey).toBe("expense|지출|식비");
  });

  it("여러 그룹은 totalAmount 큰 순 정렬", () => {
    const ledger = [
      // 큰 그룹 (식비, 100만)
      entry({ id: "1", amount: 500000, subCategory: "식비", description: "스시소라" }),
      entry({ id: "2", amount: 500000, subCategory: "식비", description: "스시조라" }),
      // 작은 그룹 (구독비, 10만)
      entry({ id: "3", amount: 50000, subCategory: "구독비", description: "넷플릭스" }),
      entry({ id: "4", amount: 50000, subCategory: "구독비", description: "넷플리스" }),
    ];
    const groups = findDescriptionGroups(ledger);
    expect(groups).toHaveLength(2);
    expect(groups[0].subCategory).toBe("식비");      // 큰 거 먼저
    expect(groups[1].subCategory).toBe("구독비");
  });

  it("ledgerIds 추적 정확 — bulk update 위해", () => {
    const ledger = [
      entry({ id: "a", amount: 100, description: "스타벅스" }),
      entry({ id: "b", amount: 200, description: "스타벅스" }),
      entry({ id: "c", amount: 300, description: "스타벅수" }),
    ];
    const groups = findDescriptionGroups(ledger);
    const variants = groups[0].variants;
    const allIds = variants.flatMap(v => v.ledgerIds).sort();
    expect(allIds).toEqual(["a", "b", "c"]);
  });
});

describe("applyDescriptionMerge", () => {
  const ledger = [
    entry({ id: "a", amount: 100, description: "휘발유" }),
    entry({ id: "b", amount: 200, description: "휘발류" }),
    entry({ id: "c", amount: 300, description: "기름값" }),
    entry({ id: "d", amount: 400, description: "주차비" }),
  ];

  it("선택된 항목의 description만 canonical로 변경, 나머지 보존", () => {
    const result = applyDescriptionMerge(ledger, new Set(["a", "b", "c"]), "휘발유");
    expect(result.find(l => l.id === "a")?.description).toBe("휘발유");
    expect(result.find(l => l.id === "b")?.description).toBe("휘발유");
    expect(result.find(l => l.id === "c")?.description).toBe("휘발유");
    expect(result.find(l => l.id === "d")?.description).toBe("주차비");  // 변경 안 됨
  });

  it("이미 canonical과 같은 항목은 새 객체 안 만듦 (참조 동등)", () => {
    const result = applyDescriptionMerge(ledger, new Set(["a", "b"]), "휘발유");
    const aOrig = ledger.find(l => l.id === "a");
    const aNew = result.find(l => l.id === "a");
    expect(aNew).toBe(aOrig);  // 참조 동일 — 무의미한 리렌더 방지
  });

  it("canonical 값에 좌우 공백 있으면 trim", () => {
    const result = applyDescriptionMerge(ledger, new Set(["a"]), "  휘발유  ");
    expect(result.find(l => l.id === "a")?.description).toBe("휘발유");
  });

  it("빈 canonical은 무시 (원본 그대로)", () => {
    const result = applyDescriptionMerge(ledger, new Set(["a", "b"]), "   ");
    expect(result).toBe(ledger);
  });

  it("선택된 id가 ledger에 없으면 무변경", () => {
    const result = applyDescriptionMerge(ledger, new Set(["nonexistent"]), "휘발유");
    expect(result.every((l, i) => l === ledger[i])).toBe(true);
  });
});

describe("buildVariantsByContext", () => {
  it("(kind, category, subCategory)별 distinct description 변형 수집", () => {
    const ledger = [
      entry({ id: "1", amount: 100, kind: "expense", category: "지출", subCategory: "유류교통비", description: "휘발유" }),
      entry({ id: "2", amount: 200, kind: "expense", category: "지출", subCategory: "유류교통비", description: "휘발류" }),
      entry({ id: "3", amount: 300, kind: "expense", category: "지출", subCategory: "유류교통비", description: "주차비" }),
      entry({ id: "4", amount: 400, kind: "expense", category: "지출", subCategory: "식비",       description: "휘발유" }),  // 다른 sub
    ];
    const m = buildVariantsByContext(ledger);
    const fuel = m.get("expense|지출|유류교통비");
    expect(fuel).toBeDefined();
    expect(fuel!.map(v => v.description).sort()).toEqual(["주차비", "휘발류", "휘발유"]);
    const food = m.get("expense|지출|식비");
    expect(food!.map(v => v.description)).toEqual(["휘발유"]);
  });

  it("count 큰 순 정렬", () => {
    const ledger = [
      entry({ id: "1", amount: 1, description: "a" }),
      entry({ id: "2", amount: 1, description: "b" }),
      entry({ id: "3", amount: 1, description: "b" }),
      entry({ id: "4", amount: 1, description: "b" }),
    ];
    const m = buildVariantsByContext(ledger);
    const variants = m.get("expense|지출|식비")!;
    expect(variants[0].description).toBe("b");
    expect(variants[0].count).toBe(3);
  });

  it("빈 description 제외", () => {
    const ledger = [
      entry({ id: "1", amount: 1, description: "" }),
      entry({ id: "2", amount: 1, description: "휘발유" }),
    ];
    const m = buildVariantsByContext(ledger);
    const variants = m.get("expense|지출|식비")!;
    expect(variants.every(v => v.description !== "")).toBe(true);
  });

  it("ledgerIds 추적 정확 — 수동 추가 후 bulk update에 사용", () => {
    const ledger = [
      entry({ id: "x", amount: 1, description: "휘발유" }),
      entry({ id: "y", amount: 1, description: "휘발유" }),
    ];
    const m = buildVariantsByContext(ledger);
    expect(m.get("expense|지출|식비")![0].ledgerIds.sort()).toEqual(["x", "y"]);
  });
});
