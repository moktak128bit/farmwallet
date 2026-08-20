/**
 * 메모(설명) 기반 카테고리 추천 — 순수 모듈 (React 의존 없음).
 *
 * 과거 가계부 항목을 **현행 3단 스키마**로 정규화해 학습한다:
 *   - 지출: category="지출" / subCategory=대분류 / detailCategory=소분류
 *   - 수입·이체: category="수입"|"이체" / subCategory=실제 분류
 * 레거시(잘못 저장된 cat=대분류 직접 형: cat="식비" sub="시장/마트")은 main=category, sub→detail로 승격해
 * 학습하므로 추천 결과가 그 형태를 재생산하지 않는다.
 *
 * 상호 정규화(normalizeMerchant)로 "스타벅스 강남점" ↔ "신한카드 스타벅스강남2호점 1234" 같은 표기 차이를 흡수한다.
 */
import type { LedgerEntry, LedgerKind } from "../types";
import { parseIsoLocal } from "./date";
import { effectiveSubName } from "./categoryMerge";
import { isCreditPayment } from "./categoryUtils";

export interface Recommendation {
  /** 현행 스키마 대분류 — "지출" | "수입" | "이체" */
  category?: string;
  /** 지출=대분류(식비…), 수입/이체=실제 분류 */
  subCategory?: string;
  /** 지출 소분류 (수입/이체는 항상 undefined) */
  detailCategory?: string;
  fromAccountId?: string;
  toAccountId?: string;
  score: number;
}

/** 정규화된 분류 3단 — 학습 입력 */
interface NormalizedCategory {
  category: string;
  subCategory?: string;
  detailCategory?: string;
}

/** kind 라벨 — category에 이 값이면 현행 스키마 */
const KIND_TOP: Record<LedgerKind, string> = { expense: "지출", income: "수입", transfer: "이체" };
const KIND_LABELS = new Set(Object.values(KIND_TOP));

const trimOrUndef = (s: string | undefined): string | undefined => {
  const t = (s || "").trim();
  return t ? t : undefined;
};

/**
 * 가계부 항목 1건의 분류를 현행 3단 스키마로 정규화.
 *  - 현행(cat=지출/sub=대분류/det=소분류) → 그대로
 *  - 레거시(cat=대분류 직접, sub=소분류, det=∅) → main=category, detail=subCategory (det이 있으면 det 우선)
 *  - 수입/이체: effectiveSubName(subCategory 우선, 없으면 category) → subCategory
 * 특수 스키마(재테크·신용결제 expense)는 현행 일반 지출 경로로 재현할 수 없으므로 null (학습 제외).
 */
export function normalizeLedgerCategory(entry: LedgerEntry): NormalizedCategory | null {
  const top = KIND_TOP[entry.kind];
  if (!top) return null;
  if (entry.kind !== "expense") {
    return { category: top, subCategory: trimOrUndef(effectiveSubName(entry)) };
  }
  if (isCreditPayment(entry) || entry.category === "재테크") return null;
  const cat = (entry.category || "").trim();
  if (!cat || KIND_LABELS.has(cat)) {
    return {
      category: "지출",
      subCategory: trimOrUndef(entry.subCategory),
      detailCategory: trimOrUndef(entry.detailCategory),
    };
  }
  // 레거시: cat=대분류 직접 → sub가 실제 소분류
  return {
    category: "지출",
    subCategory: cat,
    detailCategory: trimOrUndef(entry.detailCategory) ?? trimOrUndef(entry.subCategory),
  };
}

/** 카드사·간편결제 접두 — "신한카드 스타벅스", "카카오페이 GS25" 같은 명세 표기 제거.
 *  "X카드/X페이/X체크/카드" 뒤에 공백·구분자·끝이 와야 한다 ("카드값", "신한은행"은 건드리지 않음). */
const CARD_PREFIX_RE = /^(?:[a-z가-힣]{1,6}\s*(?:카드|페이|체크카드|체크|card)|카드)(?:\s+|\s*[:\-_/|]\s*|$)/i;
/** 법인 표기 */
const CORP_RE = /\(주\)|\(유\)|㈜|주식회사|유한회사|(?<![a-z])(?:co\.?,?\s*ltd\.?|inc\.?|llc)(?![a-z])/gi;
/** N호점 / N점 (숫자 포함 지점) — 앞 공백까지 먹고 '점'으로 접어 "강남 2호점"→"강남점"(꼬리 지점 토큰 규칙으로 제거),
 *  "스타벅스강남2호점"→"스타벅스강남점"(키 비교의 접두 관계로 흡수) */
const NUMBERED_BRANCH_RE = /\s*\d+\s*호?점/g;
/** 꼬리 "점" 토큰 — 일반명사(편의점 등)는 보존 */
const BRANCH_STOP = new Set([
  "편의점", "음식점", "서점", "매점", "상점", "백화점", "할인점", "면세점", "문구점", "반점", "빵점", "안경점", "정육점", "제과점",
]);

/** 상호 토큰 정규화 — 소문자, 카드사 접두·법인 표기·지점·숫자·기호 제거 후 토큰 배열 */
export function normalizeMerchantTokens(raw: string): string[] {
  let s = (raw || "").toLowerCase().trim();
  if (!s) return [];
  s = s.replace(CARD_PREFIX_RE, "");
  s = s.replace(CORP_RE, " ");
  s = s.replace(NUMBERED_BRANCH_RE, "점");
  s = s.replace(/[0-9０-９]+/g, " ");
  // 기호 → 공백 (한글·영문만 남김)
  s = s.replace(/[^\p{L}\s]+/gu, " ");
  let tokens = s.split(/\s+/).filter(Boolean);
  // 띄어 쓴 지점 토큰: "스타벅스 강남점"/"… 본점" — 마지막 토큰이 '점'으로 끝나고 일반명사가 아니면 제거
  // (토큰이 그 하나뿐이면 상호 자체로 간주해 보존). 붙여 쓴 "스타벅스강남점"은 키 비교 시 접두 관계로 흡수.
  if (tokens.length >= 2) {
    const last = tokens[tokens.length - 1];
    if (last.length >= 2 && last.endsWith("점") && !BRANCH_STOP.has(last)) tokens = tokens.slice(0, -1);
  }
  return tokens;
}

