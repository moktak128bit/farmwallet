// Re-export from services for backward compatibility
export { loadData, saveData, getEmptyData } from "./services/dataService";
export {
  saveBackupSnapshot,
  getBackupList,
  loadBackupData,
  getLatestLocalBackupIntegrity,
  getAllBackupList,
  loadServerBackupData,
  type BackupMeta,
  type BackupEntry,
  type BackupSource
} from "./services/backupService";
export {
  loadTickerDatabaseFromBackup,
  saveTickerDatabaseBackup,
  saveTickerToJson
} from "./services/tickerService";

import { DEFAULT_US_TICKERS } from "./constants/config";

// Legacy exports for backward compatibility
export function getDefaultUsTickers(): string[] {
  return [...DEFAULT_US_TICKERS];
}
