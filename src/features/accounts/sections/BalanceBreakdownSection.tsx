/**
 * 계좌별 잔액 구성 표 (접이식) — 시작금액 인라인 편집 + 항목별 구성·합계.
 * AccountsPage에서 분리 — 펼침/편집 상태를 이 컴포넌트가 소유해
 * 편집 타이핑이 부모(AccountsPage)를 재렌더하지 않는다.
 * React.memo로 감싸므로 부모가 넘기는 props는 안정적(부모 useMemo/setState)이어야 한다.
 */
import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Account, AccountBalanceRow } from "../../../types";
import { parseAmount } from "../../../utils/parseAmount";

type EditField = "initialBalance" | "debt" | "savings" | "cashAdjustment" | "initialCashBalance";

interface Props {
  safeBalances: AccountBalanceRow[];
  orderedRowsForInitialReverse: AccountBalanceRow[];
  safeAccounts: Account[];
  onChangeAccounts: (next: Account[]) => void;
  formatKRW: (n: number) => string;
}

export const BalanceBreakdownSection: React.FC<Props> = React.memo(function BalanceBreakdownSection({
  safeBalances,
  orderedRowsForInitialReverse,
  safeAccounts,
  onChangeAccounts,
  formatKRW,
}) {
  const [showBalanceBreakdown, setShowBalanceBreakdown] = useState(false);
  const [editingNumber, setEditingNumber] = useState<{ id: string; field: EditField } | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEditNumber = (accountId: string, field: EditField, currentValue: number) => {
    setEditingNumber({ id: accountId, field });
    // 소수점 쓰레기(부동소수점 오차) 가 있으면 정수로 반올림해 편집 입력에 넣는다.
    // (parseAmount 기본값이 정수만 허용하므로, "123.45" 가 들어가면 소수점이 지워지며 12345로 저장되는 버그 방지)
    const safe = Number.isFinite(currentValue) ? Math.round(currentValue) : 0;
    setEditValue(String(safe));
  };

  const saveNumber = () => {
    if (!editingNumber) return;
    const value = parseAmount(editValue);
    const updated = safeAccounts.map((a) => {
      if (a.id === editingNumber.id) {
        if (editingNumber.field === "cashAdjustment") {
          return { ...a, cashAdjustment: value };
        }
        if (editingNumber.field === "initialCashBalance") {
          return { ...a, initialCashBalance: value };
        }
        if (editingNumber.field === "debt") {
          return { ...a, debt: value };
        }
        if (editingNumber.field === "savings") {
          return { ...a, savings: value };
        }
        return { ...a, [editingNumber.field]: value };
      }
      return a;
    });
    onChangeAccounts(updated);
    setEditingNumber(null);
    setEditValue("");
  };

  const cancelEditNumber = () => {
    setEditingNumber(null);
    setEditValue("");
  };

  if (safeBalances.length === 0) return null;

  return (
    <div className="card" style={{ marginTop: 24, padding: 0, overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setShowBalanceBreakdown((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "16px 20px",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: 16,
          fontWeight: 600,
          color: "var(--text)",
          textAlign: "left"
        }}
      >
        {showBalanceBreakdown ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        계좌별 잔액 구성
      </button>
      {showBalanceBreakdown && (
        <div style={{ padding: "0 20px 20px" }}>
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-muted)" }}>
            각 계좌의 현재 잔액이 어떻게 구성되었는지 항목별로 보여줍니다.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", position: "sticky", left: 0, background: "var(--surface)", zIndex: 1 }}>계좌</th>
                  <th style={{ textAlign: "right" }}>시작금액</th>
                  <th style={{ textAlign: "right" }}>보정금액</th>
                  <th style={{ textAlign: "right" }}>수입</th>
                  <th style={{ textAlign: "right" }}>지출</th>
                  <th style={{ textAlign: "right" }}>이체 순액</th>
                  <th style={{ textAlign: "right" }}>매매 영향</th>
                  <th style={{
                    textAlign: "right",
                    borderLeft: "2px solid var(--border)",
                    paddingLeft: 12,
                    fontWeight: 700
                  }}>현재 잔액</th>
                </tr>
              </thead>
              <tbody>
                {orderedRowsForInitialReverse.map((row) => {
                  const account = row.account;
                  const baseBalance =
                    account.type === "securities" || account.type === "crypto"
                      ? (account.initialCashBalance ?? account.initialBalance ?? 0)
                      : (account.initialBalance ?? 0);
                  const cashAdj = account.cashAdjustment ?? 0;
                  const { incomeSum, expenseSum, transferNet, tradeCashImpact, currentBalance } = row;

                  const numCell = (value: number, opts?: { highlight?: boolean; muted?: boolean }) => {
                    const isZero = value === 0;
                    const color = opts?.highlight
                      ? (value >= 0 ? "var(--primary)" : "var(--danger)")
                      : isZero
                        ? "var(--text-muted)"
                        : value > 0
                          ? "var(--chart-income)"
                          : "var(--chart-expense)";
                    return (
                      <td style={{
                        textAlign: "right",
                        fontWeight: opts?.highlight ? 700 : (isZero ? 400 : 500),
                        color,
                        ...(opts?.highlight ? { borderLeft: "2px solid var(--border)", paddingLeft: 12 } : {})
                      }}>
                        {isZero && !opts?.highlight ? "-" : formatKRW(Math.round(value))}
                      </td>
                    );
                  };

                  const baseField: "initialBalance" | "initialCashBalance" =
                    account.type === "securities" || account.type === "crypto"
                      ? "initialCashBalance"
                      : "initialBalance";
                  const isEditingBase =
                    editingNumber?.id === account.id && editingNumber.field === baseField;
                  return (
                    <tr key={account.id}>
                      <td style={{
                        position: "sticky",
                        left: 0,
                        background: "var(--surface)",
                        zIndex: 1,
                        fontWeight: 500
                      }}>
                        <div>{account.name}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                          {account.institution || account.id}
                        </div>
                      </td>
                      {isEditingBase ? (
                        <td style={{ textAlign: "right" }}>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={editValue}
                            autoFocus
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={saveNumber}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveNumber();
                              else if (e.key === "Escape") cancelEditNumber();
                            }}
                            style={{
                              width: 100,
                              padding: "4px 6px",
                              borderRadius: 4,
                              textAlign: "right",
                              fontSize: 13
                            }}
                          />
                        </td>
                      ) : (
                        <td
                          onClick={() => startEditNumber(account.id, baseField, baseBalance)}
                          title="클릭하여 시작금액 수정"
                          style={{
                            textAlign: "right",
                            fontWeight: baseBalance === 0 ? 400 : 500,
                            color:
                              baseBalance === 0
                                ? "var(--text-muted)"
                                : baseBalance > 0
                                  ? "var(--chart-income)"
                                  : "var(--chart-expense)",
                            cursor: "pointer",
                            textDecoration: "underline dotted",
                            textUnderlineOffset: 3
                          }}
                        >
                          {baseBalance === 0 ? "-" : formatKRW(Math.round(baseBalance))}
                        </td>
                      )}
                      {numCell(cashAdj)}
                      {numCell(incomeSum)}
                      {numCell(expenseSum)}
                      {numCell(transferNet)}
                      {numCell(tradeCashImpact)}
                      {numCell(currentBalance, { highlight: true })}
                    </tr>
                  );
                })}
                {(() => {
                  const rows = orderedRowsForInitialReverse;
                  const totals = rows.reduce(
                    (acc, row) => {
                      const account = row.account;
                      const base =
                        account.type === "securities" || account.type === "crypto"
                          ? (account.initialCashBalance ?? account.initialBalance ?? 0)
                          : (account.initialBalance ?? 0);
                      return {
                        base: acc.base + base,
                        cashAdj: acc.cashAdj + (account.cashAdjustment ?? 0),
                        income: acc.income + row.incomeSum,
                        expense: acc.expense + row.expenseSum,
                        transfer: acc.transfer + row.transferNet,
                        trade: acc.trade + row.tradeCashImpact,
                        balance: acc.balance + row.currentBalance
                      };
                    },
                    { base: 0, cashAdj: 0, income: 0, expense: 0, transfer: 0, trade: 0, balance: 0 }
                  );

                  const totalCell = (value: number, opts?: { highlight?: boolean }) => (
                    <td style={{
                      textAlign: "right",
                      fontWeight: 700,
                      color: opts?.highlight
                        ? (value >= 0 ? "var(--primary)" : "var(--danger)")
                        : value === 0
                          ? "var(--text-muted)"
                          : "var(--text)",
                      ...(opts?.highlight ? { borderLeft: "2px solid var(--border)", paddingLeft: 12 } : {})
                    }}>
                      {value === 0 && !opts?.highlight ? "-" : formatKRW(Math.round(value))}
                    </td>
                  );

                  return (
                    <tr style={{ borderTop: "2px solid var(--border)", background: "var(--bg)" }}>
                      <td style={{
                        position: "sticky",
                        left: 0,
                        background: "var(--bg)",
                        zIndex: 1,
                        fontWeight: 700,
                        textAlign: "right",
                        paddingRight: 12
                      }}>합계</td>
                      {totalCell(totals.base)}
                      {totalCell(totals.cashAdj)}
                      {totalCell(totals.income)}
                      {totalCell(totals.expense)}
                      {totalCell(totals.transfer)}
                      {totalCell(totals.trade)}
                      {totalCell(totals.balance, { highlight: true })}
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
          <p style={{ margin: "10px 0 0", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
            ※ 카드 계좌는 부채 추적용으로 이 표에서 제외됩니다. 이체 순액 합계가 0이 아닌 경우, 카드 계좌로의 순 이체(카드 결제 등)가 포함돼 있기 때문입니다.
          </p>
        </div>
      )}
    </div>
  );
});
