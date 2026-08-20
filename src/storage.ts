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
  toUserDataJson,
  consumeSanitizeReport
} from "./services/dataService";
export {
  saveBackupSnapshot,
  saveSafetySnapshot,
  loadBackupDataVerified,
  getLatestLocalBackupIntegrity,
  getAllBackupList,
  loadServerBackupData,
  clearOldBackups,
  mergeCurrentCaches,
  isBackupOnSaveEnabled,
  type BackupEntry
} from "./services/backupService";
export {
  loadTickerDatabaseFromBackup,
  saveTickerDatabaseBackup,
  saveTickerToJson
} from "./services/tickerService";

