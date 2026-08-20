/**
 * 절세계좌 납입 카드 (4-1) — 올해 ISA·연금저축·IRP 납입액, 남은 한도, 예상 세액공제(개략). 읽기전용.
 * 계산은 utils/taxShelter.buildShelterContributions(순수). 공제율(13.2/16.5%)만 localStorage(TAX_CREDIT_RATE)에 기억.
 */
import React, { useMemo, useState } from "react";
import type { Account, LedgerEntry } from "../../types";
import { STORAGE_KEYS } from "../../constants/config";
import { getTodayKST } from "../../utils/date";
import { formatKRW } from "../../utils/formatter";
import { buildShelterContributions, DEFAULT_TAX_CREDIT_RATE, TAX_SHELTER_RULES_2026 } from "../../utils/taxShelter";

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  fxRate: number | null;
}

const RATE_LOW = TAX_SHELTER_RULES_2026.creditRates.low;
const RATE_HIGH = TAX_SHELTER_RULES_2026.creditRates.high;

function readCreditRate(): number {
  if (typeof window === "undefined") return DEFAULT_TAX_CREDIT_RATE;
  try {
    const v = Number(localStorage.getItem(STORAGE_KEYS.TAX_CREDIT_RATE));
    return v === RATE_LOW || v === RATE_HIGH ? v : DEFAULT_TAX_CREDIT_RATE;
  } catch {
    return DEFAULT_TAX_CREDIT_RATE;
  }
}

function writeCreditRate(rate: number): void {
  try {
    if (rate === DEFAULT_TAX_CREDIT_RATE) localStorage.removeItem(STORAGE_KEYS.TAX_CREDIT_RATE);
    else localStorage.setItem(STORAGE_KEYS.TAX_CREDIT_RATE, String(rate));
  } catch { /* 저장 실패해도 이번 세션 표시는 state로 유지 */ }
}

export const ShelterContributionCard: React.FC<Props> = ({ accounts, ledger, fxRate }) => {
  const year = Number(getTodayKST().slice(0, 4));
  const [creditRate, setCreditRate] = useState<number>(() => readCreditRate());
  const r = useMemo(
    () => buildShelterContributions(ledger, accounts, year, fxRate, { creditRate }),
    [ledger, accounts, year, fxRate, creditRate]
  );

  if (!r.hasShelterAccounts) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">절세계좌 납입 ({year}년)</div>
        <div className="hint" style={{ fontSize: 13, marginTop: 6 }}>
          계좌 탭에서 ISA·연금저축·IRP 계좌에 <strong>세제 성격</strong>을 지정하면 올해 납입액·남은 한도·예상 세액공제가 여기 표시되고,
          그 계좌로 받은 배당·이자는 종합과세 합산에서 빠집니다.
        </div>
      </div>
    );
  }

  const isaPct = r.isa.annualLimit > 0 ? Math.min(1, r.isa.paid / r.isa.annualLimit) : 0;
  const penPct = r.pension.annualLimit > 0 ? Math.min(1, r.pension.paidTotal / r.pension.annualLimit) : 0;
  const credPct = TAX_SHELTER_RULES_2026.pensionAccount.combinedCreditCap > 0
    ? Math.min(1, r.pension.creditable / TAX_SHELTER_RULES_2026.pensionAccount.combinedCreditCap)
    : 0;
  const excludedTotal = r.excluded.exchange + r.excluded.internal + r.excluded.reinvest;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div className="card-title">절세계좌 납입 ({year}년)</div>
        <div className="hint" style={{ fontSize: 12 }}>{TAX_SHELTER_RULES_2026.baseYear}년 기준 개략 — 실제 한도·공제는 소득·가입조건에 따라 다름</div>
      </div>

      {r.isa.accountCount > 0 && (
        <Row
          label={`ISA 납입 (${r.isa.accountCount}계좌)`}
          value={`${formatKRW(Math.round(r.isa.paid))} / ${formatKRW(r.isa.annualLimit)}`}
          sub={r.isa.limitLeft > 0 ? `올해 ${formatKRW(Math.round(r.isa.limitLeft))} 더 넣을 수 있음` : "올해 연 한도 소진"}
          pct={isaPct}
        />
      )}

      {r.pension.accountCount > 0 && (
        <>
          <Row
            label={`연금계좌 납입 (연금저축+IRP ${r.pension.accountCount}계좌)`}
            value={`${formatKRW(Math.round(r.pension.paidTotal))} / ${formatKRW(r.pension.annualLimit)}`}
            sub={
              `연금저축 ${formatKRW(Math.round(r.pension.paidPension))} · IRP ${formatKRW(Math.round(r.pension.paidIrp))}` +
              (r.pension.limitLeft > 0 ? ` · 한도까지 ${formatKRW(Math.round(r.pension.limitLeft))}` : " · 연 납입한도 소진")
            }
            pct={penPct}
          />
          <Row
            label="세액공제 대상 납입"
            value={`${formatKRW(Math.round(r.pension.creditable))} / ${formatKRW(TAX_SHELTER_RULES_2026.pensionAccount.combinedCreditCap)}`}
            sub={
              r.pension.creditableLeft > 0
                ? `공제 한도까지 ${formatKRW(Math.round(r.pension.creditableLeft))} 더 넣으면 약 ${formatKRW(Math.round(r.pension.creditableLeft * creditRate))} 추가 공제`
                : "세액공제 한도(연금저축 600만·합산 900만) 채움"
            }
            pct={credPct}
          />
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            <div>
              <div className="hint" style={{ fontSize: 12, marginBottom: 2 }}>예상 세액공제</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "var(--success)" }}>{formatKRW(Math.round(r.pension.estCredit))}</div>
            </div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
              공제율
              <select
                aria-label="연금계좌 세액공제율"
                value={String(creditRate)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setCreditRate(v);
                  writeCreditRate(v);
                }}
                style={{ fontSize: 12 }}
              >
                <option value={String(RATE_HIGH)}>13.2% (총급여 5,500만 초과)</option>
                <option value={String(RATE_LOW)}>16.5% (총급여 5,500만 이하)</option>
              </select>
            </label>
          </div>
        </>
      )}

      {excludedTotal > 0 && (
        <div className="hint" style={{ fontSize: 12, marginTop: 8 }}>
          납입에서 제외 {excludedTotal}건 — 환전 {r.excluded.exchange} · 절세계좌 간 이체 {r.excluded.internal} · 배당/이자 재투자 {r.excluded.reinvest}
        </div>
      )}
    </div>
  );
};

const Row: React.FC<{ label: string; value: string; sub: string; pct: number }> = ({ label, value, sub, pct }) => (
  <div style={{ marginTop: 10 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 13 }}>{value}</span>
    </div>
    <div style={{ height: 8, borderRadius: 5, background: "var(--border)", overflow: "hidden", margin: "4px 0" }}>
      <div style={{ width: `${pct * 100}%`, height: "100%", background: pct >= 1 ? "var(--success)" : "var(--accent)" }} />
    </div>
    <div className="hint" style={{ fontSize: 12 }}>{sub}</div>
  </div>
);
