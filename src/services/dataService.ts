import type {
  AppData,
  AssetSnapshotAccountBreakdown,
  AssetSnapshotPoint,
  CategoryPresets,
  ExpenseDetailGroup,
  HistoricalDailyClose,
  IsaPortfolioItem
} from "../types";
import { STORAGE_KEYS, DEFAULT_US_TICKERS, ISA_PORTFOLIO, DATA_SCHEMA_VERSION } from "../constants/config";
import { DEFAULT_WORKOUT_ROUTINES } from "../data/defaultWorkoutRoutines";
import { buildTableBackupFile } from "../utils/tableDataBackup";
import { saveCacheToDB } from "./cacheStore";
import { getKoreanNameOverlay } from "./krNameResolver";
// krNames는 첫 loadData 호출 전에 preloadKrNames()로 미리 로드됨
let _krNames: Record<string, string> = {};

/** krNames.json(54KB)을 별도 청크로 분리해 필요 시 로드. storage.ts를 통해 재-export. */
export async function preloadKrNames(): Promise<void> {
  const mod = await import("../data/krNames.json");
  _krNames = mod.default as Record<string, string>;
}

/**
 * 현재 로드된 krNames 맵 반환 (정적 krNames.json + 런타임 overlay 병합).
 * overlay는 Naver 자동 조회/사용자 직접 입력 등으로 런타임에 발견된 한글명.
 */
export function getKrNames(): Record<string, string> {
  const overlay = getKoreanNameOverlay();
  // overlay가 우선, 없으면 정적 krNames 사용
  return Object.keys(overlay).length > 0 ? { ..._krNames, ...overlay } : _krNames;
}

function cleanTicker(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  return raw.toUpperCase().replace(/\.(KS|KQ|KO|K|KSQ)$/i, "");
}

function isKRWStock(ticker: string): boolean {
  if (!ticker) return false;
  return cleanTicker(ticker).length >= 6;
}

/** krNames에서 한글명 조회. 4~5자 티커는 6자리로 보정해 조회 (예: 23A0 → 0023A0) */
function getKrName(map: Record<string, string>, key: string): string | undefined {
  if (!key) return undefined;
  if (map[key]) return map[key];
  if (key.length >= 4 && key.length <= 5 && /^[0-9A-Z]+$/.test(key)) {
    const padded = key.padStart(6, "0");
    if (map[padded]) return map[padded];
  }
  return undefined;
}

/** 한국 종목 한글명 적용 대상 여부 (6자 이상 또는 4~5자로 krNames에 6자리 키로 있는 경우) */
function shouldApplyKrName(map: Record<string, string>, key: string): boolean {
  if (!key) return false;
  if (isKRWStock(key)) return true;
  if (key.length >= 4 && key.length <= 5 && /^[0-9A-Z]+$/.test(key) && map[key.padStart(6, "0")]) return true;
  return false;
}

