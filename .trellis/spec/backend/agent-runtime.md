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

## Classify every tool: presentation (fire-and-forget) vs informational (T1 1c)

Every tool call ends a ToolLoopAgent step, and the SDK **forces another generation** after tool results ("until there
are no further tool calls or the stopping condition is met"). For a tool whose result carries nothing to read, that
forced step has nothing substantive to say — the model pads (filler "嗯。") and drifts into answering its own last
message (owner evidence 2026-07-18, one user message → 5 assistant segments).

- **Informational** tools (screenshot, files_read, memory recall) return data the model reasons over — the loop MUST
  continue after them. **Presentation / fire-and-forget** tools (`avatar_set_expression`, `avatar_play_motion`) act on
  what the user sees and return only `{ok:true}` — the model must NOT be forced to generate again just because one ran.
- AI SDK v7 `execute` must return a value (no LiveKit-style `None`/`StopResponse` escape), so a presentation tool's
  non-continuation is enforced by a **construction-level `stopWhen` predicate**, never by the tool result shape:
  `presentationTailStop` (`packages/core/src/avatar/presentation-stop.ts`) stops the loop after a step whose tool calls
  are ALL presentation tools once the turn has produced text. The `spoke` guard preserves express-first-then-talk (a
  tool-only leading step does not stop the turn — the reply still comes).
- **Convention for every NEW tool — classify it at birth.** Presentation tool: name added to `PRESENTATION_TOOL_NAMES`,
  description states fire-and-forget ("no result to read"), execute returns `{ok:true}`/structured error only. An
  informational tool must NEVER enter `PRESENTATION_TOOL_NAMES` — a step co-calling it last would stop the loop with
  its result unread. Mixed-tail steps (presentation + informational together) intentionally do NOT stop (`.every`).
- Prompt rules alone are unreliable across models (QwenPaw #4838: "only use the tool, don't write text" ignored by
  Qwen/GPT/Claude alike) — ship the structural stop as the guarantee; the avatar-vocabulary usage rules are bias only.
- Tests: the taxonomy edge (mixed tail must not stop) is pinned in `presentation-stop.test.ts`; the turn-level fix is
  pinned by `chat-agent-presentation.test.ts` against the transport-faithful `textTool` mock step (text + tool call in
  ONE step, finish `"tool-calls"`) — the plain two-step mock cannot reproduce the bug shape.
- **Presentation-tool `name` args are a per-turn runtime enum, not free text (T1 1e).** A costume switch changes which
  expression/motion names are playable; a stale name (remembered from a prior costume, or hallucinated) must not reach
  the Pet UI. Each turn the avatar tools build `name` as `z.enum([...current vocabulary])` (`avatar/vocab-name-schema.ts`),
  empty/unknown vocab degrading to `z.string().min(1)` (`z.enum([])` is invalid). This is the SOURCE clamp; the
  renderer's `onVocabularyDrift` re-report (1b) is the FALLBACK — a double net. An out-of-enum arg does NOT crash the
  turn: `parseToolCall` marks the call `invalid:true` and the stream loop enqueues a `tool-error` the model reads next
  step (verified in `ai@7.0.17` dist — parseToolCall catch + the `toolCall.invalid` branch), so the model self-corrects.
  This runtime enum does NOT violate #16's "no baked enum" — that rejected a COMPILE-TIME enum (multi-character /
  multi-costume can't fix names at build time); deriving the enum per turn from the live manifest is the SAME Option-A
  data, moved from the prompt into the schema. Only ever build the enum from the reported (pruned, playable) vocabulary.

## Costume-change notice: a one-shot reminder on a baseline-snapshot diff (T1 1f)

The dynamic enum stops a stale tag from taking EFFECT, but the model — primed by the persisted history of its OWN past
tool calls — may still TRY a prior costume's tag on its first post-switch turn (a wasted invalid round-trip, self-corrected
by the tool-error feedback; the provider treats enum as a hint, so the client zod check is what catches it). A one-shot
notice biases it to switch immediately: when the worn costume changed since the model last saw it, prefix a short
`[System · no reply needed] Costume changed...` note onto the MODEL-FACING last user message (an additive seam at outgoing
construction — the persisted `history` is never mutated; one-shot; not stored).

