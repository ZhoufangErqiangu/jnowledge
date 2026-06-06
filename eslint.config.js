import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default defineConfig({
  extends: [
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    prettier,
    {
      files: ["**/*.mjs"],
      languageOptions: {
        sourceType: "module",
        globals: {
          process: "readonly",
          console: "readonly",
          setTimeout: "readonly",
        },
      },
    },
  ],
  files: ["**/*.{ts}"],
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    globals: globals.node,
    parserOptions: {
      parser: tseslint.parser,
    },
  },
  // 0 off 1 warn 2 error
  rules: {
    "@typescript-eslint/ban-ts-comment": 0,
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "@typescript-eslint/consistent-type-imports": [
      "error",
      { prefer: "type-imports", fixStyle: "inline-type-imports" },
    ],
    quotes: [2, "double"],
    semi: [2, "always"],
    "no-console": 0,
  },
  ignores: [
    "**/dist/**",
    "**/node_modules/**",
    "**/*.d.ts",
    "apps/web/dist/**",
  ],
});
