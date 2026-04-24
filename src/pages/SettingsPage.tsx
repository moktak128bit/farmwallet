import React, { useCallback, useEffect, useState, useMemo, useRef, lazy, Suspense } from "react";
import { toast } from "react-hot-toast";
import type {
  AppData,
  AssetSnapshotAccountBreakdown,
  AssetSnapshotPoint
} from "../types";
import {
  getAllBackupList,
  loadBackupData,
  clearOldBackups,
  getEmptyData,
  normalizeImportedData,
  saveData,
  type BackupEntry
} from "../storage";
import { getKoreaTime } from "../utils/date";

const DataIntegrityView = lazy(() => import("./DataIntegrityPage").then((m) => ({ default: m.DataIntegrityView })));
const SavingsMigrationView = lazy(() => import("./SavingsMigrationPage").then((m) => ({ default: m.SavingsMigrationView })));
const ThemeCustomizer = lazy(() => import("../components/ThemeCustomizer").then((m) => ({ default: m.ThemeCustomizer })));
import { usePWAInstall } from "../hooks/usePWAInstall";
import { STORAGE_KEYS, ISA_PORTFOLIO } from "../constants/config";
import { notifyDateAccountChange } from "../hooks/useDateAccountSettings";
import { useUIStore } from "../store/uiStore";
import {
  getGistToken,
  getGistTokenPersisted,
  setGistToken as gistSetToken,
  setGistTokenPersisted as gistSetTokenPersisted,
  getGistId,
  setGistId as gistSetId,
  saveToGist,
  loadFromGist,
} from "../services/gistSync";
import { toUserDataJson } from "../services/dataService";
import { ERROR_MESSAGES } from "../constants/errorMessages";
import { appDataFromTableBackupPayload, buildTableBackupFile } from "../utils/tableDataBackup";

interface Props {
  data: AppData;
  onChangeData: (next: AppData) => void;
  backupVersion: number;
  /** 로드 실패 후 백업 복원했을 때 호출 (저장 재활성화) */
  onBackupRestored?: () => void;
  /** 백업 목록이 변경되었을 때 호출 (헤더 최신화) */
  onBackupsChanged?: () => void | Promise<void>;
  onNavigateToRecord?: (payload: { type: "ledger" | "trade"; id: string }) => void;
  onNavigateToTab?: (tab: "accounts" | "ledger" | "stocks") => void;
  /** 자동 Gist 동기화 ON/OFF */
  autoSyncEnabled?: boolean;
  onAutoSyncChange?: (enabled: boolean) => void;
  /** 마지막 자동 저장/불러오기 시각 */
  gistLastPushAt?: string | null;
  gistLastPullAt?: string | null;
}

type SettingsTab = "backup" | "integrity" | "theme" | "accessibility" | "dashboard" | "savingsMigration";

const WIDGET_ID_DIVIDEND_TRACKING = "dividendTracking";

function migrateWidgetId(id: string): string {
  return id === "458730" ? WIDGET_ID_DIVIDEND_TRACKING : id;
}

const DASHBOARD_WIDGET_ORDER = ["summary", "assets", "income", "savingsFlow", "budget", "stocks", "portfolio", "targetPortfolio", WIDGET_ID_DIVIDEND_TRACKING, "isa", "realReturn", "goalPlanner", "investCapacity", "tradeVsSpend", "dividendCoverage", "concentration"];

type SnapshotNumericField = Exclude<keyof Omit<AssetSnapshotPoint, "date">, "accountBreakdown">;

const SNAPSHOT_FIELD_BY_LABEL: Record<string, SnapshotNumericField> = {
  "적금": "installmentSavings",
  "예금": "termDeposit",
  "연금저축(원금)": "pensionPrincipal",
  "연금저축(평가금)": "pensionEvaluation",
  "투자(매수금)": "investmentBuyAmount",
  "투자(평가금)": "investmentEvaluationAmount",
  "가상자산": "cryptoAssets",
  "배당,이자(누적)": "dividendInterestCumulative",
  "총자산(매수금)": "totalAssetBuyAmount",
  "총자산(평가금)": "totalAssetEvaluationAmount",
  "투자성과": "investmentPerformance"
};

const SNAPSHOT_NUMERIC_FIELDS: SnapshotNumericField[] = [
  "installmentSavings",
  "termDeposit",
  "pensionPrincipal",
  "pensionEvaluation",
  "investmentBuyAmount",
  "investmentEvaluationAmount",
  "cryptoAssets",
  "dividendInterestCumulative",
  "totalAssetBuyAmount",
  "totalAssetEvaluationAmount",
  "investmentPerformance"
];

function parseNullableNumber(value: unknown): number | null {
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
    const buyAmount = parseNullableNumber(obj.buyAmount);
    const evaluationAmount = parseNullableNumber(obj.evaluationAmount);
    if (buyAmount == null || evaluationAmount == null) continue;
    rows.push({ accountId, accountName, buyAmount, evaluationAmount });
  }
  return rows;
}

function normalizeSnapshotLabel(label: string): string {
  return label.replace(/\s+/g, "");
}

