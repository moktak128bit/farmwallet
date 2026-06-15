import React, { useMemo, useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import type {
  Account,
  AccountBalanceRow,
  InvestmentGoals,
  LedgerEntry,
  PositionRow,
  StockTrade,
} from "../../types";
import { useAppStore } from "../../store/appStore";
import {
  positionMarketValueKRW,
  computeTotalNetWorth,
} from "../../calculations";
import { formatKRW } from "../../utils/formatter";
import { formatIsoLocal, getTodayKST, parseIsoLocal } from "../../utils/date";
import {
  buildClosedTradeRecords,
  filterByPeriod,
  summarizeRecords,
} from "../../utils/investmentRecord";
import { isDividendEntry as isDividendByCategory } from "../../utils/categoryMatch";

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  /** 부모(DashboardPage)가 1회 계산한 값 — 카드에서 재계산하지 않는다 (헤더 주석 정책) */
  balances: AccountBalanceRow[];
  positions: PositionRow[];
  fxRate: number | null;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = parseIsoLocal(fromIso);
  const b = parseIsoLocal(toIso);
  if (!a || !b) return 0;
  const diff = b.getTime() - a.getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

function formatPct(num: number, den: number): string {
  if (den <= 0) return "0%";
  return `${Math.round((num / den) * 100)}%`;
}

type EditKey = "annualDeposit" | "finalTotal" | "annualDividend" | "startDate";

/** 배당성 income 항목 판정 — InvestmentRecordCard와 동일 규칙. */
function isDividendEntry(e: LedgerEntry): boolean {
  if (e.kind !== "income") return false;
  // 분류 단일소스(categoryMatch) — cat/sub 정확 매칭 + description fallback
  return isDividendByCategory(e) || (e.description ?? "").includes("배당");
}

// React.memo — 부모(DashboardPage)가 넘기는 props는 안정적(store 참조·useMemo 결과)이어야 한다.
export const InvestmentSummaryCard: React.FC<Props> = React.memo(function InvestmentSummaryCard({
  accounts,
  ledger,
  trades,
  balances,
  positions,
  fxRate,
}) {
  const setData = useAppStore((s) => s.setData);
  const goalsRaw = useAppStore((s) => s.data.investmentGoals);
  const goals: InvestmentGoals = useMemo(() => goalsRaw ?? {}, [goalsRaw]);

  const today = useMemo(() => getTodayKST(), []);
  const currentYear = today.slice(0, 4);
  const currentMonth = today.slice(0, 7);

  const securitiesAccountIds = useMemo(() => {
    const set = new Set<string>();
    for (const a of accounts) {
      if (a.type === "securities" || a.type === "crypto") set.add(a.id);
    }
    return set;
  }, [accounts]);

  const totalInvestmentAssets = useMemo(() => {
    let total = 0;
    for (const row of balances) {
      if (!securitiesAccountIds.has(row.account.id)) continue;
      total += row.currentBalance;
      const usdCash = (row.account.usdBalance ?? 0) + (row.usdTransferNet ?? 0);
      if (usdCash && fxRate) total += usdCash * fxRate;
    }
    for (const p of positions) {
      if (!securitiesAccountIds.has(p.accountId)) continue;
      total += positionMarketValueKRW(p, fxRate);
    }
    return total;
  }, [balances, positions, securitiesAccountIds, fxRate]);

  // 총자산 목표 진행률용: 모든 계좌 + 포지션 - 부채 (= 순자산)
  const loans = useAppStore((s) => s.data.loans);
  const totalNetWorth = useMemo(
    () => computeTotalNetWorth(balances, positions, fxRate, loans, ledger),
    [balances, positions, fxRate, loans, ledger]
  );

  const principal = useMemo(() => {
    let p = 0;
    for (const a of accounts) {
      if (!securitiesAccountIds.has(a.id)) continue;
      p += a.initialBalance ?? 0;
      p += a.initialCashBalance ?? 0;
    }
    for (const e of ledger) {
      if (e.kind !== "transfer") continue;
      const toSec = e.toAccountId ? securitiesAccountIds.has(e.toAccountId) : false;
      const fromSec = e.fromAccountId ? securitiesAccountIds.has(e.fromAccountId) : false;
      if (toSec === fromSec) continue;
      const amtKrw = e.currency === "USD" && fxRate ? e.amount * fxRate : e.amount;
      if (toSec) p += amtKrw;
      else if (fromSec) p -= amtKrw;
    }
    return p;
  }, [accounts, ledger, securitiesAccountIds, fxRate]);

  const cumulativePnl = totalInvestmentAssets - principal;

  const closedRecords = useMemo(
    () => buildClosedTradeRecords(trades, accounts, fxRate ?? undefined),
    [trades, accounts, fxRate]
  );

  const monthlyRealizedPnl = useMemo(() => {
    const [y, m] = currentMonth.split("-").map(Number);
    const filtered = filterByPeriod(closedRecords, { kind: "month", year: y, month: m });
    return summarizeRecords(filtered).totalPnl;
  }, [closedRecords, currentMonth]);

  const yearlyRealizedPnl = useMemo(() => {
    const y = Number(currentYear);
    const filtered = filterByPeriod(closedRecords, { kind: "year", year: y });
    return summarizeRecords(filtered).totalPnl;
  }, [closedRecords, currentYear]);

  const ytdDeposits = useMemo(() => {
    let amt = 0;
    for (const e of ledger) {
      if (e.kind !== "transfer") continue;
      if (!e.date?.startsWith(currentYear)) continue;
      const toSec = e.toAccountId ? securitiesAccountIds.has(e.toAccountId) : false;
      const fromSec = e.fromAccountId ? securitiesAccountIds.has(e.fromAccountId) : false;
      if (toSec === fromSec) continue;
      const amtKrw = e.currency === "USD" && fxRate ? e.amount * fxRate : e.amount;
      if (toSec) amt += amtKrw;
      else if (fromSec) amt -= amtKrw;
    }
    return amt;
  }, [ledger, securitiesAccountIds, currentYear, fxRate]);

  const startDate = useMemo(() => {
    if (goals.investmentStartDate) return goals.investmentStartDate;
    let earliest: string | undefined;
    for (const t of trades) {
      if (!t.date) continue;
      if (!earliest || t.date < earliest) earliest = t.date;
    }
    return earliest ?? today;
  }, [goals.investmentStartDate, trades, today]);

  const daysInvesting = useMemo(() => daysBetween(startDate, today), [startDate, today]);

  /** 최근 12개월(오늘 포함 직전 12개월) 누적 배당 수령액 — 연간 배당금 목표 진행률 측정. */
  const trailing12MoDividend = useMemo(() => {
    // KST-safe: 로컬 파싱(parseIsoLocal) → 12개월 빼기 → 로컬 포맷. toISOString(UTC) 사용 금지
    const cutoff = parseIsoLocal(today) ?? new Date();
    cutoff.setMonth(cutoff.getMonth() - 12);
    const cutoffIso = formatIsoLocal(cutoff);
    let total = 0;
    for (const e of ledger) {
      if (!isDividendEntry(e)) continue;
      if (!e.date || e.date < cutoffIso || e.date > today) continue;
      const amt = e.currency === "USD" && fxRate ? e.amount * fxRate : e.amount;
      total += amt;
    }
    return total;
  }, [ledger, today, fxRate]);

  const [editing, setEditing] = useState<EditKey | null>(null);
  const [draft, setDraft] = useState<string>("");

  const startEdit = (key: EditKey) => {
    setEditing(key);
    if (key === "annualDeposit") setDraft(String(goals.annualDepositTarget ?? ""));
    else if (key === "finalTotal") setDraft(String(goals.finalTotalAssetTarget ?? ""));
    else if (key === "annualDividend") setDraft(String(goals.targetAnnualDividend ?? ""));
    else if (key === "startDate") setDraft(goals.investmentStartDate ?? startDate);
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft("");
  };

  const saveEdit = () => {
    if (!editing) return;
    const key = editing;
    setData((prev) => {
      const nextGoals: InvestmentGoals = { ...(prev.investmentGoals ?? {}) };
      if (key === "annualDeposit") {
        const n = Number(draft.replace(/[^\d.-]/g, ""));
        nextGoals.annualDepositTarget = Number.isFinite(n) && n > 0 ? n : undefined;
      } else if (key === "finalTotal") {
        const n = Number(draft.replace(/[^\d.-]/g, ""));
        nextGoals.finalTotalAssetTarget = Number.isFinite(n) && n > 0 ? n : undefined;
      } else if (key === "annualDividend") {
        const n = Number(draft.replace(/[^\d.-]/g, ""));
        nextGoals.targetAnnualDividend = Number.isFinite(n) && n > 0 ? n : undefined;
      } else if (key === "startDate") {
        nextGoals.investmentStartDate = /^\d{4}-\d{2}-\d{2}$/.test(draft) ? draft : undefined;
      }
      return { ...prev, investmentGoals: nextGoals };
    });
    setEditing(null);
    setDraft("");
  };

  const pnlColor = (v: number) =>
    v > 0 ? "var(--success)" : v < 0 ? "var(--danger)" : "var(--text-muted)";

  return (
    <div
      className="card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        borderLeft: "4px solid var(--chart-primary)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div className="card-title">투자 자산</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: "var(--chart-primary)" }}>
          {formatKRW(Math.round(totalInvestmentAssets))}
        </div>
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            padding: "3px 10px",
            borderRadius: 12,
            background: monthlyRealizedPnl > 0 ? "rgba(34,197,94,0.12)" : monthlyRealizedPnl < 0 ? "rgba(239,68,68,0.12)" : "var(--border)",
            color: pnlColor(monthlyRealizedPnl),
          }}
        >
          {monthlyRealizedPnl > 0 ? "▲" : monthlyRealizedPnl < 0 ? "▼" : "–"} 이번달 {formatKRW(Math.round(Math.abs(monthlyRealizedPnl)))}
        </span>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
          증권·crypto 계좌 현금+포지션 (일반 계좌·부채 제외)
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <GoalRow
          label="연간 입금액 목표"
          progress={ytdDeposits}
          target={goals.annualDepositTarget}
          isEditing={editing === "annualDeposit"}
          draft={draft}
          onStartEdit={() => startEdit("annualDeposit")}
          onDraftChange={setDraft}
          onSave={saveEdit}
          onCancel={cancelEdit}
          inputType="number"
          formatValue={(v) => formatKRW(Math.round(v))}
          placeholder="목표 금액 (원)"
        />
        <GoalRow
          label="최종 총자산 목표 (전 계좌 − 부채)"
          progress={totalNetWorth}
          target={goals.finalTotalAssetTarget}
          isEditing={editing === "finalTotal"}
          draft={draft}
          onStartEdit={() => startEdit("finalTotal")}
          onDraftChange={setDraft}
          onSave={saveEdit}
          onCancel={cancelEdit}
          inputType="number"
          formatValue={(v) => formatKRW(Math.round(v))}
          placeholder="목표 금액 (원)"
        />
        <GoalRow
          label="연간 배당금 수령액 목표 (현금 흐름 · 최근 12개월)"
          progress={trailing12MoDividend}
          target={goals.targetAnnualDividend}
          isEditing={editing === "annualDividend"}
          draft={draft}
          onStartEdit={() => startEdit("annualDividend")}
          onDraftChange={setDraft}
          onSave={saveEdit}
          onCancel={cancelEdit}
          inputType="number"
          formatValue={(v) => formatKRW(Math.round(v))}
          placeholder="목표 금액 (원/년)"
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
        }}
      >
        <MiniStat label="원금" value={formatKRW(Math.round(principal))} color="var(--text-muted)" />
        <MiniStat
          label="누적 손익"
          value={formatKRW(Math.round(cumulativePnl))}
          color={pnlColor(cumulativePnl)}
          sub={principal > 0 ? `${((cumulativePnl / principal) * 100).toFixed(1)}%` : undefined}
        />
        <MiniStat
          label="이번달 손익"
          value={formatKRW(Math.round(monthlyRealizedPnl))}
          color={pnlColor(monthlyRealizedPnl)}
        />
        <MiniStat
          label="올해 손익"
          value={formatKRW(Math.round(yearlyRealizedPnl))}
          color={pnlColor(yearlyRealizedPnl)}
        />
      </div>

      <div
        style={{
          fontSize: 13,
          color: "var(--text-muted)",
          textAlign: "center",
          padding: "6px 0",
          borderTop: "1px dashed var(--border)",
        }}
      >
        벌써 <strong style={{ color: "var(--chart-primary)" }}>{daysInvesting.toLocaleString()}</strong>일째
        투자중이에요!
      </div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text-muted)",
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 6,
        }}
      >
        {editing === "startDate" ? (
          <>
            <span>시작일:</span>
            <input
              type="date"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{ fontSize: 11, padding: "2px 6px" }}
            />
            <button
              type="button"
              onClick={saveEdit}
              style={{ padding: 2, background: "transparent", border: "none", cursor: "pointer" }}
              aria-label="저장"
            >
              <Check size={12} color="var(--success)" />
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              style={{ padding: 2, background: "transparent", border: "none", cursor: "pointer" }}
              aria-label="취소"
            >
              <X size={12} color="var(--danger)" />
            </button>
          </>
        ) : (
          <>
            <span>
              시작일: {startDate}
              {!goals.investmentStartDate && " (자동: 첫 거래일)"}
            </span>
            <button
              type="button"
              onClick={() => startEdit("startDate")}
              style={{ padding: 2, background: "transparent", border: "none", cursor: "pointer" }}
              aria-label="시작일 편집"
            >
              <Pencil size={10} color="var(--text-muted)" />
            </button>
          </>
        )}
      </div>
    </div>
  );
});

