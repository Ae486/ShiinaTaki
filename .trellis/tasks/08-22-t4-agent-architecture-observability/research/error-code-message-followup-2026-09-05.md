# D77 — error-code fidelity and readable user errors

Status: owner-deferred on 2026-09-05; registered as **D77** in
[the deferred-decision registry](../../../../docs/deferred-decisions.md). No implementation task is
created or activated by this record. The current G3c Pet requirement is a single error bubble whose
content is the error message; the broader error-contract cleanup is separate work.

## Problem and current evidence

Owner report: visibly different problems often arrive as the same vague error, so an ordinary user
cannot tell what went wrong or what action could help. This concerns error classification, preservation
of the cause across boundaries, and readable presentation, not just replacing an English sentence.

The examples below were read from the current T4 source at HEAD `3c67fd5`. Semantic search returned an
older indexed revision; the findings use the current files. This is a bounded source review, not a
complete inventory or a new runtime reproduction of every failure class.

| Boundary | Verified behavior | Implication |
|---|---|---|
| Core stream failure | `packages/core/src/server/methods/chat-send.ts` sends `PROVIDER_ERROR` for the stream catch path. `runFailureEvidence()` distinguishes `APICallError` with an HTTP status, but all other caught failures become `Agent turn failed` / `agent_error`. | Non-provider causes can lose their category before reaching the UI. An HTTP status alone is often insufficient guidance. |
| Cancel before reply | The same file sends `PROVIDER_ERROR` with `retracted: true` for a cancelled/retracted turn. | Preserve the cancellation/retraction meaning rather than treating the broad code alone as a provider failure. Chat already handles the retraction flag specially. |
| Mid-turn disconnect | `apps/desktop/src/lib/ws-client-routes.ts:183` settles via `INTERNAL_ERROR`, with the specific Chinese connection-loss message. | The existing message is useful, but its code class does not distinguish transport loss from an internal defect. This is a classification follow-up, not a reopening of D29's completed settlement fix. |
| Pet/Chat consumption | `apps/desktop/src/features/chat-bubble/use-chat-bubble.ts:25` and `apps/desktop/src/windows/home/pages/chat/use-chat-timeline.ts:38` ignore `_code` and use the reason string. | Typed cause information is not used to guide these two presentation paths. Replacing producer codes alone would not improve their copy. |
| Existing shared vocabulary | `packages/shared/src/error-code-schema.ts` already defines closed application codes and multiple refusal families with separate `reason` fields. | Reuse and audit these contracts; do not assume the repository lacks structured errors or force every layer into one undifferentiated enum. |

## Deferred scope

1. Inventory producer -> adapter -> transport -> consumer paths for chat/model, tool/Host/MCP,
   operator requests, and relevant settings/connection surfaces. Record where a typed cause is kept,
   remapped, reduced to a string, or replaced by a generic fallback.
2. Define stable distinctions using the existing code/reason structure where appropriate. Candidate
   cases include connection loss, deadline, invalid input, authentication/configuration failure,
   upstream rate/service failure, context pressure, unavailable capability, governance denial,
   approval wait, user cancellation, and an actual unexpected internal failure. These are inventory
   targets, not claims that every listed class currently has the same defect.
3. Keep JSON-RPC numeric envelope errors, application error codes, domain refusal reasons, and
   model-visible tool outcomes distinct. Document their mappings and compatibility with Rust/CLI/UI
   consumers; extend a closed schema only after the inventory identifies a real missing distinction.
4. Make ordinary user messages specific, safe, and understandable in Simplified Chinese: identify the
   failed action and known cause, and give a useful next step only when supported by the facts. Do not
   present a raw code, stack trace, or a universal "try again" as the explanation.
5. Preserve the same underlying meaning across Pet, Chat, Monitor, and related operator pages while
   allowing each surface an appropriate amount of detail. G3c's Pet bubble remains message-only;
   diagnostic metadata must not force new buttons or technical fields into that bubble.

## Constraints and completion evidence

- Preserve [the error-handling contract](../../../spec/backend/error-handling.md): sanitized summaries,
  stable structured causes, fail-closed approval, distinct cancellation/retraction, and no raw provider
  exception messages, prompts, request/tool payloads, credentials, or stack dumps in user transport.
- Keep D59's read-timeout versus mutation/chat-ack unknown-outcome distinction. Improved messages must
  not imply that retry is safe or that a side effect did not occur when its outcome is unknown; do not
  add automatic replay as part of this work.
- Unknown causes retain an honest bounded fallback. Do not invent a reason from UI string matching or
  create a new error code for every incidental exception sentence.
- Demonstrate that representative distinct causes stay distinguishable end to end and that the same
  known cause keeps consistent meaning across relevant surfaces. Cover missing/unknown fields and
  mixed-version/compatibility behavior where the schema changes.
- Verify readable messages for those cases, retention of safe diagnostic context, cancellation and
  approval semantics, and redaction with hostile provider error content. Exercise the real producer
  and consumer boundaries rather than asserting only a static copy table.

Schedule this as a dedicated error-contract/presentation batch before declaring cross-surface error UX
complete. The current UI/UX work may use the available authoritative safe message in its error bubble;
it must not guess a more specific cause while D77 is pending. D77 does not defer G2's truthful tool
outcomes or G3c's error bubble. Main-worktree Memory/Hindsight contracts
remain under their existing ownership and require coordination if later inventory includes them.
