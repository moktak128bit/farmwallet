#!/usr/bin/env node
/**
 * backups 폴더 안의 모든 백업 JSON에서
 * tickerDatabase 안의 티커 이름을 data/ticker.json 기준으로 동기화한다.
 *
 * - 티커 코드는 그대로 두고 name만 덮어씀
 * - ticker.json 에 없는 티커는 그대로 둠
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tickerPath = path.join(root, "data", "ticker.json");
const backupsRoot = path.join(root, "backups");

try {
  console.log("ticker.json 읽는 중...");
  const tickerRaw = fs.readFileSync(tickerPath, "utf-8");
  const tickerData = JSON.parse(tickerRaw);

  const kr = Array.isArray(tickerData.KR) ? tickerData.KR : [];
  const us = Array.isArray(tickerData.US) ? tickerData.US : [];

  console.log(`ticker.json KR: ${kr.length}개, US: ${us.length}개`);

  const krMap = new Map();
  kr.forEach(({ ticker, name }) => {
    if (ticker) krMap.set(String(ticker), String(name ?? "").trim());
  });

  const usMap = new Map();
  us.forEach(({ ticker, name }) => {
    if (ticker) usMap.set(String(ticker), String(name ?? "").trim());
  });

  if (!fs.existsSync(backupsRoot)) {
    console.log("backups 폴더가 없습니다. 종료합니다.");
    process.exit(0);
  }

  const backupDirs = fs
    .readdirSync(backupsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  let totalFiles = 0;
  let totalUpdatedTickers = 0;

  for (const dir of backupDirs) {
    const dirPath = path.join(backupsRoot, dir);
    const files = fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((f) => f.isFile() && f.name.endsWith(".json"))
      .map((f) => f.name);

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      totalFiles++;

      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const data = JSON.parse(raw);

        if (!Array.isArray(data.tickerDatabase)) {
          continue;
        }

        let updatedCount = 0;

        data.tickerDatabase = data.tickerDatabase.map((t) => {
          if (!t || !t.ticker) return t;

          const code = String(t.ticker);
          let srcName;

          if (t.market === "KR") {
            srcName = krMap.get(code);
          } else if (t.market === "US") {
            srcName = usMap.get(code);
          } else {
            return t;
          }

          if (!srcName) return t;

          const newName = srcName.trim();
          const oldName = String(t.name ?? "");

          if (oldName !== newName) {
            updatedCount++;
            return { ...t, name: newName };
          }

          return { ...t, name: newName };
        });

        if (updatedCount > 0) {
          totalUpdatedTickers += updatedCount;
          fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
          console.log(
            `백업 파일 수정: ${path.relative(
              root,
              filePath
            )} (이름 변경 티커 ${updatedCount}개)`
          );
        }
      } catch (e) {
        console.warn(`⚠ 백업 파일 파싱 실패: ${path.relative(root, filePath)}`);
      }
    }
  }

  console.log("\n=== 백업 동기화 결과 ===");
  console.log(`처리한 백업 파일 수: ${totalFiles}개`);
  console.log(`이름이 실제로 바뀐 티커 수: ${totalUpdatedTickers}개`);
  console.log("✅ 모든 백업 JSON의 tickerDatabase 이름을 ticker.json 기준으로 정리했습니다.");
} catch (err) {
  console.error("❌ 오류:", err);
  process.exit(1);
}

