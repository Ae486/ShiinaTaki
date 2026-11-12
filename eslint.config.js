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
      // Captured source preimages and one-off evidence scripts are not the live application tree.
      "artifacts/**",
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
    // Exact generated SQL/schema snapshots intentionally retain readable object
    // declarations. Runtime owners remain subject to the normal responsibility cap.
    files: ["packages/core/src/db/migrations/073-convergence-schema.generated.ts"],
    rules: {
      "max-lines": ["error", { max: 4200, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // Reviewed single-owner closures keep their lifecycle state and public operations together.
    // These exact modules own one binding, selected runtime, or transition runtime respectively.
    files: [
      "packages/core/src/memory/hindsight-runtime-binding.ts",
      "packages/core/src/memory/runtime-selector.ts",
      "packages/core/src/memory/runtime-composition.ts",
      "apps/desktop/src/windows/home/pages/operations/memory-transitions-controller.ts",
      "packages/core/src/initiative/pattern-composition.ts",
    ],
    rules: {
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // Matching-authority withdrawal belongs to the existing publication lifetime owner.
    files: ["packages/core/src/memory/hindsight-runtime-binding.ts"],
    rules: {
      "max-lines-per-function": ["error", { max: 65, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // One compaction owner captures policy, lease and cancellation for the retiring span.
    files: ["packages/core/src/agents/compaction-coordinator.ts"],
    rules: {
      "max-lines-per-function": ["error", { max: 55, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // W7 adds a read-only overview to the same healthy service lifetime; no new producer owner.
    files: ["packages/core/src/memory/transitions/transition-healthy-service.ts"],
    rules: {
      "max-lines-per-function": ["error", { max: 65, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // The same runtime owns healthy drains and explicit nonwaiting emergency retirement; no second lifetime owner.
    files: ["packages/core/src/memory/transitions/transition-runtime.ts"],
    rules: {
      "max-lines-per-function": ["error", { max: 70, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // One native session owns its active Bank map and exact command/observation/renewal lifetime.
    files: ["packages/core/src/memory/transitions/transition-native-session.ts"],
    rules: {
      "max-lines-per-function": ["error", { max: 65, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // The sole Shared public entry names cross-package contracts without owning
    // implementation. B3 adds separate strict versioned backup/observation/attestation
    // exports; this exact entry allowance still depends on the same strict AST boundary.
    files: ["packages/shared/src/index.ts"],
    rules: {
      "max-lines": ["error", { max: 1100, skipBlankLines: true, skipComments: true }],
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