/** 한국 종목의 영문 이름을 한글로 교체 (trades, prices, tickerDatabase, ledger 배당). { data, changed } 반환 */
export function applyKoreanStockNames(data: AppData): { data: AppData; changed: boolean } {
  // 런타임 오버레이(Naver 자동 조회 결과 등) + 정적 krNames.json 병합
  const map = getKrNames();
  let changed = false;

  const fixLedger = (ledger: AppData["ledger"]) => {
    if (!Array.isArray(ledger)) return ledger;
    const isDividend = (l: { kind?: string; category?: string; subCategory?: string; description?: string }) =>
      l?.kind === "income" &&
      ((l.category ?? "").includes("배당") ||
        (l.subCategory ?? "").includes("배당") ||
        (l.description ?? "").includes("배당"));
    return ledger.map((l) => {
      if (!isDividend(l) || !l.description) return l;
      const desc = l.description;
      // "485540 - English Name 배당" 또는 "0048J0 - English Name 배당, 세금: X원" → 한글이름으로 교체
      const match = desc.match(/^([0-9A-Z]{6})\s*-\s*(.+?)(\s+배당)/i);
      if (match) {
        const ticker = cleanTicker(match[1]);
        const oldName = match[2].trim();
        if (shouldApplyKrName(map, ticker)) {
          const krName = getKrName(map, ticker);
          if (krName && oldName !== krName) {
            changed = true;
            const newDesc = desc.replace(/^([0-9A-Z]{6})\s*-\s*(.+?)(\s+배당)/i, (_, t, _n, suffix) => `${t} - ${krName}${suffix}`);
            return { ...l, description: newDesc };
          }
        }
      }
      return l;
    });
  };

  // 사용자가 이미 한글명을 편집·저장한 경우 보존 (한글 문자가 포함돼 있으면 덮어쓰지 않음)
  const hasKoreanChars = (s: string | undefined | null): boolean =>
    !!s && /[가-힣]/.test(s);

  const fixTrades = (trades: AppData["trades"]) => {
    if (!Array.isArray(trades)) return trades;
    return trades.map((t) => {
      if (!t?.ticker) return t;
      const key = cleanTicker(t.ticker);
      if (!shouldApplyKrName(map, key)) return t;
      const krName = getKrName(map, key);
      if (!krName || t.name === krName) return t;
      if (hasKoreanChars(t.name)) return t; // 사용자 커스텀 한글명 보존
      changed = true;
      return { ...t, name: krName };
    });
  };

  const fixPrices = (prices: AppData["prices"]) => {
    if (!Array.isArray(prices)) return prices;
    return prices.map((p) => {
      if (!p?.ticker) return p;
      const key = cleanTicker(p.ticker);
      if (!shouldApplyKrName(map, key)) return p;
      const krName = getKrName(map, key);
      if (!krName || p.name === krName) return p;
      if (hasKoreanChars(p.name)) return p;
      changed = true;
      return { ...p, name: krName };
    });
  };

  const fixTickerDb = (db: AppData["tickerDatabase"]) => {
    if (!Array.isArray(db)) return db;
    return db.map((t) => {
      if (!t?.ticker || t.market !== "KR") return t;
      const key = cleanTicker(t.ticker);
      if (!shouldApplyKrName(map, key)) return t;
      const krName = getKrName(map, key);
      if (!krName || t.name === krName) return t;
      if (hasKoreanChars(t.name)) return t;
      changed = true;
      return { ...t, name: krName };
    });
  };

  const trades = fixTrades(data.trades);
  const prices = fixPrices(data.prices);
  const tickerDatabase = fixTickerDb(data.tickerDatabase);
  const ledger = fixLedger(data.ledger);

  if (!changed) return { data, changed: false };
  return { data: { ...data, trades, prices, tickerDatabase, ledger }, changed: true };
}

