import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { FxRateProvider } from "./context/FxRateContext";
import { installGlobalErrorListeners, reportError } from "./utils/errorReporting";
import "./styles.css";

// 전역 미처리 오류(window.error / unhandledrejection) → 영속 활동 로그. 내부에서 중복 설치를 막는다.
installGlobalErrorListeners();

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
  try {
    await storage.saveSafetySnapshot(storage.loadData(), "에러화면 자동복원 직전");
  } catch {
    /* 현재 데이터 읽기 실패 시 스냅샷 건너뜀 */
  }

  const normalized = storage.normalizeImportedData(backupData);
  storage.saveData(normalized);
}

async function resetAllData(): Promise<void> {
  const storage = await import("./storage");
  storage.saveData(storage.getEmptyData());
}

try {
  // AppErrorBoundary를 FxRateProvider 바깥에 두어, Provider/Context 초기화 중
  // throw 되어도 복구 UI가 렌더되도록 한다.
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <AppErrorBoundary onRestoreLatestBackup={restoreLatestBackup} onResetData={resetAllData}>
        <FxRateProvider>
          <App />
        </FxRateProvider>
      </AppErrorBoundary>
    </React.StrictMode>
  );
} catch (error) {
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

  rootElement.replaceChildren(wrap);
}

