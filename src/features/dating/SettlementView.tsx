import React, { useMemo, useState } from "react";
import type { Account, AppData, LedgerEntry } from "../../types";
import { STORAGE_KEYS } from "../../constants/config";
import { Section } from "../insights/insightsShared";

interface Props {
  data: AppData;
  onSettle: (entry: LedgerEntry) => void;
  formatNumber: (n: number) => string;
}

const SETTLE_LAST_KEY = "fw-date-account-last-settle-at";

export const SettlementView: React.FC<Props> = ({ data, onSettle, formatNumber }) => {
  const dateAccountId = typeof window !== "undefined"
    ? localStorage.getItem(STORAGE_KEYS.DATE_ACCOUNT_ID) ?? ""
    : "";
  const lastSettleAt = typeof window !== "undefined"
    ? localStorage.getItem(SETTLE_LAST_KEY) ?? ""
    : "";

  const dateAccount: Account | undefined = data.accounts.find((a) => a.id === dateAccountId);

  // 50/50 고정 (데이트 비용은 항상 절반 부담)
  const ratio = 50;
  const [sinceDate, setSinceDate] = useState(lastSettleAt || (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  })());

  const settlement = useMemo(() => {
    if (!dateAccount) return null;
    const items = data.ledger
      .filter((l) => l.kind === "expense" && l.fromAccountId === dateAccount.id && l.date >= sinceDate)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const total = items.reduce((s, l) => s + l.amount, 0);
    const myShare = total * (ratio / 100);
    const partnerShare = total - myShare;
    return { items, total, myShare, partnerShare };
  }, [data.ledger, dateAccount, sinceDate, ratio]);

  // 정산 히스토리 (과거 정산 기록)
  const settleHistory = useMemo(() => {
    return data.ledger
      .filter((l) => l.category === "정산" && (l.subCategory || "").includes("데이트"))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, 10);
  }, [data.ledger]);

  const settleTotal = settleHistory.reduce((s, l) => s + l.amount, 0);
  const settleAvg = settleHistory.length > 0 ? settleTotal / settleHistory.length : 0;

  if (!dateAccount) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ padding: "40px 24px", textAlign: "center", background: "#f8f9fa", borderRadius: 12, color: "#666" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🤝</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: "#1a1a2e" }}>데이트 계좌가 설정되어 있지 않습니다</div>
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            <strong>백업/설정 탭</strong>에서 데이트 통장 계좌와 본인 부담 비율을 지정해주세요.<br />
            <span style={{ fontSize: 11, color: "#999", marginTop: 8, display: "inline-block" }}>
              설정 항목: <code>DATE_ACCOUNT_ID</code> (데이트 계좌 ID) · <code>DATE_ACCOUNT_RATIO</code> (본인 부담 % 0~100)
            </span>
          </div>
        </div>
      </div>
    );
  }

  const handleSettle = () => {
    if (!settlement || settlement.partnerShare <= 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const entry: LedgerEntry = {
      id: `settle-${Date.now()}`,
      date: today,
      kind: "transfer",
      category: "정산",
      subCategory: "데이트통장",
      description: `${sinceDate} 이후 정산 (상대 부담분 입금)`,
      amount: settlement.partnerShare,
      toAccountId: dateAccount.id,
      note: `합계 ${settlement.total.toLocaleString()}원 / 본인비율 ${ratio}%`
    };
    onSettle(entry);
    if (typeof window !== "undefined") localStorage.setItem(SETTLE_LAST_KEY, today);
  };

  return (
    <div>
      <div style={{ padding: "10px 14px", background: "#f8f9fa", borderRadius: 8, marginBottom: 16, fontSize: 12, color: "#666", lineHeight: 1.6 }}>
        ℹ️ 데이트 계좌: <strong>{dateAccount.name}</strong> · 분담: <strong>50:50 (나누기 2)</strong> · 단위: <strong>원</strong> · 정산 시작일(<strong>{sinceDate}</strong>) 이후 해당 계좌 expense 기준
        {lastSettleAt && <> · 마지막 정산: <strong>{lastSettleAt}</strong></>}
      </div>

      <Section storageKey="settle-section-overview" title="💰 현재 정산 대상">
        {settlement && (
          <div style={{ gridColumn: "span 4" }}>
            <div style={{ marginBottom: 16, padding: "12px 14px", background: "#f0f8ff", borderRadius: 10, border: "1px solid #bde" }}>
              <label style={{ fontSize: 12, color: "#666", fontWeight: 600 }}>정산 시작일</label>
              <input
                type="date" value={sinceDate} onChange={(e) => setSinceDate(e.target.value)}
                style={{ marginLeft: 10, padding: "6px 8px", fontSize: 13, borderRadius: 6, border: "1px solid #ccc" }}
              />
              <span style={{ fontSize: 11, color: "#999", marginLeft: 10 }}>이 날짜 이후 지출이 정산 대상</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
              <div style={{ padding: "16px 18px", background: "#f8f9fa", borderRadius: 10, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "#666", fontWeight: 600 }}>총 지출 ({settlement.items.length}건)</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#1a1a2e", marginTop: 4 }}>{formatNumber(settlement.total)}</div>
              </div>
              <div style={{ padding: "16px 18px", background: "#f0f8ff", borderRadius: 10, border: "1px solid #bde", textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "#666", fontWeight: 600 }}>내 부담 ({ratio}%)</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#0f3460", marginTop: 4 }}>{formatNumber(Math.round(settlement.myShare))}</div>
              </div>
              <div style={{ padding: "16px 18px", background: "#d4edda", borderRadius: 10, border: "1px solid #86efac", textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "#666", fontWeight: 600 }}>상대 부담 ({100 - ratio}%) — 받을 돈</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#059669", marginTop: 4 }}>{formatNumber(Math.round(settlement.partnerShare))}</div>
              </div>
            </div>

            <button
              type="button" onClick={handleSettle}
              disabled={!settlement || settlement.partnerShare <= 0}
              style={{
                width: "100%", padding: "14px 18px",
                background: settlement.partnerShare > 0 ? "#1a1a2e" : "#ccc",
                color: "#fff", border: "none", borderRadius: 10,
                fontSize: 15, fontWeight: 700,
                cursor: settlement.partnerShare > 0 ? "pointer" : "not-allowed",
              }}
            >
              💸 상대 부담분 {formatNumber(Math.round(settlement.partnerShare))} 정산 입금 기록
            </button>
            <div style={{ fontSize: 11, color: "#999", marginTop: 6, textAlign: "center" }}>
              클릭 시 가계부에 "이체 / 정산 / 데이트통장" 항목으로 자동 추가되고 마지막 정산일이 갱신됩니다
            </div>
          </div>
        )}
      </Section>

      {settlement && settlement.items.length > 0 && (
        <Section storageKey="settle-section-items" title={`📋 정산 대상 내역 (${settlement.items.length}건)`} defaultOpen={false}>
          <div style={{ gridColumn: "span 4" }}>
            <div style={{ maxHeight: 360, overflow: "auto", background: "#fff", borderRadius: 10, border: "1px solid #eee" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f8f9fa", borderBottom: "2px solid #e0e0e0" }}>
                    <th style={{ padding: "8px 12px", textAlign: "left", color: "#666" }}>날짜</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", color: "#666" }}>내용</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", color: "#666" }}>카테고리</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", color: "#666" }}>금액</th>
                  </tr>
                </thead>
                <tbody>
                  {settlement.items.map((l) => (
                    <tr key={l.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                      <td style={{ padding: "8px 12px", color: "#666" }}>{l.date}</td>
                      <td style={{ padding: "8px 12px", fontWeight: 500 }}>{l.description || "-"}</td>
                      <td style={{ padding: "8px 12px", color: "#888" }}>
                        {l.subCategory || l.category || "-"}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: "#e94560" }}>
                        {formatNumber(l.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Section>
      )}

      <Section storageKey="settle-section-history" title="🗂️ 정산 히스토리">
        <div style={{ gridColumn: "span 4" }}>
          {settleHistory.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "#999", fontSize: 13 }}>
              과거 정산 기록이 없습니다. 위에서 첫 정산을 실행하면 여기에 누적됩니다.
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 12 }}>
                <div style={{ padding: "10px 14px", background: "#f8f9fa", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "#666" }}>정산 횟수</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{settleHistory.length}회</div>
                </div>
                <div style={{ padding: "10px 14px", background: "#f8f9fa", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "#666" }}>누적 정산 금액</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#059669" }}>{formatNumber(settleTotal)}</div>
                </div>
                <div style={{ padding: "10px 14px", background: "#f8f9fa", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "#666" }}>평균 정산 금액</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{formatNumber(Math.round(settleAvg))}</div>
                </div>
              </div>
              <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #eee", overflow: "hidden" }}>
                {settleHistory.map((l) => (
                  <div key={l.id} style={{ padding: "10px 14px", borderBottom: "1px solid #f5f5f5", display: "flex", alignItems: "center", gap: 12, fontSize: 12 }}>
                    <span style={{ color: "#666", fontWeight: 600, minWidth: 90 }}>{l.date}</span>
                    <span style={{ flex: 1, color: "#444" }}>{l.description || "-"}</span>
                    <span style={{ fontWeight: 700, color: "#059669" }}>+{formatNumber(l.amount)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </Section>
    </div>
  );
};
