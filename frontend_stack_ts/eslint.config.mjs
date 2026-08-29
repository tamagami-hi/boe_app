import js from "@eslint/js"
import tsPlugin from "@typescript-eslint/eslint-plugin"
import tsParser from "@typescript-eslint/parser"

const forbidImports = (groups, message) => ({
  "no-restricted-imports": ["error", { patterns: [{ group: groups, message }] }],
})

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "android/**",
      "coverage/**",
      "scripts/**",
      "resources/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.node.json"],
        tsconfigRootDir: import.meta.dirname,
        sourceType: "module",
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      ...tsPlugin.configs["strict-type-checked"].rules,
      ...tsPlugin.configs["stylistic-type-checked"].rules,
      "no-undef": "off",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='fetch']",
          message: "Only src/api/http.ts may call fetch. Route requests through the transport.",
        },
      ],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["error", { allow: ["error", "warn"] }],
    },
  },
  {
    files: ["src/ui/**/*.{ts,tsx}"],
    rules: forbidImports(
      ["~/features/*", "~/features/**", "~/shells/*", "~/shells/**", "~/app/*", "~/app/**"],
      "ui/ must not import from features/, shells/ or app/. Primitives stay presentational.",
    ),
  },
  {
    files: ["src/features/**/*.{ts,tsx}"],
    rules: forbidImports(
      ["~/shells/*", "~/shells/**"],
      "features/ must not import from shells/. A feature must not know which shell renders it.",
    ),
  },
  {
    files: ["src/domain/**/*.{ts,tsx}"],
    rules: forbidImports(
      ["~/features/**", "~/shells/**", "~/app/**", "~/ui/**"],
      "domain/ must stay free of presentation layers.",
    ),
  },
  {
    files: ["*.config.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.node.json",
        tsconfigRootDir: import.meta.dirname,
        sourceType: "module",
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: { "no-undef": "off" },
  },
  {
    files: ["src/api/http.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-restricted-syntax": "off",
    },
  },
]
