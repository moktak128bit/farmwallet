#!/usr/bin/env node
/**
 * data/ticker.json → data/app-data.json의 tickerDatabase 필드에 적용
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tickerPath = path.join(root, "data", "ticker.json");
const appDataPath = path.join(root, "data", "app-data.json");

try {
  // ticker.json 읽기
  console.log("ticker.json 읽는 중...");
  const tickerRaw = fs.readFileSync(tickerPath, "utf-8");
  const tickerData = JSON.parse(tickerRaw);
  
  const koreanTickers = tickerData.KR || [];
  const usTickers = tickerData.US || [];
  
  console.log(`한국 티커: ${koreanTickers.length}개`);
  console.log(`미국 티커: ${usTickers.length}개`);
  
  // TickerInfo[] 형식으로 변환
  const tickerDatabase = [];
  
  // ticker.json의 이름을 그대로 사용 (필요 시 앞뒤 공백만 정리)
  function fixBrokenName(name) {
    if (!name) return name;
    return String(name).trim();
  }

  // 한국 티커
  koreanTickers.forEach(({ ticker, name }) => {
    let fixedName = fixBrokenName(name);
    
    // 특정 티커 수동 수정 (깨진 패턴이 있는 경우)
    if (ticker === "424460") {
      fixedName = "HANARO 글로벌워터MSCI(합성)";
    }
    
    tickerDatabase.push({
      ticker,
      name: fixedName,
      market: "KR"
    });
  });
  
  // 미국 티커
  usTickers.forEach(({ ticker, name }) => {
    tickerDatabase.push({
      ticker,
      name: name || ticker,
      market: "US",
      exchange: "NYSE" // 기본값
    });
  });
  
  console.log(`총 ${tickerDatabase.length}개 티커 변환 완료`);
  
  // app-data.json 읽기
  console.log("app-data.json 읽는 중...");
  const appDataRaw = fs.readFileSync(appDataPath, "utf-8");
  const appData = JSON.parse(appDataRaw);
  
  // tickerDatabase 필드 업데이트
  appData.tickerDatabase = tickerDatabase;
  
  // app-data.json 저장
  console.log("app-data.json 저장 중...");
  fs.writeFileSync(appDataPath, JSON.stringify(appData, null, 2), "utf-8");
  
  console.log(`✅ 완료! app-data.json의 tickerDatabase에 ${tickerDatabase.length}개 티커가 적용되었습니다.`);
} catch (err) {
  console.error("❌ 오류:", err);
  process.exit(1);
}
