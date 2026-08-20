/**
 * FIRE 투영 — 결정론적 연 단위 복리 투영 (React 의존 없음, 저장 경로 없음).
 *
 * 모델(단순·설명 가능 — 몬테카를로 없음):
 *  - 순자산 NW[0] = 현재 순자산, NW[y+1] = NW[y] × (1 + r) + 12 × s
 *    (r = 연 명목 수익률, s = 월 저축. 저축은 연말 일괄 적립 — 연중 복리는 무시, 보수적)
 *  - FIRE 숫자 FN[y] = 은퇴 후 연 지출 × (1 + 인플레)^y ÷ 인출률(SWR)
 *    (지출은 인플레로 커지므로 목표선도 해마다 올라간다. 인플레 0이면 수평선)
 *  - 크로스오버 = NW[y] ≥ FN[y]가 처음 성립하는 y (없으면 null)
 *  - requiredMonthlySavingForYear(T): NW[T] ≥ FN[T]를 만족하는 최소 월 저축
 *      NW[T] = NW0·g^T + 12 s · A,  A = (g^T − 1)/(g − 1) (g=1이면 T)
 *      → s = (FN[T] − NW0·g^T) / (12·A). 음수면 0(이미 충분). T ≤ 0 또는 SWR ≤ 0이면 null.
 *
 * 분모 0 처리: SWR ≤ 0 → fireNumber 정의 불가 → fireNumberToday=null, fireNumberByYear=[], crossoverYear=null.
 *
 * 3시나리오(buildFireScenarios): 보수 = 수익률 −2%p·저축 −10%, 기준 = 그대로, 낙관 = 수익률 +2%p·저축 +10%.
 * 같은 인플레·SWR·은퇴 지출을 쓰므로 FN은 공통, NW만 단조(보수 ≤ 기준 ≤ 낙관).
 *
 * 모든 숫자는 '가정 기반 추정'이며 보장이 아니다 — UI는 반드시 면책 문구를 붙인다.
 */

export const DEFAULT_INFLATION_PCT = 2.5;
export const DEFAULT_WITHDRAWAL_RATE_PCT = 4;
export const DEFAULT_HORIZON_YEARS = 40;
/** 시나리오 폭 */
const SCENARIO_RETURN_DELTA_PCT = 2;
const SCENARIO_SAVING_DELTA_RATIO = 0.1;
/** 크로스오버 판정의 상대 오차 허용 (부동소수) */
const CROSSOVER_EPS = 1e-9;

interface FireProjectionBaseline {
  /** 현재 순자산 (KRW) */
  netWorthKRW: number;
  /** 연 실질 지출 (KRW) — retireSpendingAnnual 미지정 시 은퇴 후 지출로 사용 */
  annualRealExpense: number;
}

export interface FireAssumptions {
  /** 연 인플레 (%, 기본 2.5) */
  inflationPct?: number;
  /** 안전 인출률 (%, 기본 4) */
  withdrawalRatePct?: number;
  /** 연 명목 수익률 (%) */
  returnPct: number;
  /** 월 저축 (KRW, 명목 고정) */
  monthlySaving: number;
  /** 투영 연수 (기본 40) */
  horizonYears?: number;
  /** 은퇴 후 연 지출 (KRW, 오늘 가치). 미지정 시 baseline.annualRealExpense */
  retireSpendingAnnual?: number;
}

export interface FireProjection {
  /** 0..horizon (0 = 현재) */
  years: number[];
  /** 연말 순자산 (명목, KRW). netWorth[0] = 현재 */
  netWorth: number[];
  /** 연도별 FIRE 숫자 (명목, 인플레 반영). SWR ≤ 0이면 빈 배열 */
  fireNumberByYear: number[];
  /** 오늘 가치 FIRE 숫자 = 은퇴 지출 ÷ SWR. SWR ≤ 0이면 null */
  fireNumberToday: number | null;
  /** 순자산 ≥ FIRE 숫자가 처음 성립하는 해 (0 = 이미 달성). 없으면 null */
  crossoverYear: number | null;
  /** 현재 순자산 / 오늘 가치 FIRE 숫자 (비율, 0~). 정의 불가면 null */
  progressRatio: number | null;
  /** 실제 적용된 가정 (기본값 채움) */
  assumptions: Required<FireAssumptions>;
}

interface FireScenarios {
  conservative: FireProjection;
  base: FireProjection;
  optimistic: FireProjection;
}

