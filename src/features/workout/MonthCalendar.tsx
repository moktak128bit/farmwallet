import React, { memo, useMemo } from "react";
import type { WorkoutDayEntry } from "../../types";
import { BODY_PART_COLORS, WEEKDAY_LABELS } from "./constants";
import { formatMonthLabel, getEntryBodyParts, getMonthStart, parseDate, toDateString } from "./helpers";

export interface CalendarCell {
  date: string;
  inCurrentMonth: boolean;
}

export interface EntryRef {
  weekId: string;
  weekStart: string;
  entry: WorkoutDayEntry;
}

interface Props {
  currentMonth: string;
  selectedDate: string;
  today: string;
  entryByDate: Map<string, EntryRef>;
  onSelectDate: (date: string) => void;
  onMoveMonth: (delta: number) => void;
  onEnsureMonthFor: (date: string) => void;
}

const MonthCalendarInner: React.FC<Props> = ({
  currentMonth, selectedDate, today, entryByDate, onSelectDate, onMoveMonth, onEnsureMonthFor
}) => {
  const calendarCells = useMemo<CalendarCell[]>(() => {
    const monthDate = parseDate(currentMonth);
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstDay = new Date(year, month, 1, 12, 0, 0);
    const gridStart = new Date(year, month, 1 - firstDay.getDay(), 12, 0, 0);
    const cells: CalendarCell[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      cells.push({ date: toDateString(d), inCurrentMonth: d.getMonth() === month });
    }
    return cells;
  }, [currentMonth]);

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <button type="button" className="secondary" onClick={() => onMoveMonth(-1)} style={{ padding: "8px 14px", fontSize: 14, fontWeight: 600 }}>
          ◀ 이전
        </button>
        <strong style={{ fontSize: 18 }}>{formatMonthLabel(currentMonth)}</strong>
        <button type="button" className="secondary" onClick={() => onMoveMonth(1)} style={{ padding: "8px 14px", fontSize: 14, fontWeight: 600 }}>
          다음 ▶
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4, marginBottom: 4 }}>
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} style={{ textAlign: "center", fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
            {label}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4 }}>
        {calendarCells.map((cell) => {
          const ref = entryByDate.get(cell.date);
          const entry = ref?.entry;
          const isSelected = cell.date === selectedDate;
          const isToday = cell.date === today;
          const parts = entry?.type === "workout" ? getEntryBodyParts(entry) : [];

          return (
            <button
              key={cell.date}
              type="button"
              onClick={() => {
                onSelectDate(cell.date);
                if (!cell.inCurrentMonth) onEnsureMonthFor(getMonthStart(cell.date));
              }}
              style={{
                minHeight: 72,
                textAlign: "left",
                padding: 6,
                borderRadius: 8,
                border: isSelected ? "2px solid var(--primary)" : isToday ? "2px solid var(--text-muted)" : "1px solid var(--border)",
                background: entry
                  ? entry.type === "rest"
                    ? "rgba(59,130,246,0.08)"
                    : "rgba(16,185,129,0.08)"
                  : "var(--surface)",
                opacity: cell.inCurrentMonth ? 1 : 0.4,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13 }}>{Number(cell.date.slice(8, 10))}</div>
              {entry ? (
                <>
                  {entry.type === "rest" ? (
                    <div style={{ fontSize: 11, color: "#3b82f6", fontWeight: 600 }}>휴식</div>
                  ) : (
                    <>
                      <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                        {parts.map((p) => (
                          <span
                            key={p}
                            style={{
                              width: 8, height: 8, borderRadius: "50%",
                              background: BODY_PART_COLORS[p],
                              display: "inline-block",
                            }}
                            title={p}
                          />
                        ))}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                        {(entry.exercises?.length ?? 0)}종목
                      </div>
                    </>
                  )}
                </>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export const MonthCalendar = memo(MonthCalendarInner);
