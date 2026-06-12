/**
 * 예산 / 반복 지출 (BudgetRecurringView) — 오케스트레이터
 * ───────────────────────────────────────────────────────
 * 무거운 파생값(budgetUsage: 예산별 이번 달 사용액·잔여)은 여기서 useMemo로 계산해
 * 분리 컴포넌트(features/budget/*)에 props로 내려준다. 자식은 재계산하지 않는다.
 *
 * 입력 상태 소유권 (타이핑이 이 뷰를 재렌더하지 않도록 자식이 소유):
 *   - RecurringFormCard    : 고정 지출/구독 폼 상태 (recForm/editingRecurringId)
 *   - BudgetFormCard       : 예산/목표 추가 폼 상태 (budForm)
 *   - RecurringListSection : 목록 인라인 셀 편집 + 선택 + 생성 미리보기 상태
 *   - BudgetGoalsTable     : 예산 테이블 인라인 셀 편집 상태
 *   - DailyBudgetSection   : 상태 없음 (dailyBudget prop 직접 제어)
 *
 * 자식은 모두 React.memo — 부모가 넘기는 콜백은 App 소유 prop 그대로 또는 useCallback으로 참조 고정.
 * 목록 삭제 → 폼 수정 모드 해제 접점만 RecurringFormCardHandle ref API로 연결한다.
 */
import React, { useCallback, useMemo, useRef } from "react";
import type { Account, BudgetGoal, CategoryPresets, RecurringExpense, LedgerEntry, DailyBudgetConfig } from "../types";
import { BUDGET_ALL_CATEGORY } from "../types";
import { getTodayKST } from "../utils/date";
import { DailyBudgetSection } from "../features/budget/DailyBudgetSection";
import { RecurringFormCard, type RecurringFormCardHandle } from "../features/budget/RecurringFormCard";
import { BudgetFormCard } from "../features/budget/BudgetFormCard";
import { RecurringListSection } from "../features/budget/RecurringListSection";
import { BudgetDashboardSection, type BudgetUsageRow } from "../features/budget/BudgetDashboardSection";
import { BudgetGoalsTable } from "../features/budget/BudgetGoalsTable";

interface Props {
  accounts: Account[];
  recurring: RecurringExpense[];
  budgets: BudgetGoal[];
  categoryPresets: CategoryPresets;
  onChangeRecurring: (next: RecurringExpense[]) => void;
  onChangeBudgets: (next: BudgetGoal[]) => void;
  ledger: LedgerEntry[];
  onChangeLedger: (next: LedgerEntry[]) => void;
  /** "하루 N원" 원칙 설정 — 가계부 상단 진행바·streak·월간 카드와 연동 */
  dailyBudget?: DailyBudgetConfig;
  onChangeDailyBudget?: (next: DailyBudgetConfig) => void;
}

export const BudgetRecurringView: React.FC<Props> = ({
  accounts,
  recurring,
  budgets,
  categoryPresets,
  onChangeRecurring,
  onChangeBudgets,
  ledger,
  onChangeLedger,
  dailyBudget,
  onChangeDailyBudget,
}) => {
  // KST 기준 현재 월 (UTC 자정 직전 일/월 경계 오차 방지)
  const currentMonth = getTodayKST().slice(0, 7); // yyyy-mm

  // 목록에서 항목 삭제 시 폼이 그 항목을 수정 중이면 수정 모드 해제 (ref API 경유)
  const recurringFormRef = useRef<RecurringFormCardHandle>(null);
  const handleRecurringDeleted = useCallback((id: string) => {
    recurringFormRef.current?.notifyRecurringDeleted(id);
  }, []);
  // 목록 "수정" 버튼 → 상단 폼을 수정 모드로 전환 (ref API 경유)
  const handleRequestEditRecurring = useCallback((item: RecurringExpense) => {
    recurringFormRef.current?.startEditRecurring(item);
  }, []);

  // 예산 사용액 계산 — 데이터 스키마: cat=지출/수입/이체/신용결제/재테크, sub=식비/.../중분류
  // - 개별 카테고리 (예산 카테고리="식비"): cat="지출" AND sub="식비" 매칭
  // - "전체" 모드: cat="지출"만 합산 (신용결제·재테크·저축성지출 자동 제외) + 사용자 지정 sub 제외
  const budgetUsage = useMemo<BudgetUsageRow[]>(() => {
    return budgets.map((b) => {
      const isTotal = b.category === BUDGET_ALL_CATEGORY;
      const exclCats = new Set(b.excludeCategories ?? []);
      const exclAccts = new Set(b.excludeAccountIds ?? []);
      let spent = 0;
      for (const l of ledger) {
        if (l.kind !== "expense") continue;
        if (!l.date?.startsWith(currentMonth)) continue;
        // 일반 지출만 (신용결제·재테크 등 cat이 "지출"이 아닌 항목은 모두 제외)
        if (l.category !== "지출") continue;
        if (isTotal) {
          // "전체" 모드 — 사용자 지정 sub·계좌 제외 후 합산
          if (l.subCategory && exclCats.has(l.subCategory)) continue;
          if (l.fromAccountId && exclAccts.has(l.fromAccountId)) continue;
          spent += l.amount;
        } else {
          // 개별 카테고리 — sub === b.category (식비/유류교통비/...) 매칭
          if (l.subCategory === b.category) spent += l.amount;
        }
      }
      const remain = b.monthlyLimit - spent;
      return { ...b, spent, remain };
    });
  }, [budgets, ledger, currentMonth]);

  return (
    <div>
      <div className="section-header">
        <h2>예산 / 반복 지출</h2>
      </div>

      {/* 💰 하루 예산 한도 — 가계부 상단 진행 바·streak·월간 카드와 연동 */}
      {onChangeDailyBudget && (
        <DailyBudgetSection dailyBudget={dailyBudget} onChangeDailyBudget={onChangeDailyBudget} />
      )}

      <div className="two-column">
        {/* 고정 지출/구독 폼 — 분리 컴포넌트 (memo+forwardRef). 폼 상태는 자식 소유 */}
        <RecurringFormCard
          ref={recurringFormRef}
          accounts={accounts}
          recurring={recurring}
          onChangeRecurring={onChangeRecurring}
        />

        {/* 예산/목표 추가 폼 — 분리 컴포넌트 (React.memo). 폼 상태는 자식 소유 */}
        <BudgetFormCard
          accounts={accounts}
          categoryPresets={categoryPresets}
          budgets={budgets}
          onChangeBudgets={onChangeBudgets}
        />
      </div>

      {/* 고정 지출/구독 목록 — 분리 컴포넌트 (React.memo). 셀 편집·선택·미리보기 상태는 자식 소유 */}
      <RecurringListSection
        accounts={accounts}
        recurring={recurring}
        ledger={ledger}
        categoryPresets={categoryPresets}
        currentMonth={currentMonth}
        onChangeRecurring={onChangeRecurring}
        onChangeLedger={onChangeLedger}
        onRecurringDeleted={handleRecurringDeleted}
        onRequestEdit={handleRequestEditRecurring}
      />

      {/* ── Budget Visual Dashboard ── */}
      <BudgetDashboardSection budgetUsage={budgetUsage} accounts={accounts} />

      {/* 예산/목표 테이블 — 분리 컴포넌트 (React.memo). 셀 편집 상태는 자식 소유 */}
      <BudgetGoalsTable budgetUsage={budgetUsage} budgets={budgets} onChangeBudgets={onChangeBudgets} />
    </div>
  );
};
