/**
 * 인사이트 파생 데이터셋(D) 계산 훅 — InsightsPage에서 분리.
 * 가계부·거래 원본을 받아 탭들이 공유하는 대형 memo 데이터셋(D)을 반환한다.
 *
 * 2단 분층(동작 불변 리팩터):
 *   1) buildInsightsBase  — 전기간 집계(월별 맵·추세·중분류 월별 합계·포지션·FIFO·계좌 잔액). 데이터·환율·프리셋이
 *      바뀔 때만 재계산.
 *   2) sliceInsightsForMonth — 선택월(selMonth) 파생. 월 선택만 바뀌면 이 단계만 다시 돈다.
 * 예전엔 하나의 useMemo(11 deps)가 selMonth 변경에도 전 기간을 재계산했다.
 * 출력 D의 키·값은 골든 스냅샷(src/__tests__/insightsDataGolden.test.tsx)으로 고정.
 */
import { useMemo } from "react";
import type { Account, LedgerEntry, StockTrade, StockPrice, CategoryPresets, BudgetGoal } from "../../types";
import type { AccountTimelineRow } from "../../utils/accountTimeline";
import type { D } from "./insightsShared";
import { buildInsightsBase } from "./insightsBase";
import { sliceInsightsForMonth } from "./insightsSlice";

// _budgetGoals: 예산 vs 실적 파생 제거(대시보드 BudgetAlertWidget 단일화) 후 미사용 — 호출부 시그니처 유지용
// timelineRows: 대시보드와 동일한 순자산 타임라인(시세·환율·대출 반영) — InsightsPage가 전체 기간으로 1회 계산
// allLedger: 기간 필터 전 전체 가계부 — 계좌별 현재 잔액(누적)의 정확성을 위해 별도 전달
export function useInsightsData(ledger: LedgerEntry[], rawTrades: StockTrade[], allTrades: StockTrade[], accounts: Account[], prices: StockPrice[], selMonth: string | null, categoryPresets: CategoryPresets | undefined, _budgetGoals: BudgetGoal[] | undefined, dateAccountId: string | null, fxRate: number | null, timelineRows: AccountTimelineRow[], allLedger: LedgerEntry[]): D {
  // dateAccountId는 실질 흐름(realFlows)·분담 통장 흐름(moimFlow) 등 전기간 집계의 입력이라 base deps에 둔다(설정값 — 드물게 변경).
  const base = useMemo(
    () => buildInsightsBase({ ledger, rawTrades, allTrades, accounts, prices, categoryPresets, dateAccountId, fxRate, timelineRows, allLedger }),
    [ledger, rawTrades, allTrades, accounts, prices, categoryPresets, dateAccountId, fxRate, timelineRows, allLedger],
  );
  return useMemo(() => sliceInsightsForMonth(base, selMonth), [base, selMonth]);
}
