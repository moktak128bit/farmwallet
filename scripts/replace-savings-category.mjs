#!/usr/bin/env node
/**
 * app-data.json 및 모든 백업 JSON에서 subCategory "적금" → "청년도약계좌" 일괄 변경
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function processFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  let changed = false;
  let newContent = content;

  // "subCategory": "적금" → "subCategory": "청년도약계좌"
  if (content.includes('"subCategory": "적금"') || content.includes('"subCategory":"적금"')) {
    newContent = newContent
      .replace(/"subCategory":\s*"적금"/g, '"subCategory": "청년도약계좌"');
    changed = true;
  }

  // "적금"이 독립된 JSON 문자열 값일 때만 교체 (subs 배열 등. "트라이적금" 같은 description은 제외)
  if (/"적금"/.test(newContent)) {
    newContent = newContent.replace(/(?<=")적금(?=")/g, "청년도약계좌");
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(filePath, newContent, "utf-8");
    return true;
  }
  return false;
}

const appDataPath = path.join(root, "data", "app-data.json");
let appCount = 0;
if (fs.existsSync(appDataPath)) {
  if (processFile(appDataPath)) appCount++;
}

const backupsDir = path.join(root, "backups");
let backupCount = 0;
if (fs.existsSync(backupsDir)) {
  const dirs = fs.readdirSync(backupsDir);
  for (const dir of dirs) {
    const dirPath = path.join(backupsDir, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      if (processFile(filePath)) backupCount++;
    }
  }
}

console.log("app-data.json:", appCount > 0 ? "changed" : "no change");
console.log("Backup files changed:", backupCount);
