import fs from "node:fs";
import path from "node:path";

const distDir = path.resolve("dist");
const indexPath = path.join(distDir, "index.html");

function fail(message) {
  console.error(`[smoke-test] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(distDir)) {
  fail("dist 디렉터리가 없습니다. 먼저 `npm run build`를 실행하세요.");
}

if (!fs.existsSync(indexPath)) {
  fail("dist/index.html 파일이 없습니다.");
}

const indexHtml = fs.readFileSync(indexPath, "utf-8");
if (!indexHtml.includes('id="root"')) {
  fail("index.html에 root 마운트 포인트가 없습니다.");
}

const assetsDir = path.join(distDir, "assets");
if (!fs.existsSync(assetsDir)) {
  fail("dist/assets 디렉터리가 없습니다.");
}

const assetFiles = fs.readdirSync(assetsDir);
if (assetFiles.length === 0) {
  fail("dist/assets에 빌드 산출물이 없습니다.");
}

const jsBundleCount = assetFiles.filter((name) => name.endsWith(".js")).length;
if (jsBundleCount === 0) {
  fail("JavaScript 번들이 생성되지 않았습니다.");
}

console.log(`[smoke-test] ok (assets: ${assetFiles.length}, js bundles: ${jsBundleCount})`);
