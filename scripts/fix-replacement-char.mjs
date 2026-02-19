#!/usr/bin/env node
/**
 * app-data.json에서 "" 문자를 찾아서 수정
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
  const appData = JSON.parse(content);
  
  const replacementChar = "\uFFFD";
  let fixedCount = 0;
  
  // ledger에서 수정
  if (appData.ledger && Array.isArray(appData.ledger)) {
    appData.ledger = appData.ledger.map((entry) => {
      let modified = false;
      const newEntry = { ...entry };
      
      if (entry.fromAccountId && entry.fromAccountId.includes(replacementChar)) {
        // "신한카드" 또는 "신용카드" 패턴 추정
        if (entry.fromAccountId.includes("신") && entry.fromAccountId.includes("카")) {
          newEntry.fromAccountId = "신한카드";
          console.log(`ledger[${entry.id || "?"}]: fromAccountId "${entry.fromAccountId}" → "신한카드"`);
          modified = true;
        } else if (entry.fromAccountId.includes("용") && entry.fromAccountId.includes("카")) {
          newEntry.fromAccountId = "신용카드";
          console.log(`ledger[${entry.id || "?"}]: fromAccountId "${entry.fromAccountId}" → "신용카드"`);
          modified = true;
        } else {
          // 알 수 없는 경우, 대체 문자 제거 시도
          newEntry.fromAccountId = entry.fromAccountId.replace(/\uFFFD/g, "");
          console.log(`ledger[${entry.id || "?"}]: fromAccountId "${entry.fromAccountId}" → "${newEntry.fromAccountId}"`);
          modified = true;
        }
      }
      
      if (entry.toAccountId && entry.toAccountId.includes(replacementChar)) {
        if (entry.toAccountId.includes("신") && entry.toAccountId.includes("카")) {
          newEntry.toAccountId = "신한카드";
          console.log(`ledger[${entry.id || "?"}]: toAccountId "${entry.toAccountId}" → "신한카드"`);
          modified = true;
        } else if (entry.toAccountId.includes("용") && entry.toAccountId.includes("카")) {
          newEntry.toAccountId = "신용카드";
          console.log(`ledger[${entry.id || "?"}]: toAccountId "${entry.toAccountId}" → "신용카드"`);
          modified = true;
        } else {
          newEntry.toAccountId = entry.toAccountId.replace(/\uFFFD/g, "");
          console.log(`ledger[${entry.id || "?"}]: toAccountId "${entry.toAccountId}" → "${newEntry.toAccountId}"`);
          modified = true;
        }
      }
      
      if (entry.description && entry.description.includes(replacementChar)) {
        newEntry.description = entry.description.replace(/\uFFFD/g, "");
        console.log(`ledger[${entry.id || "?"}]: description 수정`);
        modified = true;
      }
      
      if (entry.category && entry.category.includes(replacementChar)) {
        newEntry.category = entry.category.replace(/\uFFFD/g, "");
        console.log(`ledger[${entry.id || "?"}]: category 수정`);
        modified = true;
      }
      
      if (entry.subcategory && entry.subcategory.includes(replacementChar)) {
        newEntry.subcategory = entry.subcategory.replace(/\uFFFD/g, "");
        console.log(`ledger[${entry.id || "?"}]: subcategory 수정`);
        modified = true;
      }
      
      if (modified) {
        fixedCount++;
      }
      
      return modified ? newEntry : entry;
    });
  }
  
  // accounts에서 수정
  if (appData.accounts && Array.isArray(appData.accounts)) {
    appData.accounts = appData.accounts.map((account) => {
      let modified = false;
      const newAccount = { ...account };
      
      if (account.name && account.name.includes(replacementChar)) {
        newAccount.name = account.name.replace(/\uFFFD/g, "");
        console.log(`accounts[${account.id || "?"}]: name "${account.name}" → "${newAccount.name}"`);
        modified = true;
      }
      
      return modified ? newAccount : account;
    });
  }
  
  // tickerDatabase에서 수정
  if (appData.tickerDatabase && Array.isArray(appData.tickerDatabase)) {
    appData.tickerDatabase = appData.tickerDatabase.map((ticker) => {
      let modified = false;
      const newTicker = { ...ticker };
      
      if (ticker.name && ticker.name.includes(replacementChar)) {
        newTicker.name = ticker.name.replace(/\uFFFD/g, "");
        console.log(`tickerDatabase[${ticker.ticker || ticker.code || "?"}]: name 수정`);
        modified = true;
      }
      
      if (ticker.ticker && ticker.ticker.includes(replacementChar)) {
        newTicker.ticker = ticker.ticker.replace(/\uFFFD/g, "");
        console.log(`tickerDatabase[${ticker.ticker || "?"}]: ticker 수정`);
        modified = true;
      }
      
      if (ticker.code && ticker.code.includes(replacementChar)) {
        newTicker.code = ticker.code.replace(/\uFFFD/g, "");
        console.log(`tickerDatabase[${ticker.code || "?"}]: code 수정`);
        modified = true;
      }
      
      if (modified) {
        fixedCount++;
      }
      
      return modified ? newTicker : ticker;
    });
  }
  
  console.log(`\n수정된 항목: ${fixedCount}개`);
  
  if (fixedCount > 0) {
    console.log("app-data.json 저장 중...");
    fs.writeFileSync(appDataPath, JSON.stringify(appData, null, 2), "utf-8");
    console.log(`✅ 완료! ${fixedCount}개 항목이 수정되었습니다.`);
  } else {
    console.log("✅ 수정할 항목이 없습니다.");
  }
  
} catch (err) {
  console.error("❌ 오류:", err);
  process.exit(1);
}
