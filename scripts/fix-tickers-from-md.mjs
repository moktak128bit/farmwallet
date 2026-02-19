#!/usr/bin/env node
/**
 * ticker.json에서 "" 문자를 찾고, ticker.md에서 정확한 이름을 찾아서 교체
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tickerJsonPath = path.join(root, "data", "ticker.json");
const mdPath = path.join(root, "data", "ticker.md");

try {
  console.log("ticker.json 읽는 중...");
  const tickerJsonRaw = fs.readFileSync(tickerJsonPath, "utf-8");
  const tickerData = JSON.parse(tickerJsonRaw);

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

  // ticker.json의 KR 배열에서 "" 문자 포함 티커 찾기
  const broken = tickerData.KR.filter((t) => /[\uFFFD\uFFFE\uFFFF]/.test(t.name));
  console.log(`\n"" 문자 포함 티커: ${broken.length}개`);

  let fixedCount = 0;
  tickerData.KR = tickerData.KR.map((t) => {
    if (/[\uFFFD\uFFFE\uFFFF]/.test(t.name)) {
      // ticker.md에서 정확한 이름 찾기
      const correctName = mdMap.get(t.ticker);
      if (correctName) {
        console.log(`${t.ticker}: "${t.name}" → "${correctName}"`);
        fixedCount++;
        return { ...t, name: correctName };
      } else {
        console.warn(`${t.ticker}: ticker.md에서 찾을 수 없음`);
      }
    }
    return t;
  });

  console.log(`\n수정된 티커: ${fixedCount}개`);

  if (fixedCount > 0) {
    console.log("ticker.json 저장 중...");
    fs.writeFileSync(tickerJsonPath, JSON.stringify(tickerData, null, 2), "utf-8");
    console.log(`✅ 완료! ticker.json의 ${fixedCount}개 티커가 수정되었습니다.`);
    console.log(`다음 단계: npm run apply-ticker`);
  } else {
    console.log("✅ 수정할 티커가 없습니다.");
  }
} catch (err) {
  console.error("❌ 오류:", err);
  process.exit(1);
}
