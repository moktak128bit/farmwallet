/**
 * 가계부 선택 항목 일괄 편집 — 순수 모듈 (React 의존 없음).
 *
 * 변경 가능한 필드: 분류(대분류/중분류/소분류), 출금/입금 계좌, 날짜 이동(±일·±월), 태그 추가/제거, 고정지출 플래그.
 * 변경 불가(패치 타입에 아예 없음): kind, amount, currency, discountAmount, settledLedgerIds, loanId.
 *
 * 제외 규칙(테스트로 고정):
 *  - 주식 가상 행(_tradeId) / 선택 id가 원본 가계부에 없는 항목 → 전체 제외
 *  - 분류 변경: 재테크(저축·투자이체, 투자수익/손실, 배당, 이자, 저축성지출) · 정산 · 환전 · 카드결제이체/신용결제 제외,
 *    patch.category.kind와 다른 kind 제외 (식비를 수입에 붙이는 사고 방지)
 *  - 계좌 변경: 정산 항목(정산 분류 또는 settledLedgerIds 보유) · 정산으로 청산된 지출 · 환전 · 카드결제이체/신용결제 제외,
 *    kind에 없는 계좌 축(수입의 출금, 지출의 입금) 제외, 이체의 출금=입금 동일 결과 제외
 *  - 날짜 이동: 월 경계를 넘는 건수는 warnings에 집계(변경은 수행)
 *  - 고정지출 플래그: 지출(expense)만
 *
 * 레거시 항목(지출인데 category에 대분류 직접, 수입/이체인데 category에 분류 직접)은 분류 변경 시
 * 현행 3단 형태(category=kind 라벨, subCategory=대분류/중분류, detailCategory=소분류)로 승격된다 — promoted 플래그로 미리보기에 명시.
 */
import type { Account, CategoryPresets, LedgerEntry, LedgerKind } from "../types";
import { addDaysToIso, formatIsoLocal, getLastDayOfMonth, parseIsoLocal } from "./date";
import {
  isCreditPayment,
  isCurrencyExchangeEntry,
  isInvestmentKind,
  isSavingsExpenseEntry,
  isSettlementEntry,
} from "./categoryUtils";
import { isDividendEntry, isInterestEntry } from "./categoryMatch";
import { effectiveSubName, expenseMainName } from "./categoryMerge";

export interface BulkEditCategoryPatch {
  /** 적용 대상 kind — 다른 kind 항목은 제외(분류 의미가 kind마다 다름) */
  kind: LedgerKind;
  /** 지출: 대분류(→subCategory) / 수입·이체: 중분류(→subCategory). undefined = 유지(레거시는 승격만) */
  sub?: string;
  /** 지출 전용 소분류(→detailCategory). null = 비움, undefined = 유지. 수입·이체에선 무시 */
  detail?: string | null;
}

export interface BulkEditPatch {
  category?: BulkEditCategoryPatch;
  /** 출금 계좌(지출·이체). null = 비움 */
  fromAccountId?: string | null;
  /** 입금 계좌(수입·이체). null = 비움 */
  toAccountId?: string | null;
  /** 날짜 이동 — days는 단순 가산, months는 말일 클램프 */
  dateShift?: { days?: number; months?: number };
  addTags?: string[];
  removeTags?: string[];
  /** 고정지출 플래그(지출만) */
  isFixedExpense?: boolean;
}

export interface BulkEditContext {
  selectedIds: ReadonlySet<string>;
  accounts: Account[];
  categoryPresets?: CategoryPresets;
}

export type BulkEditField = "category" | "fromAccount" | "toAccount" | "date" | "tags" | "fixed";

export interface BulkEditChange {
  id: string;
  before: LedgerEntry;
  after: LedgerEntry;
  /** 실제 바뀐 필드 */
  fields: BulkEditField[];
  /** 레거시 분류 형태 → 현행 3단 형태로 승격됨 */
  promoted: boolean;
  /** 이 항목에서 일부 필드만 제외된 사유 */
  partialSkips: { field: BulkEditField; reason: string }[];
}

interface BulkEditSkip {
  id: string;
  reason: string;
}

