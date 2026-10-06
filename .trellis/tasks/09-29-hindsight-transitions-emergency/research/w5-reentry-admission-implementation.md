# W5 independent admission verification and explicit renewal

## Delivered result

The copied real corpus completes both full admission plans, epoch stamping and actual
default Local readiness in **61.272 seconds**, within the unchanged 120-second preview
lifetime. The earlier same-corpus elapsed-time probe refused at the second plan after
236.902 seconds. Acceptance deliberately rolls back before dispatch; no real reentry,
Native maintenance, model call or manual acceptance is claimed.

One fresh independent verification context is created inside the synchronous transition
admission transaction and supplied through a local derived handler context. Both complete
plans, the operation epoch stamp and actual Local/Hindsight binding snapshots share it.
The long-lived operation context remains unchanged. The new context closes on return or
throw before notification or deferred execution; preview, later execution and restart
start fresh. Nontransition handlers retain their existing context and behavior.

Only verified immutable native artifacts and complete-key pure Bank projections are
reused. Every evidence hit checks actual stored identity and complete bytes. Projection
hits check evidence ownership first, cover all semantic inputs and keep one frozen
variant per Bank until close; mutable body bytes remain detached. The observer store,
SQL results, complete identities, readiness answers and plan verdicts are never reused.
All mutable authority/receipt/candidate/source/config/inventory/queue/custody/checkpoint/
binding joins remain active. Both plan calls remain, with an added actual-clock and
stored-preview check after expensive validation. No TTL, lease, timer, polling interval,
request timeout or maintenance budget was enlarged.

## Changed scope

Exactly the parent's 14 production paths changed, under `packages/core/src/`:

| Directory | Files |
| --- | --- |
| `memory/transitions/` | `transition-evidence-context.ts`, `transition-observation-store.ts`, `transition-current-identity.ts`, `transition-healthy-service.ts`, `transition-healthy-execution.ts` |
| `memory/operations/` | `memory-operation-contract.ts`, `memory-operation-service.ts`, `memory-operation-kind-transition.ts`, `memory-operation-transition-storage.ts` |
| `memory/legacy-migration/` | `legacy-activation-repo.ts` |
| `memory/` | `runtime-composition.ts`, `local-runtime-binding.ts`, `hindsight-runtime-binding.ts` |
| `boot/` | `memory-transition-boot.ts` |

Added colocated `transition-admission-verification.test.ts` and
`transition-independent-projection.test.ts`; updated the five touched source indexes and
the backend `memory-transition-healthy-drivers.md` / `memory-transition-publication.md`
specs. The existing lint config and cohesion allowances remain unchanged.

Task helper scope: new `w5-reentry-renewal.mjs` and test, narrow integration in
`w5-reused-driver.mjs` and `w5-reused-native.py`, and `w5-reentry-renewal-usage.md`.
The supervisor's `--reentry-renewal` applies only to `run --stage reentry`; it retains
the exact approval bytes in attempt history before forwarding the path to Node.

The helper requires exact old request/preview/checkpoint and mutation/anchor hashes,
proves absence in operations/intents/recoveries, and reads actual completed RETURN,
policy receipt/snapshot/current record and desired Block revision/body. While this
option is active the driver performs read-only mutation verification, never reapplication.
A normal fresh preview supplies new IDs/timestamps; old admission absence is rechecked
after its await. The new request is appended with approval/checkpoint and old/new hashes
before ordinary submit. Original entries/history remain unchanged. Repeated approval
reuses one linked replacement, including lost admission ACK; expired replacement,
altered approval, old admitted/unknown request or orphan evidence refuses.

No real approval or replacement was created. Existing checkpoint/admission helpers,
independent checker fixes, old reports/manifests, Native code, schemas, dependencies,
templates and Git/task lifecycle remain unchanged.

## Verification

Heavy groups ran sequentially, with Vitest `--maxWorkers=2`. Earlier iteration counts
overlap final groups and are not additive.