function getDefaultCategoryPresets(): CategoryPresets {
  const expenseDetails: ExpenseDetailGroup[] = [
    {
      main: "재테크",
      subs: ["저축", "투자", "투자수익", "투자손실"]
    },
    {
      main: "식비",
      subs: ["시장/마트", "외식/배달", "간식", "술/회식", "카페", "편의점", "기타식비"]
    },
    {
      main: "유류교통비",
      subs: [
        "버스/지하철",
        "택시",
        "유류비/충전비",
        "자동차용품",
        "수리비",
        "유지보수비",
        "톨비/하이패스",
        "주차비",
        "자동차보험",
        "자동차할부",
        "자동차세",
        "기차",
        "항공",
        "기타교통"
      ]
    },
    {
      main: "생활용품비",
      subs: ["가구/가전", "주방/욕실", "오피스/문구", "멤버십", "기타생활용품", "기타잡지출"]
    },
    {
      main: "데이트비",
      subs: ["식사", "카페", "이동", "숙박", "문화생활", "간식", "물건", "선물", "기타데이트"]
    },
    {
      main: "의류미용비",
      subs: ["의류", "패션잡화", "세탁비", "기타의류", "화장품", "미용실", "기타미용"]
    },
    {
      main: "교육비",
      subs: ["학교", "학원", "도서", "강의", "등록금", "헬스장", "운동", "자격증", "기타교육"]
    },
    {
      main: "문화생활비",
      subs: ["영화/관람", "여가", "여행", "OTT", "대관비", "기타문화생활"]
    },
    {
      main: "의료건강비",
      subs: ["병원", "의약품", "영양제", "보험료", "기타의료비"]
    },
    {
      main: "구독비",
      subs: [
        "유튜브",
        "넷플릭스",
        "쿠팡",
        "ChatGPT",
        "microsoft",
        "카카오톡서랍",
        "네이버",
        "토스프라임",
        "삼성케어플러스",
        "CursorAI"
      ]
    },
    {
      main: "통신비",
      subs: ["핸드폰", "인터넷", "IPTV", "우편/택배", "기타통신"]
    },
    {
      main: "경조사비",
      subs: ["축의금", "조의금", "생일", "기부금", "모임회비", "선물", "기타경조사"]
    },
    {
      main: "유흥오락비",
      subs: ["복권", "연금복권", "경마", "게임"]
    },
    {
      main: "주거비",
      subs: [
        "재산세",
        "월세",
        "주담대이자",
        "주담대원금",
        "관리비",
        "수도세",
        "전기세",
        "가스비",
        "기타주거비"
      ]
    },
    {
      main: "놀이",
      subs: ["피씨방", "노래방", "풋살비"]
    },
    {
      main: "대출",
      subs: ["학자금대출"]
    },
    {
      main: "대출상환",
      subs: ["학자금대출", "주담대원금", "주담대이자", "개인대출", "기타대출상환"]
    },
    {
      main: "실수",
      subs: ["아차차", "구독미스", "API 초과"]
    },
    {
      main: "신용카드",
      subs: ["카드대금"]
    }
  ];

  return {
    income: [
      "급여",
      "수당",
      "배당",
      "지역화폐",
      "정산",
      "상여",
      "투자수익",
      "이자",
      "부수익",
      "대출",
      "처분소득",
      "용돈",
      "지원",
      "기타수입"
    ],
    expense: expenseDetails.map((g) => g.main),
    expenseDetails,
    transfer: ["저축이체", "계좌이체", "카드결제이체"],
    categoryTypes: {
      fixed: ["주거비", "통신비", "구독비"],
      savings: ["재테크", "저축성지출"],
      transfer: ["저축이체", "계좌이체", "카드결제이체"]
    }
  };
}

function mergeCategoryPresets(
  fromStorage: AppData["categoryPresets"] | undefined,
  defaults: CategoryPresets
): CategoryPresets {
  if (!fromStorage) return defaults;

  const income = fromStorage.income && Array.isArray(fromStorage.income) && fromStorage.income.length > 0
    ? fromStorage.income
    : defaults.income;
  const transfer = fromStorage.transfer && Array.isArray(fromStorage.transfer) && fromStorage.transfer.length > 0
    ? fromStorage.transfer
    : defaults.transfer;
  const expenseDetails: ExpenseDetailGroup[] =
    fromStorage.expenseDetails && Array.isArray(fromStorage.expenseDetails) && fromStorage.expenseDetails.length > 0
      ? fromStorage.expenseDetails
      : (defaults.expenseDetails ?? []);
  const expense = expenseDetails.map((g) => g.main);
  const categoryTypes = fromStorage.categoryTypes ?? defaults.categoryTypes ?? {
    fixed: [],
    savings: [],
    transfer: defaults.transfer
  };

  return {
    income,
    expense,
    expenseDetails,
    transfer,
    categoryTypes
  };
}

