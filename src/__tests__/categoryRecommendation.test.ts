/**
 * 메모 기반 카테고리 추천 — 3단 표준·레거시 2단 정규화·상호 정규화·빈도/최근성 가중.
 * (QuickEntryModal이 소비. 추천 결과는 항상 현행 스키마 형태여야 한다 — cat=대분류 직접 형 재생산 금지)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { LedgerEntry } from "../types";
import {
  recommendCategory,
  normalizeLedgerCategory,
  normalizeMerchant,
  normalizeMerchantTokens,
} from "../utils/categoryRecommendation";

const mk = (over: Partial<LedgerEntry> & { id: string }): LedgerEntry => ({
  date: "2026-08-10",
  kind: "expense",
  category: "지출",
  description: "",
  amount: 5000,
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 20, 12, 0, 0)); // 2026-08-20 로컬 정오
});
afterEach(() => {
  vi.useRealTimers();
});

describe("normalizeLedgerCategory — 현행 3단 스키마로 정규화", () => {
  it("현행 표준(cat=지출/sub=대분류/det=소분류)은 그대로", () => {
    expect(
      normalizeLedgerCategory(mk({ id: "a", category: "지출", subCategory: "식비", detailCategory: "카페" }))
    ).toEqual({ category: "지출", subCategory: "식비", detailCategory: "카페" });
  });

  it("레거시(cat=대분류 직접, sub=소분류)는 main=category, sub→detail 승격", () => {
    expect(normalizeLedgerCategory(mk({ id: "a", category: "식비", subCategory: "시장/마트" }))).toEqual({
      category: "지출",
      subCategory: "식비",
      detailCategory: "시장/마트",
    });
  });

  it("레거시 cat=대분류 + det 있음이면 det 우선", () => {
    expect(
      normalizeLedgerCategory(mk({ id: "a", category: "식비", subCategory: "외식", detailCategory: "카페" }))
    ).toEqual({ category: "지출", subCategory: "식비", detailCategory: "카페" });
  });

  it("빈 문자열·공백은 undefined로 정리", () => {
    expect(normalizeLedgerCategory(mk({ id: "a", category: "지출", subCategory: " ", detailCategory: "" }))).toEqual({
      category: "지출",
      subCategory: undefined,
      detailCategory: undefined,
    });
  });

  it("수입: subCategory 우선, 레거시(cat=월급)는 category를 분류로", () => {
    expect(normalizeLedgerCategory(mk({ id: "a", kind: "income", category: "수입", subCategory: "월급" }))).toEqual({
      category: "수입",
      subCategory: "월급",
    });
    expect(normalizeLedgerCategory(mk({ id: "b", kind: "income", category: "월급" }))).toEqual({
      category: "수입",
      subCategory: "월급",
    });
  });

  it("이체: category=이체, subCategory=실제 분류(detail 없음)", () => {
    const n = normalizeLedgerCategory(mk({ id: "a", kind: "transfer", category: "이체", subCategory: "저축이체" }));
    expect(n).toEqual({ category: "이체", subCategory: "저축이체" });
    expect(n && "detailCategory" in n).toBe(false);
  });

  it("특수 스키마(재테크·신용결제 expense)는 학습 제외(null)", () => {
    expect(normalizeLedgerCategory(mk({ id: "a", category: "재테크", subCategory: "투자손실" }))).toBeNull();
    expect(normalizeLedgerCategory(mk({ id: "b", category: "신용결제" }))).toBeNull();
    expect(normalizeLedgerCategory(mk({ id: "c", category: "지출", subCategory: "신용결제" }))).toBeNull();
  });
});

describe("normalizeMerchant — 상호 정규화", () => {
  it("카드사 접두·법인 표기·N호점·숫자·기호·공백 제거, 소문자화", () => {
    expect(normalizeMerchant("신한카드 (주)스타벅스 강남2호점 1234")).toBe("스타벅스");
    expect(normalizeMerchant("스타벅스")).toBe("스타벅스");
    expect(normalizeMerchant("카카오페이 GS25 역삼점")).toBe("gs");
    expect(normalizeMerchant("GS25")).toBe("gs");
    expect(normalizeMerchant("Starbucks Coffee Co., Ltd.")).toBe("starbuckscoffee");
  });

  it("띄어 쓴 지점 토큰(강남점·본점)은 제거, 일반명사(편의점)는 보존", () => {
    expect(normalizeMerchantTokens("이마트 본점")).toEqual(["이마트"]);
    expect(normalizeMerchantTokens("CU 편의점")).toEqual(["cu", "편의점"]);
  });

  it("상호가 '점'으로 끝나는 한 단어면 보존 (홍콩반점·편의점)", () => {
    expect(normalizeMerchant("홍콩반점")).toBe("홍콩반점");
    expect(normalizeMerchant("편의점")).toBe("편의점");
  });

  it("'카드값'·'신한은행'은 카드사 접두로 오인하지 않음", () => {
    expect(normalizeMerchant("카드값 납부")).toBe("카드값납부");
    expect(normalizeMerchant("신한은행 이체")).toBe("신한은행이체");
  });

  it("빈 문자열·숫자만이면 빈 결과", () => {
    expect(normalizeMerchant("")).toBe("");
    expect(normalizeMerchant("12345")).toBe("");
  });
});

describe("recommendCategory — 결과 형태", () => {
  it("현행 표준 항목에서 학습하면 category/subCategory/detailCategory 3단을 반환", () => {
    const ledger = [mk({ id: "1", description: "스타벅스", subCategory: "식비", detailCategory: "카페", amount: 5500, fromAccountId: "A1" })];
    const recs = recommendCategory("스타벅스", 5500, "expense", ledger);
    expect(recs.length).toBe(1);
    expect(recs[0]).toMatchObject({ category: "지출", subCategory: "식비", detailCategory: "카페", fromAccountId: "A1" });
  });

  it("레거시(cat=식비/sub=카페) 항목에서 학습해도 현행 3단 형태로 추천 (레거시 형태 재생산 금지)", () => {
    const ledger = [mk({ id: "1", description: "스타벅스", category: "식비", subCategory: "카페", amount: 5500 })];
    const recs = recommendCategory("스타벅스", 5500, "expense", ledger);
    expect(recs[0]).toMatchObject({ category: "지출", subCategory: "식비", detailCategory: "카페" });
    expect(recs[0].category).not.toBe("식비");
  });

  it("레거시와 현행이 같은 분류면 하나의 후보로 병합(키에 정규화 3단 사용)", () => {
    const ledger = [
      mk({ id: "1", description: "스타벅스", category: "식비", subCategory: "카페", amount: 5500 }),
      mk({ id: "2", description: "스타벅스", category: "지출", subCategory: "식비", detailCategory: "카페", amount: 5500 }),
    ];
    const recs = recommendCategory("스타벅스", 5500, "expense", ledger);
    expect(recs.length).toBe(1);
  });

  it("수입 추천은 detailCategory 없이 category=수입", () => {
    const ledger = [mk({ id: "1", kind: "income", category: "수입", subCategory: "월급", description: "월급", amount: 3000000, toAccountId: "A1" })];
    const recs = recommendCategory("월급", 3000000, "income", ledger);
    expect(recs[0]).toMatchObject({ category: "수입", subCategory: "월급", toAccountId: "A1" });
    expect(recs[0].detailCategory).toBeUndefined();
  });

  it("kind가 다른 항목은 무시", () => {
    const ledger = [mk({ id: "1", kind: "income", category: "수입", subCategory: "월급", description: "스타벅스", amount: 5500 })];
    expect(recommendCategory("스타벅스", 5500, "expense", ledger)).toEqual([]);
  });

  it("재테크·신용결제 항목은 추천 소스에서 제외", () => {
    const ledger = [
      mk({ id: "1", description: "적금", category: "재테크", subCategory: "저축", amount: 100000 }),
      mk({ id: "2", description: "카드대금", category: "신용결제", amount: 100000 }),
    ];
    expect(recommendCategory("적금", 100000, "expense", ledger)).toEqual([]);
    expect(recommendCategory("카드대금", 100000, "expense", ledger)).toEqual([]);
  });

  it("설명 2글자 미만·숫자만이면 빈 배열", () => {
    const ledger = [mk({ id: "1", description: "스타벅스", subCategory: "식비", amount: 5500 })];
    expect(recommendCategory("스", 5500, "expense", ledger)).toEqual([]);
    expect(recommendCategory("1234", 5500, "expense", ledger)).toEqual([]);
  });
});

describe("recommendCategory — 상호 정규화 매칭", () => {
  it("카드 명세 표기('신한카드 스타벅스강남2호점 1234')를 손으로 친 '스타벅스'와 같은 상호로 인식", () => {
    const ledger = [mk({ id: "1", description: "신한카드 스타벅스강남2호점 1234", subCategory: "식비", detailCategory: "카페", amount: 50000 })];
    // 금액이 많이 달라도(유사도 0) 상호 완전 일치만으로 후보
    const recs = recommendCategory("스타벅스", 5500, "expense", ledger);
    expect(recs[0]).toMatchObject({ subCategory: "식비", detailCategory: "카페" });
  });

  it("붙여 쓴 지점('스타벅스역삼역점')도 같은 상호", () => {
    const ledger = [mk({ id: "1", description: "스타벅스역삼역점", subCategory: "식비", detailCategory: "카페", amount: 50000 })];
    const recs = recommendCategory("스타벅스", 5500, "expense", ledger);
    expect(recs.length).toBe(1);
  });

  it("전혀 다른 상호는 추천하지 않음", () => {
    const ledger = [mk({ id: "1", description: "이마트 본점", subCategory: "식비", detailCategory: "시장/마트", amount: 50000 })];
    expect(recommendCategory("스타벅스", 5500, "expense", ledger)).toEqual([]);
  });

  it("부분 포함 + 금액 근사면 후보 (부분 일치만으로는 임계 미달)", () => {
    const ledger = [mk({ id: "1", description: "스타벅스 아메리카노", subCategory: "식비", detailCategory: "카페", amount: 4500 })];
    // 토큰 겹침 1/2*0.5=0.25 + 부분포함 0.3 = 0.55 → 후보
    expect(recommendCategory("스타벅스", 4500, "expense", ledger).length).toBe(1);
    // 토큰 0 겹침 + 부분포함만(0.3) + 금액 먼 → 0.3 (임계 초과 아님)
    const far = [mk({ id: "2", description: "스타벅스커피", subCategory: "식비", amount: 500000 })];
    expect(recommendCategory("스타", 5000, "expense", far)).toEqual([]);
  });
});

describe("recommendCategory — 빈도·최근성 가중", () => {
  it("같은 유사도면 더 자주 쓴 분류가 앞선다", () => {
    const ledger = [
      mk({ id: "1", description: "점심", subCategory: "식비", detailCategory: "외식", amount: 10000, date: "2026-01-05" }),
      mk({ id: "2", description: "점심", subCategory: "식비", detailCategory: "외식", amount: 10000, date: "2026-01-06" }),
      mk({ id: "3", description: "점심", subCategory: "식비", detailCategory: "외식", amount: 10000, date: "2026-01-07" }),
      mk({ id: "4", description: "점심", subCategory: "업무", detailCategory: "회식", amount: 10000, date: "2026-01-08" }),
    ];
    const recs = recommendCategory("점심", 10000, "expense", ledger);
    expect(recs[0]).toMatchObject({ subCategory: "식비", detailCategory: "외식" });
    expect(recs[1]).toMatchObject({ subCategory: "업무", detailCategory: "회식" });
  });

  it("같은 유사도·빈도면 최근 30일 내 쓴 분류가 앞선다 (now=2026-08-20 기준)", () => {
    const ledger = [
      mk({ id: "1", description: "점심", subCategory: "식비", detailCategory: "외식", amount: 10000, date: "2026-01-05" }),
      mk({ id: "2", description: "점심", subCategory: "업무", detailCategory: "회식", amount: 10000, date: "2026-08-15" }),
    ];
    const recs = recommendCategory("점심", 10000, "expense", ledger);
    expect(recs[0]).toMatchObject({ subCategory: "업무", detailCategory: "회식" });
    // 가중치 차이 = 0.1(30일 이내) - 0(90일 초과)
    expect(recs[0].score - recs[1].score).toBeCloseTo(0.1, 6);
  });

  it("최근성은 분류 조합 전체의 최신 날짜 기준 (설명이 달라도 같은 분류면 최근 사용으로 친다)", () => {
    const ledger = [
      mk({ id: "1", description: "점심", subCategory: "식비", detailCategory: "외식", amount: 10000, date: "2026-01-05" }),
      mk({ id: "2", description: "저녁", subCategory: "식비", detailCategory: "외식", amount: 20000, date: "2026-08-18" }),
      mk({ id: "3", description: "점심", subCategory: "업무", detailCategory: "회식", amount: 10000, date: "2026-01-05" }),
    ];
    const recs = recommendCategory("점심", 10000, "expense", ledger);
    expect(recs[0]).toMatchObject({ subCategory: "식비" });
  });

  it("최대 5개만 반환, 점수 내림차순", () => {
    const ledger = Array.from({ length: 8 }, (_, i) =>
      mk({ id: `k${i}`, description: "점심", subCategory: `대분류${i}`, amount: 10000 + i * 100, fromAccountId: `A${i}` })
    );
    const recs = recommendCategory("점심", 10000, "expense", ledger);
    expect(recs.length).toBe(5);
    for (let i = 1; i < recs.length; i++) expect(recs[i - 1].score).toBeGreaterThanOrEqual(recs[i].score);
  });
});
