# T4 (Proactivity Core) — owner-ratified decisions from the pre-立项 grill

> Grill run 2026-07-26 after the four T4 research docs landed. These are BINDING inputs for the T4
> PRD; each records the reasoning so 立项 does not re-litigate. Research bank:
> `t4-prompt-design-survey.md`, `t4-heartbeat-engine.md`, `t4-scheduler-cron.md`, `t4-codebase-frontload.md`.

## Ratified

**R1 — Catch-up cutoff for missed fires = 24h for ONE-SHOT entries; half-period for RECURRING.**
croner cannot help (a past one-shot never fires; a stopped process gets nothing), so catch-up is ours.
Never replay a backlog — coalesce to a single late run (systemd `Persistent=true` / anacron / Windows
`StartWhenAvailable` all coalesce; nobody does run-all). 24h chosen over the研究's 2h because those
comparables assume always-on hosts while a desktop is off overnight; 24h guarantees "anything set
today is never silently eaten" without翻隔日旧账. A late run MUST carry a `late` marker into the
prompt so the agent says "this was meant for 9am" instead of pretending it is 9am.

**R2 — The memory turn-origin tag (A2) is REQUIRED at the code layer, tolerated-missing at the
storage layer.** Every memory-write entry point must pass it (fail-closed to the least-privileged
value, ZeroClaw `TurnOrigin` precedent); the frontmatter field stays OPTIONAL so legacy files still
parse. Ordering constraint (from research): the tag lands in frontmatter BEFORE the DB column,
because the memory index is rebuilt from files. Rationale: an untagged write path would silently
sediment heartbeat musings as real conversation — undetectable pollution with a large blast radius,
the same class of silent failure as the D1 timeline defect.

**R3 — Proactive delivery reuses the ORDINARY message path; NO `proactive.*` protocol.**
Owner's model: "the agent is a real human assistant; we talk through a chat window — she may message
first, I may not reply." The chat window already receives proactive messages (it subscribes to
timeline appends); the ONLY real gap is that the pet bubble subscribes to the active-request delta
stream instead. Fix = point the bubble at the same timeline-append source. This supersedes the
research proposal to build a parallel `proactive.*` schema + subscriptions registry + push slot
(framework-fit-before-self-build, owner principle). Known side effect: a proactive message arrives
whole rather than typewriter-streamed — accepted (reads like receiving a message).

**R4 — Two utterance CLASSES with SEPARATE budgets** (owner's "假主动 vs 真主动" distinction;
independently supported by Braze hold≠abort and the iOS/Android "override class stamped at creation"
pattern — the class is decided when the utterance is created, never judged at delivery time):
- **Class A — deterministic-trigger ("responsive proactive")**: cron reminders the user set,
  delegated-task completion reports, calendar proximity, hook reflexes. The causality is one the user
  expects. → NOT counted against the autonomous budget; quiet hours HOLD-then-release (never abort);
  ignore-backoff does not apply.
