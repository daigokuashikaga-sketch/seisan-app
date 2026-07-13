import js from "@eslint/js"
import globals from "globals"
import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-electron/**",
      "**/.turbo/**",
      "**/.expo/**",
      "**/drizzle/**",
      "**/public/**",
      "uploads/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,jsx,ts,tsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // このコードベースは意図的に any を使う箇所があるため許容
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // module augmentation の空インターフェース拡張は意図的
      "@typescript-eslint/no-empty-object-type": "off",
      // OCR等の正規表現で冗長エスケープを許容（無害）
      "no-useless-escape": "off",
      "no-irregular-whitespace": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  {
    // React フック規約
    files: ["**/*.{jsx,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
)

