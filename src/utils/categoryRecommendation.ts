import type { LedgerEntry } from "../types";

interface Recommendation {
  category?: string;
  subCategory?: string;
  fromAccountId?: string;
  toAccountId?: string;
  score: number;
}

export function recommendCategory(
  description: string,
  amount: number,
  kind: "income" | "expense" | "transfer",
  ledger: LedgerEntry[]
): Recommendation[] {
  if (!description || description.length < 2) return [];

  const descLower = description.toLowerCase();
  const recommendations: Map<string, Recommendation> = new Map();

  // 과거 거래 패턴 분석
  ledger.forEach((entry) => {
    if (entry.kind !== kind) return;
    if (!entry.description || entry.description.length < 2) return;

    // 설명 유사도 계산 (간단한 문자열 포함 검사)
    const entryDescLower = entry.description.toLowerCase();
    let similarity = 0;

    // 단어 단위 유사도
    const descWords = descLower.split(/\s+/);
    const entryWords = entryDescLower.split(/\s+/);
    const commonWords = descWords.filter((w) => entryWords.includes(w));
    similarity += (commonWords.length / Math.max(descWords.length, entryWords.length)) * 0.5;

    // 부분 문자열 일치
    if (entryDescLower.includes(descLower) || descLower.includes(entryDescLower)) {
      similarity += 0.3;
    }

    // 금액 범위 유사도 (같은 범위대면 가중치 추가)
    const amountDiff = Math.abs(entry.amount - amount);
    const amountSimilarity = amountDiff < amount * 0.1 ? 0.2 : amountDiff < amount * 0.5 ? 0.1 : 0;

    const totalScore = similarity + amountSimilarity;

    if (totalScore > 0.3) {
      const key = `${entry.category || ""}:${entry.subCategory || ""}:${entry.fromAccountId || ""}:${entry.toAccountId || ""}`;
      const existing = recommendations.get(key);
      if (!existing || existing.score < totalScore) {
        recommendations.set(key, {
          category: entry.category,
          subCategory: entry.subCategory,
          fromAccountId: entry.fromAccountId,
          toAccountId: entry.toAccountId,
          score: totalScore
        });
      }
    }
  });

  // 사용 빈도 가중치 추가
  const frequencyMap = new Map<string, number>();
  ledger.forEach((entry) => {
    if (entry.kind !== kind) return;
    const key = `${entry.category || ""}:${entry.subCategory || ""}:${entry.fromAccountId || ""}:${entry.toAccountId || ""}`;
    frequencyMap.set(key, (frequencyMap.get(key) || 0) + 1);
  });

  // 최근 사용일 가중치 추가
  const recentMap = new Map<string, string>();
  ledger.forEach((entry) => {
    if (entry.kind !== kind) return;
    const key = `${entry.category || ""}:${entry.subCategory || ""}:${entry.fromAccountId || ""}:${entry.toAccountId || ""}`;
    const existing = recentMap.get(key);
    if (!existing || entry.date > existing) {
      recentMap.set(key, entry.date);
    }
  });

  // 최종 점수 계산
  const finalRecommendations = Array.from(recommendations.entries()).map(([key, rec]) => {
    const frequency = frequencyMap.get(key) || 0;
    const lastUsed = recentMap.get(key) || "";
    const now = new Date();
    const lastUsedDate = lastUsed ? new Date(lastUsed) : new Date(0);
    const daysSince = (now.getTime() - lastUsedDate.getTime()) / (1000 * 60 * 60 * 24);
    
    // 빈도 가중치 (최대 0.2)
    const freqWeight = Math.min(frequency / 10, 0.2);
    // 최근성 가중치 (30일 이내면 0.1, 그 외는 감소)
    const recencyWeight = daysSince < 30 ? 0.1 : daysSince < 90 ? 0.05 : 0;

    return {
      ...rec,
      score: rec.score + freqWeight + recencyWeight
    };
  });

  // 점수 순으로 정렬
  return finalRecommendations
    .sort((a, b) => b.score - a.score)
    .slice(0, 5); // 상위 5개만 반환
}

