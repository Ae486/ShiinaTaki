**1. Outcome — done**

Emergency preview and both admission plans now verify surviving replica closure and predecessor-policy correspondence before source withdrawal. Unusable evidence returns `expected:null`, `takeover:"refused"` and `incomplete-replica`. Pending remains allowed. [source packages/core/src/memory/transitions/transition-current-identity.ts:77]

The harness correction is complete. The journey and incident restoration were not run.

**2. Changes**

Full assignment-only hunks and before/after hashes: [run G:/taki-codex-work/p1-j-checks/assignment.diff] [run G:/taki-codex-work/p1-j-checks/changed-files.json]

| File / hunk | Purpose |
|---|---|
| [source packages/core/src/memory/transitions/transition-current-identity.ts:86] | Read complete current closure and call the existing surviving-policy validator. |
| [source packages/core/src/db/memory-transition-surviving-policy.ts:23] | Accept the required closure fields without fabricated capture identities; validation predicates unchanged. |
| [source packages/core/src/memory/transitions/transition-emergency-service.ts:108] | Map invalid proof to existing `incomplete-replica` blocker. |
| [source packages/core/src/testing/memory-transition-emergency-service-fixtures.ts:26] | Publish a valid paired event containing a new unbound Memory. |
| [source packages/core/src/memory/transitions/transition-emergency-service.test.ts:155] | Verify refusal, paired disclosure and preserved source binding. |
| [source packages/core/src/memory/transitions/transition-emergency-admission.test.ts:46] | Verify refusal before submission and during the second admission plan, with no admission, execution or retirement. |
| [source apps/desktop/src/windows/home/pages/operations/memory-transition-confirmation.tsx:14] | Render existing blocker codes through Chinese labels, including “本地副本或记忆策略证据不完整，无法接管。” |
| [source apps/desktop/src/windows/home/pages/operations/memory-transitions-card.test.tsx:25] | Check blocker wording and disabled confirmation. |
| [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs:331] | Wait for eligible detached ingestion, explicitly sync manual-only Banks, then call strict `waitPendingDrained`; applied before capture and Native shutdown. Reuse the existing bounded sync-recovery loop. |
| [source .trellis/spec/backend/memory-transition-emergency.md:43] | Add one sentence documenting pre-admission verification. |

Updated the four corresponding folder indexes: [source packages/core/src/memory/transitions/index.md:30] [source packages/core/src/db/index.md:146] [source packages/core/src/testing/index.md:39] [source apps/desktop/src/windows/home/pages/operations/index.md:43]

Global’s manual-only configuration came from the Home settings scenario. The schedule step already restored that original configuration; it now records and verifies the restored values. `home-check.py` required no change. [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/home-check.py:241] [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs:407]

**3. Evidence and checks run**

Failure modes covered: unusable paired evidence at preview; evidence changing before either admission plan; premature empty-Pending observation; failed/unknown children; outstanding parent confirmation; stuck ingestion.

The red run reproduced the reported defect: preview returned eligible with no blocker. It also exposed an existing closed-epoch assertion mismatch. That assertion now expects the exact integrity error already defined by the authority repository. [run G:/taki-codex-work/p1-j-checks/red.log] [source packages/core/src/db/canonical-memory-authority-repo.ts:46]

Environment: Node `24.18.0`, pnpm `10.22.0`; `TEMP` and `TMP` both `G:/taki-codex-work/tmp-j`.

```text
pnpm --filter @taki/core exec vitest run src/memory/transitions/transition-emergency-service.test.ts src/memory/transitions/transition-emergency-admission.test.ts src/db/memory-transition-surviving-policy.test.ts --pool=threads --maxWorkers=2
```

Passed **3 files / 24 tests**, including existing Pending, hung-producer and strict correspondence assertions. [run G:/taki-codex-work/p1-j-checks/core-vitest.log]

- Core and Desktop `typecheck`: passed.
- ESLint on all eight changed TS/TSX files: passed.
- Desktop card tests with `--pool=threads --maxWorkers=2 --configLoader native`: **5 passed**. Default config bundling failed before collection; native loading succeeded without configuration edits.
- Harness `node --check`: passed.
- Separate isolated harness checks: **7 passed**, using mocks without services.
- Scoped `git diff --check`: passed.

[run G:/taki-codex-work/p1-j-checks/checks.json] [run G:/taki-codex-work/p1-j-checks/desktop-vitest-native.log] [run G:/taki-codex-work/p1-j-checks/eslint-final.log] [run G:/taki-codex-work/p1-j-checks/harness-check.log]

Repository ESLint excludes `.trellis/**`. An additional forced harness lint reports **23 errors versus 24 before modification**; it is not a passing harness lint result. [run G:/taki-codex-work/p1-j-checks/harness-eslint-before.json] [run G:/taki-codex-work/p1-j-checks/harness-eslint-after.json]

No Core/Native/PG services were started. Test processes exited. No original data, credentials, leader-owned records, templates or Git lifecycle operations were changed.

**4. Trade-offs**

- Preview/admission perform additional synchronous local proof work; real-corpus latency remains unmeasured.
- Reusing `incomplete-replica` groups unusable policy evidence with incomplete replica evidence, avoiding a protocol extension.
- The successful harness journey now waits longer and explicitly synchronizes manual-only Banks.
- Deriving policy from Pending intents remains an unimplemented product/spec option. It could admit additional evidence, but requires new correspondence rules and risks assigning policy without established proof. Strict candidate/publication checks remain unchanged.

**5. Open items / UNKNOWN**

**Already-sealed incident:** there is no Home abandon path for a claimed emergency. Home exposes cancellation only before claim and original recovery when permitted. Recovery reuses the immutable incident; this patch does not repair it. [source packages/core/src/memory/operations/memory-operation-transition-storage.ts:44] [source packages/core/src/memory/transitions/transition-emergency-service.ts:178] [source apps/desktop/src/windows/home/pages/operations/memory-transition-progress.tsx:30]

The existing abort mechanism requires per-Bank release evidence and source-runtime reconstruction. Emergency quarantine resolution requires a committed receipt. This is not a one-line wiring opportunity. [source packages/core/src/db/memory-transition-abort.ts:22] [source packages/core/src/db/memory-transition-recovery-repo.ts:95]

The separate operator route is the D91 verified paired-restore runbook, including pre-writer validation. Suitability and successful restoration of this incident’s specific saved pair are **UNKNOWN**; neither was attempted. [source .trellis/spec/backend/memory-hindsight-backup.md:253]

Full journey, real Native negative scenario and manual Home acceptance remain unperformed. No `-o` pathname was supplied; this final message is the requested report.

**6. Outside-scope observations**

The default Desktop Vite config bundler fails on native Tailwind dependency loading and `spawn EPERM` in this environment. The supported native config loader completed the tests; no environment or build configuration fix was made. [run G:/taki-codex-work/p1-j-checks/desktop-vitest.log]