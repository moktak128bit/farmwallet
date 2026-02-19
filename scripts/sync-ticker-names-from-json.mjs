#!/usr/bin/env node
/**
 * app-data.json의 tickerDatabase 전체를 대상으로,
 * 각 티커 코드를 기준으로 data/ticker.json 에서 이름을 가져와 덮어쓴다.
 * - 티커는 그대로 두고(name만 수정)
 * - ticker.json 에 없는 티커는 기존 이름을 유지
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tickerPath = path.join(root, "data", "ticker.json");
const appDataPath = path.join(root, "data", "app-data.json");

try {
  console.log("ticker.json 읽는 중...");
  const tickerRaw = fs.readFileSync(tickerPath, "utf-8");
  const tickerData = JSON.parse(tickerRaw);

  const kr = Array.isArray(tickerData.KR) ? tickerData.KR : [];
  const us = Array.isArray(tickerData.US) ? tickerData.US : [];

  console.log(`ticker.json KR: ${kr.length}개, US: ${us.length}개`);

  // 티커 → 이름 맵 생성
  const krMap = new Map();
  kr.forEach(({ ticker, name }) => {
    if (ticker) krMap.set(String(ticker), String(name ?? "").trim());
  });

  const usMap = new Map();
  us.forEach(({ ticker, name }) => {
    if (ticker) usMap.set(String(ticker), String(name ?? "").trim());
  });

  console.log("app-data.json 읽는 중...");
  const appRaw = fs.readFileSync(appDataPath, "utf-8");
  const appData = JSON.parse(appRaw);

  if (!Array.isArray(appData.tickerDatabase)) {
    console.error("❌ app-data.json.tickerDatabase 가 배열이 아닙니다.");
    process.exit(1);
  }

  const beforeCount = appData.tickerDatabase.length;
  console.log(`app-data.json tickerDatabase: ${beforeCount}개`);

  let updatedCount = 0;
  const updatedSamples = [];
  const missingInTickerJson = new Set();

  appData.tickerDatabase = appData.tickerDatabase.map((t) => {
    if (!t || !t.ticker) return t;

    const code = String(t.ticker);
    let srcName;

    if (t.market === "KR") {
      srcName = krMap.get(code);
    } else if (t.market === "US") {
      srcName = usMap.get(code);
    } else {
      // 그 외 시장은 그대로 둔다
      return t;
    }

    if (!srcName) {
      missingInTickerJson.add(`${t.market ?? "??"}:${code}`);
      return t;
    }

    const newName = srcName.trim();
    const oldName = String(t.name ?? "");

    if (oldName !== newName) {
      updatedCount++;
      if (updatedSamples.length < 30) {
        updatedSamples.push(`${code}: "${oldName}" → "${newName}"`);
      }
      return { ...t, name: newName };
    }

    // 이름이 이미 같은 경우도 ticker.json 기준으로 한 번 더 확정
    return { ...t, name: newName };
  });

  console.log("\n=== 변경 요약 ===");
  console.log(`이름이 실제로 바뀐 티커: ${updatedCount}개`);
  if (updatedSamples.length > 0) {
    console.log("\n예시 (최대 30개):");
    updatedSamples.forEach((s) => console.log("  " + s));
  }

  if (missingInTickerJson.size > 0) {
    console.log(
      `\n⚠ ticker.json 에서 찾지 못한 티커: ${missingInTickerJson.size}개 (그대로 유지됨)`
    );
    console.log(
      Array.from(missingInTickerJson).slice(0, 20).join(", ") +
        (missingInTickerJson.size > 20
          ? ` ... 외 ${missingInTickerJson.size - 20}개`
          : "")
    );
  }

  console.log("\napp-data.json 저장 중...");
  fs.writeFileSync(appDataPath, JSON.stringify(appData, null, 2), "utf-8");
  console.log("✅ 완료! app-data.json의 tickerDatabase 이름이 ticker.json 기준으로 동기화되었습니다.");
} catch (err) {
  console.error("❌ 오류:", err);
  process.exit(1);
}

