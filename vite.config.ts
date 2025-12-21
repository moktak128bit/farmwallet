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
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on("end", () => {
            try {
              const parsed = JSON.parse(body);
              if (!fs.existsSync(backupsDir)) {
                fs.mkdirSync(backupsDir, { recursive: true });
              }
              const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
              const fileName = `backup-${timestamp}.json`;
              const fullPath = path.join(backupsDir, fileName);
              // 포맷팅된 JSON으로 저장 (들여쓰기 2칸)
              const formatted = JSON.stringify(parsed, null, 2);
              fs.writeFileSync(fullPath, formatted, "utf-8");
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ fileName, createdAt: new Date().toISOString() }));
            } catch {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Failed to save backup" }));
            }
          });
          return;
        }

        if (req.method === "GET") {
          try {
            if (!fs.existsSync(backupsDir)) {
              res.setHeader("Content-Type", "application/json");
              res.end("[]");
              return;
            }

            const url = new URL(req.url ?? "/", "http://localhost");
            const fileNameParam = url.searchParams.get("fileName");
            if (fileNameParam) {
              const safeName = path.basename(fileNameParam);
              const fullPath = path.join(backupsDir, safeName);
              if (!fs.existsSync(fullPath)) {
                res.statusCode = 404;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: "Backup not found" }));
                return;
              }
              const raw = fs.readFileSync(fullPath, "utf-8");
              res.setHeader("Content-Type", "application/json");
              res.end(raw);
              return;
            }

            const files = fs.readdirSync(backupsDir).filter((f: string) => f.endsWith(".json"));
            const list = files
              .map((fileName: string) => {
                const fullPath = path.join(backupsDir, fileName);
                const stat = fs.statSync(fullPath);
                const createdAt =
                  typeof stat.mtime === "string"
                    ? stat.mtime
                    : new Date(stat.mtimeMs).toISOString();
                return { fileName, createdAt };
              })
              .sort((a: { fileName: string }, b: { fileName: string }) =>
                b.fileName.localeCompare(a.fileName)
              );

            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(list));
          } catch {
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

export default defineConfig({
  plugins: [react(), backupApiPlugin()],
  server: {
    port: 5174
  }
});
