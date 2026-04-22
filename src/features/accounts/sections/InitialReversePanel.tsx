import type { Account, AccountBalanceRow, LedgerEntry } from "../../../types";

interface Props {
  orderedRowsForInitialReverse: AccountBalanceRow[];
  safeAccounts: Account[];
  onChangeLedger?: (next: LedgerEntry[]) => void;
  showSeedPanel: boolean;
  setShowSeedPanel: (fn: (v: boolean) => boolean) => void;
  seedSourceId: string;
  setSeedSourceId: (v: string) => void;
  seedDate: string;
  setSeedDate: (v: string) => void;
  actualCurrentInput: Record<string, string>;
  setActualCurrentInput: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  setActualCurrentEdited: (updater: (prev: Set<string>) => Set<string>) => void;
  flattenAllCashAdjustments: () => void;
  consolidate20250601Transfers: () => void;
  applySeedTransferConversion: () => void;
  fillActualCurrentFromComputed: () => void;
  applyReversedInitial: () => void;
  reversedInitialBalance: (accountId: string) => number | null;
  getBaseBalance: (account: Account) => number;
  formatKRW: (n: number) => string;
}

export function InitialReversePanel({
  orderedRowsForInitialReverse,
  safeAccounts,
  onChangeLedger,
  showSeedPanel,
  setShowSeedPanel,
  seedSourceId,
  setSeedSourceId,
  seedDate,
  setSeedDate,
  actualCurrentInput,
  setActualCurrentInput,
  setActualCurrentEdited,
  flattenAllCashAdjustments,
  consolidate20250601Transfers,
  applySeedTransferConversion,
  fillActualCurrentFromComputed,
  applyReversedInitial,
  reversedInitialBalance,
  getBaseBalance,
  formatKRW,
}: Props) {
  if (orderedRowsForInitialReverse.length === 0) return null;

  return (
    <div className="card" style={{ marginTop: 24, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 12, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>계좌 초기 금액 역산</h3>
        <button
          type="button"
          className="secondary"
          onClick={flattenAllCashAdjustments}
          title="모든 계좌의 보정금액을 시작금액에 병합해 깔끔한 상태로 만듭니다 (현재 잔액 불변)"
          style={{ fontSize: 12, padding: "6px 12px" }}
        >
          모든 계좌 시작금액 정리
        </button>
        {onChangeLedger && (
          <button
            type="button"
            className="secondary"
            onClick={() => setShowSeedPanel((v) => !v)}
            title="모든 계좌의 시작금액을 출금 계좌와의 이체 기록으로 변환합니다 (현재 잔액 불변)"
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            시작금액 → 이체 기록 변환
          </button>
        )}
        {onChangeLedger && (
          <button
            type="button"
            className="secondary"
            onClick={consolidate20250601Transfers}
            title="백업 복구 + 2026-06-01 자동생성 이동 + 계좌쌍별 net 합산 → 2025-06-01 이체 기록을 깔끔하게 통합 (현재 잔액 보존)"
            style={{ fontSize: 12, padding: "6px 12px", borderColor: "var(--primary)", color: "var(--primary)", fontWeight: 600 }}
          >
            🔗 2025-06-01 이력 통합
          </button>
        )}
      </div>
      {showSeedPanel && onChangeLedger && (
        <div style={{
          marginBottom: 16,
          padding: 12,
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg)",
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "flex-end"
        }}>
          <label style={{ display: "flex", flexDirection: "column", fontSize: 12, color: "var(--text-muted)" }}>
            출금 계좌
            <select
              value={seedSourceId}
              onChange={(e) => setSeedSourceId(e.target.value)}
              style={{ padding: 6, borderRadius: 4, marginTop: 4, minWidth: 200 }}
            >
              <option value="">-- 선택 --</option>
              {safeAccounts
                .filter((a) => a.type === "checking")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.institution || "-"})
                  </option>
                ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", fontSize: 12, color: "var(--text-muted)" }}>
            기준 날짜
            <input
              type="date"
              value={seedDate}
              onChange={(e) => setSeedDate(e.target.value)}
              style={{ padding: 6, borderRadius: 4, marginTop: 4 }}
            />
          </label>
          <button
            type="button"
            className="primary"
            onClick={applySeedTransferConversion}
            style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600 }}
          >
            실행
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setShowSeedPanel(() => false)}
            style={{ padding: "8px 16px", fontSize: 13 }}
          >
            취소
          </button>
        </div>
      )}
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-muted)" }}>
        각 계좌의 <strong>현재 보유금액(역산)</strong>이 맞지 않을 때, 이체·거래 내역으로부터 역산한 계좌 초기 금액을 일괄 조정합니다.
      </p>
      <table className="data-table" style={{ fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>계좌명</th>
            <th style={{ textAlign: "right" }}>현재 보유금액(역산)</th>
            <th style={{ textAlign: "right" }}>계좌 초기 금액 역산</th>
          </tr>
        </thead>
        <tbody>
          {orderedRowsForInitialReverse.map((row) => {
            const rev = reversedInitialBalance(row.account.id);
            const currentBase = getBaseBalance(row.account);
            const unchanged = rev != null && Math.round(rev) === Math.round(currentBase);
            return (
              <tr key={row.account.id}>
                <td>
                  {row.account.name} ({row.account.institution || "-"})
                </td>
                <td style={{ textAlign: "right" }}>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={actualCurrentInput[row.account.id] ?? ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      setActualCurrentInput((prev) => ({
                        ...prev,
                        [row.account.id]: value
                      }));
                      setActualCurrentEdited((prev) => {
                        if (prev.has(row.account.id)) return prev;
                        const next = new Set(prev);
                        next.add(row.account.id);
                        return next;
                      });
                    }}
                    placeholder="비어있음"
                    style={{
                      width: 120,
                      padding: "6px 8px",
                      borderRadius: 4,
                      textAlign: "right"
                    }}
                  />
                </td>
                <td style={{ textAlign: "right", fontWeight: 600, color: unchanged ? "var(--text-muted)" : undefined }}>
                  {rev == null ? "-" : formatKRW(Math.round(rev))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="secondary"
          onClick={fillActualCurrentFromComputed}
          style={{ padding: "10px 20px", fontSize: 14, fontWeight: 600 }}
        >
          실제값으로 채우기
        </button>
        <button
          type="button"
          className="primary"
          onClick={applyReversedInitial}
          style={{ padding: "10px 20px", fontSize: 14, fontWeight: 600 }}
        >
          계좌 초기 금액 역산을 계좌에 적용
        </button>
      </div>
    </div>
  );
}
