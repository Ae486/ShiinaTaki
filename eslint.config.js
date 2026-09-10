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
      // Anti-sprawl responsibility guard (CLAUDE.md): 300-line baseline, with ~20% tolerance before review pressure.
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
    // Tests may exceed size caps.
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
    },
  },
  {
    // The sole Shared public entry names cross-package contracts without owning
    // implementation. Its reviewed size allowance depends on that AST boundary.
    files: ["packages/shared/src/index.ts"],
    rules: {
      "max-lines": ["error", { max: 420, skipBlankLines: true, skipComments: true }],
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
