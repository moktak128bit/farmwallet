/**
 * GAS 웹앱 화면 빌드 — src/를 Apps Script HtmlService용 단일 HTML(gas/index.html)로 만든다.
 *
 *   npm run build:gas            → gas/index.html 생성 (배포는 별도: cd gas && clasp push)
 *
 * - 일반 vite.config.ts(PWA·개발 서버 API)를 쓰지 않는다. HtmlService는 정적 파일을 서빙하지 못해
 *   JS·CSS를 HTML 안에 넣고, 동적 import는 하나로 합치고, 워커는 끈다(VITE_GAS_BUILD=1 → 메인 스레드 계산).
 * - 서비스 워커·PWA 설치는 iframe에서 불가 — virtual:pwa-register/react를 스텁으로 바꾼다.
 * - gas/Code.js·Config.js·appsscript.json은 건드리지 않는다(서버 소스는 gas/가 원본).
 */
import { build } from "vite";
import react from "@vitejs/plugin-react-swc";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gasDir = path.join(root, "gas");
const raw = path.join(root, "node_modules", ".gas-build");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

// 일반 빌드의 prebuild와 같은 준비 단계(한글 종목명 사전 생성)
execFileSync(process.execPath, [path.join(root, "scripts", "generate-kr-names.mjs")], { cwd: root, stdio: "inherit" });

await rm(raw, { recursive: true, force: true });
await mkdir(raw, { recursive: true });
await build({
  configFile: false,
  root,
  publicDir: false,
  base: "./",
  plugins: [react()],
  resolve: { alias: { "virtual:pwa-register/react": path.join(root, "scripts", "gas-pwa-stub.ts") } },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    "import.meta.env.VITE_GAS_BUILD": JSON.stringify("1"),
  },
  build: {
    outDir: raw,
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 5000,
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  logLevel: "warn",
});

let html = await readFile(path.join(raw, "index.html"), "utf8");
const scriptMatch = html.match(/<script type="module" crossorigin src="([^"]+)"><\/script>/);
const styleMatch = html.match(/<link rel="stylesheet" crossorigin href="([^"]+)">/);
if (!scriptMatch || !styleMatch) throw new Error("예상과 다른 Vite 출력: 메인 스크립트나 스타일시트가 없습니다");
const assetPath = (url) => path.join(raw, url.replace(/^\.\//, ""));
const js = await readFile(assetPath(scriptMatch[1]), "utf8");
const css = await readFile(assetPath(styleMatch[1]), "utf8");
if (/\b__APP_VERSION__\b/.test(js)) throw new Error("앱 버전 상수가 치환되지 않았습니다");
if (/new Worker\(/.test(js)) throw new Error("워커 생성 코드가 남았습니다 — VITE_GAS_BUILD 분기를 확인하세요");
if (!js.includes("google")) throw new Error("GAS 연결 코드(services/gas.ts)가 번들에 없습니다");

// CSS는 head에(골격 화면이 첫 페인트부터 스타일을 갖게), 2.4MB 번들은 body 맨 끝으로 — head에 두면
// 브라우저가 번들 텍스트를 다 읽을 때까지 골격 화면(index.html #boot-splash)도 못 그린다.
// (index.html에선 body 끝이던 <script type="module" src>를 Vite가 head로 옮겨 두므로 여기서 다시 내린다)
html = html.replace(scriptMatch[0], "");
html = html.replace(styleMatch[0], () => `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`);
if (!html.includes('id="boot-splash"')) throw new Error("시작 골격 화면(index.html #boot-splash)이 빠졌습니다");
if (!html.includes("</body>")) throw new Error("예상과 다른 Vite 출력: </body>가 없습니다");
html = html.replace("</body>", () => `<script type="module">${js.replace(/<\/script/gi, "<\\/script")}</script>\n  </body>`);
// 아이콘·매니페스트는 HtmlService에서 경로가 없다
html = html.replace(/\s*<link rel="(?:icon|apple-touch-icon|manifest)"[^>]*>/g, "");

await writeFile(path.join(gasDir, "index.html"), html);
await rm(raw, { recursive: true, force: true });
console.log(`gas/index.html 생성 (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB, v${packageJson.version})`);
