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
      // Isolated validation fixtures and nested upstream worktrees have their own checks.
      ".runtime/**",
      ".worktrees/**",
      ".backup-*/**",
      // Vendored proprietary Live2D runtimes (minified third-party; git-ignored, fetched by a script).
      "apps/desktop/public/vendor/**",
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
      // Responsibility guard: keep production errors at 360/50 lines by default.
      // Cohesive exceptions need a narrow, justified numeric override (CLAUDE.md).
      "max-lines": ["error", { max: 360, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 50, skipBlankLines: true, skipComments: true }],
      "max-params": ["error", 3],
      // Kebab-case filenames, always.
      "unicorn/filename-case": ["error", { case: "kebabCase" }],
      // No `any`; use unknown + narrowing.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // Keep related scenarios and test-only fixtures together without line caps.
    // This includes native .mjs smoke scripts; all non-size rules still apply.
    files: [
      "**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "**/{test,tests,__tests__,testing,e2e}/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
    ],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
    },
  },
  {
    // The initiative composition keeps its explicit source/Run/feedback lifecycle wiring together.
    // A small reviewed allowance avoids hiding registrations behind artificial construction helpers.
    files: ["packages/core/src/initiative/pattern-composition.ts"],
    rules: {
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // The sole Shared public entry names cross-package contracts without owning
    // implementation. D77 and request attribution add independent protocol contracts;
    // a 520-line registry allowance avoids artificial export-only entrypoints and
    // still depends on this strict AST boundary. Implementation modules keep their limits.
    files: ["packages/shared/src/index.ts"],
    rules: {
      "max-lines": ["error", { max: 520, skipBlankLines: true, skipComments: true }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "Program > :not(ExportNamedDeclaration)",
          message: "The Shared public entry permits only named re-exports with a source module.",
        },
        {
          selector: "Program > ExportNamedDeclaration:not([source])",
          message: "The Shared public entry cannot declare or export local implementation; re-export from its source module.",
        },
      ],
    },
  },
);