function getDefaultIsaPortfolio(): IsaPortfolioItem[] {
  return ISA_PORTFOLIO.map((item) => ({
    ticker: item.ticker,
    name: item.name,
    weight: item.weight,
    label: item.label
  }));
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "-") return null;
    const normalized = trimmed.replace(/,/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeSnapshotAccountBreakdown(raw: unknown): AssetSnapshotAccountBreakdown[] {
  if (!Array.isArray(raw)) return [];
  const rows: AssetSnapshotAccountBreakdown[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const accountId = String(obj.accountId ?? "").trim();
    if (!accountId) continue;
    const accountName = String(obj.accountName ?? accountId).trim() || accountId;
    const buyAmount = toNullableNumber(obj.buyAmount);
    const evaluationAmount = toNullableNumber(obj.evaluationAmount);
    if (buyAmount == null || evaluationAmount == null) continue;
    rows.push({ accountId, accountName, buyAmount, evaluationAmount });
  }
  return rows;
}

function normalizeAssetSnapshots(raw: unknown): AssetSnapshotPoint[] {
  if (!Array.isArray(raw)) return [];
  const rows: AssetSnapshotPoint[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const dateRaw = String(obj.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) continue;

    rows.push({
      date: dateRaw,
      installmentSavings: toNullableNumber(obj.installmentSavings),
      termDeposit: toNullableNumber(obj.termDeposit),
      pensionPrincipal: toNullableNumber(obj.pensionPrincipal),
      pensionEvaluation: toNullableNumber(obj.pensionEvaluation),
      investmentBuyAmount: toNullableNumber(obj.investmentBuyAmount),
      investmentEvaluationAmount: toNullableNumber(obj.investmentEvaluationAmount),
      cryptoAssets: toNullableNumber(obj.cryptoAssets),
      dividendInterestCumulative: toNullableNumber(obj.dividendInterestCumulative),
      totalAssetBuyAmount: toNullableNumber(obj.totalAssetBuyAmount),
      totalAssetEvaluationAmount: toNullableNumber(obj.totalAssetEvaluationAmount),
      investmentPerformance: toNullableNumber(obj.investmentPerformance),
      accountBreakdown: normalizeSnapshotAccountBreakdown(obj.accountBreakdown)
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

function normalizeHistoricalDailyCloses(raw: unknown): HistoricalDailyClose[] {
  if (!Array.isArray(raw)) return [];
  const rows: HistoricalDailyClose[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const ticker = String(obj.ticker ?? "").trim();
    const date = String(obj.date ?? "").trim();
    const close = toNullableNumber(obj.close);
    if (!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(date) || close == null || !Number.isFinite(close)) continue;
    rows.push({
      ticker: ticker.toUpperCase(),
      date,
      close,
      currency: typeof obj.currency === "string" ? obj.currency : undefined
    });
  }
  return rows;
}

/** 초기 로딩/빈 상태용 기본 데이터 (로딩 UI 표시 시 훅에 넘기기 위해 사용) */
export function getEmptyData(): AppData {
  const defaults = getDefaultCategoryPresets();
  return {
    loans: [],
    accounts: [],
    ledger: [],
    trades: [],
    prices: [],
    categoryPresets: defaults,
    recurringExpenses: [],
    budgetGoals: [],
    customSymbols: [],
    usTickers: [...DEFAULT_US_TICKERS],
    tickerDatabase: [],
    ledgerTemplates: [],
    stockPresets: [],
    targetPortfolios: [],
    workoutWeeks: [],
    workoutRoutines: [...DEFAULT_WORKOUT_ROUTINES],
    customExercises: [],
    targetNetWorthCurve: {},
    assetSnapshots: [],
    historicalDailyCloses: [],
    dividendTrackingTicker: "458730",
    isaPortfolio: getDefaultIsaPortfolio()
  };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readStoredSchemaVersion(): number {
  if (typeof window === "undefined") return DATA_SCHEMA_VERSION;
  const raw = window.localStorage.getItem(STORAGE_KEYS.DATA_SCHEMA_VERSION);
  if (!raw) return 1;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function writeStoredSchemaVersion(version: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEYS.DATA_SCHEMA_VERSION, String(version));
}

function migrateBySchema(
  source: Record<string, unknown>,
  fromVersion: number
): { data: Record<string, unknown>; migrated: boolean } {
  let migrated = false;
  const next = { ...source };

  if (fromVersion < 2) {
    const recurringExpenses = asArray(next.recurringExpenses);
    if (recurringExpenses.length === 0 && Array.isArray(next.recurring)) {
      next.recurringExpenses = next.recurring;
      migrated = true;
    }

    const budgetGoals = asArray(next.budgetGoals);
    if (budgetGoals.length === 0 && Array.isArray(next.budgets)) {
      next.budgetGoals = next.budgets;
      migrated = true;
    }

    const customSymbols = asArray(next.customSymbols);
    if (customSymbols.length === 0 && Array.isArray(next.symbols)) {
      next.customSymbols = next.symbols;
      migrated = true;
    }

    const stockPresets = asArray(next.stockPresets);
    if (stockPresets.length === 0 && Array.isArray(next.presets)) {
      next.stockPresets = next.presets;
      migrated = true;
    }
  }

  // v3: 지출 amount를 순액으로 통일 (기존: 할인이 있으면 amount=할인 전 총액, 계산 시 amount−discount)
  if (fromVersion < 3) {
    const ledger = asArray<Record<string, unknown>>(next.ledger);
    next.ledger = ledger.map((entry) => {
      if (!entry || typeof entry !== "object" || entry.kind !== "expense") return entry;
      const dRaw = entry.discountAmount;
      const disc = typeof dRaw === "number" ? dRaw : Number(dRaw);
      if (!Number.isFinite(disc) || disc <= 0) return entry;
      const grossRaw = entry.amount;
      const gross = typeof grossRaw === "number" ? grossRaw : Number(grossRaw);
      if (!Number.isFinite(gross) || gross <= 0) return entry;
      const net = gross - disc;
      if (net <= 0) return entry;
      return { ...entry, amount: net };
    });
    migrated = true;
  }

  return { data: next, migrated };
}

export function normalizeImportedData(rawData: unknown): AppData {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    throw new Error("Invalid backup format");
  }

  if (typeof window === "undefined") {
    return getEmptyData();
  }

  const serialized = JSON.stringify(rawData);
  const previousRaw = window.localStorage.getItem(STORAGE_KEYS.DATA);
  const previousSchemaVersion = window.localStorage.getItem(STORAGE_KEYS.DATA_SCHEMA_VERSION);

  try {
    window.localStorage.setItem(STORAGE_KEYS.DATA, serialized);
    writeStoredSchemaVersion(DATA_SCHEMA_VERSION);
    return loadData();
  } finally {
    if (previousRaw == null) {
      window.localStorage.removeItem(STORAGE_KEYS.DATA);
    } else {
      window.localStorage.setItem(STORAGE_KEYS.DATA, previousRaw);
    }
    if (previousSchemaVersion == null) {
      window.localStorage.removeItem(STORAGE_KEYS.DATA_SCHEMA_VERSION);
    } else {
      window.localStorage.setItem(STORAGE_KEYS.DATA_SCHEMA_VERSION, previousSchemaVersion);
    }
  }
}

export function loadData(): AppData {
  const emptyData = getEmptyData();
  const defaults = getDefaultCategoryPresets();

  if (typeof window === "undefined") {
    return emptyData;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.DATA);
    if (!raw) {
      return emptyData;
    }
    const parsedUnknown = JSON.parse(raw) as unknown;
    const parsedObject = asObject(parsedUnknown);
    const schemaVersion = readStoredSchemaVersion();
    const migratedBySchema = migrateBySchema(parsedObject, schemaVersion);
    const parsed = migratedBySchema.data as Partial<AppData>;
    const schemaVersionChanged = migratedBySchema.migrated || schemaVersion !== DATA_SCHEMA_VERSION;
    const parsedLoans = asArray(parsed.loans) as NonNullable<AppData["loans"]>;
    const parsedAccounts = asArray(parsed.accounts) as AppData["accounts"];
    const parsedLedger = asArray(parsed.ledger) as AppData["ledger"];
    const parsedTrades = asArray(parsed.trades) as AppData["trades"];
    const parsedRecurring = asArray(parsed.recurringExpenses) as AppData["recurringExpenses"];
    const parsedBudgetGoals = asArray(parsed.budgetGoals) as AppData["budgetGoals"];
    const parsedCustomSymbols = asArray(parsed.customSymbols) as AppData["customSymbols"];
    const parsedLedgerTemplates = asArray(parsed.ledgerTemplates) as NonNullable<AppData["ledgerTemplates"]>;
    const parsedStockPresets = asArray(parsed.stockPresets) as NonNullable<AppData["stockPresets"]>;
    const parsedTargetPortfolios = asArray(parsed.targetPortfolios) as NonNullable<AppData["targetPortfolios"]>;
    const parsedWorkoutWeeks = asArray(parsed.workoutWeeks) as NonNullable<AppData["workoutWeeks"]>;
    const parsedWorkoutRoutinesRaw = asArray(parsed.workoutRoutines) as NonNullable<AppData["workoutRoutines"]>;
    // 시드 주입 정책: 기존 사용자의 편집을 절대 덮어쓰지 않는다.
    // 저장값이 비어 있을 때만 DEFAULT_WORKOUT_ROUTINES 를 주입.
    const parsedWorkoutRoutines =
      parsedWorkoutRoutinesRaw.length > 0 ? parsedWorkoutRoutinesRaw : [...DEFAULT_WORKOUT_ROUTINES];
    const parsedCustomExercises = asArray(parsed.customExercises) as NonNullable<AppData["customExercises"]>;
    const parsedIsaPortfolio = asArray(parsed.isaPortfolio) as NonNullable<AppData["isaPortfolio"]>;

    // 캐시 분리 키에서 로드, 없으면 메인 키의 값으로 마이그레이션
    const cache = loadCacheData();
    const mainPrices = asArray(parsed.prices) as AppData["prices"];
    const mainTickerDb = asArray(parsed.tickerDatabase) as NonNullable<AppData["tickerDatabase"]>;
    const mainHistorical = asArray(parsed.historicalDailyCloses);
    // 캐시 키가 비어 있고 메인 키에 데이터가 있으면 마이그레이션 필요
    const needsCacheMigration =
      cache.prices.length === 0 && cache.tickerDatabase.length === 0 && cache.historicalDailyCloses.length === 0 &&
      (mainPrices.length > 0 || mainTickerDb.length > 0 || mainHistorical.length > 0);
    const effectivePrices = cache.prices.length > 0 ? cache.prices : mainPrices;
    const effectiveTickerDatabase = cache.tickerDatabase.length > 0 ? cache.tickerDatabase : mainTickerDb;
    const effectiveHistoricalDailyCloses = cache.historicalDailyCloses.length > 0
      ? cache.historicalDailyCloses
      : normalizeHistoricalDailyCloses(mainHistorical);
    const normalizedTargetCurveRaw = asObject(parsed.targetNetWorthCurve);
    const normalizedTargetCurve: Record<string, number> = {};
    for (const [date, value] of Object.entries(normalizedTargetCurveRaw)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        normalizedTargetCurve[date] = value;
      }
    }
    const parsedData: AppData = {
      loans: parsedLoans,
      accounts: parsedAccounts.map((a) => {
        const debtValue = typeof a.debt === "number" ? a.debt : Number(a.debt ?? 0) || 0;
        return {
          ...a,
          debt: debtValue,
          savings: a.savings ?? 0
        };
      }),
      ledger: parsedLedger,
      trades: parsedTrades,
      prices: effectivePrices,
      categoryPresets: mergeCategoryPresets(parsed.categoryPresets, defaults),
      recurringExpenses: parsedRecurring,
      budgetGoals: parsedBudgetGoals,
      customSymbols: parsedCustomSymbols,
      usTickers: asArray<string>(parsed.usTickers).length > 0 ? [...asArray<string>(parsed.usTickers)] : [...DEFAULT_US_TICKERS],
      tickerDatabase: effectiveTickerDatabase,
      ledgerTemplates: parsedLedgerTemplates,
      stockPresets: parsedStockPresets,
      targetPortfolios: parsedTargetPortfolios,
      workoutWeeks: parsedWorkoutWeeks,
      workoutRoutines: parsedWorkoutRoutines,
      customExercises: parsedCustomExercises,
      targetNetWorthCurve: normalizedTargetCurve,
      assetSnapshots: normalizeAssetSnapshots(parsed.assetSnapshots),
      historicalDailyCloses: effectiveHistoricalDailyCloses,
      dividendTrackingTicker: parsed.dividendTrackingTicker !== undefined && parsed.dividendTrackingTicker !== null ? String(parsed.dividendTrackingTicker) : "458730",
      isaPortfolio: parsedIsaPortfolio.length > 0 ? parsedIsaPortfolio : getDefaultIsaPortfolio()
    };
    // krNames는 idle 시간에 비동기 로드되므로, 여기서는 빈 맵일 수 있음.
    // 실제 한글명 적용은 useAppData의 idle 콜백에서 수행.
    const { data: dataWithKrNames, changed: krNamesChanged } = applyKoreanStockNames(parsedData);

    // 사용자의 계좌·가계부·거래 원본을 그대로 보존. 임시/일회성 마이그레이션은 모두 제거됨.
    const finalData: AppData = dataWithKrNames;

    if (
      schemaVersionChanged ||
      krNamesChanged ||
      needsCacheMigration
    ) {
      try {
        saveData(finalData);
        writeStoredSchemaVersion(DATA_SCHEMA_VERSION);
      } catch (saveError) {
        // Migration persistence failure (e.g., localStorage quota) should not block app load.
        console.warn("[FarmWallet] loadData migration save skipped", saveError);
      }
    }
    return finalData;
  } catch (e) {
    console.error("[FarmWallet] loadData failed", e);
    throw e;
  }
}

// =========================================
//  API 캐시 분리 저장 (prices, tickerDatabase, historicalDailyCloses)
// =========================================

interface CacheData {
  prices: AppData["prices"];
  tickerDatabase: NonNullable<AppData["tickerDatabase"]>;
  historicalDailyCloses: NonNullable<AppData["historicalDailyCloses"]>;
}

function loadCacheData(): CacheData {
  const empty: CacheData = { prices: [], tickerDatabase: [], historicalDailyCloses: [] };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.CACHE);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<CacheData>;
    return {
      prices: Array.isArray(parsed.prices) ? (parsed.prices as AppData["prices"]) : [],
      tickerDatabase: Array.isArray(parsed.tickerDatabase) ? (parsed.tickerDatabase as NonNullable<AppData["tickerDatabase"]>) : [],
      historicalDailyCloses: Array.isArray(parsed.historicalDailyCloses) ? (parsed.historicalDailyCloses as NonNullable<AppData["historicalDailyCloses"]>) : [],
    };
  } catch {
    return empty;
  }
}

function saveCacheData(cache: CacheData): void {
  if (typeof window === "undefined") return;
  // IndexedDB에 비동기 저장 (quota 여유 있음). 실패 시 localStorage fallback.
  // Fire-and-forget — 저장 지연이 UI를 막지 않도록.
  void saveCacheToDB(cache);
  try {
    // localStorage에도 작성 (기존 데이터 호환 + IndexedDB 미지원 브라우저 대비)
    // quota 초과 시 silently 무시 — IndexedDB가 소스 오브 트루스.
    window.localStorage.setItem(STORAGE_KEYS.CACHE, JSON.stringify(cache));
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      // quota 초과는 예상된 상황 — IndexedDB가 있으니 조용히 skip
      try {
        window.localStorage.removeItem(STORAGE_KEYS.CACHE);
      } catch {
        /* ignore */
      }
    } else {
      console.warn("[FarmWallet] cache save to localStorage failed", e);
    }
  }
}

