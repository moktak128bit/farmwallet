/**
 * 계좌 목록 테이블 (유형별) — 인라인 셀 편집(ID/계좌명/기관/유형/USD잔액) + 행 드래그 순서변경
 * + 숨김/삭제 버튼 + 유형별 합계 행.
 * AccountsPage에서 분리 — React.memo로 감싸 무관한 부모 상태 변경 시 재렌더를 건너뛴다.
 * 셀 편집·드래그 상태는 이 컴포넌트가 소유해 편집 타이핑이 부모(AccountsPage)를 재렌더하지 않는다.
 * 부모가 넘기는 콜백은 모두 안정적(setState 또는 useCallback)이어야 memo가 효과를 가진다.
 * 무거운 memo(stockMap/cardDebtMap/accountsByType)는 부모에서 계산해 props로 받는다.
 */
import React, { useRef, useState } from "react";
import type { Account, AccountType, LedgerEntry, AccountBalanceRow, StockTrade } from "../../../types";
import { formatKRW, formatUSD } from "../../../utils/formatter";
import { toast } from "react-hot-toast";
import { ACCOUNT_TYPE_LABEL } from "../accountsShared";

interface Props {
  safeAccounts: Account[];
  safeBalances: AccountBalanceRow[];
  /** 계좌 종류별로 묶인 잔액 행 (부모 memo) */
  accountsByType: Map<AccountType, AccountBalanceRow[]>;
  /** 계좌별 주식 평가액 KRW (부모 memo) */
  stockMap: Map<string, number>;
  /** 카드별 현재 부채 (부모 memo) */
  cardDebtMap: Map<string, { total: number }>;
  fxRate: number | null;
  ledger: LedgerEntry[];
  trades: StockTrade[];
  onChangeAccounts: (next: Account[]) => void;
  onRenameAccountId: (oldId: string, newId: string) => void;
  /** 계좌명 클릭 → 거래 내역 모달 열기 (null이면 닫기). setState라 참조 안정 */
  onSelectAccount: (account: Account | null) => void;
  /** 수정 버튼 → 잔액 조정 모달 열기. setState라 참조 안정 */
  onOpenAdjust: (target: { id: string; type: AccountType }) => void;
}