- **Class B — genuinely autonomous (heartbeat judgment)**: state care ("been coding 2h, take a
  break?"), time care ("it's late"), surfaced commitments (T5), context transitions, pure
  companionship. No causality the user expects. → strict budget; quiet hours ABORT (caring can wait
  for tomorrow); ignore-backoff applies.

**R5 — Silence guidance is TURN-SCOPED, never global.** `composeInstructions` gains a turn-kind
parameter (`primary | heartbeat`) and only heartbeat turns receive the silence contract; the default
MUST be `primary` (fail-safe: a call site that forgets gets ordinary chat behavior, never accidental
silence). A global "you should usually stay silent" would make direct questions get stonewalled.
The SAME turn-kind value feeds the A2 memory tag — one concept, two consumers, never two vocabularies.

**R6 — Silence is expressed STRUCTURALLY, not by sentinel.** `heartbeat_respond` is the only
delivery path; not calling it IS silence. Rejects the sentinel approach (Hermes' `[SILENT]` needed 4
token variants + 3 positional rules and still mishandles "I considered staying [SILENT] but…");
adopts the MemGPT inverse. Our own T1 filler-text bug is the same lesson. Prompt WORDING may still
borrow the framing lines from OpenClaw/ATRI ("no one spoke to you", "don't manufacture a topic just
because time passed", "am I just making my presence felt?") — but NOT their sentinel mechanics.

**R7 — Ambient observation stays in system instructions (not tool results) — a DELIBERATE deviation
from Anthropic guidance, to be recorded in spec with its reasoning.** Push injection was owner-ratified
(a heartbeat cannot call a tool it never thinks to call); Anthropic itself publishes an
`<untrusted_content_policy>` for untrusted content inside system prompts; the real defenses are the
fence + PII scrub + sensitive-skip, not the position.

**R8 — Determinism carries the correctness load; prompt wording only carries phrasing.**
Two independent research lines converged: ProactiveBench measured models offering unnecessary help
"even when instructed" not to; TriggerBench measured spontaneous-intervention accuracy collapsing
with context length (>90% → <40% at 100K) while queried recall stays ~98% (the "Cognitive Cliff").
Consequences: (a) a deterministic pre-check chain runs BEFORE any LLM call (Hermes' `$0` pre-run gate
is the model); (b) heartbeat context is deliberately THIN — that is a QUALITY requirement, not just a
cost lever; (c) do NOT build a cheap gate model in v1 (FrugalGPT's savings need a calibrated verifier
we cannot calibrate yet).

**R9 — Class-B budget: the CONSERVATIVE tier, and EVERY number is user-configurable.**
Defaults: heartbeat beat ~15 min (with jitter, so it never feels mechanical), max **2 utterances/hour**
and **8/day**, quiet hours default 23:00–08:00. Owner: "先用保守的配置。总之这部分也作为可配置项" —
so these are FACTORY DEFAULTS behind config (D11 pattern now, #26 panel later), never hardcoded
constants. Rationale for conservative-first: the harm is asymmetric (a too-chatty first impression is
unrecoverable — the user just turns the feature off; too quiet is trivially tunable up), and
ProactiveBench shows models over-offer help even when told not to, so the default must assume
over-triggering.

**R10 — "Pure companionship" (no-reason) utterances are OUT of v1.** Class B keeps only the four
evidence-backed kinds: state care, time care, surfaced commitments (T5), context transitions. The
no-reason kind has the highest noise risk and the vaguest value, and we have no feedback loop to
calibrate it until T5's feedback distillation. Revisit then.

**R11 — Ignore-backoff is adopted in principle** (consecutive non-responses reduce Class-B frequency;
Class A exempt). Owner endorsed the model — "she may message, I may not reply" — i.e. NOT replying is
itself a signal the engine should read. The exact curve is an implementation detail for 立项; it must
also be configurable/resettable.

**R12 — A proactive message appears WHOLE in the bubble (no typewriter streaming).** The natural
consequence of R3's reuse of the timeline-append path; reads like receiving a message, which matches
the "real assistant over a chat window" model. Accepted explicitly rather than inherited silently.

## Open (none — the pre-立项 grill is closed)

All items raised in the 2026-07-26 grill are ratified above. Remaining numeric choices inside the
ratified shapes (the exact backoff curve, the pre-check chain's item list) are implementation
detail for 立项, bounded by R8-R11.

## Newly discovered problems that T4 must handle (from research, not previously known)

- A heartbeat beat STEALS the one-shot costume-change notice (`costumeChanged` is consumed in
  `buildOutgoing`) — a user turn would then never see it.
- `autoMemory.onTurnCompleted` does not discriminate turn kinds — this is the concrete proof that R2
  is necessary, not theoretical.
- Busy-yield is currently inexpressible: the turn queue has no `tryAcquire`/`isBusy` and
  `TurnRegistry` has no `isActive`. T4 must add one.
- `next_run_at` is a cache of wall-clock intent and must be RECOMPUTED from the pattern at every
  startup, never trusted across a restart (DST; Hermes hit exactly this).
- Quiet hours is greenfield — zero code anywhere today.
- croner is NOT installed despite being in the CLAUDE.md stack table; and it is better understood as a
  PATTERN EVALUATOR (`previousRuns` on a callback-less `Cron` arms no timer) than as our scheduler —
  the tick loop, persistence and catch-up are ours.
- Integration risk (leader-noted, unverified): T1's `presentationTailStop` predicate may interact with
  a heartbeat turn that calls avatar tools before `heartbeat_respond`. Must be verified at 立项.
- `untrusted-fence.ts` case-insensitivity (`/gi`) is real but UNPINNED by tests — a regression to `/g`
  would pass CI. Folded into T3b batch C.
