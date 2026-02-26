import type { AppData, CategoryPresets, ExpenseDetailGroup, IsaPortfolioItem } from "../types";
import { STORAGE_KEYS, DEFAULT_US_TICKERS, ISA_PORTFOLIO } from "../constants/config";
import { normalizeCategory, normalizeSubCategory } from "../utils/category";
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
      main: "재테크",
      subs: ["저축", "투자"]
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

  // 항목 매트릭스: 저축성지출 제거, 재테크만 저축/투자로 유지
  expenseDetails = expenseDetails.filter((g) => g.main !== "저축성지출");
  const hasRecheck = expenseDetails.some((g) => g.main === "재테크");
  expenseDetails = expenseDetails.map((g) =>
    g.main === "재테크" ? { main: "재테크", subs: ["저축", "투자"] } : g
  );
  if (!hasRecheck) {
    expenseDetails = [{ main: "재테크", subs: ["저축", "투자"] }, ...expenseDetails];
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
 * 기존 대출/빚(category=대출, subCategory=빚) → 대출상환/세부항목으로 마이그레이션
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
    dividendTrackingTicker: "458730",
    isaPortfolio: getDefaultIsaPortfolio()
  };
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
    const parsed = JSON.parse(raw) as Partial<AppData>;
    const parsedData: AppData = {
      loans: parsed.loans ?? [],
      accounts: (parsed.accounts ?? []).map((a) => {
        const debtValue = typeof a.debt === "number" ? a.debt : Number(a.debt ?? 0) || 0;
        return {
          ...a,
          debt: debtValue,
          savings: a.savings ?? 0
        };
      }),
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
      targetPortfolios: parsed.targetPortfolios ?? [],
      workoutWeeks: parsed.workoutWeeks ?? [],
      targetNetWorthCurve: parsed.targetNetWorthCurve && typeof parsed.targetNetWorthCurve === "object" ? parsed.targetNetWorthCurve : {},
      dividendTrackingTicker: parsed.dividendTrackingTicker !== undefined && parsed.dividendTrackingTicker !== null ? String(parsed.dividendTrackingTicker) : "458730",
      isaPortfolio: parsed.isaPortfolio && Array.isArray(parsed.isaPortfolio) && parsed.isaPortfolio.length > 0 ? parsed.isaPortfolio : getDefaultIsaPortfolio()
    };
    const { data: dataWithKrNames, changed: krNamesChanged } = applyKoreanStockNames(parsedData);
    const accounts = dataWithKrNames.accounts;

    // 깨진 카테고리 이름 수정
    const originalLedger = dataWithKrNames.ledger;
    const fixedLedger = fixCorruptedCategoryNames(originalLedger);
    // 대출/빚 → 대출상환/세부항목 마이그레이션
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

    if (hasLedgerChanges || krNamesChanged) {
      saveData(finalData);
    }
    return finalData;
  } catch (e) {
    console.error("[FarmWallet] loadData failed", e);
    throw e;
  }
}

const SAVE_RETRY_COUNT = 2;

export function saveData(data: AppData): void {
  if (typeof window === "undefined") return;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= SAVE_RETRY_COUNT; attempt++) {
    try {
      window.localStorage.setItem(STORAGE_KEYS.DATA, JSON.stringify(data));
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
