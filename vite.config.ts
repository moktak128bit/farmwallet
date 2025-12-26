import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import fs from "fs";
import path from "path";
import https from "https";
import type { IncomingMessage, ServerResponse } from "http";

function backupApiPlugin(): Plugin {
  return {
    name: "backup-api",
    configureServer(server) {
      const backupsDir = path.join(process.cwd(), "backups");
      const dataDir = path.join(process.cwd(), "data");
      const dataFile = path.join(dataDir, "app-data.json");

      server.middlewares.use("/api/backup", (req: IncomingMessage, res: ServerResponse, next) => {
        // #region agent log
        const logPath = path.join(process.cwd(), ".cursor", "debug.log");
        const log = (msg: string, data: any) => {
          try {
            const entry = JSON.stringify({
              timestamp: Date.now(),
              location: "vite.config.ts:backup-api",
              message: msg,
              data,
              sessionId: "debug-session",
              runId: "run1"
            }) + "\n";
            fs.appendFileSync(logPath, entry, "utf-8");
          } catch {}
        };
        // #endregion
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on("end", () => {
            try {
              // #region agent log
              log("POST /api/backup 시작", { backupsDir, bodyLength: body.length });
              // #endregion
              const parsed = JSON.parse(body);
              if (!fs.existsSync(backupsDir)) {
                fs.mkdirSync(backupsDir, { recursive: true });
              }
              const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
              const dateFolder = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
              const dateDir = path.join(backupsDir, dateFolder);
              // #region agent log
              log("날짜 폴더 생성 시도", { dateFolder, dateDir, exists: fs.existsSync(dateDir) });
              // #endregion
              if (!fs.existsSync(dateDir)) {
                fs.mkdirSync(dateDir, { recursive: true });
              }
              const fileName = `backup-${timestamp}.json`;
              const fullPath = path.join(dateDir, fileName);
              const relativePath = `${dateFolder}/${fileName}`;
              // #region agent log
              log("백업 파일 저장 경로", { fileName, fullPath, relativePath });
              // #endregion
              // 포맷팅된 JSON으로 저장 (들여쓰기 2칸)
              const formatted = JSON.stringify(parsed, null, 2);
              fs.writeFileSync(fullPath, formatted, "utf-8");
              // #region agent log
              log("백업 파일 저장 완료", { relativePath, fileSize: formatted.length });
              // #endregion
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ fileName: relativePath, createdAt: new Date().toISOString() }));
            } catch (err) {
              // #region agent log
              log("POST /api/backup 에러", { error: String(err) });
              // #endregion
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Failed to save backup" }));
            }
          });
          return;
        }

        if (req.method === "GET") {
          try {
            // #region agent log
            log("GET /api/backup 시작", { backupsDir, exists: fs.existsSync(backupsDir) });
            // #endregion
            if (!fs.existsSync(backupsDir)) {
              res.setHeader("Content-Type", "application/json");
              res.end("[]");
              return;
            }

            const url = new URL(req.url ?? "/", "http://localhost");
            const fileNameParam = url.searchParams.get("fileName");
            if (fileNameParam) {
              // #region agent log
              log("특정 백업 파일 로드 요청", { fileNameParam });
              // #endregion
              // 날짜 폴더를 포함한 경로 처리 (예: "2025-12-26/backup-xxx.json")
              const normalizedPath = fileNameParam.replace(/\\/g, "/"); // Windows 경로 정규화
              const fullPath = path.join(backupsDir, normalizedPath);
              // #region agent log
              log("백업 파일 경로 해석", { normalizedPath, fullPath, exists: fs.existsSync(fullPath) });
              // #endregion
              if (!fs.existsSync(fullPath)) {
                // #region agent log
                log("백업 파일 없음", { fullPath });
                // #endregion
                res.statusCode = 404;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: "Backup not found" }));
                return;
              }
              const raw = fs.readFileSync(fullPath, "utf-8");
              // #region agent log
              log("백업 파일 로드 성공", { fullPath, fileSize: raw.length });
              // #endregion
              res.setHeader("Content-Type", "application/json");
              res.end(raw);
              return;
            }

            // 날짜별 폴더를 재귀적으로 탐색
            const list: Array<{ fileName: string; createdAt: string }> = [];
            const scanDir = (dir: string, basePath: string = "") => {
              const entries = fs.readdirSync(dir, { withFileTypes: true });
              for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                  scanDir(fullPath, relativePath);
                } else if (entry.isFile() && entry.name.endsWith(".json") && entry.name.startsWith("backup-")) {
                  // backup-로 시작하는 파일만 백업으로 간주 (ticker-latest.json 제외)
                  const stat = fs.statSync(fullPath);
                  const createdAt =
                    typeof stat.mtime === "string"
                      ? stat.mtime
                      : new Date(stat.mtimeMs).toISOString();
                  list.push({ fileName: relativePath, createdAt });
                }
              }
            };
            scanDir(backupsDir);
            // #region agent log
            log("백업 목록 스캔 완료", { count: list.length, files: list.slice(0, 5).map(l => l.fileName) });
            // #endregion
            // createdAt 기준으로 정렬 (최신순)
            list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(list));
          } catch (err) {
            // #region agent log
            log("GET /api/backup 에러", { error: String(err) });
            // #endregion
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end("[]");
          }
          return;
        }

        next();
      });

      // App data 저장/로드 (로컬 파일)
      server.middlewares.use("/api/data-store", (req: IncomingMessage, res: ServerResponse, next) => {
        try {
          if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
          }
        } catch {
          // ignore dir creation errors
        }

        if (req.method === "GET") {
          try {
            if (!fs.existsSync(dataFile)) {
              res.setHeader("Content-Type", "application/json");
              res.end("{}");
              return;
            }
            const raw = fs.readFileSync(dataFile, "utf-8");
            res.setHeader("Content-Type", "application/json");
            res.end(raw);
          } catch {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Failed to read data" }));
          }
          return;
        }

        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => (body += chunk.toString()));
          req.on("end", () => {
            try {
              JSON.parse(body);
              if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
              }
              fs.writeFileSync(dataFile, body, "utf-8");
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true, savedAt: new Date().toISOString() }));
            } catch {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Failed to save data" }));
            }
          });
          return;
        }

        next();
      });

      // 야후 파이낸스 프록시 (CORS 우회용)
      server.middlewares.use(
        "/api/yahoo-quote",
        (req: IncomingMessage, res: ServerResponse, next) => {
          if (req.method !== "GET" || !req.url) {
            next();
            return;
          }

          try {
            const url = new URL(req.url, "http://localhost");
            const symbols = url.searchParams.get("symbols");
            if (!symbols) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "symbols query is required" }));
              return;
            }

            const yahooUrl = new URL(
              "https://query1.finance.yahoo.com/v7/finance/quote"
            );
            yahooUrl.searchParams.set("symbols", symbols);

            https
              .get(yahooUrl, (yahooRes) => {
                let body = "";
                yahooRes.on("data", (chunk) => {
                  body += chunk.toString();
                });
                yahooRes.on("end", () => {
                  res.statusCode = yahooRes.statusCode ?? 200;
                  res.setHeader("Content-Type", "application/json");
                  res.end(body);
                });
              })
              .on("error", () => {
                res.statusCode = 500;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: "Failed to fetch Yahoo quotes" }));
              });
          } catch {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Invalid request" }));
          }
        }
      );

      // ticker.json 파일 업데이트 API
      const tickerJsonFile = path.join(process.cwd(), "data", "ticker.json");
      server.middlewares.use("/api/ticker-json", (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on("end", () => {
            try {
              const { ticker, name, market } = JSON.parse(body);
              
              // 기존 파일 읽기
              let tickerData: { KR: Array<{ ticker: string; name: string }>; US: Array<{ ticker: string; name: string }> } = { KR: [], US: [] };
              
              if (fs.existsSync(tickerJsonFile)) {
                const fileContent = fs.readFileSync(tickerJsonFile, "utf-8");
                try {
                  tickerData = JSON.parse(fileContent);
                } catch (parseErr) {
                  console.warn("Failed to parse ticker.json, using empty data");
                }
              }
              
              const normalizedTicker = ticker.toUpperCase();
              const targetArray = market === 'KR' ? tickerData.KR : tickerData.US;
              
              // 기존 티커 찾아서 업데이트
              const existingIndex = targetArray.findIndex(item => item.ticker.toUpperCase() === normalizedTicker);
              
              if (existingIndex >= 0) {
                // 티커가 있는데 이름이 다르면 이름 변경
                if (name && targetArray[existingIndex].name !== name) {
                  targetArray[existingIndex].name = name;
                }
              } else {
                // 없으면 추가(티커와 종목명)
                targetArray.push({
                  ticker: normalizedTicker,
                  name: name || normalizedTicker
                });
              }
              
              // 정렬 (한국은 티커 기준, 미국도 티커 기준)
              targetArray.sort((a, b) => a.ticker.localeCompare(b.ticker));
              
              // 파일 저장
              const formatted = JSON.stringify(tickerData, null, 2);
              fs.writeFileSync(tickerJsonFile, formatted, "utf-8");
              
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true, updated: existingIndex >= 0 }));
            } catch (err) {
              console.error("Failed to update ticker.json:", err);
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Failed to update ticker.json" }));
            }
          });
          return;
        }
        
        if (req.method === "GET") {
          try {
            if (!fs.existsSync(tickerJsonFile)) {
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ KR: [], US: [] }));
              return;
            }
            const fileContent = fs.readFileSync(tickerJsonFile, "utf-8");
            res.setHeader("Content-Type", "application/json");
            res.end(fileContent);
          } catch (err) {
            console.error("Failed to read ticker.json:", err);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Failed to read ticker.json" }));
          }
          return;
        }
        
        next();
      });
    }
  };
}

import packageJson from "./package.json";

export default defineConfig({
  plugins: [react(), backupApiPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version)
  },
  server: {
    port: 5174
  }
});
