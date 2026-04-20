import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";
import { useUndoRedo } from "../hooks/useUndoRedo";
import { BACKUP_CONFIG } from "../constants/config";
import type { AppData } from "../types";

function emptyData(stamp: number): AppData {
  return {
    accounts: [],
    ledger: [{ id: `L${stamp}`, date: "2026-01-01", kind: "expense", category: "x", description: "n", amount: stamp }],
    trades: [],
    prices: [],
    categoryPresets: { income: [], expense: [], transfer: [] },
    recurringExpenses: [],
    budgetGoals: [],
    customSymbols: [],
  };
}

function useHarness() {
  const [data, setData] = useState<AppData>(emptyData(0));
  const undoRedo = useUndoRedo(data, setData);
  return { data, ...undoRedo };
}

describe("useUndoRedo", () => {
  it("초기 상태에선 undo/redo 모두 불가", () => {
    const { result } = renderHook(() => useHarness());
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("setDataWithHistory 호출 후 undo 가능", () => {
    const { result } = renderHook(() => useHarness());
    act(() => { result.current.setDataWithHistory(emptyData(1)); });
    expect(result.current.data.ledger[0].amount).toBe(1);
    expect(result.current.canUndo).toBe(true);
  });

  it("undo 후 이전 상태 복원, redo로 재적용", async () => {
    const { result } = renderHook(() => useHarness());
    act(() => { result.current.setDataWithHistory(emptyData(1)); });
    act(() => { result.current.setDataWithHistory(emptyData(2)); });
    expect(result.current.data.ledger[0].amount).toBe(2);

    act(() => { result.current.handleUndo(); });
    expect(result.current.data.ledger[0].amount).toBe(1);

    // setTimeout(0)로 isUndoRedoRef를 리셋하므로 microtask flush 대기
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    act(() => { result.current.handleRedo(); });
    expect(result.current.data.ledger[0].amount).toBe(2);
  });

  it("새 변경 시 redo 스택 초기화", async () => {
    const { result } = renderHook(() => useHarness());
    act(() => { result.current.setDataWithHistory(emptyData(1)); });
    act(() => { result.current.setDataWithHistory(emptyData(2)); });
    act(() => { result.current.handleUndo(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(result.current.canRedo).toBe(true);

    act(() => { result.current.setDataWithHistory(emptyData(3)); });
    expect(result.current.canRedo).toBe(false);
  });

  it("MAX_UNDO_HISTORY 초과 시 가장 오래된 항목 삭제", () => {
    const { result } = renderHook(() => useHarness());
    const limit = BACKUP_CONFIG.MAX_UNDO_HISTORY;

    for (let i = 1; i <= limit + 5; i++) {
      act(() => { result.current.setDataWithHistory(emptyData(i)); });
    }

    let undoCount = 0;
    while (result.current.canUndo) {
      act(() => { result.current.handleUndo(); });
      undoCount++;
      if (undoCount > limit + 10) break;
    }
    expect(undoCount).toBe(limit);
  });

  it("undo 가능한 상태가 없으면 handleUndo는 false 반환", () => {
    const { result } = renderHook(() => useHarness());
    let returnValue = true;
    act(() => { returnValue = result.current.handleUndo(); });
    expect(returnValue).toBe(false);
  });
});
