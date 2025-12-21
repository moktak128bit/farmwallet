import type { AppData } from "./types";

export interface FileBackupResult {
  fileName: string;
  createdAt: string;
}

// Vite dev 서버의 /api/backup 미들웨어에 파일 백업을 요청한다.
export async function createFileBackup(data: AppData): Promise<FileBackupResult | null> {
  try {
    const res = await fetch("/api/backup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      return null;
    }
    const json = (await res.json()) as FileBackupResult;
    return json;
  } catch {
    return null;
  }
}


