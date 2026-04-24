import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { FxRateProvider } from "./context/FxRateContext";
import "./styles.css";

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
    backupData = storage.loadBackupData(latest.id);
  }

  if (!backupData) {
    throw new Error("최신 백업 데이터를 읽을 수 없습니다.");
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
  console.error("앱 렌더링 실패:", error);
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

