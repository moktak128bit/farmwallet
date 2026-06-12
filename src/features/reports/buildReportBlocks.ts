/**
 * 현재 보고서 타입을 표 블록 목록으로 변환 — CSV·Excel·PDF가 공유.
 * ReportPage에서 분리한 순수 함수 — 입력은 모두 부모(reportWorker 결과 + 부모 memo)에서 받는다.
 */
import type {
  AccountPerformanceBreakdownRow,
  AccountReport,
  CategoryReport,
  ClosingReportData,
  ComprehensiveMonthlyRow,
  ConsumptionImpactMonthlyRow,
  DailyReport,
  InvestmentReconciliation,
  MonthlyIncomeDetail,
  MonthlyReport,
  StockPerformanceReport
} from "../../utils/reportGenerator";
import type { TaxYearSummary } from "../../utils/taxCalculator";
import type { ReportBlock } from "../../utils/reportExport";
import { getTodayKST } from "../../utils/date";
import { toPercent, type ReportType } from "./reportShared";

export interface ReportBlocksInput {
  reportType: ReportType;
  startDate: string;
  endDate: string;
  comprehensiveMonthly: ComprehensiveMonthlyRow[];
  reconciliation: InvestmentReconciliation;
  monthlyReport: MonthlyReport[];
  monthlyIncomeDetail: MonthlyIncomeDetail[];
  yearlyReport: MonthlyReport[];
  categoryReport: CategoryReport[];
  stockReport: StockPerformanceReport[];
  accountReport: AccountReport[];
  dailyReport: DailyReport[];
  closingReport: ClosingReportData;
  accountPerformance: AccountPerformanceBreakdownRow[];
  consumptionImpact: ConsumptionImpactMonthlyRow[];
  taxYear: number;
  taxSummary: TaxYearSummary;
}

interface ReportBlocksResult {
  filename: string;
  title: string;
  subtitle?: string;
  blocks: ReportBlock[];
}

