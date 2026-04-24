// Re-export from services for backward compatibility
export {
  loadData,
  saveData,
  saveDataSerialized,
  normalizeImportedData,
  getEmptyData,
  preloadKrNames,
  getKrNames,
  applyKoreanStockNames,
  toUserDataJson
} from "./services/dataService";
export {
  saveBackupSnapshot,
  getBackupList,
  loadBackupData,
  loadBackupDataVerified,
  getLatestLocalBackupIntegrity,
  getAllBackupList,
  loadServerBackupData,
  clearOldBackups,
  type BackupMeta,
  type BackupEntry,
  type BackupSource,
  type SaveBackupResult
} from "./services/backupService";
export {
  loadTickerDatabaseFromBackup,
  saveTickerDatabaseBackup,
  saveTickerToJson
} from "./services/tickerService";

