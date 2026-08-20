/**
 * 연말정산 미리보기 — 세금 보고서 아래 읽기전용 카드.
 * 계산은 utils/yearEndTaxHelper(순수)에 위임하고, 여기서는 총급여 입력(localStorage,
 * STORAGE_KEYS.YEAR_END_GROSS_SALARY — 귀속연도별 JSON, 기기 로컬·백업 미포함)과 표시만 담당한다.
 * 세법 상수는 helper의 연도 태그 객체 — 면책 문구는 반드시 함께 표시.
 */
import React, { useCallback, useMemo, useState } from "react";
import type { Account, LedgerEntry } from "../../types";
import { STORAGE_KEYS } from "../../constants/config";
import { useFxRateValue } from "../../context/FxRateContext";
import { useAppStore } from "../../store/appStore";
import { CommitInput } from "../../components/ui/CommitInput";
import { formatKRW } from "../../utils/formatter";
import { parseAmount } from "../../utils/parseAmount";
import { buildYearEndTaxHelper, type YearEndTaxHelperResult } from "../../utils/yearEndTaxHelper";

interface Props {
  ledger: LedgerEntry[];
  accounts: Account[];
  year: number;
}

type GrossSalaryMap = Record<string, number>;

function readGrossSalaryMap(): GrossSalaryMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.YEAR_END_GROSS_SALARY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: GrossSalaryMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeGrossSalaryMap(map: GrossSalaryMap): void {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(map).length === 0) window.localStorage.removeItem(STORAGE_KEYS.YEAR_END_GROSS_SALARY);
    else window.localStorage.setItem(STORAGE_KEYS.YEAR_END_GROSS_SALARY, JSON.stringify(map));
  } catch {
    /* 저장 실패(쿼터 등)해도 세션 내 표시는 state로 유지 */
  }
}

const won = (v: number) => formatKRW(Math.round(v));

const Row: React.FC<{ label: string; value: React.ReactNode; strong?: boolean; muted?: boolean }> = ({ label, value, strong, muted }) => (
  <tr style={strong ? { borderTop: "1px solid var(--border)" } : undefined}>
    <td style={{ padding: "4px 6px", fontWeight: strong ? 700 : 400, color: muted ? "var(--text-muted)" : undefined }}>{label}</td>
    <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: strong ? 700 : 400, color: muted ? "var(--text-muted)" : undefined }}>{value}</td>
  </tr>
);

const SubCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ flex: "1 1 260px", minWidth: 0, padding: 12, border: "1px solid var(--border)", borderRadius: 8 }}>
    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{title}</div>
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <tbody>{children}</tbody>
    </table>
  </div>
);

function salaryNote(r: YearEndTaxHelperResult): string {
  if (r.grossSalarySource === "input") return "입력한 총급여 기준";
  if (r.grossSalarySource === "estimated") {
    return r.yearInProgress
      ? `급여 누계 ${won(r.salaryYtd)} ÷ ${r.salaryMonths}개월 × 12 연환산 (입력하면 대체)`
      : `급여 누계 ${won(r.salaryYtd)} (입력하면 대체)`;
  }
  return "급여 항목이 없어 총급여를 알 수 없습니다 — 아래에 입력하세요";
}

