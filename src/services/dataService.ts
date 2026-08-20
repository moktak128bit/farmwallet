import type {
  AppData,
  CategoryPresets,
  ExpenseDetailGroup,
  IsaPortfolioItem
} from "../types";
import { STORAGE_KEYS, DEFAULT_US_TICKERS, ISA_PORTFOLIO, DATA_SCHEMA_VERSION } from "../constants/config";
import { DEFAULT_WORKOUT_ROUTINES } from "../data/defaultWorkoutRoutines";
import {
  normalizeAssetSnapshots,
  normalizeMarketEnvSnapshots,
  normalizeHistoricalDailyFx,
  normalizeInvestmentGoals,
  normalizeDailyBudget,
  normalizeHistoricalDailyCloses,
} from "./dataNormalizers";
import { saveCacheToDB } from "./cacheStore";
import { saveSafetySnapshot } from "./backupService";
import { getKoreanNameOverlay } from "./krNameResolver";
import { cleanTicker } from "../utils/finance";
import { isDividendEntryLoose } from "../utils/categoryMatch";
import { sanitizeLedger, sanitizeTrades } from "../utils/dataSanitize";
import {
  diffAppData,
  buildMigrationReport,
  migrationSnapshotLabel,
  writeLastMigrationReport
} from "./migrationReport";

// dataService 내부에서만 쓰는 느슨한 한국 주식 판정 (6+자).
// finance.ts의 isKRWStock은 더 엄격(6자 정확)하므로 별도 유지.
function isKRWStockLoose(ticker: string): boolean {
  if (!ticker) return false;
  return cleanTicker(ticker).length >= 6;
}

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
  if (isKRWStockLoose(key)) return true;
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
    // 분류 단일소스(categoryMatch.isDividendEntryLoose) — cat/sub 정확 매칭 + description fallback
    // (includes("배당") 직접 사용 금지 — "비배당" 등 위양성 방지)
    const isDividend = (l: { kind?: string; category?: string; subCategory?: string; description?: string }) =>
      l?.kind === "income" && isDividendEntryLoose(l);
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
      subs: ["투자손실", "수수료", "세금", "환차손", "기타"]
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
      subs: ["원금상환", "이자상환"]
    },
    {
      main: "실수",
      subs: ["아차차", "구독미스", "API 초과"]
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
      "데이트통장",
      "기타수입"
    ],
    expense: expenseDetails.map((g) => g.main),
    expenseDetails,
    transfer: ["저축이체", "투자이체", "계좌이체", "카드결제이체", "데이트이체", "이월이체"],
    categoryTypes: {
      fixed: ["주거비", "통신비", "구독비"],
      savings: [],
      transfer: ["저축이체", "투자이체", "계좌이체", "카드결제이체"]
    }
  };
}

