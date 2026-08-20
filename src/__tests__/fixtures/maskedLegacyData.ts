/**
 * 마이그레이션 리플레이용 마스킹 픽스처 — 사용자 실데이터(data/farmwallet-data.json, .gitignore)의 **형태**만
 * 손으로 옮긴 축소본. 금액은 임의값, 설명/메모/계좌명은 마스킹. 실데이터 값은 한 건도 포함하지 않는다.
 *
 * 포함하는 형태(실데이터에 3세대가 공존):
 *  - 가계부 3세대: ① 평면(category=대분류 직접) ② 2세대(category="지출", subCategory=대분류, 소분류 없음/이자상환)
 *    ③ 현행(category="지출"/"수입"/"이체", subCategory=대분류, detailCategory=소분류)
 *  - 할인(discountAmount — amount는 이미 순액), 재테크(레거시 expense 저축/투자 + 현행 투자손실), 레거시 신용결제 expense,
 *    레거시 저축성지출, v7 임시 transfer(subCategory="투자"), 정산(income+settledLedgerIds, 두 세대), 환전 쌍(fx-*-from/to + 수수료),
 *    USD 이체, 대출 이자상환(loanId), 배당(D- id), 고정지출 플래그
 *  - 거래: 국내(6자리)·미국(fxRateAtTrade) 매수/매도
 *  - categoryPresets는 v9/v10/v12 블록이 손댈 여지가 있는 구형(투자이체 없음·데이트통장 없음·신용카드 main·재테크 subs 구형)
 *
 * 매 호출마다 새 객체를 만든다(테스트 간 변형 격리). schemaVersion은 호출부가 붙인다.
 */

interface MaskedFixtureSummary {
  /** 레거시 재테크 expense 저축/투자 + v7 임시 transfer(subCategory 저축/투자) — v11 블록이 transfer 저축이체/투자이체로 재분류 */
  legacyRecheckExpenseAmount: number;
  /** income category="데이트비" 합계 — v10 블록이 "데이트통장"으로 바꿈(kind·금액 불변) */
  legacyDateIncomeCount: number;
}

