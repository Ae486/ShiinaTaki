# C2 accepted Perception evidence: implementation record

- Date: 2026-09-28, Asia/Shanghai.
- Workspace: `H:/TakiAgent-worktrees/t4`; branch `task/t4-skills-mcp-productization`; base HEAD `06a8090`.
- Scope: accepted native evidence, consent/source lifetime, ambient publication and their tests. This is a slice
  record, not the complete C2 acceptance report.
- Source authority: current C2 PRD/design, parent effective decisions and current code. The external
  `H:/TakiAgent-worktrees/T4-heartbeat-child1-findings-2026-09-25.md` was read only as a nonauthoritative checklist.
  No source code from its other worktree was inspected or copied; its implementation choices and test counts are
  not evidence for this checkout.

## Implemented responsibilities inspected

| Current files under `packages/core/src/` | Responsibility |
| --- | --- |
| `capabilities/route-capability.ts` and its test | Frozen actual Host/connection/catalog provenance plus a live socket/catalog/descriptor/governance predicate |
| `perception/perception-evidence.ts` and its test | Independent process-local epoch, nullable accepted idle, bounded reads, full retirement versus refusal sealing, generation-qualified Host retirement |
| `activity/activity-sampler.ts`, `activity-layer.ts`, `activity-state.ts` | Evidence after governed parsing/sensitive filtering/scrub; post-await guards; explicit seal/clear; unchanged legacy idle projection |
| `perception/perception-layer.ts`, `privacy-pause.ts` | Durable consent before retirement; shared cache/dwell/screen invalidation; fresh evidence after resume |
| `perception/foreground-screen.ts`, `ambient-screenshot-sampler.ts` | Fresh screening provenance, screenshot pinned to that Host, checks after each route, tuple matching and refresh reset |
| `perception/ambient-observation.ts`, `screen-context.ts` | Guarded frame/VLM publication, scrubbed bounded text, retired/sensitive in-flight frame deletion even with `keep` |
| `perception/privacy-pause-writer.test.ts` | Declaration-based single-writer audit, distinguishing unrelated delivery `resume()` methods |
| `main.ts`, `initiative/presence-composition.ts` | Forward optional target Host; consume `evidence.latest(now())`; retire the matching authenticated Host generation |
| `activity/index.md`, `perception/index.md` | Current ownership and lifetime descriptions |

This documentation follow-up changed no production code, task status or task binding. The global `.current-task`
still points at the obsolete Avatar Lab path; the parent explicitly supplied the existing C2 task path for this
bounded assignment. No replacement task was created.

## Contract decisions confirmed against code

1. Accepted evidence carries `idleSeconds: number | null`; the legacy activity boolean remains a presentation
   projection. Missing provenance preserves compatibility but cannot mint native evidence.
2. Route provenance is captured before the broker await and still detects retirement after return. Identity is
   never reconstructed from a later registry lookup or an operator-device guess.
3. A changed pause/resume publishes an epoch only after its durable save. A pause that starts and ends during one
   await still invalidates that work. Auto-expiry does not introduce another consent writer.
4. Full retirement clears cached dwell/history/screen and ambient refresh suppression. A refused bound sample seals
   the current stretch while preserving older accepted history; new samples start fresh dwell.
5. Ambient foreground-screen, screenshot and VLM boundaries all check the original observation lifetime. Screenshot
   routing receives the screened `hostId`, and both provenance tuples must agree before use.
6. A retired in-flight frame is discarded on settlement even under `keep`; previously transmitted pixels cannot be
   recalled. D48's separate foreground-to-capture round trips remain non-atomic.
7. Native evidence can support qualified aggregate presence, but conveys no operator co-location, hardware-only
   input or reading guarantee. Same-device feedback remains the separate Core/client evidence contract.

The reusable executable contract is [Accepted Perception Evidence](../../../spec/backend/perception-evidence.md).

## Verification performed during this documentation follow-up

Command run from this workspace:

```text
pnpm --filter @taki/core test -- src/perception/perception-evidence.test.ts src/perception/privacy-pause-writer.test.ts src/capabilities/route-capability.test.ts
```

Result: **3 files, 25 tests passed**, exit 0; Vitest 4.1.10; start 10:06:25; duration 3.76 seconds.

| Suite | Assertions actually exercised |
| --- | --- |
| `perception-evidence.test.ts` | Null idle and defensive copies; unbound/stale/future evidence; four foreground refusal shapes; pause/resume/expiry races; failed durable writes; cache/reset behavior; Host/catalog replacement and delayed old-Host removal; old foreground completion; all three ambient await stages; pinned Host; retired raw-frame cleanup |
| `route-capability.test.ts` | Exact explicit Host, ambiguous/no Host, original dispatch binding through replacement and live currentness after successful settlement |
| `privacy-pause-writer.test.ts` | Only the operator pause method mutates the declared PrivacyPause interface; source audit is non-vacuous |

The prior implementation agent reported **31 files / 241 tests**, Core typecheck and scoped lint passing before this
documentation resumption. That is previous reported evidence, not a run repeated or independently certified here;
the exact old command/output was not retained in this slice record. The focused 25-test result above is the fresh,
directly observed evidence. No full-package test, native trial, external provider or user-data test was run here.

Documentation checks: scoped `git diff --check` returned exit 0; direct file checks confirmed both new files are
UTF-8 without BOM, have no trailing whitespace, and end with a newline. The executable spec contains all seven
required sections. Direct checks cover the new untracked files, which an ordinary `git diff` does not include.

## Coverage limits and integration follow-up

- This slice supplies automated evidence for C2-01. It does not mark C2-01 or any manual acceptance checkbox complete.
- C2-02 through C2-07 need their independent source/report, exposure/feedback, timezone, Monitor and native-window
  verification. A green Sampling suite cannot certify those paths.
- Preserve D48 as an open limitation. There is no atomic screen/capture guarantee, physical-HID guarantee,
  operator/Node association, reading ACK or extra sensor in this change.
- Root owns the backend index entry and the small existing `agent-runtime.md` wording correction: successful
  consent/source retirement now clears screen cache immediately; stale-age expiry remains a fallback.
- Formal C2 review and any broader integration gate must use the then-current combined working tree. No commit,
  push, archive or cross-worktree mutation was performed by this follow-up.
