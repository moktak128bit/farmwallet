/**
 * 지출 성격 3분해 단일 소스 — 고정비(fixed) / 변동비(variable) / 재량(discretionary).
 *
 * 예전엔 고정비 정의가 두 벌이었다:
 *  - utils/expenseClassification.isFixedExpense (인사이트 ExpenseTab·OverviewTab — 플래그 ∪ 고정 대분류+그 중분류)
 *  - features/dashboard/DividendCoverageCard 인라인 (getCategoryType — 플래그 ∪ 고정 대분류 ∪ 주거비/주담대이자 특례)
 * 이 모듈이 둘을 합집합으로 흡수해 대시보드·인사이트가 같은 숫자를 본다.
 *
 * 규칙(우선순위):
 *  0) classifyLedgerFlow(entry) === "expense" 게이트 — 신용결제·환전·저축성지출·투자손실 등 비-실소비는 null.
 *  1) fixed         : entry.isFixedExpense 플래그 ∪ 고정 카테고리 집합(buildFixedCategorySet) ∪ 주거비+주담대이자 특례
 *  2) discretionary : 1단계 휴리스틱 — 대분류(데이트비·의류미용비·문화생활비·유흥오락비·놀이) 또는
 *                     소분류(외식/배달·술/회식·카페·간식) 이름 매칭. category/subCategory/detailCategory 어느 칸에
 *                     있어도 인식(표준 스키마 cat=지출/sub=대분류/det=소분류 + 레거시 cat=대분류/sub=소분류 공존).
 *                     ※ 사용자 지정 `categoryTypes.discretionary`는 2단계(필드 추가)에서 — 지금은 휴리스틱만.
 *  3) variable      : 나머지.
 *
 * 금액은 항상 toKrwByRate(USD 환산). 환율 미로드(null)면 액면 그대로 — 대시보드 공통 정책(toKrwAmount)과 동일.
 */
import type { CategoryPresets, LedgerEntry } from "../types";
import { buildFixedCategorySet, isFixedExpense } from "./expenseClassification";
import { classifyLedgerFlow } from "../features/dashboard/summaryMath";
import { toKrwByRate } from "./currency";

type ExpenseNature = "fixed" | "variable" | "discretionary";

interface ExpenseNatureTotals {
  fixed: number;
  variable: number;
  discretionary: number;
}

/** 재량 지출로 보는 대분류 — 기본 프리셋(dataService.getDefaultCategoryPresets) 이름 기준 휴리스틱 */
export const DISCRETIONARY_MAIN_NAMES = ["데이트비", "의류미용비", "문화생활비", "유흥오락비", "놀이"] as const;
/** 재량 지출로 보는 소분류 — 식비 하위 중 '선택적' 소비 (시장/마트·편의점 등 필수성 소비는 변동비) */
export const DISCRETIONARY_DETAIL_NAMES = ["외식/배달", "술/회식", "카페", "간식"] as const;

const DISCRETIONARY_NAME_SET: ReadonlySet<string> = new Set<string>([
  ...DISCRETIONARY_MAIN_NAMES,
  ...DISCRETIONARY_DETAIL_NAMES,
]);

// 고정 카테고리 집합을 presets 참조별로 캐시 — 수천 건 루프에서 Set 재생성 방지 (categoryUtils.getSavingsSet과 같은 패턴)
const _fixedSetCache = new WeakMap<object, Set<string>>();
let _defaultFixedSet: Set<string> | null = null;

function getFixedSet(presets: CategoryPresets | undefined): Set<string> {
  if (!presets) {
    if (!_defaultFixedSet) _defaultFixedSet = buildFixedCategorySet(undefined);
    return _defaultFixedSet;
  }
  let cached = _fixedSetCache.get(presets);
  if (!cached) {
    cached = buildFixedCategorySet(presets);
    _fixedSetCache.set(presets, cached);
  }
  return cached;
}

/** 항목의 분류 칸 3개(category/subCategory/detailCategory)를 trim해 비어있지 않은 것만 */
function categoryNames(entry: LedgerEntry): string[] {
  const out: string[] = [];
  for (const raw of [entry.category, entry.subCategory, entry.detailCategory]) {
    const v = (raw || "").trim();
    if (v) out.push(v);
  }
  return out;
}

/**
 * 단일 지출 항목의 성격. 실소비 지출이 아니면(classifyLedgerFlow !== "expense") null.
 * 레거시 DividendCoverageCard 인라인 정의와 expenseClassification 정의의 합집합 = fixed.
 */
export function classifyExpenseNature(
  entry: LedgerEntry,
  presets: CategoryPresets | undefined
): ExpenseNature | null {
  if (classifyLedgerFlow(entry, presets) !== "expense") return null;
  const names = categoryNames(entry);
  if (isFixedExpense(entry, getFixedSet(presets))) return "fixed";
  // 주거비의 주담대이자는 고정 목록과 무관하게 고정비 (구 getCategoryType 특례 보존)
  if (names.includes("주거비") && names.includes("주담대이자")) return "fixed";
  if (names.some((n) => DISCRETIONARY_NAME_SET.has(n))) return "discretionary";
  return "variable";
}

function emptyTotals(): ExpenseNatureTotals {
  return { fixed: 0, variable: 0, discretionary: 0 };
}

/**
 * 항목 집합의 3분해 합계(원화 환산). 게이트를 내부에서 적용하므로 이미 걸러진 fExp를 넣어도 결과는 같다.
 */
export function computeExpenseNatureTotals(
  entries: LedgerEntry[],
  presets: CategoryPresets | undefined,
  fxRate: number | null
): ExpenseNatureTotals {
  const t = emptyTotals();
  for (const l of entries) {
    const nature = classifyExpenseNature(l, presets);
    if (!nature) continue;
    t[nature] += toKrwByRate(Number(l.amount), l.currency, fxRate);
  }
  return t;
}

interface ExpenseNatureSeriesOptions {
  /** 진행 중인 달 공정 비교용 — 지정 시 모든 월에서 1~dayCap일 항목만 합산 (컨벤션 13 '동기(1~N일)') */
  dayCap?: number | null;
}

/**
 * 월별(YYYY-MM) 3분해 시계열. months에 적힌 달은 항목이 없어도 0으로 채운다(표 행 누락 방지).
 * months 밖의 항목은 무시.
 */
export function computeExpenseNatureSeries(
  ledger: LedgerEntry[],
  months: readonly string[],
  presets: CategoryPresets | undefined,
  fxRate: number | null,
  options: ExpenseNatureSeriesOptions = {}
): Record<string, ExpenseNatureTotals> {
  const dayCap = options.dayCap ?? null;
  const series: Record<string, ExpenseNatureTotals> = {};
  for (const m of months) series[m] = emptyTotals();
  for (const l of ledger) {
    const month = l.date?.slice(0, 7);
    if (!month) continue;
    const bucket = series[month];
    if (!bucket) continue;
    if (dayCap != null && Number(l.date.slice(8, 10)) > dayCap) continue;
    const nature = classifyExpenseNature(l, presets);
    if (!nature) continue;
    bucket[nature] += toKrwByRate(Number(l.amount), l.currency, fxRate);
  }
  return series;
}
