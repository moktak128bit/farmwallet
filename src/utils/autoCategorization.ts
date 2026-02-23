/**
 * 자동 카테고리 분류 유틸리티
 */

import type { LedgerEntry } from "../types";

interface CategoryRule {
  keywords: string[];
  category: string;
  subCategory?: string;
}

const DEFAULT_RULES: CategoryRule[] = [
  { keywords: ["식당", "맛집", "카페", "커피", "음식", "점심", "저녁", "아침"], category: "식비", subCategory: "외식" },
  { keywords: ["마트", "편의점", "이마트", "롯데마트", "홈플러스", "쿠팡", "마켓컬리"], category: "식비", subCategory: "식료품" },
  { keywords: ["택시", "버스", "지하철", "교통", "주유", "주차"], category: "교통비" },
  { keywords: ["관리비", "전기", "가스", "수도", "인터넷", "통신", "핸드폰"], category: "주거비", subCategory: "공과금" },
  { keywords: ["병원", "약국", "의료", "치과", "검진"], category: "의료비" },
  { keywords: ["영화", "넷플릭스", "게임", "취미", "도서"], category: "문화생활" },
  { keywords: ["옷", "의류", "신발", "쇼핑"], category: "쇼핑" },
  { keywords: ["급여", "월급"], category: "수입", subCategory: "급여" },
  { keywords: ["배당", "이자"], category: "수입", subCategory: "배당/이자" }
];

/**
 * 설명 텍스트 기반 자동 분류
 */
export function autoCategorize(description: string, existingRules: CategoryRule[] = []): { category?: string; subCategory?: string } | null {
  const allRules = [...DEFAULT_RULES, ...existingRules];
  const lowerDesc = description.toLowerCase();

  for (const rule of allRules) {
    if (rule.keywords.some((keyword) => lowerDesc.includes(keyword.toLowerCase()))) {
      return {
        category: rule.category,
        subCategory: rule.subCategory
      };
    }
  }

  return null;
}

/**
 * 학습 데이터 저장 (사용자가 수동으로 분류한 항목을 학습)
 */
export function learnFromEntry(entry: LedgerEntry): CategoryRule | null {
  if (!entry.description || !entry.category) return null;

  const keywords = entry.description.split(/\s+/).filter((w) => w.length > 1);
  if (keywords.length === 0) return null;

  return {
    keywords,
    category: entry.category,
    subCategory: entry.subCategory
  };
}

/**
 * 저장된 규칙 로드
 */
export function loadSavedRules(): CategoryRule[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = localStorage.getItem("fw-auto-category-rules");
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.warn("[autoCategorization] 저장된 규칙 로드 실패", e);
  }
  return [];
}

/**
 * 규칙 저장
 */
export function saveRules(rules: CategoryRule[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("fw-auto-category-rules", JSON.stringify(rules));
}

/**
 * 항목에 자동 분류 적용
 */
export function applyAutoCategorization(entries: LedgerEntry[]): LedgerEntry[] {
  const savedRules = loadSavedRules();
  return entries.map((entry) => {
    // 이미 카테고리가 있으면 스킵
    if (entry.category) return entry;

    // 설명이 없으면 스킵
    if (!entry.description) return entry;

    // 자동 분류 시도
    const result = autoCategorize(entry.description, savedRules);
    if (result && result.category) {
      return {
        ...entry,
        category: result.category,
        subCategory: result.subCategory
      };
    }

    return entry;
  });
}
