import { useCallback, useRef } from "react";
import type { AppData } from "../types";
import { BACKUP_CONFIG } from "../constants/config";

export function useUndoRedo(
  data: AppData,
  setData: (data: AppData | ((prev: AppData) => AppData)) => void
) {
  const undoStackRef = useRef<AppData[]>([]);
  const redoStackRef = useRef<AppData[]>([]);
  const isUndoRedoRef = useRef(false);

  const setDataWithHistory = useCallback((newData: AppData | ((prev: AppData) => AppData)) => {
    if (isUndoRedoRef.current) {
      // 실행 취소/다시 실행 중에는 히스토리에 저장하지 않음
      setData(newData);
      return;
    }
    
    setData((prev) => {
      const next = typeof newData === "function" ? newData(prev) : newData;
      // 이전 상태를 undo 스택에 저장
      undoStackRef.current.push(prev);
      // 최대 개수까지만 저장
      if (undoStackRef.current.length > BACKUP_CONFIG.MAX_UNDO_HISTORY) {
        undoStackRef.current.shift();
      }
      // redo 스택 초기화
      redoStackRef.current = [];
      return next;
    });
  }, [setData]);

  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return false;
    const prevData = undoStackRef.current.pop()!;
    isUndoRedoRef.current = true;
    redoStackRef.current.push(data);
    setData(prevData);
    setTimeout(() => {
      isUndoRedoRef.current = false;
    }, 0);
    return true;
  }, [data, setData]);

  /**
   * 외부(다른 기기) 데이터로 통째 바뀐 뒤 호출 — 되돌리기가 바뀌기 이전 상태를 되살리면 그대로 업로드돼
   * (동기화 기준은 이미 원격 최신) 다른 기기 변경이 충돌 확인 없이 사라진다.
   */
  const clearHistory = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
  }, []);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return false;
    const nextData = redoStackRef.current.pop()!;
    isUndoRedoRef.current = true;
    undoStackRef.current.push(data);
    setData(nextData);
    setTimeout(() => {
      isUndoRedoRef.current = false;
    }, 0);
    return true;
  }, [data, setData]);

  return {
    setDataWithHistory,
    handleUndo,
    handleRedo,
    clearHistory,
    canUndo: undoStackRef.current.length > 0,
    canRedo: redoStackRef.current.length > 0
  };
}
