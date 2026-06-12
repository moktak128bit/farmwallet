import type { Account, LedgerEntry } from "../types";

/**
 * "실질 수입에서 빼야 할" 비-실질 수입원 중분류 집합.
 * 사용자가 진짜로 번 돈이 아니라 회수·지원·자산 이전 성격.
 *
 * 주의: "이월"/"원래 보유 자산"은 일반적으로 호출 측에서 fInc 단계에서 이미 isCarryOver 필터로 제거됨.
 * 그래도 방어적으로 포함해 두면 fInc 필터링 누락 시 안전망이 됨.
 */
export const NON_REAL_INCOME = new Set([
  "정산",
  "용돈",
  "이월",
  "원래 보유 자산",
  "대출",
  "처분소득",
  "지원",
  "환불",
]);

/**
 * 정산성(회수) 수입 판정 — 내가/우리가 먼저 쓴 돈이 돌아온 것.
 *  - "정산" 부분일치
 *  - "데이트통장" 정확 일치: 상대 분담금 입금. 실질 지출 쪽에서 상대 부담 50%를
 *    이미 차감하므로(computeDatePartnerShare) 입금까지 수입으로 잡으면 이중계상.
 */
const isSettlementLikeSub = (s: string): boolean =>
  s.includes("정산") || s === "데이트통장";

/** 비-실질 수입 판정 단일 소스 — 정산성 + NON_REAL_INCOME 정확 일치 + "환불" 부분일치. */
export const isNonRealIncomeSub = (s: string): boolean =>
  isSettlementLikeSub(s) || NON_REAL_INCOME.has(s) || s.includes("환불");

/**
 * 수입원의 성격 — 인사이트에서 "수입원"을 한 덩어리로 취급하지 않기 위한 분류.
 *  - 근로: 급여·상여·수당 등 일해서 번 돈 (salaryKeys)
 *  - 패시브: 배당·이자·투자수익 — 자산이 번 돈 (investIncKeys)
 *  - 환급: 정산·환불·데이트통장 분담금 — 쓴 돈이 돌아온 것, 수입 아님
 *  - 일시: 지원·용돈·처분소득 등 반복 보장 없는 이전성 소득, 실질 수입 제외
 *  - 부채: 대출 유입 — 갚아야 할 돈
 *  - 기타: 캐시백·지역화폐 등 소액 부수입 (실질 수입에는 포함)
 */
export type IncomeNature = "근로" | "패시브" | "환급" | "일시" | "부채" | "기타";

export function classifyIncomeNature(
  sub: string,
  opts?: { salaryKeys?: Set<string>; investIncKeys?: Set<string> }
): IncomeNature {
  const s = (sub || "").trim();
  if (s === "대출") return "부채";
  if (isSettlementLikeSub(s) || s.includes("환불")) return "환급";
  if (NON_REAL_INCOME.has(s)) return "일시";
  if (opts?.salaryKeys?.has(s)) return "근로";
  if (opts?.investIncKeys?.has(s)) return "패시브";
  return "기타";
}

interface RealIncomeBreakdown {
  /** 정산성 수입 합 — isSettlementLikeSub("정산" 부분일치, "데이트통장") 참조. */
  settlementTotal: number;
  /** 일시성 수입 합 (NON_REAL_INCOME 정확 일치 + "환불" 부분일치, 정산성 제외). */
  tempIncomeTotal: number;
  /** 실질 수입 = pIncome − settlementTotal − tempIncomeTotal. */
  realIncome: number;
}

/**
 * 장부 수입(pIncome)에서 정산·일시소득을 제외해 "진짜 내가 번 돈" 산출.
 *
 * @param fInc 이미 carry-over(이월·원래보유) 제외된 수입 항목들. amount > 0 가정.
 * @param pIncome 같은 fInc의 amount 합. (재계산 안 하고 받음 — 호출 측에서 이미 reduce했음)
 *
 * 분류 규칙:
 *  - 정산성(isSettlementLikeSub: "정산" 부분일치, "데이트통장") → settlementTotal (돌려받은 돈)
 *  - NON_REAL_INCOME 정확 일치 또는 "환불" 부분일치 → tempIncomeTotal (용돈/지원/대출/환불 등)
 *  - 그 외 → 실질 수입
 *  카테고리 매칭은 subCategory 우선, 없으면 category 사용 (둘 다 없으면 빈 문자열).
 */
export function computeRealIncome(
  fInc: LedgerEntry[],
  pIncome: number
): RealIncomeBreakdown {
  let settlementTotal = 0;
  let tempIncomeTotal = 0;
  for (const l of fInc) {
    const sub = (l.subCategory || l.category || "").trim();
    if (isSettlementLikeSub(sub)) {
      settlementTotal += Number(l.amount);
    } else if (NON_REAL_INCOME.has(sub) || sub.includes("환불")) {
      tempIncomeTotal += Number(l.amount);
    }
  }
  return {
    settlementTotal,
    tempIncomeTotal,
    realIncome: pIncome - settlementTotal - tempIncomeTotal,
  };
}

interface OriginalAssetsBreakdown {
  /** 계좌별 초기잔액(0 초과)만, 큰 순서로 정렬. */
  originalAssetsByAcct: { name: string; amount: number }[];
  /** 위 합계. */
  originalAssets: number;
}

/**
 * 사용자가 앱 시작 시 갖고 있던 "원래 보유 자산" — 계좌별 initialBalance 기반.
 * 실질 수입 계산엔 직접 안 쓰이지만 인사이트 카드(원래보유 vs 실질수입 비교)에서 표시.
 */
export function computeOriginalAssets(accounts: Account[]): OriginalAssetsBreakdown {
  const originalAssetsByAcct = accounts
    .filter((a) => (a.initialBalance ?? 0) > 0)
    .map((a) => ({ name: a.name, amount: a.initialBalance ?? 0 }))
    .sort((a, b) => b.amount - a.amount);
  const originalAssets = originalAssetsByAcct.reduce((s, a) => s + a.amount, 0);
  return { originalAssetsByAcct, originalAssets };
}
