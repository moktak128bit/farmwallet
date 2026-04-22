import { useEffect, useRef, useState, type RefObject } from "react";

export interface UseLedgerColumnResizeArgs {
  columnWidths: number[];
  setColumnWidths: (widths: number[]) => void;
  tableRef: RefObject<HTMLTableElement | null>;
  storageKey?: string;
}

export interface UseLedgerColumnResizeReturn {
  resizingColumn: number | null;
  liveColumnWidths: number[] | null;
  handleResizeStart: (e: React.MouseEvent | React.PointerEvent, columnIndex: number) => void;
}

/**
 * 컬럼 드래그 리사이즈. mouse·pointer 둘 다 대응, 총합 100%로 정규화,
 * localStorage에 폭 저장. capture 단계 리스너로 텍스트 선택/커서 임시 잠금.
 */
export function useLedgerColumnResize({
  columnWidths,
  setColumnWidths,
  tableRef,
  storageKey = "ledger-column-widths",
}: UseLedgerColumnResizeArgs): UseLedgerColumnResizeReturn {
  const [resizingColumn, setResizingColumn] = useState<number | null>(null);
  const [liveColumnWidths, setLiveColumnWidths] = useState<number[] | null>(null);
  const resizeStartRef = useRef<{ x: number; width: number; widths: number[] }>({
    x: 0,
    width: 0,
    widths: [],
  });

  const handleResizeStart = (e: React.MouseEvent | React.PointerEvent, columnIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    const clientX = "clientX" in e ? e.clientX : (e as React.PointerEvent).clientX;
    resizeStartRef.current = {
      x: clientX,
      width: columnWidths[columnIndex],
      widths: [...columnWidths],
    };
    setLiveColumnWidths([...columnWidths]);
    setResizingColumn(columnIndex);
  };

  useEffect(() => {
    if (resizingColumn === null) return;

    const handleMove = (e: MouseEvent | PointerEvent) => {
      const table = tableRef.current || (document.querySelector(".ledger-table") as HTMLElement | null);
      if (!table) return;
      let tableWidth = table.offsetWidth;
      if (tableWidth <= 0) tableWidth = table.getBoundingClientRect().width || (table.parentElement?.clientWidth ?? 0);
      if (tableWidth <= 0) return;

      const { x, width, widths } = resizeStartRef.current;
      if (!widths.length) return;
      const clientX = "clientX" in e ? e.clientX : (e as PointerEvent).clientX;
      const deltaX = clientX - x;
      const deltaPercent = (deltaX / tableWidth) * 100;

      const newWidths = [...widths];
      const newWidth = Math.max(1, Math.min(80, width + deltaPercent));
      newWidths[resizingColumn] = newWidth;

      const total = newWidths.reduce((sum, w) => sum + w, 0);
      if (total <= 0) return;
      const scale = 100 / total;
      const adjustedWidths = newWidths.map((w) => w * scale);

      setLiveColumnWidths(adjustedWidths);
      setColumnWidths(adjustedWidths);
      if (typeof window !== "undefined") {
        localStorage.setItem(storageKey, JSON.stringify(adjustedWidths));
      }
    };

    const handleUp = () => {
      setResizingColumn(null);
      setLiveColumnWidths(null);
    };

    const opts = { capture: true };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", handleMove as (e: MouseEvent) => void, opts);
    document.addEventListener("mouseup", handleUp, opts);
    document.addEventListener("pointermove", handleMove as (e: PointerEvent) => void, opts);
    document.addEventListener("pointerup", handleUp, opts);
    document.addEventListener("pointercancel", handleUp, opts);
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", handleMove as (e: MouseEvent) => void, opts);
      document.removeEventListener("mouseup", handleUp, opts);
      document.removeEventListener("pointermove", handleMove as (e: PointerEvent) => void, opts);
      document.removeEventListener("pointerup", handleUp, opts);
      document.removeEventListener("pointercancel", handleUp, opts);
    };
  }, [resizingColumn, setColumnWidths, storageKey, tableRef]);

  return { resizingColumn, liveColumnWidths, handleResizeStart };
}