function normalizeAssetSnapshots(input: unknown): AssetSnapshotPoint[] | null {
  if (!Array.isArray(input)) return null;
  const rows: AssetSnapshotPoint[] = [];

  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const date = String(obj.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const row: AssetSnapshotPoint = { date };
    SNAPSHOT_NUMERIC_FIELDS.forEach((field) => {
      row[field] = parseNullableNumber(obj[field]);
    });
    row.accountBreakdown = normalizeSnapshotAccountBreakdown(obj.accountBreakdown);
    rows.push(row);
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

function splitTableLine(line: string): string[] {
  if (line.includes("\t")) {
    return line.split("\t").map((cell) => cell.trim());
  }
  return line.split(/\s{2,}/).map((cell) => cell.trim());
}

function parseAssetSnapshotTable(text: string): AssetSnapshotPoint[] | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return null;

  const header = splitTableLine(lines[0]);
  if (header.length < 2 || !header[0].includes("날짜")) return null;
  const dates = header.slice(1).map((d) => d.trim()).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (dates.length === 0) return null;

  const rows: AssetSnapshotPoint[] = dates.map((date) => ({ date }));

  for (const line of lines.slice(1)) {
    const cells = splitTableLine(line);
    if (cells.length < 2) continue;
    const labelKey = normalizeSnapshotLabel(cells[0]);
    const field = SNAPSHOT_FIELD_BY_LABEL[labelKey];
    if (!field) continue;

    dates.forEach((_, index) => {
      const raw = cells[index + 1] ?? "";
      rows[index][field] = parseNullableNumber(raw);
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

function AssetSnapshotEditor({
  value,
  onChange
}: {
  value: AssetSnapshotPoint[];
  onChange: (v: AssetSnapshotPoint[]) => void;
}) {
  const valueKey = JSON.stringify(value);
  const [raw, setRaw] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRaw(JSON.stringify(value, null, 2));
  }, [valueKey, value]);

  const handleChange = (text: string) => {
    setRaw(text);
    const trimmed = text.trim();
    if (!trimmed) {
      onChange([]);
      setError(null);
      return;
    }

    try {
      const parsed = JSON.parse(trimmed);
      const normalized = normalizeAssetSnapshots(parsed);
      if (normalized == null) {
        setError("JSON 배열 형식으로 입력하세요.");
        return;
      }
      onChange(normalized);
      setError(null);
      return;
    } catch {
      // fall through to tabular parser
    }

    const fromTable = parseAssetSnapshotTable(text);
    if (fromTable) {
      onChange(fromTable);
      setError(null);
      return;
    }

    setError("JSON 배열 또는 탭(표) 형식으로 입력하세요.");
  };

  return (
    <>
      <textarea
        value={raw}
        onChange={(e) => handleChange(e.target.value)}
        placeholder='날짜\t2025-07-01\t2025-07-15\n투자(매수금)\t500000\t1000000\n투자(평가금)\t500000\t1025000\n총자산(매수금)\t3120000\t3940516\n총자산(평가금)\t3120000\t3980000'
        style={{ width: "100%", minHeight: 140, padding: 8, fontSize: 12, fontFamily: "monospace" }}
      />
      {error && <p style={{ fontSize: 12, color: "var(--danger)", marginTop: 4 }}>{error}</p>}
    </>
  );
}

function TargetNetWorthCurveEditor({
  value,
  onChange
}: {
  value: Record<string, number>;
  onChange: (v: Record<string, number>) => void;
}) {
  const valueKey = JSON.stringify(value);
  const [raw, setRaw] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRaw(JSON.stringify(value, null, 2));
  }, [valueKey, value]);

  const handleChange = (text: string) => {
    setRaw(text);
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const cleaned: Record<string, number> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof k === "string" && typeof v === "number") cleaned[k] = v;
        }
        onChange(cleaned);
        setError(null);
      }
    } catch {
      setError("유효하지 않은 JSON");
    }
  };

  return (
    <>
      <textarea
        value={raw}
        onChange={(e) => handleChange(e.target.value)}
        placeholder='{"2025-07-01": 3120000, "2025-12-15": 20333151}'
        style={{ width: "100%", minHeight: 100, padding: 8, fontSize: 12, fontFamily: "monospace" }}
      />
      {error && <p style={{ fontSize: 12, color: "var(--danger)", marginTop: 4 }}>{error}</p>}
    </>
  );
}

function getDashboardWidgetNames(dividendTicker?: string): Record<string, string> {
  return {
    summary: "요약 카드",
    assets: "자산 구성",
    income: "수입/지출",
    savingsFlow: "저축·투자 기간별 현황",
    budget: "예산 요약",
    stocks: "주식 성과",
    portfolio: "포트폴리오",
    targetPortfolio: "목표 포트폴리오",
    [WIDGET_ID_DIVIDEND_TRACKING]: dividendTicker ? `배당 추적 (${dividendTicker})` : "배당 추적 (티커 선택)",
    isa: "ISA 포트폴리오",
    realReturn: "연간 진짜 수익률",
    goalPlanner: "목표 역산 플래너",
    investCapacity: "투자 여력 스코어",
    tradeVsSpend: "매매 vs 소비 패턴",
    dividendCoverage: "배당 vs 고정지출",
    concentration: "투자 집중도 vs 소비 다양성"
  };
}