| Gate | Actual result | Research log |
| --- | --- | --- |
| New tests against original source | 6 failed, showing missing context/projection reuse and post-work expiry | `w5-reentry-admission-red.log` |
| Initial repair | 4 files / 20 pass | `w5-reentry-admission-green-initial.log` |
| Final admission/isolation/observer/publication/binding/operation group | 10 files / 71 pass, 36.34 s | `w5-reentry-admission-regression.log` |
| Projection consumers: candidate/delta/mapping/history/publication/order/healthy journey/service | 9 files / 66 pass, 45.71 s | `w5-reentry-admission-projection-regression.log` |
| New renewal + existing journey + preserved expiry feedback | 24/24 pass, 31.57 s | `w5-reentry-admission-helper-final.log` |
| Actual Native gate control over synthetic storage/transport | 5/5 pass, 17.16 s | `w5-reentry-admission-gate.log` |
| Prior independent gate accounting/lifetime/pause cases | 6/6 pass, 5.68 s | `w5-reentry-admission-independent-gate.log` |
| Final `pnpm -r typecheck` | exit 0, all 5 workspaces | `w5-reentry-admission-types-final.log` |
| Final `pnpm lint` | exit 0, no new exception | `w5-reentry-admission-lint-final.log` |
| CLI help and two rejected mode/stage cases | expected exits 0/2/2; no startup reached | `w5-reentry-admission-cli.log` |
| Actual strip-only Core boots | Legacy and genuine B2 Local each boot/stop/reopen twice; WS and SQLite integrity pass, zero model requests | `w5-reentry-admission-boot.log` |
| Actual copied corpus admission | 61.272 s, both plans/default readiness pass, intentional rollback; zero model/external calls | `w5-reentry-admission-corpus.log` |
| Preimages/inputs/predecessors/encoding/whitespace/headers/indexes/helper syntax | Separate final audit | `w5-reentry-admission-audit.json` |

Core cases include expensive verification without observer borrowing; expiry after
either plan's expensive work and between plans; current config/Block/runtime changes;
atomic rollback; duplicate admission; no context in deferred execution; unchanged
nontransition behavior; foreign/closed/observer/thenable refusal; semantic-key changes,
frozen outputs, evidence corruption, byte isolation and fresh next-boundary verification.

Renewal tests use real synthetic Core RETURN/preview/admission, policy/Block producers
and filesystem checkpoint history. They cover wrong request/preview/checkpoint hashes,
changed RETURN/Block/receipt, orphan/admitted/unknown old requests, admission during
preview await, append ACK loss/restart, altered approval bytes, exact replacement
admission/cancellation reconciliation and expired replacement refusal.

Two helper development failures were corrected before final validation: task-directory
package resolution now uses the existing driver's explicit Shared source path, and
approval hashing uses exact original checkpoint serialization because Zod parsing can
reorder keys. The initial state-change test also needed an actual synthetic Block seeded
before preview. No failing check was waived. Final gates above follow those corrections.

Process result: `.trellis/.runtime/w5-boot/7d4cc569-d8a4-4439-8fd4-8c768c9e1b5a/result.json`.
Fresh synthetic directories and a localhost model trap were used. No actual parent pair
or model credentials were loaded, and all owned processes stopped.

## Real copied-corpus proof and preservation

Result: `.trellis/.runtime/w5-admission-acceptance-b2c21fe0-fb59-4f96-abe7-a66a3cd3c2a4/result.json`.
Command: `node .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-reentry-admission-replay.mjs`.
The new derivative retains the exact saved request/preview, projects real monotonic elapsed
time onto its original creation timestamp, and uses actual `composeMemoryTransitions`
readiness. The unchanged 14 production source hashes are recorded at launch/end and
checked again against delivery. Runtime startup and separate observer boot priming precede
admission timing; admission itself still performs independent full validation.

| Boundary | Measured time |
| --- | --- |
| Runtime construction/start before admission | 39.666 s |
| First full plan | 46.263 s |
| First Local readiness snapshot, included above | 3.475 s |
| Second full plan begins | 49.860 s after submit start |
| Second full plan | 11.409 s |
| Second Local readiness snapshot, included above | 3.481 s |
| Final actual-clock check | 61.268 s after submit start |
| Real persistence reached; intentional rollback returned | 61.272 s |

Both snapshots report running/published Local epoch `afb2053e-8bcd-4322-8573-0a447d560bb8`.
Before/after counts remain `{intents: 1, attempts: 1, operations: 8}`. The sentinel follows
the real `admitTransition` persistence callback but precedes commit/dispatch. These counts
are old RETURN history, not successful new real reentry admission.

All seven diagnostic inputs retain exact hashes. SQLite remains 291049472 bytes with
SHA256 `1ac12212606d3280d85bf6364f355112a1aef4f69b7addb7b2510afba68fb632`.
The actual parent pair was not accessed; its last parent-reported hash remains
`9e257fd0b553ef7ccc0e148af822620879d7fee7a6bf64aa99842fc07475d1d3`, count 301,
completed RETURN/applied Local changes and no new reentry. No fresh Native step/action
count is inferred from the offline copy.

## Handoff

Exact preimages: `w5-reentry-admission-preimages.json`, 25 files under
`w5-reentry-admission-preimages-9ad533111cdc4c55a50263ae244fb30d`.
The new `w5-reentry-admission-source-manifest.json` and audit inventory current ownership,
prior unchanged evidence and the exact corpus-tested source. Older manifests are immutable.

Next: independent checking, then parent-authored exact one-time approval and zero-model
staged real reentry. The old pending request remains expired and must still refuse normal
submit. Native maintenance, budget approval, activation, binding and exact real final
state/mapping preservation retain separate gates. No manual acceptance, overall W5 pass,
W6-W8 readiness, commit, publication or task completion is claimed.
