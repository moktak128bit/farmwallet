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
    canUndo: undoStackRef.current.length > 0,
    canRedo: redoStackRef.current.length > 0
  };
}
