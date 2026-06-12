/**
 * 월별 종목별 배당 내역 표 + 월별 이자 내역 표 (인라인 행 편집 · 이자 변환 · 삭제).
 * DividendsPage에서 분리 — 행 인라인 편집 상태(editing*)를 이 컴포넌트가 소유해
 * 편집 타이핑이 부모(DividendsPage)를 재렌더하지 않는다.
 * 배당/이자 두 표가 같은 편집 상태를 공유하므로 한 컴포넌트로 묶고 tab prop으로 분기한다
 * (부모가 항상 마운트 — 탭 전환에도 편집 상태가 유지되어 분리 전 동작과 동일).
 * React.memo로 감싸 표와 무관한 부모 상태 변경 시 재렌더를 건너뛴다.
 * 부모가 넘기는 콜백은 모두 안정적(setState 또는 useCallback)이어야 memo가 효과를 가진다.
 *
 * byMonthSource/byMonthInterest/positions는 부모 memo — 여기서 재계산하지 않는다.
 */
import React, { useState } from "react";
import { toast } from "react-hot-toast";
import type { Account, LedgerEntry, PositionRow } from "../../types";
import { formatKRW, formatShortDate } from "../../utils/formatter";
import { canonicalTickerForMatch, extractTickerFromText } from "../../utils/finance";
import { buildDividendNote, parseExDateFromNote } from "../../utils/dividend";
import { useAppStore } from "../../store/appStore";
import type { DividendRow, TabType } from "./types";

/** 배당 행 판별 — 월별 표의 인라인 필터와 동일 술어 (이자 행·비배당 행 제외) */
const isDividendRow = (r: DividendRow) => !r.isInterest && (!!r.ticker || r.source.includes("배당"));

// ─── 삭제 토스트 [실행 취소] — "삭제 항목 재삽입" 복원 ───────────────────
// 풀 스냅샷 undo가 아니다:
//  - 삭제 이후 다른 변경(시세 갱신·Gist pull·탭 동기화·다른 편집)이 있어도
//    그 변경을 보존한 채 삭제된 항목만 되살린다.
//  - 복원은 onChange*(→ setDataWithHistory) 경유의 새 히스토리 write라
//    Ctrl+Z로 복원 자체를 다시 취소할 수 있다.
// 전제: appStore.setData는 동기(zustand) — 클릭 시점 getState() 재조회가 항상 최신.
// useAppStore는 핸들러 내부 getState()만 사용 — 훅 구독 금지(재렌더 유발·memo 무력화 방지).
import { buildRestoreById, showDeleteUndoToast } from "../../utils/undoToast";

interface Props {
  tab: TabType;
  accounts: Account[];
  ledger: LedgerEntry[];
  /** 부모 memo (computePositions) — 편집 중 배당율(현재가 대비) 계산용 */
  positions: PositionRow[];
  /** 부모 memo — 월별 배당+이자 행 (최신 월 우선) */
  byMonthSource: Array<[string, DividendRow[]]>;
  /** 부모 memo — 월별 이자 행 (최신 월 우선) */
  byMonthInterest: Array<[string, DividendRow[]]>;
  onChangeLedger: (ledger: LedgerEntry[]) => void;
}

