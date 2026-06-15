/**
 * 계좌 (AccountsPage) — 오케스트레이터
 * ───────────────────────────────────────────────────────
 * 무거운 파생값(stockMap/cardDebtMap/accountsByType/typeSummary)은 여기서 useMemo로 계산해
 * 분리 컴포넌트(features/accounts/sections/*)에 props로 내려준다. 자식은 재계산하지 않는다.
 *
 * 입력 상태 소유권 (타이핑이 이 페이지를 재렌더하지 않도록 자식이 소유):
 *   - AccountForm           : 계좌 추가 폼 상태
 *   - AccountTablesSection  : 셀 인라인 편집 + 드래그 순서변경 상태
 *   - BalanceBreakdownSection: 펼침 + 시작금액 편집 상태
 *   - InitialReversePanel   : 역산 입력 + 시드 변환 상태 (역산/통합 핸들러 포함)
 *   - AdjustmentModal       : 잔액 조정 입력 상태 + 조정 적용 핸들러
 * 부모는 어떤 모달이 열렸는지(selectedAccount/adjustingAccount)만 소유한다.
 *
 * 자식은 모두 React.memo — 부모가 넘기는 콜백은 setState 그대로 또는 useCallback으로 참조 고정.
 */
import React, { useMemo, useState, useEffect, useCallback } from "react";
import type { Account, AccountType, LedgerEntry, AccountBalanceRow, PositionRow, StockTrade } from "../types";
import { formatKRW } from "../utils/formatter";
import { fetchYahooQuotes } from "../yahooFinanceApi";
import { EmptyState } from "../components/ui/EmptyState";
import { Wallet, Download } from "lucide-react";
import { toast } from "react-hot-toast";
import { computeRealizedPnlByTradeId, positionMarketValueKRW } from "../calculations";
import { getTodayKST } from "../utils/date";
import { useAppStore } from "../store/appStore";
import { buildUnifiedCsv } from "../utils/unifiedCsvExport";
import { AccountForm } from "../features/accounts/sections/AccountForm";
import { TypeSummarySection } from "../features/accounts/sections/TypeSummarySection";
import { TransactionHistoryModal } from "../features/accounts/sections/TransactionHistoryModal";
import { AdjustmentModal } from "../features/accounts/sections/AdjustmentModal";
import { BalanceBreakdownSection } from "../features/accounts/sections/BalanceBreakdownSection";
import { InitialReversePanel } from "../features/accounts/sections/InitialReversePanel";
import { saveSafetySnapshot } from "../services/backupService";
import { AccountTablesSection } from "../features/accounts/sections/AccountTablesSection";

interface Props {
  accounts: Account[];
  balances: AccountBalanceRow[];
  positions: PositionRow[];
  ledger: LedgerEntry[];
  trades?: StockTrade[];
  fxRate?: number | null;
  onChangeAccounts: (next: Account[]) => void;
  onChangeLedger?: (next: LedgerEntry[]) => void;
  onRenameAccountId: (oldId: string, newId: string) => void;
}

