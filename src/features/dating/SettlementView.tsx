import React, { useMemo, useState } from "react";
import type { Account, AppData, LedgerEntry } from "../../types";
import { Section } from "../insights/insightsShared";
import { useDateAccountId } from "../../hooks/useDateAccountSettings";
import { getTodayKST, getMonthEndDate, shiftMonth } from "../../utils/date";
import { newIdWithPrefix } from "../../utils/id";

interface Props {
  data: AppData;
  onSettle: (entry: LedgerEntry) => void;
  formatNumber: (n: number) => string;
}

const SETTLE_LAST_KEY = "fw-date-account-last-settle-at";
const SETTLED_IDS_KEY = "fw-date-account-settled-ids";

export const SettlementView: React.FC<Props> = ({ data, onSettle, formatNumber }) => {
  const dateAccountId = useDateAccountId() ?? "";
  // 마지막 정산일을 state로 보관 — 정산 후 배너가 즉시 갱신되도록
  const [lastSettleAt, setLastSettleAt] = useState<string>(() =>
    typeof window !== "undefined" ? localStorage.getItem(SETTLE_LAST_KEY) ?? "" : ""
  );
  // 이미 정산한 지출 항목 id 집합 — 날짜 경계 대신 id로 이중청구를 막아
  // '정산 당일 지출 누락'(date>sinceDate + sinceDate=today 조합)과 '시작일 과거 변경 이중청구'를 동시에 해결.
  const [settledIds, setSettledIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = localStorage.getItem(SETTLED_IDS_KEY);
      const arr = raw ? (JSON.parse(raw) as unknown) : [];
      return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
    } catch {
      return new Set();
    }
  });
  const [settling, setSettling] = useState(false);

  const dateAccount: Account | undefined = data.accounts.find((a) => a.id === dateAccountId);

  // 50/50 고정 (데이트 비용은 항상 절반 부담)
  const ratio = 50;
  const [sinceDate, setSinceDate] = useState(lastSettleAt || (() => {
    // 기본값: KST 기준 1개월 전 (setMonth 월말 오버플로 없이 — 일자는 전월 말일로 클램프)
    const today = getTodayKST();
    const prevMonth = shiftMonth(today.slice(0, 7), -1);
    const lastDay = Number(getMonthEndDate(prevMonth).slice(8, 10));
    const day = Math.min(Number(today.slice(8, 10)), lastDay);
    return `${prevMonth}-${String(day).padStart(2, "0")}`;
  })());

  const settlement = useMemo(() => {
    if (!dateAccount) return null;
    // sinceDate는 '얼마나 거슬러 볼지' 표시 범위(포함, >=)일 뿐 — 이중청구 방지는 settledIds(id 기준)가 담당.
    // 따라서 정산 당일에 추가된 지출도 누락되지 않고(아직 settledIds에 없음), 이미 정산한 건은 날짜와 무관하게 제외된다.
    const items = data.ledger
      .filter(
        (l) =>
          l.kind === "expense" &&
          l.fromAccountId === dateAccount.id &&
          l.date >= sinceDate &&
          !settledIds.has(l.id)
      )
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const total = items.reduce((s, l) => s + l.amount, 0);
    const myShare = total * (ratio / 100);
    const partnerShare = total - myShare;
    return { items, total, myShare, partnerShare };
  }, [data.ledger, dateAccount, sinceDate, ratio, settledIds]);

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
        <div style={{ padding: "40px 24px", textAlign: "center", background: "var(--bg)", borderRadius: 12, color: "var(--text-muted)" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🤝</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: "var(--text)" }}>데이트 계좌가 설정되어 있지 않습니다</div>
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            <strong>백업/설정 탭</strong>에서 데이트 통장 계좌를 지정해주세요.<br />
            <span style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 8, display: "inline-block" }}>
              설정 항목: <code>DATE_ACCOUNT_ID</code> (데이트 계좌 ID) · 분담 비율은 <strong>50:50 고정</strong>입니다
            </span>
          </div>
        </div>
      </div>
    );
  }

  const handleSettle = () => {
    if (settling) return; // 더블클릭/연타 가드
    if (!settlement || settlement.partnerShare <= 0) return;
    const today = getTodayKST();
    const amount = Math.round(settlement.partnerShare); // 0.5원 단위 방지 — 정수 금액으로 저장
    const count = settlement.items.length;
    // 정산 입금은 되돌리기 어려운 기록 추가 → 확인. 정산한 항목은 id로 기록돼 다시 청구되지 않음.
    const ok = window.confirm(
      `상대 부담분 ${amount.toLocaleString()}원을 '${dateAccount.name}'에 정산 입금으로 기록합니다.\n` +
        `정산한 ${count}건은 다시 청구되지 않습니다 (이중 정산 방지).\n계속할까요?`
    );
    if (!ok) return;
    setSettling(true);
    // kind=income + toAccountId — computeMoimAccountFlow(dateAccounting)가 "상대 입금"으로
    // 인식하는 형태. subCategory "데이트통장"은 실질 수입 계산(realIncome)에서 정산성
    // 회수로 자동 차감되므로 수입 이중계상이 없다.
    const entry: LedgerEntry = {
      id: newIdWithPrefix("settle"),
      date: today,
      kind: "income",
      category: "정산",
      subCategory: "데이트통장",
      description: `${sinceDate} 이후 정산 (상대 부담분 입금)`,
      amount,
      toAccountId: dateAccount.id,
      note: `합계 ${settlement.total.toLocaleString()}원 / 본인비율 ${ratio}%`
    };
    onSettle(entry);
    // 이번에 정산한 지출 id를 기록 → 날짜 무관 재청구 방지. ledger에 존재하는 id만 유지(무한 증식 방지).
    const settledNow = settlement.items.map((l) => l.id);
    setSettledIds((prev) => {
      const liveIds = new Set(data.ledger.map((l) => l.id));
      const merged = [...prev, ...settledNow].filter((id) => liveIds.has(id));
      const next = new Set(merged);
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(SETTLED_IDS_KEY, JSON.stringify([...next]));
        } catch {
          /* quota 무시 */
        }
      }
      return next;
    });
    if (typeof window !== "undefined") localStorage.setItem(SETTLE_LAST_KEY, today);
    setLastSettleAt(today);
    setSettling(false);
  };

  return (
    <div>
      <div style={{ padding: "10px 14px", background: "var(--bg)", borderRadius: 8, marginBottom: 16, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
        ℹ️ 데이트 계좌: <strong>{dateAccount.name}</strong> · 분담: <strong>50:50 (나누기 2)</strong> · 단위: <strong>원</strong> · 정산 시작일(<strong>{sinceDate}</strong>) 이후 해당 계좌 expense 기준
        {lastSettleAt && <> · 마지막 정산: <strong>{lastSettleAt}</strong></>}
      </div>

      <Section storageKey="settle-section-overview" title="💰 현재 정산 대상">
        {settlement && (
          <div style={{ gridColumn: "span 4" }}>
            <div style={{ marginBottom: 16, padding: "12px 14px", background: "var(--accent-light)", borderRadius: 10, border: "1px solid var(--border)" }}>
              <label style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>정산 시작일</label>
              <input
                type="date" value={sinceDate} onChange={(e) => setSinceDate(e.target.value)}
                style={{ marginLeft: 10, padding: "6px 8px", fontSize: 13, borderRadius: 6, border: "1px solid var(--border)" }}
              />
              <span style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: 10 }}>이 날짜 이후 지출이 정산 대상</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
              <div style={{ padding: "16px 18px", background: "var(--bg)", borderRadius: 10, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>총 지출 ({settlement.items.length}건)</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "var(--text)", marginTop: 4 }}>{formatNumber(settlement.total)}</div>
              </div>
              <div style={{ padding: "16px 18px", background: "var(--accent-light)", borderRadius: 10, border: "1px solid var(--border)", textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>내 부담 ({ratio}%)</div>
                {/* 내가 내는 돈(지출성) → 파랑 */}
                <div style={{ fontSize: 28, fontWeight: 800, color: "var(--accent)", marginTop: 4 }}>{formatNumber(Math.round(settlement.myShare))}</div>
              </div>
              <div style={{ padding: "16px 18px", background: "var(--danger-light)", borderRadius: 10, border: "1px solid var(--danger)", textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>상대 부담 ({100 - ratio}%) — 받을 돈</div>
                {/* 받을 돈(수입성) → 국내 관례 빨강 */}
                <div style={{ fontSize: 28, fontWeight: 800, color: "var(--danger)", marginTop: 4 }}>{formatNumber(Math.round(settlement.partnerShare))}</div>
              </div>
            </div>

            <button
              type="button" onClick={handleSettle}
              disabled={settling || !settlement || settlement.partnerShare <= 0}
              style={{
                width: "100%", padding: "14px 18px",
                background: settlement.partnerShare > 0 ? "var(--text)" : "var(--border)",
                color: settlement.partnerShare > 0 ? "var(--bg)" : "var(--text-muted)", border: "none", borderRadius: 10,
                fontSize: 15, fontWeight: 700,
                cursor: settlement.partnerShare > 0 ? "pointer" : "not-allowed",
              }}
            >
              💸 상대 부담분 {formatNumber(Math.round(settlement.partnerShare))} 정산 입금 기록
            </button>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6, textAlign: "center" }}>
              클릭 시 가계부에 "수입 / 정산 / 데이트통장" 항목(실질 수입에서는 자동 제외)으로 추가되고 마지막 정산일이 갱신됩니다
            </div>
          </div>
        )}
      </Section>

      {settlement && settlement.items.length > 0 && (
        <Section storageKey="settle-section-items" title={`📋 정산 대상 내역 (${settlement.items.length}건)`} defaultOpen={false}>
          <div style={{ gridColumn: "span 4" }}>
            <div style={{ maxHeight: 360, overflow: "auto", background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border-light)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "var(--surface-hover)", borderBottom: "2px solid var(--border)" }}>
                    <th style={{ padding: "8px 12px", textAlign: "left", color: "var(--text-muted)" }}>날짜</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", color: "var(--text-muted)" }}>내용</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", color: "var(--text-muted)" }}>카테고리</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", color: "var(--text-muted)" }}>금액</th>
                  </tr>
                </thead>
                <tbody>
                  {settlement.items.map((l) => (
                    <tr key={l.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
                      <td style={{ padding: "8px 12px", color: "var(--text-muted)" }}>{l.date}</td>
                      <td style={{ padding: "8px 12px", fontWeight: 500 }}>{l.description || "-"}</td>
                      <td style={{ padding: "8px 12px", color: "var(--text-muted)" }}>
                        {l.subCategory || l.category || "-"}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: "var(--chart-expense)" }}>
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
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>
              과거 정산 기록이 없습니다. 위에서 첫 정산을 실행하면 여기에 누적됩니다.
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 12 }}>
                <div style={{ padding: "10px 14px", background: "var(--bg)", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>정산 횟수</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{settleHistory.length}회</div>
                </div>
                <div style={{ padding: "10px 14px", background: "var(--bg)", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>누적 정산 금액</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "var(--danger)" }}>{formatNumber(settleTotal)}</div>
                </div>
                <div style={{ padding: "10px 14px", background: "var(--bg)", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>평균 정산 금액</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{formatNumber(Math.round(settleAvg))}</div>
                </div>
              </div>
              <div style={{ background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border-light)", overflow: "hidden" }}>
                {settleHistory.map((l) => (
                  <div key={l.id} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-light)", display: "flex", alignItems: "center", gap: 12, fontSize: 12 }}>
                    <span style={{ color: "var(--text-muted)", fontWeight: 600, minWidth: 90 }}>{l.date}</span>
                    <span style={{ flex: 1, color: "var(--text-secondary)" }}>{l.description || "-"}</span>
                    <span style={{ fontWeight: 700, color: "var(--danger)" }}>+{formatNumber(l.amount)}</span>
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
