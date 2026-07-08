import React, { memo, useEffect, useState } from "react";
import type { CustomExercise, WorkoutBodyPart } from "../../types";
import { BODY_PARTS, BODY_PART_COLORS, EXERCISE_PRESETS } from "./constants";

const OPEN_PARTS_STORAGE_KEY = "fw-workout-picker-open-parts";

interface Props {
  customExercises: CustomExercise[];
  /** 최근 사용 종목 (부위별 이름 배열). 사용 빈도 높은 순. */
  recentExercises: Record<WorkoutBodyPart, string[]>;
  /** 현재 날짜 entry가 이미 포함한 종목 이름. 중복 감지 UI용 (optional). */
  alreadyAddedNames?: Set<string>;
  onAddExercise: (name: string, bodyPart: WorkoutBodyPart) => void;
}

function loadOpenParts(): Set<WorkoutBodyPart> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(OPEN_PARTS_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is WorkoutBodyPart => BODY_PARTS.includes(x as WorkoutBodyPart)));
  } catch {
    return new Set();
  }
}

function saveOpenParts(set: Set<WorkoutBodyPart>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OPEN_PARTS_STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    /* quota exceeded 등 무시 */
  }
}

const ExercisePickerInner: React.FC<Props> = ({
  customExercises, recentExercises, alreadyAddedNames, onAddExercise,
}) => {
  const [openParts, setOpenParts] = useState<Set<WorkoutBodyPart>>(() => loadOpenParts());
  const [query, setQuery] = useState("");
  const [customInputs, setCustomInputs] = useState<Record<WorkoutBodyPart, string>>(() => ({
    "가슴": "", "등": "", "어깨": "", "팔": "", "하체": "", "코어": "", "유산소": "", "기타": "",
  }));

  const q = query.trim().toLowerCase();
  const matchesQuery = (name: string) => !q || name.toLowerCase().includes(q);

  useEffect(() => {
    saveOpenParts(openParts);
  }, [openParts]);

  const togglePart = (part: WorkoutBodyPart) => {
    setOpenParts((prev) => {
      const next = new Set(prev);
      if (next.has(part)) next.delete(part);
      else next.add(part);
      return next;
    });
  };

  return (
    <div style={{
      marginTop: 16, padding: 14, borderRadius: 12,
      border: "2px dashed var(--border)", background: "var(--surface)",
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>운동 추가</div>

      <div style={{ position: "relative", marginBottom: 10 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="운동 검색 (모든 부위에서)"
          style={{
            width: "100%", padding: "9px 12px", paddingRight: query ? 34 : 12,
            borderRadius: 8, fontSize: 13, boxSizing: "border-box",
            background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)",
          }}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            style={{
              position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", cursor: "pointer", fontSize: 16,
              color: "var(--text-muted)", lineHeight: 1, padding: "0 4px",
            }}
            aria-label="검색어 지우기"
          >
            ×
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {BODY_PARTS.map((part) => {
          const color = BODY_PART_COLORS[part];
          const customsAll = customExercises.filter((c) => c.bodyPart === part);
          const customNames = new Set(customsAll.map((c) => c.name));
          const presetNames = new Set(EXERCISE_PRESETS[part]);
          // 최근 사용 중 프리셋/커스텀에 없는 것만 "최근" 구획에 노출
          const recentAll = (recentExercises[part] ?? []).filter(
            (n) => !presetNames.has(n) && !customNames.has(n)
          );
          // 검색어 적용 — 매치되는 것만
          const presets = EXERCISE_PRESETS[part].filter(matchesQuery);
          const customs = customsAll.filter((c) => matchesQuery(c.name));
          const recentOnly = recentAll.filter(matchesQuery);
          const total = presets.length + customs.length + recentOnly.length;
          // 검색 중엔 매치가 있는 부위만 펼쳐 노출, 매치 0이면 부위 자체 숨김
          if (q && total === 0) return null;
          const isOpen = q ? true : openParts.has(part);
          // 검색 시 전체 매치 노출, 평상시엔 최근 10개로 제한(나머지는 검색으로 접근)
          const recentToShow = q ? recentOnly : recentOnly.slice(0, 10);
          const recentHiddenCount = q ? 0 : recentOnly.length - recentToShow.length;
          const customInput = customInputs[part];

          const handleAddCustom = () => {
            const trimmed = customInput.trim();
            if (!trimmed) return;
            onAddExercise(trimmed, part);
            setCustomInputs((prev) => ({ ...prev, [part]: "" }));
          };

          return (
            <div key={part} style={{
              borderRadius: 10,
              border: `1px solid ${color}40`,
              background: `${color}08`,
              overflow: "hidden",
            }}>
              <button
                type="button"
                onClick={() => togglePart(part)}
                style={{
                  width: "100%",
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 700,
                  color: "var(--text)",
                }}
                aria-expanded={isOpen}
              >
                <span style={{
                  width: 10, height: 10, borderRadius: "50%",
                  background: color, display: "inline-block", flexShrink: 0,
                }} />
                <span style={{ color }}>{part}</span>
                <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
                  {total}개
                </span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" }}>
                  {isOpen ? "▲" : "▼"}
                </span>
              </button>

              {isOpen && (
                <div style={{ padding: "4px 12px 12px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
                  {recentOnly.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, fontWeight: 600 }}>
                        최근 사용
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        {recentToShow.map((name) => (
                          <ExerciseChip
                            key={name}
                            name={name}
                            color={color}
                            emphasized
                            alreadyAdded={alreadyAddedNames?.has(name)}
                            onClick={() => onAddExercise(name, part)}
                          />
                        ))}
                        {recentHiddenCount > 0 && (
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                            외 {recentHiddenCount}개 — 위 검색으로 찾기
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {customs.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, fontWeight: 600 }}>
                        내가 추가한
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {customs.map((c) => (
                          <ExerciseChip
                            key={c.name}
                            name={c.name}
                            color={color}
                            badge="custom"
                            alreadyAdded={alreadyAddedNames?.has(c.name)}
                            onClick={() => onAddExercise(c.name, part)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {presets.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, fontWeight: 600 }}>
                        추천 운동
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {presets.map((name) => (
                          <ExerciseChip
                            key={name}
                            name={name}
                            color={color}
                            alreadyAdded={alreadyAddedNames?.has(name)}
                            onClick={() => onAddExercise(name, part)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
                    <input
                      type="text"
                      value={customInput}
                      onChange={(e) => setCustomInputs((prev) => ({ ...prev, [part]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddCustom(); }}
                      placeholder={`새 ${part} 운동 이름`}
                      style={{
                        flex: 1, minWidth: 0, padding: "7px 10px",
                        borderRadius: 8, fontSize: 13,
                        background: "var(--surface)", border: "1px solid var(--border)",
                      }}
                    />
                    <button
                      type="button"
                      className="secondary"
                      style={{ padding: "7px 14px", fontSize: 13, fontWeight: 600 }}
                      onClick={handleAddCustom}
                    >
                      추가
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface ChipProps {
  name: string;
  color: string;
  emphasized?: boolean;
  badge?: string;
  alreadyAdded?: boolean;
  onClick: () => void;
}

const ExerciseChip: React.FC<ChipProps> = ({ name, color, emphasized, badge, alreadyAdded, onClick }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "7px 12px", fontSize: 13, fontWeight: 600, borderRadius: 8,
        border: emphasized ? `1px solid ${color}60` : "1px solid var(--border)",
        background: emphasized ? `${color}14` : "var(--surface)",
        color: "var(--text)", cursor: "pointer",
        opacity: alreadyAdded ? 0.55 : 1,
        display: "inline-flex", alignItems: "center", gap: 6,
      }}
      title={alreadyAdded ? "이미 추가됨 · 다시 누르면 한 번 더 추가됩니다" : "클릭하여 오늘 기록에 추가"}
    >
      {name}
      {badge && (
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
          padding: "1px 5px", borderRadius: 4,
          background: color + "20", color,
        }}>
          {badge}
        </span>
      )}
      {alreadyAdded && (
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>✓</span>
      )}
    </button>
  );
};

export const ExercisePicker = memo(ExercisePickerInner);
