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

export interface DashboardWidgetDef {
  id: string;
  label: string;
}

/** DashboardPage 렌더 순서와 동일 */
export const DASHBOARD_WIDGETS: DashboardWidgetDef[] = [
  { id: "summary", label: "이번 달 요약 카드 (수입·지출·재테크·수지)" },
  { id: "salaryTimer", label: "월급 실시간 타이머" },
  { id: "monthCompare", label: "전월·전년 대비 (지출/수입)" },
  { id: "investmentSummary", label: "투자 자산 요약·목표" },
  { id: "netWorthTrend", label: "순자산 추이" },
  { id: "topExpenses", label: "이번 달 최대 지출" },
  { id: "monthlyTrend", label: "월별 추이 (최근 6개월)" },
  { id: "investmentBreakdown", label: "재테크 세부 (저축·투자)" },
  { id: "monthPace", label: "이번 달 페이스 예측" },
  { id: "portfolioCharts", label: "포트폴리오 차트" },
  { id: "savingsRatio", label: "저축률 (저번달)" },
  { id: "dividendCoverage", label: "배당 vs 고정비 커버리지" },
  { id: "assetComposition", label: "자산 구성" },
  { id: "accountBalanceTrend", label: "계좌별 잔액 추이" },
  { id: "stockCostVsMarket", label: "주식 매입액 vs 평가액" },
  { id: "totalAssetTrend", label: "총자산 추이" },
  { id: "cmaBalanceTrend", label: "CMA 잔액 추이" },
  { id: "spendingCalendar", label: "소비 캘린더" },
  { id: "budgetAlert", label: "예산 관리 (초과 알림)" },
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
