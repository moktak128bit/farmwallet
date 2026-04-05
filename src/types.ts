// --- Models ---

export type AccountType = "checking" | "savings" | "card" | "securities" | "crypto" | "other";

export interface Account {
  id: string;
  name: string;
  institution: string;
  type: AccountType;
  initialBalance: number;
  debt?: number;
  savings?: number;
  cashAdjustment?: number; // 증권계좌의 현금 조정 (기타)
  initialCashBalance?: number; // 증권계좌의 초기 현금 잔액
  currency?: "KRW" | "USD"; // 통화 (기본값: KRW)
  usdBalance?: number; // 증권계좌의 달러 보유량
  krwBalance?: number; // 증권계좌의 원화 보유량
  note?: string;
  /** 신용카드 청구주기 시작일 (1~31, 예: 13 = 매월 13일~익월 12일 구간) */
  billingCycleStart?: number;
  /** 신용카드 결제일 (1~31, 예: 25 = 매월 25일 결제) */
  paymentDay?: number;
}

export type LedgerKind = "income" | "expense" | "transfer";

export interface LedgerEntry {
  id: string;
  date: string; // ISO yyyy-mm-dd
  kind: LedgerKind;
  category: string;
  subCategory?: string;
  detailCategory?: string; // 소분류
  description: string;
  isFixedExpense?: boolean;
  fromAccountId?: string;
  toAccountId?: string;
  amount: number;
  currency?: "KRW" | "USD"; // 기본 KRW. 이체 시 달러 선택 가능
  /** 할인액(선택). amount는 항상 실제 반영 순액(금액−할인): 지출·수입 모두 동일. */
  discountAmount?: number;
  note?: string;
  tags?: string[]; // 태그 시스템
}

export type TradeSide = "buy" | "sell";

export interface StockTrade {
  id: string;
  date: string;
  accountId: string;
  ticker: string;
  name: string;
  side: TradeSide;
  quantity: number;
  price: number;
  fee: number;
  totalAmount: number; // quantity * price + fee (USD for US stocks)
  cashImpact: number; // buy: -totalAmount, sell: +totalAmount
  /** 매입 당시 환율 (USD 종목만, 매입가 원화 계산용) */
  fxRateAtTrade?: number;
}

export interface StockPrice {
  ticker: string;
  name?: string;
  price: number;
  currency?: string;
  change?: number;
  changePercent?: number;
  updatedAt?: string;
  /** Yahoo Finance sector (e.g. Technology, Financial Services) */
  sector?: string;
  /** Yahoo Finance industry */
  industry?: string;
}

/** 종목별 일별 종가 (매입 시점부터 자동 수집/저장) */
export interface HistoricalDailyClose {
  ticker: string;
  date: string; // yyyy-mm-dd
  close: number;
  currency?: string;
}

export type Recurrence = "monthly" | "weekly" | "yearly";

export interface RecurringExpense {
  id: string;
  title: string;
  amount: number;
  category: string;
  frequency: Recurrence;
  startDate: string; // yyyy-mm-dd
  endDate?: string;
  fromAccountId?: string;
  toAccountId?: string; // 입금계좌 (저축성지출/이체용)
}

export interface BudgetGoal {
  id: string;
  category: string;
  monthlyLimit: number;
  note?: string;
}

export interface SymbolInfo {
  ticker: string;
  name?: string;
}

export interface ExpenseDetailGroup {
  main: string;
  subs: string[];
}

export interface CategoryPresets {
  income: string[];
  expense: string[];
  expenseDetails?: ExpenseDetailGroup[];
  transfer: string[];
  categoryTypes?: {
    fixed?: string[];      // 고정지출 카테고리 목록
    savings?: string[];    // 저축성지출 카테고리 목록
    transfer?: string[];   // 이체 카테고리 목록
  };
}

export interface TickerInfo {
  ticker: string;
  name: string;
  market: "KR" | "US" | "CRYPTO";
  exchange?: string; // 'KOSPI' | 'KOSDAQ' | 'NYSE' | 'NASDAQ' 등
  lastUpdated?: string; // 마지막 업데이트 날짜
}

/** 목표 포트폴리오 한 종목 (비중 %) */
export interface TargetPortfolioItem {
  ticker: string;
  targetPercent: number;
  /** 그래프에 표시할 별칭 (선택) */
  alias?: string;
}

/** 목표 포트폴리오: 계좌별 또는 전체 */
export interface TargetPortfolio {
  id: string;
  name: string;
  /** null = 전체 기준, 값 있으면 해당 계좌만 */
  accountId: string | null;
  items: TargetPortfolioItem[];
  updatedAt?: string;
}

export interface StockPreset {
  id: string;
  name: string;
  accountId: string;
  ticker: string;
  stockName?: string;
  quantity?: number;
  fee?: number;
  lastUsed?: string; // 마지막 사용 날짜 (ISO yyyy-mm-dd)
}

export interface LedgerTemplate {
  id: string;
  name: string;
  kind: LedgerKind;
  mainCategory?: string;
  subCategory?: string;
  description?: string;
  amount?: number;
  fromAccountId?: string;
  toAccountId?: string;
  lastUsed?: string; // 마지막 사용 날짜 (ISO yyyy-mm-dd)
}

export type RepaymentMethod = "equal_payment" | "equal_principal" | "bullet";

