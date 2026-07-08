import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import unicorn from "eslint-plugin-unicorn";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/target/**",
      "**/node_modules/**",
      "**/*.config.{js,ts}",
      "apps/desktop/src-tauri/**",
      // Non-source / third-party / git-ignored trees.
      "references/**",
      "models/**",
      ".trellis/**",
      "scripts/**",
      "docs/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { unicorn },
    rules: {
      // Anti-sprawl size caps (CLAUDE.md): treat as hard.
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 50, skipBlankLines: true, skipComments: true }],
      "max-params": ["error", 3],
      // Kebab-case filenames, always.
      "unicorn/filename-case": ["error", { case: "kebabCase" }],
      // No `any`; use unknown + narrowing.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // Tests may exceed size caps.
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
    },
  },
);
