# Agent Runtime — turn persistence & anti-hallucination

Hard-won from D1 (the tool-call hallucination that shipped). These are invariants for the chat loop, not style.

## A turn's tool records MUST be persisted, not just its text

The agent acts only through tools; if a turn's **tool-call and tool-result** messages are dropped from the timeline,
the next turn replays a transcript where the action never happened — and the model, primed by episodic memory that
references the outcome, **fabricates that it already acted**. This surfaces only across multiple turns.

- Persist the full turn tail (`await result.responseMessages` in AI SDK v7 — assistant-with-tool-calls + tool-result
  messages + text), never text-only. The store's `content` string may stay a readable projection, but structured
  `parts` (tool-call `input`, tool-result `output`) must survive the DB round-trip for faithful model replay.
- `history()` reconstructs the full multi-part `ModelMessage[]`. A window cut that strands a leading `tool` row
  (its assistant tool-call fell outside the window) is invalid replay input — drop leading orphan tool rows.
- Any storage model that can't hold tool messages is a latent hallucination bug. If you defer tool fidelity, it goes
  in `docs/deferred-decisions.md` with a trigger — a bare code comment is exactly how D1 became a permanent defect.

## The base system prompt carries a truthfulness floor

The stable base prompt (before per-turn memory context) must state, explicitly, that the model may **never claim a
tool ran / a result was obtained unless a matching tool-result is present in the transcript** — earlier text is not
proof. This is the direct behavioural guard; persistence is the structural one. Ship both.

## Test the deterministic root cause, not the probabilistic symptom

Behavioural hallucination (the model skipping a tool call) is **probabilistic** — you cannot pin it in a green/red
test. The *root cause* is deterministic: a pre-fix store drops the `tool` record every time. So a hallucination
reproduction test (a real-agent L2 seeded with a transcript polluted by verbal "success" but no tool records) must
hinge its red→green on the **persisted tool record**, not on the model's behaviour that run. A single-turn empty-DB
test cannot catch this — see [E2E Harness](./e2e-harness.md). The test must be RED against pre-fix code (prove it by
reverting the fix) or it proves nothing.

## Multimodal turns: two model slots, in-flight bytes, text-authoritative memory (#17)

Image attachments landed in #17 as **additive seams** on the D1-frozen turn — the stream loop, `persistTurn`, abort
wiring, and `toolApproval` stay byte-identical; only the pre-loop guard/save, the `appendUser` call-site, the `model:`
pick, the in-flight `messages` tail swap, and the detached memory fire are new. When you extend the turn, preserve that
discipline: the frozen regions are off-limits.

- **Two parallel user-adjustable model slots**: the required text slot (`TAKI_PROVIDER_*`) and an OPTIONAL vision slot
  (`TAKI_VLM_*`), which may hold identical values. A turn routes to the vision slot **iff the current message carries
  attachments**, else the text slot. Attachments with no vision slot configured are **rejected before any persistence**
  (structured error) — the text model never receives an image. Config load is all-or-nothing fail-closed (partial names
  the missing var), matching the P3-flag parse discipline.
- **Image bytes are in-flight only; TEXT is authoritative across turns.** The image reaches the model only on the turn
  it is sent (AI SDK v7 `FilePart` = `{type:"file", mediaType, data:<RAW base64>}` — NOT the deprecated `ImagePart`, and
  never a `data:` URL, which throws at the provider boundary). The persisted user row keeps the image for DISPLAY (an
  `image` part with a content-addressed ref) but its model projection is text (`[image]`+caption). History replay never
  re-sends bytes → no byte reader in the conversation store, no forcing later text turns onto the vision model, no
  choking a text-only model on an image part. Cross-turn recall comes from a **detached post-turn writer** that has the
  vision slot describe the image and stores that description as an ordinary episodic memory (thin, deletable module on
  the EXISTING memory write path — the memory engine is untouched, its redesign deferred to D28).
- **Binary refs are a closed content-addressed namespace**: `attachments/<sha256hex>.<ext>`, filename derived ONLY from
  the content hash, never from caller input. Read-side confinement is a strict whole-ref regex checked BEFORE any fs call
  (traversal is not even expressible), single-sourced in the store; the `media.*` WS methods are thin delegations and
  operator-only (no Rust mirror — see [Server-Push & Connection Auth](./server-push-and-connection-auth.md)). Retained
  bytes are swept on a configurable TTL; the description memory is never swept.

## A cancel has TWO stream endings — cover both, and mock the transport faithfully (#17 cancel-retract)

`ai@7.0.17` ends an aborted stream in either of two ways; which fires is decided by the SDK's `isAbortError` name
check (provider-utils: an Error/DOMException named AbortError/ResponseAborted/TimeoutError), not by us:

- **Graceful**: the model read resolves (or rejects AbortError-shaped) → the SDK enqueues an `abort` part and closes;
  the for-await ends cleanly.
- **Throw**: the read rejects with anything else. Our abort reason is a PLAIN STRING ("turn cancelled by operator")
  and undici rejects the in-flight body read with `signal.reason` verbatim — a string fails `isAbortError`, the SDK
  errors the stream, the for-await THROWS the reason. This is the COMMON production ending for a prefill cancel (no
  chunk ever arrived); the old "turn cancelled by operator" error toast was this ending's fingerprint.

Consequences (all load-bearing):

- Post-loop logic that must run on cancel (the retract seam) lives on BOTH endings: an additive catch wrapper around
  the frozen try/finally + the clean-path check, sharing ONE predicate (`retractIfCancelledSilent` = aborted AND zero
  completed steps AND no partial text). Do NOT "fix" the string reason into an AbortError to force the graceful path —
  correctness must not depend on SDK-internal name lists surviving the next major.
- **Mock-green ≠ prod-correct.** `simulateReadableStream` reads always RESOLVE, so mock tests structurally see only
  the graceful ending — the throw ending stayed invisible under 513 green tests. Abort-path tests use the
  transport-faithful `abortRejectingModel` (errors the model stream with `signal.reason` on abort, mirroring undici).
  The cancel matrix is 2×2 (graceful/throw × retract/stop) — keep all four pinned.
- Before relying on any SDK runtime behavior, read the INSTALLED dist (`node_modules/.pnpm/ai@*/**/dist/index.js`) —
  not the mock's behavior, not training memory. An observed packaged-runtime symptom (which error text, which
  notification arrived) is evidence about which path actually fires; reconcile a probe against it before believing it.
- Retract semantics (user-approved 2026-07-17): cancel with NOTHING produced → delete the just-appended user row
  (DB + `timeline.removed` push), pump sends `chat.error{retracted:true}`, the UI restores the draft (never
  overwriting newly typed text), autoMemory/imageMemory never fire. Cancel after ANY output → stop, today's behavior
  byte-identical. "Produced nothing" is exactly "persistTurn would persist nothing beyond the user row".