export const SettingsView: React.FC<Props> = ({
  data,
  onChangeData,
  backupVersion,
  onBackupRestored,
  onBackupsChanged,
  onNavigateToRecord,
  onNavigateToTab,
  autoSyncEnabled = false,
  onAutoSyncChange,
  gistLastPushAt,
  gistLastPullAt
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>("backup");
  const [showThemeCustomizer, setShowThemeCustomizer] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const latestBackup = useMemo(() => backups[0], [backups]);
  const { canInstall, isStandalone, install: installPWA } = usePWAInstall();

  const [backupOnSave, setBackupOnSave] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEYS.BACKUP_ON_SAVE) === "true";
  });

  const [priceApiEnabled, setPriceApiEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEYS.PRICE_API_ENABLED) === "true";
  });

  const [gistToken, setGistToken] = useState(() => getGistToken());
  const [gistTokenPersist, setGistTokenPersist] = useState(() => getGistTokenPersisted());
  const [gistId, setGistIdState] = useState(() => getGistId());
  const [gistSyncing, setGistSyncing] = useState(false);
  const [gistLastSync, setGistLastSync] = useState<string | null>(null);

  const [dateAccountId, setDateAccountId] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(STORAGE_KEYS.DATE_ACCOUNT_ID) ?? "";
  });
  const [dateAccountRatio, setDateAccountRatio] = useState(() => {
    if (typeof window === "undefined") return 50;
    const v = Number(localStorage.getItem(STORAGE_KEYS.DATE_ACCOUNT_RATIO));
    return Number.isFinite(v) ? v : 50;
  });

  const [dashboardVisibleWidgets, setDashboardVisibleWidgets] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set(DASHBOARD_WIDGET_ORDER);
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.DASHBOARD_WIDGETS);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        return new Set(Array.isArray(arr) ? arr.map(migrateWidgetId) : DASHBOARD_WIDGET_ORDER);
      }
    } catch (e) {
      console.warn("[SettingsView] 대시보드 위젯 설정 로드 실패", e);
    }
    return new Set(DASHBOARD_WIDGET_ORDER);
  });
  const [dashboardWidgetOrder, setDashboardWidgetOrder] = useState<string[]>(() => {
    if (typeof window === "undefined") return [...DASHBOARD_WIDGET_ORDER];
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.DASHBOARD_WIDGET_ORDER);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed)) {
          // 저장된 순서에서 아직 유효한 위젯은 순서 그대로 유지, 신규 위젯은 뒤에 추가,
          // 제거된 위젯은 drop. 길이 불일치로 전체 초기화하지 않음.
          const currentSet = new Set(DASHBOARD_WIDGET_ORDER);
          const seen = new Set<string>();
          const kept: string[] = [];
          for (const raw of parsed) {
            const id = migrateWidgetId(raw);
            if (currentSet.has(id) && !seen.has(id)) {
              kept.push(id);
              seen.add(id);
            }
          }
          const missing = DASHBOARD_WIDGET_ORDER.filter((id) => !seen.has(id));
          return [...kept, ...missing];
        }
      }
    } catch (e) {
      console.warn("[SettingsView] 위젯 순서 로드 실패", e);
    }
    return [...DASHBOARD_WIDGET_ORDER];
  });
  const loadBackupList = useCallback(async () => {
    try {
      const list = await getAllBackupList();
      setBackups(list);
      return list;
    } catch (error) {
      console.error("백업 목록 로드 실패:", error);
      toast.error(ERROR_MESSAGES.BACKUP_LIST_LOAD_FAILED);
      return [];
    }
  }, []);

  const handleExport = () => {
    try {
      setText(JSON.stringify(data, null, 2));
      setError(null);
      toast.success("현재 데이터를 불러왔습니다.");
    } catch (error) {
      console.error("데이터 내보내기 실패:", error);
      toast.error(ERROR_MESSAGES.DATA_LOAD_FAILED);
      setError("데이터를 불러오는 중 오류가 발생했습니다.");
    }
  };

  // 백업 파일로 다운로드
  const handleDownloadBackup = useCallback(() => {
    try {
      const jsonData = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonData], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const koreaTime = getKoreaTime();
      const year = koreaTime.getFullYear();
      const month = String(koreaTime.getMonth() + 1).padStart(2, "0");
      const day = String(koreaTime.getDate()).padStart(2, "0");
      const hours = String(koreaTime.getHours()).padStart(2, "0");
      const minutes = String(koreaTime.getMinutes()).padStart(2, "0");
      a.download = `farmwallet-backup-${year}${month}${day}-${hours}${minutes}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("백업 파일을 다운로드했습니다.");
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("백업 다운로드 실패:", error);
      }
      toast.error(ERROR_MESSAGES.BACKUP_DOWNLOAD_FAILED);
    }
  }, [data]);

  const handleDownloadTableBackup = useCallback(() => {
    try {
      const payload = buildTableBackupFile(data);
      const jsonData = JSON.stringify(payload, null, 2);
      const blob = new Blob([jsonData], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const koreaTime = getKoreaTime();
      const year = koreaTime.getFullYear();
      const month = String(koreaTime.getMonth() + 1).padStart(2, "0");
      const day = String(koreaTime.getDate()).padStart(2, "0");
      const hours = String(koreaTime.getHours()).padStart(2, "0");
      const minutes = String(koreaTime.getMinutes()).padStart(2, "0");
      a.download = `farmwallet-tables-${year}${month}${day}-${hours}${minutes}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("테이블 백업 JSON을 다운로드했습니다.");
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("테이블 백업 다운로드 실패:", error);
      }
      toast.error(ERROR_MESSAGES.BACKUP_DOWNLOAD_FAILED);
    }
  }, [data]);

  const handleUploadTableBackup = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const toastId = toast.loading("테이블 백업에서 복원하는 중...");
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as unknown;
        const appJson = appDataFromTableBackupPayload(parsed);
        const normalized = normalizeImportedData(appJson);
        onChangeData(normalized);
        setText(JSON.stringify(normalized, null, 2));
        setError(null);
        toast.success("테이블 백업에서 데이터를 복원했습니다.", { id: toastId });
        onBackupRestored?.();
        await loadBackupList();
      } catch (error) {
        setError(ERROR_MESSAGES.TABLE_BACKUP_FILE_INVALID);
        toast.error(ERROR_MESSAGES.TABLE_BACKUP_FILE_INVALID, { id: toastId });
        if (import.meta.env.DEV) {
          console.error("테이블 백업 불러오기 오류:", error);
        }
      }
    };
    input.click();
  }, [onChangeData, loadBackupList, onBackupRestored]);

  const handleExportLedgerMd = useCallback(async () => {
    try {
      const { generateLedgerMarkdownReport } = await import("../utils/ledgerMarkdownReport");
      const md = generateLedgerMarkdownReport(data.ledger, data.accounts);
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "정리.md";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("정리.md를 다운로드했습니다. 프로젝트의 정리.md를 덮어쓰면 됩니다.");
    } catch (err) {
      if (import.meta.env.DEV) console.error("정리.md 내보내기 실패:", err);
      toast.error(ERROR_MESSAGES.EXPORT_MARKDOWN_FAILED);
    }
  }, [data.ledger, data.accounts]);

  const handleResetAllData = useCallback(() => {
    if (!window.confirm("가계부, 주식, 계좌 등 모든 데이터가 삭제됩니다. 복구할 수 없습니다. 정말 초기화하시겠습니까?")) return;
    try {
      const empty = getEmptyData();
      saveData(empty);
      onChangeData(empty);
      setText(JSON.stringify(empty, null, 2));
      setError(null);
      toast.success("모든 데이터가 초기화되었습니다. 처음부터 다시 사용할 수 있습니다.");
    } catch (err) {
      if (import.meta.env.DEV) console.error("데이터 초기화 실패:", err);
      toast.error("초기화 중 오류가 발생했습니다.");
    }
  }, [onChangeData]);

  const handleExportUnifiedCsv = useCallback(async () => {
    try {
      const { buildUnifiedCsv } = await import("../utils/unifiedCsvExport");
      const csvContent = buildUnifiedCsv(
        data.ledger,
        data.trades,
        data.accounts,
        data.categoryPresets
      );
      const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const k = getKoreaTime();
      const y = k.getFullYear();
      const m = String(k.getMonth() + 1).padStart(2, "0");
      const d = String(k.getDate()).padStart(2, "0");
      a.download = `가계부_주식_통합_${y}-${m}-${d}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("가계부·주식 통합 CSV를 다운로드했습니다.");
    } catch (err) {
      if (import.meta.env.DEV) console.error("통합 CSV 내보내기 실패:", err);
      toast.error("CSV 내보내기 중 오류가 발생했습니다.");
    }
  }, [data.ledger, data.trades, data.accounts, data.categoryPresets]);

  // 백업 파일에서 불러오기
  const handleUploadBackup = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      const toastId = toast.loading("백업 파일을 불러오는 중...");
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const normalized = normalizeImportedData(parsed);
        onChangeData(normalized);
        setText(JSON.stringify(normalized, null, 2));
        setError(null);
        toast.success("백업 파일을 성공적으로 불러왔습니다.", { id: toastId });
        onBackupRestored?.();
        await loadBackupList();
      } catch (error) {
        setError(ERROR_MESSAGES.BACKUP_FILE_INVALID);
        toast.error(ERROR_MESSAGES.BACKUP_FILE_INVALID, { id: toastId });
        if (import.meta.env.DEV) {
          console.error("백업 파일 불러오기 오류:", error);
        }
      }
    };
    input.click();
  }, [onChangeData, loadBackupList, onBackupRestored]);

  const handleImport = useCallback(() => {
    try {
      if (!text || !text.trim()) {
        toast.error(ERROR_MESSAGES.JSON_INPUT_REQUIRED);
        setError(ERROR_MESSAGES.JSON_INPUT_REQUIRED);
        return;
      }
      const parsed = JSON.parse(text);
      const normalized = normalizeImportedData(parsed);
      onChangeData(normalized);
      setText(JSON.stringify(normalized, null, 2));
      setError(null);
      toast.success("데이터를 성공적으로 불러왔습니다.");
      onBackupRestored?.();
    } catch (e) {
      setError(ERROR_MESSAGES.JSON_FORMAT_INVALID);
      toast.error(ERROR_MESSAGES.JSON_FORMAT_INVALID);
      if (import.meta.env.DEV) {
        console.error("JSON 파싱 오류:", e);
      }
    }
  }, [text, onChangeData, onBackupRestored]);

  const handleRefreshBackups = useCallback(async () => {
    const toastId = toast.loading("백업 목록을 불러오는 중...");
    try {
      const list = await loadBackupList();
      toast.success(`백업 목록을 새로고침했습니다. (${list.length}개)`, { id: toastId });
    } catch {
      toast.error(ERROR_MESSAGES.BACKUP_REFRESH_FAILED, { id: toastId });
    }
  }, [loadBackupList]);

  const handleClearOldBackups = useCallback(() => {
    const removed = clearOldBackups(1);
    if (removed > 0) {
      toast.success(`오래된 백업 ${removed}개를 삭제했습니다. 저장 공간이 확보되었습니다.`);
      void loadBackupList();
      void onBackupsChanged?.();
    } else {
      toast("삭제할 오래된 백업이 없습니다. (최신 1개만 유지 중)");
    }
  }, [loadBackupList, onBackupsChanged]);

  const handleRestoreBackup = useCallback(async (entry: BackupEntry) => {
    const toastId = toast.loading("백업을 복원하는 중...");
    try {
      let restored: AppData | null = null;
      // 로컬 백업만 복원
      if (entry.source === "browser") {
        restored = loadBackupData(entry.id);
      } else {
        // 서버 백업은 복원하지 않음
        toast.error(ERROR_MESSAGES.SERVER_BACKUP_DISABLED, { id: toastId });
        return;
      }

      if (!restored) {
        setError(ERROR_MESSAGES.BACKUP_SELECTED_NOT_FOUND);
        toast.error(ERROR_MESSAGES.BACKUP_SELECTED_NOT_FOUND, { id: toastId });
        return;
      }
      
      const normalized = normalizeImportedData(restored);
      onChangeData(normalized);
      setText(JSON.stringify(normalized, null, 2));
      setError(null);
      toast.success("백업이 성공적으로 복원되었습니다.", { id: toastId });
      onBackupRestored?.();
      await loadBackupList();
    } catch (e) {
      setError(ERROR_MESSAGES.BACKUP_RESTORE_FAILED);
      toast.error(ERROR_MESSAGES.BACKUP_RESTORE_FAILED, { id: toastId });
      if (import.meta.env.DEV) {
        console.error("백업 복원 오류:", e);
      }
    }
  }, [onChangeData, loadBackupList, onBackupRestored]);

  useEffect(() => {
    if (activeTab !== "backup") return;
    void loadBackupList();
  }, [activeTab, backupVersion, loadBackupList]);

  useEffect(() => {
    if (activeTab === "backup") {
      setBackupOnSave(localStorage.getItem(STORAGE_KEYS.BACKUP_ON_SAVE) === "true");
      setPriceApiEnabled(localStorage.getItem(STORAGE_KEYS.PRICE_API_ENABLED) === "true");
    }
    if (activeTab !== "dashboard") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.DASHBOARD_WIDGETS);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        setDashboardVisibleWidgets(new Set(Array.isArray(arr) ? arr.map(migrateWidgetId) : DASHBOARD_WIDGET_ORDER));
      }
      const rawOrder = localStorage.getItem(STORAGE_KEYS.DASHBOARD_WIDGET_ORDER);
      if (rawOrder) {
        const parsed = JSON.parse(rawOrder) as string[];
        if (Array.isArray(parsed) && parsed.length === DASHBOARD_WIDGET_ORDER.length) setDashboardWidgetOrder(parsed.map(migrateWidgetId));
      }
    } catch (e) {
      console.warn("[SettingsView] 탭 전환 시 위젯 순서 로드 실패", e);
    }
  }, [activeTab]);

  const dashboardSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (dashboardSaveTimerRef.current) clearTimeout(dashboardSaveTimerRef.current);
    dashboardSaveTimerRef.current = setTimeout(() => {
      localStorage.setItem(STORAGE_KEYS.DASHBOARD_WIDGETS, JSON.stringify(Array.from(dashboardVisibleWidgets)));
      dashboardSaveTimerRef.current = null;
    }, 300);
    return () => {
      if (dashboardSaveTimerRef.current) clearTimeout(dashboardSaveTimerRef.current);
    };
  }, [dashboardVisibleWidgets]);

  const dashboardOrderSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (dashboardOrderSaveTimerRef.current) clearTimeout(dashboardOrderSaveTimerRef.current);
    dashboardOrderSaveTimerRef.current = setTimeout(() => {
      localStorage.setItem(STORAGE_KEYS.DASHBOARD_WIDGET_ORDER, JSON.stringify(dashboardWidgetOrder));
      dashboardOrderSaveTimerRef.current = null;
    }, 300);
    return () => {
      if (dashboardOrderSaveTimerRef.current) clearTimeout(dashboardOrderSaveTimerRef.current);
    };
  }, [dashboardWidgetOrder]);

  const toggleDashboardWidget = (id: string) => {
    setDashboardVisibleWidgets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const moveDashboardWidgetOrder = (id: string, direction: "up" | "down") => {
    const idx = dashboardWidgetOrder.indexOf(id);
    if (idx === -1) return;
    const swap = direction === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= dashboardWidgetOrder.length) return;
    setDashboardWidgetOrder((prev) => {
      const next = [...prev];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  };

  return (
    <div>
      <h2>백업 / 복원 / 설정</h2>
      
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {([
          ["backup", "백업/복원"],
          ["integrity", "데이터 무결성"],
          ["theme", "테마 설정"],
          ["accessibility", "접근성"],
          ["dashboard", "대시보드 위젯"],
          ["savingsMigration", "저축성지출 수정"],
        ] as const).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            className={activeTab === tab ? "primary" : ""}
            onClick={() => setActiveTab(tab)}
            style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600, borderRadius: 8 }}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "backup" && (
        <>
          {(canInstall || isStandalone) && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">앱처럼 사용하기</div>
              {isStandalone ? (
                <p style={{ margin: 0, color: "var(--text-muted)" }}>
                  홈 화면에서 실행 중입니다. 오프라인에서도 캐시된 화면을 볼 수 있습니다.
                </p>
              ) : canInstall ? (
                <p style={{ margin: "0 0 12px 0", color: "var(--text-muted)" }}>
                  홈 화면에 추가하면 앱처럼 실행하고, 오프라인에서도 사용할 수 있습니다.
                </p>
              ) : null}
              {canInstall && (
                <button type="button" className="primary" onClick={async () => {
                  const ok = await installPWA();
                  if (ok) toast.success("홈 화면에 추가되었습니다.");
                }}>
                  홈 화면에 추가
                </button>
              )}
            </div>
          )}
          <div className="cards-row">
        <div className="card">
          <div className="card-title">데이터 백업</div>
          <p>
            <strong style={{ color: "var(--warning)" }}>⚠️ 중요:</strong> 웹 브라우저와 Cursor 내부 브라우저는 서로 다른 저장소(localStorage)를 사용합니다. 
            웹에서 저장한 백업은 Cursor 내부에서 보이지 않으며, 그 반대도 마찬가지입니다.
            <br />
            <strong>다른 환경에서 백업을 사용하려면:</strong> "백업 파일 다운로드"로 파일을 저장한 후, 다른 환경에서 "백업 파일 불러오기"로 불러오세요.
            <br />
            <strong style={{ color: "var(--primary)" }}>권장:</strong> 데이터 안전을 위해 정기적으로 "백업 파일 다운로드"로 JSON 파일을 저장해 두세요.
            <br />
            <strong>테이블 백업:</strong> 같은 데이터를 <code>tables</code> 아래 행 배열로도 저장합니다. 일반 백업 JSON 없이{" "}
            <strong>테이블 백업 파일만</strong>으로도 복구할 수 있습니다. 데이터를 저장할 때마다 브라우저에 사본이 갱신되고,{" "}
            <code>npm run dev</code>일 때는 프로젝트 <code>data/farmwallet-data.json</code>에도 기록됩니다.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--chart-income)", marginBottom: 6 }}>💾 내보내기 (안전)</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="primary" onClick={handleDownloadBackup} style={{ background: "var(--chart-income)", border: "none", color: "white" }}>
                  백업 파일 다운로드
                </button>
                <button type="button" onClick={handleDownloadTableBackup} style={{ background: "var(--surface)", border: "1px solid var(--chart-income)", color: "var(--chart-income)" }}>
                  테이블 백업 다운로드
                </button>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--warning, orange)", marginBottom: 6 }}>⚠️ 불러오기 (현재 데이터 덮어쓰기)</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={handleUploadBackup} style={{ background: "var(--surface)", border: "2px solid orange", color: "var(--text)" }}>
                  백업 파일에서 복원
                </button>
                <button type="button" onClick={handleUploadTableBackup} style={{ background: "var(--surface)", border: "2px solid orange", color: "var(--text)" }}>
                  테이블 백업에서 복원
                </button>
                <button type="button" onClick={handleExport} style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 12 }}>
                  현재 데이터 새로고침
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-title">가계부 정리 (정리.md)</div>
          <p>
            수입·지출·저축성 지출·이체 전체가 포함된 마크다운을 <code>정리.md</code>로 다운로드합니다.
            표 스타일로 정리된 문서를 프로젝트에 저장해 두면 됩니다.
          </p>
          <button type="button" className="primary" onClick={handleExportLedgerMd}>
            정리.md 내보내기
          </button>
        </div>
        <div className="card">
          <div className="card-title">가계부·주식 통합 CSV</div>
          <p>
            수입·지출·이체(가계부)와 주식 매수·매도 기록을 <strong>일자순으로 한 CSV 파일</strong>로 내보냅니다.
            데이터구분(가계부/주식), 일자, 구분, 대분류·금액·계좌(가계부), 티커·수량·단가·총액(주식) 등이 포함됩니다.
          </p>
          <button type="button" className="primary" onClick={handleExportUnifiedCsv}>
            통합 CSV 내보내기
          </button>
        </div>
        <div className="card">
          <div className="card-title">앱 로그 내보내기</div>
          <p className="hint" style={{ marginBottom: 12 }}>
            로컬에 보관된 최근 활동 로그(최대 500건)를 JSON 파일로 다운로드합니다. 문제 진단·이슈 보고 시 첨부하세요.
          </p>
          <button
            type="button"
            onClick={() => {
              const logs = useUIStore.getState().appLog;
              const payload = { exportedAt: new Date().toISOString(), count: logs.length, logs };
              const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              const today = new Date().toISOString().slice(0, 10);
              a.href = url;
              a.download = `farmwallet-app-log-${today}.json`;
              a.click();
              URL.revokeObjectURL(url);
              toast.success(`로그 ${logs.length}건 다운로드`);
            }}
            style={{ padding: "8px 16px", fontSize: 13 }}
          >
            📥 로그 JSON 다운로드
          </button>
        </div>
        <div className="card">
          <div className="card-title">데이터 초기화</div>
          <p>
            <strong style={{ color: "var(--danger)" }}>⚠️ 주의:</strong> 가계부, 주식 거래, 계좌, 예산, 배당·이자 등 <strong>모든 앱 데이터를 삭제</strong>하고 빈 상태로 되돌립니다. 복구할 수 없으니 필요 시 먼저 "백업 파일 다운로드"로 저장해 두세요.
          </p>
          <button
            type="button"
            onClick={handleResetAllData}
            style={{ background: "var(--danger)", color: "white", border: "none", fontWeight: 700, padding: "10px 20px", fontSize: 14 }}
          >
            🗑️ 모든 데이터 초기화하고 처음부터 다시 하기
          </button>
        </div>
        <div className="card">
          <div className="card-title">자동 백업 스냅샷</div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={backupOnSave}
              onChange={(e) => {
                const v = e.target.checked;
                setBackupOnSave(v);
                if (typeof window !== "undefined") {
                  localStorage.setItem(STORAGE_KEYS.BACKUP_ON_SAVE, v ? "true" : "false");
                  toast.success(v ? "저장 시 스냅샷 저장을 켰습니다." : "저장 시 스냅샷 저장을 껐습니다.");
                }
              }}
            />
            <span>저장할 때마다 스냅샷 저장 (자동 저장·수동 저장 시 백업 스냅샷 함께 생성)</span>
          </label>
          <p>최근 20개까지 자동으로 저장된 백업 목록입니다. 원하는 시점으로 되돌릴 수 있습니다.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <button type="button" onClick={handleRefreshBackups}>
              백업 목록 새로고침
            </button>
            <button
              type="button"
              className="secondary"
              onClick={handleClearOldBackups}
              title="저장 공간 부족 시 브라우저의 오래된 백업을 삭제합니다. 최신 1개만 유지합니다."
            >
              저장 공간 확보 (오래된 백업 삭제)
            </button>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            {latestBackup
              ? `총 ${backups.length}개 · 최근 백업: ${new Date(
                  latestBackup.createdAt
                ).toLocaleString("ko-KR", {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Asia/Seoul"
                })}`
              : "아직 저장된 백업이 없습니다. 상단의 '백업 스냅샷 저장' 버튼을 눌러주세요."}
          </div>
        </div>
        <div className="card">
          <div className="card-title">가격 API</div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={priceApiEnabled}
              onChange={(e) => {
                const v = e.target.checked;
                setPriceApiEnabled(v);
                if (typeof window !== "undefined") {
                  localStorage.setItem(STORAGE_KEYS.PRICE_API_ENABLED, v ? "true" : "false");
                  toast.success(v ? "가격 API 사용을 켰습니다." : "가격 API 사용을 껐습니다.");
                }
              }}
            />
            <span>가격 API 사용 (외부 API로 주식 가격 배치 갱신)</span>
          </label>
          <p className="hint" style={{ marginTop: 4 }}>
            켜면 주식 탭에서 보유 종목 가격을 30분마다 자동으로 배치 갱신합니다 (탭이 보일 때만 동작).
          </p>
        </div>
        <div className="card">
          <div className="card-title">클라우드 동기화 (GitHub Gist)</div>
          <p className="hint" style={{ marginBottom: 12 }}>
            GitHub Personal Access Token (gist 권한)으로 데이터를 Private Gist에 저장/불러옵니다.
            <br />다른 기기에서도 동일한 토큰 + Gist ID로 데이터를 공유할 수 있습니다.
          </p>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ minWidth: 80 }}>Token</span>
            <input
              type="password"
              value={gistToken}
              onChange={(e) => { setGistToken(e.target.value); gistSetToken(e.target.value, { persist: gistTokenPersist }); }}
              placeholder="ghp_xxxxxxxxxxxx"
              autoComplete="off"
              spellCheck={false}
              style={{ flex: 1, padding: "6px 10px", borderRadius: 6, fontFamily: "monospace", fontSize: 12 }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 12, color: "var(--muted, #666)" }}>
            <input
              type="checkbox"
              checked={gistTokenPersist}
              onChange={(e) => {
                const next = e.target.checked;
                setGistTokenPersist(next);
                gistSetTokenPersisted(next);
                toast(next
                  ? "토큰이 이 기기에 영구 저장됩니다 (XSS 위험 증가)."
                  : "토큰은 이 탭에서만 유지됩니다 (탭을 닫으면 재입력 필요).");
              }}
            />
            <span>이 기기에서 기억 (꺼두면 탭 닫을 때 토큰 삭제 — 권장)</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ minWidth: 80 }}>Gist ID</span>
            <input
              type="text"
              value={gistId}
              onChange={(e) => { setGistIdState(e.target.value); gistSetId(e.target.value); }}
              placeholder="자동 생성됨 (첫 저장 시)"
              style={{ flex: 1, padding: "6px 10px", borderRadius: 6, fontFamily: "monospace", fontSize: 12 }}
              readOnly={false}
            />
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--chart-income)", marginBottom: 6 }}>Gist에 저장 (안전 — 현재 데이터를 백업)</div>
              <button
                type="button"
                disabled={gistSyncing || !gistToken}
                onClick={async () => {
                  setGistSyncing(true);
                  try {
                    const jsonStr = toUserDataJson(data);
                    const result = await saveToGist(jsonStr);
                    setGistIdState(result.gistId);
                    setGistLastSync(result.updatedAt);
                    toast.success("Gist에 저장 완료");
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    toast.error(msg || "Gist 저장 실패");
                  } finally {
                    setGistSyncing(false);
                  }
                }}
                style={{ background: "var(--chart-income)", border: "none", color: "white", padding: "8px 20px", borderRadius: 8, fontWeight: 600 }}
              >
                {gistSyncing ? "동기화 중..." : "Gist에 저장"}
              </button>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--warning, orange)", marginBottom: 6 }}>Gist에서 불러오기 (현재 데이터 덮어쓰기)</div>
              <button
                type="button"
                disabled={gistSyncing || !gistToken || !gistId}
                onClick={async () => {
                  setGistSyncing(true);
                  try {
                    const result = await loadFromGist();
                    const parsed = JSON.parse(result.dataJson);
                    // Gist에 없는 API 캐시 데이터는 현재 메모리의 것을 유지
                    onChangeData({
                      ...parsed,
                      prices: parsed.prices?.length > 0 ? parsed.prices : data.prices,
                      tickerDatabase: parsed.tickerDatabase?.length > 0 ? parsed.tickerDatabase : data.tickerDatabase,
                      historicalDailyCloses: parsed.historicalDailyCloses?.length > 0 ? parsed.historicalDailyCloses : data.historicalDailyCloses,
                    });
                    setGistLastSync(result.updatedAt);
                    toast.success("Gist에서 불러오기 완료");
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    toast.error(msg || "Gist 불러오기 실패");
                  } finally {
                    setGistSyncing(false);
                  }
                }}
                style={{ background: "var(--surface)", border: "2px solid orange", color: "var(--text)", padding: "8px 20px", borderRadius: 8, fontWeight: 600 }}
              >
                Gist에서 불러오기
              </button>
            </div>
          </div>
          {gistLastSync && (
            <p className="hint" style={{ marginTop: 8 }}>
              마지막 동기화: {new Date(gistLastSync).toLocaleString("ko-KR")}
            </p>
          )}
          <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <div className="card-title" style={{ fontSize: 13, marginBottom: 8 }}>자동 동기화</div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: (!gistToken || !gistId) ? "not-allowed" : "pointer" }}>
              <input
                type="checkbox"
                checked={autoSyncEnabled}
                disabled={!gistToken || !gistId}
                onChange={(e) => {
                  onAutoSyncChange?.(e.target.checked);
                  toast.success(e.target.checked ? "자동 동기화를 켰습니다." : "자동 동기화를 껐습니다.");
                }}
              />
              <span style={{ fontSize: 13 }}>자동 동기화 사용 (데이터 변경 후 5분 뒤 자동 저장 · 앱 시작 시 자동 불러오기)</span>
            </label>
            {(!gistToken || !gistId) && (
              <p className="hint">Token과 Gist ID를 먼저 설정해야 자동 동기화를 사용할 수 있습니다.</p>
            )}
            {gistLastPushAt && (
              <p className="hint" style={{ marginTop: 4 }}>
                마지막 자동 저장: {new Date(gistLastPushAt).toLocaleString("ko-KR")}
              </p>
            )}
            {gistLastPullAt && (
              <p className="hint" style={{ marginTop: 2 }}>
                마지막 자동 불러오기: {new Date(gistLastPullAt).toLocaleString("ko-KR")}
              </p>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-title">데이트통장 설정</div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ minWidth: 80 }}>데이트통장</span>
            <select
              value={dateAccountId}
              onChange={(e) => {
                const v = e.target.value;
                setDateAccountId(v);
                localStorage.setItem(STORAGE_KEYS.DATE_ACCOUNT_ID, v);
                notifyDateAccountChange();
                toast.success(v ? `데이트통장: ${v}` : "데이트통장 해제");
              }}
              style={{ flex: 1, padding: "6px 10px", borderRadius: 6 }}
            >
              <option value="">선택 안 함</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.id} ({a.name})</option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ minWidth: 80 }}>본인 부담</span>
            <input
              type="number"
              min={0}
              max={100}
              value={dateAccountRatio}
              onChange={(e) => {
                const v = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                setDateAccountRatio(v);
                localStorage.setItem(STORAGE_KEYS.DATE_ACCOUNT_RATIO, String(v));
                notifyDateAccountChange();
              }}
              style={{ width: 70, padding: "6px 10px", borderRadius: 6, textAlign: "right" }}
            />
            <span>%</span>
          </label>
          <p className="hint" style={{ marginTop: 8 }}>
            데이트통장에서 나간 지출은 설정 비율만 본인 부담으로 계산합니다. (기본 50%)
          </p>
        </div>
      </div>

      <table className="data-table compact">
        <thead>
          <tr>
            <th style={{ width: "55%" }}>백업 시각</th>
            <th style={{ width: "25%" }}>저장 위치</th>
            <th>복원</th>
          </tr>
        </thead>
        <tbody>
          {backups.length === 0 && (
            <tr>
              <td colSpan={3} style={{ textAlign: "center" }}>
                백업 기록이 없습니다.
              </td>
            </tr>
          )}
          {backups.map((b) => (
            <tr key={`${b.source}-${b.id}`}>
              <td>
                {new Date(b.createdAt).toLocaleString("ko-KR", {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Asia/Seoul"
                })}
              </td>
              <td>{b.source === "server" ? "로컬 파일" : "브라우저 저장소"}</td>
              <td>
                <button type="button" onClick={() => handleRestoreBackup(b)}>
                  이 시점으로 복원
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <textarea
        className="json-editor"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="JSON을 붙여넣거나 위 '현재 데이터 다시 불러오기'를 눌러주세요."
        rows={20}
      />
      <div className="form-actions">
        <button type="button" className="primary" onClick={handleImport}>
          JSON 불러오기
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
        </>
      )}

      {activeTab === "integrity" && (
        <Suspense fallback={<div className="card" style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>로딩 중...</div>}>
          <DataIntegrityView
            data={data}
            onChangeData={onChangeData}
            onNavigateToRecord={onNavigateToRecord}
            onNavigateToTab={onNavigateToTab}
          />
        </Suspense>
      )}

      {activeTab === "theme" && (
        <div className="card">
          <h3>테마 및 표시 설정</h3>
          <button
            type="button"
            className="primary"
            onClick={() => setShowThemeCustomizer(true)}
          >
            테마 커스터마이저 열기
          </button>
        </div>
      )}

      {showThemeCustomizer && (
        <Suspense fallback={<div style={{ padding: 24, textAlign: "center" }}>로딩 중...</div>}>
          <ThemeCustomizer onClose={() => setShowThemeCustomizer(false)} />
        </Suspense>
      )}

      {activeTab === "accessibility" && (
        <div className="card">
          <h3>접근성 설정</h3>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={typeof document !== "undefined" && document.documentElement.classList.contains("high-contrast")}
              onChange={(e) => {
                if (typeof document !== "undefined") {
                  if (e.target.checked) {
                    document.documentElement.classList.add("high-contrast");
                    localStorage.setItem("fw-high-contrast", "true");
                  } else {
                    document.documentElement.classList.remove("high-contrast");
                    localStorage.setItem("fw-high-contrast", "false");
                  }
                }
              }}
            />
            <span>고대비 모드 활성화</span>
          </label>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
            고대비 모드는 시각적 대비를 높여 가독성을 향상시킵니다.
          </p>
        </div>
      )}

      {activeTab === "dashboard" && (
        <div className="card">
          <h3>대시보드 위젯 표시 및 순서</h3>
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="dividend-tracking-ticker" style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>배당 추적 위젯 티커</label>
            <input
              id="dividend-tracking-ticker"
              type="text"
              placeholder="예: 458730"
              value={data.dividendTrackingTicker ?? ""}
              onChange={(e) => onChangeData({ ...data, dividendTrackingTicker: e.target.value.trim() || undefined })}
              style={{ width: "100%", maxWidth: 200, padding: "8px 12px" }}
            />
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              대시보드 배당 추적 위젯에 표시할 종목 티커. 비워두면 위젯에서 티커 선택 안내가 표시됩니다.
            </p>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
            표시 여부를 선택하고, 순서는 위/아래로 변경할 수 있습니다. 대시보드 탭에서도 동일하게 적용됩니다.
          </p>
          {dashboardWidgetOrder.map((id, index) => (
            <div
              key={id}
              style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}
            >
              <input
                type="checkbox"
                id={`settings-widget-${id}`}
                checked={dashboardVisibleWidgets.has(id)}
                onChange={() => toggleDashboardWidget(id)}
              />
              <label htmlFor={`settings-widget-${id}`} style={{ flex: 1 }}>
                {getDashboardWidgetNames(data.dividendTrackingTicker)[id] ?? id}
              </label>
              <button
                type="button"
                className="secondary"
                style={{ padding: "4px 8px", fontSize: 11 }}
                onClick={() => moveDashboardWidgetOrder(id, "up")}
                disabled={index === 0}
                title="위로"
              >
                위
              </button>
              <button
                type="button"
                className="secondary"
                style={{ padding: "4px 8px", fontSize: 11 }}
                onClick={() => moveDashboardWidgetOrder(id, "down")}
                disabled={index === dashboardWidgetOrder.length - 1}
                title="아래로"
              >
                아래
              </button>
            </div>
          ))}
          <h3 style={{ marginTop: 24, marginBottom: 12 }}>ISA 목표 포트폴리오</h3>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
            대시보드 ISA 위젯에 표시될 목표 비중을 편집합니다. 비중 합계는 100%가 되도록 조정하세요.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table compact" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>라벨</th>
                  <th>티커</th>
                  <th>종목명</th>
                  <th style={{ width: 80 }}>비중 (%)</th>
                  <th style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {(data.isaPortfolio ?? ISA_PORTFOLIO.map((item) => ({ ticker: item.ticker, name: item.name, weight: item.weight, label: item.label }))).map((item, index) => (
                  <tr key={`${item.ticker}-${index}`}>
                    <td>
                      <input
                        type="text"
                        value={item.label}
                        onChange={(e) => {
                          const list = [...(data.isaPortfolio ?? ISA_PORTFOLIO.map((i) => ({ ticker: i.ticker, name: i.name, weight: i.weight, label: i.label })))];
                          list[index] = { ...list[index], label: e.target.value };
                          onChangeData({ ...data, isaPortfolio: list });
                        }}
                        style={{ width: "100%", padding: "4px 8px", fontSize: 12 }}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={item.ticker}
                        onChange={(e) => {
                          const list = [...(data.isaPortfolio ?? ISA_PORTFOLIO.map((i) => ({ ticker: i.ticker, name: i.name, weight: i.weight, label: i.label })))];
                          list[index] = { ...list[index], ticker: e.target.value };
                          onChangeData({ ...data, isaPortfolio: list });
                        }}
                        style={{ width: "100%", padding: "4px 8px", fontSize: 12 }}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={item.name}
                        onChange={(e) => {
                          const list = [...(data.isaPortfolio ?? ISA_PORTFOLIO.map((i) => ({ ticker: i.ticker, name: i.name, weight: i.weight, label: i.label })))];
                          list[index] = { ...list[index], name: e.target.value };
                          onChangeData({ ...data, isaPortfolio: list });
                        }}
                        style={{ width: "100%", padding: "4px 8px", fontSize: 12 }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={item.weight}
                        onChange={(e) => {
                          const list = [...(data.isaPortfolio ?? ISA_PORTFOLIO.map((i) => ({ ticker: i.ticker, name: i.name, weight: i.weight, label: i.label })))];
                          list[index] = { ...list[index], weight: Number(e.target.value) || 0 };
                          onChangeData({ ...data, isaPortfolio: list });
                        }}
                        style={{ width: "100%", padding: "4px 8px", fontSize: 12 }}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="secondary"
                        style={{ padding: "4px 8px", fontSize: 11 }}
                        onClick={() => {
                          const list = (data.isaPortfolio ?? ISA_PORTFOLIO.map((i) => ({ ticker: i.ticker, name: i.name, weight: i.weight, label: i.label }))).filter((_, i) => i !== index);
                          onChangeData({ ...data, isaPortfolio: list });
                        }}
                        title="삭제"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="secondary"
            style={{ marginTop: 8 }}
            onClick={() => {
              const list = data.isaPortfolio ?? ISA_PORTFOLIO.map((i) => ({ ticker: i.ticker, name: i.name, weight: i.weight, label: i.label }));
              onChangeData({
                ...data,
                isaPortfolio: [...list, { ticker: "", name: "", weight: 0, label: "" }]
              });
            }}
          >
            + 종목 추가
          </button>

          <h3 style={{ marginTop: 24, marginBottom: 12 }}>자산 스냅샷(반월/일별)</h3>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
            표를 그대로 붙여넣거나(JSON 배열도 가능) 날짜별 자산 스냅샷을 저장합니다. 저장된 값은 대시보드에서
            총자산(매수금/평가금), 투자성과, 1일/15일 수익률로 시각화됩니다.
          </p>
          <AssetSnapshotEditor
            value={data.assetSnapshots ?? []}
            onChange={(assetSnapshots) => onChangeData({ ...data, assetSnapshots })}
          />

          <h3 style={{ marginTop: 24, marginBottom: 12 }}>목표 자산 곡선</h3>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
            2026년 1월 이전 구간에서 참고용으로 표시할 목표 자산 금액. 날짜(YYYY-MM-DD)를 키로, 금액을 값으로 하는 JSON. 비워두면 해당 구간은 0원으로 표시됩니다.
          </p>
          <TargetNetWorthCurveEditor
            value={data.targetNetWorthCurve ?? {}}
            onChange={(targetNetWorthCurve) => onChangeData({ ...data, targetNetWorthCurve })}
          />
        </div>
      )}

      {activeTab === "savingsMigration" && (
        <Suspense fallback={<div className="card" style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>로딩 중...</div>}>
          <SavingsMigrationView data={data} onChangeData={onChangeData} />
        </Suspense>
      )}

    </div>
  );
};

