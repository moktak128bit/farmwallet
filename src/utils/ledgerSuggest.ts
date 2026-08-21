/**
 * 가계부 설명(상세내역) 자동완성 인덱스 — 순수 모듈 (React 의존 없음).
 *
 * 과거 항목을 (kind, 정규화 상호) 단위로 묶어 빈도·최근성·최빈 분류/계좌 조합을 기록한다.
 *  - 설명 정규화: categoryRecommendation.normalizeMerchant (카드사 접두·지점·숫자 흡수)
 *  - 분류 정규화: categoryRecommendation.normalizeLedgerCategory (레거시 2단 → 현행 3단)
 * 메인 폼(LedgerEntryForm)의 설명 Autocomplete와 '최근 거래' 칩이 소비한다.
 * 읽기 전용 — 저장 형태에 관여하지 않는다.
 */
import type { LedgerEntry, LedgerKind } from "../types";
import { getTodayKST, parseIsoLocal } from "./date";
import { normalizeLedgerCategory, normalizeMerchant } from "./categoryRecommendation";

/** 설명 그룹 1건 — 자동완성 후보이자 최근 거래 칩의 원천 */
export interface DescriptionSuggestion {
  /** 표시용 설명 — 그룹에서 가장 최근 항목의 원문 */
  description: string;
  kind: LedgerKind;
  /** 같은 설명(정규화)·kind 항목 수 */
  count: number;
  /** 가장 최근 날짜 (YYYY-MM-DD) */
  lastDate: string;
  /** 가장 최근 항목 — '최근 거래' 칩의 startCopy 입력 (저장 스키마 원형 그대로) */
  lastEntry: LedgerEntry;
  /** 최빈 분류 — 현행 3단 스키마 (지출: subCategory=대분류·detailCategory=소분류 / 수입·이체: subCategory=분류) */
  category?: string;
  subCategory?: string;
  detailCategory?: string;
  /** 최빈 분류 조합에 동반된 계좌 */
  fromAccountId?: string;
  toAccountId?: string;
  /** 최빈 조합의 횟수 (토스트 '지난 N회' 용) */
  comboCount: number;
}

interface DescriptionIndex {
  /** 그룹 목록 (순서 비보장 — 조회 함수가 정렬) */
  groups: DescriptionSuggestion[];
}

interface ComboStat {
  count: number;
  lastDate: string;
  category?: string;
  subCategory?: string;
  detailCategory?: string;
  fromAccountId?: string;
  toAccountId?: string;
}

interface GroupBuild {
  description: string;
  kind: LedgerKind;
  count: number;
  lastDate: string;
  lastEntry: LedgerEntry;
  combos: Map<string, ComboStat>;
}

const trimOrUndef = (s: string | undefined): string | undefined => {
  const t = (s || "").trim();
  return t ? t : undefined;
};

/** 그룹 키 — 정규화 상호가 비면(숫자·기호만인 설명) 소문자 원문으로 폴백 */
export function descriptionGroupKey(description: string): string {
  const raw = (description || "").trim();
  if (!raw) return "";
  const norm = normalizeMerchant(raw);
  return norm || raw.toLowerCase();
}

