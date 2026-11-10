/**
 * 이번 달 페이스 예측 카드 — DashboardPage에서 분리.
 * 페이스 집계(monthPaceData)를 카드가 소유한다.
 * React.memo로 감싸므로 부모가 넘기는 props는 안정적(store 참조·원시값)이어야 한다.
 */
import React, { useMemo } from "react";
import type { Account, CategoryPresets, LedgerEntry } from "../../types";
import { formatKRW } from "../../utils/formatter";
import { computeMonthPace } from "./glanceMath";

interface Props {
  currentMonth: string;
  today: string;
  ledger: LedgerEntry[];
  /** 미사용(지출 판정이 계좌와 무관) — DashboardPage 호출 시그니처 유지용 */
  accounts: Account[];
  categoryPresets: CategoryPresets;
  fxRate: number | null;
}

export const MonthPaceCard: React.FC<Props> = React.memo(function MonthPaceCard({
  currentMonth,
  today,
  ledger,
  categoryPresets,
  fxRate,
}) {
  // 페이스 = 현재까지 지출 추세로 월말 예상 지출 / 과거 3개월 평균 지출 × 100
  // 중요: 과거 3개월과 현재월은 같은 필터 정책을 써야 비교 의미가 있음
  //   → 지출 판정은 KPI '이번 달 지출'과 같은 classifyLedgerFlow (신용결제·환전·저축성지출·투자손실/수수료 제외)
  // 경과일 = 오늘이 아니라 마지막 기록일(ledgerFreshness) — 캡처를 모아 입력하면 오늘 기준 경과일로는
  // "기록 안 된 며칠"이 지출 0으로 들어가 페이스가 과소 추정된다.
  // 환산 = 단순 일할(월말까지 직선)이 아니라 '최근 3달의 같은 기간(1~N일)이 월 전체에서 차지한 비중'.
  // 카드대금·월세처럼 월말에 몰리는 지출이 있으면 일할 환산은 월초 내내 낮게, 월말엔 높게 틀린다.
  const data = useMemo(() => {
    const p = computeMonthPace(ledger, currentMonth, today, categoryPresets, fxRate);
    return { ...p, pace: p.projectedExpense != null && p.avgPrev3 > 0 ? (p.projectedExpense / p.avgPrev3) * 100 : null };
  }, [currentMonth, today, ledger, fxRate, categoryPresets]);

  const barMax = data.avgPrev3 * 1.5;
  const projPct = barMax > 0 && data.projectedExpense != null ? Math.min(100, (data.projectedExpense / barMax) * 100) : 0;
  const avgPct = barMax > 0 ? (data.avgPrev3 / barMax) * 100 : 0;

  return (
    <div className="card">
      <div className="card-title" style={{ marginBottom: 12 }}>이번 달 페이스 예측 ({currentMonth})</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: 12,
          marginBottom: 16
        }}
      >
        <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
          <div className="hint" style={{ fontSize: 14 }}>현재 지출</div>
          <div style={{ fontWeight: 700, fontSize: 22 }}>{formatKRW(Math.round(data.currentExpense))}</div>
          <div className="hint" style={{ fontSize: 13 }}>
            {data.elapsed > 0 ? `1~${data.elapsed}일 기록 / ${data.totalDays}일` : "이번 달 기록 전"}
          </div>
        </div>
        <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
          <div className="hint" style={{ fontSize: 14 }}>이달 예상 (페이스)</div>
          <div
            style={{
              fontWeight: 700,
              fontSize: 22,
              // 상태색(좋음/나쁨)은 차트 시리즈색이 아닌 var(--danger)/var(--success) 사용
              color: data.pace != null && data.pace > 110 ? "var(--danger)" : "var(--text)"
            }}
          >
            {data.projectedExpense != null ? formatKRW(Math.round(data.projectedExpense)) : "—"}
          </div>
          {data.share != null && data.elapsed > 0 && (
            <div className="hint" style={{ fontSize: 12 }}>
              최근 3달 1~{data.elapsed}일 지출이 월 전체의 {Math.round(data.share * 100)}% → 그 비율로 환산
            </div>
          )}
          {data.pace != null && (
            <div
              className="hint"
              style={{ fontSize: 13, color: data.pace > 100 ? "var(--danger)" : "var(--success)" }}
            >
              평균 대비 {data.pace > 100 ? "+" : ""}{(data.pace - 100).toFixed(1)}%
            </div>
          )}
        </div>
        <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
          <div className="hint" style={{ fontSize: 14 }}>최근 3달 평균</div>
          <div style={{ fontWeight: 700, fontSize: 22 }}>{formatKRW(Math.round(data.avgPrev3))}</div>
        </div>
      </div>
      {data.avgPrev3 > 0 && data.projectedExpense != null && (
        <div>
          <div style={{ position: "relative", height: 12, background: "var(--border)", borderRadius: 6, overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${projPct}%`,
                // 평균 초과 = 나쁨(danger) / 평균 이하 = 좋음(success) — 상태색 컨벤션
                background: projPct > avgPct ? "var(--danger)" : "var(--success)",
                borderRadius: 6,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `${avgPct}%`,
                top: 0,
                bottom: 0,
                width: 2,
                background: "var(--text-muted)",
              }}
            />
          </div>
          <div className="hint" style={{ marginTop: 6, fontSize: 13 }}>
            세로선 = 3달 평균. 막대 최대 = 평균 × 1.5
          </div>
        </div>
      )}
    </div>
  );
});
