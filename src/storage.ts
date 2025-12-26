import type { AppData, CategoryPresets, ExpenseDetailGroup, TickerInfo } from "./types";
import type { FileBackupResult } from "./backupApi";

const STORAGE_KEY = "farmwallet-data-v1";
const BACKUP_KEY = "farmwallet-backups-v1";
const BACKUP_API = "/api/backup";
const TICKER_BACKUP_FILE = "/backups/ticker-latest.json";

function isPrimaryEnvironment(): boolean {
  return typeof window !== "undefined";
}

export function getDefaultUsTickers(): string[] {
  return ["AAPL", "MSFT", "QQQ", "SPY", "VOO", "IVV"];
}

interface StoredBackup {
  id: string;
  createdAt: string;
  data: AppData;
  hash?: string;
}

export interface BackupMeta {
  id: string;
  createdAt: string;
  hash?: string;
}

export type BackupSource = "browser" | "server";

export interface BackupEntry extends BackupMeta {
  source: BackupSource;
  fileName?: string;
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
    usTickers: getDefaultUsTickers(),
    tickerDatabase: [],
    ledgerTemplates: [],
    stockPresets: []
  };

  if (typeof window === "undefined") {
    return emptyData;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // 샘플 데이터 대신 빈 데이터 반환
      return emptyData;
    }
    const parsed = JSON.parse(raw) as Partial<AppData>;
    const presets = mergeCategoryPresets(parsed.categoryPresets, defaults);
    const accounts = (parsed.accounts ?? []).map((a) => ({
      ...a,
      debt: a.debt ?? 0,
      savings: a.savings ?? 0
    }));
    return {
      loans: parsed.loans ?? [],
      accounts,
      ledger: parsed.ledger ?? [],
      trades: parsed.trades ?? [],
      prices: parsed.prices ?? [],
      categoryPresets: presets,
      recurringExpenses: parsed.recurringExpenses ?? [],
      budgetGoals: parsed.budgetGoals ?? [],
      customSymbols: parsed.customSymbols ?? [],
      usTickers: parsed.usTickers ?? getDefaultUsTickers(),
      tickerDatabase: parsed.tickerDatabase ?? [],
      ledgerTemplates: parsed.ledgerTemplates ?? [],
      stockPresets: parsed.stockPresets ?? []
    };
  } catch {
    // 오류 발생 시에도 빈 데이터 반환
    return emptyData;
  }
}

export function saveData(data: AppData) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data, null, 2));
  void saveServerData(data);
}

export async function loadTickerDatabaseFromBackup(): Promise<TickerInfo[] | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch("/api/ticker-backup");
    if (!res.ok) return null;
    const json = await res.json();
    if (Array.isArray(json)) return json as TickerInfo[];
    if (Array.isArray((json as { tickers?: unknown }).tickers)) return (json as { tickers: TickerInfo[] }).tickers;
    return null;
  } catch {
    return null;
  }
}

export async function saveTickerDatabaseBackup(tickers: TickerInfo[]): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await fetch("/api/ticker-backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers })
    });
  } catch {
    // 파일 백업 실패는 무시 (localStorage 저장은 상위 로직에서 처리)
  }
}

/**
 * ticker.json 파일에 티커와 종목명 저장
 */
export async function saveTickerToJson(ticker: string, name: string, market: 'KR' | 'US'): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await fetch("/api/ticker-json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, name, market })
    });
  } catch (e) {
    console.error("Failed to save ticker to ticker.json", e);
  }
}