/**
 * Gist 저장 전용: prices, tickerDatabase, historicalDailyCloses 제외한 사용자 데이터만 JSON으로 반환.
 * API로 재수집 가능한 캐시는 Gist에 포함하지 않아 동기화 속도를 높이고 용량을 줄임.
 */
export function toUserDataJson(data: AppData): string {
  const { prices: _p, tickerDatabase: _t, historicalDailyCloses: _h, ...userData } = data;
  return JSON.stringify(userData);
}

const SAVE_RETRY_COUNT = 2;

export function saveDataSerialized(serialized: string): void {
  if (typeof window === "undefined") return;

  // 전체 데이터를 user 데이터와 API 캐시로 분리
  let fullData: AppData;
  let userDataStr: string;
  let cacheToSave: CacheData;
  try {
    fullData = JSON.parse(serialized) as AppData;
    const { prices, tickerDatabase, historicalDailyCloses, ...userFields } = fullData;
    userDataStr = JSON.stringify(userFields);
    cacheToSave = {
      prices: Array.isArray(prices) ? prices : [],
      tickerDatabase: Array.isArray(tickerDatabase) ? tickerDatabase : [],
      historicalDailyCloses: Array.isArray(historicalDailyCloses) ? historicalDailyCloses : [],
    };
  } catch {
    // 파싱 실패 시 원본 그대로 저장 (안전 폴백)
    userDataStr = serialized;
    fullData = {} as AppData;
    cacheToSave = { prices: [], tickerDatabase: [], historicalDailyCloses: [] };
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt <= SAVE_RETRY_COUNT; attempt++) {
    try {
      // 사용자 데이터만 메인 키에 저장 (캐시 제외 → 용량 절감)
      window.localStorage.setItem(STORAGE_KEYS.DATA, userDataStr);
      writeStoredSchemaVersion(DATA_SCHEMA_VERSION);

      // API 캐시는 별도 키에 저장 (실패해도 앱 동작에 영향 없음)
      saveCacheData(cacheToSave);

      // 테이블 백업은 localStorage용으로만 유지 (내보내기/가져오기 기능에서 사용)
      try {
        const tableFile = buildTableBackupFile(fullData);
        const tableStr = JSON.stringify(tableFile);
        try {
          window.localStorage.setItem(STORAGE_KEYS.DATA_TABLE_BACKUP, tableStr);
        } catch (lsErr) {
          console.warn("[FarmWallet] table backup localStorage skipped", lsErr);
        }
      } catch (tableErr) {
        console.warn("[FarmWallet] table backup build failed", tableErr);
      }

      // 통합 사용자 데이터 파일 동기화 (dev 서버: data/farmwallet-data.json에 기록)
      // 캐시(prices/tickerDatabase/historicalDailyCloses)는 제외, _exportedAt 포함
      try {
        const userFieldsWithMeta = { ...JSON.parse(userDataStr), _exportedAt: new Date().toISOString() };
        void fetch("/api/farmwallet-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(userFieldsWithMeta)
        }).catch(() => {});
      } catch (syncErr) {
        console.warn("[FarmWallet] farmwallet-data sync failed", syncErr);
      }
      return;
    } catch (e) {
      lastErr = e;
      if (attempt === SAVE_RETRY_COUNT) break;
    }
  }
  const message = lastErr instanceof DOMException && lastErr.name === "QuotaExceededError"
    ? "저장 공간이 부족합니다. 오래된 백업을 지우거나 데이터를 줄여 주세요."
    : lastErr instanceof Error
      ? lastErr.message
      : "저장에 실패했습니다.";
  throw new Error(message);
}

export function saveData(data: AppData): void {
  saveDataSerialized(JSON.stringify(data));
}
