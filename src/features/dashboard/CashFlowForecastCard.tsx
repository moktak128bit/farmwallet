/**
 * 다가오는 고정 지출(현금흐름 예측) 카드 — DashboardPage에서 렌더.
 * 반복지출/구독/반복 이체를 향후 N일 윈도우로 펼쳐(utils/cashFlowForecast) 일정과 합계를 보여준다.
 * 로직은 순수 모듈에 있고 이 카드는 표시만 — React.memo(부모가 넘기는 recurring은 store 참조로 안정적).
 */
import React, { useMemo } from "react";
import type { RecurringExpense } from "../../types";
import { formatKRW } from "../../utils/formatter";
import { getTodayKST, parseIsoLocal } from "../../utils/date";
import { computeCashFlowForecast } from "../../utils/cashFlowForecast";

const WD = ["일", "월", "화", "수", "목", "금", "토"];
const HORIZON = 60;
const MAX_ROWS = 8;

function fmtDate(iso: string): string {
  const d = parseIsoLocal(iso);
  if (!d) return iso;
  return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
}

function daysAway(iso: string, todayIso: string): number {
  const a = parseIsoLocal(iso);
  const b = parseIsoLocal(todayIso);
  if (!a || !b) return 0;
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

interface Props {
  recurring: RecurringExpense[];
}

export const CashFlowForecastCard: React.FC<Props> = React.memo(function CashFlowForecastCard({ recurring }) {
  const todayIso = getTodayKST();
  const f = useMemo(
    () => computeCashFlowForecast(recurring, { todayIso, horizonDays: HORIZON }),
    [recurring, todayIso]
  );

  return (
    <div className="card">
      <div className="card-title">다가오는 고정 지출 ({HORIZON}일)</div>
      {f.events.length === 0 ? (
        <div className="hint" style={{ marginTop: 12 }}>
          예정된 반복 지출이 없습니다. (예산·반복 탭에서 고정지출/구독을 등록하면 표시됩니다.)
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 20, marginTop: 12, marginBottom: 14, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>이번 달 남은 고정지출</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--chart-expense)" }}>{formatKRW(Math.round(f.thisMonthRemaining))}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>향후 30일</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{formatKRW(Math.round(f.next30Days))}</div>
            </div>
            {f.nextEvent && (
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>다음 항목</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
                  {fmtDate(f.nextEvent.date)} · {formatKRW(Math.round(f.nextEvent.amount))}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>
                  {f.nextEvent.title}
                </div>
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {f.events.slice(0, MAX_ROWS).map((e, i) => {
              const away = daysAway(e.date, todayIso);
              return (
                <div
                  key={`${e.date}-${e.title}-${i}`}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 14 }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmtDate(e.date)}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>
                      {e.title}
                      {e.isTransfer && <span style={{ fontSize: 11, marginLeft: 4, color: "var(--accent)" }}>이체</span>}
                    </span>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 10, whiteSpace: "nowrap" }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{away === 0 ? "오늘" : `${away}일 후`}</span>
                    <span style={{ fontWeight: 700, color: "var(--chart-expense)" }}>{formatKRW(Math.round(e.amount))}</span>
                  </span>
                </div>
              );
            })}
            {f.events.length > MAX_ROWS && (
              <div className="hint" style={{ marginTop: 4 }}>
                외 {f.events.length - MAX_ROWS}건 · {HORIZON}일 합계 {formatKRW(Math.round(f.totalHorizon))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
});
