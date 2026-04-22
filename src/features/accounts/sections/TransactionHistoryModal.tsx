import type { Account, LedgerEntry, StockTrade, AccountBalanceRow } from "../../../types";
import { formatShortDate, formatKRW, formatUSD } from "../../../utils/formatter";
import { isUSDStock } from "../../../utils/finance";
import { shouldUseUsdBalanceMode } from "../../../utils/tradeCashImpact";

interface Props {
  account: Account;
  ledger: LedgerEntry[];
  trades: StockTrade[];
  safeAccounts: Account[];
  safeBalances: AccountBalanceRow[];
  realizedPnlByTradeId: Map<string, number>;
  effectiveFxRate: number | null;
  onClose: () => void;
}

export function TransactionHistoryModal({
  account: selectedAccount,
  ledger,
  trades,
  safeAccounts,
  safeBalances,
  realizedPnlByTradeId,
  effectiveFxRate,
  onClose,
}: Props) {
  const ledgerRows = ledger
    .filter((l) => l.fromAccountId === selectedAccount.id || l.toAccountId === selectedAccount.id)
    .map((l) => ({
      type: "ledger" as const,
      id: l.id,
      date: l.date,
      kind: l.kind,
      category: [l.category, l.subCategory].filter(Boolean).join(" / ") || "-",
      description: l.description || "-",
      amount: l.fromAccountId === selectedAccount.id ? -l.amount : l.amount,
      isUsd: l.currency === "USD",
    }));
  const tradeRows = trades
    .filter((t) => t.accountId === selectedAccount.id)
    .map((t) => {
      const usdTicker = isUSDStock(t.ticker);
      const useUsdBalanceMode = shouldUseUsdBalanceMode(
        t.accountId,
        selectedAccount.type === "securities" || selectedAccount.type === "crypto",
        usdTicker,
        safeAccounts,
        ledger
      );
      const signedUsdAmount = t.side === "buy" ? -t.totalAmount : t.totalAmount;
      const amount = useUsdBalanceMode
        ? signedUsdAmount
        : (Number(t.cashImpact) || 0);
      const realizedPnl = t.side === "sell" ? (realizedPnlByTradeId.get(t.id) ?? amount) : undefined;
      const sellLabel = realizedPnl != null && realizedPnl >= 0 ? "투자수익" : "투자손실";
      const sellKind = t.side === "sell" ? (realizedPnl != null && realizedPnl >= 0 ? "stock_sell_profit" : "stock_sell_loss") : "stock_buy";
      return {
        type: "trade" as const,
        id: `trade-${t.id}`,
        date: t.date,
        kind: t.side === "buy" ? "stock_buy" : sellKind,
        category: t.ticker ? `${t.ticker}${t.name ? ` - ${t.name}` : ""}` : "-",
        description: t.side === "buy" ? "주식 매수" : sellLabel,
        amount,
        displayAmount: realizedPnl,
        isUsd: useUsdBalanceMode,
      };
    });
  type Row = typeof ledgerRows[0] | typeof tradeRows[0];
  const accountTransactions: Row[] = [...ledgerRows, ...tradeRows].sort((a, b) =>
    b.date.localeCompare(a.date) || (a.id < b.id ? 1 : -1)
  );

  const balanceRow = safeBalances.find((b) => b.account.id === selectedAccount.id);
  const krwBalance = balanceRow?.currentBalance ?? 0;
  const isSecuritiesAccount = selectedAccount.type === "securities" || selectedAccount.type === "crypto";
  const currentBalance = krwBalance;

  const amounts: number[] = accountTransactions.map((r) => Number(r.amount) || 0);
  const runningBalances: number[] = [];
  let acc = currentBalance;
  for (let i = 0; i < amounts.length; i++) {
    runningBalances.push(acc);
    const amt = amounts[i];
    if (accountTransactions[i].isUsd) {
      if (!isSecuritiesAccount && effectiveFxRate != null) {
        acc -= amt * effectiveFxRate;
      }
    } else {
      acc -= amt;
    }
  }
  const startingBalance = acc;

  const kindLabel = (r: Row): string => {
    const amt = Number(r.amount) || 0;
    const dir = amt >= 0 ? "in" : "out";
    if (r.kind === "income") return "수입";
    if (r.kind === "transfer") return dir === "in" ? "이체(입금)" : "이체(출금)";
    if (r.kind === "expense") return dir === "in" ? "지출(환급)" : "지출";
    if (r.kind === "stock_buy") return "주식 매수";
    if (r.kind === "stock_sell_profit") return "투자수익";
    if (r.kind === "stock_sell_loss") return "투자손실";
    if (r.kind === "stock_sell") return "주식 매도";
    return String(r.kind ?? "");
  };
  const realizedPnlByRowId = new Map<string, number>();
  accountTransactions.forEach((r) => {
    if (r.type === "trade" && "displayAmount" in r && r.displayAmount != null) {
      realizedPnlByRowId.set(r.id, Number(r.displayAmount) || 0);
    }
  });

  const formatAmount = (r: Row, val: number) => {
    if (r.isUsd && effectiveFxRate) return formatKRW(Math.round(val * effectiveFxRate));
    if (r.isUsd) return formatUSD(val);
    return formatKRW(Math.round(val));
  };

  let inflowCount = 0;
  let outflowCount = 0;
  let inflowTotal = 0;
  let outflowTotal = 0;
  accountTransactions.forEach((r, idx) => {
    if (r.isUsd && isSecuritiesAccount) return;
    const amt = amounts[idx];
    const krw = r.isUsd && effectiveFxRate ? amt * effectiveFxRate : amt;
    if (krw > 0) { inflowCount++; inflowTotal += krw; }
    else if (krw < 0) { outflowCount++; outflowTotal += -krw; }
  });
  const netFlow = inflowTotal - outflowTotal;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "950px", maxHeight: "80vh" }}>
        <div className="modal-header">
          <h3>{selectedAccount.name} ({selectedAccount.id}) - 거래 내역</h3>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: "none", fontSize: "20px", cursor: "pointer", padding: "0", width: "24px", height: "24px" }}
          >
            ×
          </button>
        </div>
        {accountTransactions.length > 0 && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
            gap: 8,
            padding: "12px 20px",
            background: "var(--bg)",
            borderBottom: "1px solid var(--border)",
          }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>시작 잔액</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-muted)" }}>{formatKRW(Math.round(startingBalance))}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>현재 잔액</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{formatKRW(Math.round(currentBalance))}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>총 입금 ({inflowCount}건)</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--chart-income)" }}>+{formatKRW(Math.round(inflowTotal))}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>총 출금 ({outflowCount}건)</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--chart-expense)" }}>−{formatKRW(Math.round(outflowTotal))}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>순 흐름</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: netFlow >= 0 ? "var(--chart-income)" : "var(--chart-expense)" }}>
                {netFlow >= 0 ? "+" : "−"}{formatKRW(Math.round(Math.abs(netFlow)))}
              </div>
            </div>
          </div>
        )}
        <div className="modal-body" style={{ overflowY: "auto", maxHeight: "calc(80vh - 200px)" }}>
          {accountTransactions.length === 0 ? (
            <p style={{ textAlign: "center", color: "var(--text-muted)", padding: "40px" }}>
              이 계좌에 거래 내역이 없습니다.
            </p>
          ) : (
            <table className="data-table" style={{ fontSize: "13px" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", width: 90 }}>날짜</th>
                  <th style={{ textAlign: "left" }}>내용</th>
                  <th style={{ textAlign: "right", color: "var(--chart-income)", width: 120 }}>입금</th>
                  <th style={{ textAlign: "right", color: "var(--chart-expense)", width: 120 }}>출금</th>
                  <th style={{ textAlign: "right", width: 110 }}>잔액</th>
                </tr>
              </thead>
              <tbody>
                {accountTransactions.map((r, idx) => {
                  const cashFlow = amounts[idx];
                  const realizedPnl = realizedPnlByRowId.get(r.id);
                  const balanceAfter = runningBalances[idx];
                  const isInflow = cashFlow > 0;
                  const isOutflow = cashFlow < 0;
                  const kind = kindLabel(r);
                  const cat = r.category && r.category !== kind && !kind.includes(r.category) ? r.category : null;
                  const typeLabel = cat ? `${kind} · ${cat}` : kind;
                  const description = r.description && r.description.trim() !== "" && r.description !== "-" ? r.description : null;

                  return (
                    <tr key={r.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{formatShortDate(r.date)}</td>
                      <td>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{typeLabel}</div>
                        {description && (
                          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{description}</div>
                        )}
                      </td>
                      <td style={{ textAlign: "right", color: "var(--chart-income)", fontWeight: 600 }}>
                        {isInflow ? `+${formatAmount(r, cashFlow)}` : <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>—</span>}
                        {isSecuritiesAccount && r.isUsd && isInflow && (
                          <div style={{ fontSize: 10, marginTop: 2, color: "var(--text-muted)", fontWeight: 400 }}>
                            (USD — 예수금 미반영)
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: "right", color: "var(--chart-expense)", fontWeight: 600 }}>
                        {isOutflow ? `−${formatAmount(r, -cashFlow)}` : <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>—</span>}
                        {isSecuritiesAccount && r.isUsd && isOutflow && (
                          <div style={{ fontSize: 10, marginTop: 2, color: "var(--text-muted)", fontWeight: 400 }}>
                            (USD — 예수금 미반영)
                          </div>
                        )}
                        {realizedPnl != null && (
                          <div style={{ fontSize: 10, marginTop: 2, fontWeight: 500, color: realizedPnl >= 0 ? "var(--chart-income)" : "var(--chart-expense)" }}>
                            실현 {realizedPnl >= 0 ? "+" : "−"}{formatKRW(Math.round(Math.abs(realizedPnl)))}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap" }}>
                        {formatKRW(Math.round(balanceAfter))}
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ background: "var(--bg)", borderTop: "2px solid var(--border)" }}>
                  <td colSpan={4} style={{ color: "var(--text-muted)", padding: "10px 12px", fontStyle: "italic" }}>
                    시작 잔액 (모든 거래 적용 전)
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                    {formatKRW(Math.round(startingBalance))}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
