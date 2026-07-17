import tseslintPlugin from "@typescript-eslint/eslint-plugin"
import tseslintParser from "@typescript-eslint/parser"

export default [
  {
    ignores: ["coverage/**", "dist/**", "node_modules/**"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslintParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslintPlugin,
    },
    rules: {
      ...tseslintPlugin.configs["recommended-type-checked"].rules,
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
]
