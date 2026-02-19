#!/usr/bin/env node
/**
 * 사용자가 제공한 모든 티커를 ticker.md와 비교하여 app-data.json 수정
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const appDataPath = path.join(root, "data", "app-data.json");
const tickerMdPath = path.join(root, "data", "ticker.md");

// 사용자가 제공한 모든 티커
const providedTickers = [
  { ticker: "483330", name: "ACE 마이크로소프트밸류인액브" },
  { ticker: "483340", name: "ACE 구글밸류체인액티브" },
  { ticker: "483420", name: "ACE 애플밸류체인액티브" },
  { ticker: "483570", name: "KCGI 미S&P500 TOP10" },
  { ticker: "483650", name: "달바글로벌" },
  { ticker: "484870", name: "엠앤씨솔루션" },
  { ticker: "484880", name: "SOL 금융지주플러스고배당" },
  { ticker: "485540", name: "Samsung Kodex Us Ai Tech Top10 Etf" },
  { ticker: "485690", name: "RISE 미국AI밸체TOP3Plus" },
  { ticker: "485810", name: "TIMEFOLIO 글로벌바이오액티브" },
  { ticker: "486240", name: "DAISHIN343 AI반도체&인프라액티브" },
  { ticker: "486290", name: "TIGER 미국스닥100타데일리커버드" },
  { ticker: "486450", name: "SOL국AI전력인프라" },
  { ticker: "487130", name: "KoAct AI인프라액티브" },
  { ticker: "487230", name: "KODEX 미국AI전력핵심인프라" },
  { ticker: "487240", name: "KODEX AI전력핵심설비" },
  { ticker: "487570", name: "HS효성" },
  { ticker: "487750", name: "BNK 온디바이스AI" },
  { ticker: "487910", name: "ACE 인도컨슈머파워액티브" },
  { ticker: "487920", name: "ACE 인도시장대표BIG5그룹액티브" },
  { ticker: "487950", name: "KODEX 대만테크고배당다우존스" },
  { ticker: "488080", name: "TIGER 반도체TOP10레버리지" },
  { ticker: "488200", name: "KIWOOM K-2차전지북미공급망" },
  { ticker: "488210", name: "KIWOOM K-반도체북미공급망" },
  { ticker: "488290", name: "마이다스 일본테크액티브" },
  { ticker: "488480", name: "RISE 일본섹터TOP4Plus" },
  { ticker: "488500", name: "TIGER 미국S&P500동일가중" },
  { ticker: "489010", name: "PLUS 글로벌AI인프라" },
  { ticker: "489030", name: "PLUS 고배당주위클리커버드콜" },
  { ticker: "489250", name: "KODEX 미국배당다우존스" },
  { ticker: "489290", name: "WON 미국빌리어네어" },
  { ticker: "489790", name: "한화비전" },
  { ticker: "489860", name: "KIWOOM 글로벌전력GRID인프라" },
  { ticker: "490090", name: "TIGER 미국AI빅테10" },
  { ticker: "490330", name: "KoAct 미국치매&뇌질환치료제액티" }
];

try {
  console.log("ticker.md 읽는 중...");
  const mdContent = fs.readFileSync(tickerMdPath, "utf-8");
  const lines = mdContent.split("\n").filter((line) => line.trim());
  const mdMap = new Map();
  for (const line of lines.slice(1)) {
    const parts = line.split("\t");
    if (parts.length >= 2) {
      const ticker = parts[0].trim();
      const name = parts[1].trim().replace(/\r\n|\r|\n/g, "");
      if (ticker && name) {
        mdMap.set(ticker, name);
      }
    }
  }

  console.log(`ticker.md 맵: ${mdMap.size}개\n`);

  console.log("app-data.json 읽는 중...");
  const appData = JSON.parse(fs.readFileSync(appDataPath, "utf-8"));

  if (!appData.tickerDatabase || !Array.isArray(appData.tickerDatabase)) {
    console.log("❌ tickerDatabase가 없습니다.");
    process.exit(1);
  }

  let fixedCount = 0;
  const fixedTickers = [];
  const notFoundTickers = [];

  console.log("제공된 티커 확인 및 수정:\n");
  providedTickers.forEach((provided) => {
    const tickerCode = provided.ticker;
    const providedName = provided.name;
    const correctName = mdMap.get(tickerCode);
    
    if (!correctName) {
      notFoundTickers.push(tickerCode);
      console.warn(`⚠️ ${tickerCode}: ticker.md에서 찾을 수 없음`);
      return;
    }

    const ticker = appData.tickerDatabase.find(
      (t) => t.ticker === tickerCode && t.market === "KR"
    );

    if (!ticker) {
      console.warn(`⚠️ ${tickerCode}: tickerDatabase에서 찾을 수 없음`);
      return;
    }

    // ticker.md의 이름으로 무조건 덮어쓰기
    console.log(`${tickerCode}:`);
    console.log(`  제공된 이름: "${providedName}"`);
    console.log(`  현재 이름:  "${ticker.name}"`);
    console.log(`  ticker.md:    "${correctName}"`);
    
    // ticker.md의 이름으로 덮어쓰기
    ticker.name = correctName;
    console.log(`  → ticker.md 기준으로 설정됨\n`);
    fixedTickers.push(tickerCode);
    fixedCount++;
  });

  if (notFoundTickers.length > 0) {
    console.log(`\n⚠️ ticker.md에서 찾을 수 없는 티커: ${notFoundTickers.join(", ")}`);
  }

  console.log(`\n수정된 티커: ${fixedCount}개`);
  if (fixedTickers.length > 0) {
    console.log(`수정된 티커 코드: ${fixedTickers.join(", ")}`);
  }

  if (fixedCount > 0) {
    console.log("\napp-data.json 저장 중...");
    fs.writeFileSync(appDataPath, JSON.stringify(appData, null, 2), "utf-8");
    console.log(`✅ 완료! ${fixedCount}개 티커가 수정되었습니다.`);
  } else {
    console.log("\n✅ 모든 티커가 이미 정상입니다.");
  }
} catch (err) {
  console.error("❌ 오류:", err);
  process.exit(1);
}