export function buildReportBlocks(input: ReportBlocksInput): ReportBlocksResult {
  const {
    reportType,
    startDate,
    endDate,
    comprehensiveMonthly,
    reconciliation,
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
    taxYear,
    taxSummary
  } = input;

  // 파일명 날짜는 KST 기준 — UTC 사용 시 오전 9시 이전엔 전날 날짜가 찍힘
  const today = getTodayKST();
  const blocks: ReportBlock[] = [];
  let title = "";
  let filenameBase: string = reportType;
  let subtitle: string | undefined;

  switch (reportType) {
    case "comprehensive": {
      title = "종합 월간";
      filenameBase = "종합_월간";
      subtitle = `${startDate.slice(0, 7)} ~ ${endDate.slice(0, 7)}`;
      blocks.push({
        title: "종합 월간",
        head: ["월", "근로소득", "자본소득", "비실질수입", "전체수입", "생활소비", "저축성지출", "대출상환", "신용결제", "전체지출", "매수", "매도", "실현손익", "배당", "투자이체", "투자출금", "이체총액", "실질순수입", "장부순수입", "실질저축률", "실질수입", "실질지출"],
        rows: comprehensiveMonthly.map((r) => [
          r.month, r.earnedIncome, r.capitalIncome, r.nonRealIncome, r.totalIncome,
          r.livingExpense, r.savingsExpense, r.loanRepayment, r.creditPayment, r.totalExpense,
          r.buyAmount, r.sellAmount, r.realizedPnl, r.dividendIncome, r.investingIn, r.investingOut,
          r.transferTotal, r.realNet, r.totalNet,
          r.realSavingsRate != null ? `${r.realSavingsRate.toFixed(1)}%` : "-",
          r.realIncome, r.realExpense
        ])
      });
      break;
    }
    case "investment": {
      title = "투자 정산";
      filenameBase = "투자_정산";
      subtitle = "전체 기간 누적";
      const rec = reconciliation;
      if (rec.hasData) {
        blocks.push({
          title: "투자 요약",
          head: ["항목", "금액"],
          rows: [
            ["투자계좌 초기자본", Math.round(rec.initialCapital)],
            ["누적 입금", Math.round(rec.deposits)],
            ["누적 출금", Math.round(rec.withdrawals)],
            ["순투입원금", Math.round(rec.netContributed)],
            ["현재 평가액", Math.round(rec.currentValue)],
            ["투자 총성과", Math.round(rec.totalReturn)],
            ["총수익률", toPercent(rec.returnRate)],
            ["연환산 IRR", toPercent(rec.irr)],
            ["실현 이익", Math.round(rec.realizedGain)],
            ["실현 손실", Math.round(rec.realizedLoss)],
            ["실현 손익(순)", Math.round(rec.realizedPnl)],
            ["미실현 이익", Math.round(rec.unrealizedGain)],
            ["미실현 손실", Math.round(rec.unrealizedLoss)],
            ["미실현 손익(순)", Math.round(rec.unrealizedPnl)],
            ["배당 수입", Math.round(rec.dividendIncome)],
            ["매수 총액", Math.round(rec.buyVolume)],
            ["매도 총액", Math.round(rec.sellVolume)]
          ]
        });
        if (rec.accounts.length > 0) {
          blocks.push({
            title: "계좌별 정산",
            head: ["계좌", "순투입원금", "현재평가액", "총성과", "실현", "미실현", "배당", "IRR"],
            rows: rec.accounts.map((a) => [
              a.accountName, Math.round(a.netContributed), Math.round(a.currentValue),
              Math.round(a.totalReturn), Math.round(a.realizedPnl), Math.round(a.unrealizedPnl),
              Math.round(a.dividendIncome), toPercent(a.irr)
            ])
          });
        }
        if (rec.winningTrades.length > 0) {
          blocks.push({
            title: "확정수익 거래",
            head: ["매도일", "종목", "계좌", "실현손익", "수익률"],
            rows: rec.winningTrades.map((t) => [t.date, t.name, t.accountName, Math.round(t.pnl), toPercent(t.returnRate)])
          });
        }
        if (rec.losingTrades.length > 0) {
          blocks.push({
            title: "확정손실 거래",
            head: ["매도일", "종목", "계좌", "실현손익", "수익률"],
            rows: rec.losingTrades.map((t) => [t.date, t.name, t.accountName, Math.round(t.pnl), toPercent(t.returnRate)])
          });
        }
        if (rec.winningPositions.length > 0) {
          blocks.push({
            title: "평가수익 종목",
            head: ["종목", "계좌", "평가손익", "손익률"],
            rows: rec.winningPositions.map((p) => [p.name, p.accountName, Math.round(p.pnl), toPercent(p.pnlRate)])
          });
        }
        if (rec.losingPositions.length > 0) {
          blocks.push({
            title: "평가손실 종목",
            head: ["종목", "계좌", "평가손익", "손익률"],
            rows: rec.losingPositions.map((p) => [p.name, p.accountName, Math.round(p.pnl), toPercent(p.pnlRate)])
          });
        }
        if (rec.monthlyPnl.length > 0) {
          blocks.push({
            title: "월별 실현손익",
            head: ["월", "실현이익", "실현손실"],
            rows: rec.monthlyPnl.map((m) => [m.month, Math.round(m.realizedGain), Math.round(m.realizedLoss)])
          });
        }
      }
      break;
    }
    case "monthly": {
      title = "월별 수입/지출";
      filenameBase = "월별_수입지출";
      subtitle = `${startDate.slice(0, 7)} ~ ${endDate.slice(0, 7)}`;
      blocks.push({
        title: "월별 수입/지출",
        head: ["월", "수입", "지출", "이체", "순수입"],
        rows: monthlyReport.map((r) => [r.month, r.income, r.expense, r.transfer, r.net])
      });
      if (monthlyIncomeDetail.length > 0) {
        // 실제 내용은 배당·이자 수입만 포함 — 전체 수입으로 오해되지 않도록 라벨 명시
        blocks.push({
          title: "배당·이자 상세",
          head: ["월", "일자", "대분류", "중분류", "내용", "계좌", "금액"],
          rows: monthlyIncomeDetail.map((d) => [d.month, d.date, d.category, d.subCategory ?? "", d.description, d.accountName ?? "", d.amount])
        });
      }
      break;
    }
    case "yearly": {
      title = "연간 요약";
      filenameBase = "연간_요약";
      blocks.push({
        title: "연간 요약",
        head: ["연도", "수입", "지출", "순수입"],
        rows: yearlyReport.map((r) => [r.month, r.income, r.expense, r.net])
      });
      break;
    }
    case "category": {
      title = "카테고리별 지출";
      filenameBase = "카테고리별_지출";
      subtitle = `${startDate} ~ ${endDate}`;
      blocks.push({
        title: "카테고리별 지출",
        head: ["대분류", "중분류", "합계", "건수", "평균"],
        rows: categoryReport.map((r) => [r.category, r.subCategory ?? "-", r.total, r.count, Math.round(r.average)])
      });
      break;
    }
    case "stock": {
      title = "주식 성과";
      filenameBase = "주식_성과";
      blocks.push({
        title: "주식 성과",
        head: ["종목코드", "종목명", "수량", "매수총액", "현재가치", "손익", "손익률", "IRR"],
        rows: stockReport.map((r) => [r.ticker, r.name, r.quantity, Math.round(r.totalBuyAmount), Math.round(r.currentValue), Math.round(r.pnl), toPercent(r.pnlRate), toPercent(r.irr)])
      });
      break;
    }
    case "account": {
      title = "계좌 요약";
      filenameBase = "계좌_요약";
      blocks.push({
        title: "계좌 요약",
        head: ["계좌명", "초기잔액", "현재잔액", "변동", "변동률"],
        rows: accountReport.map((r) => [r.accountName, Math.round(r.initialBalance), Math.round(r.currentBalance), Math.round(r.change), `${r.changeRate.toFixed(2)}%`])
      });
      break;
    }
    case "daily": {
      title = "일별 자산 스냅샷";
      filenameBase = "일별_스냅샷";
      subtitle = `${startDate} ~ ${endDate}`;
      blocks.push({
        title: "일별 자산 스냅샷",
        head: ["날짜", "수입", "지출", "저축성지출", "이체", "주식평가", "현금", "저축자산", "총자산", "순자산"],
        rows: dailyReport.map((r) => [r.date, r.income, r.expense, r.savingsExpense, r.transfer, Math.round(r.stockValue), Math.round(r.cashValue), Math.round(r.savingsValue), Math.round(r.totalAsset), Math.round(r.netWorth)])
      });
      break;
    }
    case "closing": {
      title = "주간/월간 정산";
      filenameBase = "정산_보고서";
      const head = ["기간", "시작", "종료", "자산", "부채", "순자산", "수입", "지출", "현금흐름"];
      const toRow = (s: (typeof closingReport.monthlySnapshots)[number]): (string | number)[] => [
        s.periodKey, s.startDate, s.endDate, Math.round(s.asset), Math.round(s.debt),
        Math.round(s.netWorth), Math.round(s.income), Math.round(s.expense), Math.round(s.cashflow)
      ];
      if (closingReport.monthlySnapshots.length > 0) {
        blocks.push({ title: "월간 스냅샷", head, rows: closingReport.monthlySnapshots.map(toRow) });
      }
      if (closingReport.weeklySnapshots.length > 0) {
        blocks.push({ title: "주간 스냅샷", head, rows: closingReport.weeklySnapshots.map(toRow) });
      }
      break;
    }
    case "performanceAdvanced": {
      title = "성과 분석";
      filenameBase = "성과_분석";
      subtitle = `${startDate} ~ ${endDate}`;
      blocks.push({
        title: "계좌별 성과 기여",
        head: ["계좌", "현재가치", "실현손익", "미실현손익", "배당기여", "총기여", "IRR", "TTWR"],
        rows: accountPerformance.map((r) => [r.accountName, Math.round(r.currentValue), Math.round(r.realizedPnl), Math.round(r.unrealizedPnl), Math.round(r.dividendContribution), Math.round(r.totalContribution), toPercent(r.irr), toPercent(r.ttwr)])
      });
      blocks.push({
        title: "소비가 투자여력에 미치는 영향",
        head: ["월", "수입", "소비지출", "투자여력", "실제투자", "갭", "활용률"],
        rows: consumptionImpact.map((r) => [r.month, r.income, r.consumptionExpense, r.investmentCapacity, r.actualInvested, r.capacityGap, r.capacityUtilizationRate != null ? `${r.capacityUtilizationRate.toFixed(1)}%` : "-"])
      });
      break;
    }
    case "tax": {
      title = `세금 ${taxYear}`;
      filenameBase = `세금_${taxYear}`;
      subtitle = `${taxYear}년 · 한국 세법 기준`;
      const rows: (string | number)[][] = [
        ["배당 (총)", Math.round(taxSummary.dividendGross)],
        ["이자 (총)", Math.round(taxSummary.interestGross)],
        ["합계", Math.round(taxSummary.totalGross)],
        ["분리과세 (15.4%)", Math.round(taxSummary.separateTax)],
        ["실수령액", Math.round(taxSummary.netIncome)]
      ];
      if (taxSummary.exceedsThreshold) {
        rows.push(["종합과세 기준 초과액", Math.round(taxSummary.amountOverThreshold)]);
        rows.push(["종합과세 추가세(추정)", Math.round(taxSummary.estimatedAdditionalTaxIfComprehensive)]);
      }
      blocks.push({ title: `세금 ${taxYear}`, head: ["항목", "금액"], rows });
      break;
    }
  }

  return { filename: `${filenameBase}_${today}`, title, subtitle, blocks };
}
