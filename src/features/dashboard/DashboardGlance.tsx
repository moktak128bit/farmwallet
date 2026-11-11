/**
 * 대시보드 첫 화면 — "질문 3열" (이번 달 얼마 썼나 · 내 자산은 · 투자·배당은) + 확인할 일 한 줄.
 *
 * 원칙: 기둥마다 큰 숫자 하나 + 보조 2~3줄. 같은 숫자를 두 번 보여주지 않는다.
 * 모든 값은 부모(DashboardPage)가 1회 계산해 넘긴다 — 여기서는 표시와 탭 이동만 한다(memo 계약).
 * 기둥 전체가 버튼: 가계부 / 계좌 / 주식 탭으로 이동.
 */
import React, { useMemo } from "react";
import { ResponsiveContainer, LineChart, Line, YAxis } from "recharts";
import { ArrowUpRight, Camera, CreditCard, Repeat, CalendarClock } from "lucide-react";
import type { BalanceSheet } from "../../calculations";
import type { DividendPortfolio } from "../../utils/dividendPortfolio";
import { Money } from "../../components/ui/Money";
import { formatKRW, formatKrwCompact } from "../../utils/formatter";
import { parseIsoLocal } from "../../utils/date";
import { useUIStore } from "../../store/uiStore";
import { useGasPhotoStore, selectPendingPhotoCount } from "../../store/gasPhotoStore";
import { OPEN_RECURRING_DUE_EVENT } from "../../components/RecurringDueBadge";
import { requestSettingsTab } from "../../utils/settingsTabRequest";
import type { InvestmentTotals, MonthPace, NextLoanMaturity } from "./glanceMath";

/** 마지막 기록 후 이 일수 이상이면 '기록 공백'으로 강조 */
const STALE_DAYS = 3;
/** 평소 같은 기간 대비 이 배수를 넘으면 경고색 */
const OVER_PACE = 1.3;

interface Props {
  today: string;
  lastRecordDate: string | null;
  /** 이번 달 지출(KPI 정의 — computeLedgerSummary) */
  monthExpense: number;
  monthIncome: number;
  monthInvesting: number;
  beforePayday: boolean;
  pace: MonthPace;
  bs: BalanceSheet;
  /** 월별 순자산(KRW) — accountTimelineRows.total */
  netWorthSeries: { month: string; value: number }[];
  /** 위 시계열의 평가 기준 — cost면 지난 월말에 종가가 없어 원가 기준으로 맞춘 것 */
  netWorthBasis: "market" | "cost";
  nextLoan: NextLoanMaturity | null;
  invest: InvestmentTotals;
  /** 보유 종목 전부 시세 없음 → 총 손익 미확정 */
  allUnpriced: boolean;
  /** 지금 시세 갱신 중 — allUnpriced일 때 '불러오는 중'(true)과 '받지 못함'(false)을 가른다 */
  quotesLoading: boolean;
  unpricedCount: number;
  /** 보유 종목 평가손익(시가 − 원가) — 주식 탭과 같은 숫자. 시세 미로드면 null */
  unrealizedPnl: number | null;
  /** 거래 당시 환율을 알 수 없어 실현손익에서 뺀 매도 건수 */
  excludedUnreliable: number;
  dividend: DividendPortfolio | null;
  recurringMissing: number;
}

const signed = (n: number) => `${Math.round(n) > 0 ? "+" : Math.round(n) < 0 ? "−" : ""}${formatKrwCompact(Math.abs(n))}`;
/** 손익·증감 색 — 국내 관례(상승 빨강 / 하락 파랑), 0은 중립 */
const trendColor = (n: number) => (Math.round(n) > 0 ? "var(--chart-income)" : Math.round(n) < 0 ? "var(--chart-expense)" : "var(--text-muted)");

