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
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <FxRateProvider>
        <AppErrorBoundary onRestoreLatestBackup={restoreLatestBackup} onResetData={resetAllData}>
          <App />
        </AppErrorBoundary>
      </FxRateProvider>
    </React.StrictMode>
  );
} catch (error) {
  console.error("앱 렌더링 실패:", error);
  rootElement.innerHTML = `
    <div style="padding: 20px; font-family: system-ui;">
      <h1>오류 발생</h1>
      <pre>${error instanceof Error ? error.message : String(error)}</pre>
      <pre>${error instanceof Error ? error.stack : ""}</pre>
    </div>
  `;
}

