import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { FxRateProvider } from "./context/FxRateContext";
import { installGlobalErrorListeners, reportError } from "./utils/errorReporting";
import type { AppData } from "./types";
import "./styles.css";

// 전역 미처리 오류(window.error / unhandledrejection) → 영속 활동 로그. 내부에서 중복 설치를 막는다.
installGlobalErrorListeners();

// 포커스된 type="number" 입력 위에서 휠을 굴리면 Chrome/Edge가 값을 바꾼다(71,500 → 71,497 저장).
// 그 입력을 blur하면 값 변경만 막히고 페이지 스크롤은 그대로 — 화면마다 onWheel을 다는 대신 여기 한 곳에서.
// (단축키 keydown이 아니라 휠이므로 CLAUDE.md 규칙 10과 무관)
document.addEventListener(
  "wheel",
  (e) => {
    const el = document.activeElement;
    if (el instanceof HTMLInputElement && el.type === "number" && e.target === el) el.blur();
  },
  { capture: true, passive: true }
);

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("루트 요소를 찾을 수 없습니다.");
}

// service worker disabled (we removed public/sw.js)

async function restoreLatestBackup(): Promise<void> {
  const storage = await import("./storage");
  const list = await storage.getAllBackupList();
  if (!list.length) {
    throw new Error("복원 가능한 백업이 없습니다.");
  }

  const latest = list[0];
  let backupData = null;
  if (latest.source === "server" && latest.fileName) {
    backupData = await storage.loadServerBackupData(latest.fileName);
  } else {
    // 로컬 백업은 SHA-256 무결성 검증 — 손상 감지 시 사용자 확인 후에만 진행.
    // (에러 화면의 최후 복원 경로가 손상 백업을 무경고로 정식 데이터로 승격시키던 유실 경로 차단)
    const verified = await storage.loadBackupDataVerified(latest.id);
    if (verified.status === "mismatch") {
      const proceed = window.confirm(
        "최신 백업의 무결성 검증에 실패했습니다(손상 가능성).\n그래도 이 백업으로 복원하시겠습니까? 취소하면 복원을 중단합니다."
      );
      if (!proceed) throw new Error("백업 무결성 검증 실패 — 복원을 취소했습니다.");
    }
    backupData = verified.data;
  }

  if (!backupData) {
    throw new Error("최신 백업 데이터를 읽을 수 없습니다.");
  }

  // 덮어쓰기 전 현재 상태를 안전 스냅샷으로 (best-effort) — 복원이 더 나쁜 상태를 만들어도 되돌릴 수 있게.
  // 현재 데이터가 손상돼 loadData가 throw해도 복원 자체는 진행한다.
  let current: AppData | null = null;
  try {
    current = storage.loadData();
    await storage.saveSafetySnapshot(current, "에러화면 자동복원 직전");
  } catch {
    /* 현재 데이터 읽기 실패 시 스냅샷 건너뜀 */
  }

  // 백업 본문은 user-only(시세·티커 캐시 제외) — 현재 캐시를 읽을 수 있으면 병합해 빈 캐시로 덮지 않는다
  const normalized = storage.mergeCurrentCaches(storage.normalizeImportedData(backupData), current);
  storage.saveData(normalized);
}

async function resetAllData(): Promise<void> {
  const storage = await import("./storage");
  storage.saveData(storage.getEmptyData());
}

/**
 * GAS 웹앱: 앱을 그리기 전에 시트 장부를 기기 저장소에 채택한다 — 시트가 원본, 기기는 캐시.
 * 기기에 시트로 올라가지 않은 편집(마지막 저장 해시와 다름)이 있으면 덮기 전에 안전 스냅샷으로 남긴다.
 * 채택 후 마지막 저장/불러오기 시각·해시를 시트 기준으로 맞춰, 자동 동기화가 "처음 연결"이나
 * 가짜 충돌로 보지 않게 한다. 일반 브라우저에서는 아무것도 하지 않는다.
 */
async function adoptSheetData(): Promise<void> {
  const { isGas, loadSheetForBoot } = await import("./services/gas");
  if (!isGas()) return;
  setBootStage(2, "");
  const startedAt = Date.now();
  const timer = window.setInterval(() => {
    setBootStage(2, `${Math.round((Date.now() - startedAt) / 1000)}초`);
  }, 1000);
  let sheet: import("./services/gas").GasLoadResult;
  try {
    sheet = await loadSheetForBoot();
  } finally {
    window.clearInterval(timer);
  }
  setBootStage(3, "");
  if (!sheet.dataJson) return;
  const { STORAGE_KEYS } = await import("./constants/config");
  const sync = await import("./services/gistSync");
  const { recordGasSheetInfo } = await import("./services/gas");
  const local = localStorage.getItem(STORAGE_KEYS.DATA) ?? "";
  const sheetContent = sync.payloadContentHash(sheet.dataJson);
  if (local === sheet.dataJson) {
    recordGasSheetInfo("load", sheet, sheetContent);
    return;
  }
  // 이 경로는 사본이 없거나 읽을 수 없을 때뿐. 덮일 사본의 '내용'이 시트와 다를 때만 스냅샷
  // (문자열·해시 비교는 재직렬화·시계열 적립만으로도 달라져 편집 없이도 부팅마다 스냅샷이 쌓였다)
  if (local && sync.payloadContentHash(local) !== sheetContent) {
    const storage = await import("./storage");
    await storage.saveSafetySnapshot(storage.loadData(), "시트 장부로 덮기 직전(기기 미저장 편집)");
  }
  localStorage.setItem(STORAGE_KEYS.DATA, sheet.dataJson);
  localStorage.removeItem(STORAGE_KEYS.DRAFT);
  localStorage.removeItem(STORAGE_KEYS.DRAFT_AT);
  if (sheet.schemaVersion) localStorage.setItem(STORAGE_KEYS.DATA_SCHEMA_VERSION, String(sheet.schemaVersion));
  sync.setGistLastPullAt(sheet.updatedAt);
  sync.setGistLastPushAt(sheet.updatedAt);
  sync.setGistLastPushedHash(sync.hashGistPayload(sheet.dataJson));
  recordGasSheetInfo("load", sheet, sheetContent);
}