interface BulkEditResult {
  /** 전체 가계부 배열(변경 반영, 미변경 항목은 참조 유지) */
  next: LedgerEntry[];
  /** 실제 변경된 항목 */
  changes: BulkEditChange[];
  /** 변경이 하나도 적용되지 않은 선택 항목(사유) */
  skipped: BulkEditSkip[];
  warnings: string[];
}

const KIND_LABEL: Record<LedgerKind, string> = { income: "수입", expense: "지출", transfer: "이체" };

/** 카드 대금 납부(현행 transfer 카드결제이체 + 레거시 expense 신용결제) */
function isCardPaymentEntry(e: LedgerEntry): boolean {
  return (e.kind === "transfer" && e.subCategory === "카드결제이체") || isCreditPayment(e);
}

/** 정산 항목 — 정산 분류 또는 settledLedgerIds를 가진 수입 */
function isSettlementIncome(e: LedgerEntry): boolean {
  if (isSettlementEntry(e)) return true;
  return e.kind === "income" && Array.isArray(e.settledLedgerIds) && e.settledLedgerIds.length > 0;
}

/** 재테크 계열(저축·투자 이체, 투자수익/손실, 배당, 이자, 저축성지출) — 분류 변경 금지 */
function isWealthClassified(e: LedgerEntry, ctx: BulkEditContext): boolean {
  return (
    isInvestmentKind(e) ||
    isSavingsExpenseEntry(e, ctx.accounts, ctx.categoryPresets) ||
    (e.kind === "income" && (isDividendEntry(e) || isInterestEntry(e)))
  );
}

/** 패치에 실제 변경 지시가 하나라도 있는지 */
export function isBulkEditPatchEmpty(patch: BulkEditPatch): boolean {
  if (patch.category && (patch.category.sub !== undefined || patch.category.detail !== undefined)) return false;
  if (patch.fromAccountId !== undefined || patch.toAccountId !== undefined) return false;
  if (patch.dateShift && ((patch.dateShift.days ?? 0) !== 0 || (patch.dateShift.months ?? 0) !== 0)) return false;
  if (patch.addTags?.length || patch.removeTags?.length) return false;
  if (patch.isFixedExpense !== undefined) return false;
  return true;
}

