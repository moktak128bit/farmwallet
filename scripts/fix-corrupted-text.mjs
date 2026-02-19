#!/usr/bin/env node
/**
 * data/app-data.json의 깨진 텍스트 수정
 * - description: "협 장" → "농협 장"
 * - 티커/종목코드 깨진 문자 제거
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const appDataPath = path.join(root, "data", "app-data.json");

// 깨진 텍스트 수정 함수
function fixCorruptedText(text) {
  if (!text || typeof text !== "string") return text;
  
  // "협 장" → "농협 장"
  let fixed = text.replace(/협\s*장/g, "농협 장");
  
  // 깨진 문자 제거 (유니코드 대체 문자 제거)
  fixed = fixed.replace(/[\uFFFD\uFFFE\uFFFF]/g, "");
  
  // 일반적인 깨진 문자 패턴 수정
  // "데이비" → "데이트비" (description에도 적용)
  fixed = fixed.replace(/데이\s*비/g, "데이트비");
  fixed = fixed.replace(/이\s*비/g, "데이트비");
  
  // "유류통" → "유류교통비"
  fixed = fixed.replace(/유류\s*통/g, "유류교통비");
  
  // "식장" → "시장"
  fixed = fixed.replace(/식\s*장/g, "시장");
  
  // 연속된 공백 정리
  fixed = fixed.replace(/\s+/g, " ").trim();
  
  return fixed;
}

// 티커/종목코드 정리 (깨진 문자 제거, 공백 제거)
function cleanTicker(ticker) {
  if (!ticker || typeof ticker !== "string") return ticker;
  
  // 깨진 문자 제거 (유니코드 대체 문자 및 기타 깨진 문자)
  let cleaned = ticker.replace(/[\uFFFD\uFFFE\uFFFF\u200B-\u200D\uFEFF]/g, "");
  
  // 공백 제거
  cleaned = cleaned.replace(/\s+/g, "");
  
  // 대문자로 정규화
  cleaned = cleaned.toUpperCase();
  
  // 한국 주식 티커: 6자리 숫자/알파벳 조합만 허용
  if (/^[0-9A-Z]{6}$/.test(cleaned) && /[0-9]/.test(cleaned)) {
    return cleaned;
  }
  
  // 미국 주식 티커: 알파벳과 숫자, 점(.), 하이픈(-) 허용
  if (/^[A-Z0-9.\-]+$/.test(cleaned)) {
    return cleaned;
  }
  
  // 깨진 문자가 포함된 경우, 알파벳/숫자/점/하이픈만 남기기
  cleaned = cleaned.replace(/[^A-Z0-9.\-]/g, "");
  
  return cleaned;
}

try {
  console.log("app-data.json 읽는 중...");
  const appDataRaw = fs.readFileSync(appDataPath, "utf-8");
  const appData = JSON.parse(appDataRaw);

  let fixedCount = 0;

  // ledger의 description 수정
  if (appData.ledger && Array.isArray(appData.ledger)) {
    appData.ledger = appData.ledger.map((entry) => {
      const originalDesc = entry.description;
      const fixedDesc = fixCorruptedText(originalDesc);
      
      if (fixedDesc !== originalDesc) {
        fixedCount++;
        return {
          ...entry,
          description: fixedDesc
        };
      }
      return entry;
    });
  }

  // trades의 ticker와 name 수정
  if (appData.trades && Array.isArray(appData.trades)) {
    appData.trades = appData.trades.map((trade) => {
      const originalTicker = trade.ticker;
      const originalName = trade.name;
      const fixedTicker = cleanTicker(originalTicker);
      const fixedName = fixCorruptedText(originalName);
      
      let changed = false;
      const updated = { ...trade };
      
      if (fixedTicker !== originalTicker) {
        updated.ticker = fixedTicker;
        changed = true;
      }
      
      if (fixedName !== originalName) {
        updated.name = fixedName;
        changed = true;
      }
      
      if (changed) {
        fixedCount++;
        return updated;
      }
      
      return trade;
    });
  }

  // prices의 ticker와 name 수정
  if (appData.prices && Array.isArray(appData.prices)) {
    appData.prices = appData.prices.map((price) => {
      const originalTicker = price.ticker;
      const originalName = price.name;
      const fixedTicker = cleanTicker(originalTicker);
      const fixedName = fixCorruptedText(originalName);
      
      let changed = false;
      const updated = { ...price };
      
      if (fixedTicker !== originalTicker) {
        updated.ticker = fixedTicker;
        changed = true;
      }
      
      if (fixedName !== originalName) {
        updated.name = fixedName;
        changed = true;
      }
      
      if (changed) {
        fixedCount++;
        return updated;
      }
      
      return price;
    });
  }

  // tickerDatabase의 ticker와 name 수정
  if (appData.tickerDatabase && Array.isArray(appData.tickerDatabase)) {
    appData.tickerDatabase = appData.tickerDatabase.map((ticker) => {
      const originalTicker = ticker.ticker;
      const originalName = ticker.name;
      const fixedTicker = cleanTicker(originalTicker);
      const fixedName = fixCorruptedText(originalName);
      
      let changed = false;
      const updated = { ...ticker };
      
      if (fixedTicker !== originalTicker) {
        updated.ticker = fixedTicker;
        changed = true;
      }
      
      if (fixedName !== originalName) {
        updated.name = fixedName;
        changed = true;
      }
      
      if (changed) {
        fixedCount++;
        return updated;
      }
      
      return ticker;
    });
  }

  console.log(`수정된 항목: ${fixedCount}개`);

  console.log("app-data.json 저장 중...");
  fs.writeFileSync(appDataPath, JSON.stringify(appData, null, 2), "utf-8");

  console.log(`✅ 완료! ${fixedCount}개 항목의 깨진 텍스트가 수정되었습니다.`);
} catch (err) {
  console.error("❌ 오류:", err);
  process.exit(1);
}