function renderApp(): void {
  try {
    // AppErrorBoundary를 FxRateProvider 바깥에 두어, Provider/Context 초기화 중
    // throw 되어도 복구 UI가 렌더되도록 한다.
    ReactDOM.createRoot(rootElement!).render(
      <React.StrictMode>
        <AppErrorBoundary onRestoreLatestBackup={restoreLatestBackup} onResetData={resetAllData}>
          <FxRateProvider>
            <App />
          </FxRateProvider>
        </AppErrorBoundary>
      </React.StrictMode>
    );
  } catch (error) {
    renderFatal(error);
  }
}

function renderFatal(error: unknown): void {
  reportError("main.render", error);
  // innerHTML로 직접 주입하면 error.message가 사용자/외부 의존성 영향을 받을 수 있어 XSS 위험.
  // textContent 기반 DOM 조립으로 escape 보장.
  const wrap = document.createElement("div");
  wrap.style.cssText = "padding: 20px; font-family: system-ui;";

  const h1 = document.createElement("h1");
  h1.textContent = "오류 발생";

  const msg = document.createElement("pre");
  msg.textContent = error instanceof Error ? error.message : String(error);

  const stack = document.createElement("pre");
  stack.textContent = error instanceof Error ? (error.stack ?? "") : "";

  wrap.appendChild(h1);
  wrap.appendChild(msg);
  wrap.appendChild(stack);

  rootElement!.replaceChildren(wrap);
}

/**
 * 시작 골격 화면(index.html #boot-splash)의 진행 단계 — 1 앱 열기 · 2 시트에서 장부 받기 · 3 화면 그리기.
 * React 첫 렌더가 #root를 통째로 바꾸므로 따로 지울 필요 없다. 골격이 없으면(옛 HTML) 글자로 대신한다.
 */
function setBootStage(step: 1 | 2 | 3, detail: string): void {
  const splash = document.getElementById("boot-splash");
  if (!splash) {
    if (!rootElement!.firstElementChild) rootElement!.textContent = "장부 불러오는 중…";
    return;
  }
  splash.dataset.step = String(step);
  const detailEl = document.getElementById("boot-detail");
  if (detailEl) detailEl.textContent = detail;
}

// 시트 채택이 실패해도(서버 오류 등) 기기 캐시로 앱은 연다 — 오류는 활동 로그로.
setBootStage(1, "");
/**
 * GAS 부팅 — 기기에 읽을 수 있는 사본(캐시)이 있으면 바로 그리고 시트 확인은 백그라운드로(store/sheetBootStore →
 * hooks/useSheetBootAdoption이 같은 채택 규칙 적용). 사본이 없거나 깨졌으면 예전처럼 시트를 기다린 뒤 그린다.
 */
async function boot(): Promise<void> {
  const { isGas } = await import("./services/gas");
  if (isGas()) {
    const { STORAGE_KEYS } = await import("./constants/config");
    if (hasReadableCache(localStorage.getItem(STORAGE_KEYS.DATA))) {
      const { startBackgroundSheetCheck } = await import("./store/sheetBootStore");
      startBackgroundSheetCheck();
      setBootStage(3, "");
      return;
    }
    await adoptSheetData();
  }
}

/** 캐시가 그대로 화면에 쓸 수 있는 장부인가 — 깨진 캐시로 먼저 그리면 로드 실패 화면에 갇혀 시트 채택을 못 한다 */
function hasReadableCache(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { ledger?: unknown };
    return !!parsed && typeof parsed === "object" && Array.isArray(parsed.ledger);
  } catch {
    return false;
  }
}

boot()
  .catch((error) => reportError("main.boot", error))
  .finally(() => {
    setBootStage(3, "");
    // 단계 표시가 실제로 그려질 틈을 준 뒤(한 프레임) 무거운 첫 렌더를 시작한다
    // (백그라운드 탭은 rAF가 멈추므로 100ms 타이머로도 보장)
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      renderApp();
    };
    requestAnimationFrame(() => setTimeout(start, 0));
    setTimeout(start, 100);
  });