- **Decide on a baseline SNAPSHOT, not an adjacent diff.** Store the worn costume id + `lastSeen` (what the model saw
  last turn); `set()` updates current but does NOT advance lastSeen; a turn-time `consumeCostumeChanged` returns true
  (and advances lastSeen) iff current ≠ lastSeen. This handles churn (A→B→C→A with no turns between → current==lastSeen
  → no notice) that an adjacent-diff (each set vs the previous) would false-fire on.
- **Baseline at first CONSUME, not first SET** — order-independent, so a boot sequence report(undefined)→report(id)
  snapshots the promoted costume as baseline instead of firing a spurious turn-1 notice.
- **`set(costume=undefined)` keeps the last id** (a drift self-heal re-report carries no costume) — never clobber to
  undefined, or a self-heal fakes a change / the next real switch looks unchanged.
- Identify a costume by its UNIQUE id (arbeit / arbeit_ring_01), NOT by comparing tag-set contents (two costumes can
  share a tag set). The id rides `avatar.report` as an additive optional `costume` field (operator-only, no Rust mirror).
- Narrow edge: a cancel-retract of the first post-change message advances lastSeen anyway → one possibly-skipped notice,
  backstopped by the enum. Accepted.

## Untrusted external content enters a prompt ONLY through the fence (T3a, A1 minimal)

Any string sampled from the outside world — a window title, screen text, a VLM description — is an injection surface
(a title can literally read "ignore previous instructions"). The rule: such content reaches a prompt ONLY wrapped by
`agents/untrusted-fence.ts::fenceUntrusted({source, content})` — an XML `<untrusted-observation source=...>` block whose
label declares the payload DATA-never-INSTRUCTIONS (Hermes smart-review XML-delimiting [H-APR:2585]; survey injection-trap
mandate). Never hand-roll a second fence or paste raw sensed text into a section.

- **Escape-proof by construction**: the fence neutralizes any literal `</untrusted-observation>` inside the content
  (case-insensitive, U+200B wedge) so the payload cannot close the fence early; the `source` attribute strips
  quote/angle chars. Both properties are unit-pinned — extend those tests when touching the fence.
- **Producers fence at render time, not at storage time** — store raw (bounded) data; fence where it joins a prompt
  (the activity block fences in `render-activity.ts`; the join stays in `instructionsExtra`, ruling 10).
- **Scrub-then-fence, once at the sense seam** (T3b): sensed text is minimized by `perception/pii-scrub.ts::scrubPii`
  BEFORE it is fenced and before it is stored, so the prompt path and any store inherit the same string. The fence is a
  *labelling* control, the scrub a *content-minimization* one; they compose in that order, never the reverse.
- The screenshot VLM description is fenced on the TOOL-RESULT path (`screenshot-tool.ts::safeDescription`) and on the
  ambient path (`perception/screen-context.ts`) — D44 CLOSED (T3b). Remaining debt: a description written to episodic
  memory is scrubbed but carries no observed-origin marker for the assembler to fence at render (D47).
- **Ambient context joins via `instructionsExtra`, event notices via the outgoing-message seam** — an always-current
  status block (activity) is a per-turn system-prompt section; a one-shot event (costume change) is a message prefix.
  Pick by shape, don't mix.

## Ambient observation: two privacy layers, fail-closed, silent when off (T3b)

Everything that observes the user *without being asked* composes in ONE place: `perception/perception-layer.ts` builds
the privacy controls (Privacy Pause, sensitive-process skip, PII scrub) once and hands them to every sampler, so adding
a sampler never adds a privacy decision. On-demand chat captures are deliberately NOT part of this layer — they are
explicit in-the-moment consent through the Gate, and the pause never gates them.

- **TWO independent layers over ambient capture; neither replaces the other.** *Layer 1 — deterministic, prevents
  TRANSMISSION*: the exe-name skip (`perception/sensitive-processes.ts`), `ActivityState.seal()` on a sensitive hit,
  and one FRESH `foreground-window` screen taken immediately before every capture (`perception/foreground-screen.ts`)
  — which NARROWS but does not close the gap: foreground and capture are still two WS round-trips, so the residual
  non-atomic window is real and tracked (D48), never described as closed.
  *Layer 2 — semantic, prevents RETENTION/USE*: the mandatory ambient VLM pass doubles as a privacy screen
  (`perception/sensitive-screen.ts` — a structural `SENSITIVE_SCREEN` sentinel whose matcher is deliberately more
  forgiving than the prompt); a sensitive verdict discards the frame whatever the retention config says, publishes
  nothing, and logs neither the description nor the window identity. Layer 2 can NEVER substitute for layer 1: the VLM
  is a REMOTE endpoint, so by the time it can judge a frame the pixels have already left the machine. Layer 1 in turn
  cannot see inside an app (incognito is still `chrome.exe`) — hence both, always.