const normTags = (tags?: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags ?? []) {
    const t = String(raw ?? "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
};

/** "YYYY-MM-DD"에 months 가산(말일 클램프) 후 days 가산. 유효하지 않으면 null. */
export function shiftIsoDate(date: string, shift: { days?: number; months?: number }): string | null {
  const base = parseIsoLocal(date);
  if (!base) return null;
  let result = date;
  const months = shift.months ?? 0;
  if (months !== 0) {
    const y = base.getFullYear();
    const m0 = base.getMonth() + months; // 0-based, 오버플로 허용
    const target = new Date(y, m0, 1);
    const ty = target.getFullYear();
    const tm = target.getMonth() + 1;
    const day = Math.min(base.getDate(), getLastDayOfMonth(ty, tm));
    result = formatIsoLocal(new Date(ty, tm - 1, day));
  }
  const days = shift.days ?? 0;
  if (days !== 0) result = addDaysToIso(result, days);
  return result;
}

const sameTags = (a: string[] | undefined, b: string[] | undefined): boolean => {
  const x = a ?? [];
  const y = b ?? [];
  if (x.length !== y.length) return false;
  return x.every((t, i) => t === y[i]);
};

export function applyBulkEdit(ledger: LedgerEntry[], patch: BulkEditPatch, ctx: BulkEditContext): BulkEditResult {
  const changes: BulkEditChange[] = [];
  const skipped: BulkEditSkip[] = [];
  const warnings: string[] = [];
  const accountIds = new Set(ctx.accounts.map((a) => a.id));
  const presentIds = new Set<string>();

  // 정산으로 청산된 지출 id — 살아있는 정산 수입 항목들의 settledLedgerIds 합집합(dateAccounting과 동일 단일 소스 정의)
  const settledIds = new Set<string>();
  for (const l of ledger) {
    if (l.kind === "income" && Array.isArray(l.settledLedgerIds)) {
      for (const id of l.settledLedgerIds) if (typeof id === "string") settledIds.add(id);
    }
  }

  // 계좌 패치 유효성 — 존재하지 않는 계좌 id면 해당 축 전체 무시
  let fromPatch = patch.fromAccountId;
  let toPatch = patch.toAccountId;
  if (typeof fromPatch === "string" && !accountIds.has(fromPatch)) {
    warnings.push("출금 계좌 id가 계좌 목록에 없어 출금 계좌 변경을 건너뜁니다.");
    fromPatch = undefined;
  }
  if (typeof toPatch === "string" && !accountIds.has(toPatch)) {
    warnings.push("입금 계좌 id가 계좌 목록에 없어 입금 계좌 변경을 건너뜁니다.");
    toPatch = undefined;
  }

  const addTags = normTags(patch.addTags);
  const removeTags = new Set(normTags(patch.removeTags));
  const dateShift = patch.dateShift && ((patch.dateShift.days ?? 0) !== 0 || (patch.dateShift.months ?? 0) !== 0)
    ? patch.dateShift
    : undefined;

  let monthCross = 0;
  let promotedCount = 0;

  const next = ledger.map((e) => {
    if (!ctx.selectedIds.has(e.id)) return e;
    presentIds.add(e.id);
    if ((e as LedgerEntry & { _tradeId?: string })._tradeId) {
      skipped.push({ id: e.id, reason: "주식 매매 가상 행은 가계부 원본이 아님" });
      return e;
    }

    const fields: BulkEditField[] = [];
    const partialSkips: BulkEditChange["partialSkips"] = [];
    let after: LedgerEntry = { ...e };
    let promoted = false;

    // ── 분류 ──
    if (patch.category) {
      const cp = patch.category;
      if (e.kind !== cp.kind) {
        partialSkips.push({ field: "category", reason: `${KIND_LABEL[e.kind]} 항목 — ${KIND_LABEL[cp.kind]} 분류 적용 대상 아님` });
      } else if (isWealthClassified(e, ctx)) {
        partialSkips.push({ field: "category", reason: "재테크(저축·투자·배당·이자) 항목은 분류 변경 제외" });
      } else if (isSettlementIncome(e)) {
        partialSkips.push({ field: "category", reason: "정산 항목은 분류 변경 제외" });
      } else if (isCurrencyExchangeEntry(e)) {
        partialSkips.push({ field: "category", reason: "환전 항목은 분류 변경 제외" });
      } else if (isCardPaymentEntry(e)) {
        partialSkips.push({ field: "category", reason: "카드결제이체/신용결제 항목은 분류 변경 제외" });
      } else if (cp.sub === undefined && cp.detail === undefined) {
        partialSkips.push({ field: "category", reason: "변경할 분류 값 없음" });
      } else {
        const label = KIND_LABEL[e.kind];
        const curSub = e.kind === "expense" ? expenseMainName(e) : effectiveSubName(e);
        const newSub = (cp.sub ?? curSub).trim();
        let newDetail: string | undefined = e.detailCategory;
        if (e.kind === "expense") {
          if (cp.detail !== undefined) newDetail = cp.detail ? cp.detail.trim() || undefined : undefined;
        } else {
          newDetail = undefined;
        }
        const wasLegacy = e.category !== label;
        const catChanged = wasLegacy || (e.subCategory ?? "") !== newSub || (e.detailCategory ?? "") !== (newDetail ?? "");
        if (catChanged) {
          after = { ...after, category: label, subCategory: newSub || "(미분류)" };
          if (newDetail) after.detailCategory = newDetail;
          else delete after.detailCategory;
          fields.push("category");
          if (wasLegacy) { promoted = true; promotedCount++; }
        }
      }
    }

    // ── 계좌 ──
    if (fromPatch !== undefined || toPatch !== undefined) {
      let accReason: string | null = null;
      if (isSettlementIncome(e)) accReason = "정산 항목은 계좌 변경 제외";
      else if (settledIds.has(e.id)) accReason = "정산으로 청산된 지출은 계좌 변경 제외";
      else if (isCurrencyExchangeEntry(e)) accReason = "환전 항목은 계좌 변경 제외";
      else if (isCardPaymentEntry(e)) accReason = "카드결제이체/신용결제 항목은 계좌 변경 제외";

      if (accReason) {
        if (fromPatch !== undefined) partialSkips.push({ field: "fromAccount", reason: accReason });
        if (toPatch !== undefined) partialSkips.push({ field: "toAccount", reason: accReason });
      } else {
        let nextFrom = e.fromAccountId;
        let nextTo = e.toAccountId;
        if (fromPatch !== undefined) {
          if (e.kind === "income") partialSkips.push({ field: "fromAccount", reason: "수입 항목에는 출금 계좌 없음" });
          else nextFrom = fromPatch ?? undefined;
        }
        if (toPatch !== undefined) {
          if (e.kind === "expense") partialSkips.push({ field: "toAccount", reason: "지출 항목에는 입금 계좌 없음" });
          else nextTo = toPatch ?? undefined;
        }
        if (e.kind === "transfer" && nextFrom && nextTo && nextFrom === nextTo) {
          const reason = "이체의 출금·입금 계좌가 같아짐";
          if (fromPatch !== undefined) partialSkips.push({ field: "fromAccount", reason });
          if (toPatch !== undefined) partialSkips.push({ field: "toAccount", reason });
        } else {
          if ((nextFrom ?? "") !== (e.fromAccountId ?? "")) {
            after = { ...after };
            if (nextFrom) after.fromAccountId = nextFrom; else delete after.fromAccountId;
            fields.push("fromAccount");
          }
          if ((nextTo ?? "") !== (e.toAccountId ?? "")) {
            after = { ...after };
            if (nextTo) after.toAccountId = nextTo; else delete after.toAccountId;
            fields.push("toAccount");
          }
        }
      }
    }

    // ── 날짜 ──
    if (dateShift) {
      const shifted = shiftIsoDate(e.date, dateShift);
      if (!shifted) {
        partialSkips.push({ field: "date", reason: `날짜 형식이 올바르지 않음(${e.date || "빈 값"})` });
      } else if (shifted !== e.date) {
        if (shifted.slice(0, 7) !== e.date.slice(0, 7)) monthCross++;
        after = { ...after, date: shifted };
        fields.push("date");
      }
    }

    // ── 태그 ──
    if (addTags.length > 0 || removeTags.size > 0) {
      const cur = normTags(e.tags);
      const kept = cur.filter((t) => !removeTags.has(t));
      for (const t of addTags) if (!kept.includes(t)) kept.push(t);
      if (!sameTags(e.tags, kept)) {
        after = { ...after };
        if (kept.length > 0) after.tags = kept; else delete after.tags;
        fields.push("tags");
      }
    }

    // ── 고정지출 ──
    if (patch.isFixedExpense !== undefined) {
      if (e.kind !== "expense") {
        partialSkips.push({ field: "fixed", reason: "고정지출 플래그는 지출 항목만" });
      } else if ((e.isFixedExpense ?? false) !== patch.isFixedExpense) {
        after = { ...after, isFixedExpense: patch.isFixedExpense };
        fields.push("fixed");
      }
    }

    if (fields.length === 0) {
      const reason = partialSkips.length > 0
        ? Array.from(new Set(partialSkips.map((s) => s.reason))).join(" · ")
        : "변경 사항 없음(이미 동일)";
      skipped.push({ id: e.id, reason });
      return e;
    }
    changes.push({ id: e.id, before: e, after, fields, promoted, partialSkips });
    return after;
  });

  // 선택은 됐지만 원본 가계부에 없는 id(주식 가상 행 등)
  for (const id of ctx.selectedIds) {
    if (!presentIds.has(id)) skipped.push({ id, reason: "가계부 원본이 아님(주식 가상 행 등)" });
  }

  if (monthCross > 0) warnings.push(`${monthCross}건이 날짜 이동으로 월 경계를 넘어 다른 달로 이동합니다(월별 집계·예산 변동).`);
  if (promotedCount > 0) warnings.push(`${promotedCount}건은 레거시 분류 형태라 현행 3단 형태(대분류→중분류→소분류)로 승격됩니다.`);

  return { next, changes, skipped, warnings };
}
