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
]);

export interface RealIncomeBreakdown {
  /** 정산성 수입 합 (subCategory 또는 category에 "정산" 포함 — 부분일치). */
  settlementTotal: number;
  /** 일시성 수입 합 (NON_REAL_INCOME 정확 일치, "정산" 제외). */
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
 *  - "정산" 부분일치 → settlementTotal (상대가 돌려준 돈)
 *  - NON_REAL_INCOME 정확 일치 → tempIncomeTotal (용돈/지원/대출 등 일시성)
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
    if (sub === "정산" || sub.includes("정산")) {
      settlementTotal += Number(l.amount);
    } else if (NON_REAL_INCOME.has(sub)) {
      tempIncomeTotal += Number(l.amount);
    }
  }
  return {
    settlementTotal,
    tempIncomeTotal,
    realIncome: pIncome - settlementTotal - tempIncomeTotal,
  };
}

export interface OriginalAssetsBreakdown {
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
