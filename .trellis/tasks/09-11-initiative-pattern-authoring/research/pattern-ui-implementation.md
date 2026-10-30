# C3 Pattern UI implementation evidence

Date: 2026-09-28. Scope: Desktop implementation in `H:/TakiAgent-worktrees/t4`, branch
`task/t4-skills-mcp-productization`. The root native session already owns the active C3 binding.
The stale global Avatar Lab task pointer and all unrelated C1/C2/QQMM work were preserved.
No commit, push, archive, dependency installation, real data or external model was used.

## Delivered paths and behavior

- `apps/desktop/src/features/initiative-patterns/`: Shared-derived controller/read state, exact immutable
  candidate review, preserved manual drafts/CAS base, supported atom/context/outcome/timing/lifetime
  editors, source labels, lifecycle/history, explicit setup, safe tool-result projection and same-Monitor
  pre-admission diagnostics. The folder index records each file's responsibility.
- `apps/desktop/src/windows/home/pages/initiative/`: registered list/detail/authoring/setup page.
- `windows/home/pages.ts` and its navigation test: the new `initiative` route, preserving the existing QQMM row.
- `pages/chat/chat-page.tsx` and `timeline-view.tsx`: Pattern cards inside the existing conversation scroll
  owner; no replacement of Chat's socket, Timeline or permission approval path.
- `pages/chat/timeline-message.tsx` and `tool-result-display.ts`: the actual primary authoring tool gets
  allow-listed Chinese business output. Its canonical payload remains complete for Core replay/model use.
- `pages/monitor/monitor-page.tsx`: bounded producer-backed skip/admission reasons and counts in the same
  Monitor, behind existing availability. No synthetic Run or second polling monitor.
- `apps/desktop/test/c3-pattern-*`: repeatable isolated native evidence harness.
- `apps/desktop/src/lib/ws-client-initiative.test.ts`: real WsClient request/response schema, invalidation,
  listener isolation, unsubscribe and physical/explicit close regressions.
- Frontend `interaction-patterns.md` specification and relevant folder/spec indexes updated.

Concrete review freezes the displayed candidate and expected version. External changes disable the old
confirmation until the operator explicitly reads the new proposal. Confirmation of a paused Pattern keeps
it paused. History rollback creates a new candidate and always requires review. Retirement is explicitly
confirmed and preserves history. Read errors retain the last good view; replacement clients preserve
selection/drafts and never replay a mutation. The UI retains an unknown-outcome notice after a lost ACK.

All Pattern/revision/command/paging/completion bindings remain internal. Candidate/history/editor/tool
output and Monitor use semantic names, units and statuses. Completion selectors use returned labels and
local option positions, never Run IDs. C4's unavailable Intention producer is not offered for new authoring.
Actual global limits are displayed; missing facts remain unknown. Setup imports via the root facade,
preserves same-name/user-disabled Skills and proposes example data without enabling initiative or rules.

## Validation performed

| Command / evidence | Result |
| --- | --- |
| `pnpm --filter @taki/desktop typecheck` | Passed after Shared/facade integration and typed fixture corrections. |
| Scoped `pnpm exec eslint` over the feature, page, touched integration and C3 fixture files | Passed. |
| Initial Pattern/controller/review/navigation/Home tests | 4 files, 25 tests passed. |
| `pnpm --filter @taki/desktop test -- --maxWorkers=2` | 191 files, 1130 tests passed; bounded worker count avoided contention. |
| Final `pnpm --filter @taki/desktop test -- src/features/initiative-patterns --maxWorkers=1` | 5 files, 21 tests passed, including the subsequently added policy controller/unknown-value tests. |
| `pnpm --filter @taki/desktop test -- src/lib/ws-client-initiative.test.ts src/windows/home/pages/monitor/pattern-tool-monitor.test.tsx --maxWorkers=1` | 2 files, 28 tests passed; actual transport facade plus real Core outcome/event/Inspector projection. |
| Final retained-detail failure regression | `pattern-review.test.tsx`: 5 tests passed; a failed selected-detail refresh keeps content but disables stale actions. |
| `pnpm --filter @taki/desktop build` | Passed. Existing large-bundle advisory remains; no build error. |
| `git diff --check` | Passed; Git reports existing CRLF normalization advisories on unrelated dirty files. |
| `node apps/desktop/test/c3-pattern-native-smoke.mjs` | 8 native scenario groups passed against production PatternService and isolated SQLite. |

Final native evidence:

[`validation/ui-native-2026-09-28T093219Z/`](validation/ui-native-2026-09-28T093219Z/)

The successful `evidence.json` and three screenshots were copied from
`apps/desktop/src-tauri/target/c3-pattern-native-evidence/2026-09-28T09-32-19-095Z/`.
Each copy was verified against its original SHA-256; the original artifacts were retained.

- `evidence.json`: commands, scenario results and exact isolation scope.
- `candidate-review.png`: complete concrete review, meaningful fields and global-policy disclosure.
- `reconnected-draft-history.png`: retained editing state after connection replacement.
- `manual-new-review.png`: manual authoring's review-only result, with the close control outside the scroll track.

The eight native scenario groups establish:

1. Candidate push into actual Chat preserves an already-scrolled historical reader and its message node.
2. Exact review contains units/limits and no Pattern/revision identity in markup; close does not activate.
3. Concurrent proposal changes require explicit reread before the real SQLite revision can be confirmed.
4. Held and failed refresh preserve editor node, focus, selection and unsaved content.
5. Manual revision survives a CAS conflict and pause/resume use the real domain authority.
6. History rollback creates a reviewed new revision; a lost confirmation ACK reconnects without replay.
7. A second reconnect preserves the draft node/value/selection; retirement requires its second action.
8. New manual authoring saves supported data and stays unconfirmed when review closes.

Earlier native attempts found fixture-only issues: selectors initially matched retained hidden Chat inputs,
actions were clicked before they became enabled, and a CDP assignment returned a DOM object. These were
fixed in the harness. Visual inspection also required the fixture to mirror Home's height/overflow rules
and moved the review heading out of its scrolling body to avoid close-control overlap. The final run uses
the corrected fixture and verifies a nonzero historical scroll offset before asserting stability.

## Boundaries and remaining root/owner checks

- Native transport/setup/Timeline production is scripted. Pattern commands and history use the actual
  Core PatternService/SQLite, but this is not evidence of a primary model/tool clarification loop,
  actual packaged Skill installation/discovery, source eligibility or shared Run delivery. Root's
  Core/process scenarios own those checks.
- The same-Monitor frontend consumes real typed producer diagnostics. Root owns policy producers
  and the operator facade. Read-through verified that the existing tool observer uses the payload-free
  `classifyToolOutcome` contract and Inspector excludes raw tool arguments/results and technical fields.
  `pattern-tool-monitor.test.tsx` exercises actual Core outcome classification/event projection/Inspector
  plus the rendered expanded frontend in both modes: Pattern IDs, revisions, digests and runtime IDs
  are absent while the Chinese tool name and duration remain. No extra Monitor privacy rewrite was needed.
- Real OS IME, human visual/interaction acceptance and full owner ACs remain unchecked. C4 remains excluded.
- No Rust source changed; the native fixture reused the already-built isolated C2 debug shell. No normal
  Taki process, provider or existing profile was launched.
- Package/schema changes after these recorded runs require proportionate final root integration checks.

The implementation does not claim the parent initiative or C3 owner acceptance is complete.
