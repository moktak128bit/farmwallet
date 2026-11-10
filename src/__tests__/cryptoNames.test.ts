import { describe, expect, it } from "vitest";
import type { AppData, StockTrade } from "../types";
import { applyKoreanStockNames } from "../services/dataService";
import { cryptoKoreanName } from "../utils/finance";

const tr = (id: string, ticker: string, name: string): StockTrade =>
  ({ id, date: "2026-01-01", accountId: "UPBIT", ticker, name, side: "buy", quantity: 1, price: 1, fee: 0, totalAmount: 1, cashImpact: -1 } as StockTrade);

describe("코인 종목명 통일", () => {
  it("CoinGecko ID·심볼 모두 한글명", () => {
    expect(cryptoKoreanName("solana")).toBe("솔라나");
    expect(cryptoKoreanName("BTC")).toBe("비트코인");
    expect(cryptoKoreanName("MSFT")).toBeNull();
    expect(cryptoKoreanName("458730")).toBeNull();
  });

  it("같은 코인의 SOL/solana·BTC/bitcoin 이름을 하나로 맞춘다 (한글 커스텀명은 보존)", () => {
    const data = {
      trades: [tr("T1", "solana", "SOL"), tr("T2", "solana", "solana"), tr("T3", "bitcoin", "BTC"), tr("T4", "bitcoin", "bitcoin"), tr("T5", "ethereum", "이더")],
      prices: [{ ticker: "solana", name: "Solana", price: 1 }],
      ledger: [],
      tickerDatabase: [],
    } as unknown as AppData;
    const { data: out, changed } = applyKoreanStockNames(data);
    expect(changed).toBe(true);
    expect(out.trades.map((t) => t.name)).toEqual(["솔라나", "솔라나", "비트코인", "비트코인", "이더"]);
    expect(out.prices[0].name).toBe("솔라나");
  });
});