function mergeCategoryPresets(
  fromStorage: AppData["categoryPresets"] | undefined,
  defaults: CategoryPresets
): CategoryPresets {
  if (!fromStorage) return defaults;

  let income = fromStorage.income && Array.isArray(fromStorage.income) && fromStorage.income.length > 0
    ? fromStorage.income
    : defaults.income;
  // 방어적: "데이트통장" 보장 (v10 migration 누락·import preset 등 케이스 대비)
  if (!income.includes("데이트통장")) {
    const idx = income.indexOf("기타수입");
    income = idx >= 0
      ? [...income.slice(0, idx), "데이트통장", ...income.slice(idx)]
      : [...income, "데이트통장"];
  }
  let transfer = fromStorage.transfer && Array.isArray(fromStorage.transfer) && fromStorage.transfer.length > 0
    ? fromStorage.transfer
    : defaults.transfer;
  let expenseDetails: ExpenseDetailGroup[] =
    fromStorage.expenseDetails && Array.isArray(fromStorage.expenseDetails) && fromStorage.expenseDetails.length > 0
      ? fromStorage.expenseDetails
      : (defaults.expenseDetails ?? []);

  // 방어적 정정 (idempotent, schema version과 무관):
  // 1) transfer에 "저축이체"가 있는데 "투자이체"가 없으면 자동 추가 (UI 노출 보장)
  if (transfer.includes("저축이체") && !transfer.includes("투자이체")) {
    const idx = transfer.indexOf("저축이체");
    transfer = [...transfer.slice(0, idx + 1), "투자이체", ...transfer.slice(idx + 1)];
  }
  // 2) expenseDetails의 "재테크" subs에서 저축/투자/투자수익/이체 류만 제거 (다른 kind로 이관됨).
  //    사용자 정의 sub(수수료/세금/환차손/기타 등)는 보존. 모두 제거되면 실용 기본값 보충.
  expenseDetails = expenseDetails.map((g) => {
    if (g.main !== "재테크") return g;
    const legacySubs = new Set(["저축", "투자", "투자수익", "저축이체", "투자이체"]);
    const filtered = g.subs.filter((s) => !legacySubs.has(s));
    if (filtered.length === 0) return { ...g, subs: ["투자손실", "수수료", "세금", "환차손", "기타"] };
    return { ...g, subs: filtered };
  });
  // 3) expenseDetails에 "신용카드" main이 있으면 제거 (카드결제는 이제 이체 subCategory)
  expenseDetails = expenseDetails.filter((g) => g.main !== "신용카드");
  // 4) "대출상환" subs에 "원금상환" 또는 "이자상환"이 없으면 새 단순화된 기본값으로 교체
  //    (대출 종류는 Loan.subCategory에서 관리, ledger detailCategory는 원금/이자만 구분)
  expenseDetails = expenseDetails.map((g) => {
    if (g.main !== "대출상환") return g;
    const hasNewScheme = g.subs.includes("원금상환") || g.subs.includes("이자상환");
    if (hasNewScheme) return g;
    return { ...g, subs: ["원금상환", "이자상환"] };
  });

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

// 데이터 정규화 순수 함수는 services/dataNormalizers.ts로 분리 (god-module 경량화).

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

/**
 * 스키마 마커 쓰기. 저장된 마커가 쓰려는 버전보다 **높으면** 내려쓰지 않는다 (되감기 가드).
 * GitVersionModal 등으로 구버전 앱을 띄웠을 때 마커가 12→10으로 내려가면 복귀 시
 * 마이그레이션이 재실행되는데, v3 할인차감 같은 비멱등 단계가 데이터를 두 번 변형한다.
 */
function writeStoredSchemaVersion(version: number): void {
  if (typeof window === "undefined") return;
  if (readStoredSchemaVersion() > version) return;
  window.localStorage.setItem(STORAGE_KEYS.DATA_SCHEMA_VERSION, String(version));
}

/**
 * 로드 중 발생한 사용자 고지용 경고(예: 저장 데이터 스키마가 앱보다 높음).
 * UI(useAppData 등)가 getLoadWarnings()로 읽어 토스트/배너로 띄운다. 로드마다 갱신.
 */
let loadWarnings: string[] = [];

/** 마지막 loadData에서 기록된 경고 목록(복사본). 없으면 빈 배열. */
export function getLoadWarnings(): string[] {
  return [...loadWarnings];
}

/** 가져오기 파일의 스키마가 앱보다 높을 때 던지는 오류 (가져오기 거부). */
const SCHEMA_TOO_NEW_ERROR_NAME = "SchemaTooNewError";

export function isSchemaTooNewError(e: unknown): e is Error {
  return e instanceof Error && e.name === SCHEMA_TOO_NEW_ERROR_NAME;
}

function schemaTooNewError(fileVersion: number): Error {
  const err = new Error(`파일 스키마 v${fileVersion}가 앱(v${DATA_SCHEMA_VERSION})보다 높습니다 — 앱 업데이트 후 가져오세요.`);
  err.name = SCHEMA_TOO_NEW_ERROR_NAME;
  return err;
}

/**
 * sanitize가 손상 항목을 폐기하면 원본을 안전 스냅샷으로 보존 (best-effort).
 * 자동 백업이 기본 off라 사본이 없을 수 있고, 다음 저장에서 폐기분이 영구 소멸하기 때문.
 * quota 등 실패는 무시(console.warn) — 로드/가져오기를 막지 않는다.
 */
function preserveOriginalBeforeDrop(original: unknown, dropped: { ledger: number; trades: number }): void {
  if (dropped.ledger + dropped.trades <= 0) return;
  if (!original || typeof original !== "object") return;
  try {
    void saveSafetySnapshot(
      original as AppData,
      `손상 항목 폐기 직전 원본 (가계부 ${dropped.ledger}건·거래 ${dropped.trades}건)`
    ).then((saved) => {
      if (!saved) console.warn("[FarmWallet] 손상 항목 폐기 직전 원본 스냅샷 저장 실패");
    });
  } catch (e) {
    console.warn("[FarmWallet] 손상 항목 폐기 직전 원본 스냅샷 저장 실패", e);
  }
}

/**
 * 스키마 마이그레이션이 실제로 적용됐을 때(저장 마커 < 앱 버전) 직전 원본을 라벨 스냅샷으로 보존하고
 * 원본 vs 마이그레이션 결과 diff 리포트를 LAST_MIGRATION_REPORT에 기록 (둘 다 best-effort, 로드를 막지 않음).
 *
 * - 원본은 migrateBySchema 호출 **전** 문자열(raw)을 다시 파싱해 얻는다. migrateBySchema는 얕은 복사라
 *   v9/v12 블록이 categoryPresets 하위 객체를 제자리에서 고치므로 파싱 객체를 그대로 쓰면 원본이 아니다.
 * - diff의 after는 migrateBySchema 결과(정규화·sanitize·시드 주입 전) — "마이그레이션이 무엇을 바꿨나"만 담는다.
 *   (buildAppDataFromMigrated의 기본값 주입·캐시 병합까지 넣으면 매 부팅 노이즈가 섞인다.)
 * - 0-9(손상 항목 폐기 직전 원본)와 같은 부팅에 둘 다 일어나면 스냅샷이 2개 생긴다 — 의도. 시점이 다르고
 *   (이쪽은 마이그레이션 전 순수 원본, 0-9는 마이그레이션 후 폐기 전) 라벨이 달라 각자 보존 보호를 받는다.
 *   합치면 라벨 하나가 두 의미를 져야 해 복원 판단이 흐려진다.
 * - 되돌리기(롤백) UI는 제공하지 않는다: 원본을 그대로 복원하면 마커가 이미 현행이라 재마이그레이션이 없어
 *   구형태가 영구 잔존한다(기획서 1-3). 복원은 마커 되감기와 함께 설계돼야 하므로 여기선 보존+리포트까지만.
 */
function recordSchemaMigration(
  rawJson: string,
  migrated: Record<string, unknown>,
  fromVersion: number,
  toVersion: number
): void {
  try {
    const original = asObject(JSON.parse(rawJson) as unknown);
    const label = migrationSnapshotLabel(fromVersion, toVersion);
    try {
      void saveSafetySnapshot(original as unknown as AppData, label).then((saved) => {
        if (!saved) console.warn(`[FarmWallet] ${label} 스냅샷 저장 실패`);
      });
    } catch (e) {
      console.warn(`[FarmWallet] ${label} 스냅샷 저장 실패`, e);
    }
    const report = buildMigrationReport(fromVersion, toVersion, diffAppData(original, migrated));
    writeLastMigrationReport(report);
  } catch (e) {
    console.warn("[FarmWallet] 마이그레이션 직전 원본 보존/리포트 기록 실패", e);
  }
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

  // v5~v8: 재테크/신용결제 분리 및 최종 통합.
  // 최종 형태는:
  //   - 재테크 저축 → kind=transfer, category=이체, subCategory=저축이체
  //   - 재테크 투자 → kind=transfer, category=이체, subCategory=투자이체
  //   - 재테크 투자수익 → kind=income,   category=수입, subCategory=투자수익
  //   - 재테크 투자손실 → kind=expense,  category=재테크, subCategory=투자손실
  //   - 신용결제 → kind=transfer, category=이체, subCategory=카드결제이체
  //
  // 이전 단계(v4 원본 재테크, v5 investment, v6 investment, v7 임시 저축/투자)
  // 어디에 멈춰있어도 v8에서 최종 형태로 수렴.
  if (fromVersion < 8) {
    const ledger = asArray<Record<string, unknown>>(next.ledger);
    next.ledger = ledger.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const sub = String(entry.subCategory ?? "");

      // --- 재테크 이관 (v4 원본, v5/v6 investment, v7 임시 모두) ---
      const isOldRecheck =
        (entry.kind === "expense" && entry.category === "재테크") ||
        entry.kind === "investment";
      if (isOldRecheck) {
        if (sub === "저축" || sub === "저축이체") {
          return { ...entry, kind: "transfer", category: "이체", subCategory: "저축이체" };
        }
        if (sub === "투자" || sub === "투자이체") {
          return { ...entry, kind: "transfer", category: "이체", subCategory: "투자이체" };
        }
        if (sub === "투자수익") {
          return { ...entry, kind: "income", category: "수입", subCategory: "투자수익" };
        }
        if (sub === "투자손실") {
          return { ...entry, kind: "expense", category: "재테크", subCategory: "투자손실" };
        }
      }

      // --- v7 임시 이름 (subCategory="저축"/"투자", kind이 이미 transfer) 클린업 ---
      if (entry.kind === "transfer" && sub === "저축") {
        return { ...entry, category: "이체", subCategory: "저축이체" };
      }
      if (entry.kind === "transfer" && sub === "투자") {
        return { ...entry, category: "이체", subCategory: "투자이체" };
      }

      // --- 신용결제 이관 (지출 → 이체/카드결제이체) ---
      // 원래 구조: kind=expense, category=신용결제, subCategory=신용결제
      // from=은행, to=카드 계좌로 이미 채워져 있어 transfer 구조와 동일.
      if (entry.kind === "expense" && entry.category === "신용결제") {
        return { ...entry, kind: "transfer", category: "이체", subCategory: "카드결제이체" };
      }

      return entry;
    });

    migrated = true;
  }

  // v9: categoryPresets 정리 — 사용자 저장 preset이 v8 migration에서 완전히 업데이트 안 된
  // 경우를 보정 (idempotent). 신규 입력 UX를 새 구조에 맞춤.
  //  - transfer에 "투자이체" 보장
  //  - categoryTypes.transfer에도 동일
  //  - expenseDetails의 "재테크" main subs를 ["투자손실"]로 축소 (저축/투자/수익은 각각 이체/수입에 있음)
  //  - expenseDetails에서 "신용카드" main 제거 (카드결제는 이제 이체 subCategory)
  if (fromVersion < 9) {
    const cp = next.categoryPresets as Record<string, unknown> | undefined;
    if (cp && typeof cp === "object") {
      // transfer에 투자이체 삽입
      const tr = asArray<string>(cp.transfer);
      if (tr.length > 0 && !tr.includes("투자이체")) {
        const idx = tr.indexOf("저축이체");
        cp.transfer = idx >= 0
          ? [...tr.slice(0, idx + 1), "투자이체", ...tr.slice(idx + 1)]
          : [...tr, "투자이체"];
      }
      // categoryTypes.transfer도 동일
      const ct = cp.categoryTypes as Record<string, unknown> | undefined;
      if (ct && typeof ct === "object") {
        const ctt = asArray<string>(ct.transfer);
        if (ctt.length > 0 && !ctt.includes("투자이체")) {
          const idx = ctt.indexOf("저축이체");
          ct.transfer = idx >= 0
            ? [...ctt.slice(0, idx + 1), "투자이체", ...ctt.slice(idx + 1)]
            : [...ctt, "투자이체"];
        }
      }
      // expenseDetails 정리: "재테크" subs를 ["투자손실"]로, "신용카드" main 제거
      const expDetails = asArray<Record<string, unknown>>(cp.expenseDetails);
      if (expDetails.length > 0) {
        const filtered = expDetails
          .filter((g) => g?.main !== "신용카드")
          .map((g) => {
            if (g?.main === "재테크") {
              return { ...g, subs: ["투자손실"] };
            }
            return g;
          });
        cp.expenseDetails = filtered;
        cp.expense = filtered.map((g) => g?.main).filter(Boolean);
      }
    }
    migrated = true;
  }

  // v10: 데이트통장 입금 카테고리 통일.
  // 사용자가 같은 의미의 매월 데이트 입금을 어떤 달엔 "데이트비"(지출 카테고리), 어떤 달엔 "데이트통장"으로
  // 손입력해 카테고리 합산이 깨졌음. income 항목의 category="데이트비"는 모두 "데이트통장"으로 통일.
  // - subCategory는 그대로 유지 (있다면)
  // - kind=expense의 "데이트비"는 정상 사용이므로 건드리지 않음
  // - 같이 income preset에도 "데이트통장" 보장 (사용자 preset 보호하면서)
  if (fromVersion < 10) {
    const ledgerArr = asArray<Record<string, unknown>>(next.ledger);
    if (ledgerArr.length > 0) {
      next.ledger = ledgerArr.map((l) => {
        if (l?.kind === "income" && l?.category === "데이트비") {
          return { ...l, category: "데이트통장" };
        }
        return l;
      });
    }
    const cp = next.categoryPresets as Record<string, unknown> | undefined;
    if (cp && typeof cp === "object") {
      const inc = asArray<string>(cp.income);
      if (inc.length > 0 && !inc.includes("데이트통장")) {
        // "기타수입" 직전에 삽입 (있으면), 없으면 끝에
        const idx = inc.indexOf("기타수입");
        cp.income = idx >= 0
          ? [...inc.slice(0, idx), "데이트통장", ...inc.slice(idx)]
          : [...inc, "데이트통장"];
      }
    }
    migrated = true;
  }

  // v11: transfer 저축/투자 → 저축이체/투자이체 재정규화.
  // v8 블록(L622)이 fromVersion<8 게이트라, 스키마 버전이 이미 8+로 올라간 뒤
  // 남은 v7 임시 형식(transfer+저축/투자) 및 v5 이전 재테크 expense 저축/투자 항목이
  // 정규화를 못 거친 케이스 보정. idempotent (이미 저축이체/투자이체면 무변경).
  if (fromVersion < 11) {
    const ledgerArr = asArray<Record<string, unknown>>(next.ledger);
    next.ledger = ledgerArr.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const sub = String(entry.subCategory ?? "");
      if (entry.kind === "expense" && entry.category === "재테크") {
        if (sub === "저축") return { ...entry, kind: "transfer", category: "이체", subCategory: "저축이체" };
        if (sub === "투자") return { ...entry, kind: "transfer", category: "이체", subCategory: "투자이체" };
      }
      if (entry.kind === "transfer" && sub === "저축") return { ...entry, category: "이체", subCategory: "저축이체" };
      if (entry.kind === "transfer" && sub === "투자") return { ...entry, category: "이체", subCategory: "투자이체" };
      return entry;
    });
    migrated = true;
  }

  // v12: 재테크 expense 중분류 확장. 기존엔 "투자손실"만 남도록 강제됐는데,
  // 실제 재테크 지출(수수료/세금/환차손 등)을 분류할 수 없어 사용자가 불편함.
  // 누락된 실용 기본 subs(수수료/세금/환차손/기타)를 보충. 사용자가 추가한 sub는 보존.
  if (fromVersion < 12) {
    const cp = next.categoryPresets as Record<string, unknown> | undefined;
    if (cp && typeof cp === "object") {
      const expDetails = asArray<Record<string, unknown>>(cp.expenseDetails);
      if (expDetails.length > 0) {
        const defaultRecheckSubs = ["투자손실", "수수료", "세금", "환차손", "기타"];
        cp.expenseDetails = expDetails.map((g) => {
          if (g?.main !== "재테크") return g;
          const currentSubs = asArray<string>(g.subs);
          const merged = [...currentSubs];
          for (const def of defaultRecheckSubs) {
            if (!merged.includes(def)) merged.push(def);
          }
          return { ...g, subs: merged };
        });
      }
    }
    migrated = true;
  }

  return { data: next, migrated };
}

