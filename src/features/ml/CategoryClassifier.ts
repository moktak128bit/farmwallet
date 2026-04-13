import type { LedgerEntry, LedgerKind } from "../../types";

const STORAGE_KEY = "farmwallet-classifier-v1";

interface ClassifierModel {
  version: 1;
  /** word -> { categoryKey -> count } */
  wordCounts: Record<string, Record<string, number>>;
  /** categoryKey -> total docs */
  categoryDocs: Record<string, number>;
  /** categoryKey -> { category, subCategory } */
  categoryMeta: Record<string, { category: string; subCategory?: string }>;
  totalDocs: number;
  /** total entries observed for accuracy reporting */
  evaluations: { correct: number; total: number };
}

const emptyModel = (): ClassifierModel => ({
  version: 1,
  wordCounts: {},
  categoryDocs: {},
  categoryMeta: {},
  totalDocs: 0,
  evaluations: { correct: 0, total: 0 }
});

const tokenize = (text: string): string[] => {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
};

const keyOf = (category: string, subCategory?: string) =>
  `${category}|${subCategory ?? ""}`;

export class CategoryClassifier {
  private model: ClassifierModel;

  constructor(model?: ClassifierModel) {
    this.model = model ?? emptyModel();
  }

  static load(): CategoryClassifier {
    if (typeof window === "undefined") return new CategoryClassifier();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return new CategoryClassifier();
      const parsed = JSON.parse(raw) as ClassifierModel;
      if (parsed.version !== 1) return new CategoryClassifier();
      return new CategoryClassifier(parsed);
    } catch {
      return new CategoryClassifier();
    }
  }

  save(): void {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.model));
    } catch {
      // quota exceeded etc. — ignore
    }
  }

  /**
   * Train from a single entry. Idempotent? No — call once per new entry.
   */
  observe(text: string, category: string, subCategory?: string): void {
    if (!category || !text) return;
    const tokens = tokenize(text);
    if (tokens.length === 0) return;
    const key = keyOf(category, subCategory);
    this.model.categoryMeta[key] = { category, subCategory };
    this.model.categoryDocs[key] = (this.model.categoryDocs[key] ?? 0) + 1;
    this.model.totalDocs += 1;
    tokens.forEach((tok) => {
      const slot = this.model.wordCounts[tok] ?? (this.model.wordCounts[tok] = {});
      slot[key] = (slot[key] ?? 0) + 1;
    });
  }

  /**
   * Train from existing ledger history.
   */
  trainFromLedger(ledger: LedgerEntry[], kind: LedgerKind = "expense"): void {
    ledger.forEach((e) => {
      if (e.kind !== kind) return;
      if (!e.category || !e.description) return;
      this.observe(e.description, e.category, e.subCategory);
    });
  }

  /**
   * Predict top-K (category, subCategory) candidates for a description.
   * Naive Bayes with Laplace smoothing.
   */
  predict(text: string, topK = 3): { category: string; subCategory?: string; score: number }[] {
    const tokens = tokenize(text);
    if (tokens.length === 0 || this.model.totalDocs === 0) return [];

    const vocabSize = Object.keys(this.model.wordCounts).length || 1;
    const categoryKeys = Object.keys(this.model.categoryDocs);
    const scores: { key: string; score: number }[] = categoryKeys.map((key) => {
      const prior = Math.log(this.model.categoryDocs[key] / this.model.totalDocs);
      const totalWordsInCat = Object.values(this.model.wordCounts)
        .reduce((s, slot) => s + (slot[key] ?? 0), 0);
      let score = prior;
      tokens.forEach((tok) => {
        const count = this.model.wordCounts[tok]?.[key] ?? 0;
        score += Math.log((count + 1) / (totalWordsInCat + vocabSize));
      });
      return { key, score };
    });

    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ key, score }) => ({
        category: this.model.categoryMeta[key]?.category ?? key,
        subCategory: this.model.categoryMeta[key]?.subCategory,
        score
      }));
  }

  recordEvaluation(correct: boolean): void {
    this.model.evaluations.total += 1;
    if (correct) this.model.evaluations.correct += 1;
  }

  getStats() {
    const acc = this.model.evaluations.total === 0
      ? null
      : this.model.evaluations.correct / this.model.evaluations.total;
    return {
      totalDocs: this.model.totalDocs,
      categories: Object.keys(this.model.categoryDocs).length,
      vocabulary: Object.keys(this.model.wordCounts).length,
      accuracy: acc,
      evaluations: this.model.evaluations.total
    };
  }

  reset(): void {
    this.model = emptyModel();
    if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);
  }
}
