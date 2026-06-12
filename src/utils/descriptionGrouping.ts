import type { LedgerEntry } from "../types";

/**
 * 가계부 항목들의 description을 유사한 것끼리 묶는 도구.
 *
 * 목적: 같은 의미인데 오타·표기 다름으로 분리된 description들 (예: 휘발유/휘발류/기름값)을
 * 사용자가 한 번에 통합할 수 있도록 그룹 후보를 제안.
 *
 * 정책:
 *  - 같은 (kind, category, subCategory) 조합 안에서만 묶음 — 다른 카테고리끼리 섞이면 의미 손실
 *  - 빈 description은 그룹핑에서 제외 (사용자가 직접 채워야 할 별도 작업)
 *  - 단일 항목 그룹은 반환에서 제외 (통합할 게 없으므로)
 *
 * 모든 함수는 순수함수 — 입력만으로 출력 결정, side-effect 없음.
 */

/**
 * 두 문자열의 Levenshtein 편집거리 계산.
 * - 모두 trim 후 lowercase 정규화한 입력 가정 (호출 측에서 처리)
 * - O(m*n) 시간/공간. description 길이는 짧으므로 충분.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // 두 행만 유지하는 메모리 최적화 — description은 짧지만 안전하게.
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * description 정규화 — 그룹핑 비교용.
 * - trim, lowercase
 * - "[원래소분류:...]" 같은 메타 태그 제거 (실제 표시 description은 보존하되 비교만 정규화)
 * - 공백 단일화
 */
export function normalizeForGrouping(s: string): string {
  return s
    .replace(/\[[^\]]*\]/g, "")    // [원래소분류:xxx] 같은 태그 제거
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * 두 description이 "유사"한지 판정 — false positive 보수적 회피.
 *  - 정규화 후 정확히 같으면 → true
 *  - 한 쪽이 다른 쪽을 포함하면 (예: "휘발유 카드결제" ⊃ "휘발유", 짧은 쪽 ≥ 2자) → true
 *  - 둘 다 ≥ 4자일 때만 편집거리 ≤ maxDistance 적용
 *  - 짧은 단어(≤ 3자)는 편집거리로 묶지 않음 — "세차비" vs "주차비"(거리 1) 같은
 *    의미상 완전히 다른 한국어 단어를 거짓 매칭하지 않기 위함.
 *    휘발유/휘발류 같은 진짜 오타는 자동 감지 못 하지만, 모달의 "다른 변형 추가"로 수동 처리 가능.
 */
export function areSimilar(a: string, b: string, maxDistance = 2): boolean {
  const na = normalizeForGrouping(a);
  const nb = normalizeForGrouping(b);
  if (na === nb) return true;
  if (na.length === 0 || nb.length === 0) return false;
  // 포함 관계 (짧은 쪽 ≥ 2자) — "스타벅스 강남점" ⊃ "스타벅스" 같은 케이스 잡기
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length >= 2 && longer.includes(shorter)) return true;
  // 편집거리는 둘 다 4자 이상일 때만 — 짧은 한국어 단어 false positive 방지
  if (na.length < 4 || nb.length < 4) return false;
  return levenshtein(na, nb) <= maxDistance;
}

export interface DescriptionVariant {
  /** 원본 description (사용자에게 보여주는 그대로) */
  description: string;
  count: number;
  totalAmount: number;
  /** 이 description이 들어간 ledger 항목들의 id (bulk update 시 사용) */
  ledgerIds: string[];
}

export interface DescriptionGroup {
  /** 그룹의 카테고리 컨텍스트 — UI에서 "유류교통비 (3개 변형)" 식으로 표시 */
  kind: string;
  category: string;
  subCategory: string;
  /** "kind|category|subCategory" — getOtherVariantsInContext 조회 키. */
  contextKey: string;
  /** 묶인 description 변형들 (count 큰 순) */
  variants: DescriptionVariant[];
  /** 그룹 합계 통계 */
  totalCount: number;
  totalAmount: number;
  /** 가장 자주 나오는 description — UI에서 "통합할 이름" 기본값으로 사용 */
  suggestedCanonical: string;
}

/** (kind, category, subCategory)별 모든 distinct description 변형 — 수동 추가용. */
type VariantsByContext = Map<string, DescriptionVariant[]>;

/**
 * ledger 전체에서 유사 description 그룹들을 추출.
 *
 * @param ledger 전체 가계부 항목 (필터링 안 됨)
 * @param maxDistance 편집거리 임계값 (기본 2)
 *
 * 반환: 각 (kind, category, subCategory) 안에서 유사한 description끼리 묶인 그룹들.
 *  - 단일 description 그룹은 제외 (통합할 게 없으므로)
 *  - 그룹 내 totalAmount 큰 순으로 정렬
 */
