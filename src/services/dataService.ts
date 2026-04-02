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
import { normalizeCategory, normalizeSubCategory } from "../utils/category";
import { buildTableBackupFile } from "../utils/tableDataBackup";
// krNames는 첫 loadData 호출 전에 preloadKrNames()로 미리 로드됨
let _krNames: Record<string, string> = {};

/** krNames.json(54KB)을 별도 청크로 분리해 필요 시 로드. storage.ts를 통해 재-export. */
export async function preloadKrNames(): Promise<void> {
  const mod = await import("../data/krNames.json");
  _krNames = mod.default as Record<string, string>;
}

/** 현재 로드된 krNames 맵 반환. preloadKrNames() 완료 전엔 빈 객체. */
export function getKrNames(): Record<string, string> {
  return _krNames;
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
function applyKoreanStockNames(data: AppData): { data: AppData; changed: boolean } {
  const map = _krNames;
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

  const fixTrades = (trades: AppData["trades"]) => {
    if (!Array.isArray(trades)) return trades;
    return trades.map((t) => {
      if (!t?.ticker) return t;
      const key = cleanTicker(t.ticker);
      if (!shouldApplyKrName(map, key)) return t;
      const krName = getKrName(map, key);
      if (!krName || t.name === krName) return t;
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
      subs: ["시장/마트", "외식/배달", "간식", "술/회식", "커피숍", "편의점", "기타식비"]
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
      "이월",
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

  let expenseDetails: ExpenseDetailGroup[];
  if (fromStorage.expenseDetails && Array.isArray(fromStorage.expenseDetails) && fromStorage.expenseDetails.length > 0) {
    expenseDetails = fromStorage.expenseDetails;
  } else {
    expenseDetails = defaults.expenseDetails ?? [];
  }

  // 항목 매트릭스: 저축성지출 제거, 재테크는 저축/투자/투자수익/투자손실로 전이
  expenseDetails = expenseDetails.filter((g) => g.main !== "저축성지출");
  const hasRecheck = expenseDetails.some((g) => g.main === "재테크");
  const recheckSubsBase = ["저축", "투자", "투자수익", "투자손실"];
  expenseDetails = expenseDetails.map((g) => {
    if (g.main !== "재테크") return g;
    const existing = g.subs ?? [];
    const merged = [...new Set([...existing, "투자수익", "투자손실"])];
    return { main: "재테크", subs: merged.sort((a, b) => recheckSubsBase.indexOf(a) - recheckSubsBase.indexOf(b) || a.localeCompare(b)) };
  });
  if (!hasRecheck) {
    expenseDetails = [{ main: "재테크", subs: recheckSubsBase }, ...expenseDetails];
  }
  const expense = expenseDetails.map((g) => g.main);

  // categoryTypes 마이그레이션: 기존 데이터에 없으면 기본값 사용
  let categoryTypes = fromStorage.categoryTypes || defaults.categoryTypes || {
    fixed: ["주거비", "통신비", "구독비"],
    savings: ["재테크", "저축성지출"],
    transfer: defaults.transfer
  };
  // 재테크는 항상 저축성지출(고정지출·변동지출 아님): savings에 포함, fixed에서 제외
  const savingsList = [...new Set([...(categoryTypes.savings ?? []), "재테크"])];
  const fixedList = (categoryTypes.fixed ?? []).filter((c) => c !== "재테크");
  categoryTypes = {
    ...categoryTypes,
    savings: savingsList,
    fixed: fixedList
  };

  return {
    income,
    expense,
    expenseDetails,
    transfer,
    categoryTypes
  };
}

// 깨진 카테고리 이름을 올바른 이름으로 수정하는 함수
function fixCorruptedCategoryNames(ledger: AppData["ledger"]): AppData["ledger"] {
  return ledger.map((entry) => {
    const fixedCategory = entry.category ? normalizeCategory(entry.category) : entry.category;
    const fixedSubCategory = entry.subCategory ? normalizeSubCategory(entry.subCategory) : entry.subCategory;

    // 변경사항이 있으면 새 객체 반환
    if (fixedCategory !== entry.category || fixedSubCategory !== entry.subCategory) {
      return {
        ...entry,
        category: fixedCategory,
        subCategory: fixedSubCategory
      };
    }

    return entry;
  });
}

/**
 * 기존 대출/빚(category=대출, subCategory=빚) → 대출상환/중분류로 마이그레이션
 */
function migrateLoanRepaymentTo대출상환(ledger: AppData["ledger"]): AppData["ledger"] {
  return ledger.map((entry) => {
    if (entry.kind !== "expense" || entry.category !== "대출" || entry.subCategory !== "빚") {
      return entry;
    }
    const desc = (entry.description || "").toLowerCase();
    let sub = "기타대출상환";
    if (/학자금|등록금/.test(desc)) sub = "학자금대출";
    else if (/주담대|주택담보|주택대출/.test(desc) && /이자|금리/.test(desc)) sub = "주담대이자";
    else if (/주담대|주택담보|주택대출/.test(desc)) sub = "주담대원금";
    else if (/개인|신용대출|신용 loan/i.test(desc)) sub = "개인대출";
    return { ...entry, category: "대출상환", subCategory: sub };
  });
}

/**
 * 이체(kind=transfer)로 잘못 저장된 저축성 지출 → 지출(expense)로 일괄 수정.
 * 저축성 지출 = 지출의 한 종류이므로 kind는 "expense"만 허용.
 */
function migrateSavingsExpenseFromTransfer(
  ledger: AppData["ledger"],
  categoryPresets: CategoryPresets
): AppData["ledger"] {
  const savingsCategories = categoryPresets.categoryTypes?.savings ?? ["저축성지출"];
  return ledger.map((entry) => {
    if (entry.kind !== "transfer") return entry;
    if (!entry.category || !savingsCategories.includes(entry.category)) return entry;
    return {
      ...entry,
      kind: "expense" as const,
      category: entry.category
    };
  });
}

/** ISA 포트폴리오 기본값 (config 기반) */
function normalizeExpenseSourceAccounts(
  ledger: AppData["ledger"],
  accounts: AppData["accounts"]
): AppData["ledger"] {
  const samsungCardId = accounts.find(
    (a) => a.id === "\uC0BC\uC131\uD398\uC774\uCE74\uB4DC" || a.name === "\uC0BC\uC131\uD398\uC774\uCE74\uB4DC"
  )?.id;
  const nhBankId = accounts.find(
    (a) => a.id === "\uB18D\uD611" || a.name === "\uB18D\uD611"
  )?.id;
  const localPayId = accounts.find(
    (a) => a.id === "\uC9C0\uC5ED\uD398\uC774" || a.name === "\uC9C0\uC5ED\uD398\uC774"
  )?.id;
  const kakaoPayId = accounts.find(
    (a) => a.id === "\uCE74\uCE74\uC624\uD398\uC774" || a.name === "\uCE74\uCE74\uC624\uD398\uC774"
  )?.id;
  const regionalPayTargetId = localPayId ?? kakaoPayId;

  if (!samsungCardId && !nhBankId && !regionalPayTargetId) return ledger;

  return ledger.map((entry) => {
    const source = (entry.fromAccountId ?? "").trim();
    if (!source) return entry;

    const normalizedSource = source.replace(/\ufffd/g, "");
    const isCreditCardSource =
      normalizedSource === "\uC2E0\uC6A9\uCE74\uB4DC" || normalizedSource === "\uC2E0\uCE74\uB4DC";
    const isBankSource =
      normalizedSource === "\uCCB4\uD06C\uCE74\uB4DC" || normalizedSource === "\uACC4\uC88C\uC774\uCCB4";
    const isRegionalPaySource =
      normalizedSource === "\uC9C0\uC5ED\uCE74\uB4DC" || normalizedSource.endsWith("\uC5ED\uCE74\uB4DC");

    if (isCreditCardSource && samsungCardId && entry.fromAccountId !== samsungCardId) {
      return { ...entry, fromAccountId: samsungCardId };
    }
    if (isBankSource && nhBankId && entry.fromAccountId !== nhBankId) {
      return { ...entry, fromAccountId: nhBankId };
    }
    if (isRegionalPaySource && regionalPayTargetId && entry.fromAccountId !== regionalPayTargetId) {
      return { ...entry, fromAccountId: regionalPayTargetId };
    }
    return entry;
  });
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

function normalizeSecuritiesOpeningCashAndInitialBuys(
  accounts: AppData["accounts"],
  trades: AppData["trades"]
): { accounts: AppData["accounts"]; trades: AppData["trades"]; changed: boolean } {
  const EPS = 0.000001;
  let changed = false;

  const nextAccounts = [...accounts];
  const nextTrades = [...trades];
  const zeroCashBuyIndicesByAccount = new Map<string, number[]>();
  const zeroCashBuyTotalByAccount = new Map<string, number>();
  const hasUsdTickerTradeByAccount = new Map<string, boolean>();

  for (let i = 0; i < nextTrades.length; i += 1) {
    const trade = nextTrades[i];
    if (!trade?.accountId) continue;

    if (cleanTicker(trade.ticker ?? "").length <= 4) {
      hasUsdTickerTradeByAccount.set(trade.accountId, true);
    }

    if (trade.side !== "buy") continue;
    const cashImpact = Number(trade.cashImpact ?? 0);
    if (!Number.isFinite(cashImpact) || Math.abs(cashImpact) > EPS) continue;

    const totalAmount = Number(trade.totalAmount ?? 0);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) continue;

    const list = zeroCashBuyIndicesByAccount.get(trade.accountId) ?? [];
    list.push(i);
    zeroCashBuyIndicesByAccount.set(trade.accountId, list);
    zeroCashBuyTotalByAccount.set(
      trade.accountId,
      (zeroCashBuyTotalByAccount.get(trade.accountId) ?? 0) + totalAmount
    );
  }

  for (let accountIndex = 0; accountIndex < nextAccounts.length; accountIndex += 1) {
    const account = nextAccounts[accountIndex];
    if (account.type !== "securities" && account.type !== "crypto") continue;
    if (hasUsdTickerTradeByAccount.get(account.id)) continue;

    const openingCash = Number(
      account.initialCashBalance ?? account.initialBalance ?? 0
    );
    if (!Number.isFinite(openingCash) || openingCash >= -EPS) continue;

    const zeroCashBuyIndices = zeroCashBuyIndicesByAccount.get(account.id) ?? [];
    if (zeroCashBuyIndices.length === 0) continue;

    const zeroCashBuyTotal = zeroCashBuyTotalByAccount.get(account.id) ?? 0;
    if (!Number.isFinite(zeroCashBuyTotal) || zeroCashBuyTotal <= 0) continue;

    const absOpening = Math.abs(openingCash);
    const coverage = absOpening > EPS ? zeroCashBuyTotal / absOpening : 0;
    const nextOpeningCash = openingCash + zeroCashBuyTotal;
    const isLikelyOffsetPattern =
      coverage >= 0.8 &&
      Math.abs(nextOpeningCash) <= Math.max(500000, absOpening * 0.25);
    if (!isLikelyOffsetPattern) continue;

    if ((account.initialCashBalance ?? account.initialBalance ?? 0) !== nextOpeningCash) {
      nextAccounts[accountIndex] = {
        ...account,
        initialCashBalance: nextOpeningCash
      };
      changed = true;
    }

    for (const tradeIndex of zeroCashBuyIndices) {
      const trade = nextTrades[tradeIndex];
      if (!trade || trade.side !== "buy") continue;
      const totalAmount = Number(trade.totalAmount ?? 0);
      if (!Number.isFinite(totalAmount) || totalAmount <= 0) continue;
      const nextCashImpact = -totalAmount;
      if (trade.cashImpact !== nextCashImpact) {
        nextTrades[tradeIndex] = {
          ...trade,
          cashImpact: nextCashImpact
        };
        changed = true;
      }
    }
  }

  return {
    accounts: nextAccounts,
    trades: nextTrades,
    changed
  };
}

/**
 * 증권계좌 KRW 거래의 cashImpact 보정 → 계좌 현금·자산에 매수/매도 반영.
 * - 매도: cashImpact = totalAmount (매도 대금)
 * - 매수: cashImpact = -totalAmount (매수 대금 차감)
 * cashImpact가 없거나 0인 KRW 건만 채움 (USD 종목은 cashImpact 0 유지).
 */
function normalizeSecuritiesKrwTradeCashImpact(
  accounts: AppData["accounts"],
  trades: AppData["trades"]
): { trades: AppData["trades"]; changed: boolean } {
  const EPS = 0.000001;
  const securitiesIds = new Set(
    accounts.filter((a) => a.type === "securities" || a.type === "crypto").map((a) => a.id)
  );
  let changed = false;
  const nextTrades = trades.map((t) => {
    if (!t?.accountId || !securitiesIds.has(t.accountId)) return t;
    if (!isKRWStock(t.ticker ?? "")) return t;
    const impact = Number(t.cashImpact ?? 0);
    if (Number.isFinite(impact) && Math.abs(impact) > EPS) return t;
    const total = Number(t.totalAmount ?? 0);
    if (!Number.isFinite(total)) return t;
    const nextImpact = t.side === "sell" ? total : -total;
    changed = true;
    return { ...t, cashImpact: nextImpact };
  });
  return { trades: nextTrades, changed };
}

function normalizeUsdTradeCashImpactForKrwSecurities(
  accounts: AppData["accounts"],
  ledger: AppData["ledger"],
  trades: AppData["trades"]
): { accounts: AppData["accounts"]; trades: AppData["trades"]; changed: boolean } {
  const EPS = 0.000001;
  let changed = false;

  const nextAccounts = [...accounts];
  const nextTrades = [...trades];

  const hasUsdTransferByAccount = new Set<string>();
  for (const entry of ledger) {
    if (entry.kind !== "transfer" || entry.currency !== "USD") continue;
    if (entry.fromAccountId) hasUsdTransferByAccount.add(entry.fromAccountId);
    if (entry.toAccountId) hasUsdTransferByAccount.add(entry.toAccountId);
  }

  for (const account of nextAccounts) {
    if (account.type !== "securities" && account.type !== "crypto") continue;

    const hasUsdLedgerMode =
      account.currency === "USD" ||
      hasUsdTransferByAccount.has(account.id);
    if (hasUsdLedgerMode) continue;

    const usdTradeIndices: number[] = [];
    const nonZeroUsdTrades: Array<{ cashImpact: number; totalAmount: number }> = [];

    for (let i = 0; i < nextTrades.length; i += 1) {
      const trade = nextTrades[i];
      if (trade.accountId !== account.id) continue;
      if (cleanTicker(trade.ticker ?? "").length > 4) continue;
      usdTradeIndices.push(i);

      const cashImpact = Number(trade.cashImpact ?? 0);
      const totalAmount = Number(trade.totalAmount ?? 0);
      if (!Number.isFinite(cashImpact) || !Number.isFinite(totalAmount)) continue;
      if (Math.abs(cashImpact) <= EPS) continue;
      nonZeroUsdTrades.push({ cashImpact, totalAmount });
    }

    if (usdTradeIndices.length === 0) continue;
    if (nonZeroUsdTrades.length === 0) continue;

    const hasKrwLikeNonZero = nonZeroUsdTrades.some(({ cashImpact, totalAmount }) => {
      const absCash = Math.abs(cashImpact);
      const absTotal = Math.abs(totalAmount);
      if (absTotal <= EPS) return false;
      const diff = Math.abs(absCash - absTotal);
      return diff <= Math.max(1, absTotal * 0.2);
    });
    if (!hasKrwLikeNonZero) continue;

    for (const index of usdTradeIndices) {
      const trade = nextTrades[index];
      const cashImpact = Number(trade.cashImpact ?? 0);
      if (!Number.isFinite(cashImpact) || Math.abs(cashImpact) > EPS) continue;
      const totalAmount = Number(trade.totalAmount ?? 0);
      if (!Number.isFinite(totalAmount) || totalAmount <= 0) continue;
      const nextCashImpact = trade.side === "buy" ? -totalAmount : totalAmount;
      nextTrades[index] = { ...trade, cashImpact: nextCashImpact };
      changed = true;
    }
  }

  return {
    accounts: nextAccounts,
    trades: nextTrades,
    changed
  };
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
  let next = { ...source };

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
    const parsedPrices = asArray(parsed.prices) as AppData["prices"];
    const parsedRecurring = asArray(parsed.recurringExpenses) as AppData["recurringExpenses"];
    const parsedBudgetGoals = asArray(parsed.budgetGoals) as AppData["budgetGoals"];
    const parsedCustomSymbols = asArray(parsed.customSymbols) as AppData["customSymbols"];
    const parsedTickerDatabase = asArray(parsed.tickerDatabase) as NonNullable<AppData["tickerDatabase"]>;
    const parsedLedgerTemplates = asArray(parsed.ledgerTemplates) as NonNullable<AppData["ledgerTemplates"]>;
    const parsedStockPresets = asArray(parsed.stockPresets) as NonNullable<AppData["stockPresets"]>;
    const parsedTargetPortfolios = asArray(parsed.targetPortfolios) as NonNullable<AppData["targetPortfolios"]>;
    const parsedWorkoutWeeks = asArray(parsed.workoutWeeks) as NonNullable<AppData["workoutWeeks"]>;
    const parsedIsaPortfolio = asArray(parsed.isaPortfolio) as NonNullable<AppData["isaPortfolio"]>;
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
      prices: parsedPrices,
      categoryPresets: mergeCategoryPresets(parsed.categoryPresets, defaults),
      recurringExpenses: parsedRecurring,
      budgetGoals: parsedBudgetGoals,
      customSymbols: parsedCustomSymbols,
      usTickers: asArray<string>(parsed.usTickers).length > 0 ? [...asArray<string>(parsed.usTickers)] : [...DEFAULT_US_TICKERS],
      tickerDatabase: parsedTickerDatabase,
      ledgerTemplates: parsedLedgerTemplates,
      stockPresets: parsedStockPresets,
      targetPortfolios: parsedTargetPortfolios,
      workoutWeeks: parsedWorkoutWeeks,
      targetNetWorthCurve: normalizedTargetCurve,
      assetSnapshots: normalizeAssetSnapshots(parsed.assetSnapshots),
      historicalDailyCloses: normalizeHistoricalDailyCloses(parsed.historicalDailyCloses),
      dividendTrackingTicker: parsed.dividendTrackingTicker !== undefined && parsed.dividendTrackingTicker !== null ? String(parsed.dividendTrackingTicker) : "458730",
      isaPortfolio: parsedIsaPortfolio.length > 0 ? parsedIsaPortfolio : getDefaultIsaPortfolio()
    };
    const normalizedUsdCashImpact = normalizeUsdTradeCashImpactForKrwSecurities(
      parsedData.accounts,
      parsedData.ledger,
      parsedData.trades
    );
    const parsedDataAfterUsdCashImpact: AppData = normalizedUsdCashImpact.changed
      ? {
        ...parsedData,
        accounts: normalizedUsdCashImpact.accounts,
        trades: normalizedUsdCashImpact.trades
      }
      : parsedData;

    const normalizedKrwCashImpact = normalizeSecuritiesKrwTradeCashImpact(
      parsedDataAfterUsdCashImpact.accounts,
      parsedDataAfterUsdCashImpact.trades
    );
    const dataAfterKrwCashImpact: AppData = normalizedKrwCashImpact.changed
      ? { ...parsedDataAfterUsdCashImpact, trades: normalizedKrwCashImpact.trades }
      : parsedDataAfterUsdCashImpact;

    const normalizedSecurities = normalizeSecuritiesOpeningCashAndInitialBuys(
      dataAfterKrwCashImpact.accounts,
      dataAfterKrwCashImpact.trades
    );
    const parsedDataNormalized: AppData = normalizedSecurities.changed
      ? {
        ...dataAfterKrwCashImpact,
        accounts: normalizedSecurities.accounts,
        trades: normalizedSecurities.trades
      }
      : dataAfterKrwCashImpact;

    const { data: dataWithKrNames, changed: krNamesChanged } = applyKoreanStockNames(parsedDataNormalized);
    const accounts = dataWithKrNames.accounts;

    // 깨진 카테고리 이름 수정
    const originalLedger = dataWithKrNames.ledger;
    const fixedLedger = fixCorruptedCategoryNames(originalLedger);
    // 대출/빚 → 대출상환/중분류 마이그레이션
    const afterLoanMigrate = migrateLoanRepaymentTo대출상환(fixedLedger);
    // 이체로 저장된 저축성 지출 → 지출(expense)로 일괄 수정
    const migratedLedger = migrateSavingsExpenseFromTransfer(afterLoanMigrate, dataWithKrNames.categoryPresets);
    const normalizedLedger = normalizeExpenseSourceAccounts(
      migratedLedger,
      accounts
    );

    const hasLedgerChanges =
      originalLedger.length !== normalizedLedger.length ||
      originalLedger.some((entry, idx) => {
        const m = normalizedLedger[idx];
        if (!m) return true;
        return (
          entry.kind !== m.kind ||
          entry.category !== m.category ||
          entry.subCategory !== m.subCategory ||
          entry.fromAccountId !== m.fromAccountId
        );
      });

    const finalData: AppData = {
      ...dataWithKrNames,
      accounts,
      ledger: normalizedLedger
    };

    if (
      schemaVersionChanged ||
      hasLedgerChanges ||
      krNamesChanged ||
      normalizedSecurities.changed ||
      normalizedUsdCashImpact.changed ||
      normalizedKrwCashImpact.changed
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

const SAVE_RETRY_COUNT = 2;

export function saveDataSerialized(serialized: string): void {
  if (typeof window === "undefined") return;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= SAVE_RETRY_COUNT; attempt++) {
    try {
      window.localStorage.setItem(STORAGE_KEYS.DATA, serialized);
      writeStoredSchemaVersion(DATA_SCHEMA_VERSION);
      try {
        const parsedData = JSON.parse(serialized) as AppData;
        const tableFile = buildTableBackupFile(parsedData);
        const tableStr = JSON.stringify(tableFile);
        try {
          window.localStorage.setItem(STORAGE_KEYS.DATA_TABLE_BACKUP, tableStr);
        } catch (lsErr) {
          console.warn("[FarmWallet] table backup localStorage skipped", lsErr);
        }
        void fetch("/api/app-data-tables", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: tableStr
        }).catch(() => {});
      } catch (tableErr) {
        console.warn("[FarmWallet] table backup build/sync failed", tableErr);
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
