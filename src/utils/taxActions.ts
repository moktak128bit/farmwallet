/**
 * 절세 액션 카드 (4-2) — B1(종합과세 추적)·B3(미국주식 양도세·손실수확)·4-1(ISA/연금 절세계좌)에
 * 흩어진 세 계산을 한 우선순위 목록으로 합친다. 이 파일은 순수 계산만 하고(입력은 이미 계산된
 * buildComprehensiveTaxTracker/buildForeignCapitalGainsTax/buildShelterContributions 결과), 표시는
 * features/dashboard/TaxActionsCard.tsx가 담당한다.
 *
 * foreignTax·shelter는 옵션(null 허용) — 미국주식이 없거나 절세계좌를 지정하지 않은 사용자는
 * 그 액션이 생략될 뿐 종합과세 액션(+연말 D-day)만으로도 카드가 성립한다.
 */
import type { TabId } from "../components/ui/Tabs";
import { formatKRW } from "./formatter";
import { parseIsoLocal } from "./date";

// 아래 세 타입은 각 빌더 함수의 반환 타입을 그대로 재사용 — 원본 인터페이스가 export되어 있지 않으므로
// ReturnType으로 얻는다 (해당 파일들은 4-1/B1/B3에서 이미 만들어진 계산 단일 소스, 여기서 손대지 않는다).
import type { buildComprehensiveTaxTracker } from "./taxCalculator";
import type { buildForeignCapitalGainsTax } from "./usCapitalGainsTax";
import type { buildShelterContributions } from "./taxShelter";

export type ComprehensiveTaxTrackerResult = ReturnType<typeof buildComprehensiveTaxTracker>;
export type ForeignCapitalGainsTaxResult = ReturnType<typeof buildForeignCapitalGainsTax>;
export type ShelterContributionsResult = ReturnType<typeof buildShelterContributions>;

export type TaxActionKind =
  | "comprehensiveThreshold"
  | "foreignTaxRoom"
  | "foreignTaxHarvest"
  | "shelterLimit"
  | "yearEnd";

export type TaxActionSeverity = "high" | "medium" | "low";

export interface TaxAction {
  kind: TaxActionKind;
  severity: TaxActionSeverity;
  title: string;
  /** 이 액션과 관련된 금액(원) — 임계까지 남은 액수, 절세 가능액 등. 없으면 표시 안 함 */
  amountKRW?: number;
  /** 관련 마감일(YYYY-MM-DD) — 연말 액션의 12/31 등. 없으면 마감 없음 */
  deadline?: string;
  /** 클릭 시 이동할 탭 */
  targetTab: TabId;
}

/** 10월부터 연말 액션·Q4 긴급도 상향을 적용 — 대시보드 위젯 기본 노출 창(10~12월)과 동일 기준 */
const YEAR_END_ACTION_START_MONTH = 10;

const SEVERITY_RANK: Record<TaxActionSeverity, number> = { high: 0, medium: 1, low: 2 };

function monthOf(today: string): number {
  return Number(today.slice(5, 7));
}

