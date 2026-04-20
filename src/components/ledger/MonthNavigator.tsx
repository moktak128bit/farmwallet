import React from "react";
import { getKoreaTime } from "../../utils/date";

interface MonthNavigatorProps {
  selectedMonths: Set<string>;
  onChangeSelectedMonths: (next: Set<string>) => void;
  currentYear: string;
  onChangeCurrentYear: (next: string) => void;
  /** "YYYY-MM" 형식 문자열 배열. 해당 연도 내에 데이터가 있는 월만 활성 표시 */
  availableMonthsForCurrentYear: string[];
}

/**
 * 가계부 월별 보기의 연/월 네비게이션.
 * - 이번 달 점프, 이전/다음 월 화살표, 12개월 선택 그리드.
 * - 선택 비어 있으면 전체 기간. 다중 선택 가능 (토글).
 */
export const MonthNavigator: React.FC<MonthNavigatorProps> = ({
  selectedMonths,
  onChangeSelectedMonths,
  currentYear,
  onChangeCurrentYear,
  availableMonthsForCurrentYear,
}) => {
  const handleJumpToThisMonth = () => {
    const k = getKoreaTime();
    const yyyy = k.getFullYear();
    const mm = String(k.getMonth() + 1).padStart(2, "0");
    onChangeSelectedMonths(new Set([`${yyyy}-${mm}`]));
    onChangeCurrentYear(String(yyyy));
  };

  const handlePrev = () => {
    let y = Number(currentYear);
    const sorted = [...selectedMonths].sort();
    if (sorted.length > 0) {
      const [sy, sm] = sorted[0].split("-").map(Number);
      const prev = sm === 1 ? `${sy - 1}-12` : `${sy}-${String(sm - 1).padStart(2, "0")}`;
      const prevYear = sm === 1 ? String(sy - 1) : String(sy);
      onChangeCurrentYear(prevYear);
      onChangeSelectedMonths(new Set([prev]));
    } else {
      y -= 1;
      onChangeCurrentYear(String(y));
      onChangeSelectedMonths(new Set([`${y}-01`]));
    }
  };

  const handleNext = () => {
    let y = Number(currentYear);
    const sorted = [...selectedMonths].sort();
    if (sorted.length > 0) {
      const [sy, sm] = sorted[sorted.length - 1].split("-").map(Number);
      const next = sm === 12 ? `${sy + 1}-01` : `${sy}-${String(sm + 1).padStart(2, "0")}`;
      const nextYear = sm === 12 ? String(sy + 1) : String(sy);
      onChangeCurrentYear(nextYear);
      onChangeSelectedMonths(new Set([next]));
    } else {
      y += 1;
      onChangeCurrentYear(String(y));
      onChangeSelectedMonths(new Set([`${y}-01`]));
    }
  };

  const toggleMonth = (key: string) => {
    const next = new Set(selectedMonths);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChangeSelectedMonths(next);
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          className="secondary"
          onClick={handleJumpToThisMonth}
          style={{ padding: "6px 10px", fontSize: 13 }}
        >
          이번 달
        </button>
        <button
          type="button"
          className="icon-button"
          style={{ width: 32, height: 32, border: "1px solid var(--border)", borderRadius: 8, fontSize: 16, cursor: "pointer" }}
          onClick={handlePrev}
        >
          ◀
        </button>
        <span style={{ fontWeight: 700, fontSize: 15, minWidth: 100, textAlign: "center" }}>
          {currentYear}년
        </span>
        <button
          type="button"
          className="icon-button"
          style={{ width: 32, height: 32, border: "1px solid var(--border)", borderRadius: 8, fontSize: 16, cursor: "pointer" }}
          onClick={handleNext}
        >
          ▶
        </button>
      </div>
      <div className="month-tabs">
        {Array.from({ length: 12 }).map((_, idx) => {
          const monthNum = idx + 1;
          const monthPart = String(monthNum).padStart(2, "0");
          const key = `${currentYear}-${monthPart}`;
          const hasData = availableMonthsForCurrentYear.includes(key);
          const isActive = selectedMonths.has(key);
          return (
            <button
              key={key}
              type="button"
              className={`month-tab ${isActive ? "active" : ""} ${!hasData ? "empty" : ""}`}
              onClick={() => toggleMonth(key)}
            >
              {monthNum}월
            </button>
          );
        })}
      </div>
      {selectedMonths.size === 0 && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, marginBottom: 0 }}>
          월을 선택하면 해당 월만 표시됩니다. 선택 없음 시 전체 기간이 표시됩니다.
        </p>
      )}
    </>
  );
};
