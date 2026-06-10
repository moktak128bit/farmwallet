/**
 * 가계부 거래 테이블 — 정렬 헤더 + 컬럼 리사이즈 + 인라인 셀 편집 + 행 드래그 순서변경
 * + Shift+드래그 구간 합계 선택 + 일별 소계 + 페이지네이션.
 * LedgerPage에서 분리 — React.memo로 감싸 폼 타이핑 등 무관한 상태 변경 시 재렌더를 건너뛴다.
 * 부모가 넘기는 콜백은 모두 안정적(setState 또는 useCallback)이어야 memo가 효과를 가진다.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import type { Account, CategoryPresets, LedgerEntry } from "../../types";
import { formatShortDate, formatUSD, formatKRW } from "../../utils/formatter";
import { ledgerEntryGross, type LedgerDisplayRow } from "../../utils/ledgerHelpers";
import { useLedgerColumnResize } from "./useLedgerColumnResize";

// 정렬 키 — 정렬 적용(filteredLedger memo)은 부모(LedgerPage)에서, 헤더 토글 UI는 여기서
export type LedgerSortKey =
  | "date"
  | "category"
  | "subCategory"
  | "detailCategory"
  | "description"
  | "fromAccountId"
  | "toAccountId"
  | "amount"
  | "grossAmount"
  | "discountAmount";

export type LedgerSortState = { key: LedgerSortKey; direction: "asc" | "desc" };

/** 출금/입금 셀에 표시할 계좌별 금액·잔액 맵 (부모 memo에서 계산) */
export type BalanceAfterMap = Map<
  string,
  { from?: { amount: number; balance: number }; to?: { amount: number; balance: number } }
>;

const PAGE_SIZE = 50;

interface Props {
  ledger: LedgerEntry[];
  accounts: Account[];
  categoryPresets: CategoryPresets;
  filteredLedger: LedgerDisplayRow[];
  balanceAfterByLedgerId: BalanceAfterMap;
  viewMode: "all" | "monthly";
  /** 필터/보기 변경 시 테이블 영역 리마운트용 키 (부모 memo) */
  ledgerScrollKey: string;
  isBatchEditMode: boolean;
  ledgerSort: LedgerSortState;
  setLedgerSort: React.Dispatch<React.SetStateAction<LedgerSortState>>;
  /** 인라인 셀 편집 상태 — ESC 단축키 핸들러가 부모에 있어 부모 소유 */
  editingField: { id: string; field: string } | null;
  editingValue: string;
  setEditingField: React.Dispatch<React.SetStateAction<{ id: string; field: string } | null>>;
  setEditingValue: React.Dispatch<React.SetStateAction<string>>;
  cancelEditField: () => void;
  /** Shift+드래그 구간 선택 — 선택 중 배너·합계 카드가 부모에 있어 부모 소유 */
  dragSumStartIndex: number | null;
  dragSumEndIndex: number | null;
  handleDragSumStart: (index: number) => void;
  selectedLedgerIdsForSum: Set<string>;
  setSelectedLedgerIdsForSum: React.Dispatch<React.SetStateAction<Set<string>>>;
  onChangeLedger: (next: LedgerEntry[]) => void;
  /** 빠른 복사 모달은 부모에서 렌더 */
  setQuickCopyEntry: React.Dispatch<React.SetStateAction<LedgerEntry | null>>;
  setQuickCopyAmount: React.Dispatch<React.SetStateAction<string>>;
}

