#!/usr/bin/env node
/**
 * app-data.json에서 "" 문자를 찾기
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const appDataPath = path.join(root, "data", "app-data.json");

try {
  console.log("app-data.json 읽는 중...");
  const content = fs.readFileSync(appDataPath, "utf-8");
  
  // "" 문자 찾기 (U+FFFD)
  const replacementChar = "\uFFFD";
  const matches = [];
  
  // JSON 파싱해서 tickerDatabase에서 찾기
  const appData = JSON.parse(content);
  
  if (!appData.tickerDatabase || !Array.isArray(appData.tickerDatabase)) {
    console.log("❌ tickerDatabase가 없습니다.");
    process.exit(1);
  }
  
  console.log(`tickerDatabase 총 ${appData.tickerDatabase.length}개\n`);
  
  // tickerDatabase에서 "" 문자 포함 항목 찾기
  const broken = appData.tickerDatabase.filter((t) => {
    if (t.name && t.name.includes(replacementChar)) {
      return true;
    }
    if (t.ticker && t.ticker.includes(replacementChar)) {
      return true;
    }
    if (t.code && t.code.includes(replacementChar)) {
      return true;
    }
    return false;
  });
  
  console.log(`"" 문자 포함 항목: ${broken.length}개\n`);
  
  if (broken.length > 0) {
    broken.forEach((t) => {
      const issues = [];
      if (t.name && t.name.includes(replacementChar)) {
        issues.push(`name: "${t.name}"`);
      }
      if (t.ticker && t.ticker.includes(replacementChar)) {
        issues.push(`ticker: "${t.ticker}"`);
      }
      if (t.code && t.code.includes(replacementChar)) {
        issues.push(`code: "${t.code}"`);
      }
      console.log(`${t.ticker || t.code || "?"} | ${issues.join(", ")}`);
    });
  } else {
    console.log("✅ 대체 문자를 찾을 수 없습니다.");
  }
  
  // 원본 파일 내용에서도 직접 검색
  console.log("\n원본 파일 내용에서 직접 검색...");
  const rawMatches = [];
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    if (line.includes(replacementChar)) {
      // 대체 문자가 포함된 위치 찾기
      const positions = [];
      let pos = line.indexOf(replacementChar);
      while (pos !== -1) {
        positions.push(pos);
        pos = line.indexOf(replacementChar, pos + 1);
      }
      const firstPos = positions[0];
      rawMatches.push({ 
        line: idx + 1, 
        positions, 
        content: line.substring(Math.max(0, firstPos - 50), Math.min(line.length, firstPos + 50)) 
      });
    }
  });
  
  if (rawMatches.length > 0) {
    console.log(`원본 파일에서 대체 문자 발견: ${rawMatches.length}개 위치\n`);
    rawMatches.slice(0, 10).forEach((m) => {
      console.log(`라인 ${m.line}: 위치 ${m.positions.join(", ")}`);
      console.log(`  컨텍스트: ...${m.content}...\n`);
    });
  } else {
    console.log("원본 파일에서도 대체 문자를 찾을 수 없습니다.");
  }
  
} catch (err) {
  console.error("❌ 오류:", err);
  process.exit(1);
}