- **Fail-closed is the rule for any observation we cannot screen.** Route failure, schema miss, no focused window, no
  process name, a foreground sample older than the freshness tolerance — all collapse into ONE refusal: the correct
  reaction to each is identical, and distinguishing them tempts a log line that discloses more than "we did not look".
  A capture we cannot screen is exactly the one to refuse, and a refusal never names what it refused to look at.
- **Seal, do not merely drop.** A sensitive foreground makes the activity sampler call `state.seal()` — argument-less
  and data-free (no name, no title, no timestamp) — ending the live stretch so a sibling sampler's unknown-foreground
  guard refuses instead of acting on the last non-sensitive entry. It self-clears by construction: the next ordinary
  sample opens a fresh entry and observation resumes on the very next tick, so no reset and no permanent block exists.
- **Off by default means SILENT, not merely denied.** Without an explicit enable the ambient sampler is not scheduled
  at all: zero captures, zero dialogs — and deliberately no log line either, because a boot-time "ambient sampling
  disabled" line advertises a feature the user never enabled (Recall's off-state).
- **A pause is a withdrawal of consent, so it survives a restart.** The flag is DB-persisted (`db/privacy-pause-repo.ts`
  — one row, an ABSOLUTE deadline that settles on read, so boot needs no "was that yesterday" special case) and
  hydrated through the FACTORY, never through a mutator: restoring must not look like a mutation, because the mutators
  have exactly ONE production caller — the operator-only `perception.pauseSet`. That single-writer property is the
  proof the agent cannot un-pause its own observation; it is source-swept by `privacy-pause-writer.test.ts`.
- **Retention is enforced by a sweeper, and ambient frames live in their own store.** A retention policy nobody sweeps
  is not a policy: `perception/ambient-shot-gc.ts` sweeps at boot and on an interval regardless of the enable flag
  (frames captured before ambient sensing was switched off must still expire). Ambient frames get their own directory
  AND their own filename prefix (`perception/ambient-shot-store.ts`), so an automatic aggressive sweep is structurally
  unable to address a user-requested capture even if it were pointed at the wrong directory.
- **One identity rule, single-sourced.** The stale pre-filter and the fresh pre-capture screen compare foregrounds with
  the SAME key (`foregroundKey`, over the already-SCRUBBED title) or they drift — and a drift here is a capture taken
  on an assumption nobody re-checked. An ambient observation also carries its age and stops rendering once stale
  (`perception/screen-context.ts`), so a paused or stopped sampler bleeds out of the prompt instead of lingering.

## Time enters prompts from ONE module, stable-early / volatile-late (time-awareness task)

The agent's time sense is assembled, never ambient: `core/time/time-context.ts` is the SINGLE home for prompt-facing
time rendering (day-date line, tail time line, relative ages, the T4-reserved wall-clock) — never scatter `new Date()`
formatting into prompt code. Grounding: Hermes date-only-in-cached-prefix + anti-churn comment; Claude Code day-date
practice; the pull-only shape was rejected on evidence (models never proactively check time — Hermes wall-clock fix PR,
4 Claude Code issues; survey `research/time-awareness-survey.md`).

- **Stable-early / volatile-late is a UNIVERSAL rule, not provider tuning**: the day-granularity date sits right after
  the base prompt (byte-stable for a calendar day → prefix-cache-safe on every exact-prefix-caching provider, harmless
  elsewhere); the minute-granularity time line is the LAST section (the memory sections before it already vary per
  turn). ZERO provider-conditional code, no provider-private cache APIs (owner hard principle 2026-07-21) — provider
  cache docs may be consulted as COST notes only, never as design inputs.
- **Ages are computed by code, never by the model** (models miscompute date arithmetic): memory bullets render
  `(3 days ago)` via `formatRelativeAge`; future/unparseable timestamps degrade to "just now", never negative/NaN.
- **`get_current_time` is an informational pure-Core tool** (no OS crossing → no Gate); its description tells the
  model NOT to call it for the date/rough time (already injected) — pull covers only precision/timezone.
- Prompt WORDING about time discipline (awareness norms) is deliberately absent — it lands with T4's prompt-design
  pass, as one optimization, not piecemeal.