/** import 본문의 최소 형태 검증. 실패 시 throw. */
function validateImportShape(rawData: unknown): asserts rawData is Record<string, unknown> {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    throw new Error("Invalid backup format: 객체 형태가 아닙니다.");
  }
  const obj = rawData as Record<string, unknown>;
  // 핵심 컬렉션은 누락 가능하지만, 존재한다면 반드시 배열이어야 한다.
  const arrayFields = [
    "accounts", "ledger", "trades", "prices", "recurringExpenses",
    "budgetGoals", "tickerDatabase", "workoutWeeks"
  ];
  for (const f of arrayFields) {
    if (f in obj && obj[f] != null && !Array.isArray(obj[f])) {
      throw new Error(`Invalid backup format: ${f} 필드가 배열이 아닙니다.`);
    }
  }
  // categoryPresets가 있으면 객체여야
  if ("categoryPresets" in obj && obj.categoryPresets != null) {
    if (typeof obj.categoryPresets !== "object" || Array.isArray(obj.categoryPresets)) {
      throw new Error("Invalid backup format: categoryPresets는 객체여야 합니다.");
    }
  }
  // ledger 항목 샘플 검증 (큰 데이터 전부 순회 안 하고 처음 5개만)
  if (Array.isArray(obj.ledger)) {
    for (const e of obj.ledger.slice(0, 5)) {
      if (!e || typeof e !== "object") {
        throw new Error("Invalid backup format: ledger 항목이 객체가 아닙니다.");
      }
      const entry = e as Record<string, unknown>;
      if (entry.id != null && typeof entry.id !== "string") {
        throw new Error("Invalid backup format: ledger.id는 문자열이어야 합니다.");
      }
      if (entry.amount != null && (typeof entry.amount !== "number" || !Number.isFinite(entry.amount))) {
        throw new Error("Invalid backup format: ledger.amount는 유한 숫자여야 합니다.");
      }
    }
  }
}