function monthDayLabel(iso: string): string {
  return `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;
}

export const DashboardGlance: React.FC<Props> = React.memo(function DashboardGlance({
  today,
  lastRecordDate,
  monthExpense,
  monthIncome,
  monthInvesting,
  beforePayday,
  pace,
  bs,
  netWorthSeries,
  netWorthBasis,
  nextLoan,
  invest,
  allUnpriced,
  quotesLoading,
  unpricedCount,
  unrealizedPnl,
  excludedUnreliable,
  dividend,
  recurringMissing,
}) {
  const setTab = useUIStore((s) => s.setTab);

  // 처리 전 사진 — GAS에서만. 목록은 헤더 사진 버튼과 공유(store/gasPhotoStore), 조회 실패면 칩을 숨긴다
  const pendingPhotos = useGasPhotoStore(selectPendingPhotoCount);

  const lag = useMemo(() => {
    const a = lastRecordDate ? parseIsoLocal(lastRecordDate) : null;
    const b = parseIsoLocal(today);
    return a && b ? Math.round((b.getTime() - a.getTime()) / 86400000) : null;
  }, [lastRecordDate, today]);
  const stale = lag != null && lag >= STALE_DAYS;

  // ── 이번 달 ──
  const recordedNote =
    pace.elapsed === 0 ? "이번 달 기록 전" : lag != null && lag > 0 && lastRecordDate?.slice(0, 7) === today.slice(0, 7) ? `${pace.elapsed}일까지 기록` : `1~${pace.elapsed}일`;
  const ratio = pace.avgPrevPartial > 0 && pace.elapsed > 0 ? pace.currentExpense / pace.avgPrevPartial : null;
  const over = ratio != null && ratio > OVER_PACE;
  // 막대: 평소 월 전체(avgPrev3) 대비 지금까지 쓴 비율, 표시선 = 평소 이맘때 위치
  const barScale = Math.max(pace.avgPrev3, pace.currentExpense, 1);
  const fillPct = Math.min(100, (pace.currentExpense / barScale) * 100);
  const markPct = pace.avgPrev3 > 0 ? Math.min(100, (pace.avgPrevPartial / barScale) * 100) : null;
  const balance = monthIncome - monthExpense;

  // ── 내 자산 ──
  // 마지막 점은 지금 순자산(시가) — 지난 점이 원가 기준이어도 "지금까지 실제로 얼마나 늘었나"는
  // 현재 평가손익까지 포함해야 한다(평가손실을 증가로 더하지 않게). 중간 점끼리는 같은 기준.
  const spark = useMemo(() => {
    const s = netWorthSeries.slice(-18);
    if (s.length === 0) return s;
    return [...s.slice(0, -1), { month: s[s.length - 1].month, value: bs.netWorth }];
  }, [netWorthSeries, bs.netWorth]);
  // 시작 → 지금 증가액은 화면의 큰 숫자(시가 순자산)에서 바로 빼서 "시작 + 증가 = 지금"이 맞게 한다.
  // 원가 기준 시계열이면 마지막 점(원가)과 지금(시가)의 차이 = 평가손익 → 증가액 안에 몇이 들었는지 밝힌다.
  const sparkDelta = spark.length >= 2 ? bs.netWorth - spark[0].value : null;
  const sparkUnrealized = spark.length >= 2 && netWorthBasis === "cost" ? bs.netWorth - spark[spark.length - 1].value : null;
  const debtParts = [
    bs.loanDebt > 0 ? `대출 ${formatKrwCompact(bs.loanDebt)}` : null,
    bs.cardDebt > 0 ? `카드 ${formatKrwCompact(bs.cardDebt)}` : null,
    bs.overdraft > 0 ? `마통 ${formatKrwCompact(bs.overdraft)}` : null,
  ].filter(Boolean).join(" · ");

  // ── 투자·배당 ──
  const pnlPct = invest.principal > 0 ? (invest.cumulativePnl / invest.principal) * 100 : null;
  const divNames = useMemo(
    () => (dividend?.tickers ?? []).filter((t) => t.excluded == null).map((t) => t.name || t.ticker),
    [dividend]
  );

  // ── 확인할 일 ──
  const chips: Array<{ key: string; icon: React.ReactNode; label: string; onClick: () => void; warn?: boolean }> = [];
  if (recurringMissing > 0) {
    chips.push({ key: "recurring", icon: <Repeat size={13} aria-hidden />, label: `미등록 반복지출 ${recurringMissing}건`, onClick: () => window.dispatchEvent(new CustomEvent(OPEN_RECURRING_DUE_EVENT)) });
  }
  if (bs.cardDebt > 0) {
    chips.push({ key: "card", icon: <CreditCard size={13} aria-hidden />, label: `카드 갚을 돈 ${formatKrwCompact(bs.cardDebt)}원`, onClick: () => setTab("accounts") });
  }
  if (stale) {
    chips.push({ key: "gap", icon: <CalendarClock size={13} aria-hidden />, label: `기록 공백 ${lag}일`, onClick: () => setTab("ledger"), warn: true });
  }
  if (pendingPhotos != null && pendingPhotos > 0) {
    chips.push({
      key: "photos",
      icon: <Camera size={13} aria-hidden />,
      label: `처리 전 사진 ${pendingPhotos}장`,
      onClick: () => {
        requestSettingsTab("photos");
        setTab("settings");
      },
    });
  }

  return (
    <div className="glance">
      {lastRecordDate && (
        <div className="glance-caption" title="가계부에 기록된 가장 최근 날짜. 캡처를 모아 입력하면 그 뒤 거래는 아직 숫자에 없습니다.">
          마지막 기록 {monthDayLabel(lastRecordDate)}
          {lag != null && lag > 0 && !stale ? ` · ${lag}일 전` : lag === 0 ? " · 오늘" : ""}
        </div>
      )}

      <div className="glance-grid">
        {/* 이번 달 얼마 썼나 */}
        <button type="button" className="glance-col" onClick={() => setTab("ledger")} aria-label="이번 달 얼마 썼나 — 가계부로 이동">
          <span className="glance-q">이번 달 얼마 썼나 <ArrowUpRight size={14} aria-hidden /></span>
          <span className="glance-big" style={{ color: "var(--chart-expense)" }}>
            <Money value={Math.round(monthExpense)} />
          </span>
          <span className="glance-line">
            {recordedNote}
            {ratio != null && (
              <>
                {" · 평소 이맘때 "}
                {formatKrwCompact(pace.avgPrevPartial)}원의{" "}
                <b style={{ color: over ? "var(--danger)" : "var(--text)" }}>{Math.round(ratio * 100)}%</b>
              </>
            )}
          </span>
          {pace.avgPrev3 > 0 && (
            <span className="glance-bar" role="img" aria-label={`평소 월 지출 ${formatKRW(Math.round(pace.avgPrev3))} 중 ${Math.round(fillPct)}% 사용`}>
              <span className="glance-bar-fill" style={{ width: `${fillPct}%`, background: over ? "var(--danger)" : "var(--chart-expense)" }} />
              {markPct != null && <span className="glance-bar-mark" style={{ left: `${markPct}%` }} />}
            </span>
          )}
          <span className="glance-sub">
            {pace.avgPrev3 > 0 ? `평소 월 ${formatKrwCompact(pace.avgPrev3)}원 (최근 3개월)` : "비교할 지난 달 기록 없음"}
            {" · "}
            {beforePayday ? "급여 전" : <>수지 <b style={{ color: trendColor(balance) }}>{signed(balance)}원</b></>}
            {Math.round(monthInvesting) !== 0 && ` · 재테크 ${formatKrwCompact(monthInvesting)}원 별도`}
          </span>
        </button>

        {/* 내 자산은 */}
        <button type="button" className="glance-col" onClick={() => setTab("accounts")} aria-label="내 자산은 — 계좌로 이동">
          <span className="glance-q">내 자산은 <ArrowUpRight size={14} aria-hidden /></span>
          <span className="glance-big-row">
            <span className="glance-big" style={{ color: bs.netWorth < 0 ? "var(--danger)" : "var(--text)" }}>
              <Money value={bs.netWorth} compact />
            </span>
            {spark.length >= 2 && (
              <span className="glance-spark" aria-hidden>
                <ResponsiveContainer width="100%" height={40}>
                  <LineChart data={spark} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
                    <YAxis hide domain={["dataMin", "dataMax"]} />
                    <Line type="monotone" dataKey="value" stroke="var(--chart-primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </span>
            )}
          </span>
          <span className="glance-line">
            순자산
            {sparkDelta != null && (
              <>
                {` · ${spark.length - 1}개월 `}
                <b style={{ color: trendColor(sparkDelta) }}>{signed(sparkDelta)}원</b>
                {sparkUnrealized != null && Math.abs(sparkUnrealized) >= 1 && (
                  <span className="glance-faint" title="지난 달들은 종가 기록이 없어 매입원가로 평가했습니다. 추이 선도 원가 기준이고, 지금 시가와의 차이(평가손익)는 증가액에 포함돼 있습니다.">
                    {` (평가손익 ${signed(sparkUnrealized)} 포함)`}
                  </span>
                )}
              </>
            )}
          </span>
          <span className="glance-line">
            총자산 {formatKrwCompact(bs.totalAssets)}원 − 총부채 {formatKrwCompact(bs.totalLiabilities)}원
          </span>
          <span className="glance-sub glance-ellipsis" title={nextLoan ? `${nextLoan.name} · 잔액 ${formatKRW(Math.round(nextLoan.balance))}` : undefined}>
            {debtParts || "부채 없음"}
          </span>
          {nextLoan && (
            <span className="glance-sub glance-ellipsis" title={`${nextLoan.name} · 잔액 ${formatKRW(Math.round(nextLoan.balance))}`}>
              가까운 만기 {nextLoan.maturityDate.slice(0, 7).replace("-", ".")} · {nextLoan.name} (잔액 {formatKrwCompact(nextLoan.balance)}원)
            </span>
          )}
        </button>

        {/* 투자·배당은 */}
        <button type="button" className="glance-col" onClick={() => setTab("stocks")} aria-label="투자·배당은 — 주식으로 이동">
          <span className="glance-q">투자·배당은 <ArrowUpRight size={14} aria-hidden /></span>
          <span className="glance-big">
            <Money value={invest.totalInvestmentAssets} compact />
          </span>
          <span className="glance-line" title="증권·코인 계좌의 지금 평가액 − 순입금 원금. 평가손익·매도 실현·배당·수수료가 모두 들어간 투자 총성과">
            {allUnpriced ? (
              quotesLoading ? "총 손익 — 시세 불러오는 중" : "총 손익 — 시세를 받지 못함 (주식 탭에서 다시 갱신)"
            ) : (
              <>
                총 손익{" "}
                <b style={{ color: trendColor(invest.cumulativePnl) }}>
                  {signed(invest.cumulativePnl)}원{pnlPct != null ? ` (${pnlPct >= 0 ? "+" : "−"}${Math.abs(pnlPct).toFixed(1)}%)` : ""}
                </b>
                {" · 원금 "}
                {formatKrwCompact(invest.principal)}원
              </>
            )}
          </span>
          {unrealizedPnl != null && (
            <span className="glance-line" title="보유 종목의 지금 시가 − 매입원가 (주식 탭 평가손익과 같은 값). 총 손익과 달리 매도 실현·배당은 빠집니다.">
              평가손익 <b style={{ color: trendColor(unrealizedPnl) }}>{signed(unrealizedPnl)}원</b>
              <span className="glance-faint"> (보유 종목 시가 − 원가)</span>
            </span>
          )}
          <span className="glance-line">
            {dividend ? (
              <>
                월 배당 <b style={{ color: "var(--text)" }}>{formatKrwCompact(dividend.monthlyAvg)}원</b>
                <span className="glance-faint"> (최근 3개월)</span>
                {dividend.yoc != null && ` · 배당률 ${dividend.yoc.toFixed(2)}%`}
              </>
            ) : (
              "배당 기록 없음"
            )}
          </span>
          <span className="glance-sub glance-ellipsis" title={divNames.join(" · ")}>
            {divNames.length > 0 ? divNames.join(" · ") : "추적 종목 없음"}
            {!allUnpriced && unpricedCount > 0 && ` · 시세 없는 ${unpricedCount}종목 원가 평가`}
            {excludedUnreliable > 0 && ` · 실현손익 환율 불명 ${excludedUnreliable}건 제외`}
          </span>
        </button>
      </div>

      {chips.length > 0 && (
        <div className="glance-chips" role="list" aria-label="확인할 일">
          <span className="glance-chips-title">확인할 일</span>
          {chips.map((c) => (
            <button key={c.key} type="button" role="listitem" className={`glance-chip${c.warn ? " warn" : ""}`} onClick={c.onClick}>
              {c.icon}
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
