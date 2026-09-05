# T4 Heartbeat Engine — mechanics research

> Scope: the **engine**, not the wording. A Heartbeat = a full Agent Core turn with
> **no user message**, on an approximate cadence, where the LLM judges whether to
> speak and **silence is the default outcome** (`CONTEXT.md:28-30`).
> Sibling agents own (a) prompt wording and (b) croner/scheduling — both are
> deliberately out of scope here.
> Method: web research via `mcp__exa__web_search_exa` only (no native WebSearch);
> local reading of `references/hermes-agent-main` (MIT, patterns only) and our own
> `packages/core`. Every recommendation carries a URL or a `file:line`; unsourced
> ideas are quarantined in §10 OMITTED.
> Date: 2026-07-26.

---

## 0. What `m5-proactivity-survey.md` already settles (NOT re-researched)

Read first: `.trellis/workspace/pleia/m5-proactivity-survey.md`. It already fixes:

| Already settled there | Where |
| --- | --- |
| OpenClaw's five-mechanism automation stack (cron / heartbeat / inferred commitments / hooks / standing orders) + task ledger + the cron-vs-heartbeat routing rule | §1.1, B5 |
| Heartbeat internals we mirror: 30m default, `HEARTBEAT_OK` ack + `ackMaxChars`, structured `heartbeat_respond` (`notify:false|true`) **taking precedence over the text sentinel**, `empty-heartbeat-file` / `no-tasks-due` skips, `skipWhenBusy`, `activeHours` | §1.2 |
| Trigger surface / system-event wake; completed background task enqueues a system event that triggers an **immediate** heartbeat wake | §1.3 |
| Inferred Commitments as the top un-borrowed idea (B1) | §1.4, B1 |
| Run ≠ delivery: `target`/`to`/`accountId`, direct vs **session-queued**, `directPolicy: block`, per-task notify policies | §1.5 |
| Cost levers: `isolatedSession` (~100K → 2-5K tokens/run, ~40x), `lightContext`, cheap-model override, skip-when-empty, tiny checklist | §1.6, B6 |
| Hermes identity (Nous Research, MIT, Feb 2026), its learning loop, smart approvals; **Hermes has no heartbeat** — proactivity = cron + learning loop | §3 |
| Anti-patterns: full-context heartbeat ≈100K tok/beat, vague checklist items that always fire, notification-fatigue spiral, memory-overwrite, permission fail-open, background completion barging into an active turn (OpenClaw #8997) | §5 |
| Ranked borrow list B1-B11 | §4 |

**This document only fills the gaps**: what the gate actually eats, how a tick is
skipped *before* the LLM, how silence is represented in the type system, busy-yield,
rate/quiet-hour norms with numbers, event-wake queueing, delivery holding, and A2
write-context tagging. It also adds the peer-reviewed layer the survey lacked
(ProactiveBench / PRISM / PRPF / TriggerBench / OASIS), which changes one
conclusion materially — see §1.4.

---

## 1. The reason-gate: what goes in, and what it costs

### 1.1 The formal shape everyone converges on

The academic formulation matches ours exactly: the agent maps
`(environment events E_t, user activities A_t, environment state S_t) → prediction P_t`,
where **`P_t` may be empty — "the proactive agent predicts no potential tasks and
stays silent"** ([Proactive Agent, ICLR 2025, arXiv:2410.12361](https://arxiv.org/html/2410.12361v3), §3.1/§3.4).
Their inputs are exactly the three we have or are building: keyboard/mouse/clipboard/browser
activity, discrete environment events, and current state.

ProAgentBench formalises the split we should copy structurally: a **"When + How"
hierarchical pipeline** — stage 1 is a *binary* `When to Assist` classification;
**only when stage 1 fires does stage 2 (`How to Assist`, the generative step) run**,
"because unnecessary assistance queries (false positives in Stage 1) incur user
interruption costs" ([arXiv:2602.04482](https://doi.org/10.48550/arxiv.2602.04482)).
Its inputs per snapshot `S_i`: screen image `I_i`, timestamp `τ_i`, application
metadata `M_i` (active app name, window title, category) — i.e. **our T3a activity
layer is already the right input set**, minus screenshots (T3b, high tier, off by default).

### 1.2 Two-stage gating is the published cost architecture

| System | Stage 1 (always on) | Stage 2 (rare) | Measured effect |
| --- | --- | --- | --- |
| **PRPF** ([arXiv:2606.03236](https://arxiv.org/html/2606.03236)) | lightweight Multimodal Proactive Perceptor: intervention gate + context compression | full VLM reasoner, only when intervention warranted | success 20.82% → 41.15%, false-trigger 13.76% → 7.21%, **expected inference compute −69.3%**, latency −60.1% |
| **PRISM** ([arXiv:2602.01532](https://arxiv.org/html/2602.01532v1)) | calibrated `p_need`, `p_accept`; cost-derived threshold `τ(p_need)` from `C_FA` vs `C_FN` | "slow" counterfactual reasoning **only within a narrow margin `δ_slow` of the decision boundary** | F1 66.47 → 86.61, false-alarm rate 50.22 → **22.94**, lower slow-token cost |
| **TGL trigger** ([arXiv:2605.30152](https://arxiv.org/pdf/2605.30152)) | small temporal-graph model over activity events; trigger head + entity-routing head, one forward pass | LLM invoked only above threshold, consuming the routed entities | per-event trigger latency **11.13 ms**, ~4-7× faster than every LLM-as-trigger config tested |
| **FrugalGPT** ([arXiv:2305.05176](https://arxiv.org/pdf/2305.05176)) | cheap model first | escalate only when a verifier scores the answer unreliable | up to **98% cost reduction** at matched quality |

The TGL paper also quantifies the naive design's bill directly: the ProactiveAgent
demo "attempts a new offer every 15 seconds, i.e. **240 trigger decisions per hour**,
each paying full LLM cost regardless of whether a task is generated"
([arXiv:2605.30152](https://arxiv.org/pdf/2605.30152), §1). That is the external
corroboration our survey's "满上下文心跳≈100K token/拍" anti-pattern was missing.

**Caveat on cascades (load-bearing):** FrugalGPT's headline is the cascade, but the
hard part is the *verifier* — they had to train a DistilBERT scorer; raw LLM
self-confidence is miscalibrated and prompt-sensitive, and a miscalibrated verifier
fails in both directions at once (false-accept = silent quality collapse;
false-escalate = you pay cheap + verify + expensive to change nothing)
([analysis](https://dreaming.press/posts/llm-cascade-vs-router.html), tier-2 blog,
consistent with the primary paper). **Implication for v1: do not ship a second
"gate model" until we can calibrate it on our own traffic.** The cheap lever that
needs no verifier is the *deterministic* pre-check (§2) and thin context (§1.4).

### 1.3 Thin context: the mitigations actually shipped

- OpenClaw: `isolatedSession: true` (~100K → 2-5K tokens/run, ~40×), `lightContext: true`
  (bootstrap only the checklist), cheap `model` override (Haiku or local `llama3.2:1b`)
  — `m5-proactivity-survey.md:106-111`, sourced to docs.openclaw.ai/gateway/heartbeat + sfailabs.
- PRPF's perceptor doesn't just gate — it **compresses the multimodal context into a
  small set of Top-K scenario candidates** before the reasoner sees anything, "filtering
  irrelevant long-tail contexts and reducing the reasoning burden"
  ([arXiv:2606.03236](https://arxiv.org/html/2606.03236)).
- Letta's background (sleep-time) agents share **memory blocks** — labeled,
  character-limited context slices — rather than replaying conversation history, and
  use a `last_processed_message_id` watermark to know what is new
  ([Letta sleep-time docs](https://docs.letta.com/guides/agents/architectures/sleeptime/index.md);
  [DeepWiki](https://deepwiki.com/letta-ai/letta/10.2-sleeptime-agents)).
  Letta's own guidance: keep the trigger frequency "relatively high (e.g. 5 or 10)"
  steps because "triggering the sleep-time agent too often can be expensive (due to
  high token usage) and has diminishing returns."

### 1.4 The finding that upgrades thin-context from a cost lever to a *quality* lever

TriggerBench ([arXiv:2606.23459](https://arxiv.org/pdf/2606.23459v1/__stdout.txt)) measures
**prospective memory** — spontaneously acting on a latent constraint without being asked,
which is exactly the heartbeat's job — against **retrospective memory** (answering when
explicitly queried), on *identical* contexts:

> "when explicitly queried (RM Acc), GPT-4o maintains near-perfect accuracy (≥98%) up to
> 100K tokens... In contrast, autonomous intervention (PM Acc) degrades sharply, dropping
> from >90% to <40%." They name it **the Cognitive Cliff**.

And: "models struggle to preserve prospective constraints while servicing explicit
requests" — attention hijacking drops PM up to 73 points.

**Therefore a full-history heartbeat is not merely expensive, it is measurably worse at
the one decision it exists to make.** Thin context is the correct design even if tokens
were free. This is the single most decision-relevant new fact in this document.

Secondary but aligned: ProAgentBench found **CoT prompting often *underperforms*
zero-shot on the when-to-assist decision** — under CoT the model "constructs unfounded
reasoning about information overload and hypothetical needs," producing a false positive
where zero-shot correctly predicted no assistance; self-consistency was the most reliable
prompting method ([arXiv:2602.04482](https://doi.org/10.48550/arxiv.2602.04482)).
(Wording is the sibling agent's call; the *mechanical* takeaway is: don't force a long
reasoning budget into the gate step.)

---

## 2. Empty-tick skip — the deterministic pre-check (primary cost lever)

### 2.1 Hermes ships exactly this, and it's readable in our local clone

Hermes's cron has a **$0 pre-run gate**: a job may carry a `script`, executed *before*
the prompt is built; if its **last non-empty stdout line** parses as JSON with
`{"wakeAgent": false}`, the agent run is short-circuited entirely.

- `references/hermes-agent-main/cron/scheduler.py:2312-2335` — `_parse_wake_gate()`.
  Convention ported from nanoclaw #1232. "if the last stdout line is JSON like
  `{"wakeAgent": false}`, the agent is skipped entirely — no LLM run, no delivery.
  Any other output (non-JSON, missing flag, gate absent, or `wakeAgent: true`) means
  wake the agent normally."
- `references/hermes-agent-main/cron/scheduler.py:2859-2879` — the gate runs **before**
  `_build_job_prompt`, and the script is executed exactly once (its output is threaded
  into the prompt if the agent does wake). Skip returns `(True, silent_doc, SILENT_MARKER, None)`.
- `references/hermes-agent-main/cron/scheduler.py:2688-2698` — for `no_agent` jobs the
  check happens "BEFORE importing run_agent / constructing SessionDB so a pure-script
  tick never pays for the agent machinery it isn't going to use."
- **Failure semantics are asymmetric and deliberate**: the wake gate is only honoured
  when the script exited OK (`if _ran_ok and not _parse_wake_gate(...)`,
  `scheduler.py:2868`); a crashed/timed-out script for a `no_agent` watchdog is
  *delivered as an error alert*, because "silent failure for an alerting job is the
  worst-case outcome" (`scheduler.py:2729-2746`). Parse failure → wake (fail-open toward
  running, not toward silence).
- The rejected PR that proposed a parallel typed trigger system
  ([hermes-agent#2654](https://github.com/NousResearch/hermes-agent/pull/2654)) states the
  economics plainly: "A job scheduled `every 30m` fires 48 times/day even if only 2 of
  those runs have meaningful work. The other 46 runs waste inference costs." Its three
  proposed zero-cost predicate types are a good menu: **`sql`** (query local state, skip
  below threshold), **`file_changed`** (mtime vs last run — a `stat` call), **`command`**
  (shell exit code). Maintainer closed it in favour of the existing `wakeAgent` gate.

### 2.2 The generic pre-check vocabulary (from schedulers, not agents)

| Pre-check | Mechanism | Source |
| --- | --- | --- |
| Nothing new since last run | **cursor / watermark**; "compare with previous state, run deterministic checks, **call LLM only if needed**" | [polling-agent patterns](https://www.glukhov.org/ai-systems/architecture/polling-agents-ai-assistants-implementation-patterns/) (tier-2); [Letta `last_processed_message_id`](https://deepwiki.com/letta-ai/letta/10.2-sleeptime-agents) |
| Duplicate tick | idempotency key `hash(schedule_id, version, tick_utc_instant)`; ledger returns FRESH / IN_FLIGHT / COMPLETED | [atomic-agents idempotency spec](https://github.com/dep0we/atomic-agents-stack/blob/main/docs/spec/45-idempotency-backend.md); [cron trigger guide](https://solana.garden/guides/llm-agent-scheduled-cron-job-trigger-systems-explained/) (tier-2) |
| Previous run still going | **overlap policy: `forbid` / `allow_parallel` / `cancel_previous`** — "if a run for `schedule_id` is active, drop or defer the new tick" | same cron guide (tier-2); Hermes keeps `_running_job_ids` + lock, `scheduler.py:339-340` |
| Ticks missed while asleep | **missed-window policy: `skip` / `coalesce` (one catch-up with `backfill_from`) / `replay each`** — "catch-up storms after outage" is a named pitfall | same cron guide (tier-2) |
| Polling at all | "If the agent has to discover these events by polling on a schedule, **most polls find nothing and burn tokens and quota**" → prefer event-driven, but then you must validate/dedupe/rate-limit or event storms drain budgets | [Event-Driven Agent pattern](https://www.agentpatternscatalog.org/patterns/event-driven-agent/) (tier-2) |

### 2.3 We already have this reflex in our own code

`packages/core/src/activity/activity-sampler.ts` (per `activity/index.md:4`) does a
**pre-flight `hasNode` check and skips routing entirely while no node connects** — a
deterministic gate in front of an expensive path, with a quiet once-per-streak log.
Same shape, one layer down. The heartbeat pre-check should read like that file.

---

## 3. Silence as a first-class outcome

### 3.1 The three representations, ranked by failure mode

**(a) String sentinel — measured to be fragile.** Hermes uses `[SILENT]`. Read the code
comment, it is a field report:

```
# Canonical silence tokens recognized in cron output.  Cron's contract is
# intentionally looser than the gateway's exact-whole-response rule: the cron
# system prompt *instructs* the agent to emit "[SILENT]", and real agents often
# bracket it with a short note or trailing newline.  We therefore suppress when
# a marker is the entire response OR appears as its own first/last line — but
# NOT when a token merely appears mid-sentence in a genuine report (e.g.
# "I considered staying [SILENT] but here is the summary…" must deliver).
_CRON_SILENCE_TOKENS = frozenset({"[SILENT]", "SILENT", "NO_REPLY", "NO REPLY"})
```
`references/hermes-agent-main/cron/scheduler.py:288-295`; the parser handling four
positional variants is at `:298-330`; the bracket-dropping bugs it patches are
issues **#51438 / #46917** (cited in the docstring). The system prompt has to say
"Never combine [SILENT] with content" (`scheduler.py:2446-2448`) — a prompt-level
band-aid over a type-level hole.

**(b) Structured tool call — the robust option.** OpenClaw's `heartbeat_respond`
(`notify:false` silent | `notify:true` + text) already **takes precedence over the text
sentinel** (`m5-proactivity-survey.md:60-68`). Our B4 recommendation stands and
strengthens.

**(c) Make speech itself a tool — the strongest known form.** MemGPT/Letta: the agent's
raw content *is* private inner monologue, and
**"`send_message` is the ONLY action that sends a notification to the user, the user does
not see anything else you do"**
([memgpt_chat.txt system prompt](https://github.com/cpacker/MemGPT/blob/e1f25305aa2c612f5a117381d08b7671407f1a1e/memgpt/prompts/system/memgpt_chat.txt)).
Under that architecture silence needs no sentinel and cannot leak: a turn that doesn't
call `send_message` *is* silent, structurally. Also relevant: MemGPT's
`request_heartbeat` defaults to **False** — "agents terminate by default rather than
continue by default as in ReAct" ([Letta v1 architecture post](https://www.letta.com/blog/letta-v1-agent/)).
Note the direction of travel: Letta V1 **deprecates** heartbeats and `send_message` in
favour of native reasoning, and explicitly warns that for "repeatedly triggering agents
to run independently (e.g. processing time or sleep-time compute), you'll need custom
prompting to explain this environment to the agent" — i.e. the affordance we're building
is the thing they removed and now tell you to rebuild yourself.

### 3.2 The failure mode we already hit, confirmed externally

Our T1 devlog, `docs/devlog/m5.md:74` (translated): the root cause of "every
conversation degrades" was that after an avatar tool call ends a step, the `{ok:true}`
result **forces the SDK to generate another step; with nothing to say the model fills
space ("嗯。") and talks to itself**. The fix was explicitly *structural* — a `stopWhen`
predicate `presentationTailStop` — because "external evidence (QwenPaw #4838) confirms
that prompt-only suppression is unreliable across models; a structural stop is required."

The literature says the same thing at benchmark scale:
- TriggerBench: highly proactive models **"overfit to a shallow 'always-remind'
  heuristic"** — GPT-5.2 (high reasoning) excels on positive triggers but drops to
  **43.94%** on negative controls ([arXiv:2606.23459](https://arxiv.org/pdf/2606.23459v1/__stdout.txt)).
- PRISM: baselines including GPT-4o suffer **false-alarm rates consistently exceeding
  50%** — "excessive chatter" ([arXiv:2602.01532](https://arxiv.org/html/2602.01532v1)).
- ProactiveAgent: adding a reward-model gate makes models **over-correct into silence**
  ("models stay silent once they receive feedback from the reward model... doing nothing
  is not always the optimal solution") — recall collapses
  ([arXiv:2410.12361](https://arxiv.org/html/2410.12361v3), §4.3). Both failure directions are real.

**Conclusion: silence must be the structural default of the turn shape, not a token the
model is asked to emit.** A beat that produces no delivery-tool call is silent; a
malformed beat is silent; only an explicit, well-formed request to speak produces speech.

---

## 4. Busy-yield (忙时让路)

### 4.1 The HCI result that gives us the rule and the numbers

Iqbal & Bailey's **OASIS** (CHI 2008) is the canonical defer-to-breakpoint system
([paper PDF](https://interruptions.net/literature/Iqbal-CHI08.pdf);
[ACM](https://dl.acm.org/doi/10.1145/1357054.1357070)):

- Architecture: a **breakpoint detector** (monitors the user event stream, pools events
  for a few seconds, feeds statistical models) + a **scheduler**. An application
  requesting a notification supplies **a policy flag and a maximum time it can wait**;
  the scheduler queues the request until that breakpoint type occurs **or the timeframe
  expires** — in either case it is then released.
- Result: scheduling at breakpoints **reduces frustration and reaction time** vs
  immediate delivery. Reaction time 3.07s (breakpoint) vs 4.08s (immediate).
- **Mean deferral time 88.6s (SD 139.3)** — "we believe this provides an acceptable balance."
- Coarse and medium breakpoints beat fine ones for frustration; but the models detect
  breakpoints reasonably (52-64%) while **failing to differentiate their type** →
  "scheduling systems may want to use composite models only for detecting breakpoints,
  i.e. without differentiation."

**Design consequence:** implement *"defer until any breakpoint, max-wait T"*, not a
breakpoint taxonomy. Our cheap observable coarse breakpoints already exist: an activity
entry ending (foreground app/title change splits an entry —
`packages/core/src/activity/activity-state.ts:71-84`), the transition to `idle`, and the
end of a user turn.

### 4.2 Precedents for "don't cut in while they're still going"

- **OpenAI Realtime `semantic_vad`**: a classifier scores the probability the user has
  finished; low probability → longer timeout ("user audio that trails off with 'ummm…'
  results in a longer timeout"). `eagerness: low|medium|high` maps to max timeouts of
  **8s / 4s / 2s**, and `interrupt_response` controls whether an in-flight model response
  is cancelled when the user starts
  ([OpenAI Realtime VAD docs](https://developers.openai.com/api/docs/guides/realtime-vad)).
  The transferable primitive: a **hysteresis timeout before the agent may take the floor**,
  tunable by an eagerness knob — for us, keystroke/foreground activity within the last
  N seconds means "still going."
- **Windows Focus assist automatic rules** — the native precedent, and the one our users
  already expect: automatically on "when you're duplicating your display, playing a game,
  or using an app in full screen mode," plus "during these times" and "for the first hour
  after a Windows feature update," each with a level (Off / Priority only / Alarms only)
  ([Microsoft Support](https://prod.support.services.microsoft.com/en-us/windows/focus-stay-on-task-without-distractions-in-windows-cbcc9ddb-8164-43fa-8919-b9a2af072382)).
  A desktop companion that speaks over a full-screen game or a mirrored presentation is
  violating a rule Windows itself enforces by default.
- **OpenClaw**: `skipWhenBusy` defers while cron work is active/queued or the agent's own
  subagent lanes are busy (`m5-proactivity-survey.md:66-67`); issue **#8997** is the
  counter-example — a background completion interrupting an active turn
  (`m5-proactivity-survey.md:411`).
- **Hermes has no equivalent.** Grep of the local clone for
  `quiet_hours|active_hours|do_not_disturb` and `skip_when_busy|skipWhenBusy` returns
  **zero matches** — busy-yield and quiet hours are an OpenClaw idea, not a Hermes one.
  (Recorded so nobody goes looking for it there.)

### 4.3 Dropping a stale deferred utterance

Push infrastructure has the exact primitive: **expiry, not indefinite hold**.
FCM `ttl` (0…2,419,200s; `ttl: 0` = "deliver immediately or discard") and APNs
`apns-expiration` ("identifies the date when the notification is no longer valid and can
be discarded"; `0` = expire immediately, never stored)
([FCM lifespan](https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-lifespan);
[APNs](https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/RemoteNotificationsPG/CommunicatingwithAPNs.html)).
Plus **`collapse_key`**: if a message with the same collapse key is already pending,
"the old message is discarded and the new message takes its place" — latest-wins
coalescing for the queue of one.

---

## 5. Rate limiting, quiet hours, DND, and the explicit-request override

### 5.1 Published frequency data (all from push marketing — extrapolate carefully)

| Finding | Number | Source |
| --- | --- | --- |
| Field experiment, 17,500 users, 7 weeks: **each additional push per week raises the uninstall rate by 2.50 percentage points** (baseline 1.85% with zero messages); direct open rate falls **12.67%** per added weekly message | +1/wk → +2.5pp uninstalls | [Wohllebe 2021, *Int. J. Interactive Mobile Tech.*](https://real.mtak.hu/138580/1/IM_2021_02_Wohllebe.pdf) |
| **Three messages per day is the identified limit of user tolerance** (diet app, qual+quant) | 3/day | Freyne et al. 2017, cited in the same paper |
| Users already receive **63.5-65 notifications/day** in the wild | ~64/day | [Pielot, Church & de Oliveira, MobileHCI 2014](https://ic.unicamp.br/~oliveira/doc/MHCI2014_An-in-situ-study-of-mobile-phone-notifications.pdf) |
| Health-intervention app: capped at **up to 3 notifications/day, 08:00-22:00, user-customisable range**; daily beat notifications did **not** deter engagement vs occasional | 3/day + a user-set window | [Bidargaddi et al., PMC5207732](https://pmc.ncbi.nlm.nih.gov/articles/PMC5207732/) |

**Extrapolation warning, stated explicitly:** all of the above measure *unsolicited
promotional push to a phone*. A desktop companion the user installed and named is a
different contract, and the numbers are not directly transferable. Use them as an upper
bound on tolerance and as evidence that the *shape* (per-day cap + user-set window +
per-user adaptation) is right — not as our defaults.

### 5.2 Composition rules worth copying verbatim (Braze)

Braze separates three controls that most people conflate
([frequency capping](https://www.braze.com/docs/user_guide/messaging/messaging_fundamentals/frequency_capping),
[quiet hours](https://www.braze.com/docs/user_guide/messaging/messaging_fundamentals/quiet_hours)):

1. **Frequency capping**: up to 10 rules per workspace, combined with `AND`, e.g.
   "no more than one push per day **and** no more than three per week." Applied
   **per dispatch**, computed on the **user's local calendar day, not rolling 24h**
   (documented consequence: a message at 11pm makes them eligible again an hour later).
   Aborted messages don't count toward the cap.
2. **Quiet hours**: "**Quiet hours are not the same as aborting a message. Aborting a
   message discards it entirely. Quiet hours hold the message and deliver it later.**"
   Held messages all fire at once when the window closes — a named hazard.
3. **Independence**: "Each of these delivery controls applies independently. A message
   that clears frequency and rate limits can still be held by quiet hours, and a message
   held by quiet hours is evaluated against rate limits when it eventually sends."

**Override**: transactional campaigns set `override_frequency_capping: true` (API) or
toggle capping off per-campaign, with a *separate* choice of whether the overriding send
still *counts toward* the cap
([send API](https://github.com/braze-inc/braze-docs/blob/develop/_docs/_api/endpoints/messaging/send_messages/post_send_messages.md)).

### 5.3 The OS answer to "remind me at 3am"

Both mobile platforms solve exactly our question — a **priority class attached to the
message**, not a global mode toggle:

- **iOS interruption levels**: `passive` / `active` / **`time-sensitive`** (breaks through
  Focus modes and scheduled delivery) / **`critical`** (bypasses DND *and* the silent
  switch; requires Apple approval and a separate user opt-in). Users can allow or deny
  time-sensitive per Focus mode
  ([OneSignal docs](https://documentation.onesignal.com/docs/en/ios-focus-modes-and-interruption-levels);
  [How-To Geek](https://www.howtogeek.com/751563/what-are-time-sensitive-notifications-on-iphone/)).
- **Android `ZenPolicy` / `NotificationManager.Policy`**: per-*category* bypass —
  `PRIORITY_CATEGORY_ALARMS`, `_REMINDERS`, `_CALLS`, `_REPEAT_CALLERS`, `_CONVERSATIONS`,
  plus per-channel `canBypassDnd()`, and the policy can revoke even those
  ([ZenPolicy](https://developer.android.google.cn/reference/kotlin/android/service/notification/ZenPolicy);
  [Policy](https://developer.android.google.cn/reference/kotlin/android/app/NotificationManager.Policy)).

**The rule to adopt: quiet-hour bypass is a property of the utterance's class, granted at
creation by an explicit user request, never a decision the heartbeat gate makes at
delivery time.** An ambient thought can never promote itself.

### 5.4 Backoff after being ignored

Duolingo's production system (KDD 2020) applies a **recency penalty with exponential
decay** to any notification template already shown to that user:
`s*_{a,t} = ŝ_a − γ · 0.5^(d_{a,t}/h)`, where `d` = days since that arm was last used;
production values **γ = 0.017, h = 15 days**
([Yancey & Settles, KDD 2020](https://research.duolingo.com/papers/yancey.kdd20.pdf)).
The motivation transfers directly: reusing the same move "will get repetitive, desensitize
users, and fail to improve engagement in the long run."
Secondary (tier-3, blog): "if a user stops interacting with Duolingo's push notifications
it does eventually stop sending them"
([summary](https://vuink.com/post/ynhqfcrnxre-d-dpbz/post/how-duolingo-does-push-notifications-with-examples)) —
treat the *existence* of a give-up rule as sourced, the details as not.

---

## 6. System-event wake without a turn storm

### 6.1 Precedent for waking on an event

- OpenClaw: `openclaw system event --mode now --text "..."` is the sanctioned programmatic
  wake; **completed background tasks enqueue a system event that triggers an immediate
  heartbeat wake** (`m5-proactivity-survey.md:74-80`, issues #39298 / #2804).
- LangChain **ambient agents**: "ambient agents listen to an event stream and act on it
  accordingly, potentially acting on multiple events at a time"; the trigger "is no longer
  a human coming in and sending a message," and — importantly for us —
  **"they can run for a lot longer period of time before you need a response... there's
  generally much less strict latency requirements"**
  ([LangChain, Jan 2025](https://www.langchain.com/blog/introducing-ambient-agents)).
  Their three human-contact patterns are a clean taxonomy for what a beat may produce:
  **notify / question / review**.

### 6.2 Storm control: debounce + coalesce + single-flight

| Primitive | Concrete spec | Source |
| --- | --- | --- |
| **Debounce with a max-wait ceiling** | quiet window resets on each event; a hard ceiling forces a flush so a continuous stream can't starve the batch forever ("pure debounce fails on continuous event streams: the timer resets indefinitely, producing zero batches until the stream stops") | [file-watcher debounce write-up](https://medium.com/@impactarchitecture/file-watchers-lie-debounce-throttle-and-coalescing-in-build-loops-8d91cb29f712) (tier-2, but the failure mode is precise and testable) |
| **Coalesce by logical key, with a strategy** | `key` (group related deliveries), `wait_seconds`, `max_wait_seconds`, `strategy: last \| first \| batch \| batch_last`, `max_items`/`max_bytes` caps. And the distinction that matters: **"idempotency handles exact retries; debounce/coalescing handles related but distinct deliveries."** | [hermes-agent#20201](https://github.com/NousResearch/hermes-agent/issues/20201) (accepted design discussion); [#13456](https://github.com/NousResearch/hermes-agent/issues/13456) names the symptom: "duplicate agent/model invocations for the same logical transition... avoidable 429 pressure" |
| **At most one pending run per key** | GitHub Actions `concurrency: { group, cancel-in-progress, queue }` — with `queue: single` (default) "any existing pending job in the same concurrency group is canceled and replaced"; `queue: max` allows a bounded FIFO; the two cannot be combined with `cancel-in-progress` | [GH Actions concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) |
| **Never cancel mid-tool-chain** | "`cancel_previous` — almost never appropriate for agents mid-tool-chain; prefer `forbid`" | [cron trigger guide](https://solana.garden/guides/llm-agent-scheduled-cron-job-trigger-systems-explained/) (tier-2) |

The synthesis: **events arm the next beat; they never spawn a turn directly.** One pending
beat per character, latest-wins, and the beat itself is serialized by the existing
per-character turn mutex (`packages/core/src/agents/turn-queue.ts`, per `agents/index.md:6`).

---

## 7. Delivery decoupling — where the utterance is held

| Layer | Mechanism | Source |
| --- | --- | --- |
| Agent runtime | Run ≠ delivery: `target: none \| last \| <channel>`; direct delivery via `requesterOrigin`, else **session-queued** as a system event surfacing on the next heartbeat; `directPolicy: "block"` runs the turn but suppresses sends | OpenClaw, `m5-proactivity-survey.md:96-104` |
| Agent UX | **Agent Inbox** — a standalone inbox modelled on email + ticketing that "displays all open lines of communication between you and an agent," backed by LangGraph's persistence layer so the agent can "pause and wait for user feedback... a second, a day, an hour" | [LangChain](https://www.langchain.com/blog/introducing-ambient-agents); [agent-inbox README](https://github.com/langchain-ai/agent-inbox/blob/bc2702f8/README.md) (`accept/edit/response/ignore`) |
| Transport | **Per-client outbox** keyed by a *stable client id, not the socket*; monotonic `seq`; replay the outbox on reattach; client dedups by `lastSeq` and **acks after the handler runs, not on receipt**; bound the outbox and expire abandoned ones | [WS delivery guarantees](https://www.real-time-websocket.com/scaling-real-time-infrastructure/message-delivery-guarantees/) (tier-2, but the protocol is standard) |
| Store | Offline queue per recipient with TTL, drained in order on reconnect from `last_ack_seq`; a **silent** wake so a user returning after days doesn't get a wall of banners | [WhatsApp-style design](https://scalablesystem.dev/system-design/build-whatsapp-message-delivery-with-offline-queuing) (tier-2) |
| Expiry | `ttl` / `apns-expiration` / `collapse_key` (§4.3) | FCM / APNs (primary) |

**Our version is nearly free**: the Agent Core is the single DB writer (invariant 2), the
timeline is already persisted, and `packages/core/src/server/timeline-subscriptions.ts`
already fans `timeline.appended` out per `characterId → connection → sink`
(`server/index.md:6`). So: **the utterance is held in the timeline; delivery is
subscription fan-out.** Nothing is lost when the Pet UI is closed (invariant 4), and no
new store is needed — only a staleness rule about *how* an old utterance surfaces
(history vs. toast/TTS).

---

## 8. A2 write-context tagging — is there precedent?

**Yes, a direct one.** ZeroClaw PR #8619, *"unified memory-context injection keyed on
TurnOrigin ingress provenance"*
([github.com/zeroclaw-labs/zeroclaw/pull/8619](https://github.com/zeroclaw-labs/zeroclaw/pull/8619)):

- Adds `TurnOrigin` — **`{interactive, channel, cron, daemon, agent_direct, sub_turn}`** —
  to the ingress envelope, "stamped at every turn entry point."
- **"The three shared entry fns (`run` / `process_message` / `agent_turn`) take origin as a
  required parameter, so a new entry point cannot compile without declaring who initiated
  the turn."**
- Policy keyed on origin: "sub-turns never inject; **scheduled origins always exclude
  Conversation entries** (#5456); other origins exclude them only when sessionless; spawn
  sites can suppress (cron `uses_memory = false`)."
- Security: origin "is stamped by in-process constructors only and is never deserialized
  from external input"; a legacy/omitted field **fails closed to `sub_turn`** (the
  least-privileged origin) so a crafted envelope can't gain origin-gated behaviour.
- Bug it fixed: "**Cron and daemon turns get ONE memory block instead of two**" —
  scheduled turns were double-injecting.
- Also: "`Agent::turn` no longer persists memory blocks into conversation history... **history
  stays clean** (ends stale-block accumulation across multi-turn sessions)."

That is our A2 rule (`primary|heartbeat|flush|subagent`) with a different vocabulary,
including the two properties I'd have flagged as our own invention: **required at every
entry point** and **fail-closed default**.

Supporting, weaker corroboration:
- Provenance fields as a memory-entry norm: **source (session id + turn/run id),
  created-at/last-accessed-at, confidence (`user-confirmed` vs `agent-inferred`),
  `supersedes`** — plus a "why is this in my memory?" tool that walks the lineage
  ([agentic-ai course ch.07](https://github.com/bryanyzhu/agentic-ai-system-course/blob/main/course/07-memory-writing.md), tier-2).
  Same file: background curation should **"only run on successful turns"** (an interrupted
  transcript teaches the agent wrong things), should be **throttled by interval** (it cites
  Hermes's `_memory_nudge_interval` / `_skill_nudge_interval`), and should use a
  **restricted tool set** (memory + read-only, no shell).
- Origin-bound authority as a *security* construction: memory items carry
  `(content, origin, scope, t_write, act_class)` with `origin ∈ {user, trusted tool, agent,
  untrusted external}`, bound at write time and **non-malleable** — an agent's own summary
  of untrusted content inherits the untrust
  ([arXiv:2606.24322](https://arxiv.org/html/2606.24322)). This says our tag should also
  be a *trust* axis, not just a bookkeeping one — which dovetails with the A1 fence.
- Letta's separation is architectural rather than tagged: the sleep-time agent writes to
  shared memory blocks and the primary agent has **no** core-memory-edit tools at all
  ([Letta blog](https://www.letta.com/blog/sleep-time-compute/)). A different answer to
  the same problem (separate the writer, don't tag the turn) and worth knowing exists.

**Verdict: A2 is corroborated, not invented.** The one part I could find no external
precedent for is the *specific four-value vocabulary* including `flush` — that's ours.

---

## 9. Recommendations — a concrete v1 heartbeat engine

Legend: **[C]** = cited above, **[D]** = derived (my inference from cited material +
our code), **[O]** = owner decision needed.

### 9.1 Shape: three tiers, one LLM call at most

```
tick (deterministic, cheap, no LLM)
  └─ pre-check chain  ──skip(reason)──▶ log + return          [C §2]
  └─ pass ▶ Tier-1 beat: ONE thin-context turn                [C §1.3-1.4]
             └─ ends by calling heartbeat_respond(...)         [C §3.1]
                 ├─ silent            ▶ nothing persisted, nothing delivered
                 ├─ express(...)      ▶ avatar-only, no text
                 └─ speak(text, ...)  ▶ ProactiveUtterance → rate/quiet gate → timeline
             └─ ends with NO tool call ▶ treated as SILENT (default-deny)  [D, from §3.2]
```

No second gate model in v1. FrugalGPT's lesson is that the cascade's value lives in a
calibrated verifier we cannot yet calibrate [C §1.2]; keep a `gateModel` config seam so
B6 stays reachable without a rewrite [D].

### 9.2 Cadence

| Knob | Proposed default | Basis |
| --- | --- | --- |
| Pre-check tick | every **60 s** (`setInterval().unref()`, same shape as the sampler) | [D] — matches `activity-sampler.ts`'s 30 s loop idiom; a pre-check is a few `stat`-class reads |
| Beat eligibility interval | **15 min ± 20% jitter**, floor 5 min | [O] — OpenClaw's 30 min is the conservative anchor [C `survey:60`]; a desktop companion wants tighter, but every beat is billed. Jitter keeps the pet off a mechanical grid and de-syncs it from the 30 s sampler [D] |
| Hard ceiling | ≤ **4 LLM beats/hour** per character, regardless of events | [D] — bounds the bill independently of every other rule; cf. "240 trigger decisions per hour" as the anti-pattern [C §1.2] |
| Beat budget | ≤ **3K tokens** of assembled context; log actual per beat | [C §1.3] OpenClaw isolated runs land at 2-5K |

### 9.3 The deterministic pre-check list (ordered, each with a named skip reason)

Every entry is zero-LLM and returns a **typed reason string** for logs/metrics (Hermes
and OpenClaw both name their skips — `empty-heartbeat-file`, `no-tasks-due`,
`wakeAgent=false`) [C §2, `survey:66`].

| # | Check | Skip reason | Source |
| --- | --- | --- | --- |
| 1 | Privacy Pause active | `privacy-paused` | `packages/core/src/perception/privacy-pause.ts:16-20` [D] |
| 2 | No provider/model configured or reachable | `no-provider` | [D] — mirrors `activity-sampler.ts`'s `hasNode` pre-flight (`activity/index.md:4`) |
| 3 | Outside active hours / inside quiet hours **and** no time-sensitive due item | `quiet-hours` | OpenClaw `activeHours` [C `survey:67`]; class-based bypass [C §5.3] |
| 4 | A live turn is in flight (turn-queue busy / turn-registry has an active controller) or a Capability call is outstanding | `busy` | OpenClaw `skipWhenBusy` + #8997 [C §4.2]; seams: `agents/turn-queue.ts`, `agents/turn-registry.ts` |
| 5 | Rate budget exhausted (per-hour / per-day) or min-gap since last utterance unmet, incl. ignore-backoff multiplier | `rate-limited` | Braze capping [C §5.2]; Duolingo recency decay [C §5.4] |
| 6 | Checklist empty **and** no due intention **and** no queued system event **and** activity watermark unchanged since last beat | `nothing-to-check` | Hermes `wakeAgent=false` / `empty-heartbeat-file` / `no-tasks-due` [C §2.1]; watermark [C §2.2] |
| 7 | This tick key already ran (`characterId + tick instant`) | `duplicate-tick` | idempotency key [C §2.2] |
| 8 | Full-screen / display-duplication / game in foreground (once T3b or a Shell signal exposes it) | `focus-assist` | Windows Focus assist defaults [C §4.2] — register as deferred if the signal isn't there yet |

Check 6 needs one new piece of state: `lastBeatActivityMark` — the `(startedAt, samples)`
of the newest reportable entry at the last beat. `activity-state.ts` already exposes
`entries()` / `current()` and its header explicitly says "T4's heartbeat reason-gate reads
entries()/current()" (`packages/core/src/activity/activity-state.ts:1-6`) [D].

**Failure policy:** a pre-check that *throws* skips the beat (fail-quiet), because the
worst case of a broken pre-check on a companion is unwanted speech, not a missed alert —
the inverse of Hermes's watchdog reasoning, and deliberately so
(`references/hermes-agent-main/cron/scheduler.py:2729-2733` documents why *their* default
is the opposite) [D, contrasted with C].

### 9.4 Gate context composition (thin, stable-first)

Ordered stable→volatile to preserve prompt caching, the rule `chat-agent.ts` already
follows (`agents/index.md:2` — base prompt, then memory, then a tail current-time line):

1. Base identity + a heartbeat-mode preamble *(wording: sibling agent)*
2. The user-editable heartbeat checklist (tiny; B2)
3. **Pinned memory only** — no FTS recall pass on a beat [D; recall is a per-turn cost we
   don't need for a fire/skip decision, and §1.4 says extra context hurts]
4. Rendered activity block, whole-wrapped in the A1 untrusted fence
   (`packages/core/src/activity/render-activity.ts`, `agents/untrusted-fence.ts`)
5. Due intentions/commitments (B1), when that layer lands
6. Volatile tail: current time, time since last utterance, last utterance's gist
   (one line, not the transcript), rate-budget remaining

**Explicitly excluded: the `REPLAY_WINDOW` conversation history.** Rationale is now
empirical, not just economic — the Cognitive Cliff [C §1.4]. If the beat decides it needs
history it can call the existing memory/search tools; that's the escalation path, and it's
already built.

### 9.5 Silence representation

- `heartbeat_respond` is the **only** way a beat may reach the user, and it is the
  terminal tool for the beat: `{ act: "silent" }` | `{ act: "express", ... }` |
  `{ act: "speak", text, class }`. Modelled on MemGPT's "`send_message` is the ONLY
  action the user sees" [C §3.1] and OpenClaw's structured-ack precedence [C `survey:60-68`].
- **Any beat whose text output isn't routed through that tool is discarded, not delivered.**
  Free text from a beat is inner monologue [C §3.1].
- **No tool call at all → silent.** The default outcome of a malformed beat is silence [D].
- Keep a `HEARTBEAT_OK`-style sentinel **only** as a defensive parse for models that emit
  neither, and expect it to be flaky — Hermes needed four token variants and three
  positional rules and still has the "I considered staying [SILENT] but…" case
  (`references/hermes-agent-main/cron/scheduler.py:288-330`) [C §3.1].
- Enforce structurally, not by prompt: a `stopWhen`-style predicate ending the beat on the
  `heartbeat_respond` call, exactly as T1's `presentationTailStop` did
  (`docs/devlog/m5.md:74`) [C §3.2].
- Metric to log from day one: **silence rate** (silent beats / eligible beats) and
  **false-alarm proxy** (utterances the user never responds to). PRISM/ProAgentBench both
  make false-alarm rate the headline metric [C §3.2].

### 9.6 Busy-yield rule

- Beat **deferred, not dropped**, while checks 4 holds.
- A produced utterance that cannot deliver immediately goes into a **queue of one** per
  character, latest-wins (`collapse_key` / `queue: single` semantics) [C §4.3, §6.2].
- Released at the **next coarse breakpoint or on max-wait** — breakpoint = activity entry
  ends (foreground app/title change), transition to idle, or a user turn completes;
  max-wait default **90 s**, chosen to sit at OASIS's measured mean deferral of 88.6 s
  [C §4.1].
- **Staleness TTL** (default 10 min): if the activity that motivated it is no longer
  current, drop it silently rather than deliver a comment about a window the user closed
  [C §4.3].
- Do **not** cancel a beat mid-tool-chain to make way for a user turn — let it finish and
  discard the output if it's stale [C §6.2].

### 9.7 Rate limits, quiet hours, override

- Defaults: **≤2 proactive utterances/hour, ≤10/day**, min gap 10 min. **[O]** — anchored
  by, not derived from, the push data (3/day tolerance limit, +2.5pp uninstall per weekly
  message) [C §5.1], deliberately loosened because a companion is invited and lives in
  one window; the extrapolation is flagged, not hidden.
- Count **per delivered utterance**, on the user's local calendar day, and don't count
  suppressed/aborted ones [C §5.2].
- **Quiet hours = abort for ambient utterances, hold-and-release for due user-requested
  items.** Braze's hold-vs-abort distinction is the right axis; our twist is that an
  ambient thought is stale by morning, so holding it is worse than dropping it [C §5.2 + D].
  Guard the release against Braze's documented "everything sends at once when the window
  closes" hazard by re-running the rate gate on release [C §5.2].
- **Override is a property of the utterance class set at creation** (`time-sensitive`),
  granted only by an explicit user request routed through the scheduler, never by the
  heartbeat gate [C §5.3]. An ambient beat can never self-promote.
- **Ignore-backoff**: after N consecutive un-engaged utterances, multiply the min gap;
  decay the penalty back with a half-life (Duolingo's `γ · 0.5^(d/h)` shape; their
  production `h` = 15 days for template repetition) [C §5.4].
- Every one of these belongs in the T6 #26 settings panel — coupling point 3 in
  `docs/HANDOFF.md:154` [D].

### 9.8 Event wake

- One in-memory `wakeQueue` per character. Events **arm** the next beat; they never call
  the agent [C §6.1-6.2].
- Each event carries `{ kind, dedupeKey, at, payload? }`. Debounce window **5 s**, max-wait
  ceiling **30 s** (the ceiling is non-optional — pure debounce starves under a continuous
  stream) [C §6.2].
- Coalescing strategy `batch_last` for same-key events; `last` across kinds [C §6.2].
- An armed beat still runs the **full pre-check chain** — including the rate budget. An
  event does not buy an extra beat, it only moves the next one earlier [D].
- v1 event sources: long-running Capability finished; user returned from idle (an
  `idle → active` transition in `activity-state`); Privacy Pause released. File-watch and
  webhook wakes are later [O].

### 9.9 Delivery holding

- The beat writes a `ProactiveUtterance` **to the timeline** (Core is the single writer,
  invariant 2); `timeline-subscriptions.ts` fans it to whatever is connected
  (`server/index.md:6`) [D, on cited architecture].
- **Nothing is held anywhere else.** UI closed = the entry is already durable and appears
  on next open (invariant 4).
- Surface class decides *presentation*, not persistence: fresh (< TTL) → bubble + optional
  TTS + tray toast via a Hook (B10); stale → renders as history only, no interruption
  [C §7 expiry semantics + D].
- If we ever add a second delivery channel, the per-client outbox with stable-id keying,
  `seq`, ack-after-handling and bounded size is the pattern to copy [C §7] — not needed
  for v1 with one local client.

### 9.10 A2 write-context tagging

- Add `writeContext: "primary" | "heartbeat" | "flush" | "subagent"` as a **required
  parameter at every turn entry point**, so a new entry point cannot compile without
  declaring it, and default it **fail-closed to the most restrictive value** on any path
  that omits it. Both properties lifted from ZeroClaw's `TurnOrigin` [C §8].
- Thread it into `createAutoMemory(...).onTurnCompleted` — today an unconditional
  fire-and-forget after every turn (`packages/core/src/memory/auto-memory.ts:41-55`).
  **Non-`primary` contexts must not advance the episodic watermark and must not write
  episodes**, otherwise every beat sediments as a conversation
  (`docs/HANDOFF.md:150` states the requirement; ZeroClaw's "scheduled origins always
  exclude Conversation entries" is the external precedent) [C §8].
- Explicit `memory_write` calls *during* a beat are legitimate but must carry
  `origin: heartbeat` in frontmatter — provenance as a first-class field [C §8].
- A silent beat must not append user/assistant rows to the timeline at all; only a
  delivered utterance does. Otherwise the beat inflates `REPLAY_WINDOW` for every
  subsequent real turn ("history stays clean", [C §8]) [D].
- Ship the tag **in T4's wiring**, not T5 — `docs/HANDOFF.md:150` already makes this a
  hard coupling point.

### 9.11 Suggested module layout (anti-sprawl: one concern per file)

```
packages/core/src/heartbeat/
  heartbeat-engine.ts     composition root: tick loop + orchestration
  pre-checks.ts           the ordered chain; each check pure, returns SkipReason | null
  gate-context.ts         thin-context assembly (budgeted; reuses assembler primitives)
  heartbeat-respond-tool.ts   the silence/speak/express terminal tool
  wake-queue.ts           event dedupe + debounce(+ceiling) + coalesce
  utterance-policy.ts     rate budget, quiet hours, class-based override, ignore-backoff
  deferral.ts             queue-of-one, breakpoint release, staleness TTL
```
Seven files, each kept cohesive and near the 300-line baseline; use the roughly 20% tolerance as a review threshold
and split only when responsibilities become coupled or a file materially exceeds that threshold. Every file remains
unit-testable with an injected clock, matching how `activity-state.ts` and `privacy-pause.ts` are already built [D].

---

## 10. OMITTED — ideas I could not source, or that failed verification

- **Any published token-cost figure for a heartbeat turn other than OpenClaw's
  ~100K → 2-5K.** I found compute-reduction *percentages* (PRPF −69.3%, FrugalGPT −98%)
  and a per-hour *call count* (240/hr), but no vendor publishes tokens-per-ambient-turn.
  Do not quote a token number as external fact beyond OpenClaw's.
- **A concrete "max utterances per hour" for a desktop companion.** All sourced numbers
  are promotional mobile push. Our §9.7 defaults are an owner decision anchored to that
  data, not a finding.
- **Backoff-after-ignored as a shipped agent feature.** Sourced only in the push/CRM world
  (Duolingo recency decay; the "eventually stops sending" claim is a tier-3 blog). No agent
  runtime I looked at implements it.
- **Quiet hours or busy-yield in Hermes.** Verified absent by grep of the local clone
  (`quiet_hours|active_hours|do_not_disturb`, `skipWhenBusy` → zero matches). Don't cite
  Hermes for either.
- **The specific `primary|heartbeat|flush|subagent` vocabulary.** The *pattern* is
  corroborated (ZeroClaw `TurnOrigin`); the four-value set including `flush` is ours.
- **The claim that a heartbeat should never call the vision model / take a screenshot.**
  Intuitive, cost-obvious, and consistent with the Sensitivity Tier default, but I found no
  external source stating it as a rule. Treat as an owner decision.
- **"Jitter the beat interval so the pet feels alive."** Pure design intuition. The
  scheduling half (jitter to avoid lockstep with the sampler) is defensible engineering;
  the character half is unsourced.
- **Breakpoint detection from window titles specifically.** OASIS used in-app event streams
  and application plug-ins, not window-title transitions. Our mapping of "activity entry
  ends" → "coarse breakpoint" is a plausible but unvalidated substitution; if it misfires,
  fall back to max-wait only.
- **Tier-2/3 sources used and labelled as such** (do not promote to authority without a
  primary check): dreaming.press, glukhov.org, solana.garden, agentpatternscatalog.org,
  scalablesystem.dev, real-time-websocket.com, pushpilot.ai, businessofapps.com,
  the Medium debounce write-up, the agentic-ai-system-course repo.

---

## Sources

**Peer-reviewed / preprint**
- Proactive Agent (ICLR 2025) — https://arxiv.org/html/2410.12361v3 · https://doi.org/10.48550/arxiv.2410.12361
- ProAgentBench — https://doi.org/10.48550/arxiv.2602.04482
- PRISM (festina lente proactivity) — https://arxiv.org/html/2602.01532v1
- PRPF (pre-reasoning perception) — https://arxiv.org/html/2606.03236
- "Do Proactive Agents Really Need an LLM to Decide When to Wake…" — https://arxiv.org/pdf/2605.30152
- TriggerBench (prospective memory) — https://arxiv.org/pdf/2606.23459v1/__stdout.txt
- FrugalGPT — https://arxiv.org/pdf/2305.05176
- Iqbal & Bailey, OASIS (CHI 2008) — https://interruptions.net/literature/Iqbal-CHI08.pdf · https://dl.acm.org/doi/10.1145/1357054.1357070
- Iqbal & Bailey, breakpoint models (CHI 2007) — https://www.interruptions.net/literature/Iqbal_Bailey-CHI07.pdf
- Pielot, Church & de Oliveira, in-situ notifications (MobileHCI 2014) — https://ic.unicamp.br/~oliveira/doc/MHCI2014_An-in-situ-study-of-mobile-phone-notifications.pdf
- Wohllebe, push frequency field experiment (2021) — https://real.mtak.hu/138580/1/IM_2021_02_Wohllebe.pdf
- Bidargaddi et al., notification timing/frequency — https://pmc.ncbi.nlm.nih.gov/articles/PMC5207732/
- Yancey & Settles, Recovering Difference Softmax (KDD 2020) — https://research.duolingo.com/papers/yancey.kdd20.pdf
- Origin-bound memory authority (TMA-NM) — https://arxiv.org/html/2606.24322

**Product / platform docs (primary)**
- FCM message lifespan — https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-lifespan
- APNs request headers — https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/RemoteNotificationsPG/CommunicatingwithAPNs.html
- Windows Focus assist — https://prod.support.services.microsoft.com/en-us/windows/focus-stay-on-task-without-distractions-in-windows-cbcc9ddb-8164-43fa-8919-b9a2af072382
- iOS interruption levels — https://documentation.onesignal.com/docs/en/ios-focus-modes-and-interruption-levels
- Android ZenPolicy / NotificationManager.Policy — https://developer.android.google.cn/reference/kotlin/android/service/notification/ZenPolicy · .../app/NotificationManager.Policy
- Braze frequency capping / quiet hours / send API — https://www.braze.com/docs/user_guide/messaging/messaging_fundamentals/frequency_capping · .../quiet_hours · https://github.com/braze-inc/braze-docs/blob/develop/_docs/_api/endpoints/messaging/send_messages/post_send_messages.md
- GitHub Actions concurrency — https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
- OpenAI Realtime VAD (`semantic_vad`, eagerness, interrupt_response) — https://developers.openai.com/api/docs/guides/realtime-vad
- Letta sleep-time agents — https://docs.letta.com/guides/agents/architectures/sleeptime/index.md · https://www.letta.com/blog/sleep-time-compute/ · https://deepwiki.com/letta-ai/letta/10.2-sleeptime-agents
- Letta v1 agent loop (heartbeats deprecated) — https://www.letta.com/blog/letta-v1-agent/
- MemGPT system prompt (`send_message` is the only visible action) — https://github.com/cpacker/MemGPT/blob/e1f25305aa2c612f5a117381d08b7671407f1a1e/memgpt/prompts/system/memgpt_chat.txt
- LangChain ambient agents / Agent Inbox — https://www.langchain.com/blog/introducing-ambient-agents · https://github.com/langchain-ai/agent-inbox/blob/bc2702f8/README.md

**Agent-runtime source & issues**
- ZeroClaw PR #8619, `TurnOrigin` provenance — https://github.com/zeroclaw-labs/zeroclaw/pull/8619
- hermes-agent#2654 (conditional cron triggers; closed in favour of `wakeAgent`) — https://github.com/NousResearch/hermes-agent/pull/2654
- hermes-agent#20201 / #13456 (webhook debounce & coalescing) — https://github.com/NousResearch/hermes-agent/issues/20201 · /13456
- Local clone (MIT, patterns only): `references/hermes-agent-main/cron/scheduler.py` — `:288-330` `[SILENT]` tokens + parser; `:2312-2335` `_parse_wake_gate`; `:2688-2761` `no_agent` semantics; `:2859-2879` pre-prompt wake gate; `:337-340` running-job set

**Our repo**
- `CONTEXT.md:24-30` (Proactive Utterance, Heartbeat definitions)
- `docs/HANDOFF.md:150,154` (A2 coupling point; dual-entry settings rule)
- `docs/devlog/m5.md:52,74` (T4 scope line; T1 "model fills space" finding + structural fix)
- `packages/core/src/activity/activity-state.ts:1-6,71-84` · `activity/index.md`
- `packages/core/src/agents/index.md` (chat-agent, turn-queue, turn-registry, untrusted-fence)
- `packages/core/src/memory/auto-memory.ts:41-55` · `memory/index.md`
- `packages/core/src/perception/privacy-pause.ts:1-20`
- `packages/core/src/server/index.md:4,6` (connection-registry, timeline-subscriptions)
- `.trellis/workspace/pleia/m5-proactivity-survey.md` (prior art — §0 above)

---

## 11. Owner clarification: event wake and evolvable interaction patterns (2026-08-27)

This section records the owner discussion recovered from `C:/Users/55473/Desktop/heartbeat.md`. It corrects the
cadence-only wording above and extends the existing typed-checklist decision without creating another Runtime.

### 11.1 Product intent

TakiAgent is not only an automation assistant. Heartbeat is one mechanism for a Companion that can notice meaningful
changes, form a bounded Character-specific judgment, and decide whether to remain silent, express itself, or speak.
Concrete wording is generated from the stable Character Persona plus current user/relationship context; it is not a
stored response template.

The stable/evolvable split is:

```text
stable Soul / Persona
  + evolving user and relationship models
  + bounded Companion State
  + versioned Interaction Patterns
  + current Signals, intentions, and memory
  -> Heartbeat judgment
  -> silent | express | speak
```

The Agent must not treat growth as permission to rewrite its Persona, core safety prompt, or Runtime code.

### 11.2 One wake path for cadence and events

```text
cadence tick / external or internal observation
  -> Signal Provider
  -> normalize + freshness + dedupe + debounce/coalesce
  -> Heartbeat Wake Policy
  -> skip with a named reason, or emit TriggerRequest
  -> RunService -> ChatAgent
  -> heartbeat_respond(silent | express | speak)
```

Examples include a meaningful activity transition, return from idle, due commitment, background/Child Run completion,
or Privacy Pause release. A raw foreground switch is only an observation. It becomes an eligible Signal only after
dwell/freshness/context-transition rules; it never invokes the model directly.

Optional chance is a Pattern-level suppression mechanism after deterministic checks. Use a reproducible decision based
on stable event/pattern/revision inputs so tests and traces can explain the result. Chance can reduce wake frequency but
cannot bypass privacy, quiet hours, cooldown, busy-yield, or Class B budgets.

### 11.3 Interaction Pattern authority

Extend the already-approved typed Core-owned checklist into a Character-scoped Interaction Pattern instead of adding a
parallel interaction-strategy engine. The final schema is an implementation decision, but it must reserve:

- lifecycle: `proposed | active | paused | retired`;
- origin/provenance/evidence and revision;
- Signal/condition inputs and freshness;
- interaction purpose rather than fixed dialogue;
- bounded context references;
- allowed `silent | express | speak` outcomes;
- cooldown/cadence/expiry and optional deterministic chance;
- feedback links, limits, rollback, and Character ownership.

`intention` remains one-shot and expires or is consumed. A recurring Pattern is a reusable habit. The system must not
promote every transient thought or isolated model output into a permanent rule.

Shipped, user-authored, and Agent-proposed Patterns share one typed Core store/API and panel projection. A
Pattern-authoring Skill teaches the Agent to identify repeated evidence, propose or revise conditions/purpose, assess
noise risk, and pause/retire ineffective Patterns. The Skill grants no permission; the Agent cannot directly edit the
database, implementation, Persona, or safety prompt.

User graphs and Hindsight mental models feed a small provider-neutral projection describing stable preferences,
relationship posture, recent relevant changes, and prior interaction feedback. Heartbeat does not load the whole graph
or mechanically turn facts into executable rules.

### 11.4 Delivery stages and reserved evolution

The Heartbeat implementation stage must include or reserve Signal/Wake contracts, typed Pattern storage and Agent/panel
parity, Pattern provenance/revision/lifecycle, context seams for user model/relationship model/Companion State/
intentions, and Run evidence for matched Signals/Patterns and the selected outcome. Default interaction behavior is seed
data rather than `if` branches in the engine.

Full Companion State/self-model maintenance, long-term feedback learning, and automatic Pattern evolution may be split
into later work. They must stay visible in the roadmap so a limited first Heartbeat batch does not become the final
architecture. Long-lived Agent-authored Patterns default to reviewable candidates; a future opt-in automatic mode must
retain global limits, version history, and one-click rollback.
