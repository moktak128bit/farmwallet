/**
 * 빠른 입력(QuickEntryModal) 저장 객체 빌더 — 순수 모듈 (React 의존 없음).
 *
 * LedgerEntryForm.submitForm의 3단 저장 형태와 **동일한 모양**으로 LedgerEntry를 만든다:
 *   - 지출: category="지출" / subCategory=대분류(없으면 "(미분류)") / detailCategory=소분류(있을 때만 키 존재)
 *   - 수입: category="수입" / subCategory=분류(없으면 "(미분류)") / detailCategory 없음 / toAccountId만
 *   - 이체: category="이체" / subCategory=분류(없으면 "(미분류)") / detailCategory 없음 / from·to 둘 다
 * (폼 코드는 건드리지 않고 quickEntryBuild.test.ts가 형태 일치를 고정한다.)
 */
import type { LedgerEntry, LedgerKind } from "../types";
import type { Recommendation } from "./categoryRecommendation";

interface QuickEntryParsed {
  description: string;
  amount: number;
  kind: LedgerKind;
}

/** 추천이 없을 때 폼 저장 경로와 동일한 대분류 (category="" 저장 방지) */
const fallbackCategoryOf = (kind: LedgerKind): string =>
  kind === "income" ? "수입" : kind === "transfer" ? "이체" : "지출";

type QuickEntryAccounts =
  | { ok: true; fromAccountId?: string; toAccountId?: string }
  | { ok: false; reason: "transfer-needs-both" };

/**
 * kind별 계좌 결정 — 지출=출금만, 수입=입금만, 이체=출금·입금 둘 다.
 * 이체는 빠른 입력으로 입금 계좌를 정할 수 없으면(추천에 없음·동일 계좌) 거부.
 */
export function resolveQuickEntryAccounts(
  kind: LedgerKind,
  recommendation: Pick<Recommendation, "fromAccountId" | "toAccountId"> | null,
  defaultAccountId: string | undefined
): QuickEntryAccounts {
  if (kind === "income") return { ok: true, toAccountId: defaultAccountId };
  if (kind === "transfer") {
    const fromAccountId = recommendation?.fromAccountId ?? defaultAccountId;
    const toAccountId = recommendation?.toAccountId;
    if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) {
      return { ok: false, reason: "transfer-needs-both" };
    }
    return { ok: true, fromAccountId, toAccountId };
  }
  return { ok: true, fromAccountId: defaultAccountId };
}

interface QuickEntryDefaults {
  id: string;
  /** YYYY-MM-DD (KST) */
  date: string;
  fromAccountId?: string;
  toAccountId?: string;
}

/** 추천 결과에서 저장할 분류 3단 — 폼의 storedCategory/storedSubCategory/storedDetailCategory 매핑과 동일 */
export function quickEntryStoredCategory(
  kind: LedgerKind,
  recommendation: Pick<Recommendation, "subCategory" | "detailCategory"> | null
): { category: string; subCategory: string; detailCategory?: string } {
  const sub = (recommendation?.subCategory || "").trim() || "(미분류)";
  if (kind === "expense") {
    const detail = (recommendation?.detailCategory || "").trim();
    return { category: "지출", subCategory: sub, ...(detail ? { detailCategory: detail } : {}) };
  }
  return { category: fallbackCategoryOf(kind), subCategory: sub };
}

/** 빠른 입력 저장 객체 — LedgerEntryForm.submitForm의 base와 같은 키 구성 */
export function buildQuickEntryLedgerEntry(
  parsed: QuickEntryParsed,
  recommendation: Recommendation | null,
  defaults: QuickEntryDefaults
): LedgerEntry {
  const stored = quickEntryStoredCategory(parsed.kind, recommendation);
  return {
    id: defaults.id,
    date: defaults.date,
    kind: parsed.kind,
    isFixedExpense: false,
    category: stored.category,
    subCategory: stored.subCategory,
    ...(stored.detailCategory ? { detailCategory: stored.detailCategory } : {}),
    description: parsed.description.trim(),
    amount: parsed.amount,
    fromAccountId:
      parsed.kind === "expense" || parsed.kind === "transfer" ? defaults.fromAccountId || undefined : undefined,
    toAccountId:
      parsed.kind === "income" || parsed.kind === "transfer" ? defaults.toAccountId || undefined : undefined,
  };
}