/**
 * 외부 JSON(백업 파일·Gist·붙여넣기)을 검증·마이그레이션·정규화해 AppData로 반환하는 순수 함수.
 * localStorage 임시 쓰기 부작용 없음 — storage 이벤트 발화나 CACHE/IndexedDB 오염이 없다.
 * 저장은 호출부 책임 (onChangeData → 자동 저장, 또는 saveData 직접 호출).
 *
 * 마이그레이션 기준 버전:
 *  - 가져온 데이터에 schemaVersion 필드가 있으면 그 버전부터 마이그레이션 (구버전 백업 정상 변환)
 *  - 없으면 보수적으로 현 버전으로 간주 (추정 마이그레이션이 데이터를 건드리지 않게)
 */
export function normalizeImportedData(rawData: unknown): AppData {
  validateImportShape(rawData);
  const obj = rawData as Record<string, unknown>;
  const importedVersionRaw = Number(obj.schemaVersion);
  const importedVersion = Number.isFinite(importedVersionRaw) && importedVersionRaw > 0
    ? Math.floor(importedVersionRaw)
    : DATA_SCHEMA_VERSION;
  // 미래 버전 파일을 조용히 현행 취급하면 알 수 없는 필드가 유실된다 — 명확히 거부.
  if (importedVersion > DATA_SCHEMA_VERSION) {
    throw schemaTooNewError(importedVersion);
  }
  const migrated = migrateBySchema(obj, importedVersion);
  const { data, dropped } = buildAppDataFromMigrated(migrated.data, null);
  preserveOriginalBeforeDrop(obj, dropped);
  // 한글 종목명 적용은 idempotent — 가져오기 경로에서도 동일하게 적용 (저장은 안 함)
  const { data: withKrNames } = applyKoreanStockNames(data);
  return withKrNames;
}

