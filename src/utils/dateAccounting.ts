import type { Account, LedgerEntry } from "../types";

/**
 * 데이트성 지출 판정.
 * 매칭 규칙: kind=expense AND (category 또는 subCategory에 "데이트" 부분일치).
 * trim 후 비교 — 공백 차이 방어.
 *
 * 예시 매칭: "데이트비", "데이트(저녁)", "주말데이트", "기념일 데이트"
 * 비매칭: "외식" (데이트 키워드 없음), 수입/이체 항목
 */
export function isDateEntry(l: LedgerEntry): boolean {
  if (l.kind !== "expense") return false;
  const cat = (l.category || "").trim();
  const sub = (l.subCategory || "").trim();
  return cat.includes("데이트") || sub.includes("데이트");
}

/**
 * "모임 통장"으로 간주할 계좌 판정 — 계좌명에 "모임" 포함.
 * 데이트 지출이 모임 통장에서 나갔는지 vs 개인 통장인지 분리할 때 사용.
 */
export function isMoimAccount(a: Account): boolean {
  return (a.name ?? "").includes("모임");
}

/** 모임 계좌 id Set — 다회 매칭 빠르게. */
export function getMoimAccountIds(accounts: Account[]): Set<string> {
  return new Set(accounts.filter(isMoimAccount).map((a) => a.id));
}

export interface DatePartnerShare {
  /** 데이트 계좌(설정에서 지정)에서 빠져나간 지출 합. */
  dateAccountSpend: number;
  /** 그 중 상대 부담분 = dateAccountSpend × 0.5. 실질 지출 계산에서 차감. */
  datePartnerShare: number;
}

/**
 * 데이트 계좌의 50/50 분담 계산.
 * 사용자가 Settings에서 dateAccountId를 지정해 두면, 그 계좌의 지출 중 절반은
 * 상대가 부담한 것으로 간주해 "실질 지출"에서 빼기 위함.
 *
 * @param fExp 기간 필터된 지출 항목들 (재테크·환전 제외 상태 가정)
 * @param dateAccountId 데이트 계좌 id (null이면 분담 없음 → 0/0 반환)
 */
export function computeDatePartnerShare(
  fExp: LedgerEntry[],
  dateAccountId: string | null
): DatePartnerShare {
  if (!dateAccountId) return { dateAccountSpend: 0, datePartnerShare: 0 };
  let dateAccountSpend = 0;
  for (const l of fExp) {
    if (l.fromAccountId === dateAccountId) dateAccountSpend += Number(l.amount);
  }
  return { dateAccountSpend, datePartnerShare: dateAccountSpend * 0.5 };
}

export interface DateMoimSplit {
  /** 모임 통장에서 나간 데이트 지출 합. */
  dateMoim: number;
  /** 개인 통장(모임이 아닌)에서 나간 데이트 지출 합. */
  datePersonal: number;
}

/**
 * 데이트 지출을 모임/개인으로 분리 합산.
 * fromAccountId가 모임 계좌면 dateMoim, 아니면 datePersonal.
 * fromAccountId가 비어있으면 datePersonal로 분류.
 */
export function splitDateMoimVsPersonal(
  dateEntries: LedgerEntry[],
  moimAccountIds: Set<string>
): DateMoimSplit {
  let dateMoim = 0;
  let datePersonal = 0;
  for (const l of dateEntries) {
    const a = Number(l.amount);
    if (l.fromAccountId && moimAccountIds.has(l.fromAccountId)) dateMoim += a;
    else datePersonal += a;
  }
  return { dateMoim, datePersonal };
}