export function getInitialSampleData(): AppData {
  const today = new Date().toISOString().slice(0, 10);
  return {
    loans: [],
    accounts: [
      {
        id: "CHK_KB",
        name: "국민입출금",
        institution: "국민은행",
        type: "checking",
        initialBalance: 2000000,
        debt: 0,
        savings: 0
      },
      {
        id: "SAV_KB",
        name: "국민적금",
        institution: "국민은행",
        type: "savings",
        initialBalance: 5000000,
        debt: 0,
        savings: 5000000
      },
      {
        id: "SEC_NH",
        name: "NH투자증권CMA",
        institution: "NH투자증권",
        type: "securities",
        initialBalance: 1000000,
        debt: 0,
        savings: 0
      }
    ],
    ledger: [
      {
        id: "L1",
        date: today,
        kind: "income",
        category: "수입",
        subCategory: "급여",
        description: "회사월급입금",
        fromAccountId: undefined,
        toAccountId: "CHK_KB",
        amount: 3000000
      },
      {
        id: "L2",
        date: today,
        kind: "expense",
        category: "식비",
        subCategory: "외식/배달",
        description: "점심 식사",
        fromAccountId: "CHK_KB",
        toAccountId: undefined,
        amount: 12000
      },
      {
        id: "L3",
        date: today,
        kind: "transfer",
        category: "저축이체",
        description: "월 저축",
        fromAccountId: "CHK_KB",
        toAccountId: "SAV_KB",
        amount: 500000
      }
    ],
    trades: [
      {
        id: "T1",
        date: today,
        accountId: "SEC_NH",
        ticker: "005930",
        name: "삼성전자",
        side: "buy",
        quantity: 10,
        price: 70000,
        fee: 1000,
        totalAmount: 10 * 70000 + 1000,
        cashImpact: -(10 * 70000 + 1000)
      },
      {
        id: "T2",
        date: today,
        accountId: "SEC_NH",
        ticker: "005930",
        name: "삼성전자",
        side: "sell",
        quantity: 5,
        price: 75000,
        fee: 1000,
        totalAmount: 5 * 75000 + 1000,
        cashImpact: 5 * 75000 + 1000
      }
    ],
    prices: [
      { ticker: "005930", name: "삼성전자", price: 72000 },
      { ticker: "035420", name: "NAVER", price: 185000 }
    ],
    categoryPresets: getDefaultCategoryPresets(),
    recurringExpenses: [
      {
        id: "R1",
        title: "넷플릭스",
        amount: 17000,
        category: "구독비",
        frequency: "monthly",
        startDate: today
      }
    ],
    budgetGoals: [
      {
        id: "B1",
        category: "식비",
        monthlyLimit: 400000,
        note: "한 달 식비 목표"
      }
    ],
    customSymbols: [
      { ticker: "005930", name: "삼성전자" },
      { ticker: "AAPL", name: "Apple Inc." },
      { ticker: "QQQM", name: "Invesco NASDAQ 100 ETF" }
    ],
    usTickers: getDefaultUsTickers()
  };
}

const DATA_API = "/api/data-store";

export async function fetchServerData(): Promise<AppData | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(DATA_API);
    if (!res.ok) return null;
    const data = (await res.json()) as AppData;
    if (!data || typeof data !== "object") return null;
    return {
      ...data,
      usTickers: data.usTickers ?? getDefaultUsTickers()
    };
  } catch {
    return null;
  }
}

export async function saveServerData(data: AppData): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await fetch(DATA_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
  } catch {
    // 실패해도 앱 동작에는 영향 없도록 무시
  }
}

async function saveServerBackup(data: AppData): Promise<FileBackupResult | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(BACKUP_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    if (!res.ok) return null;
    return (await res.json()) as FileBackupResult;
  } catch {
    return null;
  }
}

export async function fetchServerBackupList(): Promise<BackupEntry[]> {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage.ts:fetchServerBackupList',message:'백업 목록 조회 시작',data:{url:BACKUP_API},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  if (typeof window === "undefined") return [];
  try {
    const res = await fetch(BACKUP_API);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage.ts:fetchServerBackupList',message:'fetch 응답',data:{ok:res.ok,status:res.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    if (!res.ok) return [];
    const list = (await res.json()) as FileBackupResult[];
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage.ts:fetchServerBackupList',message:'백업 목록 파싱',data:{count:list.length,firstFew:list.slice(0,3).map(l=>({fileName:l.fileName}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    return list.map((item) => ({
      id: item.fileName,
      createdAt: item.createdAt,
      fileName: item.fileName,
      source: "server" as const
    }));
  } catch (err) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage.ts:fetchServerBackupList',message:'백업 목록 조회 에러',data:{error:String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    return [];
  }
}

export async function loadServerBackupData(fileName: string): Promise<AppData | null> {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage.ts:loadServerBackupData',message:'백업 로드 시작',data:{fileName},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams({ fileName });
    const url = `${BACKUP_API}?${params.toString()}`;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage.ts:loadServerBackupData',message:'fetch 요청',data:{url,fileName},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    const res = await fetch(url);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage.ts:loadServerBackupData',message:'fetch 응답',data:{ok:res.ok,status:res.status,statusText:res.statusText},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    if (!res.ok) return null;
    const data = (await res.json()) as AppData;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage.ts:loadServerBackupData',message:'백업 로드 성공',data:{hasData:!!data,accountsCount:data?.accounts?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    return data;
  } catch (err) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage.ts:loadServerBackupData',message:'백업 로드 에러',data:{error:String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    return null;
  }
}

export async function getAllBackupList(): Promise<BackupEntry[]> {
  const browserBackups: BackupEntry[] = getBackupList().map((b) => ({
    ...b,
    source: "browser" as const
  }));
  const serverBackups = await fetchServerBackupList();
  return [...browserBackups, ...serverBackups].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}