export function findDescriptionGroups(
  ledger: LedgerEntry[],
  maxDistance = 2
): DescriptionGroup[] {
  // 1. (kind, category, subCategory) 별로 description 변형 수집
  type Bucket = Map<string, DescriptionVariant>;
  const byContext = new Map<string, Bucket>();

  for (const l of ledger) {
    const desc = (l.description || "").trim();
    if (!desc) continue;
    const ctxKey = `${l.kind}|${l.category || ""}|${l.subCategory || ""}`;
    if (!byContext.has(ctxKey)) byContext.set(ctxKey, new Map());
    const bucket = byContext.get(ctxKey)!;
    if (!bucket.has(desc)) {
      bucket.set(desc, { description: desc, count: 0, totalAmount: 0, ledgerIds: [] });
    }
    const v = bucket.get(desc)!;
    v.count++;
    v.totalAmount += Number(l.amount);
    v.ledgerIds.push(l.id);
  }

  // 2. 각 컨텍스트 안에서 유사 description끼리 묶기 (union-find 스타일)
  const groups: DescriptionGroup[] = [];
  for (const [ctxKey, bucket] of byContext) {
    const [kind, category, subCategory] = ctxKey.split("|");
    const variants = Array.from(bucket.values());
    if (variants.length < 2) continue;

    const visited = new Set<string>();
    for (let i = 0; i < variants.length; i++) {
      if (visited.has(variants[i].description)) continue;
      const cluster: DescriptionVariant[] = [variants[i]];
      visited.add(variants[i].description);
      for (let j = i + 1; j < variants.length; j++) {
        if (visited.has(variants[j].description)) continue;
        // 클러스터 내 어떤 항목과도 유사하면 합류
        if (cluster.some((c) => areSimilar(c.description, variants[j].description, maxDistance))) {
          cluster.push(variants[j]);
          visited.add(variants[j].description);
        }
      }
      if (cluster.length < 2) continue;
      cluster.sort((a, b) => b.count - a.count);
      const totalCount = cluster.reduce((s, v) => s + v.count, 0);
      const totalAmount = cluster.reduce((s, v) => s + v.totalAmount, 0);
      groups.push({
        kind,
        category,
        subCategory,
        contextKey: ctxKey,
        variants: cluster,
        totalCount,
        totalAmount,
        suggestedCanonical: cluster[0].description,
      });
    }
  }

  // 합산 금액 큰 순으로 정렬 — 사용자가 임팩트 큰 것부터 처리
  groups.sort((a, b) => b.totalAmount - a.totalAmount);
  return groups;
}

/**
 * 가계부 전체에서 (kind, category, subCategory)별 distinct description 변형 맵 생성.
 *
 * 자동 그룹핑이 못 잡는 케이스(예: 휘발유/휘발류는 짧은 단어라 보수적 알고리즘에서 제외됨)를
 * 사용자가 수동으로 추가할 수 있게 하기 위함. UI는 contextKey로 조회.
 */
export function buildVariantsByContext(ledger: LedgerEntry[]): VariantsByContext {
  const out: VariantsByContext = new Map();
  const buckets = new Map<string, Map<string, DescriptionVariant>>();
  for (const l of ledger) {
    const desc = (l.description || "").trim();
    if (!desc) continue;
    const ctxKey = `${l.kind}|${l.category || ""}|${l.subCategory || ""}`;
    if (!buckets.has(ctxKey)) buckets.set(ctxKey, new Map());
    const bucket = buckets.get(ctxKey)!;
    if (!bucket.has(desc)) {
      bucket.set(desc, { description: desc, count: 0, totalAmount: 0, ledgerIds: [] });
    }
    const v = bucket.get(desc)!;
    v.count++;
    v.totalAmount += Number(l.amount);
    v.ledgerIds.push(l.id);
  }
  for (const [k, bucket] of buckets) {
    out.set(k, Array.from(bucket.values()).sort((a, b) => b.count - a.count));
  }
  return out;
}

/**
 * 선택된 ledgerIds의 description을 canonical로 일괄 변경한 새 ledger 배열 반환.
 * 원본은 변경하지 않음 (불변 업데이트).
 *
 * @param ledger 원본 ledger
 * @param ledgerIds 변경할 항목 id Set
 * @param canonical 새 description 값 (이미 trim 권장)
 */
export function applyDescriptionMerge(
  ledger: LedgerEntry[],
  ledgerIds: Set<string>,
  canonical: string
): LedgerEntry[] {
  const trimmed = canonical.trim();
  if (!trimmed) return ledger;
  return ledger.map((l) =>
    ledgerIds.has(l.id) && l.description !== trimmed ? { ...l, description: trimmed } : l
  );
}
