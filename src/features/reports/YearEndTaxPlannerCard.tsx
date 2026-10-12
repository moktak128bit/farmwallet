import React, { useMemo } from "react";
import type { Account, LedgerEntry } from "../../types";
import { CommitInput } from "../../components/ui/CommitInput";
import { Money } from "../../components/ui/Money";
import { formatKRW } from "../../utils/formatter";
import { parseAmount } from "../../utils/parseAmount";
import { getTodayKST } from "../../utils/date";
import { buildYearEndTaxPlanner, type YearEndTaxPlannerSettings } from "../../utils/yearEndTaxPlanner";
import type { YearEndTaxHelperResult } from "../../utils/yearEndTaxHelper";

interface Props {
  ledger: LedgerEntry[];
  accounts: Account[];
  preview: YearEndTaxHelperResult;
  fxRate: number | null;
  settings: YearEndTaxPlannerSettings;
  onChange: (key: keyof YearEndTaxPlannerSettings, value: number | undefined) => void;
}

const won = (n: number) => formatKRW(Math.round(n));
const panel: React.CSSProperties = {
  padding: 14,
  border: "1px solid var(--border)",
  borderRadius: 8,
  minWidth: 0,
  flex: "1 1 300px",
};
const note: React.CSSProperties = { fontSize: 12, color: "var(--text-muted)", margin: "8px 0", lineHeight: 1.6 };

function AmountField({
  label,
  value,
  fallback,
  onCommit,
}: {
  label: string;
  value?: number;
  fallback?: number;
  onCommit: (value: number | undefined) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
        fontSize: 13,
        marginTop: 8,
      }}
    >
      <span>{label}</span>
      <CommitInput
        aria-label={label}
        inputMode="numeric"
        value={value == null ? "" : value.toLocaleString("ko-KR")}
        placeholder={fallback == null ? "미입력: 한도까지" : Math.round(fallback).toLocaleString("ko-KR")}
        onCommit={(raw) => onCommit(raw.trim() === "" ? undefined : parseAmount(raw))}
        style={{ width: 150, maxWidth: "100%", textAlign: "right" }}
      />
    </label>
  );
}

