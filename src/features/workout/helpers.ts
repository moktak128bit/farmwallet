import type { WorkoutExercise, WorkoutDayEntry, WorkoutBodyPart } from "../../types";

export function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseDate(dateStr: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr ?? "");
  if (!m) return new Date(1970, 0, 1, 12, 0, 0);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d, 12, 0, 0);
  if (Number.isNaN(dt.getTime())) return new Date(1970, 0, 1, 12, 0, 0);
  return dt;
}

export function getWeekStart(dateLike: Date | string): string {
  const date = typeof dateLike === "string" ? parseDate(dateLike) : new Date(dateLike);
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
  local.setDate(local.getDate() - local.getDay());
  return toDateString(local);
}

export function getMonthStart(dateLike: Date | string): string {
  const date = typeof dateLike === "string" ? parseDate(dateLike) : new Date(dateLike);
  const first = new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0);
  return toDateString(first);
}

export function formatMonthLabel(monthStart: string): string {
  const d = parseDate(monthStart);
  return `${d.getFullYear()}년 ${String(d.getMonth() + 1).padStart(2, "0")}월`;
}

export function formatDisplayDate(dateStr: string): string {
  return parseDate(dateStr).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  });
}

export function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** 유산소 제외 sum(weight × reps) */
export function computeExerciseVolume(exercises: WorkoutExercise[]): number {
  return exercises.reduce((sum, exercise) => {
    if (exercise.bodyPart === "유산소") return sum;
    return sum + exercise.sets.reduce((setSum, set) => setSum + set.weightKg * set.reps, 0);
  }, 0);
}

export function isCardioExercise(ex: { bodyPart?: WorkoutBodyPart }): boolean {
  return ex.bodyPart === "유산소";
}

/** 기록된 운동이 가진 부위 set */
export function getEntryBodyParts(entry: WorkoutDayEntry): WorkoutBodyPart[] {
  const parts = new Set<WorkoutBodyPart>();
  (entry.exercises ?? []).forEach((ex) => {
    if (ex.bodyPart) parts.add(ex.bodyPart);
  });
  return [...parts];
}

/** 밀리초를 "Mm Ss" 또는 "Hh Mm" 으로 포맷. 0 이하면 빈 문자열. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${s}초`;
  return `${s}초`;
}

/** ISO 문자열 → "HH:MM" (실패 시 빈 문자열) */
export function formatClockTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