/** 가계부 전체에서 설명 인덱스 구축. 설명이 빈 항목은 제외. */
export function buildDescriptionIndex(ledger: ReadonlyArray<LedgerEntry>): DescriptionIndex {
  const map = new Map<string, GroupBuild>();
  for (const entry of ledger) {
    const key = descriptionGroupKey(entry.description);
    if (!key) continue;
    const k = `${entry.kind}|${key}`;
    let g = map.get(k);
    const date = entry.date || "";
    if (!g) {
      g = {
        description: entry.description.trim(),
        kind: entry.kind,
        count: 0,
        lastDate: date,
        lastEntry: entry,
        combos: new Map(),
      };
      map.set(k, g);
    }
    g.count += 1;
    if (date >= g.lastDate) {
      g.lastDate = date;
      g.lastEntry = entry;
      g.description = entry.description.trim();
    }
    const normalized = normalizeLedgerCategory(entry);
    if (!normalized) continue; // 재테크·신용결제 특수 스키마는 분류 채움 대상 아님 (빈도·최근성만 반영)
    const from = trimOrUndef(entry.fromAccountId);
    const to = trimOrUndef(entry.toAccountId);
    const comboKey = [normalized.category, normalized.subCategory || "", normalized.detailCategory || "", from || "", to || ""].join("|");
    const c = g.combos.get(comboKey);
    if (c) {
      c.count += 1;
      if (date > c.lastDate) c.lastDate = date;
    } else {
      g.combos.set(comboKey, {
        count: 1,
        lastDate: date,
        category: normalized.category,
        subCategory: normalized.subCategory,
        detailCategory: normalized.detailCategory,
        fromAccountId: from,
        toAccountId: to,
      });
    }
  }

  const groups: DescriptionSuggestion[] = [];
  for (const g of map.values()) {
    // 최빈 조합 — 횟수 desc → 최근 desc
    let best: ComboStat | undefined;
    for (const c of g.combos.values()) {
      if (!best || c.count > best.count || (c.count === best.count && c.lastDate > best.lastDate)) best = c;
    }
    groups.push({
      description: g.description,
      kind: g.kind,
      count: g.count,
      lastDate: g.lastDate,
      lastEntry: g.lastEntry,
      category: best?.category,
      subCategory: best?.subCategory,
      detailCategory: best?.detailCategory,
      fromAccountId: best?.fromAccountId,
      toAccountId: best?.toAccountId,
      comboCount: best?.count ?? 0,
    });
  }
  return { groups };
}

interface SuggestOptions {
  limit?: number;
  /** 기준일 YYYY-MM-DD (기본 오늘 KST) — 테스트 결정성 */
  today?: string;
}

const daysBetween = (from: string, to: string): number => {
  const a = parseIsoLocal(from);
  const b = parseIsoLocal(to);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
};

/** 최근성 계수 — 30일 내 1.0, 90일 내 0.7, 1년 내 0.5, 그 외 0.3 */
const recencyFactor = (lastDate: string, today: string): number => {
  const d = daysBetween(lastDate, today);
  return d <= 30 ? 1 : d <= 90 ? 0.7 : d <= 365 ? 0.5 : 0.3;
};

/**
 * 접두/부분 일치 설명 추천 — 빈도 × 최근성 (접두 일치는 1.5배). kind가 다른 그룹은 제외.
 * prefix가 비면 [] (포커스만으로 전부 펼치지 않음).
 */