export const YearEndTaxPlannerCard: React.FC<Props> = ({ ledger, accounts, preview, fxRate, settings, onChange }) => {
  const today = getTodayKST();
  const plan = useMemo(
    () =>
      buildYearEndTaxPlanner(
        ledger,
        accounts,
        preview.year,
        {
          ...settings,
          // 실수령 급여의 연환산을 세전 총급여로 단정하지 않는다.
          grossSalary: preview.grossSalarySource === "input" ? preview.grossSalary : null,
          creditSpend: settings.creditSpend ?? preview.cardSpend.credit,
          checkCashSpend: settings.checkCashSpend ?? preview.cardSpend.checkOrCash,
        },
        { today, fxRate },
      ),
    [ledger, accounts, preview, settings, today, fxRate],
  );
  const p = plan.pension;
  const c = plan.card;
  if (!plan.supported)
    return <p style={note}>절세 실행 가이드는 2026년 귀속 기준을 지원합니다. 해당 연도를 선택하세요.</p>;

  return (
    <section aria-label="올해 절세 실행 가이드" style={{ margin: "16px 0" }}>
      <h4 style={{ margin: "0 0 6px", fontSize: 16 }}>올해 절세 실행 가이드</h4>
      <p style={note}>
        추가 납입액과 예정된 지출의 결제수단을 비교합니다. 아래 설정은 연도별로 이 기기에 저장되며 백업·동기화에는
        포함되지 않습니다.
      </p>
      {!plan.salaryKnown && (
        <p role="note" style={{ ...note, color: "var(--warning)" }}>
          위에 연간 총급여(세전·비과세 제외)를 입력하면 공제율과 예상 혜택을 계산합니다. 가계부 급여는 실수령액일 수
          있어 실행 가이드의 총급여로 사용하지 않습니다.
        </p>
      )}
      {!plan.canContribute && (
        <p role="note" style={{ ...note, color: "var(--warning)" }}>
          {preview.year}년은 현재 귀속연도가 아닙니다. 해당 연도 추가 납입·지출 계획은 계산하지 않습니다.
        </p>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={panel}>
          <h5 style={{ fontSize: 14, margin: "0 0 8px" }}>1. 연금저축·IRP 추가 납입</h5>
          <AmountField
            label="올해 연금저축 납입액 (원)"
            value={settings.paidPension}
            fallback={p.paidPension}
            onCommit={(v) => onChange("paidPension", v)}
          />
          <AmountField
            label="올해 IRP·DC 본인 납입액 (원)"
            value={settings.paidIrp}
            fallback={p.paidIrp}
            onCommit={(v) => onChange("paidIrp", v)}
          />
          <p style={note}>
            빈칸은 세제 성격을 지정한 계좌의 이체 누계입니다. 누락된 계좌나 DC 본인 부담금은 증권사 납입증명서 금액으로
            수정하세요. 계좌 평가액·퇴직금·회사 부담금은 납입액에 포함하지 않습니다.
          </p>
          <AmountField
            label="연말까지 추가 납입할 여유자금 (원)"
            value={settings.pensionBudget}
            onCommit={(v) => onChange("pensionBudget", v)}
          />
          <p style={note}>
            미입력은 공제 한도까지 계산합니다. 생활비와 비상자금을 남긴 뒤 사용할 금액을 입력하세요. 0원 입력 시 추가
            납입 계획은 0원입니다.
          </p>
          <div
            style={{ padding: 10, borderRadius: 6, background: "var(--primary-light)", fontSize: 13, lineHeight: 1.8 }}
          >
            <div>
              연금저축에 추가 <strong>{won(p.addPension)}</strong>
            </div>
            <div>
              IRP에 추가 <strong>{won(p.addIrp)}</strong>
            </div>
            <div>
              추가 세액공제 가능액{" "}
              <strong>{p.additionalCredit == null ? "총급여 입력 필요" : won(p.additionalCredit)}</strong>
            </div>
            {plan.canContribute && p.contribution > 0 && (
              <div>
                {plan.monthsLeft}개월 분할 시 월 약 {won(p.monthlyContribution)} · {plan.deadline}까지 납입
              </div>
            )}
          </div>
          <p style={note}>
            공제 한도까지 연금저축 {won(p.pensionRoom)} + IRP {won(p.irpRoomAfterPension)} 여유. 합산 연 납입한도 잔여{" "}
            {won(p.annualRoom)}.
          </p>
          {p.currentCredit != null && p.additionalCredit != null && (
            <p style={note}>
              현재 납입 기준 연금 세액공제 {won(p.currentCredit)} → 계획대로 추가 납입 시{" "}
              {won(p.currentCredit + p.additionalCredit)} 예상.
            </p>
          )}
          {p.creditRoom === 0 && (
            <p style={note}>공제 또는 연 납입한도를 채웠습니다. 추가 납입에 따른 올해 세액공제 증가는 없습니다.</p>
          )}
          {p.needsPensionAccount && (
            <p style={note}>연금저축 계좌를 준비하거나 계좌 탭에서 기존 계좌의 세제 성격을 지정하세요.</p>
          )}
          {p.needsIrpAccount && (
            <p style={note}>IRP 가입 자격을 확인하고 계좌를 준비하거나 기존 계좌의 세제 성격을 지정하세요.</p>
          )}
          {settings.pensionBudget != null && p.unallocatedBudget > 0 && (
            <p style={note}>
              입력 여유자금 중 {won(p.unallocatedBudget)}은 이 계획의 공제 대상 추가 납입에 배정되지 않습니다.
            </p>
          )}
          <p style={note}>
            연금저축 공제 대상은 연 600만원, IRP·DC 본인 부담금 합산 900만원.{" "}
            {p.creditRate == null
              ? "총급여 확인 후 공제율 적용"
              : `적용 공제율 ${(p.creditRate * 100).toFixed(1)}% (지방소득세 포함)`}
            . 실제 공제는 공제 가능한 세금이 충분할 때의 금액이며 확정 환급액이 아닙니다. 연금 자금은 장기간 묶이며 중도
            인출 시 세금과 제한이 있습니다. ISA 만기 전환 추가한도는 이 계산에 포함하지 않습니다.
          </p>
        </div>

        <div style={panel}>
          <h5 style={{ fontSize: 14, margin: "0 0 8px" }}>2. 예정된 지출의 결제수단 비교</h5>
          <AmountField
            label="공제 대상 신용카드 사용액 (원)"
            value={settings.creditSpend}
            fallback={preview.cardSpend.credit}
            onCommit={(v) => onChange("creditSpend", v)}
          />
          <AmountField
            label="공제 대상 체크·현금영수증 사용액 (원)"
            value={settings.checkCashSpend}
            fallback={preview.cardSpend.checkOrCash}
            onCommit={(v) => onChange("checkCashSpend", v)}
          />
          <p style={note}>
            빈칸은 가계부 추정액입니다. 계좌 출금만으로 현금영수증 발급 여부를 알 수 없습니다. 홈택스 일반 사용분으로
            확인·수정하고 세금·보험료·공과금·해외 사용·월세 공제분 등을 제외하세요. 전통시장·대중교통·문화체육 별도
            사용분과 추가한도는 계산하지 않습니다.
          </p>
          <label style={{ display: "flex", gap: 8, justifyContent: "space-between", flexWrap: "wrap", fontSize: 13 }}>
            공제 요건을 충족한 자녀·손자녀 수
            <select
              aria-label="공제 요건을 충족한 자녀·손자녀 수"
              value={settings.eligibleChildren ?? 0}
              onChange={(e) => onChange("eligibleChildren", Number(e.target.value))}
            >
              <option value={0}>없음</option>
              <option value={1}>1명</option>
              <option value={2}>2명 이상</option>
            </select>
          </label>
          <p style={note}>부양가족의 소득·나이 등 공제 요건을 확인한 인원만 선택하세요.</p>
          {plan.salaryKnown && (
            <div style={{ fontSize: 13, lineHeight: 1.8, marginTop: 8 }}>
              <div>
                공제 시작까지 남은 사용액 <strong>{won(c.toThreshold)}</strong>
              </div>
              <div>
                현재 소득공제 {won(c.estimatedDeduction)} / 기본한도 {won(c.deductionCap)}
              </div>
              <div>
                기본한도까지 일반 지출: 체크·현금 {won(c.spendToCapCheck ?? 0)} / 신용 {won(c.spendToCapCredit ?? 0)}
              </div>
            </div>
          )}
          <AmountField
            label="연말까지 예정된 공제 대상 지출 (원)"
            value={settings.plannedSpend}
            fallback={0}
            onCommit={(v) => onChange("plannedSpend", v)}
          />
          <label
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "space-between",
              flexWrap: "wrap",
              fontSize: 13,
              marginTop: 8,
            }}
          >
            소득세 한계세율 (선택)
            <select
              aria-label="소득세 한계세율"
              value={settings.marginalRate ?? ""}
              onChange={(e) => onChange("marginalRate", e.target.value === "" ? undefined : Number(e.target.value))}
            >
              <option value="">모름 · 소득공제액만 표시</option>
              {[0, 6, 15, 24, 35, 38, 40, 42, 45].map((n) => (
                <option key={n} value={n / 100}>
                  {n}%
                </option>
              ))}
            </select>
          </label>
          <p style={note}>과세표준에 적용되는 한계세율을 선택하세요. 총급여와 과세표준은 다릅니다.</p>
          {plan.salaryKnown && (
            <table className="data-table" style={{ width: "100%", fontSize: 13, marginTop: 8 }}>
              <caption style={{ textAlign: "left", marginBottom: 6 }}>
                예정 지출 {won(c.plannedSpend)} 결제 시 증가액
              </caption>
              <thead>
                <tr>
                  <th>결제수단</th>
                  <th className="number">소득공제</th>
                  <th className="number">절세 추정</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["신용카드", c.creditScenario],
                    ["체크·현금영수증", c.checkScenario],
                  ] as const
                ).map(([label, s]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td className="number">{won(s.deductionGain)}</td>
                    <td className="number">{s.taxSaving == null ? "세율 선택 필요" : won(s.taxSaving)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p style={note}>
            소득공제액은 환급액이 아닙니다. 절세 추정은 선택한 한계세율과 지방소득세를 적용한 단순 비교이며 세율 구간
            이동·다른 공제는 반영하지 않습니다. 카드 혜택도 함께 비교하세요.
          </p>
          <p style={{ ...note, color: "var(--text)", fontWeight: 600 }}>
            절세만을 위해 소비를 늘리지 마세요. 필요한 지출의 결제수단을 선택하는 데 사용하세요.
          </p>
        </div>
      </div>

      <div style={{ ...panel, marginTop: 12 }}>
        <h5 style={{ fontSize: 14, margin: "0 0 6px" }}>3. 지금 확인할 일</h5>
        <ul style={{ fontSize: 13, lineHeight: 1.8, margin: 0, paddingLeft: 20 }}>
          <li>홈택스 사용액과 증권사 납입증명서를 대조하고 누락된 금액을 보완하세요.</li>
          {preview.rent.total > 0 && (
            <li>
              월세 {won(preview.rent.total)} 기록: 무주택·소득·주택·전입 요건을 확인하고 임대차계약서와 이체 증빙을
              준비하세요.
            </li>
          )}
          {preview.medical.total > 0 && (
            <li>
              의료비 {won(preview.medical.total)} 기록: 실손보험금 등 보전받은 금액을 제외하고 의료비 자료를 확인하세요.
            </li>
          )}
          {preview.donation.total > 0 && (
            <li>기부금 {won(preview.donation.total)} 기록: 기부금 종류와 한도를 확인하고 영수증을 준비하세요.</li>
          )}
          {plan.canContribute && <li>연금 납입은 {plan.deadline} 전에 금융기관의 처리 마감시간을 확인하세요.</li>}
        </ul>
        {p.additionalCredit != null && p.contribution > 0 && (
          <div style={{ fontSize: 13, marginTop: 8 }}>
            현재 계획의 연금 추가 세액공제 가능액{" "}
            <Money value={Math.round(p.additionalCredit)} style={{ fontWeight: 700 }} />
          </div>
        )}
        <p style={note}>
          2026년 기준 · 확인일 2026-10-12 · 근로소득 연말정산 안내. 종합소득이 함께 있는 경우 연금 공제율을 별도로
          확인하세요. 계산 근거:{" "}
          <a
            href="https://j.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7875&mi=6439"
            target="_blank"
            rel="noreferrer"
          >
            국세청 연금계좌 세액공제
          </a>{" "}
          ·{" "}
          <a
            href="https://law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=1001060529"
            target="_blank"
            rel="noreferrer"
          >
            신용카드 등 소득공제 법령
          </a>
        </p>
      </div>
    </section>
  );
};