export const YearEndTaxPreviewSection: React.FC<Props> = React.memo(function YearEndTaxPreviewSection({ ledger, accounts, year }) {
  const fxRate = useFxRateValue();
  const categoryPresets = useAppStore((s) => s.data.categoryPresets);
  const [salaryMap, setSalaryMap] = useState<GrossSalaryMap>(() => readGrossSalaryMap());
  const yearKey = String(year);
  const inputSalary = salaryMap[yearKey];

  const commitSalary = useCallback(
    (raw: string) => {
      const n = parseAmount(raw);
      setSalaryMap((prev) => {
        const next = { ...prev };
        if (n > 0) next[yearKey] = n;
        else delete next[yearKey];
        writeGrossSalaryMap(next);
        return next;
      });
    },
    [yearKey]
  );

  const result = useMemo(
    () => buildYearEndTaxHelper(ledger, accounts, year, { grossSalary: inputSalary ?? null, categoryPresets, fxRate }),
    [ledger, accounts, year, inputSalary, categoryPresets, fxRate]
  );
  const { cardSpend: c, medical, donation, rent, rules } = result;
  const salaryKnown = result.grossSalary > 0;
  const pct = (rate: number) => `${Math.round(rate * 100)}%`;
  const creditTotal = medical.estimatedCredit + donation.estimatedCredit + rent.estimatedCredit;

  return (
    <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
      <h3 style={{ marginBottom: 4 }}>연말정산 미리보기 — {year}년 귀속 (개략)</h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>
        가계부 지출만으로 카드 소득공제·의료비·기부금·월세 공제를 개략 추정합니다. 전통시장·대중교통 추가공제,
        부양가족·한도 예외는 반영하지 않으며 실제 금액은 국세청 간소화 자료 기준입니다. 세법 상수 {rules.year}년 기준.
      </p>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <label htmlFor="year-end-gross-salary" style={{ fontSize: 13 }}>총급여(연, 세전):</label>
        <CommitInput
          id="year-end-gross-salary"
          inputMode="numeric"
          placeholder={result.grossSalarySource === "estimated" ? Math.round(result.grossSalary).toLocaleString("ko-KR") : "예: 50,000,000"}
          value={inputSalary ? inputSalary.toLocaleString("ko-KR") : ""}
          onCommit={commitSalary}
          style={{ width: 160, textAlign: "right" }}
          aria-describedby="year-end-gross-salary-note"
        />
        <span id="year-end-gross-salary-note" style={{ fontSize: 12, color: "var(--text-muted)" }}>{salaryNote(result)}</span>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <SubCard title={`카드 소득공제 (신용 ${pct(rules.card.creditRate)} / 체크·현금 ${pct(rules.card.checkCashRate)})`}>
          <Row label="신용카드 사용액" value={won(c.credit)} />
          <Row label="체크카드·현금(입출금 직접 출금)" value={won(c.checkOrCash)} />
          {c.other > 0 && <Row label="공제 외(계좌 미지정·저축/증권)" value={won(c.other)} muted />}
          <Row label={`총급여 ${pct(rules.card.thresholdRate)} 문턱`} value={salaryKnown ? won(c.threshold25) : "—"} />
          <Row label="문턱 초과 사용액" value={salaryKnown ? won(c.overThreshold) : "—"} />
          <Row
            label="추정 소득공제액"
            value={
              salaryKnown ? (
                <span style={{ color: c.capReached ? "var(--warning)" : "var(--success)" }}>
                  {won(c.estimatedDeduction)} / 한도 {won(c.deductionCap)}
                </span>
              ) : "—"
            }
            strong
          />
          {salaryKnown && <Row label="한도까지 남은 공제액" value={won(c.remainingCap)} muted />}
        </SubCard>

        <SubCard title="세액공제 항목">
          <Row label="의료비 합계" value={won(medical.total)} />
          <Row label={`의료비 ${pct(rules.medical.thresholdRate)} 문턱 초과 공제대상`} value={salaryKnown ? won(medical.deductible) : "—"} muted />
          <Row label={`의료비 세액공제 (${pct(rules.medical.creditRate)})`} value={salaryKnown ? won(medical.estimatedCredit) : "—"} />
          <Row label="기부금 합계" value={won(donation.total)} />
          <Row label={`기부금 세액공제 (${pct(rules.donation.rate)}/${pct(rules.donation.highRate)})`} value={won(donation.estimatedCredit)} />
          <Row label="월세 합계" value={won(rent.total)} />
          <Row
            label="월세 세액공제"
            value={rent.eligible ? won(rent.estimatedCredit) : "총급여 요건 초과"}
          />
          <Row label="세액공제 합계(추정)" value={won(creditTotal)} strong />
        </SubCard>
      </div>

      <div
        role="note"
        style={{
          marginTop: 12,
          padding: 10,
          borderRadius: 6,
          background: c.capReached ? "var(--warning-light)" : "var(--primary-light)",
          borderLeft: `4px solid ${c.capReached ? "var(--warning)" : "var(--primary)"}`,
          fontSize: 13
        }}
      >
        {c.advice}
      </div>
    </div>
  );
});