/** 상호 정규화 문자열 — 토큰을 공백 없이 이어 붙인 비교 키 */
export function normalizeMerchant(raw: string): string {
  return normalizeMerchantTokens(raw).join("");
}

const recKey = (n: NormalizedCategory, from?: string, to?: string): string =>
  `${n.category}:${n.subCategory || ""}:${n.detailCategory || ""}:${from || ""}:${to || ""}`;

/** 붙여 쓴 지점 변형 — "스타벅스" ↔ "스타벅스강남점"/"스타벅스역삼역점" (접두 + 1~5글자 + '점') */
const BRANCH_TAIL_RE = /^\p{L}{1,5}점$/u;
function isBranchVariant(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 2 || !long.startsWith(short)) return false;
  const tail = long.slice(short.length);
  return BRANCH_TAIL_RE.test(tail) && !BRANCH_STOP.has(tail);
}

/** 설명 유사도 (0~0.8) — 정규화 상호 완전 일치 > 부분 포함 + 토큰 겹침 */
function descriptionSimilarity(
  descTokens: string[],
  descKey: string,
  entryDescription: string
): number {
  const entryTokens = normalizeMerchantTokens(entryDescription);
  const entryKey = entryTokens.join("");
  if (!descKey || !entryKey) return 0;
  if (descKey === entryKey || isBranchVariant(descKey, entryKey)) return 0.8;
  let similarity = 0;
  const common = descTokens.filter((w) => entryTokens.includes(w));
  similarity += (common.length / Math.max(descTokens.length, entryTokens.length)) * 0.5;
  // 부분 문자열 일치 (2글자 이상일 때만 — 1글자 포함은 잡음)
  if (descKey.length >= 2 && entryKey.length >= 2 && (entryKey.includes(descKey) || descKey.includes(entryKey))) {
    similarity += 0.3;
  }
  return similarity;
}

export function recommendCategory(
  description: string,
  amount: number,
  kind: LedgerKind,
  ledger: LedgerEntry[]
): Recommendation[] {
  if (!description || description.length < 2) return [];

  const descTokens = normalizeMerchantTokens(description);
  const descKey = descTokens.join("");
  if (!descKey) return [];

  const recommendations = new Map<string, Recommendation>();
  const frequencyMap = new Map<string, number>();
  const recentMap = new Map<string, string>();

  for (const entry of ledger) {
    if (entry.kind !== kind) continue;
    const normalized = normalizeLedgerCategory(entry);
    if (!normalized) continue;
    const key = recKey(normalized, entry.fromAccountId, entry.toAccountId);

    // 사용 빈도·최근 사용일 (설명과 무관하게 같은 분류 조합 전체)
    frequencyMap.set(key, (frequencyMap.get(key) || 0) + 1);
    const lastSeen = recentMap.get(key);
    if (!lastSeen || entry.date > lastSeen) recentMap.set(key, entry.date);

    if (!entry.description || entry.description.length < 2) continue;
    const similarity = descriptionSimilarity(descTokens, descKey, entry.description);
    if (similarity <= 0) continue;

    // 금액 범위 유사도 (같은 범위대면 가중치 추가)
    const amountDiff = Math.abs(entry.amount - amount);
    const amountSimilarity = amountDiff < amount * 0.1 ? 0.2 : amountDiff < amount * 0.5 ? 0.1 : 0;
    const totalScore = similarity + amountSimilarity;
    if (totalScore <= 0.3) continue;

    const existing = recommendations.get(key);
    if (!existing || existing.score < totalScore) {
      recommendations.set(key, {
        category: normalized.category,
        subCategory: normalized.subCategory,
        detailCategory: normalized.detailCategory,
        fromAccountId: entry.fromAccountId,
        toAccountId: entry.toAccountId,
        score: totalScore,
      });
    }
  }

  const now = new Date();
  const finalRecommendations = Array.from(recommendations.entries()).map(([key, rec]) => {
    const frequency = frequencyMap.get(key) || 0;
    const lastUsed = recentMap.get(key) || "";
    // new Date("YYYY-MM-DD")는 UTC 파싱(금지) — parseIsoLocal로 로컬 자정 기준 (분류 모듈 KST 통일)
    const lastUsedDate = lastUsed ? parseIsoLocal(lastUsed) ?? new Date(0) : new Date(0);
    const daysSince = (now.getTime() - lastUsedDate.getTime()) / (1000 * 60 * 60 * 24);

    // 빈도 가중치 (최대 0.2)
    const freqWeight = Math.min(frequency / 10, 0.2);
    // 최근성 가중치 (30일 이내면 0.1, 90일 이내 0.05, 그 외 0)
    const recencyWeight = daysSince < 30 ? 0.1 : daysSince < 90 ? 0.05 : 0;

    return { ...rec, score: rec.score + freqWeight + recencyWeight };
  });

  // 점수 순 정렬, 상위 5개
  return finalRecommendations.sort((a, b) => b.score - a.score).slice(0, 5);
}
