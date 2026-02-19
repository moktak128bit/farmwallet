#!/usr/bin/env node
/**
 * app-data.json의 깨진 티커를 표 형식으로 출력
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const appDataPath = path.join(root, "data", "app-data.json");
const tickerJsonPath = path.join(root, "data", "ticker.json");

try {
  console.log("app-data.json 읽는 중...");
  const appData = JSON.parse(fs.readFileSync(appDataPath, "utf-8"));
  
  console.log("ticker.json 읽는 중...");
  const tickerData = JSON.parse(fs.readFileSync(tickerJsonPath, "utf-8"));
  
  const krMap = new Map();
  (tickerData.KR || []).forEach(({ ticker, name }) => {
    if (ticker) krMap.set(String(ticker), String(name ?? "").trim());
  });
  
  const kr = appData.tickerDatabase?.filter((t) => t.market === "KR") || [];
  
  const broken = [];
  
  kr.forEach((t) => {
    const n = t.name;
    const issues = [];
    
    // 유니코드 대체 문자
    if (/[\uFFFD\uFFFE\uFFFF]/.test(n)) issues.push("대체문자");
    
    // 반복 문자 (3번 이상)
    if (/([가-힣])\1{2,}/.test(n)) issues.push("반복문자3+");
    
    // 반복 문자 (2번) - 단, "대장장이"는 정상이므로 제외
    if (/([가-힣])\1/.test(n) && !n.includes("대장장이")) issues.push("반복문자2");
    
    // 깨진 패턴들
    if (n.includes("창판") && !n.includes("과창판")) issues.push("창판");
    if (n.includes("에너나") && !n.includes("에너지나") && n.includes("나스닥")) issues.push("에너나");
    if (n.includes("2차지") && !n.includes("2차전지")) issues.push("2차지");
    if (n.includes("로벌워") && !n.includes("글로벌워터")) issues.push("로벌워");
    if (n.includes("레리지") && !n.includes("레버리지")) issues.push("레리지");
    if (n.includes("레리지(성") || n.includes("레버리지(성")) issues.push("레리지성");
    if (n.includes("에플러스") && !n.includes("에셋플러스")) issues.push("에플러스");
    if (n.includes("에바이오") && !n.includes("에셋바이오")) issues.push("에바이오");
    if (n.includes("글글") && !n.includes("글로벌")) issues.push("글글");
    if (n.includes("터터") && !n.includes("글로벌워터")) issues.push("터터");
    if (n.includes("런런")) issues.push("런런");
    if (n.includes("글로벌워") && !n.includes("글로벌워터") && !n.includes("글로벌워런") && !n.includes("글로벌워터MSCI")) issues.push("글로벌워");
    if (n.includes("대장이") && !n.includes("대장장이")) issues.push("대장이");
    
    if (issues.length > 0) {
      const correctName = krMap.get(t.ticker) || "(ticker.json에 없음)";
      broken.push({
        ticker: t.ticker,
        brokenName: n,
        correctName,
        issues: issues.join(", ")
      });
    }
  });
  
  console.log(`\n깨진 티커: ${broken.length}개\n`);
  
  if (broken.length === 0) {
    console.log("✅ 깨진 티커가 없습니다!");
    process.exit(0);
  }
  
  // 표 헤더
  console.log("| 티커 | 깨진 이름 | 정상 이름 (ticker.json) | 문제 유형 |");
  console.log("|------|-----------|------------------------|----------|");
  
  // 표 내용
  broken.forEach((b) => {
    const ticker = b.ticker.padEnd(8);
    const brokenName = (b.brokenName.length > 30 ? b.brokenName.substring(0, 27) + "..." : b.brokenName).padEnd(35);
    const correctName = (b.correctName.length > 30 ? b.correctName.substring(0, 27) + "..." : b.correctName).padEnd(30);
    const issues = b.issues.padEnd(20);
    console.log(`| ${ticker} | ${brokenName} | ${correctName} | ${issues} |`);
  });
  
  console.log(`\n총 ${broken.length}개 티커가 깨져 있습니다.`);
  console.log(`수정하려면: npm run sync-ticker-names`);
  
} catch (err) {
  console.error("❌ 오류:", err);
  process.exit(1);
}