export const IncomeRecordsSection: React.FC<Props> = React.memo(function IncomeRecordsSection({
  tab,
  accounts,
  ledger,
  positions,
  byMonthSource,
  byMonthInterest,
  onChangeLedger
}) {
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editingTicker, setEditingTicker] = useState<string>("");
  const [editingName, setEditingName] = useState<string>("");
  const [editingQuantity, setEditingQuantity] = useState<string>("");
  const [editingAmount, setEditingAmount] = useState<string>("");
  const [editingDate, setEditingDate] = useState<string>("");
  const [editingAccountId, setEditingAccountId] = useState<string>("");

  // 배당 행이 하나라도 있는지 — 이자 기록만 있으면 배당 탭은 빈 안내를 보여준다
  const hasDividendRows = byMonthSource.some(([, rows]) => rows.some(isDividendRow));

  return (
    <>
      {tab === "dividend" && (
        <>
      <h3 style={{ marginTop: 16 }}>월별 종목별 배당 내역</h3>
      {!hasDividendRows ? (
        <p className="hint" style={{ textAlign: "center", padding: 20 }}>
          아직 배당 기록이 없습니다 — 위 배당 입력 폼에서 첫 배당을 기록해 보세요.
        </p>
      ) : (
        byMonthSource.map(([month, rows]) => {
          const dividendRowsInMonth = rows.filter(isDividendRow);
          // 이자-전용 월 스킵 — "배당 합계: 0원" 빈 월 헤더 제거
          if (dividendRowsInMonth.length === 0) return null;
          const monthDividendTotal = dividendRowsInMonth.reduce((sum, r) => sum + r.amount, 0);

          return (
            <div key={month} style={{ marginBottom: 32 }}>
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
                paddingBottom: 8,
                borderBottom: "2px solid var(--border)"
              }}>
                <h4 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{month}</h4>
                <div style={{ fontSize: 16, fontWeight: 600, color: "var(--success)" }}>
                  배당 합계: {formatKRW(Math.round(monthDividendTotal))}
                </div>
              </div>

              {dividendRowsInMonth.length > 0 && (
                <table className="data-table" style={{ marginBottom: 16, tableLayout: "fixed" }}>
                  <thead>
                    <tr>
                      <th style={{ width: "9%", minWidth: 80 }}>날짜</th>
                      <th style={{ width: "9%", minWidth: 70 }}>티커</th>
                      <th style={{ width: "16%", minWidth: 120 }}>종목명</th>
                      <th style={{ width: "10%" }}>평단가</th>
                      <th style={{ width: "10%" }}>주당배당금</th>
                      <th style={{ width: "8%" }}>보유주수</th>
                      <th style={{ width: "11%" }}>총 배당금</th>
                      <th style={{ width: "12%" }}>배당율(매입대비)</th>
                      <th style={{ width: "10%" }}>계좌</th>
                      <th style={{ width: "9%", minWidth: 96 }}>작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dividendRowsInMonth.map((r, idx) => {
                      const tickerName = r.name ?? (r.source.includes(" - ") ? r.source.split(" - ")[1] : "");
                      const displayName = tickerName.length > 30 ? tickerName.slice(0, 30) + "..." : tickerName;
                      // 해당 배당 기록 찾기 — 원본 ledger id로 직접 매칭 (fragile한 ticker/amount 매칭 폐기)
                      const ledgerEntry = ledger.find(l => l.id === r.id);

                      const isEditing = ledgerEntry && editingEntryId === ledgerEntry.id;

                      // description에서 티커와 종목명 추출
                      const extractTickerAndName = (desc: string) => {
                        const ticker = (extractTickerFromText(desc) ?? "").toUpperCase();
                        const nameMatch = desc.match(/\s-\s([^-]+?)(?:\s배당|$)/);
                        const name = nameMatch ? nameMatch[1].trim() : "";
                        return { ticker, name };
                      };

                      const { ticker: currentTicker, name: currentName } = ledgerEntry
                        ? extractTickerAndName(ledgerEntry.description || "")
                        : { ticker: r.ticker || "", name: tickerName || "" };

                      const handleSaveEdit = (e?: React.FocusEvent) => {
                        if (!ledgerEntry) return;

                        // 같은 행의 다른 편집 필드로 포커스가 이동하는 경우는 저장하지 않음
                        if (e?.relatedTarget) {
                          const relatedTarget = e.relatedTarget as HTMLElement;
                          const isSameRowInput = relatedTarget.closest('tr') === e.currentTarget.closest('tr') &&
                                                 ['INPUT', 'TEXTAREA', 'SELECT'].includes(relatedTarget.tagName);
                          if (isSameRowInput) {
                            return; // 같은 행의 다른 입력 필드로 이동하는 경우 저장하지 않음
                          }
                        }

                        // description 재구성: "티커 - 종목명 배당" 형식
                        const restOfDesc = ledgerEntry.description || "";
                        const restMatch = restOfDesc.match(/\s배당.*$/);
                        const restPart = restMatch ? restMatch[0] : " 배당";

                        const newTicker = editingTicker.trim().toUpperCase() || currentTicker;
                        const newName = editingName.trim();
                        const newDescription = newName
                          ? `${newTicker} - ${newName}${restPart}`
                          : `${newTicker}${restPart}`;

                        // 배당금액 수정
                        const newAmount = editingAmount ? Number(editingAmount) : ledgerEntry.amount;

                        // 보유주식은 note 필드에 저장 — 기존 note의 "배당락일:" 메타는 보존하며 보유주식만 갱신
                        const existingExDate = parseExDateFromNote(ledgerEntry.note) ?? undefined;
                        const editedQty = editingQuantity ? parseInt(editingQuantity, 10) : NaN;
                        const newNote =
                          editingQuantity && Number.isInteger(editedQty) && editedQty >= 0
                            ? buildDividendNote(editedQty, existingExDate)
                            : ledgerEntry.note;

                        // 날짜, 계좌 수정
                        const newDate = editingDate || ledgerEntry.date || "";
                        const newToAccountId = editingAccountId || ledgerEntry.toAccountId || "";

                        const newLedger = ledger.map(l =>
                          l.id === ledgerEntry.id
                            ? {
                                ...l,
                                date: newDate,
                                description: newDescription,
                                amount: newAmount,
                                note: newNote,
                                toAccountId: newToAccountId
                              }
                            : l
                        );
                        onChangeLedger(newLedger);
                        toast.success("배당 기록이 수정되었습니다.");
                        setEditingEntryId(null);
                        setEditingTicker("");
                        setEditingName("");
                        setEditingQuantity("");
                        setEditingAmount("");
                        setEditingDate("");
                        setEditingAccountId("");
                      };

                      const cancelEdit = () => {
                        setEditingEntryId(null);
                        setEditingTicker("");
                        setEditingName("");
                        setEditingQuantity("");
                        setEditingAmount("");
                        setEditingDate("");
                        setEditingAccountId("");
                      };

                      return (
                        <tr key={`${month}-${r.ticker}-${idx}`}>
                          <td style={{ fontSize: 13, color: "var(--text-muted)", position: "relative" }}>
                            {isEditing ? (
                              <input
                                type="date"
                                value={editingDate}
                                onChange={(e) => setEditingDate(e.target.value)}
                                onBlur={(e) => handleSaveEdit(e)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    // 다음 입력(티커)으로 이동 — 각 input은 서로 다른 td에 있어 nth-of-type은 매칭 불가
                                    const textInputs = e.currentTarget.closest("tr")?.querySelectorAll<HTMLInputElement>("input[type='text']");
                                    textInputs?.[0]?.focus();
                                  } else if (e.key === "Escape") cancelEdit();
                                }}
                                style={{
                                  width: "100%",
                                  padding: "4px 8px",
                                  fontSize: 13,
                                  border: "1px solid var(--accent)",
                                  borderRadius: 4,
                                  backgroundColor: "var(--surface)"
                                }}
                                onClick={(e) => e.stopPropagation()}
                                autoFocus
                              />
                            ) : (
                              r.date ? formatShortDate(r.date) : "-"
                            )}
                          </td>
                          <td
                            style={{
                              fontWeight: 600,
                              fontSize: 14,
                              position: "relative"
                            }}
                          >
                            {isEditing ? (
                              <input
                                type="text"
                                value={editingTicker}
                                onChange={(e) => setEditingTicker(e.target.value.toUpperCase())}
                                onBlur={(e) => handleSaveEdit(e)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    // 다음 입력(종목명)으로 이동 — 행 내 text input 중 두 번째
                                    const textInputs = e.currentTarget.closest("tr")?.querySelectorAll<HTMLInputElement>("input[type='text']");
                                    textInputs?.[1]?.focus();
                                  } else if (e.key === "Escape") cancelEdit();
                                  else if (e.key === "Tab") { /* 기본 동작 */ }
                                }}
                                autoFocus
                                style={{
                                  width: "100%",
                                  padding: "4px 8px",
                                  fontSize: 13,
                                  border: "1px solid var(--accent)",
                                  borderRadius: 4,
                                  backgroundColor: "var(--surface)"
                                }}
                                onClick={(e) => e.stopPropagation()}
                                placeholder="티커"
                              />
                            ) : (
                              <span>{r.ticker || "-"}</span>
                            )}
                          </td>
                          <td
                            title={tickerName || "-"}
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              position: "relative"
                            }}
                          >
                            {isEditing ? (
                              <input
                                type="text"
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                onBlur={(e) => handleSaveEdit(e)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    // 다음 입력(보유주수)으로 이동 — 행 내 number input: [0]=주당배당금, [1]=보유주수, [2]=총배당금
                                    const numberInputs = e.currentTarget.closest("tr")?.querySelectorAll<HTMLInputElement>("input[type='number']");
                                    numberInputs?.[1]?.focus();
                                  } else if (e.key === "Escape") cancelEdit();
                                  else if (e.key === "Tab") { /* 기본 동작 */ }
                                }}
                                style={{
                                  width: "100%",
                                  padding: "4px 8px",
                                  fontSize: 13,
                                  border: "1px solid var(--accent)",
                                  borderRadius: 4,
                                  backgroundColor: "var(--surface)"
                                }}
                                onClick={(e) => e.stopPropagation()}
                                placeholder="종목명"
                              />
                            ) : (
                              <span>{displayName || "-"}</span>
                            )}
                          </td>
                          <td className="number" title={r.costBasis != null && r.quantity != null && r.quantity > 0 ? `매입금액 ${formatKRW(Math.round(r.costBasis))} ÷ ${r.quantity}주` : ""}>
                            {r.costBasis != null && r.quantity != null && r.quantity > 0
                              ? formatKRW(Math.round(r.costBasis / r.quantity))
                              : "-"}
                          </td>
                          <td className="number" style={{ position: "relative" }}>
                            {isEditing ? (() => {
                              const q = Number(editingQuantity) || 0;
                              const a = Number(editingAmount) || 0;
                              const currentDps = q > 0 && a > 0 ? a / q : 0;
                              return (
                                <input
                                  type="number"
                                  value={currentDps > 0 ? currentDps : ""}
                                  onChange={(e) => {
                                    // 주당배당금 변경 → 총배당금(editingAmount) = dps × 보유주수 로 재계산
                                    const newDps = Number(e.target.value) || 0;
                                    if (q > 0 && newDps >= 0) {
                                      setEditingAmount(String(Math.round(newDps * q * 100) / 100));
                                    }
                                  }}
                                  onBlur={(e) => handleSaveEdit(e)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      // 다음 입력(보유주수)으로 이동 — number input: [0]=주당배당금, [1]=보유주수, [2]=총배당금
                                      const numberInputs = e.currentTarget.closest("tr")?.querySelectorAll<HTMLInputElement>("input[type='number']");
                                      numberInputs?.[1]?.focus();
                                    } else if (e.key === "Escape") cancelEdit();
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "4px 8px",
                                    fontSize: 13,
                                    border: "1px solid var(--accent)",
                                    borderRadius: 4,
                                    backgroundColor: "var(--surface)",
                                    textAlign: "right"
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  placeholder={q > 0 ? "주당배당금" : "먼저 보유주수 입력"}
                                  disabled={q <= 0}
                                  min={0}
                                  step={0.0001}
                                />
                              );
                            })() : (
                              r.dividendPerShare != null ? formatKRW(Math.round(r.dividendPerShare)) : "-"
                            )}
                          </td>
                          <td
                            className="number"
                            style={{ position: "relative" }}
                          >
                            {isEditing ? (
                              <input
                                type="number"
                                value={editingQuantity}
                                onChange={(e) => setEditingQuantity(e.target.value)}
                                onBlur={(e) => handleSaveEdit(e)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    // 다음 입력(총배당금)으로 이동 — number input: [0]=주당배당금, [1]=보유주수, [2]=총배당금
                                    const numberInputs = e.currentTarget.closest("tr")?.querySelectorAll<HTMLInputElement>("input[type='number']");
                                    numberInputs?.[2]?.focus();
                                  } else if (e.key === "Escape") cancelEdit();
                                  else if (e.key === "Tab") { /* 기본 동작 */ }
                                }}
                                style={{
                                  width: "100%",
                                  padding: "4px 8px",
                                  fontSize: 13,
                                  border: "1px solid var(--accent)",
                                  borderRadius: 4,
                                  backgroundColor: "var(--surface)",
                                  textAlign: "right"
                                }}
                                onClick={(e) => e.stopPropagation()}
                                placeholder="보유주수"
                                min={0}
                                step={1}
                              />
                            ) : (
                              <span>{r.quantity != null ? `${Math.round(r.quantity).toLocaleString()}주` : "-"}</span>
                            )}
                          </td>
                          <td
                            className="number positive"
                            style={{
                              fontWeight: 600,
                              fontSize: 15,
                              position: "relative"
                            }}
                          >
                            {isEditing ? (
                              <input
                                type="number"
                                value={editingAmount}
                                onChange={(e) => setEditingAmount(e.target.value)}
                                onBlur={(e) => handleSaveEdit(e)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    // blur가 onBlur(handleSaveEdit)를 호출하므로 직접 호출하지 않음 (저장 2회 실행 방지)
                                    e.currentTarget.blur();
                                  } else if (e.key === "Escape") cancelEdit();
                                  else if (e.key === "Tab") { /* 기본 동작 */ }
                                }}
                                style={{
                                  width: "100%",
                                  padding: "4px 8px",
                                  fontSize: 13,
                                  border: "1px solid var(--accent)",
                                  borderRadius: 4,
                                  backgroundColor: "var(--surface)",
                                  textAlign: "right"
                                }}
                                onClick={(e) => e.stopPropagation()}
                                placeholder="총 배당금"
                                min={0}
                                step={0.01}
                              />
                            ) : (
                              <span>{formatKRW(Math.round(r.amount))}</span>
                            )}
                          </td>
                          <td className="number" style={{ whiteSpace: "nowrap" }}>
                            {isEditing ? (() => {
                              const q = Number(editingQuantity) || 0;
                              const a = Number(editingAmount) || 0;
                              const tickerForPrice = editingTicker.trim().toUpperCase() || currentTicker || r.ticker;
                              const pos = tickerForPrice ? positions.find((p) => canonicalTickerForMatch(p.ticker) === canonicalTickerForMatch(tickerForPrice)) : null;
                              const priceKrw = pos?.marketPrice;
                              if (q <= 0 || a <= 0 || !priceKrw || priceKrw <= 0) return "-";
                              const dps = a / q;
                              const yieldPct = (dps / priceKrw) * 100;
                              return `${yieldPct.toFixed(2)}%`;
                            })() : r.yieldRate != null ? (
                              <span title={`매입금액 ${r.costBasis != null ? formatKRW(Math.round(r.costBasis)) : "?"} ÷ 배당금 ${formatKRW(Math.round(r.amount))} = ${(r.yieldRate * 100).toFixed(2)}%`}>
                                <span style={{ fontWeight: 600 }}>{(r.yieldRate * 100).toFixed(2)}%</span>
                                {r.costBasis != null && (
                                  <div className="hint" style={{ fontSize: 10, marginTop: 2 }}>
                                    매입 {formatKRW(Math.round(r.costBasis))} 기준
                                  </div>
                                )}
                              </span>
                            ) : "-"}
                          </td>
                          <td style={{ fontSize: 13, color: "var(--text-muted)", position: "relative" }}>
                            {isEditing ? (
                              <select
                                value={editingAccountId}
                                onChange={(e) => setEditingAccountId(e.target.value)}
                                onBlur={(e) => handleSaveEdit(e)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    handleSaveEdit();
                                  } else if (e.key === "Escape") cancelEdit();
                                }}
                                style={{
                                  width: "100%",
                                  padding: "4px 8px",
                                  fontSize: 13,
                                  border: "1px solid var(--accent)",
                                  borderRadius: 4,
                                  backgroundColor: "var(--surface)"
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <option value="">선택</option>
                                {accounts
                                  .filter((acc) => !acc.archived || acc.id === editingAccountId)
                                  .map((acc) => (
                                    <option key={acc.id} value={acc.id}>
                                      {acc.name || acc.id}
                                    </option>
                                  ))}
                              </select>
                            ) : (
                              r.accountName || r.accountId || "-"
                            )}
                          </td>
                          <td style={{ textAlign: "center" }}>
                            {ledgerEntry && (
                              <div style={{ display: "flex", gap: 4, justifyContent: "center", alignItems: "center" }}>
                                {!isEditing && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingEntryId(ledgerEntry.id);
                                      setEditingTicker(currentTicker);
                                      setEditingName(currentName);
                                      setEditingQuantity(r.quantity != null ? r.quantity.toString() : "");
                                      setEditingAmount(ledgerEntry.amount.toString());
                                      setEditingDate(ledgerEntry.date || r.date || "");
                                      setEditingAccountId(ledgerEntry.toAccountId || r.accountId || "");
                                    }}
                                    style={{
                                      background: "none",
                                      border: "1px solid var(--border)",
                                      color: "var(--accent)",
                                      cursor: "pointer",
                                      fontSize: 12,
                                      padding: "4px 8px",
                                      borderRadius: 4,
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center"
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.backgroundColor = "var(--accent-light)";
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.backgroundColor = "transparent";
                                    }}
                                    title="이 행을 수정"
                                  >
                                    ✏️
                                  </button>
                                )}
                                {!isEditing && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (confirm(`이 항목을 이자로 변환하시겠습니까?\n${r.ticker || r.source}: ${formatKRW(Math.round(r.amount))}\n\n잘못 배당으로 분류된 이자(예: OK저축은행)를 이자 탭으로 옮길 때 사용합니다.`)) {
                                        const cleanedDesc = (ledgerEntry.description ?? "").replace(/배당/g, "이자");
                                        const updated: LedgerEntry = {
                                          ...ledgerEntry,
                                          category: "이자",
                                          subCategory: undefined,
                                          description: cleanedDesc || "이자",
                                          note: undefined  // 배당 전용 메타(qty/exDate) 제거
                                        };
                                        const newLedger = ledger.map(l => l.id === ledgerEntry.id ? updated : l);
                                        onChangeLedger(newLedger);
                                        toast.success("이자로 변환되었습니다 (이자 탭에서 확인)");
                                      }
                                    }}
                                    style={{
                                      background: "none",
                                      border: "1px solid var(--border)",
                                      color: "var(--text-muted)",
                                      cursor: "pointer",
                                      fontSize: 11,
                                      padding: "4px 8px",
                                      borderRadius: 4,
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      whiteSpace: "nowrap"
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.backgroundColor = "var(--surface)";
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.backgroundColor = "transparent";
                                    }}
                                    title="이자로 변환 — 잘못 배당으로 분류된 이자(은행 이자 등) 정정"
                                  >
                                    → 이자
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (confirm(`이 배당 기록을 삭제하시겠습니까?\n${r.date ? formatShortDate(r.date) : "날짜 없음"} · ${r.ticker || r.source}: ${formatKRW(Math.round(r.amount))}`)) {
                                      const deletedIndex = ledger.findIndex(l => l.id === ledgerEntry.id);
                                      onChangeLedger(ledger.filter(l => l.id !== ledgerEntry.id));
                                      showDeleteUndoToast(
                                        "배당 기록이 삭제되었습니다.",
                                        buildRestoreById(() => useAppStore.getState().data.ledger, onChangeLedger, ledgerEntry, deletedIndex)
                                      );
                                    }
                                  }}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    color: "var(--danger)",
                                    cursor: "pointer",
                                    fontSize: 18,
                                    padding: "4px 8px",
                                    borderRadius: 4,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center"
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = "var(--danger-light)";
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = "transparent";
                                  }}
                                  title="삭제"
                                >
                                  ×
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })
      )}
        </>
      )}

      {tab === "interest" && (
        <>
      <h3 style={{ marginTop: 0 }}>월별 이자 내역</h3>
      {byMonthInterest.length === 0 ? (
        <p className="hint" style={{ textAlign: "center", padding: 20 }}>
          아직 이자 기록이 없습니다 — 위 이자 입력 폼에서 첫 이자를 기록해 보세요.
        </p>
      ) : (
        byMonthInterest.map(([month, rows]) => {
          const monthInterestTotal = rows.reduce((s, r) => s + r.amount, 0);
          return (
            <div key={month} style={{ marginBottom: 32 }}>
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
                paddingBottom: 8,
                borderBottom: "2px solid var(--border)"
              }}>
                <h4 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{month}</h4>
                <div style={{ fontSize: 16, fontWeight: 600, color: "var(--success)" }}>
                  이자 합계: {formatKRW(Math.round(monthInterestTotal))}
                </div>
              </div>
              <table className="data-table" style={{ tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <th style={{ width: "12%" }}>날짜</th>
                    <th style={{ width: "38%" }}>출처</th>
                    <th style={{ width: "20%" }}>이자금액</th>
                    <th style={{ width: "18%" }}>계좌</th>
                    <th style={{ width: "12%", minWidth: 80 }}>작업</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => {
                    // 원본 ledger id로 직접 매칭
                    const ledgerEntry = ledger.find(l => l.id === r.id);
                    const isEditing = ledgerEntry && editingEntryId === ledgerEntry.id;
                    const handleSaveInterestEdit = (e?: React.FocusEvent) => {
                      if (!ledgerEntry) return;
                      if (e?.relatedTarget) {
                        const relatedTarget = e.relatedTarget as HTMLElement;
                        const isSameRow = relatedTarget.closest("tr") === e.currentTarget.closest("tr") &&
                          ["INPUT", "TEXTAREA", "SELECT"].includes(relatedTarget.tagName);
                        if (isSameRow) return;
                      }
                      const newDate = editingDate || ledgerEntry.date || "";
                      const newDescription = ((editingName ?? ledgerEntry.description ?? "").trim() || (ledgerEntry.description ?? ""));
                      const newAmount = editingAmount ? Number(editingAmount) : ledgerEntry.amount;
                      const newToAccountId = editingAccountId ?? ledgerEntry.toAccountId ?? "";
                      const newLedger = ledger.map(l =>
                        l.id === ledgerEntry.id
                          ? { ...l, date: newDate, description: newDescription, amount: newAmount, toAccountId: newToAccountId }
                          : l
                      );
                      onChangeLedger(newLedger);
                      toast.success("이자 기록이 수정되었습니다.");
                      setEditingEntryId(null);
                      setEditingDate("");
                      setEditingAmount("");
                      setEditingAccountId("");
                      setEditingName("");
                    };
                    const cancelInterestEdit = () => {
                      setEditingEntryId(null);
                      setEditingDate("");
                      setEditingAmount("");
                      setEditingAccountId("");
                      setEditingName("");
                    };
                    return (
                      <tr key={`${month}-interest-${idx}`}>
                        <td style={{ fontSize: 13, color: "var(--text-muted)", position: "relative" }}>
                          {isEditing ? (
                            <input
                              type="date"
                              value={editingDate}
                              onChange={(e) => setEditingDate(e.target.value)}
                              onBlur={handleSaveInterestEdit}
                              onKeyDown={(e) => { if (e.key === "Escape") cancelInterestEdit(); }}
                              style={{ width: "100%", padding: "4px 8px", fontSize: 13, border: "1px solid var(--accent)", borderRadius: 4, backgroundColor: "var(--surface)" }}
                            />
                          ) : (
                            r.date ? formatShortDate(r.date) : "-"
                          )}
                        </td>
                        <td style={{ position: "relative", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {isEditing ? (
                            <input
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onBlur={handleSaveInterestEdit}
                              onKeyDown={(e) => { if (e.key === "Escape") cancelInterestEdit(); }}
                              placeholder="출처/설명"
                              style={{ width: "100%", padding: "4px 8px", fontSize: 13, border: "1px solid var(--accent)", borderRadius: 4, backgroundColor: "var(--surface)" }}
                            />
                          ) : (
                            <span title={r.source}>{r.source.length > 40 ? r.source.slice(0, 40) + "..." : r.source}</span>
                          )}
                        </td>
                        <td className="number positive" style={{ fontWeight: 600, fontSize: 15, position: "relative" }}>
                          {isEditing ? (
                            <input
                              type="number"
                              value={editingAmount}
                              onChange={(e) => setEditingAmount(e.target.value)}
                              onBlur={handleSaveInterestEdit}
                              onKeyDown={(e) => { if (e.key === "Escape") cancelInterestEdit(); }}
                              style={{ width: "100%", padding: "4px 8px", fontSize: 13, border: "1px solid var(--accent)", borderRadius: 4, backgroundColor: "var(--surface)", textAlign: "right" }}
                            />
                          ) : (
                            formatKRW(Math.round(r.amount))
                          )}
                        </td>
                        <td style={{ fontSize: 13, color: "var(--text-muted)", position: "relative" }}>
                          {isEditing ? (
                            <select
                              value={editingAccountId}
                              onChange={(e) => setEditingAccountId(e.target.value)}
                              onBlur={handleSaveInterestEdit}
                              onKeyDown={(e) => { if (e.key === "Escape") cancelInterestEdit(); }}
                              style={{ width: "100%", padding: "4px 8px", fontSize: 13, border: "1px solid var(--accent)", borderRadius: 4, backgroundColor: "var(--surface)" }}
                            >
                              <option value="">선택</option>
                              {accounts
                                .filter((acc) => !acc.archived || acc.id === editingAccountId)
                                .map((acc) => (
                                  <option key={acc.id} value={acc.id}>{acc.name || acc.id}</option>
                                ))}
                            </select>
                          ) : (
                            r.accountName || r.accountId || "-"
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {ledgerEntry && (
                            <div style={{ display: "flex", gap: 4, justifyContent: "center", alignItems: "center" }}>
                              {!isEditing ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingEntryId(ledgerEntry.id);
                                    setEditingDate(ledgerEntry.date || r.date || "");
                                    setEditingName(ledgerEntry.description ?? r.source);
                                    setEditingAmount(ledgerEntry.amount.toString());
                                    setEditingAccountId(ledgerEntry.toAccountId ?? r.accountId ?? "");
                                  }}
                                  style={{ background: "none", border: "1px solid var(--border)", color: "var(--accent)", cursor: "pointer", fontSize: 12, padding: "4px 8px", borderRadius: 4 }}
                                  title="이 행을 수정"
                                >
                                  ✏️
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => {
                                  if (confirm(`이 이자 기록을 삭제하시겠습니까?\n${r.date ? formatShortDate(r.date) : "날짜 없음"} · ${r.source}: ${formatKRW(Math.round(r.amount))}`)) {
                                    const deletedIndex = ledger.findIndex(l => l.id === ledgerEntry.id);
                                    onChangeLedger(ledger.filter(l => l.id !== ledgerEntry.id));
                                    showDeleteUndoToast(
                                      "이자 기록이 삭제되었습니다.",
                                      buildRestoreById(() => useAppStore.getState().data.ledger, onChangeLedger, ledgerEntry, deletedIndex)
                                    );
                                  }
                                }}
                                style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer", fontSize: 18, padding: "4px 8px" }}
                                title="삭제"
                              >
                                ×
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })
      )}
        </>
      )}
    </>
  );
});
