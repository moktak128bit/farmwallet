import { useEffect, useState } from "react";
import { fetchYahooQuotes } from "../yahooFinanceApi";
import { FX_UPDATE_INTERVAL } from "../constants/config";

export function useFxRate() {
  const [fxRate, setFxRate] = useState<number | null>(null);

  useEffect(() => {
    const updateFxRate = async () => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useFxRate.ts:9',message:'updateFxRate start',data:{component:'useFxRate'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      try {
        const res = await fetchYahooQuotes(["USDKRW=X"]);
        const r = res[0];
        if (r?.price) {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useFxRate.ts:14',message:'fx rate updated',data:{price:r.price},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          setFxRate(r.price);
        }
      } catch (err) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useFxRate.ts:17',message:'FX fetch failed',data:{error:String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        // 조용히 실패 처리 (API가 일시적으로 사용 불가능할 수 있음)
      }
    };
    updateFxRate();
    const interval = setInterval(updateFxRate, FX_UPDATE_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  return fxRate;
}
