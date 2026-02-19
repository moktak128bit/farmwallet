import type { AppData, CategoryPresets, ExpenseDetailGroup } from "../types";
import { STORAGE_KEYS, DEFAULT_US_TICKERS } from "../constants/config";
import { normalizeCategory, normalizeSubCategory } from "../utils/categoryNormalize";
import krNames from "../data/krNames.json";

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
  const map = krNames as Record<string, string>;
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
      main: "저축성지출",
      subs: [
        "예금",
        "청년도약계좌",
        "주택청약",
        "투자(ISA)",
        "연금저축",
        "나무(CMA)",
        "투자(IRP)",
        "비상금",
        "빚상환용",
        "해외주식",
        "토스주식",
        "가상자산",
        "기타저축"
      ]
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
      savings: ["저축성지출"],
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
  const expense = fromStorage.expense && Array.isArray(fromStorage.expense) && fromStorage.expense.length > 0 
    ? fromStorage.expense 
    : defaults.expense;
  const transfer = fromStorage.transfer && Array.isArray(fromStorage.transfer) && fromStorage.transfer.length > 0 
    ? fromStorage.transfer 
    : defaults.transfer;

  let expenseDetails: ExpenseDetailGroup[];
  if (fromStorage.expenseDetails && Array.isArray(fromStorage.expenseDetails) && fromStorage.expenseDetails.length > 0) {
    expenseDetails = fromStorage.expenseDetails;
  } else {
    expenseDetails = defaults.expenseDetails ?? [];
  }

  // categoryTypes 마이그레이션: 기존 데이터에 없으면 기본값 사용
  const categoryTypes = fromStorage.categoryTypes || defaults.categoryTypes || {
    fixed: ["주거비", "통신비", "구독비"],
    savings: ["저축성지출"],
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

export function loadData(): AppData {
  const defaults = getDefaultCategoryPresets();
  const emptyData: AppData = {
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
    targetPortfolios: []
  };

  if (typeof window === "undefined") {
    return emptyData;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.DATA);
    if (!raw) {
      return emptyData;
    }
    const parsed = JSON.parse(raw) as Partial<AppData>;
    const parsedData: AppData = {
      loans: parsed.loans ?? [],
      accounts: (parsed.accounts ?? []).map((a) => ({
        ...a,
        debt: a.debt ?? 0,
        savings: a.savings ?? 0
      })),
      ledger: parsed.ledger ?? [],
      trades: parsed.trades ?? [],
      prices: parsed.prices ?? [],
      categoryPresets: mergeCategoryPresets(parsed.categoryPresets, defaults),
      recurringExpenses: parsed.recurringExpenses ?? [],
      budgetGoals: parsed.budgetGoals ?? [],
      customSymbols: parsed.customSymbols ?? [],
      usTickers: parsed.usTickers ? [...parsed.usTickers] : [...DEFAULT_US_TICKERS],
      tickerDatabase: parsed.tickerDatabase ?? [],
      ledgerTemplates: parsed.ledgerTemplates ?? [],
      stockPresets: parsed.stockPresets ?? [],
      targetPortfolios: parsed.targetPortfolios ?? []
    };
    const { data: dataWithKrNames, changed: krNamesChanged } = applyKoreanStockNames(parsedData);
    const accounts = dataWithKrNames.accounts;

    // 깨진 카테고리 이름 수정
    const originalLedger = dataWithKrNames.ledger;
    const fixedLedger = fixCorruptedCategoryNames(originalLedger);

    const hasLedgerChanges =
      originalLedger.length !== fixedLedger.length ||
      originalLedger.some((entry, idx) => {
        const fixed = fixedLedger[idx];
        return !fixed || entry.category !== fixed.category || entry.subCategory !== fixed.subCategory;
      });

    const finalData: AppData = {
      ...dataWithKrNames,
      accounts,
      ledger: fixedLedger
    };

    if (hasLedgerChanges || krNamesChanged) {
      saveData(finalData);
    }
    return finalData;
  } catch {
    return emptyData;
  }
}

export function saveData(data: AppData): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEYS.DATA, JSON.stringify(data, null, 2));
}