function finiteOr(n: number | undefined, fallback: number): number {
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function resolveFireAssumptions(
  baseline: FireProjectionBaseline,
  a: FireAssumptions
): Required<FireAssumptions> {
  return {
    inflationPct: finiteOr(a.inflationPct, DEFAULT_INFLATION_PCT),
    withdrawalRatePct: finiteOr(a.withdrawalRatePct, DEFAULT_WITHDRAWAL_RATE_PCT),
    returnPct: finiteOr(a.returnPct, 0),
    monthlySaving: Math.max(0, finiteOr(a.monthlySaving, 0)),
    horizonYears: Math.max(1, Math.floor(finiteOr(a.horizonYears, DEFAULT_HORIZON_YEARS))),
    retireSpendingAnnual: Math.max(0, finiteOr(a.retireSpendingAnnual, Math.max(0, baseline.annualRealExpense))),
  };
}

/** 연 단위 순자산 경로 — NW[y+1] = NW[y]·g + 12·s */
function netWorthPath(nw0: number, returnPct: number, monthlySaving: number, horizon: number): number[] {
  const g = 1 + returnPct / 100;
  const out: number[] = [nw0];
  let nw = nw0;
  for (let y = 1; y <= horizon; y += 1) {
    nw = nw * g + 12 * monthlySaving;
    out.push(nw);
  }
  return out;
}

export function projectFire(params: { baseline: FireProjectionBaseline; assumptions: FireAssumptions }): FireProjection {
  const { baseline } = params;
  const a = resolveFireAssumptions(baseline, params.assumptions);
  const nw0 = Number.isFinite(baseline.netWorthKRW) ? baseline.netWorthKRW : 0;

  const years: number[] = [];
  for (let y = 0; y <= a.horizonYears; y += 1) years.push(y);
  const netWorth = netWorthPath(nw0, a.returnPct, a.monthlySaving, a.horizonYears);

  const swr = a.withdrawalRatePct / 100;
  const hasFireNumber = swr > 0;
  const fireNumberToday = hasFireNumber ? a.retireSpendingAnnual / swr : null;
  const infl = 1 + a.inflationPct / 100;

  const fireNumberByYear: number[] = [];
  let crossoverYear: number | null = null;
  if (fireNumberToday != null) {
    for (let y = 0; y <= a.horizonYears; y += 1) {
      const fn = fireNumberToday * Math.pow(infl, y);
      fireNumberByYear.push(fn);
      // 부동소수 오차 허용 — requiredMonthlySavingForYear로 역산한 값이 경계에서 null로 튀지 않게
      if (crossoverYear == null && netWorth[y] >= fn - Math.abs(fn) * CROSSOVER_EPS) crossoverYear = y;
    }
  }

  const progressRatio =
    fireNumberToday != null && fireNumberToday > 0 ? Math.max(0, nw0) / fireNumberToday : null;

  return { years, netWorth, fireNumberByYear, fireNumberToday, crossoverYear, progressRatio, assumptions: a };
}

/**
 * targetYear(현재로부터 N년 후)에 FIRE 숫자에 닿기 위한 최소 월 저축 (KRW).
 * 이미 충분하면 0. targetYear ≤ 0·SWR ≤ 0이면 null.
 */
export function requiredMonthlySavingForYear(
  params: { baseline: FireProjectionBaseline; assumptions: FireAssumptions },
  targetYear: number
): number | null {
  const a = resolveFireAssumptions(params.baseline, params.assumptions);
  const T = Math.floor(targetYear);
  if (!Number.isFinite(T) || T <= 0) return null;
  const swr = a.withdrawalRatePct / 100;
  if (swr <= 0) return null;
  const nw0 = Number.isFinite(params.baseline.netWorthKRW) ? params.baseline.netWorthKRW : 0;
  const g = 1 + a.returnPct / 100;
  const gT = Math.pow(g, T);
  const annuity = Math.abs(g - 1) < 1e-12 ? T : (gT - 1) / (g - 1);
  const fnT = (a.retireSpendingAnnual / swr) * Math.pow(1 + a.inflationPct / 100, T);
  const need = fnT - nw0 * gT;
  if (need <= 0) return 0;
  if (annuity <= 0) return null;
  return need / (12 * annuity);
}

export function buildFireScenarios(params: { baseline: FireProjectionBaseline; assumptions: FireAssumptions }): FireScenarios {
  const base = projectFire(params);
  const a = base.assumptions;
  const conservative = projectFire({
    baseline: params.baseline,
    assumptions: {
      ...a,
      returnPct: a.returnPct - SCENARIO_RETURN_DELTA_PCT,
      monthlySaving: a.monthlySaving * (1 - SCENARIO_SAVING_DELTA_RATIO),
    },
  });
  const optimistic = projectFire({
    baseline: params.baseline,
    assumptions: {
      ...a,
      returnPct: a.returnPct + SCENARIO_RETURN_DELTA_PCT,
      monthlySaving: a.monthlySaving * (1 + SCENARIO_SAVING_DELTA_RATIO),
    },
  });
  return { conservative, base, optimistic };
}
