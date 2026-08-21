/**
 * 가계부 메인 폼 드래프트 직렬화/복원 — 순수 함수 (저장소 접근 없음).
 *
 * 탭 전환 시 LedgerView가 언마운트돼(App.tsx) 입력 중 내용이 사라지는 것을 막기 위해
 * 폼 상태를 sessionStorage(STORAGE_KEYS.LEDGER_FORM_DRAFT, 탭별·멀티탭 충돌 없음)에 보관한다.
 *  - 수정 모드(form.id 있음)는 저장·복원 모두 제외 (stale edit 제출 위험)
 *  - 금액·설명 중 하나라도 있어야 드래프트로 본다 (카테고리만 누른 상태는 저장 안 함)
 *  - 필터 상태는 저장하지 않는다 (폼만)
 *  - 24시간 지나면 만료
 * AppData와 무관 — 저장 형태(LedgerEntry)에 관여하지 않는다.
 */
import type { LedgerFormState } from "./ledgerHelpers";
import type { LedgerTab } from "../features/ledger/LedgerEntryForm";

export const LEDGER_FORM_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DRAFT_VERSION = 1;

const LEDGER_TABS: readonly LedgerTab[] = ["all", "income", "expense", "savingsExpense", "transfer", "creditPayment"];

export interface LedgerFormDraft {
  form: LedgerFormState;
  ledgerTab: LedgerTab;
  /** "전체" 탭에서의 입력 kind (formKindWhenAll) */
  formKind: "income" | "expense" | "transfer";
}

interface DraftEnvelope {
  v: number;
  savedAt: number;
  draft: LedgerFormDraft;
}

/** 금액·설명 중 하나라도 있으면 드래프트로 본다 */
export function hasLedgerDraftContent(form: Pick<LedgerFormState, "amount" | "description">): boolean {
  return !!((form.amount || "").trim() || (form.description || "").trim());
}

/**
 * 드래프트 직렬화. 저장하지 말아야 하면 null(호출 측은 기존 드래프트를 삭제).
 *  - 수정 모드(form.id) → null
 *  - 내용 없음 → null
 */
export function serializeLedgerFormDraft(draft: LedgerFormDraft, now: number): string | null {
  if (draft.form.id) return null;
  if (!hasLedgerDraftContent(draft.form)) return null;
  const envelope: DraftEnvelope = {
    v: DRAFT_VERSION,
    savedAt: now,
    draft: {
      form: { ...draft.form, id: undefined },
      ledgerTab: draft.ledgerTab,
      formKind: draft.formKind,
    },
  };
  return JSON.stringify(envelope);
}

const isStr = (v: unknown): v is string => typeof v === "string";
const isKind = (v: unknown): v is "income" | "expense" | "transfer" =>
  v === "income" || v === "expense" || v === "transfer";

/**
 * 드래프트 파싱. 손상 JSON·버전 불일치·만료·수정 모드·내용 없음 → null.
 * form 필드는 문자열만 받아들이고 나머지는 기본값으로 보정한다(손상 필드가 폼에 그대로 들어가지 않게).
 */
export function parseLedgerFormDraft(raw: string | null | undefined, now: number): LedgerFormDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const env = parsed as Partial<DraftEnvelope>;
  if (env.v !== DRAFT_VERSION) return null;
  if (typeof env.savedAt !== "number" || !Number.isFinite(env.savedAt)) return null;
  if (now - env.savedAt > LEDGER_FORM_DRAFT_MAX_AGE_MS || env.savedAt > now + 60_000) return null;
  const d = env.draft;
  if (!d || typeof d !== "object") return null;
  const f = (d as Partial<LedgerFormDraft>).form as Partial<LedgerFormState> | undefined;
  if (!f || typeof f !== "object") return null;
  if (f.id) return null; // 수정 모드 드래프트는 복원하지 않음
  const ledgerTab = (d as Partial<LedgerFormDraft>).ledgerTab;
  const formKind = (d as Partial<LedgerFormDraft>).formKind;
  if (!isStr(ledgerTab) || !(LEDGER_TABS as readonly string[]).includes(ledgerTab)) return null;
  if (!isKind(formKind)) return null;
  const kind = isKind(f.kind) ? f.kind : formKind;
  const form: LedgerFormState = {
    id: undefined,
    date: isStr(f.date) ? f.date : "",
    kind,
    isFixedExpense: f.isFixedExpense === true,
    mainCategory: isStr(f.mainCategory) ? f.mainCategory : "",
    subCategory: isStr(f.subCategory) ? f.subCategory : "",
    description: isStr(f.description) ? f.description : "",
    fromAccountId: isStr(f.fromAccountId) ? f.fromAccountId : "",
    toAccountId: isStr(f.toAccountId) ? f.toAccountId : "",
    amount: isStr(f.amount) ? f.amount : "",
    discountAmount: isStr(f.discountAmount) ? f.discountAmount : "",
    currency: f.currency === "USD" ? "USD" : "KRW",
    tags: Array.isArray(f.tags) ? f.tags.filter(isStr) : [],
  };
  if (!hasLedgerDraftContent(form)) return null;
  return { form, ledgerTab: ledgerTab as LedgerTab, formKind };
}