/** today→해당 연도 12/31까지 남은 일수 (음수 없음, 자정 KST 기준 — parseIsoLocal로 로컬 파싱해 UTC 경계 오차 방지) */
function daysUntilYearEnd(today: string, year: number): number {
  const from = parseIsoLocal(today);
  const to = parseIsoLocal(`${year}-12-31`);
  if (!from || !to) return 0;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

/** Q4(10~12월)에는 절세 "기회" 액션의 긴급도를 한 단계 올린다 — 연내에만 실행 가능한 항목(손실수확·계좌 납입)이라서다 */
function bumpInQ4(severity: TaxActionSeverity, today: string): TaxActionSeverity {
  if (monthOf(today) < YEAR_END_ACTION_START_MONTH) return severity;
  if (severity === "low") return "medium";
  if (severity === "medium") return "high";
  return "high";
}

interface BuildTaxActionsParams {
  tracker: ComprehensiveTaxTrackerResult;
  foreignTax: ForeignCapitalGainsTaxResult | null;
  shelter: ShelterContributionsResult | null;
  /** KST YYYY-MM-DD */
  today: string;
}

/**
 * 종합과세 임계(B1) 액션 — 초과/근접도에 따라 심각도가 달라진다.
 */
function buildComprehensiveThresholdAction(tracker: ComprehensiveTaxTrackerResult): TaxAction {
  if (tracker.exceeded) {
    return {
      kind: "comprehensiveThreshold",
      severity: "high",
      title: `종합과세 임계를 초과했습니다 (+${formatKRW(Math.round(tracker.ytdGross - tracker.threshold))}) — 내년 5월 종합소득세 신고 대상일 수 있습니다`,
      amountKRW: tracker.ytdGross - tracker.threshold,
      targetTab: "dividends"
    };
  }

  const severity: TaxActionSeverity =
    tracker.pctOfThreshold >= 0.9 ? "high" : tracker.pctOfThreshold >= 0.7 ? "medium" : "low";
  const remainingText = `종합과세 임계까지 ${formatKRW(Math.round(tracker.remainingToThreshold))} 남음`;
  const title = tracker.projectedThresholdDate
    ? `${remainingText} (예상 도달 ${tracker.projectedThresholdDate})`
    : remainingText;

  return {
    kind: "comprehensiveThreshold",
    severity,
    title,
    amountKRW: tracker.remainingToThreshold,
    deadline: tracker.projectedThresholdDate ?? undefined,
    targetTab: "dividends"
  };
}

/**
 * 미국주식 양도세(B3) 액션 — 아직 250만 공제 안이면 "여유", 넘겼고 손실 후보가 있으면 "손실수확".
 * 두 조건은 카드(ForeignCapitalGainsTaxCard)와 동일한 배타 분기라 최대 1개만 나온다.
 */
function buildForeignTaxAction(foreignTax: ForeignCapitalGainsTaxResult, today: string): TaxAction | null {
  if (foreignTax.taxableGain <= 0 && foreignTax.deductionRemaining > 0) {
    return {
      kind: "foreignTaxRoom",
      severity: bumpInQ4("low", today),
      title: `비과세로 실현 가능 이익 250만 중 ${formatKRW(Math.round(foreignTax.deductionRemaining))} 남음`,
      amountKRW: foreignTax.deductionRemaining,
      targetTab: "stocks"
    };
  }
  if (foreignTax.taxableGain > 0 && foreignTax.harvestCandidates.length > 0 && foreignTax.taxSavingIfHarvestAll > 0) {
    return {
      kind: "foreignTaxHarvest",
      severity: bumpInQ4("medium", today),
      title: `손실수확 시 ${formatKRW(Math.round(foreignTax.taxSavingIfHarvestAll))} 절세 (후보 ${foreignTax.harvestCandidates.length}종목)`,
      amountKRW: foreignTax.taxSavingIfHarvestAll,
      targetTab: "stocks"
    };
  }
  return null;
}

/**
 * 절세계좌(4-1) 액션 — ISA·연금 합산 남은 납입 한도와 연금 세액공제 예상액. 계좌를 하나도 지정하지
 * 않았거나(hasShelterAccounts=false) 두 한도가 모두 소진됐으면 더 할 게 없으니 생략한다.
 */
function buildShelterAction(shelter: ShelterContributionsResult, today: string): TaxAction | null {
  if (!shelter.hasShelterAccounts) return null;
  const limitLeft = shelter.isa.limitLeft + shelter.pension.limitLeft;
  if (limitLeft <= 0) return null;

  return {
    kind: "shelterLimit",
    severity: bumpInQ4("low", today),
    title: `ISA/연금 한도 ${formatKRW(Math.round(limitLeft))} 남음 · 세액공제 예상 ${formatKRW(Math.round(shelter.pension.estCredit))}`,
    amountKRW: limitLeft,
    targetTab: "dividends"
  };
}

/**
 * 연말 D-day 액션 — 10월부터 노출(대시보드 위젯 기본 표시 창과 동일). 손실수확·계좌 납입 등 연내에만
 * 실행 가능한 다른 액션들의 마감을 상기시킨다.
 */
function buildYearEndAction(tracker: ComprehensiveTaxTrackerResult, today: string): TaxAction | null {
  if (monthOf(today) < YEAR_END_ACTION_START_MONTH) return null;
  const deadline = `${tracker.year}-12-31`;
  const daysLeft = daysUntilYearEnd(today, tracker.year);
  const severity: TaxActionSeverity = daysLeft <= 14 ? "high" : daysLeft <= 45 ? "medium" : "low";
  return {
    kind: "yearEnd",
    severity,
    title: `연말 정리 D-${daysLeft}일 — 손실수확·절세계좌 납입은 12/31까지만 가능합니다`,
    deadline,
    targetTab: "dividends"
  };
}

/**
 * 우선순위 정렬된 절세 액션 목록. severity(high→low) 순으로 정렬하고, 같은 심각도 안에서는
 * 아래 계산 순서(종합과세 → 해외주식 양도세 → 절세계좌 → 연말 D-day)를 유지한다(안정 정렬).
 */
export function buildTaxActions(params: BuildTaxActionsParams): TaxAction[] {
  const { tracker, foreignTax, shelter, today } = params;

  const actions: TaxAction[] = [buildComprehensiveThresholdAction(tracker)];

  if (foreignTax) {
    const a = buildForeignTaxAction(foreignTax, today);
    if (a) actions.push(a);
  }
  if (shelter) {
    const a = buildShelterAction(shelter, today);
    if (a) actions.push(a);
  }
  const yearEnd = buildYearEndAction(tracker, today);
  if (yearEnd) actions.push(yearEnd);

  return actions
    .map((a, index) => ({ a, index }))
    .sort((x, y) => SEVERITY_RANK[x.a.severity] - SEVERITY_RANK[y.a.severity] || x.index - y.index)
    .map(({ a }) => a);
}
