export type AccountType = "checking" | "savings" | "card" | "securities" | "other";

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
  note?: string;
}

export type LedgerKind = "income" | "expense" | "transfer";

export interface LedgerEntry {
  id: string;
  date: string; // ISO yyyy-mm-dd
  kind: LedgerKind;
  category: string;
  subCategory?: string;
  description: string;
  isFixedExpense?: boolean;
  fromAccountId?: string;
  toAccountId?: string;
  amount: number;
  note?: string;
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
  totalAmount: number; // quantity * price + fee
  cashImpact: number; // buy: -totalAmount, sell: +totalAmount
}

export interface StockPrice {
  ticker: string;
  name?: string;
  price: number;
  currency?: string;
  change?: number;
  changePercent?: number;
  updatedAt?: string;
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
  note?: string;
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
}

export interface TickerInfo {
  ticker: string;
  name: string;
  market: "KR" | "US";
  exchange?: string; // 'KOSPI' | 'KOSDAQ' | 'NYSE' | 'NASDAQ' 등
  lastUpdated?: string; // 마지막 업데이트 날짜
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
  loanAmount: number; // 대출금액
  annualInterestRate: number; // 연이자율 (%)
  repaymentMethod: RepaymentMethod; // 상환방법
  loanDate: string; // 대출일 (yyyy-mm-dd)
  maturityDate: string; // 상환만기일 (yyyy-mm-dd)
  gracePeriodYears?: number; // 거치년도 (선택)
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
  loans?: Loan[]; // 대출 목록
}
