/**
 * CoinGecko 무료 API를 사용한 암호화폐 시세 조회.
 * ticker에는 CoinGecko ID(예: bitcoin, ethereum)를 사용합니다.
 */

export interface CryptoQuoteResult {
  ticker: string; // CoinGecko ID (예: 'bitcoin')
  symbol: string; // 표시용 심볼 (예: 'BTC')
  priceKrw: number;
  priceUsd: number;
  changePercent24h?: number;
  updatedAt?: string;
}

const COINGECKO_SYMBOL_MAP: Record<string, string> = {
  bitcoin: "BTC",
  ethereum: "ETH",
  solana: "SOL",
  ripple: "XRP",
  "usd-coin": "USDC",
  tether: "USDT",
  binancecoin: "BNB",
  cardano: "ADA",
  dogecoin: "DOGE",
  "avalanche-2": "AVAX",
  "matic-network": "MATIC",
  "polkadot": "DOT",
  "chainlink": "LINK",
  "litecoin": "LTC",
  "uniswap": "UNI",
  "stellar": "XLM",
  "monero": "XMR",
  "cosmos": "ATOM",
  "ethereum-classic": "ETC"
};

function symbolForCoinId(id: string): string {
  return COINGECKO_SYMBOL_MAP[id.toLowerCase()] ?? id.slice(0, 3).toUpperCase();
}

/**
 * CoinGecko /simple/price로 여러 코인의 원화·달러 가격 및 24h 변동률 조회.
 * @param coinIds CoinGecko ID 배열 (예: ['bitcoin', 'ethereum'])
 */
export async function fetchCryptoQuotes(coinIds: string[], fxRate?: number): Promise<CryptoQuoteResult[]> {
  const uniqIds = Array.from(
    new Set(coinIds.map((id) => id.trim().toLowerCase()).filter(Boolean))
  );
  if (uniqIds.length === 0) return [];

  const idsParam = uniqIds.join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(idsParam)}&vs_currencies=krw,usd&include_24hr_change=true&include_last_updated_at=true`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);

    const data = (await res.json()) as Record<
      string,
      {
        krw?: number;
        usd?: number;
        krw_24h_change?: number;
        usd_24h_change?: number;
        last_updated_at?: number;
      }
    >;

    const results: CryptoQuoteResult[] = [];

    for (const id of uniqIds) {
      const coin = data[id];
      if (!coin || (coin.krw == null && coin.usd == null)) continue;

      const priceKrw = coin.krw ?? (coin.usd != null && fxRate ? coin.usd * fxRate : 0);
      const priceUsd = coin.usd ?? 0;
      const changePercent24h = coin.krw_24h_change ?? coin.usd_24h_change;
      const updatedAt =
        coin.last_updated_at != null
          ? new Date(coin.last_updated_at * 1000).toISOString()
          : undefined;

      results.push({
        ticker: id,
        symbol: symbolForCoinId(id),
        priceKrw,
        priceUsd,
        changePercent24h,
        updatedAt
      });
    }

    return results;
  } catch (err) {
    console.warn("CoinGecko API fetch failed:", err);
    return [];
  }
}