function getDefaultCategoryPresets(): CategoryPresets {
  const expenseDetails: ExpenseDetailGroup[] = [
    {
      main: "저축성지출",
      subs: [
        "예금",
        "적금",
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
    transfer: ["저축이체", "계좌이체", "카드결제이체"]
  };
}

function mergeCategoryPresets(
  fromStorage: AppData["categoryPresets"] | undefined,
  defaults: CategoryPresets
): CategoryPresets {
  if (!fromStorage) return defaults;
  const income = fromStorage.income?.length ? fromStorage.income : defaults.income;
  const expense = fromStorage.expense?.length ? fromStorage.expense : defaults.expense;
  const transfer = fromStorage.transfer?.length ? fromStorage.transfer : defaults.transfer;

  let expenseDetails: ExpenseDetailGroup[];
  if (fromStorage.expenseDetails && fromStorage.expenseDetails.length) {
    expenseDetails = fromStorage.expenseDetails;
  } else {
    expenseDetails = defaults.expenseDetails ?? [];
  }

  return {
    income,
    expense,
    expenseDetails,
    transfer
  };
}

async function computeBackupHash(data: AppData): Promise<string> {
  const text = JSON.stringify(data);
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function saveBackupSnapshot(
  data: AppData,
  options?: { skipHash?: boolean; folder?: string }
) {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage.ts:saveBackupSnapshot',message:'함수 시작',data:{hasOptions:!!options,options},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
  // #endregion
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(BACKUP_KEY);
    const current: StoredBackup[] = raw ? (JSON.parse(raw) as StoredBackup[]) : [];
    const now = new Date().toISOString();
    const hash = options?.skipHash ? undefined : await computeBackupHash(data);

    const backup: StoredBackup = {
      id: `B${Date.now()}`,
      createdAt: now,
      data,
      hash
    };

    // localStorage 용량 제한을 고려하여 최근 5개만 보관 (20개에서 줄임)
    const next = [backup, ...current].slice(0, 5);
    try {
      window.localStorage.setItem(BACKUP_KEY, JSON.stringify(next, null, 2));
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage.ts:saveBackupSnapshot',message:'localStorage 백업 완료',data:{backupId:backup.id,hasHash:!!hash,count:next.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
    } catch (quotaErr) {
      // 용량 초과 시 기존 백업을 더 줄이고 재시도
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage.ts:saveBackupSnapshot',message:'localStorage 용량 초과, 백업 개수 줄임',data:{error:String(quotaErr),tryingCount:3},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      // 최근 3개만 보관하고 재시도
      const reduced = [backup, ...current].slice(0, 3);
      try {
        window.localStorage.setItem(BACKUP_KEY, JSON.stringify(reduced, null, 2));
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage.ts:saveBackupSnapshot',message:'localStorage 백업 완료 (개수 줄임)',data:{backupId:backup.id,count:reduced.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
      } catch (retryErr) {
        // 그래도 실패하면 최신 1개만 저장 시도
        try {
          window.localStorage.setItem(BACKUP_KEY, JSON.stringify([backup], null, 2));
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage.ts:saveBackupSnapshot',message:'localStorage 백업 완료 (최신 1개만)',data:{backupId:backup.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
        } catch (finalErr) {
          // 최종 실패 시 localStorage 백업은 포기 (서버 백업은 계속 진행)
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage.ts:saveBackupSnapshot',message:'localStorage 백업 최종 실패',data:{error:String(finalErr)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
        }
      }
    }
  } catch (err) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage.ts:saveBackupSnapshot',message:'localStorage 백업 예외',data:{error:String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    // 백업은 실패해도 앱 동작에 영향을 주지 않도록 조용히 무시
  }

  // 로컬 파일에도 동일한 스냅샷을 남겨 브라우저를 바꿔도 복원 가능하도록 저장
  try {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage.ts:saveBackupSnapshot',message:'서버 백업 시작',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    await saveServerBackup(data);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage.ts:saveBackupSnapshot',message:'서버 백업 완료',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
  } catch (err) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage.ts:saveBackupSnapshot',message:'서버 백업 에러',data:{error:String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    // 서버 저장 실패도 무시 (브라우저 로컬 백업은 이미 완료됨)
  }
}

export function getBackupList(): BackupMeta[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(BACKUP_KEY);
    if (!raw) return [];
    const current = JSON.parse(raw) as StoredBackup[];
    return current.map((b) => ({ id: b.id, createdAt: b.createdAt, hash: b.hash }));
  } catch {
    return [];
  }
}

export function loadBackupData(id: string): AppData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    const current = JSON.parse(raw) as StoredBackup[];
    const found = current.find((b) => b.id === id);
    return found ? found.data : null;
  } catch {
    return null;
  }
}

// 최신 로컬 백업의 무결성 상태를 반환
export async function getLatestLocalBackupIntegrity(): Promise<{
  createdAt: string | null;
  status: "valid" | "missing-hash" | "mismatch" | "none";
}> {
  if (typeof window === "undefined") return { createdAt: null, status: "none" };
  try {
    const raw = window.localStorage.getItem(BACKUP_KEY);
    if (!raw) return { createdAt: null, status: "none" };
    const current = JSON.parse(raw) as StoredBackup[];
    const latest = current[0];
    if (!latest) return { createdAt: null, status: "none" };
    if (!latest.hash) return { createdAt: latest.createdAt, status: "missing-hash" };
    const hash = await computeBackupHash(latest.data);
    const status = hash === latest.hash ? "valid" : "mismatch";
    return { createdAt: latest.createdAt, status };
  } catch {
    return { createdAt: null, status: "none" };
  }
}