/**
 * 마지막 buildAppDataFromMigrated 호출에서 sanitize로 폐기된 ledger/trade 건수.
 * 콘솔 경고만으로는 사용자가 손실을 인지하지 못하므로, 로드/가져오기 직후
 * UI(useAppData)가 consumeSanitizeReport()로 읽어 토스트로 알린다. (>0일 때만 보관)
 */
let lastSanitizeReport: { droppedLedger: number; droppedTrades: number } | null = null;

/** 마지막 sanitize 폐기 리포트를 읽고 비운다. 폐기가 없었으면 null. */
export function consumeSanitizeReport(): { droppedLedger: number; droppedTrades: number } | null {
  const r = lastSanitizeReport;
  lastSanitizeReport = null;
  return r;
}

/**
 * 마이그레이션이 끝난 파싱 객체를 AppData로 정규화하는 순수 빌더.
 * loadData(저장소 경로)와 normalizeImportedData(가져오기 경로)가 공유한다.
 * localStorage·IndexedDB 등 어떤 부작용도 없다 (sanitize 경고 콘솔 로그 + 폐기 리포트 기록 제외).
 *
 * @param cache 분리 저장된 API 캐시(loadData 경로). null이면(가져오기 경로) 본문 필드만 사용.
 */
function buildAppDataFromMigrated(
  migratedObject: Record<string, unknown>,
  cache: CacheData | null
): { data: AppData; needsCacheMigration: boolean; dropped: { ledger: number; trades: number } } {
  const defaults = getDefaultCategoryPresets();
  const parsed = migratedObject as Partial<AppData>;
  const parsedLoans = asArray(parsed.loans) as NonNullable<AppData["loans"]>;
  const parsedAccounts = asArray(parsed.accounts) as AppData["accounts"];
  // 손상된 ledger/trade 엔트리는 폐기 — NaN/누락 amount가 계산에 흘러들지 않게.
  const ledgerSan = sanitizeLedger(asArray<unknown>(parsed.ledger));
  const tradesSan = sanitizeTrades(asArray<unknown>(parsed.trades));
  if (ledgerSan.dropped > 0) {
    console.warn(`[FarmWallet] sanitize: ledger ${ledgerSan.dropped}건 폐기`, ledgerSan.droppedSamples);
  }
  if (tradesSan.dropped > 0) {
    console.warn(`[FarmWallet] sanitize: trades ${tradesSan.dropped}건 폐기`, tradesSan.droppedSamples);
  }
  // 폐기가 있었으면 UI가 읽어 토스트로 알리도록 리포트 기록 (없으면 비워 이전 리포트 잔류 방지)
  lastSanitizeReport =
    ledgerSan.dropped > 0 || tradesSan.dropped > 0
      ? { droppedLedger: ledgerSan.dropped, droppedTrades: tradesSan.dropped }
      : null;
  const parsedLedger = ledgerSan.clean as AppData["ledger"];
  const parsedTrades = tradesSan.clean as AppData["trades"];
  const parsedRecurring = asArray(parsed.recurringExpenses) as AppData["recurringExpenses"];
  const parsedBudgetGoals = asArray(parsed.budgetGoals) as AppData["budgetGoals"];
  const parsedCustomSymbols = asArray(parsed.customSymbols) as AppData["customSymbols"];
  const parsedLedgerTemplates = asArray(parsed.ledgerTemplates) as NonNullable<AppData["ledgerTemplates"]>;
  const parsedStockPresets = asArray(parsed.stockPresets) as NonNullable<AppData["stockPresets"]>;
  const parsedTargetPortfolios = asArray(parsed.targetPortfolios) as NonNullable<AppData["targetPortfolios"]>;
  const parsedWorkoutWeeks = asArray(parsed.workoutWeeks) as NonNullable<AppData["workoutWeeks"]>;
  // 시드 주입 정책: 저장 필드가 "부재"할 때만 DEFAULT_WORKOUT_ROUTINES 주입.
  // 빈 배열로 존재하면 사용자가 전부 삭제한 것 — 그대로 존중 (리로드 시 시드 재주입 금지).
  const parsedWorkoutRoutines = Array.isArray(parsed.workoutRoutines)
    ? (parsed.workoutRoutines as NonNullable<AppData["workoutRoutines"]>)
    : [...DEFAULT_WORKOUT_ROUTINES];
  const parsedCustomExercises = asArray(parsed.customExercises) as NonNullable<AppData["customExercises"]>;
  const parsedIsaPortfolio = asArray(parsed.isaPortfolio) as NonNullable<AppData["isaPortfolio"]>;

  // 캐시 분리 키 값(loadData 경로)이 있으면 우선, 없으면 본문 필드 사용
  const mainPrices = asArray(parsed.prices) as AppData["prices"];
  const mainTickerDb = asArray(parsed.tickerDatabase) as NonNullable<AppData["tickerDatabase"]>;
  const mainHistorical = asArray(parsed.historicalDailyCloses);
  const cacheData: CacheData = cache ?? { prices: [], tickerDatabase: [], historicalDailyCloses: [] };
  // 캐시 키가 비어 있고 메인 키에 데이터가 있으면 마이그레이션 필요 (loadData 경로에서만 의미 있음)
  const needsCacheMigration =
    cache != null &&
    cacheData.prices.length === 0 && cacheData.tickerDatabase.length === 0 && cacheData.historicalDailyCloses.length === 0 &&
    (mainPrices.length > 0 || mainTickerDb.length > 0 || mainHistorical.length > 0);
  const effectivePrices = cacheData.prices.length > 0 ? cacheData.prices : mainPrices;
  const effectiveTickerDatabase = cacheData.tickerDatabase.length > 0 ? cacheData.tickerDatabase : mainTickerDb;
  const effectiveHistoricalDailyCloses = cacheData.historicalDailyCloses.length > 0
    ? cacheData.historicalDailyCloses
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
    marketEnvSnapshots: normalizeMarketEnvSnapshots(parsed.marketEnvSnapshots),
    historicalDailyCloses: effectiveHistoricalDailyCloses,
    historicalDailyFx: normalizeHistoricalDailyFx(parsed.historicalDailyFx),
    benchmarkDailyCloses: normalizeHistoricalDailyCloses(asArray(parsed.benchmarkDailyCloses)),
    dividendTrackingTicker: parsed.dividendTrackingTicker !== undefined && parsed.dividendTrackingTicker !== null ? String(parsed.dividendTrackingTicker) : "458730",
    isaPortfolio: parsedIsaPortfolio.length > 0 ? parsedIsaPortfolio : getDefaultIsaPortfolio(),
    investmentGoals: normalizeInvestmentGoals(parsed.investmentGoals),
    // 하루 예산 설정 — loadData 필드 누락으로 새로고침마다 유실되던 회귀 방지
    dailyBudget: normalizeDailyBudget(parsed.dailyBudget)
  };
  return { data: parsedData, needsCacheMigration, dropped: { ledger: ledgerSan.dropped, trades: tradesSan.dropped } };
}

