# Tidy repair: independent pre-implementation review

Date: 2026-11-01. Reviewed checkout: `H:/TakiAgent-worktrees/t4`, branch
`task/t4-skills-mcp-productization`, HEAD `9326955`.

## Decision

Proceed with a bounded canonical Local tidy repair and a compatible error-detail
projection. Do not reinterpret a failed pass as success merely because it made
useful edits. Do not add a retry framework, persistence migration, automatic
revision substitution, or broader Legacy/Hindsight behavior changes.

The original requirement is lower cost without reduced quality or overdesign.
The owner approved fixing Operations > Memory tidy > Run now before resuming
real usage diagnosis. A truthful partial outcome and recovery from the same
corrected action satisfy that requirement; suppressing failures does not.

## Evidence and scope

- `canonical-local-tidy.ts:204-222` sets `review.failed` permanently on every
  thrown tool error. `reviewHealthy()` then always returns false. The provided
  isolated reproduction records disclosure success, stale-reference reinforce
  refusal, successful reinforce with the returned reference, then finish; it
  still returns failed with two edits, four steps and the old watermark.
- `canonical-local-tidy.ts:127-132` admits only the original captured references
  and references returned by this review's successful row operations. Existing
  tests reject hidden, external and uncaptured revisions. Preserve this fence.
- `tidy-pass.ts:134-151` already preserves completed-step counts on later failure.
  `memory-tidy.ts:24-25` discards those details by throwing a generic error.
- The installed AI SDK aggregates `result.toolResults` across all steps
  (`packages/core/node_modules/ai/dist/index.js:3382-3383`). The hypothesis that
  successful finish-last runs necessarily report zero edits is rejected.
- Existing Legacy tests intentionally accept a failed missing-ID operation
  followed by unrelated success and finish, and accept a capped run without
  finish as `ran` with an advanced watermark (`tidy-pass.test.ts:128-166`).
  These are compatibility contracts, not evidence that canonical unresolved
  conflicts should be accepted.

The reproduction proves the current failure mechanism, not the precise first
failure of the real November 1 run. That historical tool failure was not retained.

## Smallest sound correction rule

Retain permanent failure for unknown/internal, authority, request-ID-conflict,
malformed-reference and scope failures. Add a per-review unresolved map for the
demonstrated recoverable class, `MEMORY_REVISION_MISMATCH`. A fresh successful
execution may remove only its exact matching unresolved action.

For row tools, derive an in-memory action hash from:

```text
tool verb + epochId + bankId + memoryId + complete semantic arguments
```

Parse the opaque reference; omit only `expectedRevision`. Include disclosure
text, destination layer, or the entire optional replacement object as applicable.
Use the existing stable hash rather than persisting these arguments. Different
payloads, verbs, Banks, memories and copied/replacement identities do not match.
For block operations, identity is the block scope/ID plus complete replacement
content; never clear a block conflict because another block succeeded.

Keep `target()` and repository CAS unchanged. A model cannot refresh an external
edit merely by guessing its latest revision. The demonstrated self-stale case
can recover because its correct reference was returned by an earlier successful
operation in the same pass.

Receipt replay is not a fresh correction. The existing early cached-return path
must remain ahead of unresolved-error clearing: replaying a success that happened
before a later failure does not prove that failure was repaired. Do not make
block or copied-memory aliases to enlarge the matching rule. Supporting other
recoverable classes later needs a concrete case; the current repair needs only
revision-conflict recovery.

## Completion, counts and diagnostics

For canonical Local, success should require a successful explicit finish,
settled model execution, no unresolved action/fatal issue, and currently active
authority. A step cap or text-only ending is incomplete; a successful finish is
not proof that every mechanically flagged defect required editing. Preserve the
report's judgment-based nature.

Keep existing Legacy termination semantics and Hindsight curator behavior.
Express the canonical completion requirement through its captured-review seam,
not a new global condition that silently changes Legacy tests. This
canonical-only explicit-finish rule is a deliberate strengthening of completion
semantics and should be recorded in the canonical runtime spec.

An incomplete pass with committed edits is partial; without committed edits it
is failed. Both retain the last successful watermark and make no completed tidy
event. A later completed canonical pass advances to its start time, preserving
the existing treatment of writes that arrived during model work.

Retain actual completed-step counts on model failure. Do not derive counts from
attempted calls or the final step alone. Cached tool receipts also must not be
represented as new committed effects if edit accounting is changed. The existing
boolean-success counter cannot by itself distinguish a replay from a new write.

Log closed failure code and closed tool name, plus counts and pass identity if
needed. Never log raw arguments, memory text, model errors or credentials. A local
tidy catch/progress record can retain model-failure classification while the
Utility Slot keeps its existing never-reject contract; changing generic Utility
Slot exception semantics is unnecessary. Do not label a stopped/unstarted slot
as a model failure without evidence.

## Compatible API and UI recommendation

Preserve `MemoryTidyResultSchema` and its `clean | ran` successful response.
Add a strict, separately named error-data schema, for example:

```text
{ kind: 'memory-tidy', status: 'partial' | 'failed',
  defects, edits, steps, usage,
  reason: closed enum,
  issues: [{ toolName: closed enum, code: closed enum }] }
```

Reason classes should distinguish observed tool failure, model failure,
step-limit/incomplete execution, unavailable execution and an honest generic
pass-failed fallback. Hindsight's existing failed result may use the generic
fallback when it supplies no finer evidence. Do not invent a precise code.

Throw `JSONRPCErrorException` with the existing internal-error envelope code,
a safe summary and this data. The method registry already preserves exception
data (`method-registry.ts:107-109`). Existing clients remain truthful errors;
new clients parse only this schema and preserve ordinary transport/legacy error
handling. Extending the success status enum would break older clients' parser.

The desktop hook can retain a separate typed failure alongside the existing
success result; `WsClient.memoryTidy()` need not change its successful return
type. Clear the previous result when starting a new attempt so a prior success
cannot be mistaken for the current failed attempt. Refresh affected projections
after a typed partial outcome because edits already committed. Show the counts
and an incomplete message; do not retry automatically.

The generic CLI currently prints only the error message/code and exits nonzero.
If extended, decode this exact schema to display safe counts, retaining nonzero
exit status. Never dump arbitrary `error.data` to solve this specific display gap.

## Required focused acceptance

1. Reproduce the current four-step self-stale failure, then prove the same action
   with its valid returned reference completes with two actual edits.
2. Prove that unrelated target/verb/payload successes and replayed old receipts
   cannot clear unresolved failure; an unknown/internal failure stays failed.
3. Preserve rejection of guessed external revisions, wrong authority/Character,
   hidden records, user-owned blocks and transaction rollback on replacement
   failure.
4. Cover canonical step cap, text-only ending, failed finish/authority change and
   later model failure; counts stay real and the success watermark stays old.
5. Verify RPC error data and desktop parsing/rendering, including old generic
   errors and existing success payloads; keep Legacy and Hindsight compatibility
   tests passing under their existing semantics.
6. After deterministic checks, the parent owns the authorized real manual tidy
   observation and old/new usage comparison. Model call success, SDK integration
   tests and owner UI acceptance are distinct evidence.

## Review limits

This advisor changed only this research document. It inspected source, tests,
the installed SDK and existing isolated reproduction output; it did not run
tests, create model requests, mutate a database, change task/session pointers,
commit or push. The inherited task is in progress; this subagent has no independent
Trellis session binding, and no binding was invented.