export interface Loan {
  id: string;
  institution: string; // 기관명
  loanName: string; // 대출명
  /** 중분류 (학자금대출, 주담대원금, 주담대이자, 개인대출, 기타대출상환 등) */
  subCategory?: string;
  loanAmount: number; // 대출금액
  annualInterestRate: number; // 연이자율 (%)
  repaymentMethod: RepaymentMethod; // 상환방법
  loanDate: string; // 대출일 (yyyy-mm-dd)
  maturityDate: string; // 상환만기일 (yyyy-mm-dd)
  gracePeriodYears?: number; // 거치년도 (선택)
}

// 운동 기록 (주간: 일요일 Day1 → 월요일 휴식 → 화요일 Day2)
export interface WorkoutSet {
  weightKg: number;
  reps: number;
}

export type WorkoutBodyPart = "가슴" | "등" | "어깨" | "팔" | "하체" | "코어" | "유산소" | "기타";

export interface WorkoutExercise {
  id: string;
  name: string; // 벤치프레스, 스쿼트, RDL 등
  bodyPart?: WorkoutBodyPart;
  sets: WorkoutSet[];
  note?: string; // 상태, 실패 여부 등
}

export interface WorkoutDayEntry {
  id: string;
  date: string; // yyyy-mm-dd
  type: "workout" | "rest";
  dayLabel?: string; // "Day 1 (상체)", "Day 2 (하체)", "휴식"
  exercises?: WorkoutExercise[];
  cardio?: string; // "러닝 3km", "트레드밀 10분"
  restNotes?: string; // 휴식일: 수면, 근육통, 컨디션
}

export interface WorkoutWeek {
  id: string;
  weekStart: string; // 해당 주 일요일 yyyy-mm-dd
  entries: WorkoutDayEntry[];
}

// --- Calculation Results ---

export interface AccountBalanceRow {
  account: Account;
  incomeSum: number;
  expenseSum: number;
  transferNet: number;
  /** 이체로 인한 USD 순증액 (증권계좌 전용, currency=USD인 ledger 반영) */
  usdTransferNet: number;
  tradeCashImpact: number;
  currentBalance: number;
}

export interface PositionRow {
  accountId: string;
  accountName: string;
  ticker: string;
  name: string;
  quantity: number;
  avgPrice: number;
  totalBuyAmount: number;
  /** USD 종목 매입가 원화 (매입 당시 달러 × 매입 당시 환율). 없으면 표시 시 현재 환율로 환산 */
  totalBuyAmountKRW?: number;
  marketPrice: number;
  marketValue: number;
  /** marketPrice/marketValue가 계산된 통화 (USD면 화면에서 환산 필요) */
  marketCurrency?: "KRW" | "USD";
  pnl: number;
  pnlRate: number;
}

export interface MonthlyNetWorthRow {
  month: string; // yyyy-mm
  netWorth: number;
}

/** ISA 포트폴리오 한 종목 (목표 비중 %) */
export interface IsaPortfolioItem {
  ticker: string;
  name: string;
  weight: number;
  label: string;
}

/** Per-account breakdown stored with an asset snapshot point. */
export interface AssetSnapshotAccountBreakdown {
  accountId: string;
  accountName: string;
  buyAmount: number;
  evaluationAmount: number;
}

/** Half-month/daily asset snapshot row. */
export interface AssetSnapshotPoint {
  date: string; // yyyy-mm-dd
  installmentSavings?: number | null;
  termDeposit?: number | null;
  pensionPrincipal?: number | null;
  pensionEvaluation?: number | null;
  investmentBuyAmount?: number | null;
  investmentEvaluationAmount?: number | null;
  cryptoAssets?: number | null;
  dividendInterestCumulative?: number | null;
  totalAssetBuyAmount?: number | null;
  totalAssetEvaluationAmount?: number | null;
  investmentPerformance?: number | null;
  accountBreakdown?: AssetSnapshotAccountBreakdown[];
}

export interface AppData {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  prices: StockPrice[];
  categoryPresets: CategoryPresets;
  recurringExpenses: RecurringExpense[];
  budgetGoals: BudgetGoal[];
  customSymbols: SymbolInfo[];
  usTickers?: string[];
  tickerDatabase?: TickerInfo[]; // 티커 목록 데이터베이스
  ledgerTemplates?: LedgerTemplate[];
  stockPresets?: StockPreset[];
  targetPortfolios?: TargetPortfolio[];
  loans?: Loan[]; // 대출 목록
  workoutWeeks?: WorkoutWeek[];
  /** 목표 자산 곡선 (날짜별 목표 금액). 비어 있으면 date < CALC_START_DATE 구간은 0 표시 */
  targetNetWorthCurve?: Record<string, number>;
  /** 반월/일별 자산 스냅샷 시계열 */
  assetSnapshots?: AssetSnapshotPoint[];
  /** 종목별 일별 종가 (매입 시점부터 자동 수집/저장) */
  historicalDailyCloses?: HistoricalDailyClose[];
  /** 배당 추적 위젯에 표시할 티커. 비어 있으면 위젯 비활성화 또는 티커 선택 프롬프트 */
  dividendTrackingTicker?: string;
  /** ISA 목표 포트폴리오. 비어 있으면 config 기본값 사용 */
  isaPortfolio?: IsaPortfolioItem[];
}
