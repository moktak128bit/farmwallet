/**
 * 수입 성격 키 자동 감지 — 인사이트·대시보드 공용 단일 소스.
 *
 * 기존엔 useInsightsData 내부에서만 계산하던 salaryKeys/investIncKeys 로직을 추출해,
 * 대시보드(요약·저축률·추이·비교)도 같은 "근로소득" 기준을 공유하도록 한다.
 * (수입 정의가 화면마다 달라지는 것을 막는 단일 진입점)
 *
 * 판정 규칙은 옮기기 전과 100% 동일하게 유지한다:
 *  - 급여성(salaryKeys): 활동 월의 40% 이상(최소 2개월) 등장하는 수입 중분류 + 명시 목록(급여·상여·수당),
 *    단 비근로 목록(캐시백·배당·이자·투자수익·환불·데이트통장 + 비실질)은 제외.
 *  - 투자/패시브(investIncKeys): 투자 계좌에서 발생한 수입 중분류(급여성 제외) + 명시 목록(배당·이자·투자수익),
 *    단 비패시브 목록(캐시백·환불·데이트통장 + 비실질)은 제외.
 */
import type { Account, LedgerEntry } from "../types";
import { NON_REAL_INCOME } from "./realIncome";
import { isCarryOverIncomeEntry } from "./savingsRate";

interface IncomeNatureKeys {
  /** 근로소득(월급·수당·상여 등) 중분류 집합 */
  salaryKeys: Set<string>;
  /** 투자/패시브(배당·이자·투자수익 등) 중분류 집합 */
  investIncKeys: Set<string>;
}

/** 사용자가 설정(categoryTypes)에서 지정한 수입 성격 — 자동감지보다 우선. */
interface IncomeNatureOverride {
  salary?: string[];
  passive?: string[];
  nonRealIncome?: string[];
}

/**
 * 장부 전체를 보고 근로소득·패시브 수입 중분류 키를 자동 감지한다.
 * @param ledger 전체 가계부 (월별 빈도 판정에 전 기간 필요)
 * @param accounts 투자 계좌(securities/crypto) 판정용 — 생략 시 investIncKeys는 명시 목록만
 * @param override 사용자 지정(categoryTypes) — 지정된 카테고리는 빈도 추측을 무시하고 강제 분류
 */
export function computeIncomeNatureKeys(
  ledger: LedgerEntry[],
  accounts: Account[] = [],
  override?: IncomeNatureOverride
): IncomeNatureKeys {
  const invIds = new Set(
    accounts.filter((a) => a.type === "securities" || a.type === "crypto").map((a) => a.id)
  );

  // 활동 월 수 (모든 종류의 항목 기준 — useInsightsData의 months와 동일 정의)
  const monthSet = new Set<string>();
  for (const l of ledger) {
    const m = l.date?.slice(0, 7);
    if (m) monthSet.add(m);
  }
  const monthCount = monthSet.size;

  // 급여성: 활동 월의 40% 이상에 나타나는 수입 중분류 → 정기 소득
  const incSubMonths = new Map<string, Set<string>>();
  for (const l of ledger) {
    if (l.kind !== "income" || Number(l.amount) <= 0) continue;
    const m = l.date?.slice(0, 7);
    const sub = l.subCategory || l.category || "";
    if (!m || !sub || isCarryOverIncomeEntry(l)) continue;
    if (!incSubMonths.has(sub)) incSubMonths.set(sub, new Set());
    incSubMonths.get(sub)!.add(m);
  }
  const salaryThreshold = Math.max(monthCount * 0.4, 2);
  const salaryKeys = new Set<string>();
  for (const [sub, ms] of incSubMonths) {
    if (ms.size >= salaryThreshold) salaryKeys.add(sub);
  }
  // 빈도 기준으로는 놓치지만 명백한 회사소득 (연 1-2회 상여 등)
  const ALWAYS_SALARY = ["상여", "급여", "수당"];
  for (const k of ALWAYS_SALARY) salaryKeys.add(k);
  // 자주 나타나도 회사소득이 아닌 카테고리 (빈도 자동감지 오분류 보정)
  const NEVER_SALARY = ["캐시백", "배당", "이자", "투자수익", "환불", "데이트통장", ...NON_REAL_INCOME];
  for (const k of NEVER_SALARY) salaryKeys.delete(k);

  // 투자/패시브: 투자 계좌에서 발생하는 수입 중분류 (급여성 제외) + 명시적 목록
  const investIncKeys = new Set<string>();
  for (const l of ledger) {
    if (l.kind !== "income" || Number(l.amount) <= 0) continue;
    const sub = l.subCategory || l.category || "";
    if (!sub || salaryKeys.has(sub)) continue;
    if (invIds.has(l.toAccountId || "") || invIds.has(l.fromAccountId || "")) investIncKeys.add(sub);
  }
  const ALWAYS_INVEST_INCOME = ["배당", "이자", "투자수익"];
  for (const k of ALWAYS_INVEST_INCOME) investIncKeys.add(k);
  // 투자계좌에 우연히 들어온 리워드·환급류가 "패시브" 분류 전체를 오염시키는 것 방지
  const NEVER_INVEST_INCOME = ["캐시백", "환불", "데이트통장", ...NON_REAL_INCOME];
  for (const k of NEVER_INVEST_INCOME) investIncKeys.delete(k);

  // 사용자 지정 우선 적용 — 자동감지 결과를 덮어쓴다.
  //  비실질: 양쪽에서 제거(근로·패시브 모두 아님, 실질수입 제외는 realIncome 쪽에서 처리)
  //  패시브: investIncKeys로 강제 / 근로: salaryKeys로 강제 (근로를 마지막에 적용해 최우선)
  for (const k of override?.nonRealIncome ?? []) { salaryKeys.delete(k); investIncKeys.delete(k); }
  for (const k of override?.passive ?? []) { salaryKeys.delete(k); investIncKeys.add(k); }
  for (const k of override?.salary ?? []) { investIncKeys.delete(k); salaryKeys.add(k); }

  return { salaryKeys, investIncKeys };
}
