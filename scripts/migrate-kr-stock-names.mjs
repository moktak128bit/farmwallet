#!/usr/bin/env node
/**
 * app-data.json의 trades, prices, tickerDatabase, ledger 배당 기록에서
 * 한국 종목(6자 이상 티커)의 name을 ticker.json + ticker.md 기준 한글이름으로 교체
 *
 * 사용법:
 *   node scripts/migrate-kr-stock-names.mjs              # data/app-data.json 처리
 *   node scripts/migrate-kr-stock-names.mjs --backup     # 최신 백업만 처리
 *   node scripts/migrate-kr-stock-names.mjs --all-backups  # 모든 과거 백업 파일 처리
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tickerJsonPath = path.join(root, "data", "ticker.json");
const tickerMdPath = path.join(root, "data", "ticker.md");
const appDataPath = path.join(root, "data", "app-data.json");
const backupsDir = path.join(root, "backups");
const processBackup = process.argv.includes("--backup");
const processAllBackups = process.argv.includes("--all-backups");

function cleanTicker(raw) {
  if (!raw || typeof raw !== "string") return "";
  return raw.toUpperCase().replace(/\.(KS|KQ|KO|K|KSQ)$/i, "");
}

function isKRWStock(ticker) {
  if (!ticker) return false;
  return cleanTicker(ticker).length >= 6;
}

function buildKoreanNameMap() {
  const map = new Map();

  // 한글 포함 여부 (영문만 있으면 제외, ticker.md에서 한글이름으로 덮어쓸 예정)
  const hasHangul = (s) => /[가-힣]/.test(String(s));

  // 1. ticker.json KR 섹션 (한글 포함 이름만 - 영문만 있는 건 ticker.md에서 보완)
  try {
    const tickerRaw = fs.readFileSync(tickerJsonPath, "utf-8");
    const tickerData = JSON.parse(tickerRaw);
    const kr = Array.isArray(tickerData.KR) ? tickerData.KR : [];
    kr.forEach(({ ticker, name }) => {
      if (ticker && name && hasHangul(name)) {
        map.set(cleanTicker(ticker), String(name).trim());
      }
    });
    console.log(`ticker.json KR: ${kr.length}개 로드`);
  } catch (err) {
    console.warn("ticker.json 로드 실패:", err.message);
  }

  // 2. ticker.md (덮어쓰기 - 더 정확한 한글이름 often)
  try {
    const mdContent = fs.readFileSync(tickerMdPath, "utf-8");
    const lines = mdContent.split("\n").filter((l) => l.trim());
    const dataLines = lines.slice(1); // 헤더 스킵
    let mdCount = 0;
    for (const line of dataLines) {
      const parts = line.split("\t");
      if (parts.length >= 2) {
        const ticker = cleanTicker(parts[0].trim());
        const name = parts[1].trim().replace(/\r\n|\r|\n/g, "");
        if (ticker && name && isKRWStock(ticker)) {
          map.set(ticker, name);
          mdCount++;
        }
      }
    }
    console.log(`ticker.md 한국종목: ${mdCount}개 로드 (기존 맵에 반영)`);
  } catch (err) {
    console.warn("ticker.md 로드 실패:", err.message);
  }

  return map;
}

function processAppData(appData, krNameMap) {
  let tradesUpdated = 0;
  let pricesUpdated = 0;
  let tickerDbUpdated = 0;

  // trades
  if (Array.isArray(appData.trades)) {
    appData.trades = appData.trades.map((t) => {
      if (!t || !t.ticker) return t;
      const key = cleanTicker(t.ticker);
      if (!isKRWStock(key)) return t;
      const krName = krNameMap.get(key);
      if (!krName || t.name === krName) return t;
      tradesUpdated++;
      return { ...t, name: krName };
    });
  }

  // prices
  if (Array.isArray(appData.prices)) {
    appData.prices = appData.prices.map((p) => {
      if (!p || !p.ticker) return p;
      const key = cleanTicker(p.ticker);
      if (!isKRWStock(key)) return p;
      const krName = krNameMap.get(key);
      if (!krName || p.name === krName) return p;
      pricesUpdated++;
      return { ...p, name: krName };
    });
  }

  // tickerDatabase
  if (Array.isArray(appData.tickerDatabase)) {
    appData.tickerDatabase = appData.tickerDatabase.map((t) => {
      if (!t || !t.ticker) return t;
      if (t.market !== "KR") return t;
      const key = cleanTicker(t.ticker);
      const krName = krNameMap.get(key);
      if (!krName || t.name === krName) return t;
      tickerDbUpdated++;
      return { ...t, name: krName };
    });
  }

  // ledger 배당 기록: "ticker - 영문이름 배당" → "ticker - 한글이름 배당"
  // 또는 description이 영문 종목명만 있는 경우, ticker로 조회해 한글이름으로 교체
  let ledgerUpdated = 0;
  const isDividend = (l) =>
    l?.kind === "income" &&
    ((l.category ?? "").includes("배당") ||
      (l.subCategory ?? "").includes("배당") ||
      (l.description ?? "").includes("배당"));
  if (Array.isArray(appData.ledger)) {
    appData.ledger = appData.ledger.map((l) => {
      if (!isDividend(l) || !l.description) return l;
      const desc = l.description;
      // 패턴 1: "458730 - Mirae Asset... 배당" 또는 "458730 - 이름 배당, 세금: X원"
      let match = desc.match(/^([0-9A-Z]{6})\s*-\s*(.+?)(\s+배당)/);
      if (match) {
        const ticker = cleanTicker(match[1]);
        const oldName = match[2].trim();
        if (isKRWStock(ticker)) {
          const krName = krNameMap.get(ticker);
          if (krName && oldName !== krName) {
            const newDesc = desc.replace(/^([0-9A-Z]{6})\s*-\s*(.+?)(\s+배당)/, (_, t, _n, suffix) => `${t} - ${krName}${suffix}`);
            ledgerUpdated++;
            return { ...l, description: newDesc };
          }
        }
        return l;
      }
      // 패턴 2: "458730 - 이름" (배당 없이) → ticker - 한글이름 배당 형태로 통일
      match = desc.match(/^([0-9A-Z]{6})\s*-\s*(.+)$/);
      if (match && (l.subCategory ?? "").includes("배당")) {
        const ticker = cleanTicker(match[1]);
        const oldName = match[2].trim();
        if (isKRWStock(ticker)) {
          const krName = krNameMap.get(ticker);
          if (krName && oldName !== krName) {
            const newDesc = `${match[1]} - ${krName} 배당`;
            ledgerUpdated++;
            return { ...l, description: newDesc };
          }
        }
      }
      // 패턴 3: description이 영문명만 (티커 없음) - trades/prices에서 ticker 찾아 한글이름으로 교체
      // 현재 krNameMap에는 ticker->한글이름만 있으므로, description 전체가 한글이름이면 스킵
      return l;
    });
  }

  return {
    tradesUpdated,
    pricesUpdated,
    tickerDbUpdated,
    ledgerUpdated,
    total: tradesUpdated + pricesUpdated + tickerDbUpdated + ledgerUpdated
  };
}

try {
  const krNameMap = buildKoreanNameMap();
  console.log(`\n한국 종목 한글이름 맵: ${krNameMap.size}개`);

  const appRaw = fs.readFileSync(appDataPath, "utf-8");
  const appData = JSON.parse(appRaw);
  const result = processAppData(appData, krNameMap);

  console.log("\n=== 변경 요약 ===");
  console.log(`trades name 업데이트: ${result.tradesUpdated}개`);
  console.log(`prices name 업데이트: ${result.pricesUpdated}개`);
  console.log(`tickerDatabase name 업데이트: ${result.tickerDbUpdated}개`);
  console.log(`ledger 배당 description 업데이트: ${result.ledgerUpdated}개`);

  if (result.total > 0) {
    fs.writeFileSync(appDataPath, JSON.stringify(appData, null, 2), "utf-8");
    console.log("\n✅ app-data.json 저장 완료. 한국 종목 이름(배당 포함)이 한글로 교체되었습니다.");
  } else {
    console.log("\n✅ app-data.json: 변경할 항목이 없습니다.");
  }

  // --backup 또는 --all-backups: 백업 파일 처리
  if ((processBackup || processAllBackups) && fs.existsSync(backupsDir)) {
    const dates = fs.readdirSync(backupsDir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    let backupFilesToProcess = [];
    if (processAllBackups) {
      for (const d of dates) {
        const dirPath = path.join(backupsDir, d);
        const files = fs.readdirSync(dirPath)
          .filter((f) => f.endsWith(".json") && f.startsWith("backup-"))
          .map((f) => path.join(d, f));
        backupFilesToProcess.push(...files);
      }
    } else if (processBackup && dates.length > 0) {
      const latestDir = path.join(backupsDir, dates[dates.length - 1]);
      const files = fs.readdirSync(latestDir)
        .filter((f) => f.endsWith(".json") && f.startsWith("backup-"))
        .sort()
        .reverse();
      if (files.length > 0) {
        backupFilesToProcess = [path.join(dates[dates.length - 1], files[0])];
      }
    }

    let totalBackupUpdated = 0;
    for (const relPath of backupFilesToProcess) {
      const backupPath = path.join(backupsDir, relPath);
      if (!fs.existsSync(backupPath)) continue;
      try {
        const backupRaw = fs.readFileSync(backupPath, "utf-8");
        const backupData = JSON.parse(backupRaw);
        const backupResult = processAppData(backupData, krNameMap);
        if (backupResult.total > 0) {
          fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), "utf-8");
          totalBackupUpdated++;
          console.log(`  ✅ ${relPath}: trades ${backupResult.tradesUpdated}, prices ${backupResult.pricesUpdated}, ledger ${backupResult.ledgerUpdated}, tickerDb ${backupResult.tickerDbUpdated}`);
        }
      } catch (e) {
        console.warn(`  ⚠ ${relPath} 스킵:`, e.message);
      }
    }
    if (backupFilesToProcess.length > 0) {
      console.log(`\n백업 ${totalBackupUpdated}/${backupFilesToProcess.length}개 파일 업데이트 완료.`);
    }
  }
} catch (err) {
  console.error("❌ 오류:", err);
  process.exit(1);
}