interface GoalRowProps {
  label: string;
  progress: number;
  target?: number;
  isEditing: boolean;
  draft: string;
  onStartEdit: () => void;
  onDraftChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  inputType: "number" | "date";
  formatValue: (v: number) => string;
  placeholder: string;
}

const GoalRow: React.FC<GoalRowProps> = ({
  label,
  progress,
  target,
  isEditing,
  draft,
  onStartEdit,
  onDraftChange,
  onSave,
  onCancel,
  inputType,
  formatValue,
  placeholder,
}) => {
  const pct = target && target > 0 ? Math.min(100, (progress / target) * 100) : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{label}</span>
        {isEditing ? (
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input
              type={inputType}
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              placeholder={placeholder}
              style={{ fontSize: 12, padding: "2px 6px", width: 140 }}
            />
            <button
              type="button"
              onClick={onSave}
              style={{ padding: 2, background: "transparent", border: "none", cursor: "pointer" }}
              aria-label="저장"
            >
              <Check size={14} color="var(--success)" />
            </button>
            <button
              type="button"
              onClick={onCancel}
              style={{ padding: 2, background: "transparent", border: "none", cursor: "pointer" }}
              aria-label="취소"
            >
              <X size={14} color="var(--danger)" />
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {target ? formatValue(target) : "미설정"}
            </span>
            <button
              type="button"
              onClick={onStartEdit}
              style={{
                padding: "4px 10px",
                background: "var(--primary-light, #dbeafe)",
                color: "var(--primary, #2563eb)",
                border: "1px solid var(--primary, #2563eb)",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
              aria-label={`${label} 편집`}
            >
              <Pencil size={12} />
              {target ? "수정" : "설정"}
            </button>
          </div>
        )}
      </div>
      <ProgressBar
        pct={pct}
        label={
          target && target > 0
            ? `${formatValue(progress)} / ${formatValue(target)} (${formatPct(progress, target)})`
            : "목표를 설정하면 진행률이 표시됩니다"
        }
      />
    </div>
  );
};

const ProgressBar: React.FC<{ pct: number; label: string }> = ({ pct, label }) => {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        style={{
          width: "100%",
          height: 8,
          background: "var(--border)",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${clamped}%`,
            height: "100%",
            background: "var(--chart-primary)",
            transition: "width 0.3s",
          }}
        />
      </div>
      <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
};

const MiniStat: React.FC<{ label: string; value: string; color: string; sub?: string }> = ({
  label,
  value,
  color,
  sub,
}) => (
  <div
    style={{
      padding: "10px 12px",
      background: "var(--bg-subtle, var(--border))",
      borderRadius: 6,
      display: "flex",
      flexDirection: "column",
      gap: 2,
    }}
  >
    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
    {sub && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{sub}</div>}
  </div>
);
