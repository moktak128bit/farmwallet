import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/", "dev-dist/", "scripts/", "data/", "*.mjs"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // 프로젝트 컨벤션에 맞게 완화
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-case-declarations": "off",
      "no-useless-escape": "warn",
      "prefer-const": "warn",
    },
  },
  // yahooFinanceApi: useCorsProxy는 React hook이 아닌 일반 함수 (이름 컨벤션 예외)
  {
    files: ["src/yahooFinanceApi.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
  // 조건부 early return 후 hooks 패턴 (리팩토링 예정)
  {
    files: ["src/features/stocks/PortfolioChartsSection.tsx", "src/components/StockDetailModal.tsx"],
    rules: { "react-hooks/rules-of-hooks": "warn" },
  },
  prettier,
);
