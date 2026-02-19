#!/usr/bin/env node
/**
 * app-data.json의 tickerDatabase에서 "" 문자를 찾고, ticker.md에서 정확한 이름을 찾아서 교체
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const appDataPath = path.join(root, "data", "app-data.json");
const mdPath = path.join(root, "data", "ticker.md");

try {
  console.log("app-data.json 읽는 중...");
  const appDataRaw = fs.readFileSync(appDataPath, "utf-8");
  const appData = JSON.parse(appDataRaw);

  console.log("ticker.md 읽는 중...");
  const mdContent = fs.readFileSync(mdPath, "utf-8");
  const lines = mdContent.split("\n").filter((line) => line.trim());
  const dataLines = lines.slice(1);

  // ticker.md에서 티커->이름 맵 생성
  const mdMap = new Map();
  for (const line of dataLines) {
    const parts = line.split("\t");
    if (parts.length >= 2) {
      const ticker = parts[0].trim();
      const name = parts[1].trim().replace(/\r\n|\r|\n/g, "");
      if (ticker && name) {
        mdMap.set(ticker, name);
      }
    }
  }

  console.log(`ticker.md 맵: ${mdMap.size}개`);

  if (!appData.tickerDatabase || !Array.isArray(appData.tickerDatabase)) {
    console.log("❌ tickerDatabase가 없습니다.");
    process.exit(1);
  }

  // 깨진 패턴 체크 함수
  function isBroken(name) {
    if (!name) return false;
    return (
      /[\uFFFD\uFFFE\uFFFF]/.test(name) ||
      /([가-힣])\1{2,}/.test(name) ||
      (name.includes("창판") && !name.includes("과창판")) ||
      (name.includes("에너나") && !name.includes("에너지나")) ||
      (name.includes("2차지") && !name.includes("2차전지")) ||
      (name.includes("글로벌워") && !name.includes("글로벌워터") && !name.includes("글로벌워런")) ||
      (name.includes("레리지(성") || name.includes("레버리지(성")) ||
      (name.includes("대장이") && !name.includes("대장장이"))
    );
  }

  // tickerDatabase에서 깨진 티커 찾기
  const broken = appData.tickerDatabase.filter((t) => isBroken(t.name));
  console.log(`\n깨진 티커: ${broken.length}개`);

  let fixedCount = 0;
  appData.tickerDatabase = appData.tickerDatabase.map((t) => {
    if (isBroken(t.name)) {
      // ticker.md에서 정확한 이름 찾기
      const correctName = mdMap.get(t.ticker);
      if (correctName && correctName !== t.name) {
        console.log(`${t.ticker}: "${t.name}" → "${correctName}"`);
        fixedCount++;
        return { ...t, name: correctName };
      } else if (!correctName) {
        console.warn(`${t.ticker}: ticker.md에서 찾을 수 없음`);
      }
    }
    return t;
  });

  console.log(`\n수정된 티커: ${fixedCount}개`);

  if (fixedCount > 0) {
    console.log("app-data.json 저장 중...");
    fs.writeFileSync(appDataPath, JSON.stringify(appData, null, 2), "utf-8");
    console.log(`✅ 완료! app-data.json의 ${fixedCount}개 티커가 수정되었습니다.`);
  } else {
    console.log("✅ 수정할 티커가 없습니다.");
  }
} catch (err) {
  console.error("❌ 오류:", err);
  process.exit(1);
}
