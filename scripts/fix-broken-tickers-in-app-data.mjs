#!/usr/bin/env node
/**
 * app-data.json의 tickerDatabase에서 깨진 티커 이름 수정
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const appDataPath = path.join(root, "data", "app-data.json");

// 깨진 문자 수정 함수
function fixBrokenName(name) {
  if (!name) return name;
  
  // 깨진 문자 제거
  let fixed = name.replace(/[\uFFFD\uFFFE\uFFFF\u200B-\u200D\uFEFF\u0000-\u001F\u007F-\u009F]/g, "");
  
  // 반복되는 한글 문자 제거 (2번 이상 반복되는 경우)
  // "글글글" → "글", "터터터" → "터"
  // 먼저 3번 이상 반복 제거
  fixed = fixed.replace(/([가-힣])\1{2,}/g, "$1");
  // 그 다음 2번 반복 제거
  fixed = fixed.replace(/([가-힣])\1/g, "$1");
  
  // 일반적인 깨진 패턴 수정
  fixed = fixed.replace(/차이나창판/g, "차이나과창판");
  fixed = fixed.replace(/ACE국과창판/g, "ACE 중국과창판");
  fixed = fixed.replace(/에너나닥/g, "에너지나스닥");
  fixed = fixed.replace(/에너나스닥/g, "에너지나스닥");
  fixed = fixed.replace(/2차지/g, "2차전지");
  fixed = fixed.replace(/로벌워/g, "글로벌워터");
  fixed = fixed.replace(/글로벌워/g, "글로벌워터");
  fixed = fixed.replace(/글로벌워런/g, "글로벌워터");
  fixed = fixed.replace(/레리지\(성/g, "레버리지(합성");
  fixed = fixed.replace(/레버리지\(성/g, "레버리지(합성");
  fixed = fixed.replace(/에플러스/g, "에셋플러스");
  fixed = fixed.replace(/에바이오텍/g, "에셋바이오텍");
  fixed = fixed.replace(/에바이오/g, "에셋바이오");
  fixed = fixed.replace(/대장이액티브/g, "대장장이액티브");
  fixed = fixed.replace(/대장이/g, "대장장이");
  
  // "글로벌워터" 패턴 수정
  if (fixed.includes("글로벌") && fixed.includes("워터") && !fixed.includes("글로벌워터")) {
    fixed = fixed.replace(/글로벌[^워]*워터/g, "글로벌워터");
  }
  if (fixed.includes("글로벌워") && !fixed.includes("글로벌워터") && !fixed.includes("글로벌워런")) {
    fixed = fixed.replace(/글로벌워([^터런])/g, "글로벌워터$1");
    fixed = fixed.replace(/글로벌워$/g, "글로벌워터");
  }
  
  // 연속된 공백 정리
  fixed = fixed.replace(/\s+/g, " ").trim();
  
  // 특정 티커 수동 수정
  // 424460: "HANARO 글로벌워터MSCI(합성)"
  if (fixed.includes("424460") || fixed.includes("HANARO") && fixed.includes("글로벌") && fixed.includes("워터")) {
    fixed = "HANARO 글로벌워터MSCI(합성)";
  }
  
  return fixed;
}

try {
  console.log("app-data.json 읽는 중...");
  const appDataRaw = fs.readFileSync(appDataPath, "utf-8");
  const appData = JSON.parse(appDataRaw);

  if (!appData.tickerDatabase || !Array.isArray(appData.tickerDatabase)) {
    console.log("❌ tickerDatabase가 없습니다.");
    process.exit(1);
  }

  console.log(`원본 tickerDatabase: ${appData.tickerDatabase.length}개`);

  // 특정 티커 수동 수정 맵 (ticker.md 기준으로 정확한 이름)
  const manualFixes = {
    "424460": "HANARO 글로벌워터MSCI(합성)"
  };

  let fixedCount = 0;
  appData.tickerDatabase = appData.tickerDatabase.map((ticker) => {
    const originalName = ticker.name;
    let fixedName = fixBrokenName(originalName);
    
    // 특정 티커 수동 수정
    if (manualFixes[ticker.ticker]) {
      fixedName = manualFixes[ticker.ticker];
    }
    
    if (fixedName !== originalName) {
      fixedCount++;
      return {
        ...ticker,
        name: fixedName
      };
    }
    
    return ticker;
  });

  console.log(`수정된 티커: ${fixedCount}개`);

  console.log("app-data.json 저장 중...");
  fs.writeFileSync(appDataPath, JSON.stringify(appData, null, 2), "utf-8");

  console.log(`✅ 완료! ${fixedCount}개 티커의 깨진 이름이 수정되었습니다.`);
} catch (err) {
  console.error("❌ 오류:", err);
  process.exit(1);
}