export function buildMaskedLegacyData(): Record<string, unknown> {
  const accounts = [
    { id: "ACC-BANK", name: "주거래", institution: "은행A", type: "checking", initialBalance: 1_500_000, debt: 0, savings: 0, cashAdjustment: 0 },
    { id: "ACC-CARD", name: "카드", institution: "카드사B", type: "card", initialBalance: 0, debt: 0, savings: 0 },
    { id: "ACC-CMA", name: "증권CMA", institution: "증권사C", type: "securities", initialBalance: 0, debt: 0, savings: 0, initialCashBalance: 300_000, usdBalance: 120.5, krwBalance: 50_000, cashAdjustment: 0 },
    { id: "ACC-US", name: "해외증권", institution: "증권사D", type: "securities", initialBalance: 0, debt: 0, savings: 0, initialCashBalance: 0, currency: "KRW", usdBalance: 800.25, krwBalance: 0, cashAdjustment: 0 },
    { id: "ACC-SAV", name: "청약", institution: "은행A", type: "savings", initialBalance: 2_000_000, debt: 0, savings: 0, cashAdjustment: 0 },
    { id: "ACC-PEN", name: "연금", institution: "증권사C", type: "securities", initialBalance: 0, debt: 0, savings: 0, initialCashBalance: 0, usdBalance: 0, cashAdjustment: 0, isPension: true },
    { id: "ACC-DATE", name: "모임통장", institution: "은행E", type: "checking", initialBalance: 0, debt: 0, savings: 0, archived: false },
    { id: "ACC-OLD", name: "옛통장", institution: "은행F", type: "checking", initialBalance: 10_000, debt: 0, savings: 0, archived: true },
    { id: "ACC-COIN", name: "코인", institution: "거래소G", type: "crypto", initialBalance: 0, debt: 0, savings: 0, cashAdjustment: 0, initialCashBalance: 0, usdBalance: 0 }
  ];

  const ledger = [
    // --- ③ 현행 3단 (지출/대분류/소분류) ---
    { id: "L-3g-0001", date: "2026-04-30", kind: "expense", isFixedExpense: false, category: "지출", subCategory: "유류교통비", detailCategory: "대중교통", description: "[m] 교통", amount: 23_900, fromAccountId: "ACC-CARD", discountAmount: 11_100 },
    { id: "L-3g-0002", date: "2026-04-09", kind: "expense", isFixedExpense: false, category: "지출", subCategory: "경조사비", detailCategory: "생일", description: "[m] 선물", amount: 49_993, fromAccountId: "ACC-BANK", discountAmount: 7 },
    { id: "L-3g-0003", date: "2026-05-02", kind: "expense", isFixedExpense: false, category: "지출", subCategory: "식비", detailCategory: "시장/마트", description: "[m] 장보기", amount: 38_400, fromAccountId: "ACC-CARD" },
    { id: "L-3g-0004", date: "2026-03-11", kind: "expense", category: "지출", subCategory: "구독비", detailCategory: "영상", description: "[m] 구독", amount: 14_900, fromAccountId: "ACC-CARD", isFixedExpense: true },
    { id: "L-3g-0005", date: "2026-06-19", kind: "expense", category: "지출", subCategory: "대출상환", detailCategory: "이자상환", description: "[m] 이자", fromAccountId: "ACC-BANK", amount: 83_210, loanId: "LOAN-0001" },
    { id: "L-3g-0006", date: "2026-06-29", kind: "expense", category: "지출", subCategory: "대출상환", detailCategory: "원금상환", description: "[m] 원금", fromAccountId: "ACC-BANK", amount: 250_000, loanId: "LOAN-0002" },
    { id: "L-3g-0007", date: "2026-03-09", kind: "expense", category: "지출", subCategory: "수수료", detailCategory: "환전수수료", description: "[m] 환전 수수료", fromAccountId: "ACC-CMA", amount: 1_200 },
    { id: "L-3g-0008", date: "2026-03-24", kind: "expense", isFixedExpense: false, category: "재테크", subCategory: "투자손실", description: "[m] 손실", amount: 12_345, fromAccountId: "ACC-CMA" },
    { id: "L-3g-0009", date: "2026-05-20", kind: "expense", category: "지출", subCategory: "데이트비", detailCategory: "외식", description: "[m] 데이트", amount: 56_000, fromAccountId: "ACC-DATE" },
    { id: "L-3g-0010", date: "2026-05-27", kind: "expense", category: "지출", subCategory: "데이트비", detailCategory: "카페", description: "[m] 데이트", amount: 11_000, fromAccountId: "ACC-DATE" },
    // --- ② 2세대 (지출/대분류, 소분류 없음; 이자상환이 subCategory) ---
    { id: "L1700000000001", date: "2025-09-15", kind: "expense", isFixedExpense: false, category: "지출", subCategory: "식비", description: "[m] 점심", amount: 9_500, fromAccountId: "ACC-CARD" },
    { id: "L1700000000002", date: "2025-09-20", kind: "expense", isFixedExpense: false, category: "지출", subCategory: "이자상환", description: "[m] 학자금 이자", amount: 31_000, fromAccountId: "ACC-BANK" },
    { id: "L1700000000003", date: "2025-10-01", kind: "expense", category: "지출", description: "[m] 미분류", amount: 3_000, fromAccountId: "ACC-BANK" },
    // --- ① 평면 레거시 (category=대분류 직접) ---
    { id: "L1690000000001", date: "2025-06-03", kind: "expense", category: "식비", subCategory: "외식/배달", description: "[m] 배달", amount: 18_700, fromAccountId: "ACC-CARD" },
    { id: "L1690000000002", date: "2025-06-10", kind: "expense", category: "데이트비", description: "[m] 영화", amount: 28_000, fromAccountId: "ACC-DATE" },
    { id: "L1690000000003", date: "2025-06-25", kind: "expense", category: "신용결제", subCategory: "신용결제", description: "[m] 카드대금", amount: 412_300, fromAccountId: "ACC-BANK", toAccountId: "ACC-CARD" },
    { id: "L1690000000004", date: "2025-06-26", kind: "expense", category: "재테크", subCategory: "저축", description: "[m] 청약 납입", amount: 100_000, fromAccountId: "ACC-BANK", toAccountId: "ACC-SAV" },
    { id: "L1690000000005", date: "2025-06-27", kind: "expense", category: "재테크", subCategory: "투자", description: "[m] 증권 입금", amount: 300_000, fromAccountId: "ACC-BANK", toAccountId: "ACC-CMA" },
    { id: "L1690000000006", date: "2025-07-01", kind: "expense", category: "저축성지출", subCategory: "주택청약", description: "[m] 청약", amount: 100_000, fromAccountId: "ACC-BANK", toAccountId: "ACC-SAV" },
    // --- v7 임시 transfer (subCategory 투자/저축, category 이체) ---
    { id: "L1766467634214-85-b4zpcrt7p", date: "2025-08-20", kind: "transfer", category: "이체", subCategory: "투자", description: "[m] 투자 이체", amount: 200_000, fromAccountId: "ACC-BANK", toAccountId: "ACC-US" },
    { id: "L1766467634214-86-2vfn2askv", date: "2025-08-20", kind: "transfer", category: "이체", subCategory: "저축", description: "[m] 저축 이체", amount: 50_000, fromAccountId: "ACC-BANK", toAccountId: "ACC-SAV" },
    // --- 수입 ---
    { id: "L-3g-0101", date: "2026-07-25", kind: "income", isFixedExpense: false, category: "수입", subCategory: "급여", description: "[m] 급여", amount: 3_210_000, toAccountId: "ACC-BANK" },
    { id: "D-3g-0102", date: "2026-08-04", kind: "income", category: "수입", subCategory: "배당", description: "[m] 배당", toAccountId: "ACC-PEN", amount: 4_320, currency: "KRW", note: "[m]" },
    { id: "D-3g-0103", date: "2026-08-05", kind: "income", category: "수입", subCategory: "배당", description: "[m] 해외배당", toAccountId: "ACC-US", amount: 12.34, currency: "USD" },
    { id: "L1690000000101", date: "2025-05-31", kind: "income", category: "이자", description: "[m] 예금이자", amount: 1_530, toAccountId: "ACC-SAV" },
    { id: "L1690000000102", date: "2025-06-05", kind: "income", category: "데이트비", description: "[m] 상대 입금", amount: 150_000, toAccountId: "ACC-DATE" },
    { id: "L1690000000103", date: "2025-07-05", kind: "income", category: "데이트비", subCategory: "데이트통장", description: "[m] 상대 입금", amount: 150_000, toAccountId: "ACC-DATE" },
    { id: "settle-0001", date: "2026-06-01", kind: "income", category: "정산", subCategory: "데이트통장", description: "[m] 2026-05-01 이후 정산", amount: 33_500, toAccountId: "ACC-DATE", note: "[m]", settledLedgerIds: ["L-3g-0009", "L-3g-0010"] },
    { id: "L-3g-0104", date: "2026-04-01", kind: "income", category: "수입", subCategory: "정산", description: "[m] 정산", amount: 20_000, toAccountId: "ACC-DATE", settledLedgerIds: ["L1690000000002"] },
    { id: "L-3g-0105", date: "2026-06-30", kind: "income", category: "수입", subCategory: "투자수익", description: "[m] 매도차익", amount: 77_000, toAccountId: "ACC-CMA" },
    // --- 이체 (현행) ---
    { id: "L-3g-0201", date: "2026-08-03", kind: "transfer", isFixedExpense: false, category: "이체", subCategory: "투자이체", description: "[m] 투자", amount: 500_000, fromAccountId: "ACC-BANK", toAccountId: "ACC-CMA" },
    { id: "L-3g-0202", date: "2026-08-01", kind: "transfer", isFixedExpense: false, category: "이체", subCategory: "데이트이체", description: "[m] 데이트", amount: 200_000, fromAccountId: "ACC-CMA", toAccountId: "ACC-DATE" },
    { id: "L-3g-0203", date: "2026-07-02", kind: "transfer", category: "이체", subCategory: "저축이체", description: "[m] 저축", amount: 100_000, fromAccountId: "ACC-BANK", toAccountId: "ACC-SAV" },
    { id: "L-3g-0204", date: "2026-07-13", kind: "transfer", category: "이체", subCategory: "카드결제이체", description: "[m] 카드대금", amount: 389_000, fromAccountId: "ACC-BANK", toAccountId: "ACC-CARD" },
    { id: "L-3g-0205", date: "2026-07-31", kind: "transfer", category: "이체", subCategory: "이월이체", description: "[m] 이월", amount: 25_000, fromAccountId: "ACC-DATE", toAccountId: "ACC-DATE" },
    { id: "L1770039576998", date: "2026-02-02", kind: "transfer", isFixedExpense: false, category: "이체", subCategory: "계좌이체", description: "[m] 달러 이체", amount: 100, currency: "USD", fromAccountId: "ACC-CMA", toAccountId: "ACC-US" },
    // --- 환전 쌍 (KRW → USD) ---
    { id: "fx-1773362903191-from", date: "2026-03-09", kind: "transfer", category: "이체", subCategory: "환전이체", description: "[m] 환전: KRW→USD", fromAccountId: "ACC-CMA", amount: 1_450_000, currency: "KRW" },
    { id: "fx-1773362903191-to", date: "2026-03-09", kind: "transfer", category: "이체", subCategory: "환전이체", description: "[m] 환전: KRW→USD", toAccountId: "ACC-US", amount: 1_000, currency: "USD" }
  ];

  const trades = [
    { id: "T-0001", date: "2026-08-03", accountId: "ACC-CMA", ticker: "0183J0", name: "[m] 국내ETF", side: "buy", quantity: 118, price: 6_755, fee: 0, totalAmount: 797_090, cashImpact: -797_090 },
    { id: "T-0002", date: "2026-08-03", accountId: "ACC-PEN", ticker: "458730", name: "[m] 배당ETF", side: "buy", quantity: 9, price: 10_935, fee: 0, totalAmount: 98_415, cashImpact: -98_415 },
    { id: "T-0003", date: "2026-06-10", accountId: "ACC-CMA", ticker: "005930", name: "[m] 대형주", side: "sell", quantity: 3, price: 82_000, fee: 150, totalAmount: 245_850, cashImpact: 245_850 },
    { id: "T-0004", date: "2026-03-10", accountId: "ACC-US", ticker: "SCHD", name: "[m] US ETF", side: "buy", quantity: 10, price: 27.5, fee: 0.25, totalAmount: 275.25, cashImpact: -275.25, fxRateAtTrade: 1_452.3 },
    { id: "T-0005", date: "2026-07-15", accountId: "ACC-US", ticker: "O", name: "[m] US REIT", side: "sell", quantity: 2, price: 56.1, fee: 0.1, totalAmount: 112.1, cashImpact: 112.1, fxRateAtTrade: 1_380.0 }
  ];

  const loans = [
    { id: "LOAN-0001", institution: "은행A", loanName: "[m] 주담대", subCategory: "주담대이자", loanAmount: 150_000_000, annualInterestRate: 3.9, repaymentMethod: "equal_payment", loanDate: "2025-01-15", maturityDate: "2055-01-15", gracePeriodYears: 1 },
    { id: "LOAN-0002", institution: "재단H", loanName: "[m] 학자금", subCategory: "학자금대출", loanAmount: 8_000_000, annualInterestRate: 1.7, repaymentMethod: "equal_principal", loanDate: "2022-03-02", maturityDate: "2032-03-02" }
  ];

  const recurringExpenses = [
    { id: "R-0001", amount: 100_000, category: "저축성지출", subCategory: "주택청약", frequency: "monthly", startDate: "2025-11-01", note: "", fromAccountId: "ACC-BANK", toAccountId: "ACC-SAV", title: "[m] 청약" },
    { id: "R-0002", amount: 14_900, category: "구독비", frequency: "monthly", startDate: "2026-01-01", fromAccountId: "ACC-CARD", title: "[m] 구독" },
    { id: "R-0003", amount: 120_000, category: "보험료", frequency: "yearly", startDate: "2025-03-01", endDate: "2030-03-01", fromAccountId: "ACC-BANK", title: "[m] 보험" }
  ];

  const budgetGoals = [
    { id: "B-0001", category: "전체", monthlyLimit: 600_000, note: "", excludeCategories: ["재테크", "데이트비"] },
    { id: "B-0002", category: "식비", monthlyLimit: 250_000 }
  ];

  const categoryPresets = {
    income: ["급여", "수당", "배당", "정산", "상여", "투자수익", "이자", "데이트비", "용돈", "캐시백", "기타수입", "환불"],
    expense: ["재테크", "식비", "유류교통비", "신용카드", "구독비", "대출상환", "데이트비", "수수료", "경조사비", "보험료"],
    expenseDetails: [
      { main: "재테크", subs: ["저축", "투자", "투자수익", "투자손실"] },
      { main: "식비", subs: ["시장/마트", "외식/배달", "간식", "카페", "편의점", "기타식비"] },
      { main: "유류교통비", subs: ["대중교통", "택시", "유류·충전", "톨비", "주차비"] },
      { main: "신용카드", subs: ["카드대금"] },
      { main: "구독비", subs: ["영상", "음악"] },
      { main: "대출상환", subs: ["원금상환", "이자상환"] },
      { main: "데이트비", subs: ["외식", "카페"] },
      { main: "수수료", subs: ["환전수수료"] },
      { main: "경조사비", subs: ["생일"] },
      { main: "보험료", subs: ["실손"] }
    ],
    transfer: ["저축이체", "계좌이체", "카드결제이체", "데이트이체", "이월이체", "환전이체"],
    categoryTypes: {
      fixed: ["구독비", "보험료"],
      savings: ["저축성지출"],
      transfer: ["저축이체", "계좌이체", "카드결제이체"],
      salary: ["급여", "수당", "상여"],
      passive: ["배당", "이자", "투자수익"],
      nonRealIncome: ["정산", "용돈", "환불"]
    }
  };

  return {
    loans,
    accounts,
    ledger,
    trades,
    categoryPresets,
    recurringExpenses,
    budgetGoals,
    customSymbols: [{ ticker: "0183J0", name: "[m] 국내ETF" }],
    usTickers: ["SCHD", "O", "VOO"],
    ledgerTemplates: [{ id: "TPL-0001", name: "[m] 점심", kind: "expense", mainCategory: "식비", subCategory: "외식/배달", amount: 9_000, fromAccountId: "ACC-CARD" }],
    stockPresets: [],
    targetPortfolios: [{ id: "TP-0001", name: "[m] 기본", accountId: null, items: [{ ticker: "SCHD", weight: 50 }, { ticker: "458730", weight: 50 }] }],
    workoutWeeks: [
      { id: "W-0001", weekStart: "2026-08-02", entries: [{ id: "WD-0001", date: "2026-08-02", exercises: [{ id: "WE-0001", name: "[m] 스쿼트", bodyPart: "하체", sets: [{ weightKg: 60, reps: 8, done: true }] }] }] }
    ],
    workoutRoutines: [{ id: "WR-0001", name: "[m] 하체", exercises: [{ id: "WRE-0001", name: "[m] 스쿼트", bodyPart: "하체", targetSets: 3, targetReps: 8, targetWeightKg: 60 }] }],
    customExercises: [{ name: "[m] 케이블 로우", bodyPart: "등", addedAt: "2026-05-01T00:00:00.000Z" }],
    targetNetWorthCurve: { "2026-12-31": 100_000_000 },
    assetSnapshots: [
      { date: "2026-07-15", installmentSavings: 2_000_000, investmentBuyAmount: 1_000_000, investmentEvaluationAmount: 1_050_000, totalAssetEvaluationAmount: 3_050_000 },
      { date: "2026-08-01", installmentSavings: 2_100_000, investmentBuyAmount: 1_500_000, investmentEvaluationAmount: 1_480_000, totalAssetEvaluationAmount: 3_580_000 }
    ],
    marketEnvSnapshots: [],
    historicalDailyFx: [{ date: "2026-08-01", rate: 1_385.2 }],
    benchmarkDailyCloses: [{ ticker: "^KS11", date: "2026-08-01", close: 3_100.5 }],
    dividendTrackingTicker: "458730",
    isaPortfolio: [{ ticker: "458730", name: "[m] 배당ETF", weight: 100, label: "[m] 배당" }],
    investmentGoals: { annualDepositTarget: 12_000_000, finalTotalAssetTarget: 500_000_000, targetAnnualDividend: 1_200_000 },
    _exportedAt: "2026-08-10T12:21:01.559Z"
  };
}

/** 픽스처에서 마이그레이션이 kind/분류를 바꾸는 항목의 기대 합계 (테스트 단언용, 픽스처와 함께 유지) */
export function summarizeMaskedLegacyData(): MaskedFixtureSummary {
  const ledger = buildMaskedLegacyData().ledger as Array<Record<string, unknown>>;
  let legacyRecheckExpenseAmount = 0;
  let legacyDateIncomeCount = 0;
  for (const e of ledger) {
    const sub = String(e.subCategory ?? "");
    if (e.kind === "expense" && e.category === "재테크" && (sub === "저축" || sub === "투자")) {
      legacyRecheckExpenseAmount += Number(e.amount);
    }
    if (e.kind === "income" && e.category === "데이트비") legacyDateIncomeCount += 1;
  }
  return { legacyRecheckExpenseAmount, legacyDateIncomeCount };
}