export const AccountTablesSection: React.FC<Props> = React.memo(function AccountTablesSection({
  safeAccounts,
  safeBalances,
  accountsByType,
  stockMap,
  cardDebtMap,
  fxRate,
  ledger,
  trades,
  onChangeAccounts,
  onRenameAccountId,
  onSelectAccount,
  onOpenAdjust,
}) {
  const [editingCell, setEditingCell] = useState<{
    id: string;
    field: "id" | "name" | "institution" | "type" | "currency" | "usdBalance" | "krwBalance";
  } | null>(null);
  const [editingCellValue, setEditingCellValue] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const accountNameClickTimerRef = useRef<number | null>(null);

  const handleDeleteAccount = (id: string) => {
    // 삭제 전 해당 계좌를 참조하는 ledger·trade 개수 확인.
    // 0개면 그대로 삭제, 그 이상이면 사용자에게 명시적 확인 받음
    // (참조 레코드는 그대로 유지 — 과거 거래 기록을 자동 삭제하지 않는 게 안전).
    const ledgerRefs = ledger.filter((l) => l.fromAccountId === id || l.toAccountId === id).length;
    const tradeRefs = trades.filter((t) => t.accountId === id).length;
    if (ledgerRefs > 0 || tradeRefs > 0) {
      const parts: string[] = [];
      if (ledgerRefs > 0) parts.push(`가계부 ${ledgerRefs}건`);
      if (tradeRefs > 0) parts.push(`주식거래 ${tradeRefs}건`);
      const refs = parts.join(", ");
      const ok = window.confirm(
        `이 계좌를 참조하는 ${refs}이(가) 있습니다.\n` +
        `계좌만 삭제하면 해당 거래 기록은 "삭제된 계좌"로 남습니다.\n계속하시겠습니까?`
      );
      if (!ok) return;
    }
    onChangeAccounts(safeAccounts.filter((a) => a.id !== id));
  };

  const handleReorderAccount = (id: string, newIndex: number) => {
    const currentIndex = safeAccounts.findIndex((a) => a.id === id);
    if (currentIndex === -1) return;
    const clamped = Math.max(0, Math.min(safeAccounts.length - 1, newIndex));
    if (clamped === currentIndex) return;
    const next = [...safeAccounts];
    const [item] = next.splice(currentIndex, 1);
    next.splice(clamped, 0, item);
    onChangeAccounts(next);
  };

  const startEditCell = (id: string, field: "id" | "name" | "institution" | "type" | "currency" | "usdBalance" | "krwBalance", current: string | number) => {
    setEditingCell({ id, field });
    setEditingCellValue(String(current));
  };

  const saveCell = () => {
    if (!editingCell) return;
    const { id, field } = editingCell;
    const raw = editingCellValue.trim();
    if (field === "id") {
      if (!raw) {
        alert("계좌 ID를 입력해 주세요.");
        return;
      }
      const nextId = raw.toUpperCase().replace(/\s/g, "_");
      if (nextId === id) {
        setEditingCell(null);
        setEditingCellValue("");
        return;
      }
      const exists = safeAccounts.some((a) => a.id === nextId && a.id !== id);
      if (exists) {
        alert("이미 사용 중인 계좌 ID입니다. 다른 ID를 입력해주세요.");
        return;
      }
      onRenameAccountId(id, nextId);
    } else if (field === "currency") {
      const updated = safeAccounts.map((a) =>
        a.id === id
          ? { ...a, currency: (raw === "KRW" || raw === "USD") ? (raw as "KRW" | "USD") : undefined }
          : a
      );
      onChangeAccounts(updated);
    } else {
      const updated = safeAccounts.map((a) =>
        a.id === id
          ? {
              ...a,
              [field]: field === "type"
                ? (editingCellValue as AccountType)
                : field === "usdBalance" || field === "krwBalance"
                ? Number(raw.replace(/[^\d.-]/g, "")) || 0
                : editingCellValue
            }
          : a
      );
      onChangeAccounts(updated);
    }
    setEditingCell(null);
    setEditingCellValue("");
  };

  const cancelCell = () => {
    setEditingCell(null);
    setEditingCellValue("");
  };

  const renderAccountRow = (row: AccountBalanceRow, accountType: AccountType) => (
    <tr
      key={row.account.id}
      draggable
      style={{ opacity: row.account.archived ? 0.55 : undefined }}
      title={row.account.archived ? "숨김 처리된 계좌 — 가계부/배당 입력 드롭다운에서 제외됩니다" : undefined}
      onDragOver={(e) => {
        if (!draggingId) return;
        e.preventDefault();
      }}
      onDrop={(e) => {
        if (!draggingId) return;
        e.preventDefault();
        const currentIndex = safeBalances.findIndex((b) => b.account.id === draggingId);
        handleReorderAccount(draggingId, currentIndex);
        setDraggingId(null);
      }}
      onDragStart={() => setDraggingId(row.account.id)}
      onDragEnd={() => setDraggingId(null)}
    >
      <td className="drag-cell">
        <span className="drag-handle" title="드래그하여 순서 변경">::</span>
      </td>
      <td
        onDoubleClick={() => startEditCell(row.account.id, "id", row.account.id)}
        style={{ cursor: "pointer" }}
        title="더블클릭하여 계좌 ID 수정"
      >
        {editingCell && editingCell.id === row.account.id && editingCell.field === "id" ? (
          <input
            type="text"
            value={editingCellValue}
            autoFocus
            onChange={(e) => setEditingCellValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveCell();
              if (e.key === "Escape") cancelCell();
            }}
            onBlur={saveCell}
          />
        ) : (
          row.account.id
        )}
      </td>
      <td
        onClick={(e) => {
          if (editingCell?.id === row.account.id && editingCell?.field === "name") return;
          e.stopPropagation();
          if (accountNameClickTimerRef.current != null) {
            window.clearTimeout(accountNameClickTimerRef.current);
            accountNameClickTimerRef.current = null;
          }
          accountNameClickTimerRef.current = window.setTimeout(() => {
            accountNameClickTimerRef.current = null;
            onSelectAccount(row.account);
          }, 250);
        }}
        onDoubleClick={() => {
          if (accountNameClickTimerRef.current != null) {
            window.clearTimeout(accountNameClickTimerRef.current);
            accountNameClickTimerRef.current = null;
          }
          onSelectAccount(null);
          startEditCell(row.account.id, "name", row.account.name ?? "");
        }}
        style={{ cursor: "pointer" }}
        title="클릭: 거래 내역 보기, 더블클릭: 계좌명 수정"
      >
        {editingCell && editingCell.id === row.account.id && editingCell.field === "name" ? (
          <input
            type="text"
            value={editingCellValue}
            autoFocus
            onChange={(e) => setEditingCellValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveCell();
              if (e.key === "Escape") cancelCell();
            }}
            onBlur={saveCell}
          />
        ) : (
          row.account.name
        )}
      </td>
      <td
        onDoubleClick={() =>
          startEditCell(row.account.id, "institution", row.account.institution ?? "")
        }
        style={{ cursor: "pointer" }}
        title="더블클릭하여 기관 수정"
      >
        {editingCell &&
        editingCell.id === row.account.id &&
        editingCell.field === "institution" ? (
          <input
            type="text"
            value={editingCellValue}
            autoFocus
            onChange={(e) => setEditingCellValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveCell();
              if (e.key === "Escape") cancelCell();
            }}
            onBlur={saveCell}
          />
        ) : (
          row.account.institution
        )}
      </td>
      {(accountType === "securities" || accountType === "crypto") ? (
        (() => {
          const stockAsset = stockMap.get(row.account.id) ?? 0;
          const usdBalance = (row.account.usdBalance ?? 0) + (row.usdTransferNet ?? 0);
          const krwBalance = row.currentBalance;

          const cashAsset = fxRate ? (usdBalance * fxRate) + krwBalance : krwBalance;
          const totalAsset = stockAsset + cashAsset;

          const stockAssetUSD = fxRate ? stockAsset / fxRate : null;
          const cashAssetUSD = fxRate ? cashAsset / fxRate : null;
          const totalAssetUSD = fxRate ? totalAsset / fxRate : null;

          return (
            <>
              {/* USD 잔액 (더블클릭 수정) */}
              <td
                onDoubleClick={() => startEditCell(row.account.id, "usdBalance", row.account.usdBalance ?? 0)}
                style={{ cursor: "pointer", padding: "8px", textAlign: "right" }}
                title="더블클릭하여 USD 잔액 수정"
                className="number"
              >
                {editingCell && editingCell.id === row.account.id && editingCell.field === "usdBalance" ? (
                  <input
                    type="text"
                    value={editingCellValue}
                    autoFocus
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^\d.-]/g, "");
                      setEditingCellValue(val);
                    }}
                    onBlur={saveCell}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveCell();
                      if (e.key === "Escape") {
                        setEditingCell(null);
                        setEditingCellValue("");
                      }
                    }}
                    style={{ padding: "4px", fontSize: "13px", width: "100%", textAlign: "right" }}
                  />
                ) : (
                  <span style={{ fontWeight: 500, color: usdBalance >= 0 ? "var(--primary)" : "var(--danger)" }}>
                    {formatUSD(usdBalance)}
                  </span>
                )}
              </td>
              {/* KRW 잔액 (ledger에서 자동 반영) */}
              <td
                style={{ padding: "8px", textAlign: "right" }}
                title="KRW 잔액 (원장에서 자동 반영)"
                className="number"
              >
                <span style={{ fontWeight: 500, color: krwBalance >= 0 ? "var(--primary)" : "var(--danger)" }}>
                  {formatKRW(krwBalance)}
                </span>
              </td>
              {/* 주식자산 */}
              <td className={`number ${stockAsset >= 0 ? "positive" : "negative"}`}>
                <div>{formatKRW(stockAsset)}</div>
                {stockAssetUSD != null && (
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                    {formatUSD(stockAssetUSD)}
                  </div>
                )}
              </td>
              {/* 현금자산 (주식 제외) */}
              <td className={`number ${cashAsset >= 0 ? "positive" : "negative"}`}>
                <div>{formatKRW(cashAsset)}</div>
                {cashAssetUSD != null && (
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                    {formatUSD(cashAssetUSD)}
                  </div>
                )}
              </td>
              {/* 총 자산 */}
              <td className={`number ${totalAsset >= 0 ? "positive" : "negative"}`}>
                <div>{formatKRW(totalAsset)}</div>
                {totalAssetUSD != null && (
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                    {formatUSD(totalAssetUSD)}
                  </div>
                )}
              </td>
            </>
          );
        })()
      ) : (
        <>
          <td
            onDoubleClick={() => startEditCell(row.account.id, "type", row.account.type)}
            style={{ cursor: "pointer" }}
            title="더블클릭하여 계좌 유형 수정"
          >
            {editingCell && editingCell.id === row.account.id && editingCell.field === "type" ? (
              <select
                value={editingCellValue}
                autoFocus
                onChange={(e) => setEditingCellValue(e.target.value)}
                onBlur={saveCell}
              >
                <option value="checking">입출금</option>
                <option value="savings">저축</option>
                <option value="card">신용카드</option>
                <option value="securities">증권</option>
                <option value="crypto">암호화폐</option>
                <option value="other">기타</option>
              </select>
            ) : (
              ACCOUNT_TYPE_LABEL[row.account.type]
            )}
          </td>
        </>
      )}
      {(() => {
        const accountName = (row.account.name + row.account.id).toLowerCase();
        const isUSD = row.account.currency === "USD" ||
                     accountName.includes("usd") ||
                     accountName.includes("dollar") ||
                     accountName.includes("달러");
        const formatAmount = (value: number) => isUSD ? formatUSD(value) : formatKRW(value);

        // Securities/crypto account is handled above.
        if (accountType === "securities" || accountType === "crypto") {
          return null;
        }

        // 증권/카드 계좌는 별도 렌더링 (위에서 securities, 아래에서 card 처리)
        if (accountType === "card") {
          return null;
        }

        // For checking/savings/other, display current balance.
        const cashAsset = row.currentBalance;

        return (
          <td className={`number ${cashAsset >= 0 ? "positive" : "negative"}`}>
            {formatAmount(cashAsset)}
          </td>
        );
      })()}
      {(() => {
        if (accountType === "card") {
          const debtInfo = cardDebtMap.get(row.account.id) ?? { total: 0 };
          const netDebt = debtInfo.total; // 양수=부채, 음수=선납·환불 잔액
          return (
            <>
              <td className="number" style={{ whiteSpace: "nowrap" }}>
                {netDebt > 0 ? (
                  <div className="negative" title="초기 부채 + 카드 사용 − 결제. 지금 갚을 돈.">
                    부채 {formatKRW(Math.round(netDebt))}
                  </div>
                ) : netDebt < 0 ? (
                  <div className="positive" title="결제·환불이 사용보다 많아 카드에 남은 +잔액">
                    선납 {formatKRW(Math.round(Math.abs(netDebt)))}
                  </div>
                ) : (
                  <div className="muted">부채 0</div>
                )}
              </td>
            </>
          );
        }
        return null;
      })()}
      <td style={{ whiteSpace: "nowrap" }}>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            type="button"
            className="primary"
            onClick={() => onOpenAdjust({ id: row.account.id, type: accountType })}
            style={{ fontSize: "14px", padding: "8px 16px" }}
          >
            수정
          </button>
          <button
            type="button"
            onClick={() => {
              const isArchiving = !row.account.archived;
              const updated = safeAccounts.map((a) =>
                a.id === row.account.id ? { ...a, archived: isArchiving || undefined } : a
              );
              onChangeAccounts(updated);
              toast.success(
                isArchiving
                  ? `"${row.account.name}" 숨김 — 입력 드롭다운에서 제외됩니다 (기록은 유지)`
                  : `"${row.account.name}" 다시 표시됩니다`
              );
            }}
            style={{ fontSize: "14px", padding: "8px 16px" }}
            title={row.account.archived ? "가계부·배당 입력 폼에 다시 노출" : "가계부·배당 입력 폼에서 숨김 (과거 기록은 그대로 유지)"}
          >
            {row.account.archived ? "표시" : "숨김"}
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              const accountId = row.account.id;
              const ledgerRefs = ledger.filter((l) => l.fromAccountId === accountId || l.toAccountId === accountId).length;
              const tradeRefs = trades.filter((t) => t.accountId === accountId).length;
              const refParts: string[] = [];
              if (ledgerRefs > 0) refParts.push(`가계부 ${ledgerRefs}건`);
              if (tradeRefs > 0) refParts.push(`주식 거래 ${tradeRefs}건`);
              const refNote = refParts.length > 0
                ? `\n\n이 계좌를 참조하는 ${refParts.join(", ")}이 있습니다. 삭제하면 해당 항목은 '누락된 참조'로 표시되며 잔액/집계에 포함되지 않습니다.`
                : "\n\n관련 거래 내역은 유지됩니다.";
              if (window.confirm(`"${row.account.name}" 계좌를 삭제할까요?${refNote}`)) {
                handleDeleteAccount(accountId);
              }
            }}
            style={{ fontSize: "14px", padding: "8px 16px" }}
          >
            삭제
          </button>
        </div>
      </td>
    </tr>
  );

  return (
    <>
      {(["checking", "savings", "card", "securities", "crypto", "other"] as AccountType[]).map((type) => {
        const accountsOfType = accountsByType.get(type) ?? [];
        if (accountsOfType.length === 0) return null;

        return (
          <div key={type} style={{ marginBottom: 24 }}>
            <h3 style={{ marginBottom: 12, fontSize: 16, fontWeight: 600, color: "var(--text)" }}>
              {ACCOUNT_TYPE_LABEL[type]}
            </h3>
            <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 60 }}>순서</th>
            <th>계좌 ID</th>
            <th>계좌명</th>
            <th>기관</th>
            {(type === "securities" || type === "crypto") ? (
              <>
                <th>USD</th>
                <th>KRW</th>
                <th>주식</th>
                <th>현금</th>
                <th>합계</th>
              </>
            ) : (
              <>
                <th style={{ width: "60px" }}>유형</th>
              </>
            )}
            {type === "card" ? (
              <>
                <th>현재 부채</th>
              </>
            ) : (
              <th>현재 잔액</th>
            )}
            <th>작업</th>
          </tr>
        </thead>
              <tbody>
                {accountsOfType.map((row) => renderAccountRow(row, type))}
                {/* 합계 행 */}
                {(() => {
                  if (type === "securities" || type === "crypto") {
                    const totalStock = accountsOfType.reduce((sum, row) => {
                      return sum + (stockMap.get(row.account.id) ?? 0);
                    }, 0);

                    // USD 잔액 합계, KRW 잔액 합계
                    const totalUsdBalance = accountsOfType.reduce((sum, row) => {
                      return sum + (row.account.usdBalance ?? 0);
                    }, 0);
                    // KRW 잔액 합계 (ledger 기반 currentBalance)
                    const totalKrwBalance = accountsOfType.reduce((sum, row) => {
                      return sum + row.currentBalance;
                    }, 0);

                    // 현금자산 합계 = (USD*환율) + KRW
                    const totalCash = fxRate ? (totalUsdBalance * fxRate) + totalKrwBalance : totalKrwBalance;
                    const totalAsset = totalStock + totalCash;
                    const totalStockUSD = fxRate ? totalStock / fxRate : null;
                    const totalCashUSD = fxRate ? totalCash / fxRate : null;
                    const totalAssetUSD = fxRate ? totalAsset / fxRate : null;

                    return (
                      <tr key="total" style={{ backgroundColor: "var(--bg)", fontWeight: "bold", borderTop: "2px solid var(--border)" }}>
                        <td colSpan={4} style={{ textAlign: "right", padding: "12px" }}>합계</td>
                        <td className={`number ${totalUsdBalance >= 0 ? "positive" : "negative"}`}>
                          {formatUSD(totalUsdBalance)}
                        </td>
                        <td className={`number ${totalKrwBalance >= 0 ? "positive" : "negative"}`}>
                          {formatKRW(totalKrwBalance)}
                        </td>
                        <td className={`number ${totalStock >= 0 ? "positive" : "negative"}`}>
                          <div>{formatKRW(totalStock)}</div>
                          {totalStockUSD != null && (
                            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                              {formatUSD(totalStockUSD)}
                            </div>
                          )}
                        </td>
                        <td className={`number ${totalCash >= 0 ? "positive" : "negative"}`}>
                          <div>{formatKRW(totalCash)}</div>
                          {totalCashUSD != null && (
                            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                              {formatUSD(totalCashUSD)}
                            </div>
                          )}
                        </td>
                        <td className={`number ${totalAsset >= 0 ? "positive" : "negative"}`}>
                          <div>{formatKRW(totalAsset)}</div>
                          {totalAssetUSD != null && (
                            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                              {formatUSD(totalAssetUSD)}
                            </div>
                          )}
                        </td>
                        <td></td>
                      </tr>
                    );
                  } else if (type === "card") {
                    const net = accountsOfType.reduce((sum, row) => {
                      const debtInfo = cardDebtMap.get(row.account.id) ?? { total: 0 };
                      return sum + debtInfo.total;
                    }, 0);
                    return (
                      <tr key="total" style={{ backgroundColor: "var(--bg)", fontWeight: "bold", borderTop: "2px solid var(--border)" }}>
                        <td colSpan={5} style={{ textAlign: "right", padding: "12px" }}>합계</td>
                        <td className="number" style={{ whiteSpace: "nowrap" }}>
                          {net > 0 ? (
                            <div className="negative">부채 {formatKRW(Math.round(net))}</div>
                          ) : net < 0 ? (
                            <div className="positive">선납 {formatKRW(Math.round(Math.abs(net)))}</div>
                          ) : (
                            <div className="muted">부채 0</div>
                          )}
                        </td>
                        <td></td>
                      </tr>
                    );
                  } else {
                    // 입출금·저축 합계 (해당 유형의 currentBalance 합계)
                    const sumCurrentBalanceByType = accountsOfType.reduce((sum, row) => {
                      return sum + row.currentBalance;
                    }, 0);
                    return (
                      <tr key="total" style={{ backgroundColor: "var(--bg)", fontWeight: "bold", borderTop: "2px solid var(--border)" }}>
                        <td colSpan={5} style={{ textAlign: "right", padding: "12px" }}>합계</td>
                        <td className={`number ${sumCurrentBalanceByType >= 0 ? "positive" : "negative"}`}>
                          {formatKRW(Math.round(sumCurrentBalanceByType))}
                        </td>
                        <td></td>
                      </tr>
                    );
                  }
                })()}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
});
