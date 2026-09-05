# G4 frontend cleanup — implementation evidence

Date: 2026-09-05. Worktree: `H:/TakiAgent-worktrees/t4`, branch
`task/t4-skills-mcp-productization`, base HEAD `3c67fd5`.
Status: implementation, independent automated review and isolated WebView2 interaction QA passed.
Owner visual acceptance remains pending. The task is not completed or archived, and no commit/push
was performed. WebView2 evidence was finalized on 2026-09-06 (Asia/Shanghai).

## Delivered scope

19 files changed: 9 production files, 5 existing test files and 5 folder indexes.

| Surface | Result |
|---|---|
| MCP | Removed revision/generation/Owner rows and copy controls; retained selected tools in a nonempty disclosure. Removed enumeration page count from both published outcome and test-success feedback. Retained tool/skipped counts and actual duration. |
| MCP availability | Replaced candidate/generation jargon with Chinese connection wording. Continued-service wording requires `phase === connected` and a non-null runtime generation; a draining record or first failed connection is not shown as serving. |
| Skills | Removed the technical disclosure and arbitrary custom-metadata dump. Retained name/description/source/trust/state, declared license/compatibility/tools when present, relative file inventory, inspection collapse and lifecycle actions. |
| Extension status | Removed shortened/full Core Host ID and its copy affordance. Kept Chinese actual availability/extension/conflict counts and explicit waiting/refresh/failure/previous-snapshot state. |
| Permission settings | Removed policy-generation and registry-revision display. Kept choices, canonical keys, generation checks, second confirmation and useful safety limits. |
| Import feedback | Replaced raw character identity with a generic successful-import message and the actual costume count; the current result has no readable character name. |

No controller behavior changed. The MCP controller edit is limited to feedback text and its module
header. No Shared/Core/Rust production changes, dependencies, configuration, data migration or new
diagnostic surface were added. Opaque identifiers remain in internal keys, snapshots and requests.

## Verification

Implement A (`gpt-6-astra`, high) passed 8 scoped files / 43 tests, scoped ESLint and Desktop typecheck.
Implement B (same model/effort) passed 13 scoped files / 87 tests, scoped ESLint and Desktop typecheck.

Independent check (`gpt-6-astra`, xhigh) reviewed all 19 files and read back the Core MCP status
producer. It found no scoped issue requiring a fix; hashes of the 19 files were identical before and
after review.

| Gate | Result |
|---|---|
| `pnpm typecheck` | PASS, all workspace packages |
| `pnpm lint` | PASS, zero errors; one preexisting warning at `packages/core/src/db/run-repo.ts:6` for unused `eslint-disable max-lines` |
| Scoped ESLint, 14 source/test files | PASS, no warnings |
| `pnpm --filter @taki/desktop test` | PASS, 108 files / 594 tests |
| `pnpm --filter @taki/desktop build` | PASS; existing Pet chunk-size advisory remains |
| Frontend task context validation | PASS, 8 implement / 8 check entries |
| Scoped `git diff --check` | PASS |
| Unrelated-work protection | 37 preexisting unrelated files have unchanged SHA-256; deferred registry remains byte-for-byte unchanged from the pre-implementation checkpoint |

The source was reviewed for removed-field leakage into expanded/copy/accessibility output and for
preserved action/confirmation identity. Automated markup and controller evidence do not certify real
window layout, keyboard/focus continuity or operator visual acceptance.

### Actual-engine interaction evidence

[Isolated WebView2 QA](research/g4-webview2-qa-2026-09-05.md) passed 12/12 interaction groups against
the immutable checked G4 build, with 14 captured states and 16 screenshots. It exercised selected-tool
and Skill inspection disclosures, keyboard focus, retained action targets, previous-snapshot states,
and 640/900/1280-pixel layouts. Visible text, DOM/ARIA/title attributes, accessibility trees and
selectable text contained none of the injected internal-field sentinels. The 23-file build snapshot
and five served entry assets matched their hashes; the production CSP remained effective.

This used a frontend-only Tauri host with local synthetic WebSocket responses. It did not exercise
normal Shell startup, real Core/Host execution, Keyring or production data, and is not owner manual
acceptance. Three expected warnings came from omitted timing-policy fixture fields. Only the QA host
and fixture processes were stopped, and their listeners were released. This snapshot predates A1/A2
and therefore does not certify the subsequent readable-operations changes.

## Remaining acceptance and subsequent ownership

- Owner review of actual window appearance, native focus/resize and retained actions remains open;
  automated WebView2 interaction evidence must not mark those manual acceptance criteria passed.
- Raw capability/cell labels, durable approval wording and command disclosure belong to
  `09-05-uiux-readable-operations`.
- Monitor field cleanup and presentation rebuild belong to D68/G5; the old scaffold is not accepted.
- Chat/Pet real-time tool feedback belongs to `09-05-uiux-live-tool-feedback`.
- D77 error-code/message governance remains deferred. This slice does not close unrelated original
  frontend performance/manual criteria or reopen archived compaction work.