export const LedgerTable: React.FC<Props> = React.memo(function LedgerTable({
  ledger,
  accounts,
  categoryPresets,
  filteredLedger,
  balanceAfterByLedgerId,
  viewMode,
  ledgerScrollKey,
  isBatchEditMode,
  ledgerSort,
  setLedgerSort,
  editingField,
  editingValue,
  setEditingField,
  setEditingValue,
  cancelEditField,
  dragSumStartIndex,
  dragSumEndIndex,
  handleDragSumStart,
  selectedLedgerIdsForSum,
  setSelectedLedgerIdsForSum,
  onChangeLedger,
  setQuickCopyEntry,
  setQuickCopyAmount
}) {
  const ledgerScrollRef = useRef<HTMLDivElement>(null);
  const ledgerTableRef = useRef<HTMLTableElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // 페이지네이션 상태
  const [listPage, setListPage] = useState(0);
  const [showDailySummary, setShowDailySummary] = useState<boolean>(() => {
    try { return localStorage.getItem("fw-daily-summary") !== "false"; } catch { return true; }
  });
  // 배치 편집 선택 상태
  const [selectedLedgerIds, setSelectedLedgerIds] = useState<Set<string>>(new Set());

  // 컬럼 너비 상태 (localStorage에서 로드; 10개 = 데이터 9 + 작업 1: 할인 전·할인·최종)
  const [columnWidths, setColumnWidths] = useState<number[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("ledger-column-widths");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const normalize = (arr: number[]) => {
              const t = arr.reduce((sum, w) => sum + w, 0);
              return t > 0 ? arr.map((w) => w * (100 / t)) : arr;
            };
            let w = [...parsed];
            // 아주 옛 10열(앞 2칸 순서·구분)만 제거
            if (w.length === 10 && w[0] < 6 && w[1] < 6) {
              w = w.slice(2);
            }
            if (w.length === 8) {
              w = [...w.slice(0, 7), 6, w[7]];
              w = normalize(w);
            }
            if (w.length === 9) {
              w = [...w.slice(0, 8), 9, w[8]];
              w = normalize(w);
            }
            // 10열(소분류 없음) → 11열(소분류 추가)
            if (w.length === 10) {
              w = [...w.slice(0, 3), w[2], ...w.slice(3)];
              w = normalize(w);
            }
            if (w.length === 11) {
              return normalize(w);
            }
          }
        } catch {
          // 파싱 실패 시 기본값 사용
        }
      }
    }
    // 날짜, 대분류, 중분류, 소분류, 상세내역, 출금, 입금, 할인 전, 할인, 최종, 작업
    return [8, 9, 9, 9, 19, 9, 9, 9, 5, 8, 9];
  });
  const { resizingColumn, liveColumnWidths, handleResizeStart } = useLedgerColumnResize({
    columnWidths,
    setColumnWidths,
    tableRef: ledgerTableRef,
  });

  const widthsForRender =
    resizingColumn !== null && liveColumnWidths && liveColumnWidths.length === 11 ? liveColumnWidths : columnWidths;

  // 컬럼 너비 변경 시 localStorage에 저장
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("ledger-column-widths", JSON.stringify(columnWidths));
    }
  }, [columnWidths]);

  // 정렬 함수
  const toggleLedgerSort = (key: LedgerSortKey) => {
    setLedgerSort((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc"
    }));
  };
  
  const sortIndicator = (activeKey: string, key: string, direction: "asc" | "desc") => {
    if (activeKey !== key) return "↕";
    return direction === "asc" ? "↑" : "↓";
  };
  
  // 컬럼 리사이즈: ref에 시작값 고정, 리사이즈 중에는 liveColumnWidths로 표시

  const startEditField = (id: string, field: string, currentValue: string | number) => {
    if (id.startsWith("trade-")) {
      toast("주식 거래는 주식 탭에서 수정하세요.");
      return;
    }
    setEditingField({ id, field });
    setEditingValue(String(currentValue));
  };

  const saveEditField = () => {
    if (!editingField) return;
    const { id, field } = editingField;
    const entry = ledger.find((l) => l.id === id);
    if (!entry) return;

    const updated: LedgerEntry = { ...entry };
    if (field === "date") {
      updated.date = editingValue;
    } else if (field === "category") {
      updated.category = editingValue;
    } else if (field === "subCategory") {
      updated.subCategory = editingValue || undefined;
    } else if (field === "detailCategory") {
      updated.detailCategory = editingValue || undefined;
    } else if (field === "description") {
      updated.description = editingValue;
    } else if (field === "fromAccountId") {
      updated.fromAccountId = editingValue || undefined;
    } else if (field === "toAccountId") {
      updated.toAccountId = editingValue || undefined;
    } else if (field === "grossAmount") {
      const isUSD = entry.currency === "USD";
      // KRW 도 소수점 허용해서 파싱 후 반올림 — float 쓰레기 값 들어와도 안전
      const gross = isUSD
        ? parseFloat(editingValue.replace(/[^\d.]/g, ""))
        : Math.round(parseFloat(editingValue.replace(/[^\d.]/g, "")) || 0);
      if (!Number.isFinite(gross) || isNaN(gross)) {
        setEditingField(null);
        setEditingValue("");
        return;
      }
      const disc = entry.discountAmount ?? 0;
      updated.amount = gross - disc;
    } else if (field === "amount") {
      const isUSD = entry.currency === "USD";
      // KRW 도 소수점 허용해서 파싱 후 반올림 — float 쓰레기 값 들어와도 안전
      const amount = isUSD
        ? parseFloat(editingValue.replace(/[^\d.]/g, ""))
        : Math.round(parseFloat(editingValue.replace(/[^\d.]/g, "")) || 0);
      if (Number.isFinite(amount) && !isNaN(amount)) {
        updated.amount = amount;
        if ((entry.kind === "expense" || entry.kind === "income") && (entry.discountAmount ?? 0) > 0) {
          updated.discountAmount = undefined;
        }
      } else {
        setEditingField(null);
        setEditingValue("");
        return;
      }
    } else if (field === "discountAmount") {
      if (entry.kind !== "income" && entry.kind !== "expense") {
        setEditingField(null);
        setEditingValue("");
        return;
      }
      const isUSD = entry.currency === "USD";
      const trimmed = editingValue.trim();
      // KRW 도 소수점 허용해서 파싱 후 반올림 — float 쓰레기 값 들어와도 안전
      const disc =
        trimmed === ""
          ? 0
          : isUSD
            ? parseFloat(editingValue.replace(/[^\d.]/g, ""))
            : Math.round(parseFloat(editingValue.replace(/[^\d.]/g, "")) || 0);
      if (trimmed !== "" && (isNaN(disc) || disc < 0)) {
        toast.error("할인은 0 이상이어야 합니다");
        setEditingField(null);
        setEditingValue("");
        return;
      }
      const gross = entry.amount + (entry.discountAmount ?? 0);
      if (entry.kind === "income") {
        if (disc > gross) {
          toast.error("할인은 금액(할인 전)을 넘을 수 없습니다");
          setEditingField(null);
          setEditingValue("");
          return;
        }
        const net = gross - disc;
        if (net <= 0) {
          toast.error("할인 후 실제 수입액은 0보다 커야 합니다");
          setEditingField(null);
          setEditingValue("");
          return;
        }
        updated.amount = net;
      } else {
        updated.amount = gross - disc;
      }
      updated.discountAmount = disc > 0 ? disc : undefined;
    }

    onChangeLedger(ledger.map((l) => (l.id === id ? updated : l)));
    setEditingField(null);
    setEditingValue("");
  };

  // 필터 변경 시 페이지 초기화
  useEffect(() => {
    setListPage(0);
  }, [filteredLedger.length]);

  // 헤더·본문 열 너비 — 리사이즈 중에는 liveColumnWidths(widthsForRender)로 실시간 반영
  const ledgerColumnWidthStyles = useMemo(() => {
    const workColPx = 168;
    return widthsForRender.map((width, index) => {
      if (index === 10) return `${workColPx}px`;
      const sumFirst10 = widthsForRender.slice(0, 10).reduce((s, w) => s + w, 0);
      const pct = sumFirst10 > 0 ? (width / sumFirst10) * 100 : 100 / 10;
      return `calc((100% - ${workColPx}px) * ${pct / 100})`;
    });
  }, [widthsForRender]);

  const scrollToLedgerTop = () => {
    ledgerScrollRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleReorder = (id: string, newPosition: number) => {
    const currentIndex = ledger.findIndex((l) => l.id === id);
    if (currentIndex === -1) return;
    const clamped = Math.max(0, Math.min(ledger.length - 1, newPosition));
    if (clamped === currentIndex) return;
    // 같은 날짜 안에서만 순서 변경을 허용한다.
    // 날짜 정렬(stable sort) 기준으로 같은 날짜 항목들의 표시 순서는
    // 기본 배열 순서를 따르므로, 타깃과 날짜가 다르면 이동해도 UI상 되돌아온다.
    if (ledger[currentIndex].date !== ledger[clamped].date) return;
    const next = [...ledger];
    const [item] = next.splice(currentIndex, 1);
    next.splice(clamped, 0, item);
    onChangeLedger(next);
  };

  return (
    <>
      {filteredLedger.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8, gap: 8 }}>
          <button
            type="button"
            className="secondary"
            onClick={scrollToLedgerTop}
            style={{ fontSize: 12, padding: "6px 12px" }}
            title="목록 맨 위로 스크롤"
          >
            목록 맨 위로
          </button>
        </div>
      )}
      <div ref={ledgerScrollRef} style={{ overflowX: "hidden" }}>
        <div key={ledgerScrollKey}>
        <table ref={ledgerTableRef} className="data-table ledger-table" style={{ width: "100%", minWidth: 0, tableLayout: "fixed" }}>
          <colgroup>
            {isBatchEditMode && <col key="cb" style={{ width: "40px" }} />}
            {widthsForRender.map((width, index) => {
              const workColPx = 168;
              if (index === 10) {
                return <col key={index} style={{ width: `${workColPx}px` }} />;
              }
              const sumFirst10 = widthsForRender.slice(0, 10).reduce((s, w) => s + w, 0);
              const pct = sumFirst10 > 0 ? (width / sumFirst10) * 100 : 100 / 10;
              return <col key={index} style={{ width: `calc((100% - ${workColPx}px) * ${pct / 100})` }} />;
            })}
          </colgroup>
          <thead>
          <tr>
            {isBatchEditMode && (
              <th style={{ width: "40px", minWidth: "40px" }}>
                <input
                  type="checkbox"
                  checked={selectedLedgerIds.size === filteredLedger.length && filteredLedger.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedLedgerIds(new Set(filteredLedger.map((l) => l.id)));
                    } else {
                      setSelectedLedgerIds(new Set());
                    }
                  }}
                  title="전체 선택/해제"
                />
              </th>
            )}
            <th className="ledger-col-date" style={{ position: "relative", width: ledgerColumnWidthStyles[0] }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("date")}>
                날짜 <span className="arrow">{sortIndicator(ledgerSort.key, "date", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 0)}
                onPointerDown={(e) => handleResizeStart(e, 0)}
                title="컬럼 너비 조절"
              />
            </th>
            <th style={{ position: "relative", width: ledgerColumnWidthStyles[1] }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("category")}>
                대분류 <span className="arrow">{sortIndicator(ledgerSort.key, "category", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 1)}
                onPointerDown={(e) => handleResizeStart(e, 1)}
                title="컬럼 너비 조절"
              />
            </th>
            <th style={{ position: "relative", width: ledgerColumnWidthStyles[2] }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("subCategory")}>
                중분류 <span className="arrow">{sortIndicator(ledgerSort.key, "subCategory", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 2)}
                onPointerDown={(e) => handleResizeStart(e, 2)}
                title="컬럼 너비 조절"
              />
            </th>
            <th style={{ position: "relative", width: ledgerColumnWidthStyles[3] }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("detailCategory")}>
                소분류 <span className="arrow">{sortIndicator(ledgerSort.key, "detailCategory", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 3)}
                onPointerDown={(e) => handleResizeStart(e, 3)}
                title="컬럼 너비 조절"
              />
            </th>
            <th style={{ position: "relative", width: ledgerColumnWidthStyles[4] }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("description")}>
                상세내역 <span className="arrow">{sortIndicator(ledgerSort.key, "description", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 4)}
                onPointerDown={(e) => handleResizeStart(e, 4)}
                title="컬럼 너비 조절"
              />
            </th>
            <th style={{ position: "relative", width: ledgerColumnWidthStyles[5] }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("fromAccountId")}>
                출금 <span className="arrow">{sortIndicator(ledgerSort.key, "fromAccountId", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 5)}
                onPointerDown={(e) => handleResizeStart(e, 5)}
                title="컬럼 너비 조절"
              />
            </th>
            <th style={{ position: "relative", width: ledgerColumnWidthStyles[6] }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("toAccountId")}>
                입금 <span className="arrow">{sortIndicator(ledgerSort.key, "toAccountId", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 6)}
                onPointerDown={(e) => handleResizeStart(e, 6)}
                title="컬럼 너비 조절"
              />
            </th>
            <th style={{ position: "relative", width: ledgerColumnWidthStyles[7] }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("grossAmount")}>
                할인 전 <span className="arrow">{sortIndicator(ledgerSort.key, "grossAmount", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 7)}
                onPointerDown={(e) => handleResizeStart(e, 7)}
                title="컬럼 너비 조절"
              />
            </th>
            <th style={{ position: "relative", width: ledgerColumnWidthStyles[8] }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("discountAmount")}>
                할인 <span className="arrow">{sortIndicator(ledgerSort.key, "discountAmount", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 8)}
                onPointerDown={(e) => handleResizeStart(e, 8)}
                title="컬럼 너비 조절"
              />
            </th>
            <th style={{ position: "relative", width: ledgerColumnWidthStyles[9] }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("amount")}>
                최종 <span className="arrow">{sortIndicator(ledgerSort.key, "amount", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 9)}
                onPointerDown={(e) => handleResizeStart(e, 9)}
                title="컬럼 너비 조절"
              />
            </th>
            <th style={{ position: "relative", width: ledgerColumnWidthStyles[10] }}>
              작업
            </th>
          </tr>
        </thead>
        <tbody>
          {(() => {
            const pageItems = filteredLedger.slice(listPage * PAGE_SIZE, (listPage + 1) * PAGE_SIZE);
            const enableDaySummary = showDailySummary && ledgerSort.key === "date";
            const rows: React.ReactNode[] = [];
            let prevDate: string | null = null;
            let dayIncome = 0, dayExpense = 0, dayCount = 0, dayDate = "";

            const flushDaySummary = () => {
              if (!enableDaySummary || !dayDate || dayCount === 0) return;
              const net = dayIncome - dayExpense;
              rows.push(
                <tr key={`ds-${dayDate}`} style={{ background: "var(--bg)", borderTop: "1px solid var(--border)" }}>
                  <td colSpan={11} style={{ padding: "5px 12px", fontSize: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 600, color: "var(--text)" }}>{formatShortDate(dayDate)}</span>
                      <span style={{ color: "var(--text-muted)" }}>{dayCount}건</span>
                      {dayIncome > 0 && <span style={{ color: "var(--chart-income)", fontWeight: 500 }}>+{formatKRW(dayIncome)}</span>}
                      {dayExpense > 0 && <span style={{ color: "var(--chart-expense)", fontWeight: 500 }}>-{formatKRW(dayExpense)}</span>}
                      <span style={{ fontWeight: 600, color: net >= 0 ? "var(--chart-income)" : "var(--chart-expense)" }}>
                        = {net >= 0 ? "+" : ""}{formatKRW(net)}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            };

            pageItems.forEach((l, index) => {
            if (enableDaySummary && prevDate !== null && l.date !== prevDate) {
              flushDaySummary();
              dayIncome = 0; dayExpense = 0; dayCount = 0;
            }
            if (enableDaySummary) {
              dayDate = l.date;
              dayCount++;
              if (l.kind === "income") dayIncome += l.amount;
              else if (l.kind === "expense") dayExpense += l.amount;
            }
            prevDate = l.date;

            const isDraggingRange =
              dragSumStartIndex != null &&
              index >= Math.min(dragSumStartIndex, dragSumEndIndex ?? dragSumStartIndex) &&
              index <= Math.max(dragSumStartIndex, dragSumEndIndex ?? dragSumStartIndex);
            const isInSumSelection = selectedLedgerIdsForSum.has(l.id);
            const isInDragSumRange = isDraggingRange || isInSumSelection;
            const balanceKey = (l as LedgerDisplayRow)._tradeId ?? l.id;
            const row = (
            <tr
              key={l.id}
              data-ledger-id={l.id}
              draggable={ledgerSort.key === "date" && !isBatchEditMode && !(l as LedgerDisplayRow)._tradeId}
              onMouseDown={(e) => {
                if (e.shiftKey && !isBatchEditMode) {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDragSumStart(index);
                }
              }}
              onClick={(e) => {
                if (e.shiftKey && !isBatchEditMode) {
                  e.preventDefault();
                  e.stopPropagation();
                  setSelectedLedgerIdsForSum((prev) => {
                    const next = new Set(prev);
                    if (next.has(l.id)) next.delete(l.id);
                    else next.add(l.id);
                    return next;
                  });
                }
              }}
              onDragStart={(e) => {
                if (e.shiftKey) {
                  e.preventDefault();
                  return;
                }
                if (ledgerSort.key !== "date" || isBatchEditMode) return;
                setDraggingId(l.id);
              }}
              onDragOver={(e) => {
                if (ledgerSort.key !== "date") return;
                // 같은 날짜 항목 위에서만 드롭을 허용 (커서로 피드백)
                const src = draggingId ? ledger.find((x) => x.id === draggingId) : null;
                if (src && src.date === l.date) e.preventDefault();
              }}
              onDrop={(e) => {
                if (ledgerSort.key !== "date") return;
                e.preventDefault();
                if (draggingId && draggingId !== l.id && !(l as LedgerDisplayRow)._tradeId) {
                  const src = ledger.find((x) => x.id === draggingId);
                  if (src && src.date === l.date) {
                    const targetLedgerIndex = ledger.findIndex((x) => x.id === l.id);
                    if (targetLedgerIndex >= 0) handleReorder(draggingId, targetLedgerIndex);
                  }
                }
                setDraggingId(null);
              }}
              onDragEnd={() => setDraggingId(null)}
              style={
                isInDragSumRange
                  ? {
                      backgroundColor: "var(--primary-light)",
                      outline: isInSumSelection ? "2px solid var(--primary)" : undefined,
                      outlineOffset: -1
                    }
                  : undefined
              }
            >
              {isBatchEditMode && (
                <td style={{ width: "40px", minWidth: "40px" }}>
                  {(l as LedgerDisplayRow)._tradeId ? (
                    <span style={{ color: "var(--text-muted)", fontSize: 11 }}>주식</span>
                  ) : (
                    <input
                      type="checkbox"
                      checked={selectedLedgerIds.has(l.id)}
                      onChange={(e) => {
                        const newSet = new Set(selectedLedgerIds);
                        if (e.target.checked) {
                          newSet.add(l.id);
                        } else {
                          newSet.delete(l.id);
                        }
                        setSelectedLedgerIds(newSet);
                      }}
                    />
                  )}
                </td>
              )}
              <td
                className="ledger-col-date"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(l.id, "date", l.date);
                }}
                style={{ cursor: "pointer", position: "relative", width: ledgerColumnWidthStyles[0] }}
                title="더블클릭하여 수정"
              >
                {editingField?.id === l.id && editingField.field === "date" ? (
                  <>
                    {viewMode === "all" && (
                      <span style={{ position: "absolute", left: "4px", color: "var(--muted)", fontSize: "12px" }}>=</span>
                    )}
                    <input
                      type="date"
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onBlur={saveEditField}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEditField();
                        if (e.key === "Escape") cancelEditField();
                      }}
                      autoFocus
                      style={{ width: "100%", padding: "4px", fontSize: 14, marginLeft: viewMode === "all" ? "16px" : "0" }}
                    />
                  </>
                ) : (
                  <>
                    {viewMode === "all" && (
                      <span style={{ position: "absolute", left: "4px", color: "var(--muted)", fontSize: "12px" }}>=</span>
                    )}
                    <span style={{ marginLeft: viewMode === "all" ? "16px" : "0" }}>
                      {formatShortDate(l.date)}
                    </span>
                  </>
                )}
              </td>
              <td
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(l.id, "category", l.category);
                }}
                style={{ cursor: "pointer", width: ledgerColumnWidthStyles[1] }}
                title={l.category ? l.category + " (더블클릭하여 수정)" : "더블클릭하여 수정"}
              >
                {editingField?.id === l.id && editingField.field === "category" ? (
                  <select
                    className="ledger-cell-select"
                    value={editingValue}
                    onChange={(e) => {
                      const v = e.target.value;
                      // 동일 카테고리 재선택 시 아무 변경도 하지 않음 (데이터 손실 방지)
                      if (v === l.category) {
                        setEditingField(null);
                        setEditingValue("");
                        return;
                      }
                      // 새 category의 sub 목록에 기존 subCategory가 여전히 유효한지 확인.
                      // 유효하면 유지 (데이터 손실 방지), 아니면 reset 후 sub 편집 모드로.
                      const getSubsFor = (cat: string): string[] => {
                        if (cat === "수입") return categoryPresets?.income ?? [];
                        if (cat === "이체") return categoryPresets?.transfer ?? [];
                        if (cat === "지출") return (categoryPresets?.expenseDetails ?? []).map((g) => g.main);
                        const g = (categoryPresets?.expenseDetails ?? []).find((x) => x.main === cat);
                        return g?.subs ?? [];
                      };
                      const currentSub = l.subCategory?.trim();
                      const newSubs = getSubsFor(v);
                      const keepSub = !!(currentSub && newSubs.includes(currentSub));
                      let updated: LedgerEntry = {
                        ...l,
                        category: v,
                        subCategory: keepSub ? currentSub : undefined
                      };
                      // 대분류에 따라 kind 자동 변경
                      if (v === "이체") {
                        updated = { ...updated, kind: "transfer" };
                      } else if (v === "수입") {
                        updated = { ...updated, kind: "income" };
                      } else {
                        updated = { ...updated, kind: "expense" };
                      }
                      onChangeLedger(ledger.map((x) => (x.id === l.id ? updated : x)));
                      setEditingValue("");
                      if (keepSub) {
                        // sub 유지 → 편집 종료
                        setEditingField(null);
                      } else {
                        // 새 카테고리의 sub 목록과 다르면 sub 편집으로 이동
                        startEditField(l.id, "subCategory", "");
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") cancelEditField();
                    }}
                    autoFocus
                    style={{ width: "100%" }}
                  >
                    {(() => {
                      const mainCats = ["수입", "지출", "재테크", "이체"];
                      const current = l.category?.trim();
                      const hasCurrent = current && !mainCats.includes(current);
                      const options = hasCurrent ? [current, ...mainCats] : mainCats;
                      return options.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ));
                    })()}
                  </select>
                ) : (
                  l.category
                )}
              </td>
              <td
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(l.id, "subCategory", l.subCategory || "");
                }}
                style={{ cursor: "pointer", width: ledgerColumnWidthStyles[2] }}
                title={l.subCategory ? l.subCategory + " (더블클릭하여 수정)" : "더블클릭하여 수정"}
              >
                {editingField?.id === l.id && editingField.field === "subCategory" ? (
                  <select
                    className="ledger-cell-select"
                    value={editingValue}
                    onChange={(e) => {
                      const v = e.target.value;
                      const updated = { ...l, subCategory: v || undefined };
                      onChangeLedger(ledger.map((x) => (x.id === l.id ? updated : x)));
                      setEditingField(null);
                      setEditingValue("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") cancelEditField();
                    }}
                    autoFocus
                    style={{ width: "100%" }}
                  >
                    <option value="">-</option>
                    {(() => {
                      const cat = l.category?.trim();
                      let subs: string[] = [];
                      if (cat === "수입") {
                        subs = categoryPresets?.income ?? [];
                      } else if (cat === "이체") {
                        subs = categoryPresets?.transfer ?? [];
                      } else if (cat === "지출") {
                        // 지출 대분류 → 중분류 = 지출 세부 카테고리 전체
                        subs = (categoryPresets?.expenseDetails ?? []).map((g) => g.main);
                      } else {
                        // 재테크 등 expenseDetails에서 직접 매칭
                        const g = (categoryPresets?.expenseDetails ?? []).find((x) => x.main === cat);
                        subs = g?.subs ?? [];
                      }
                      const current = l.subCategory?.trim();
                      const hasCurrent = current && !subs.includes(current);
                      const options = hasCurrent ? [current, ...subs] : subs;
                      return options.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ));
                    })()}
                  </select>
                ) : (
                  l.subCategory ?? "-"
                )}
              </td>
              <td
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(l.id, "detailCategory", l.detailCategory || "");
                }}
                style={{ cursor: "pointer", width: ledgerColumnWidthStyles[3] }}
                title={l.detailCategory ? l.detailCategory + " (더블클릭하여 수정)" : "더블클릭하여 수정"}
              >
                {editingField?.id === l.id && editingField.field === "detailCategory" ? (
                  <select
                    className="ledger-cell-select"
                    value={editingValue}
                    onChange={(e) => {
                      const v = e.target.value;
                      const updated = { ...l, detailCategory: v || undefined };
                      onChangeLedger(ledger.map((x) => (x.id === l.id ? updated : x)));
                      setEditingField(null);
                      setEditingValue("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") cancelEditField();
                    }}
                    autoFocus
                    style={{ width: "100%" }}
                  >
                    <option value="">-</option>
                    {(() => {
                      const sub = l.subCategory?.trim();
                      // 중분류에 해당하는 소분류 목록 (expenseDetails에서 검색)
                      const g = (categoryPresets?.expenseDetails ?? []).find((x) => x.main === sub);
                      const subs = g?.subs ?? [];
                      const current = l.detailCategory?.trim();
                      const hasCurrent = current && !subs.includes(current);
                      const options = hasCurrent ? [current, ...subs] : subs;
                      return options.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ));
                    })()}
                  </select>
                ) : (
                  l.detailCategory ?? "-"
                )}
              </td>
              <td
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(l.id, "description", l.description || "");
                }}
                style={{ cursor: "pointer", whiteSpace: "normal", wordBreak: "break-word", width: ledgerColumnWidthStyles[4] }}
                title={l.description ? l.description + " (더블클릭하여 수정)" : "더블클릭하여 수정"}
              >
                {editingField?.id === l.id && editingField.field === "description" ? (
                  <input
                    type="text"
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onBlur={saveEditField}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEditField();
                      if (e.key === "Escape") cancelEditField();
                    }}
                    autoFocus
                    style={{ width: "100%", padding: "4px", fontSize: 14 }}
                  />
                ) : (
                  l.description || "-"
                )}
              </td>
              <td
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(l.id, "fromAccountId", l.fromAccountId || "");
                }}
                style={{ cursor: "pointer", width: ledgerColumnWidthStyles[5] }}
                title={l.fromAccountId ? l.fromAccountId + " (더블클릭하여 수정)" : "더블클릭하여 수정"}
              >
                {editingField?.id === l.id && editingField.field === "fromAccountId" ? (
                  <select
                    className="ledger-cell-select"
                    value={editingValue}
                    onChange={(e) => {
                      setEditingValue(e.target.value);
                      const entry = ledger.find((l) => l.id === editingField.id);
                      if (entry) {
                        const updated = { ...entry, fromAccountId: e.target.value || undefined };
                        onChangeLedger(ledger.map((l) => (l.id === editingField.id ? updated : l)));
                        setEditingField(null);
                        setEditingValue("");
                      }
                    }}
                    autoFocus
                    style={{ width: "100%" }}
                  >
                    <option value="">-</option>
                    {accounts
                      .filter((acc) => !acc.archived || acc.id === editingValue)
                      .map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.id}
                        </option>
                      ))}
                  </select>
                ) : (
                  <>
                    <div>{l.fromAccountId ?? "-"}</div>
                    {l.fromAccountId && balanceAfterByLedgerId.get(balanceKey)?.from && (() => {
                      const fromAcc = accounts.find((a) => a.id === l.fromAccountId);
                      const isUsd = l.currency === "USD" || fromAcc?.currency === "USD";
                      const fmt = (n: number) => isUsd ? formatUSD(n) : formatKRW(Math.round(n));
                      const info = balanceAfterByLedgerId.get(balanceKey)!.from!;
                      return (
                        <div
                          style={{
                            fontSize: 10,
                            color: info.amount >= 0 ? "var(--danger)" : "var(--primary)",
                            marginTop: 2
                          }}
                        >
                          {info.amount >= 0 ? "+" : ""}{fmt(info.amount)} · {fmt(info.balance)}
                        </div>
                      );
                    })()}
                  </>
                )}
              </td>
              <td
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(l.id, "toAccountId", l.toAccountId || "");
                }}
                style={{ cursor: "pointer", width: ledgerColumnWidthStyles[6] }}
                title={l.toAccountId ? l.toAccountId + " (더블클릭하여 수정)" : "더블클릭하여 수정"}
              >
                {editingField?.id === l.id && editingField.field === "toAccountId" ? (
                  <select
                    className="ledger-cell-select"
                    value={editingValue}
                    onChange={(e) => {
                      setEditingValue(e.target.value);
                      const entry = ledger.find((l) => l.id === editingField.id);
                      if (entry) {
                        const updated = { ...entry, toAccountId: e.target.value || undefined };
                        onChangeLedger(ledger.map((l) => (l.id === editingField.id ? updated : l)));
                        setEditingField(null);
                        setEditingValue("");
                      }
                    }}
                    autoFocus
                    style={{ width: "100%" }}
                  >
                    <option value="">-</option>
                    {accounts
                      .filter((acc) => !acc.archived || acc.id === editingValue)
                      .map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.id}
                        </option>
                      ))}
                  </select>
                ) : (
                  <>
                    <div>{l.toAccountId ?? "-"}</div>
                    {l.toAccountId && balanceAfterByLedgerId.get(balanceKey)?.to && (() => {
                      const toAcc = accounts.find((a) => a.id === l.toAccountId);
                      const isUsd = l.currency === "USD" || toAcc?.currency === "USD";
                      const fmt = (n: number) => isUsd ? formatUSD(n) : formatKRW(Math.round(n));
                      const info = balanceAfterByLedgerId.get(balanceKey)!.to!;
                      return (
                        <div
                          style={{
                            fontSize: 10,
                            color: info.amount >= 0 ? "var(--danger)" : "var(--primary)",
                            marginTop: 2
                          }}
                        >
                          {info.amount >= 0 ? "+" : ""}{fmt(info.amount)} · {fmt(info.balance)}
                        </div>
                      );
                    })()}
                  </>
                )}
              </td>
              <td
                className="number"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if ((l as LedgerDisplayRow)._tradeId) {
                    toast("주식 거래는 주식 탭에서 수정하세요.");
                    return;
                  }
                  startEditField(l.id, "grossAmount", ledgerEntryGross(l));
                }}
                style={{ cursor: "pointer", width: ledgerColumnWidthStyles[7] }}
                title="할인 적용 전 금액 · 더블클릭하여 수정"
              >
                {editingField?.id === l.id && editingField.field === "grossAmount" ? (
                  <input
                    type="text"
                    inputMode={l.currency === "USD" ? "decimal" : "numeric"}
                    value={editingValue}
                    onChange={(e) => {
                      const re = l.currency === "USD" ? /[^\d.]/g : /[^\d]/g;
                      setEditingValue(e.target.value.replace(re, ""));
                    }}
                    onBlur={saveEditField}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEditField();
                      if (e.key === "Escape") cancelEditField();
                    }}
                    autoFocus
                    style={{ width: "100%", padding: "4px", fontSize: 14 }}
                  />
                ) : l.currency === "USD" ? (
                  formatUSD(ledgerEntryGross(l))
                ) : (
                  Math.round(ledgerEntryGross(l)).toLocaleString()
                )}
              </td>
              <td
                className="number"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if ((l as LedgerDisplayRow)._tradeId) {
                    toast("주식 거래는 주식 탭에서 수정하세요.");
                    return;
                  }
                  if (l.kind !== "income" && l.kind !== "expense") {
                    toast("할인은 수입·지출만 수정할 수 있습니다.");
                    return;
                  }
                  const cur =
                    (l.discountAmount ?? 0) > 0
                      ? l.currency === "USD"
                        ? String(l.discountAmount ?? 0)
                        : String(Math.round(l.discountAmount ?? 0))
                      : "";
                  startEditField(l.id, "discountAmount", cur);
                }}
                style={{ cursor: "pointer", width: ledgerColumnWidthStyles[8], color: "var(--text-muted)" }}
                title="할인액 · 더블클릭하여 수정"
              >
                {editingField?.id === l.id && editingField.field === "discountAmount" ? (
                  <input
                    type="text"
                    inputMode={l.currency === "USD" ? "decimal" : "numeric"}
                    value={editingValue}
                    onChange={(e) => {
                      const re = l.currency === "USD" ? /[^\d.]/g : /[^\d]/g;
                      setEditingValue(e.target.value.replace(re, ""));
                    }}
                    onBlur={saveEditField}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEditField();
                      if (e.key === "Escape") cancelEditField();
                    }}
                    autoFocus
                    style={{ width: "100%", padding: "4px", fontSize: 14 }}
                  />
                ) : (l.discountAmount ?? 0) > 0 ? (
                  l.currency === "USD" ? (
                    formatUSD(l.discountAmount ?? 0)
                  ) : (
                    Math.round(l.discountAmount ?? 0).toLocaleString()
                  )
                ) : (
                  "—"
                )}
              </td>
              <td
                className="number"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(l.id, "amount", l.amount);
                }}
                style={{ cursor: "pointer", width: ledgerColumnWidthStyles[9], fontWeight: 600 }}
                title="할인 반영 후 금액 · 더블클릭하여 수정"
              >
                {editingField?.id === l.id && editingField.field === "amount" ? (
                  <input
                    type="text"
                    inputMode={l.currency === "USD" ? "decimal" : "numeric"}
                    value={editingValue}
                    onChange={(e) => {
                      const re = l.currency === "USD" ? /[^\d.]/g : /[^\d]/g;
                      setEditingValue(e.target.value.replace(re, ""));
                    }}
                    onBlur={saveEditField}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEditField();
                      if (e.key === "Escape") cancelEditField();
                    }}
                    autoFocus
                    style={{ width: "100%", padding: "4px", fontSize: 14 }}
                  />
                ) : (
                  l.currency === "USD"
                    ? formatUSD(l.amount)
                    : Math.round(l.amount).toLocaleString()
                )}
              </td>
              <td style={{ width: ledgerColumnWidthStyles[10] }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={(e) => {
                    e.stopPropagation();
                    if ((l as LedgerDisplayRow)._tradeId) {
                      toast("주식 거래는 복사할 수 없습니다.");
                      return;
                    }
                    setQuickCopyEntry(l as LedgerEntry);
                    setQuickCopyAmount("");
                  }}>
                    복사
                  </button>
                  <button 
                    type="button" 
                    className="danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      if ((l as LedgerDisplayRow)._tradeId) {
                        toast("주식 거래는 주식 탭에서 삭제하세요.");
                        return;
                      }
                      if (confirm("이 항목을 삭제하시겠습니까?")) {
                        onChangeLedger(ledger.filter((entry) => entry.id !== l.id));
                      }
                    }}
                  >
                    삭제
                  </button>
                </div>
              </td>
            </tr>
            );
            rows.push(row);
            });
            // flush last day group
            flushDaySummary();
            return rows;
          })()}
        </tbody>
        </table>
        </div>
      </div>
      {filteredLedger.length === 0 && (
        <p>
          {viewMode === "all"
            ? "아직 거래가 없습니다. 위 폼에서 첫 거래를 입력해 보세요."
            : "이 달에는 내역이 없습니다."}
        </p>
      )}
      {filteredLedger.length > 0 && (
        <div style={{ marginTop: "8px", fontSize: "14px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 16 }}>
          <span>총 {filteredLedger.length}건</span>
          <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={showDailySummary}
              onChange={(e) => {
                setShowDailySummary(e.target.checked);
                try { localStorage.setItem("fw-daily-summary", String(e.target.checked)); } catch {}
              }}
            />
            일별 소계
          </label>
        </div>
      )}
      {filteredLedger.length > PAGE_SIZE && (
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 12 }}>
          <button type="button" className="secondary" disabled={listPage === 0} onClick={() => setListPage(p => p - 1)} style={{ padding: "6px 16px" }}>
            ← 이전
          </button>
          <span style={{ padding: "6px 12px", fontSize: 13 }}>
            {listPage + 1} / {Math.ceil(filteredLedger.length / PAGE_SIZE)} 페이지
          </span>
          <button type="button" className="secondary" disabled={(listPage + 1) * PAGE_SIZE >= filteredLedger.length} onClick={() => setListPage(p => p + 1)} style={{ padding: "6px 16px" }}>
            다음 →
          </button>
        </div>
      )}
    </>
  );
});
