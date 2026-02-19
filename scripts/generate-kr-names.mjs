#!/usr/bin/env node
/**
 * ticker.json + ticker.md에서 한국 종목 한글이름 맵 생성
 * 출력: src/data/krNames.json (ticker -> name)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tickerJsonPath = path.join(root, "data", "ticker.json");
const tickerMdPath = path.join(root, "data", "ticker.md");
const outPath = path.join(root, "src", "data", "krNames.json");

function cleanTicker(raw) {
  if (!raw || typeof raw !== "string") return "";
  return raw.toUpperCase().replace(/\.(KS|KQ|KO|K|KSQ)$/i, "");
}

function isKRWStock(ticker) {
  if (!ticker) return false;
  return cleanTicker(ticker).length >= 6;
}

function hasHangul(s) {
  return /[가-힣]/.test(String(s));
}

const map = {};

// 1. ticker.json KR (한글 포함만)
try {
  const kr = JSON.parse(fs.readFileSync(tickerJsonPath, "utf-8")).KR ?? [];
  kr.forEach(({ ticker, name }) => {
    if (ticker && name && hasHangul(name) && isKRWStock(ticker)) {
      map[cleanTicker(ticker)] = String(name).trim();
    }
  });
} catch (e) {
  console.warn("ticker.json 로드 실패:", e.message);
}

// 2. ticker.md (덮어쓰기)
try {
  const lines = fs.readFileSync(tickerMdPath, "utf-8").split("\n").slice(1);
  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length >= 2) {
      const ticker = cleanTicker(parts[0].trim());
      const name = parts[1].trim().replace(/\r\n|\r|\n/g, "");
      if (ticker && name && isKRWStock(ticker)) {
        map[ticker] = name;
      }
    }
  }
} catch (e) {
  console.warn("ticker.md 로드 실패:", e.message);
}

const outDir = path.dirname(outPath);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(map, null, 0), "utf-8");
console.log(`✅ krNames.json 생성 완료 (${Object.keys(map).length}개)`);