export function suggestDescriptions(
  index: DescriptionIndex,
  prefix: string,
  kind: LedgerKind,
  options: SuggestOptions = {}
): DescriptionSuggestion[] {
  const limit = options.limit ?? 8;
  const today = options.today ?? getTodayKST();
  const q = (prefix || "").trim().toLowerCase();
  if (!q) return [];
  const qNorm = normalizeMerchant(q);
  const scored: { s: DescriptionSuggestion; score: number }[] = [];
  for (const s of index.groups) {
    if (s.kind !== kind) continue;
    const descLower = s.description.toLowerCase();
    const descNorm = normalizeMerchant(s.description);
    // 원문 기준 정확 일치(이미 다 입력)도 후보로 두어 선택 시 빈 필드 채움이 가능하게 한다
    const starts = descLower.startsWith(q) || (!!qNorm && descNorm.startsWith(qNorm));
    const contains = starts || descLower.includes(q) || (!!qNorm && descNorm.includes(qNorm));
    if (!contains) continue;
    const score = s.count * recencyFactor(s.lastDate, today) * (starts ? 1.5 : 1);
    scored.push({ s, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (b.s.lastDate > a.s.lastDate ? 1 : b.s.lastDate < a.s.lastDate ? -1 : 0) ||
      a.s.description.localeCompare(b.s.description)
  );
  return scored.slice(0, limit).map((x) => x.s);
}

interface RecentOptions {
  days?: number;
  limit?: number;
  today?: string;
}

/** 최근 N일(기본 30) 안에 쓰인 설명 그룹 — 횟수 desc → 최근 desc, 상위 limit(기본 6). kind 무관. */
export function recentDescriptionGroups(
  index: DescriptionIndex,
  options: RecentOptions = {}
): DescriptionSuggestion[] {
  const days = options.days ?? 30;
  const limit = options.limit ?? 6;
  const today = options.today ?? getTodayKST();
  return index.groups
    .filter((g) => daysBetween(g.lastDate, today) <= days)
    .sort(
      (a, b) =>
        b.count - a.count ||
        (b.lastDate > a.lastDate ? 1 : b.lastDate < a.lastDate ? -1 : 0) ||
        a.description.localeCompare(b.description)
    )
    .slice(0, limit);
}

/** 폼에 채울 수 있는 필드 (LedgerFormState의 부분집합) */
interface SuggestionFormFields {
  mainCategory: string;
  subCategory: string;
  fromAccountId: string;
  toAccountId: string;
}

/**
 * 추천 그룹의 최빈 분류 → 폼 필드 매핑 (저장 스키마 → 폼 스키마, startCopy와 동일 규칙).
 *  - 지출: mainCategory=subCategory(대분류), subCategory=detailCategory(소분류), fromAccountId
 *  - 수입: subCategory=분류, toAccountId
 *  - 이체: mainCategory="이체", subCategory=분류, from·to
 */
export function suggestionToFormFields(s: Pick<DescriptionSuggestion, "kind" | "subCategory" | "detailCategory" | "fromAccountId" | "toAccountId">): SuggestionFormFields {
  if (s.kind === "expense") {
    return {
      mainCategory: s.subCategory || "",
      subCategory: s.detailCategory || "",
      fromAccountId: s.fromAccountId || "",
      toAccountId: "",
    };
  }
  if (s.kind === "income") {
    return { mainCategory: "", subCategory: s.subCategory || "", fromAccountId: "", toAccountId: s.toAccountId || "" };
  }
  return {
    mainCategory: "이체",
    subCategory: s.subCategory || "",
    fromAccountId: s.fromAccountId || "",
    toAccountId: s.toAccountId || "",
  };
}

interface FillEmptyResult {
  next: SuggestionFormFields;
  /** 실제로 채워진 필드 (비어 있던 것만) — 비면 토스트 생략 */
  applied: (keyof SuggestionFormFields)[];
}

/**
 * 비어 있는 필드만 추천값으로 채운다 — 사용자가 이미 고른 값은 절대 덮지 않는다.
 * 지출 소분류는 대분류가 추천값과 같거나 비어 있을 때만 채움(다른 대분류의 소분류가 섞이는 것 방지).
 */
export function fillEmptyFormFields(
  current: SuggestionFormFields,
  suggestion: Pick<DescriptionSuggestion, "kind" | "subCategory" | "detailCategory" | "fromAccountId" | "toAccountId">
): FillEmptyResult {
  const rec = suggestionToFormFields(suggestion);
  const next: SuggestionFormFields = { ...current };
  const applied: (keyof SuggestionFormFields)[] = [];
  const mainEmpty = !(current.mainCategory || "").trim();
  if (mainEmpty && rec.mainCategory) {
    next.mainCategory = rec.mainCategory;
    applied.push("mainCategory");
  }
  const subEmpty = !(current.subCategory || "").trim();
  const mainCompatible = suggestion.kind !== "expense" || mainEmpty || current.mainCategory === rec.mainCategory;
  if (subEmpty && rec.subCategory && mainCompatible) {
    next.subCategory = rec.subCategory;
    applied.push("subCategory");
  }
  if (!(current.fromAccountId || "").trim() && rec.fromAccountId) {
    next.fromAccountId = rec.fromAccountId;
    applied.push("fromAccountId");
  }
  if (!(current.toAccountId || "").trim() && rec.toAccountId) {
    next.toAccountId = rec.toAccountId;
    applied.push("toAccountId");
  }
  return { next, applied };
}

/** 추천 그룹의 분류·계좌 요약 라벨 — "식비>카페 · 신한" (토스트·드롭다운 보조 라벨) */
export function describeSuggestion(
  s: Pick<DescriptionSuggestion, "kind" | "subCategory" | "detailCategory" | "fromAccountId" | "toAccountId">
): string {
  const cat = [s.subCategory, s.detailCategory].filter(Boolean).join(">");
  const acct = s.kind === "transfer"
    ? [s.fromAccountId, s.toAccountId].filter(Boolean).join("→")
    : s.kind === "income"
      ? s.toAccountId || ""
      : s.fromAccountId || "";
  return [cat, acct].filter(Boolean).join(" · ");
}
