import type { Account, AccountType, LedgerEntry, AccountBalanceRow } from "../../../types";
import { formatNumber, formatKRW, formatUSD } from "../../../utils/formatter";
import { parseAmount } from "../../../utils/parseAmount";
import { ACCOUNT_TYPE_LABEL, sanitizeSignedNumericInput } from "../accountsShared";
import { CardPaymentSection } from "./CardPaymentSection";

interface Props {
  adjustingAccount: { id: string; type: AccountType };
  safeAccounts: Account[];
  safeBalances: AccountBalanceRow[];
  cardDebtMap: Map<string, { total: number }>;
  ledger: LedgerEntry[];
  onChangeLedger?: (next: LedgerEntry[]) => void;
  fxRate: number | null;
  adjustValue: string;
  setAdjustValue: (v: string) => void;
  isSetDirectly: boolean;
  setIsSetDirectly: (v: boolean) => void;
  editUsdBalance: string;
  setEditUsdBalance: (v: string) => void;
  editKrwBalance: string;
  setEditKrwBalance: (v: string) => void;
  onAdjustBalance: () => void;
  onClose: () => void;
}

export function AdjustmentModal({
  adjustingAccount,
  safeAccounts,
  safeBalances,
  cardDebtMap,
  ledger,
  onChangeLedger,
  fxRate,
  adjustValue,
  setAdjustValue,
  isSetDirectly,
  setIsSetDirectly,
  editUsdBalance,
  setEditUsdBalance,
  editKrwBalance,
  setEditKrwBalance,
  onAdjustBalance,
  onClose,
}: Props) {
  const account = safeAccounts.find((a) => a.id === adjustingAccount.id);
  if (!account) return null;

  const currentAdjustment =
    adjustingAccount.type === "card"
      ? (cardDebtMap.get(account.id)?.total ?? 0)
      : (account.initialBalance ?? 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "500px" }}>
        <div className="modal-header">
          <h3>
            {(() => {
              const label = `${account.name} (${ACCOUNT_TYPE_LABEL[adjustingAccount.type]})`;
              if (adjustingAccount.type === "card") {
                return `${label} - 결제 관리`;
              } else if (adjustingAccount.type === "securities" || adjustingAccount.type === "crypto") {
                return `${label} - 보유금액 설정`;
              } else {
                return `${label} - 보유금액 조정`;
              }
            })()}
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: "none", fontSize: "20px", cursor: "pointer", padding: "0", width: "24px", height: "24px" }}
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          {adjustingAccount.type === "card" && onChangeLedger && (
            <CardPaymentSection
              account={account}
              checkingAccounts={safeAccounts.filter((a) => a.type === "checking" || a.type === "savings")}
              currentDebt={cardDebtMap.get(account.id)?.total ?? 0}
              onAddPayment={(entry) => {
                onChangeLedger([...ledger, entry]);
                onClose();
              }}
              formatKRW={formatKRW}
            />
          )}

          {(() => {
            const balanceRow = safeBalances.find((b) => b.account.id === adjustingAccount.id);
            const currentBalance = balanceRow?.currentBalance ?? 0;
            const accountName = (account.name + account.id).toLowerCase();
            const isUSD = account.currency === "USD" ||
              accountName.includes("usd") ||
              accountName.includes("dollar") ||
              accountName.includes("달러");
            const formatAmount = (value: number) => isUSD ? formatUSD(value) : formatKRW(value);

            if ((adjustingAccount.type === "securities" || adjustingAccount.type === "crypto") && balanceRow) {
              const dispUsd = (account.usdBalance ?? 0) + (balanceRow.usdTransferNet ?? 0);
              return (
                <div style={{ marginBottom: "20px", padding: "12px", background: "var(--bg)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>현재 보유금액</div>
                  <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                    <div>
                      <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>USD: </span>
                      <span style={{ fontSize: "20px", fontWeight: "700", color: dispUsd >= 0 ? "var(--primary)" : "var(--danger)" }}>
                        {formatUSD(dispUsd)}
                      </span>
                    </div>
                    <div>
                      <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>KRW: </span>
                      <span style={{ fontSize: "20px", fontWeight: "700", color: currentBalance >= 0 ? "var(--primary)" : "var(--danger)" }}>
                        {formatKRW(currentBalance)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            }
            if (adjustingAccount.type === "card") {
              const currentDebt = cardDebtMap.get(account.id)?.total ?? 0;
              const debtDisplay = currentDebt < 0 ? Math.abs(currentDebt) : 0;
              return (
                <div style={{ marginBottom: "20px", padding: "12px", background: "var(--bg)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>현재 카드 부채</div>
                  <div style={{ fontSize: "24px", fontWeight: "700", color: debtDisplay > 0 ? "var(--danger)" : "var(--primary)" }}>
                    {formatAmount(debtDisplay)}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "6px" }}>
                    카드 사용/결제 내역이 자동 반영됩니다. 결제하면 부채가 탕감됩니다.
                  </div>
                </div>
              );
            }
            return (
              <div style={{ marginBottom: "20px", padding: "12px", background: "var(--bg)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>현재 계좌 잔액</div>
                <div style={{ fontSize: "24px", fontWeight: "700", color: currentBalance >= 0 ? "var(--primary)" : "var(--danger)" }}>
                  {formatAmount(currentBalance)}
                </div>
              </div>
            );
          })()}

          {(adjustingAccount.type === "securities" || adjustingAccount.type === "crypto") ? (
            <>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={isSetDirectly}
                  onChange={(e) => setIsSetDirectly(e.target.checked)}
                />
                <span style={{ fontSize: 13 }}>
                  직접 목표 잔액 설정 (체크 시 입력값이 현재 잔액이 됨)
                </span>
              </label>
              <label style={{ marginBottom: "16px" }}>
                <span style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px", display: "block" }}>
                  {isSetDirectly ? "USD 잔액" : "USD 증감 (음수 입력 시 차감)"}
                </span>
                <input
                  type="text"
                  value={editUsdBalance}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^\d.-]/g, "");
                    setEditUsdBalance(val);
                  }}
                  placeholder={isSetDirectly ? "USD 잔액 (예: 1000.50)" : "USD 증감 (예: 100 또는 -50)"}
                  autoFocus
                  style={{ width: "100%", padding: "10px", fontSize: "16px" }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      onAdjustBalance();
                    } else if (e.key === "Escape") {
                      onClose();
                    }
                  }}
                />
                {editUsdBalance && fxRate && (
                  <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "8px" }}>
                    원화 환산 약 {formatNumber(parseAmount(editUsdBalance, { allowDecimal: true }) * fxRate)}원
                  </div>
                )}
              </label>

              <label style={{ marginBottom: "16px" }}>
                <span style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px", display: "block" }}>
                  {isSetDirectly ? "원화 잔액 (KRW)" : "원화 증감 (KRW, 음수 입력 시 차감)"}
                </span>
                <input
                  type="text"
                  value={editKrwBalance}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^\d.-]/g, "");
                    setEditKrwBalance(val);
                  }}
                  placeholder={isSetDirectly ? "KRW 잔액 (예: 1000000)" : "KRW 증감 (예: 100000 또는 -50000)"}
                  style={{ width: "100%", padding: "10px", fontSize: "16px" }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      onAdjustBalance();
                    } else if (e.key === "Escape") {
                      onClose();
                    }
                  }}
                />
              </label>

              {fxRate && (
                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px", padding: "8px", background: "var(--bg)", borderRadius: "4px" }}>
                  FX rate: {formatNumber(fxRate)} KRW/USD
                </div>
              )}
            </>
          ) : adjustingAccount.type === "card" ? null : (
            <>
              <div style={{ marginBottom: "20px", padding: "12px", background: "var(--bg)", borderRadius: "8px" }}>
                <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>
                  현재 보유금액 조정값
                </div>
                <div style={{ fontSize: "20px", fontWeight: "700", color: currentAdjustment >= 0 ? "var(--primary)" : "var(--danger)" }}>
                  {currentAdjustment >= 0 ? "+" : ""}{formatNumber(currentAdjustment)}
                </div>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={isSetDirectly}
                  onChange={(e) => setIsSetDirectly(e.target.checked)}
                />
                <span style={{ fontSize: 13 }}>
                  직접 목표 잔액 설정 (입력값이 현재 잔액이 됨)
                </span>
              </label>
              <label>
                <span>
                  {isSetDirectly
                    ? "목표 잔액"
                    : "잔액 증감 (음수 입력 시 차감)"}
                </span>

                <input
                  type="text"
                  value={adjustValue}
                  onChange={(e) => {
                    const val = sanitizeSignedNumericInput(e.target.value);
                    setAdjustValue(val);
                  }}
                  placeholder={
                    isSetDirectly
                      ? "금액 (예: 100000)"
                      : "금액 입력 (예: +100000 또는 -50000)"
                  }
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      onAdjustBalance();
                      setAdjustValue("");
                    } else if (e.key === "Escape") {
                      onClose();
                    }
                  }}
                />
              </label>
            </>
          )}
          <div className="form-actions" style={{ marginTop: "16px" }}>
            <button type="button" onClick={onClose}>
              취소
            </button>
            {adjustingAccount.type !== "card" && (
              <button
                type="button"
                className="primary"
                onClick={onAdjustBalance}
              >
                {isSetDirectly ? "설정" : "적용"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
