# Size-rule alignment — 2026-09-28

## Scope and decision

- Workspace: `H:/TakiAgent-worktrees/t4`; branch: `task/t4-skills-mcp-productization`.
- Active assignment: C3, `09-11-initiative-pattern-authoring`. The known stale global task pointer was preserved.
- Owner direction: size rules prevent mixed responsibilities; modest excess is acceptable for cohesive production
  modules. Tests must not be constrained or split by line counts.
- This change owns only the five configuration/guideline files below and this report. Existing Shared-entry and
  Hindsight guideline changes were preserved. No QQMM script, dependency, runtime source, task pointer or Git history
  was modified by this assignment.

## Changes

| File | Change |
| --- | --- |
| `eslint.config.js` | Test exemption now matches `**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}` and `**/{test,tests,__tests__,testing,e2e}/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}`. Only `max-lines` and `max-lines-per-function` are disabled in those matches. |
| `CLAUDE.md` | Size paragraph now explains responsibility review, modest cohesive exceptions with a justified numeric override, no mechanical test splitting, and preservation of unrelated rules. |
| `.trellis/spec/backend/quality-guidelines.md` | Documents the exact test patterns, production default guards, exact-file numeric exceptions, renewed review for material growth, and unchanged parameter/type/naming rules. |
| `.trellis/spec/frontend/quality-guidelines.md` | Aligns production/test guidance and explicitly includes native `.mjs` smoke scripts and E2E fixtures. |
| `.trellis/spec/backend/e2e-harness.md` | Replaces mandatory one-scenario-per-file wording with grouping by behavior, shared setup and isolation; teardown duties remain. |

Production defaults remain error-level `max-lines: 360` and `max-lines-per-function: 50`, excluding blanks/comments.
The 300-line design baseline remains. No new production exception was added. The existing exact Shared public-entry
allowance remains error-level 500 lines with both AST restrictions requiring source-bearing named re-exports.

## Verification

`pnpm lint` from the workspace root completed with exit code 0 and no diagnostics after the configuration change.
The subsequent change only clarified documentation about exact-file overrides.

Each command below completed with exit code 0:

```powershell
pnpm exec eslint --print-config apps/desktop/test/qqmm-home-native-smoke.mjs
pnpm exec eslint --print-config packages/core/src/initiative/wake/wake-matcher.test.ts
pnpm exec eslint --print-config e2e/src/fixture/ws-relay.ts
pnpm exec eslint --print-config packages/core/src/testing/ws-test-client.ts
pnpm exec eslint --print-config packages/core/src/main.ts
pnpm exec eslint --print-config packages/shared/src/index.ts
git diff --check -- eslint.config.js CLAUDE.md .trellis/spec/backend/quality-guidelines.md .trellis/spec/frontend/quality-guidelines.md .trellis/spec/backend/e2e-harness.md
```

| Resolved target | File lines | Function lines | Other checks |
| --- | --- | --- | --- |
| QQMM native `.mjs` test | off | off | max 3 params, no-explicit-any and filename-case remain error-level |
| Colocated wake test | off | off | same non-size checks remain |
| E2E relay fixture | off | off | same non-size checks remain |
| Core testing helper | off | off | same non-size checks remain |
| Core production `main.ts` | error, 360 | error, 50 | same non-size checks remain |
| Shared public `index.ts` | error, 500 | error, 50 | both named-re-export AST restrictions remain error-level |

An in-memory `node --input-type=module` verification using the installed ESLint API checked all 16 test/spec extension
combinations plus five test-tree paths (21 total). It asserted both line rules were off and every other rule exactly
matched the same path with only the size exemption removed. It also asserted the ordinary production 360/50 guards and
Shared 500-line/AST guards. Result: exit code 0; `testPathsChecked: 21`, `allNonSizeRulesUnchanged: true`.
No probe files or new test files were created.

Verification correction: the first ad hoc comparison used a TS production file as the reference for JS test paths and
failed because the existing JS and TS recommended presets intentionally differ. Comparing each path against its own
language-specific configuration corrected the verifier without changing repository rules.

Environment note: `python3` resolves to the unavailable Windows Store alias; the mandatory spec-discovery command
succeeded with `python ./.trellis/scripts/get_context.py --mode packages` (backend/frontend layers).

## Remaining limits

- This configuration/documentation change does not establish C3 real-provider or native owner acceptance; those are
  handled separately by the parent assignment.
- Test-tree names are semantic ownership boundaries: production code must not move there to evade size review.
- No package typecheck, runtime test suite or native smoke was repeated for this rules-only change. Root lint and
  resolved-config checks directly cover its behavior. No commit, push, finish or archive was performed.