export function loadData(): AppData {
  const emptyData = getEmptyData();

  if (typeof window === "undefined") {
    return emptyData;
  }

  loadWarnings = [];
  // 구버전이 매 저장마다 쓰던 테이블 백업 사본(읽는 곳 없음, ~1MB) 정리 — 부팅 시 1회 제거
  try {
    window.localStorage.removeItem(STORAGE_KEYS.DATA_TABLE_BACKUP);
  } catch {
    /* ignore */
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.DATA);
    if (!raw) {
      return emptyData;
    }
    const parsedUnknown = JSON.parse(raw) as unknown;
    const parsedObject = asObject(parsedUnknown);
    const schemaVersion = readStoredSchemaVersion();
    // 저장 스키마가 앱보다 높음(구버전 앱 체크아웃) — 마커를 내려쓰지 않고 변경으로도 취급하지 않는다.
    // 되감긴 마커는 복귀 시 비멱등 마이그레이션(v3 할인차감 등)을 재실행시킨다.
    const storedAhead = schemaVersion > DATA_SCHEMA_VERSION;
    if (storedAhead) {
      const msg = `저장된 데이터 스키마(v${schemaVersion})가 이 앱 버전(v${DATA_SCHEMA_VERSION})보다 높습니다. 최신 앱으로 업데이트하세요 — 이 버전에서 저장하면 새 필드가 유실될 수 있습니다.`;
      console.warn(`[FarmWallet] ${msg}`);
      loadWarnings.push(msg);
    }
    const migratedBySchema = migrateBySchema(parsedObject, schemaVersion);
    const schemaVersionChanged =
      migratedBySchema.migrated || (!storedAhead && schemaVersion !== DATA_SCHEMA_VERSION);
    // 실제 마이그레이션(마커 < 앱 버전 && 변경 있음)이면 saveData 전에 직전 원본 보존 + diff 리포트 기록
    if (!storedAhead && schemaVersion < DATA_SCHEMA_VERSION && migratedBySchema.migrated) {
      recordSchemaMigration(raw, migratedBySchema.data, schemaVersion, DATA_SCHEMA_VERSION);
    }

    // 캐시 분리 키에서 로드, 없으면 메인 키의 값으로 마이그레이션
    const cache = loadCacheData();
    const { data: parsedData, needsCacheMigration, dropped } = buildAppDataFromMigrated(migratedBySchema.data, cache);
    // 손상 항목 폐기 시 파싱 직후 원본(마이그레이션 전)을 스냅샷으로 보존
    preserveOriginalBeforeDrop(parsedObject, dropped);
    // krNames는 idle 시간에 비동기 로드되므로, 여기서는 빈 맵일 수 있음.
    // 실제 한글명 적용은 useAppData의 idle 콜백에서 수행.
    const { data: dataWithKrNames, changed: krNamesChanged } = applyKoreanStockNames(parsedData);

    // 사용자의 계좌·가계부·거래 원본을 그대로 보존. 임시/일회성 마이그레이션은 모두 제거됨.
    const finalData: AppData = dataWithKrNames;

    // (손상 항목 폐기만으로는 여기서 저장하지 않는다 — 저장 시점·순서는 기존과 동일하게 useBackup 자동저장에 맡긴다.
    //  정리된 데이터는 부팅 직후 dirty로 감지돼 곧 저장되므로 재폐기·스냅샷 중복은 실제로 발생하지 않는다.)
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
  let userDataStr: string;
  let cacheToSave: CacheData;
  try {
    const fullData = JSON.parse(serialized) as AppData;
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

      // (구버전의 DATA_TABLE_BACKUP localStorage 사본 쓰기는 제거됨 — 읽는 곳이 없었고 ~1MB 낭비.
      //  테이블 백업은 DataBackupCard의 다운로드 버튼에서 필요 시 생성한다.)

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
