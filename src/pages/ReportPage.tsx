/**
 * 보고서 (ReportPage) — 오케스트레이터
 * ───────────────────────────────────────────────────────
 * 보고서 데이터는 useReportWorker(웹워커)가 계산 — 워커 연결과 무거운 파생값
 * (reconciliation/taxSummary)은 여기서 유지하고 분리 컴포넌트(features/reports/*)에
 * props로 내려준다. 자식은 재계산하지 않는다.
 *
 * 상태 소유권:
 *   - reportType            : 어떤 보고서를 보여줄지 (탭 버튼)
 *   - startDate/endDate     : 워커 입력이라 부모 소유 — 기간 선택 UI는 자식(reportShared의 Picker)
 *   - selectedMonth         : 종합 월간(월 네비게이션)·세금(연도 select)이 공유 — 부모 소유
 *
 * 자식은 모두 React.memo — 부모가 넘기는 콜백은 setState 그대로라 참조 고정.
 * CSV/Excel/PDF 내보내기는 ReportExportButtons + buildReportBlocks(순수 함수)로 분리.
 */
import React, { useMemo, useState } from "react";
import type { Account, LedgerEntry, StockPrice, StockTrade } from "../types";
import { computeInvestmentReconciliation } from "../utils/reportGenerator";
import { useFxRateValue } from "../context/FxRateContext";
import { useReportWorker } from "../hooks/useReportWorker";
import { summarizeTaxYear } from "../utils/taxCalculator";
import type { ReportType } from "../features/reports/reportShared";
import { ReportExportButtons } from "../features/reports/ReportExportButtons";
import { ComprehensiveMonthlySection } from "../features/reports/ComprehensiveMonthlySection";
import { InvestmentReconciliationSection } from "../features/reports/InvestmentReconciliationSection";
import { BasicReportTables } from "../features/reports/BasicReportTables";
import { ClosingReportSection } from "../features/reports/ClosingReportSection";
import { PerformanceAdvancedSection } from "../features/reports/PerformanceAdvancedSection";
import { TaxReportSection } from "../features/reports/TaxReportSection";

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  prices: StockPrice[];
}

