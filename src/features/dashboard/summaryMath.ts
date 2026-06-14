/**
 * 대시보드 공용 가계부 집계 — 순수 함수.
 * DashboardPage(이번달/전체 합계)·SavingsRatioCard(저번달 합계)·MonthlyTrendCard·
 * SpendingCalendarCard·monthComparison(전월/전년 비교)이 같은 분류 기준을 공유한다.
 * 호출부에서 useMemo로 감싸 재계산을 막는다 (입력: ledger, fxRate, 월 prefix).
 */
import type { CategoryPresets, LedgerEntry } from "../../types";
import { isCreditPayment, isSavingsExpenseEntry } from "../../utils/category";

/** USD 항목은 환율로 원화 환산. 환율이 없으면 액면 그대로 (대시보드 공통 정책) */
export const toKrwAmount = (entry: LedgerEntry, fxRate: number | null): number =>
  entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;

/** 대시보드 공통 흐름 분류 결과. null = 집계 제외 (신용결제·재테크 아닌 일반 이체) */
type LedgerFlowType = "income" | "expense" | "investing";

/**
 * 대시보드 단일 분류 기준 — 수입/지출/재테크.
 * - income   : kind=income (salaryKeys 지정 시 근로소득만)
 * - expense  : kind=expense 중 실질 소비
 *              (신용결제는 카드 사용 시점에 이미 expense로 잡힘 — 이중계상 방지 위해 제외)
 * - investing: "재테크" 단일 정의 = 저축이체·투자이체 transfer (+구버전 저축/투자 transfer)
 *              + 레거시 저축성지출 expense (isSavingsExpenseEntry)
 * - null     : 신용결제, 재테크가 아닌 일반 이체, (salaryKeys 지정 시) 비근로 수입
 *
 * @param salaryKeys 지정 시 근로소득(월급·수당·상여) 중분류만 "income"으로 집계하고
 *   정산·용돈·배당 등 비근로 유입은 null로 제외 — 인사이트의 "수입=근로소득" 정의와 통일.
 *   미지정(레거시 호출·테스트)이면 모든 kind=income을 수입으로 본다.
 */
export function classifyLedgerFlow(
  entry: LedgerEntry,
  categoryPresets?: CategoryPresets,
  salaryKeys?: Set<string>
): LedgerFlowType | null {
  if (entry.kind === "income") {
    if (salaryKeys && !salaryKeys.has(entry.subCategory || entry.category || "")) return null;
    return "income";
  }
  if (entry.kind === "expense") {
    if (isCreditPayment(entry)) return null;
    if (isSavingsExpenseEntry(entry, [], categoryPresets)) return "investing";
    return "expense";
  }
  if (entry.kind === "transfer") {
    const sub = entry.subCategory;
    if (sub === "저축이체" || sub === "투자이체" || sub === "저축" || sub === "투자") {
      return "investing";
    }
  }
  return null;
}

/** "재테크" 단일 정의 — 저축·투자 이체 + 레거시 저축성지출. 카드들이 같은 정의를 공유한다. */
export function isWealthBuildingEntry(
  entry: LedgerEntry,
  categoryPresets?: CategoryPresets
): boolean {
  return classifyLedgerFlow(entry, categoryPresets) === "investing";
}

/**
 * 공통: 월 prefix(또는 null=전체) 기준으로 수입/지출/재테크 합계 계산.
 * 분류는 classifyLedgerFlow 단일 기준, 금액은 toKrwAmount(USD 환산) 사용.
 */
export function computeLedgerSummary(
  ledger: LedgerEntry[],
  fxRate: number | null,
  monthPrefix: string | null,
  categoryPresets?: CategoryPresets,
  salaryKeys?: Set<string>
): { income: number; expense: number; investing: number } {
  let income = 0;
  let expense = 0;
  let investing = 0;
  for (const entry of ledger) {
    if (!entry.date) continue;
    if (monthPrefix && !entry.date.startsWith(monthPrefix)) continue;
    const flow = classifyLedgerFlow(entry, categoryPresets, salaryKeys);
    if (!flow) continue;
    const amt = toKrwAmount(entry, fxRate);
    if (flow === "income") income += amt;
    else if (flow === "expense") expense += amt;
    else investing += amt;
  }
  return { income, expense, investing };
}

/** 재테크 세부(저축/투자/투자수익/투자손실)를 각 항목의 정식 소스에서 집계.
 * 저축=transfer 저축이체, 투자=transfer 투자이체, 투자수익=income 투자수익, 투자손실=expense 재테크 투자손실. */
export function computeRecheckBreakdown(
  ledger: LedgerEntry[],
  fxRate: number | null,
  monthPrefix: string
): { 저축: number; 투자: number; 투자수익: number; 투자손실: number } {
  const sub = { 저축: 0, 투자: 0, 투자수익: 0, 투자손실: 0 };
  for (const entry of ledger) {
    if (!entry.date?.startsWith(monthPrefix)) continue;
    const amt = toKrwAmount(entry, fxRate);
    if (entry.kind === "transfer") {
      if (entry.subCategory === "저축이체") sub.저축 += amt;
      else if (entry.subCategory === "투자이체") sub.투자 += amt;
    } else if (entry.kind === "income" && entry.subCategory === "투자수익") {
      sub.투자수익 += amt;
    } else if (entry.kind === "expense" && entry.category === "재테크" && entry.subCategory === "투자손실") {
      sub.투자손실 += amt;
    }
  }
  return sub;
}
