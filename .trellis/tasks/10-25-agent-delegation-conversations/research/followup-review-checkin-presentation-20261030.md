# Check-in presentation review addendum — 2026-10-30

This completes the coordinator's narrowly scoped follow-up to the [combined review](followup-review-20261030.md).
The newly identified display defect was confirmed and repaired. Core/Shared remained frozen and unchanged; the
review-owned Desktop source/tests/specification are frozen again after the checks below.

## Finding (fixed): raw system snapshot rendered as worker prose

`packages/core/src/db/subagent-checkin-repo.ts` accepts a `needs_input` event with the program-owned
`producerKey=checkin:<interval>` and a factual JSON body. The private conversation projection retains that metadata.
`apps/desktop/src/features/subagents/subagent-conversation-transcript.ts` previously rendered every non-interrupted event
as `sender=<child label>, text=event.body`. Therefore a real check-in's canonical snapshot fields and internal references
appeared as JSON attributed to the worker, contrary to readable reports and truthful sender attribution.

The source-derived fixture exactly follows the current producer's field names and payload structure, including recent
worker text, older summary, tool evidence references, recorded count, pending inputs and required actor. Its first
assertion failed against the inherited implementation (`Researcher` instead of System). The test then exercises the
actual transcript projection and shared `TimelineMessage`/lazy `MarkdownView` using React streaming server rendering.
This is source-derived presentation evidence, not a claim that the test booted Core or mounted a native WebView.

### Repair and preserved boundaries

- A dedicated `subagent-checkin-presentation.ts` maps only trusted `needs_input` events whose producer key matches
  `checkin:<nonnegative interval>` to System factual snapshots. `interact_parent` producer keys are minted as
  `interaction:<step>:<call>` in the existing Core event owner; a worker cannot acquire System attribution by writing
  lookalike JSON. Both event kind and producer identity are checked independently of the body.
- A bounded decoder parses at most 64,000 body characters, checks known report kind, safe nonnegative integer counts,
  exact actor values and bounded optional evidence text. The ordinary row displays recorded steps/pending inputs,
  captured actor, clearly quoted latest worker text/older summary and an explicit unknown remaining-work statement.
  It does not dump report field names, internal Run/Attempt/call references or summary sequence bookkeeping.
- Snapshot text is historical evidence, not a claim that the child remains paused now or has completed its work.
  The current controls retain their own authority; there is no new synthesis, progress percentage or execution state.
- Incomplete previews are not parsed as complete snapshots. They retain a labelled original preview plus the existing
  `readMore` callback/error/pending state. Missing, unsupported, malformed, invalid-count/actor and oversized bodies
  retain an explicit cannot-interpret explanation and their original available body, rendered as code rather than
  discarded. Full body arrival formats the same row key without changing the canonical record.
- Canonical JSON, source references, exact body paging/digest proof, model projections, shared protocol, Runtime
  counters/checkpoints, private/public ownership and publication behavior are unchanged.

## Changed paths

- `apps/desktop/src/features/subagents/subagent-checkin-presentation.ts` (new)
- `apps/desktop/src/features/subagents/subagent-checkin-presentation.test.ts` (new)
- `apps/desktop/src/features/subagents/subagent-conversation-transcript.ts`
- `apps/desktop/src/features/subagents/index.md`
- `.trellis/spec/frontend/home-window.md`

Only the existing transcript event branch calls the new projection. This addendum and the link in the combined review
are report writes; no acceptance/native scripts were edited. Prior dirty bytes are retained separately from the first
review under [`target/followup-review-20261030/checkin-presentation`](../../../../target/followup-review-20261030/checkin-presentation/).

## Verification

| Check | Result |
| --- | --- |
| Before repair, `subagent-checkin-presentation.test.ts -t 'formats the actual snapshot'` | Expected FAIL: worker sender instead of System; `before.log` |
| Final focused Desktop tests below | PASS: 3 files / 21 tests; `focused-final.log` |
| `pnpm --filter @taki/desktop typecheck` | PASS; `typecheck.log` |
| ESLint on the three changed/new TS files | PASS; `lint.log` |
| Tracked diff and all five owned tracked/untracked paths | PASS: UTF-8 without BOM/trailing whitespace; `diff-check.log`, `source-validation.log` |
| Core check-in/event/conversation producers and Shared conversation schema SHA-256 | All four before/after hashes match; `frozen-source-parity.json` |

```powershell
pnpm --filter @taki/desktop exec vitest run src/features/subagents/subagent-checkin-presentation.test.ts src/features/subagents/subagent-conversation-transcript.test.ts src/features/subagents/subagent-conversation-pages.test.ts --reporter=verbose
pnpm --filter @taki/desktop typecheck
pnpm exec eslint apps/desktop/src/features/subagents/subagent-checkin-presentation.ts apps/desktop/src/features/subagents/subagent-checkin-presentation.test.ts apps/desktop/src/features/subagents/subagent-conversation-transcript.ts
```

Tests cover actual shared Chat/Markdown output, Core-only attribution, worker lookalikes, source immutability, missing and
invalid values, oversized/unsupported payloads, unknown remaining work, both captured actors, exact preview/read-more
preservation, and stable identity after full-body recovery. Existing transcript batching/live handoff and paging tests
remain green. Native geometry, user interactions and owner acceptance remain the coordinator's separate gate.

## Native wording handoff

- Sender: `系统`; detail: `进度检查 · 系统事实快照` plus the existing main-inbox disposition.
- Recorded facts: `记录时已完成 50 个模型步骤；2 条输入尚未纳入模型请求。` (numbers come only from the snapshot).
- User-only actor: `此检查点需要你明确决定，主助手无法代为放行。`
- Unknown remainder: `剩余工作尚未由此快照确认。`
- Preview: `系统进度检查快照尚未完整读取。请读取完整正文后核对。` and the existing `读取完整正文` action.

No independently verified unresolved issue remains within this additive presentation repair.
