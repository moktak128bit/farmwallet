/**
 * 대시보드 위젯 단일 정의 — DashboardPage(렌더)와 DashboardWidgetSettings(설정 UI)가 공유.
 * ID·라벨은 DashboardPage가 실제로 렌더하는 위젯과 1:1 대응한다 (순서 = 대시보드 고정 순서).
 *
 * 저장 정책: localStorage에 "숨긴 위젯 ID 배열"만 저장한다.
 *  - 기본값(저장 없음) = 전부 표시
 *  - 신규 위젯이 추가돼도 자동으로 표시됨 (숨김 목록에 없으므로)
 *  - 과거의 죽은 기능이 쓰던 fw-dashboard-widgets(표시 목록) 키와 충돌하지 않도록 새 키 사용
 */
import { STORAGE_KEYS } from "../../constants/config";
import { getTodayKST } from "../../utils/date";

interface DashboardWidgetDef {
  id: string;
  label: string;
  /**
   * true면 기본 표시가 계절부(10~12월)에만 적용된다 — 그 외 달엔 기본 숨김이지만
   * 설정 탭 체크박스로 언제든 켤 수 있다 (4-2 taxActions — 연말이 아니면 위젯 피로).
   * 저장된 숨김 집합의 의미를 "기본값에서 뒤집혔는가"로 해석해 일반 위젯과 저장 스키마를 공유한다:
   * 일반 위젯(기본 표시)은 뒤집히면 숨김(기존 동작 그대로), seasonalOnly 위젯은 비계절엔 기본 숨김이라
   * 뒤집히면 표시된다.
   */
  seasonalOnly?: boolean;
}

/** seasonalOnly 위젯의 기본 노출 창 — 10~12월 (연말 정산·손실수확 시즌) */
function isTaxSeasonKST(today: string): boolean {
  const month = Number(today.slice(5, 7));
  return month >= 10 && month <= 12;
}

/** DashboardPage 렌더 순서와 동일 */
export const DASHBOARD_WIDGETS: DashboardWidgetDef[] = [
  { id: "summary", label: "이번 달 요약 카드 (수입·지출·재테크·수지)" },
  { id: "salaryTimer", label: "월급 실시간 타이머" },
  { id: "monthCompare", label: "전월·전년 대비 (지출/수입)" },
  { id: "investmentSummary", label: "투자 자산 요약·목표" },
  { id: "investmentPerformance", label: "투자 성적표 (시장 대비 — TWR·벤치마크·리스크)" },
  { id: "securitiesValueTrend", label: "증권 평가액·매입금액 추이 (일별)" },
  { id: "netWorthTrend", label: "순자산 추이" },
  { id: "topExpenses", label: "이번 달 최대 지출" },
  { id: "monthlyTrend", label: "월별 추이 (최근 6개월)" },
  { id: "investmentBreakdown", label: "재테크 세부 (저축·투자)" },
  { id: "monthPace", label: "이번 달 페이스 예측" },
  { id: "cashFlow", label: "다가오는 고정 지출 (현금흐름 예측)" },
  { id: "portfolioCharts", label: "포트폴리오 차트" },
  { id: "savingsRatio", label: "저축률 (저번달)" },
  { id: "dividendCoverage", label: "배당 vs 고정비 커버리지" },
  { id: "dividendGrowth", label: "배당 성장 추적 (종목별 분배금·분배율·주가)" },
  { id: "assetComposition", label: "자산 구성" },
  { id: "accountBalanceTrend", label: "계좌별 잔액 추이" },
  { id: "stockCostVsMarket", label: "주식 매입액 vs 평가액" },
  { id: "totalAssetTrend", label: "총자산 추이" },
  { id: "cmaBalanceTrend", label: "CMA 잔액 추이" },
  { id: "spendingCalendar", label: "소비 캘린더" },
  { id: "budgetAlert", label: "예산 관리 (초과 알림)" },
  { id: "taxActions", label: "절세 액션 (10~12월 기본 표시)", seasonalOnly: true },
];

const KNOWN_IDS = new Set(DASHBOARD_WIDGETS.map((w) => w.id));

/** 숨긴 위젯 ID 집합 로드. 알 수 없는 ID(제거된 위젯)는 걸러낸다. */
export function loadHiddenDashboardWidgets(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.DASHBOARD_HIDDEN_WIDGETS);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string" && KNOWN_IDS.has(id)));
  } catch (e) {
    console.warn("[dashboardWidgets] 위젯 숨김 설정 로드 실패", e);
    return new Set();
  }
}

/** 숨긴 위젯 ID 집합 저장 */
export function saveHiddenDashboardWidgets(hidden: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEYS.DASHBOARD_HIDDEN_WIDGETS,
      JSON.stringify(Array.from(hidden))
    );
  } catch (e) {
    console.warn("[dashboardWidgets] 위젯 숨김 설정 저장 실패", e);
  }
}

/**
 * 위젯 표시 여부 — 저장된 집합의 원소는 "기본값에서 뒤집혔는가"를 뜻한다.
 * 일반 위젯: 기본 표시=true이므로 뒤집히면 숨김 (기존 `!hidden.has(id)`와 100% 동일).
 * seasonalOnly 위젯: 계절(10~12월) 밖에선 기본 표시=false라 뒤집히면 표시된다(설정에서 켠 것).
 */
export function isDashboardWidgetVisible(
  id: string,
  hidden: ReadonlySet<string>,
  today: string = getTodayKST()
): boolean {
  const def = DASHBOARD_WIDGETS.find((w) => w.id === id);
  const defaultVisible = def?.seasonalOnly ? isTaxSeasonKST(today) : true;
  return hidden.has(id) ? !defaultVisible : defaultVisible;
}
