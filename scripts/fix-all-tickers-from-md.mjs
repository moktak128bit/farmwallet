#!/usr/bin/env node
/**
 * app-data.json의 tickerDatabase를 ticker.md의 정확한 이름으로 모두 교체
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const appDataPath = path.join(root, "data", "app-data.json");
const mdPath = path.join(root, "data", "ticker.md");

try {
  console.log("ticker.md 읽는 중...");
  const mdContent = fs.readFileSync(mdPath, "utf-8");
  const lines = mdContent.split("\n").filter((line) => line.trim());
  const dataLines = lines.slice(1);

  // ticker.md에서 티커->이름 맵 생성 (한국 티커만)
  const mdMap = new Map();
  for (const line of dataLines) {
    const parts = line.split("\t");
    if (parts.length >= 2) {
      const ticker = parts[0].trim();
      const name = parts[1].trim().replace(/\r\n|\r|\n/g, "");
      // 한국 티커만 (6자리 숫자/알파벳 조합)
      if (ticker && name && /^[0-9A-Z]{6}$/.test(ticker) && /[0-9]/.test(ticker)) {
        mdMap.set(ticker, name);
      }
    }
  }

  console.log(`ticker.md 맵: ${mdMap.size}개 (한국 티커)`);

  console.log("app-data.json 읽는 중...");
  const appDataRaw = fs.readFileSync(appDataPath, "utf-8");
  const appData = JSON.parse(appDataRaw);

  if (!appData.tickerDatabase || !Array.isArray(appData.tickerDatabase)) {
    console.log("❌ tickerDatabase가 없습니다.");
    process.exit(1);
  }

  console.log(`원본 tickerDatabase: ${appData.tickerDatabase.length}개`);

  let updatedCount = 0;
  const updatedTickers = [];
  appData.tickerDatabase = appData.tickerDatabase.map((t) => {
    // 한국 티커: ticker.md에서 티커 기준으로 이름 찾아서 무조건 덮어쓰기
    if (t.market === "KR" && mdMap.has(t.ticker)) {
      const nameFromMd = mdMap.get(t.ticker);
      updatedTickers.push(`${t.ticker}: "${t.name}" → "${nameFromMd}"`);
      updatedCount++;
      return { ...t, name: nameFromMd };
    }
    return t;
  });

  if (updatedTickers.length > 0) {
    console.log("\n티커 기준 ticker.md 이름 반영 (처음 30개):");
    updatedTickers.slice(0, 30).forEach((msg) => console.log(msg));
    if (updatedTickers.length > 30) {
      console.log(`... 외 ${updatedTickers.length - 30}개`);
    }
  }

  console.log(`\n반영된 티커: ${updatedCount}개`);

  if (updatedCount > 0) {
    console.log("app-data.json 저장 중...");
    fs.writeFileSync(appDataPath, JSON.stringify(appData, null, 2), "utf-8");
    console.log(`✅ 완료! ticker.md 기준으로 ${updatedCount}개 티커 이름 반영됨.`);
  } else {
    console.log("✅ ticker.md에 매칭되는 KR 티커 없음.");
  }
} catch (err) {
  console.error("❌ 오류:", err);
  process.exit(1);
}
