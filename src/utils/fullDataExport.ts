/**
 * 전체 데이터 한 번에 내보내기 — AppData를 시트별(가계부·주식거래·보유현황·배당이자·계좌·예산·대출·반복지출)로
 * 변환. utils/excelExport.downloadAsExcel(다중 워크시트 SpreadsheetML)에 그대로 넘긴다. 순수 함수.
 * (운동·앱설정 등 비재무/중첩 데이터는 제외 — 그건 설정의 'JSON 백업 다운로드'가 통째로 담는다.)
 */
import type { AppData } from "../types";
import type { SheetData } from "./excelExport";
import { computePositions } from "../calculations";
import { isDividendEntryLoose, isInterestEntryLoose } from "./categoryMatch";

const KIND_LABEL: Record<string, string> = { income: "수입", expense: "지출", transfer: "이체" };

export function buildFullDataSheets(data: AppData): SheetData[] {
  const sheets: SheetData[] = [];
  const accById = new Map((data.accounts ?? []).map((a) => [a.id, a.name]));
  const accName = (id?: string) => (id ? accById.get(id) ?? id : "");

  sheets.push({
    name: "가계부",
    rows: [
      ["날짜", "구분", "대분류", "중분류", "소분류", "내용", "금액", "통화", "출금계좌", "입금계좌", "할인", "태그", "메모"],
      ...(data.ledger ?? []).map((l) => [
        l.date, KIND_LABEL[l.kind] ?? l.kind, l.category, l.subCategory ?? "", l.detailCategory ?? "",
        l.description, l.amount, l.currency ?? "KRW", accName(l.fromAccountId), accName(l.toAccountId),
        l.discountAmount ?? "", (l.tags ?? []).join(", "), l.note ?? "",
      ]),
    ],
  });

  sheets.push({
    name: "주식거래",
    rows: [
      ["날짜", "계좌", "티커", "종목명", "구분", "수량", "단가", "수수료", "총액", "현금영향", "매입환율"],
      ...(data.trades ?? []).map((t) => [
        t.date, accName(t.accountId), t.ticker, t.name, t.side === "buy" ? "매수" : "매도",
        t.quantity, t.price, t.fee, t.totalAmount, t.cashImpact, t.fxRateAtTrade ?? "",
      ]),
    ],
  });

  const positions = computePositions(data.trades ?? [], data.prices ?? [], data.accounts ?? []);
  sheets.push({
    name: "보유현황",
    rows: [
      ["계좌", "티커", "종목명", "수량", "평단", "매입금액", "평가금액", "통화", "평가손익", "수익률%"],
      ...positions.map((p) => [
        p.accountName, p.ticker, p.name, p.quantity, p.avgPrice, p.totalBuyAmount,
        p.marketValue, p.marketCurrency ?? "", p.pnl, Number((p.pnlRate * 100).toFixed(2)),
      ]),
    ],
  });

  const divInt = (data.ledger ?? []).filter((l) => l.kind === "income" && (isDividendEntryLoose(l) || isInterestEntryLoose(l)));
  sheets.push({
    name: "배당이자",
    rows: [
      ["날짜", "구분", "내용", "금액", "통화", "입금계좌", "메모"],
      ...divInt.map((l) => [
        l.date, isDividendEntryLoose(l) ? "배당" : "이자", l.description, l.amount, l.currency ?? "KRW", accName(l.toAccountId), l.note ?? "",
      ]),
    ],
  });

  sheets.push({
    name: "계좌",
    rows: [
      ["이름", "기관", "유형", "초기잔액", "통화", "USD잔액", "비활성", "메모"],
      ...(data.accounts ?? []).map((a) => [
        a.name, a.institution, a.type, a.initialBalance, a.currency ?? "KRW", a.usdBalance ?? "", a.archived ? "Y" : "", a.note ?? "",
      ]),
    ],
  });

  if ((data.budgetGoals ?? []).length > 0) {
    sheets.push({
      name: "예산",
      rows: [["카테고리", "월한도", "메모"], ...(data.budgetGoals ?? []).map((b) => [b.category, b.monthlyLimit, b.note ?? ""])],
    });
  }
  if ((data.loans ?? []).length > 0) {
    sheets.push({
      name: "대출",
      rows: [
        ["기관", "대출명", "중분류", "대출금액", "연이율%", "상환방법", "대출일", "만기일"],
        ...(data.loans ?? []).map((l) => [l.institution, l.loanName, l.subCategory ?? "", l.loanAmount, l.annualInterestRate, l.repaymentMethod, l.loanDate, l.maturityDate]),
      ],
    });
  }
  if ((data.recurringExpenses ?? []).length > 0) {
    sheets.push({
      name: "반복지출",
      rows: [
        ["제목", "금액", "카테고리", "주기", "시작일", "종료일"],
        ...(data.recurringExpenses ?? []).map((r) => [r.title, r.amount, r.category, r.frequency, r.startDate, r.endDate ?? ""]),
      ],
    });
  }

  return sheets;
}
