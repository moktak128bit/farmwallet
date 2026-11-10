import React, { useMemo, useState } from "react";
import { Money } from "../../components/ui/Money";
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
import { formatKRW } from "../../utils/formatter";
import { formatIsoLocal, getTodayKST, parseIsoLocal } from "../../utils/date";
import {
  buildClosedTradeRecords,
  filterByPeriod,
  summarizeRecords,
} from "../../utils/investmentRecord";
import { isDividendEntryLoose } from "../../utils/categoryMatch";
import { toKrwByRate } from "../../utils/currency";
import { isCurrencyExchangeEntry } from "../../utils/categoryUtils";
import type { FxPoint } from "../../utils/portfolioHistory";
import { computeInvestmentTotals } from "./glanceMath";
import { formatGoalProjectionLine, projectGoal } from "../../utils/goalProjection";

interface Props {
  /** summary: 히어로 + 연간 입금 목표 + 손익 한 줄(첫 화면) · details: 나머지 목표·타일·기록(자산 섹션) · 없음: 전부 */
  variant?: "summary" | "details";
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  /** 부모(DashboardPage)가 1회 계산한 값 — 카드에서 재계산하지 않는다 (헤더 주석 정책) */
  balances: AccountBalanceRow[];
  positions: PositionRow[];
  fxRate: number | null;
  /** 월별 순자산 시계열(KRW, 부모 accountTimelineRows total) — 최종 총자산 목표 ETA용. 없으면 ETA 생략 */
  netWorthSeries?: { month: string; value: number }[];
  /** 현재 순자산 — 부모가 대차 단일 소스(computeBalanceSheet)로 1회 계산한 값. 카드 인스턴스마다 대차를 재계산하지 않는다 */
  netWorth: number;
  /** 보유 중이지만 시세가 없는 종목 수 — 원가로 평가되어 누적 손익에 손익 0으로 들어간다(부모 계산) */
  unpricedCount?: number;
  /** 일별 환율 이력 — fxRateAtTrade 없는 USD 거래를 거래일 환율로 환산(주식 탭과 같은 소스). 부모가 1회 계산 */
  fxHistory?: FxPoint[];
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

const CUMULATIVE_PNL_HINT = "증권·crypto 계좌의 지금 평가액(현금+보유 종목) − 순입금 원금. 평가손익·매도 실현손익·배당·이자·수수료가 모두 들어간 투자 총성과";
const REALIZED_HINT = "올해 매도한 종목의 FIFO 실현손익만 (평가손익·배당 제외)";

type EditKey = "annualDeposit" | "finalTotal" | "annualDividend" | "startDate";

/** 배당성 income 항목 판정 — 분류 단일소스(categoryMatch.isDividendEntryLoose) 사용. */
function isDividendEntry(e: LedgerEntry): boolean {
  return e.kind === "income" && isDividendEntryLoose(e);
}

// React.memo — 부모(DashboardPage)가 넘기는 props는 안정적(store 참조·useMemo 결과)이어야 한다.
export const InvestmentSummaryCard: React.FC<Props> = React.memo(function InvestmentSummaryCard({
  accounts,
  ledger,
  trades,
  balances,
  positions,
  fxRate,
  netWorthSeries,
  netWorth,
  unpricedCount = 0,
  variant,
  fxHistory,
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

  // 평가액·순입금 원금·총 손익 — 첫 화면(DashboardGlance)과 같은 단일 정의(glanceMath)
  const { totalInvestmentAssets, principal, cumulativePnl } = useMemo(
    () => computeInvestmentTotals({ accounts, ledger, trades, balances, positions, fxRate }),
    [accounts, ledger, trades, balances, positions, fxRate]
  );

  // 최종 총자산 목표 ETA — 최근 6개월 순자산 페이스 (읽기 전용). investmentGoals에 기한이 없어 ETA만 표시
  const finalTotalEtaHint = useMemo(() => {
    const target = goals.finalTotalAssetTarget;
    if (!target || target <= 0 || !netWorthSeries || netWorthSeries.length === 0) return undefined;
    return formatGoalProjectionLine(
      projectGoal({ series: netWorthSeries, target, method: "trailing6" }),
      (n) => formatKRW(n)
    );
  }, [goals.finalTotalAssetTarget, netWorthSeries]);


  const closedRecords = useMemo(
    () => buildClosedTradeRecords(trades, accounts, fxRate ?? undefined, fxHistory),
    [trades, accounts, fxRate, fxHistory]
  );

  const { monthlyRealizedPnl, monthlyClosedCount } = useMemo(() => {
    const [y, m] = currentMonth.split("-").map(Number);
    const filtered = filterByPeriod(closedRecords, { kind: "month", year: y, month: m });
    return { monthlyRealizedPnl: summarizeRecords(filtered).totalPnl, monthlyClosedCount: filtered.length };
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
      if (isCurrencyExchangeEntry(e)) continue; // 환전 다리는 계좌 안 통화 이동 — 입금 아님 (glanceMath 원금과 같은 정의)
      if (!e.date?.startsWith(currentYear)) continue;
      const toSec = e.toAccountId ? securitiesAccountIds.has(e.toAccountId) : false;
      const fromSec = e.fromAccountId ? securitiesAccountIds.has(e.fromAccountId) : false;
      if (toSec === fromSec) continue;
      const amtKrw = toKrwByRate(e.amount, e.currency, fxRate);
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
      const amt = toKrwByRate(e.amount, e.currency, fxRate);
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

  // 손익 색 — 국내 관례(CLAUDE.md 규칙 4): 이익 = 빨강, 손실 = 파랑. 성공/실패 색(--success/--danger)이 아니다.
  const pnlColor = (v: number) =>
    v > 0 ? "var(--danger)" : v < 0 ? "var(--accent)" : "var(--text-muted)";

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
      {variant !== "details" && (
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div className="card-title">투자 자산</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: "var(--chart-primary)" }}>
          <Money value={totalInvestmentAssets} compact />
        </div>
        {/* 이번 달 매도 실현손익 — 매도가 없으면 "– 이번달 0 원"이 손익이 0인 것처럼 읽혀 숨긴다 */}
        {monthlyClosedCount > 0 && (
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            padding: "3px 10px",
            borderRadius: 12,
            background: monthlyRealizedPnl > 0 ? "var(--danger-light)" : monthlyRealizedPnl < 0 ? "var(--accent-light)" : "var(--border)",
            color: pnlColor(monthlyRealizedPnl),
          }}
        >
          이번 달 매도 실현 {Math.round(monthlyRealizedPnl) > 0 ? "+" : Math.round(monthlyRealizedPnl) < 0 ? "−" : ""}{formatKRW(Math.abs(Math.round(monthlyRealizedPnl)))}
        </span>
        )}
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
          증권·crypto 계좌 현금+포지션 (일반 계좌·부채 제외)
        </span>
      </div>
      )}
      {variant === "details" && <div className="card-title">투자 목표·기록</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {/* 연간 입금액 목표는 첫 화면(summary) 전용 — details에도 두면 섹션을 펼칠 때 같은 행·편집기가 두 개가 된다 */}
        {variant !== "details" && (
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
        )}
        {variant !== "summary" && (
        <GoalRow
          label="최종 순자산 목표 (총자산 − 총부채)"
          progress={netWorth}
          target={goals.finalTotalAssetTarget}
          hint={finalTotalEtaHint}
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
        )}
        {variant !== "summary" && (
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
        )}
      </div>

      {variant === "summary" && (<>
        <div className="hint" style={{ marginTop: 0, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <span title="투자 계좌로 넣은 돈 − 뺀 돈 (+ 시작 잔액)">순입금 원금 {formatKRW(Math.round(principal))}</span>
          <span style={{ color: pnlColor(cumulativePnl), fontWeight: 600 }} title={CUMULATIVE_PNL_HINT}>
            총 손익 {formatKRW(Math.round(cumulativePnl))}{principal > 0 ? ` (${((cumulativePnl / principal) * 100).toFixed(1)}%)` : ""}
          </span>
          <span style={{ color: pnlColor(yearlyRealizedPnl), fontWeight: 600 }} title={REALIZED_HINT}>올해 매도 실현 {formatKRW(Math.round(yearlyRealizedPnl))}</span>
        </div>
        <div className="hint" style={{ marginTop: -8, fontSize: 12 }}>
          총 손익 = 지금 평가액 − 순입금 원금 (평가손익·매도 실현·배당·수수료 모두 포함) · 매도 실현 = 판 종목의 FIFO 차익만
          {unpricedCount > 0 && ` · 시세 없는 ${unpricedCount}종목은 원가로 계산`}
        </div>
      </>)}
      {variant !== "summary" && (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
        }}
      >
        <MiniStat label="순입금 원금" value={formatKRW(Math.round(principal))} color="var(--text-muted)" />
        <MiniStat
          label="총 손익 (평가액 − 원금)"
          value={formatKRW(Math.round(cumulativePnl))}
          color={pnlColor(cumulativePnl)}
          sub={principal > 0 ? `${((cumulativePnl / principal) * 100).toFixed(1)}%${unpricedCount > 0 ? ` · 시세 없는 ${unpricedCount}종목 원가` : ""}` : undefined}
        />
        <MiniStat
          label="이번 달 매도 실현"
          value={formatKRW(Math.round(monthlyRealizedPnl))}
          color={pnlColor(monthlyRealizedPnl)}
        />
        <MiniStat
          label="올해 매도 실현"
          value={formatKRW(Math.round(yearlyRealizedPnl))}
          color={pnlColor(yearlyRealizedPnl)}
        />
      </div>
      )}

      {variant !== "summary" && (<>
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
      </>)}
    </div>
  );
});

interface GoalRowProps {
  label: string;
  progress: number;
  target?: number;
  /** 진행 막대 아래 보조 문구 (예: 목표 ETA). 읽기 전용 */
  hint?: string;
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
  hint,
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
      {hint && (
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{hint}</div>
      )}
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