export const ReportView: React.FC<Props> = ({ accounts, ledger, trades, prices }) => {
  const fxRate = useFxRateValue();
  const [reportType, setReportType] = useState<ReportType>("comprehensive");
  const [startDate, setStartDate] = useState<string>(() => {
    const date = new Date();
    date.setMonth(date.getMonth() - 11);
    return date.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  /** 종합 월간 보고서: 단일 월 선택 */
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  const {
    monthlyReport,
    monthlyIncomeDetail,
    yearlyReport,
    categoryReport,
    stockReport,
    accountReport,
    dailyReport,
    closingReport,
    accountPerformance,
    consumptionImpact,
    periodCompare,
    comprehensiveMonthly
  } = useReportWorker({
    accounts,
    ledger,
    trades,
    prices,
    startDate,
    endDate,
    fxRate
  });

  /** 투자 정산 — 전체 기간 누적, 주식·코인 계좌 기준 */
  const reconciliation = useMemo(
    () => computeInvestmentReconciliation(accounts, ledger, trades, prices, accountPerformance, fxRate ?? undefined),
    [accounts, ledger, trades, prices, accountPerformance, fxRate]
  );

  const taxYear = useMemo(() => Number(selectedMonth.slice(0, 4)), [selectedMonth]);
  const taxSummary = useMemo(() => summarizeTaxYear(ledger, taxYear), [ledger, taxYear]);

  const renderReport = () => {
    // ─── 종합 월간 보고서 ───
    if (reportType === "comprehensive") {
      return (
        <ComprehensiveMonthlySection
          comprehensiveMonthly={comprehensiveMonthly}
          selectedMonth={selectedMonth}
          setSelectedMonth={setSelectedMonth}
        />
      );
    }

    // ─── 투자 정산 ───
    if (reportType === "investment") {
      return <InvestmentReconciliationSection reconciliation={reconciliation} />;
    }

    // ─── 주간/월간 정산 ───
    if (reportType === "closing") {
      return <ClosingReportSection closingReport={closingReport} />;
    }

    // ─── 세금 시뮬레이션 (한국) ───
    if (reportType === "tax") {
      return (
        <TaxReportSection
          taxYear={taxYear}
          taxSummary={taxSummary}
          selectedMonth={selectedMonth}
          setSelectedMonth={setSelectedMonth}
        />
      );
    }

    // ─── 성과 분석 (고급) ───
    if (reportType === "performanceAdvanced") {
      return (
        <PerformanceAdvancedSection
          accountPerformance={accountPerformance}
          consumptionImpact={consumptionImpact}
          startDate={startDate}
          endDate={endDate}
          setStartDate={setStartDate}
          setEndDate={setEndDate}
        />
      );
    }

    // ─── 기본 표 보고서 (월별/연간/카테고리/주식/계좌/일별/기간 비교) ───
    return (
      <BasicReportTables
        reportType={reportType}
        monthlyReport={monthlyReport}
        yearlyReport={yearlyReport}
        categoryReport={categoryReport}
        stockReport={stockReport}
        accountReport={accountReport}
        dailyReport={dailyReport}
        periodCompare={periodCompare}
        startDate={startDate}
        endDate={endDate}
        setStartDate={setStartDate}
        setEndDate={setEndDate}
      />
    );
  };

  return (
    <div>
      <div className="section-header">
        <h2>보고서</h2>
        <ReportExportButtons
          reportType={reportType}
          startDate={startDate}
          endDate={endDate}
          comprehensiveMonthly={comprehensiveMonthly}
          reconciliation={reconciliation}
          monthlyReport={monthlyReport}
          monthlyIncomeDetail={monthlyIncomeDetail}
          yearlyReport={yearlyReport}
          categoryReport={categoryReport}
          stockReport={stockReport}
          accountReport={accountReport}
          dailyReport={dailyReport}
          periodCompare={periodCompare}
          closingReport={closingReport}
          accountPerformance={accountPerformance}
          consumptionImpact={consumptionImpact}
          taxYear={taxYear}
          taxSummary={taxSummary}
        />
      </div>

      <div className="hint" style={{ marginBottom: 8, fontSize: 12 }}>
        실현 손익·승률·보유기간 중심 요약은 <strong>대시보드 → 투자 기록 카드</strong>에서 확인할 수 있습니다.
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button type="button" className={reportType === "comprehensive" ? "primary" : ""} onClick={() => setReportType("comprehensive")}>종합 월간</button>
        <button type="button" className={reportType === "investment" ? "primary" : ""} onClick={() => setReportType("investment")}>투자 정산</button>
        <button type="button" className={reportType === "monthly" ? "primary" : ""} onClick={() => setReportType("monthly")}>월별</button>
        <button type="button" className={reportType === "yearly" ? "primary" : ""} onClick={() => setReportType("yearly")}>연간</button>
        <button type="button" className={reportType === "category" ? "primary" : ""} onClick={() => setReportType("category")}>카테고리별</button>
        <button type="button" className={reportType === "stock" ? "primary" : ""} onClick={() => setReportType("stock")}>주식 성과</button>
        <button type="button" className={reportType === "account" ? "primary" : ""} onClick={() => setReportType("account")}>계좌별</button>
        <button type="button" className={reportType === "daily" ? "primary" : ""} onClick={() => setReportType("daily")}>일별</button>
        <button type="button" className={reportType === "periodCompare" ? "primary" : ""} onClick={() => setReportType("periodCompare")}>기간 비교</button>
        <button type="button" className={reportType === "closing" ? "primary" : ""} onClick={() => setReportType("closing")}>주간/월간 정산</button>
        <button type="button" className={reportType === "performanceAdvanced" ? "primary" : ""} onClick={() => setReportType("performanceAdvanced")}>성과 분석</button>
        <button type="button" className={reportType === "tax" ? "primary" : ""} onClick={() => setReportType("tax")}>세금 (한국)</button>
      </div>

      <div className="card">{renderReport()}</div>
    </div>
  );
};
