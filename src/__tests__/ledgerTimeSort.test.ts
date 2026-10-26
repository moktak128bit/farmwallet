/**
 * 같은 날 안에서의 정렬 — time("HH:mm")이 2차 키.
 *
 * 회귀 방지: 예전엔 date만 비교해 같은 날이 전부 동점이었고, 안정 정렬이라 배열에 들어간
 * 순서대로 표시됐다. 통장 스크린샷을 나눠 입력하면 먼저 올린 묶음이 통째로 위에 남아
 * 실제 시각과 뒤섞였다(2026-10-24 데이트통장 10건).
 */
import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "../types";

/** LedgerPage.tsx의 key==="date" 비교자와 같은 규칙 */
function compareByDate(a: LedgerEntry, b: LedgerEntry, dir: 1 | -1): number {
  if (a.date !== b.date) return (a.date < b.date ? -1 : 1) * dir;
  const at = a.time ?? "";
  const bt = b.time ?? "";
  if (at !== bt) return (at < bt ? -1 : 1) * dir;
  return 0;
}

const e = (id: string, date: string, time?: string): LedgerEntry =>
  ({ id, date, time, kind: "expense", category: "지출", description: id, amount: 1000 }) as LedgerEntry;

describe("가계부 날짜 정렬 — 같은 날 time 2차 키", () => {
  it("내림차순이면 같은 날에서 늦은 시각이 위로 온다", () => {
    const rows = [e("a", "2026-10-24", "12:56"), e("b", "2026-10-24", "21:55"), e("c", "2026-10-24", "18:17")];
    const sorted = [...rows].sort((x, y) => compareByDate(x, y, -1));
    expect(sorted.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("오름차순이면 이른 시각이 위로 온다", () => {
    const rows = [e("b", "2026-10-24", "21:55"), e("a", "2026-10-24", "12:56")];
    const sorted = [...rows].sort((x, y) => compareByDate(x, y, 1));
    expect(sorted.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("날짜가 다르면 날짜가 먼저 — 시각은 영향 없음", () => {
    const rows = [e("old", "2026-10-23", "23:59"), e("new", "2026-10-24", "00:01")];
    const sorted = [...rows].sort((x, y) => compareByDate(x, y, -1));
    expect(sorted.map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("시각 없는 항목은 내림차순에서 그 날의 맨 아래로 간다", () => {
    const rows = [e("notime", "2026-10-24"), e("t", "2026-10-24", "09:00")];
    const sorted = [...rows].sort((x, y) => compareByDate(x, y, -1));
    expect(sorted.map((r) => r.id)).toEqual(["t", "notime"]);
  });

  it("시각이 모두 없으면 동점 — 안정 정렬로 배열 순서 유지(기존 데이터 보존)", () => {
    const rows = [e("first", "2026-09-01"), e("second", "2026-09-01"), e("third", "2026-09-01")];
    const sorted = [...rows].sort((x, y) => compareByDate(x, y, -1));
    expect(sorted.map((r) => r.id)).toEqual(["first", "second", "third"]);
  });

  it("같은 시각이면 동점 — 배열 순서 유지 (18:15 두 건)", () => {
    const rows = [e("cashback", "2026-10-24", "18:15"), e("pc", "2026-10-24", "18:15")];
    const sorted = [...rows].sort((x, y) => compareByDate(x, y, -1));
    expect(sorted.map((r) => r.id)).toEqual(["cashback", "pc"]);
  });
});