export const AccountsView: React.FC<Props> = ({
  accounts,
  balances,
  positions,
  ledger,
  trades = [],
  fxRate = null,
  onChangeAccounts,
  onChangeLedger,
  onRenameAccountId
}) => {
  const storeData = useAppStore((s) => s.data);
  const safeAccounts = useMemo(() => accounts ?? [], [accounts]);
  const safeBalances = useMemo(() => balances ?? [], [balances]);
  const safePositions = useMemo(() => positions ?? [], [positions]);

  const handleExportAllCsv = useCallback(() => {
    const unified = buildUnifiedCsv(storeData.ledger, storeData.trades, storeData.accounts, storeData.categoryPresets);
    const bom = "\uFEFF";
    const blob = new Blob([bom + unified], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const today = getTodayKST();
    a.href = url; a.download = `farmwallet-all-${today}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success("전체 데이터 CSV 다운로드 완료");
  }, [storeData]);
  const [showForm, setShowForm] = useState(false);
  const [adjustingAccount, setAdjustingAccount] = useState<{
    id: string;
    type: AccountType;
  } | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [localFxRate, setLocalFxRate] = useState<number | null>(null);
  const effectiveFxRate = fxRate ?? localFxRate;
  const realizedPnlByTradeId = useMemo(
    () => computeRealizedPnlByTradeId(trades ?? []),
    [trades]
  );

  // FX rate (parent에서 미전달 시 로컬 fetch)
  useEffect(() => {
    if (fxRate != null) return;
    const fetchRate = async () => {
      try {
        const res = await fetchYahooQuotes(["USDKRW=X"]);
        if (res[0]?.price) setLocalFxRate(res[0].price);
      } catch (err) {
        console.warn("환율 조회 실패", err);
      }
    };
    fetchRate();
    const interval = setInterval(fetchRate, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fxRate]);

  const handleAddAccount = useCallback((account: Account) => {
    onChangeAccounts([...safeAccounts, account]);
    setShowForm(false);
  }, [safeAccounts, onChangeAccounts]);

  // memo된 AccountForm에 넘기므로 참조 안정성 필요
  const existingIds = useMemo(() => safeAccounts.map((a) => a.id), [safeAccounts]);

  // memo된 모달들에 넘기는 닫기 콜백 — 참조 고정
  const handleCloseAdjust = useCallback(() => setAdjustingAccount(null), []);
  const handleCloseHistory = useCallback(() => setSelectedAccount(null), []);

  const stockMap = useMemo(() => {
    const map = new Map<string, number>();
    safePositions.forEach((p) => {
      // Include only positive holdings with positive market value.
      if (p.quantity > 0 && p.marketValue > 0) {
        map.set(p.accountId, (map.get(p.accountId) ?? 0) + positionMarketValueKRW(p, effectiveFxRate));
      }
    });
    return map;
  }, [safePositions, effectiveFxRate]);

  const cardDebtMap = useMemo(() => {
    const map = new Map<string, { total: number }>();
    const totalUsage = new Map<string, number>();
    const totalPayment = new Map<string, number>();
    const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
    const cardIds = new Set(safeBalances.filter((r) => r.account.type === "card").map((r) => r.account.id));

    for (const l of ledger) {
      // 신용카드 사용 → 부채 증가 (출금계좌가 카드인 지출, 단 레거시 신용결제 expense 제외)
      if (l.kind === "expense" && l.fromAccountId && l.category !== "신용결제") {
        add(totalUsage, l.fromAccountId, l.amount);
      }
      // 카드 대금 납부 → 부채 탕감: 카드계좌로 들어온 이체(신규 카드결제이체 포함) + 레거시 신용결제 expense
      if (l.toAccountId && cardIds.has(l.toAccountId)) {
        const isPayment =
          l.kind === "transfer" ||
          (l.kind === "expense" && l.category === "신용결제");
        if (isPayment) {
          const amt = l.amount;
          add(totalPayment, l.toAccountId, amt);
        }
      }
    }

    safeBalances.forEach((row) => {
      if (row.account.type === "card") {
        const cardId = row.account.id;
        const usage = totalUsage.get(cardId) ?? 0;
        const payment = totalPayment.get(cardId) ?? 0;
        // total = 현재 카드 부채 (양수=갚을 돈, 음수=선납·환불 잔액).
        // 초기 부채(account.debt)를 포함해 ledger 사용·결제 차감 → "지금 갚을 돈" 한 줄로 표시 가능.
        const initialDebt = row.account.debt ?? 0;
        map.set(cardId, {
          total: initialDebt + usage - payment
        });
      }
    });

    return map;
  }, [safeBalances, ledger]);

  // 계좌 종류별로 묶어서 표시
  const accountsByType = useMemo(() => {
    const grouped = new Map<AccountType, typeof safeBalances>();
    const typeOrder: AccountType[] = ["checking", "savings", "card", "securities", "crypto", "other"];

    typeOrder.forEach((type) => {
      grouped.set(type, []);
    });

    safeBalances.forEach((row) => {
      const type = row.account.type;
      const list = grouped.get(type) ?? [];
      list.push(row);
      grouped.set(type, list);
    });

    return grouped;
  }, [safeBalances]);

  // 카드 제외 목록: "계좌별 잔액 구성" 표와 "계좌 초기 금액 역산" 표가 공유하는 단일 소스
  // (원본 safeBalances 순서 유지 → 두 표가 항상 같은 순서로 나열됨)
  const orderedRowsForInitialReverse = useMemo(
    () => safeBalances.filter((row) => row.account.type !== "card"),
    [safeBalances]
  );

  // Summary by account type
  const typeSummary = useMemo(() => {
    const checking = safeBalances
      .filter((r) => r.account.type === "checking")
      .reduce((s, r) => s + r.currentBalance, 0);
    const savings = safeBalances
      .filter((r) => r.account.type === "savings")
      .reduce((s, r) => s + r.currentBalance, 0);
    // 기타(other) 계좌 잔액 — 대시보드 computeTotalNetWorth와 동일하게 순자산에 포함
    const other = safeBalances
      .filter((r) => r.account.type === "other")
      .reduce((s, r) => s + r.currentBalance, 0);
    // cardDebtMap.total: 양수=부채, 음수=선납 (account.debt 포함).
    const cardNet = Array.from(cardDebtMap.values()).reduce((s, v) => s + v.total, 0);
    const cardDebt = Array.from(cardDebtMap.values()).reduce((s, v) => s + (v.total > 0 ? v.total : 0), 0);
    const cardCredit = Array.from(cardDebtMap.values()).reduce((s, v) => s + (v.total < 0 ? Math.abs(v.total) : 0), 0);
    const securities = safeBalances
      .filter((r) => r.account.type === "securities" || r.account.type === "crypto")
      .reduce((s, row) => {
        const stock = stockMap.get(row.account.id) ?? 0;
        const krw = row.currentBalance;
        const usd = (row.account.usdBalance ?? 0) + (row.usdTransferNet ?? 0);
        // effectiveFxRate: prop 미전달 시 로컬 fetch 폴백 포함 — 주식 환산과 동일 기준
        const usdKrw = effectiveFxRate ? usd * effectiveFxRate : 0;
        return s + stock + krw + usdKrw;
      }, 0);
    // 순자산 계산에는 카드 net(초과결제=+, 미결제=-) 그대로 반영
    // 부채는 빼야 순자산 — cardNet은 양수가 부채라 차감.
    const total = checking + savings + other + securities - cardNet;
    return { checking, savings, other, cardNet, cardDebt, cardCredit, securities, total };
  }, [safeBalances, stockMap, cardDebtMap, effectiveFxRate]);

  return (
    <div>
      <div className="card" style={{ padding: "12px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button type="button" className="primary" onClick={handleExportAllCsv} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Download size={16} /> 전체 데이터 CSV 내보내기
        </button>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>가계부 + 주식거래 통합 CSV 1개 파일</span>
      </div>

      <div className="section-header">
        <h2>계좌</h2>
        <button type="button" className="primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "폼 닫기" : "계좌 추가"}
        </button>
      </div>

      {safeBalances.length > 0 && <TypeSummarySection summary={typeSummary} formatKRW={formatKRW} />}

      {showForm && <AccountForm onAdd={handleAddAccount} existingIds={existingIds} />}

      {/* 계좌 목록 테이블 (유형별) — 분리 컴포넌트 (React.memo). 셀 편집·드래그 상태는 자식 소유 */}
      <AccountTablesSection
        safeAccounts={safeAccounts}
        accountsByType={accountsByType}
        stockMap={stockMap}
        cardDebtMap={cardDebtMap}
        fxRate={effectiveFxRate}
        ledger={ledger}
        trades={trades}
        onChangeAccounts={onChangeAccounts}
        onRenameAccountId={onRenameAccountId}
        onSelectAccount={setSelectedAccount}
        onOpenAdjust={setAdjustingAccount}
      />

      {/* 계좌별 잔액 구성 — 분리 컴포넌트 (React.memo). 펼침·편집 상태는 자식 소유 */}
      <BalanceBreakdownSection
        safeBalances={safeBalances}
        orderedRowsForInitialReverse={orderedRowsForInitialReverse}
        safeAccounts={safeAccounts}
        onChangeAccounts={onChangeAccounts}
        formatKRW={formatKRW}
      />

      {/* 계좌 초기 금액 역산 — 분리 컴포넌트 (React.memo). 역산 입력·시드 변환 상태는 자식 소유 */}
      <InitialReversePanel
        orderedRowsForInitialReverse={orderedRowsForInitialReverse}
        safeAccounts={safeAccounts}
        safeBalances={safeBalances}
        ledger={ledger}
        onChangeAccounts={onChangeAccounts}
        onChangeLedger={onChangeLedger}
        formatKRW={formatKRW}
        saveSnapshot={(reason) => saveSafetySnapshot(storeData, reason)}
      />

      {safeAccounts.length === 0 && (
        <EmptyState
          icon={<Wallet size={48} />}
          title="아직 계좌가 없습니다"
          message="첫 계좌를 추가해 보세요."
          action={{ label: "계좌 추가", onClick: () => setShowForm(true) }}
        />
      )}

      {adjustingAccount && (
        <AdjustmentModal
          adjustingAccount={adjustingAccount}
          safeAccounts={safeAccounts}
          safeBalances={safeBalances}
          cardDebtMap={cardDebtMap}
          ledger={ledger}
          onChangeLedger={onChangeLedger}
          onChangeAccounts={onChangeAccounts}
          fxRate={effectiveFxRate}
          onClose={handleCloseAdjust}
        />
      )}

      {selectedAccount && (
        <TransactionHistoryModal
          account={selectedAccount}
          ledger={ledger}
          trades={trades}
          safeAccounts={safeAccounts}
          safeBalances={safeBalances}
          realizedPnlByTradeId={realizedPnlByTradeId}
          effectiveFxRate={effectiveFxRate}
          onClose={handleCloseHistory}
        />
      )}
    </div>
  );
};
