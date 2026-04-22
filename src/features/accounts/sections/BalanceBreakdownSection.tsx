import { ChevronDown, ChevronRight } from "lucide-react";
import type { AccountBalanceRow } from "../../../types";

type EditField = "initialBalance" | "debt" | "savings" | "cashAdjustment" | "initialCashBalance";

interface Props {
  safeBalances: AccountBalanceRow[];
  orderedRowsForInitialReverse: AccountBalanceRow[];
  showBalanceBreakdown: boolean;
  setShowBalanceBreakdown: (fn: (v: boolean) => boolean) => void;
  editingNumber: { id: string; field: EditField } | null;
  editValue: string;
  setEditValue: (v: string) => void;
  startEditNumber: (id: string, field: EditField, currentValue: number) => void;
  saveNumber: () => void;
  cancelEditNumber: () => void;
  formatKRW: (n: number) => string;
}

export function BalanceBreakdownSection({
  safeBalances,
  orderedRowsForInitialReverse,
  showBalanceBreakdown,
  setShowBalanceBreakdown,
  editingNumber,
  editValue,
  setEditValue,
  startEditNumber,
  saveNumber,
  cancelEditNumber,
  formatKRW,
}: Props) {
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
}
