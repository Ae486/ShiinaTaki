# Follow-up Intentions and initiative acceptance — design

## Normative design and reading order

Read the curated context entries, this child PRD, this design and its implementation plan, then the [parent design](../09-11-companion-initiative-implementation/design.md). The parent owns shared contracts; this child narrows execution ownership and does not define an alternative architecture.

Parent implementation section 6 supplies the matching ordered scope. Children 1-3 must pass and the integrated Memory runtime/authority baseline must be verified.

## Owned modules and boundaries

The following implementation now uses the existing Runtime and provider-neutral Memory authorities. Execution evidence is recorded separately under `research/`.

| Owner area | Responsibility |
| --- | --- |
| Shared and Core domain | `initiative-intention-schema.ts`, `initiative/intentions/`, governed `plan_follow_up`, and the common Wake candidate/claim lifecycle; additive migration 054. |
| Memory integration | Existing provider-neutral context/read and captured authority/tool paths; do not import legacy MemoryRepo or a second writer. |
| Feedback | `initiative/backoff/` reads qualified C2 outcomes and canonical admission counts. Separate strict backoff RPC/notification and the existing Monitor own display/reset; migration 055 records admission timezone and reset fences. |
| Integration tests | `e2e/src/initiative-recovery.e2e.test.ts`, opt-in `initiative-intention-real.e2e.test.ts`, and owning-service Core/Desktop regressions. |
| Documentation | Parent/child implementation evidence, affected specs/indexes and explicit pending owner checks. |

## Required contracts

1. Automatic Intention formation needs no individual review card, but it must use an actual trusted source and finite plan window.
2. The default active follow-up-window bound is not a universal scheduling horizon. Do not silently turn an automatic follow-up into a Scheduled Task without user reminder/task intent.
3. Due ineligible plans retain their original deadline; accepted work claims one Run. A consumed/silent opportunity or terminal failure is not recreated by reading the same old source.
4. Expiry/consumption does not delete or resolve the underlying reported matter. Ordinary Memory correction/deletion/retention and one active authority remain effective.
5. A new independent eligible opportunity can explicitly recall related Global/current-Character Memory and initiate a new question before a user message.
6. Backoff uses only child-2 qualified evidence, preserves 1x/2x/4x/daily-ceiling stages and fully resets on actual same-Character engagement or operator reset.
7. No fixture, protocol ACK, real process check or subjective assumption is labelled owner acceptance. Complete first delivery includes the full authoring loop, not only seed behaviors.

## Concurrency and integration

One implementation owner serializes shared exports, `main.ts`, migrations and registry edits. Other agents may own non-overlapping bounded work after explicit assignment. Preserve existing changes; do not reset, rebase, overwrite another task or run the main worktree.

All new persistent/protocol fields are strict and bounded. Core remains the single writer. State plus required evidence commits atomically; publication follows commit. Context, generation and source identity remain internal binding facts rather than visible metadata.

## Implemented lifetime seams

- Main binds the actual appended primary user row to the governed plan tool. The service retains its original source digest and finite window; source replay, rewording and configuration changes cannot renew it. The maximum new window defaults to seven days through `TAKI_INITIATIVE_INTENTION_MAX_WINDOW_MS`.
- Standalone due Intentions join the existing bounded Wake selection without creating a stored Pattern, another queue or another model loop. Claims link to the canonical Run before model work; known pre-admission refusal releases an uncharged claim, while terminal/uncertain effects never reopen it.
- The Memory runtime checks the original ingestion/source witness. Confirmed withdrawal retires use; temporarily unavailable evidence preserves only the original deadline. Selected Persona/Blocks/index and actual explicit recall receipts remain fenced across awaits and held publication.
- The initiative `recall` tool accepts only a selected `global` or `character` scope. Its query is captured from the offered purpose; one attempted read per selected Bank, at most four records and the final 512-token estimator budget apply. Ordinary primary recall and normal Memory policy remain independently owned.
- Live `dispatch_committed` retains a claim until the existing transport reports `sent` or `unknown`; restart reconciliation closes unresolved dispatch as unknown. Completed expression continuations consume their plan without inventing a speech publication.
- Backoff uses only actual qualified C2 outcomes, moving at 3/6/9 weak outcomes in seven days through normal/2x/4x/daily stages. Same-Character persisted user activity or explicit reset clears that history fence, preserving hard quotas and canonical daily admissions. Existing strict policy readers receive compatible reason projections; the separate backoff RPC retains detail.
- The bundled authoring Skill uses standard immutable content/collision rules. An installed older same-name package is not silently upgraded or re-enabled.

## Validation design

- Automatic plans are source-bound, finite and idempotent; exact expiry is enforced before admission and before output.
- Offline beyond the window, source replay, source correction/deletion and duplicate callbacks never renew a stale plan or text.
- The missed-interview scenario allows a fresh independently eligible memory-backed question while old trigger/output remains closed and outcome unknown.
- Local/canonical/Hindsight permitted projection behavior stays provider-neutral and never promotes authority during outage.
- Feedback unknown/presented/no-reply distinctions, global caps and backoff stages survive restart without fabricated intervals.
- The complete parent AC01-AC19 matrix has factual engineering evidence and separately pending/passed owner outcomes.
- Mixed event versions, crash cuts, primary concurrency, Source/Host/privacy/target changes and native multi-window behavior remain correct.

Use real owning services and meaningful failure/negative cases. Mocked UI or pure builder tests alone do not establish lifecycle, transport, source or native presentation contracts. The implementation reports distinguish executed regressions, scripted/real-provider processes, native fixtures and pending owner judgment.

## Sources

- [Research: domain-contracts.md](../09-11-companion-initiative-implementation/research/domain-contracts.md).
- [Research: presence-contracts.md](../09-11-companion-initiative-implementation/research/presence-contracts.md).
- [Research: runtime-contracts.md](../09-11-companion-initiative-implementation/research/runtime-contracts.md).
- [Research: decision-register.md](../09-11-companion-initiative-implementation/research/decision-register.md).
- [Effective parent decisions](../09-11-companion-initiative-implementation/research/decision-register.md).
