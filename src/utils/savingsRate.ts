/**
 * 저축률·실질 수입/지출 단일 정의 — 순수 모듈 (React 의존 없음).
 *
 * 정의 통일의 단일 소스:
 *  - 이체 기준 저축률(대시보드 SavingsRatioCard): 재테크 이체 / 수입
 *  - 실질 저축률(인사이트·보고서): (실질수입 − 실질지출) / 실질수입
 *
 * 지출 판정은 utils/category의 isRealExpenseEntry 단일 소스를 재사용한다
 * (환전·신용결제·재테크/저축성지출 제외, 투자손실은 포함) — 여기에 중복 정의 금지.
 * 공용 함수는 compute* 접두 관례 — D 필드명(realSavingsRate 등)과의 충돌 방지.
 */
import type { LedgerEntry } from "../types";
import { isRealExpenseEntry } from "./category";
import { computeRealIncome } from "./realIncome";
import { computeDatePartnerShare } from "./dateAccounting";

/** 이체 기준 저축률 = 재테크 이체(저축+투자) / 수입 × 100. 수입 ≤ 0 이면 null. */
export function computeTransferSavingsRate(income: number, investing: number): number | null {
  if (income <= 0) return null;
  return (investing / income) * 100;
}

/** 실질 저축률 = (실질수입 − 실질지출) / 실질수입 × 100. 실질수입 ≤ 0 이면 null. */
export function computeRealSavingsRate(realIncome: number, realExpense: number): number | null {
  if (realIncome <= 0) return null;
  return ((realIncome - realExpense) / realIncome) * 100;
}

/** "이월"/"원래 보유 자산" 문자열 판정 — 정확 일치 또는 "이월"/"보유 자산" 부분일치. */
const isCarryOverStr = (s: string) =>
  s === "이월" || s.includes("이월") || s === "원래 보유 자산" || s.includes("보유 자산");

/** 이월/원래 보유 자산 수입 여부 — 실수입이 아니므로 모든 수입 지표에서 제외. */
export function isCarryOverIncomeEntry(l: LedgerEntry): boolean {
  return isCarryOverStr(l.category || "") || isCarryOverStr(l.subCategory || "");
}

interface MonthlyRealFlow {
  month: string;
  realIncome: number;
  realExpense: number;
  settlementTotal: number;
  tempIncomeTotal: number;
  dateAccountSpend: number;
  datePartnerShare: number;
}

/**
 * 월별 실질 수입/지출 흐름 계산.
 *
 * 절차:
 *  (a) date 없는 항목·startMonth/endMonth 범위 밖 항목 skip
 *  (b) USD 항목은 환율로 원화 정규화한 얕은 복사본을 월 버킷에 적재
 *      — computeRealIncome이 raw amount를 합산하므로 사전 정규화가 필수
 *        (환산 수입 + raw 정산 차감의 불일치 방지). fxRate=null이면 raw 합산 폴백.
 *  (c) 수입: 이월 제외 양수 income → computeRealIncome(utils/realIncome) 재사용
 *  (d) 지출: isRealExpenseEntry 통과분 합(투자손실 자동 포함)
 *      → computeDatePartnerShare(utils/dateAccounting)로 데이트 50% 차감
 */
export function computeMonthlyRealFlows(
  ledger: LedgerEntry[],
  opts: { fxRate: number | null; dateAccountId: string | null; startMonth?: string; endMonth?: string }
): Map<string, MonthlyRealFlow> {
  const { fxRate, dateAccountId, startMonth, endMonth } = opts;

  // (a)(b) 월 버킷 적재 — summaryMath와 동일한 toKrw 규칙으로 정규화
  const byMonth = new Map<string, LedgerEntry[]>();
  for (const l of ledger) {
    if (!l.date) continue;
    const month = l.date.slice(0, 7);
    if (startMonth && month < startMonth) continue;
    if (endMonth && month > endMonth) continue;
    const amount = Number(l.amount);
    const toKrw = l.currency === "USD" && fxRate ? amount * fxRate : amount;
    const normalized: LedgerEntry = { ...l, amount: toKrw };
    const bucket = byMonth.get(month);
    if (bucket) bucket.push(normalized);
    else byMonth.set(month, [normalized]);
  }

  const result = new Map<string, MonthlyRealFlow>();
  for (const [month, entries] of byMonth) {
    // (c) 수입: 이월/원래 보유 자산 제외 → 정산·일시소득 분리는 computeRealIncome 재사용
    const incomeEntries = entries.filter(
      (l) => l.kind === "income" && Number(l.amount) > 0 && !isCarryOverIncomeEntry(l)
    );
    const pIncome = incomeEntries.reduce((s, l) => s + Number(l.amount), 0);
    const { settlementTotal, tempIncomeTotal, realIncome } = computeRealIncome(incomeEntries, pIncome);

    // (d) 지출: 표준 실질 지출 판정 → 데이트 계좌 50% 상대 부담분 차감
    const expenseEntries = entries.filter((l) => isRealExpenseEntry(l));
    const expenseSum = expenseEntries.reduce((s, l) => s + Number(l.amount), 0);
    const { dateAccountSpend, datePartnerShare } = computeDatePartnerShare(expenseEntries, dateAccountId);
    const realExpense = expenseSum - datePartnerShare;

    result.set(month, {
      month,
      realIncome,
      realExpense,
      settlementTotal,
      tempIncomeTotal,
      dateAccountSpend,
      datePartnerShare
    });
  }
  return result;
}
