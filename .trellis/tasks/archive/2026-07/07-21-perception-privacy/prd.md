# T3b Perception (#20): ambient screenshot sampling + privacy controls

## Goal

The high-sensitivity half of perception, plus the privacy controls that make T3a+T3b trustworthy:
ambient screenshot sampling (its OWN grant, default OFF), Privacy Pause, sensitive-process skip,
PII scrubbing, and the activity card. M5 row: "截屏采样(高敏默认关)+ activity 卡 + Privacy Pause +
敏感进程跳过 + PII 脱敏". D44 (unfenced VLM descriptions) closes here.

## Owner-ratified decisions (2026-07-21/26)

1. **Ambient screenshot ships, with its OWN governance cell `screenshot-ambient`, DEFAULT OFF.**
   Separate from the existing on-demand `screenshot` cell because the risk profiles differ
   completely (user-present single frame vs perpetual background capture of whatever is on screen):
   one shared cell would let an "always allow screenshot" grant silently authorize perpetual ambient
   capture — the A1-class escalation T2b exists to prevent. Default OFF means the ambient sampler is
   **not even scheduled** without an explicit enable grant: no capture, no prompt, fully silent
   (Recall off-state; macOS TCC screen-recording-vs-per-app precedent).
2. **Raw ambient frames: USER-CONFIGURABLE retention** — `keep` / `delete after N days` (day
   granularity) / `drop right after describe`. **Factory default = drop-after-describe** (leader-set
   conservative default per "high-sensitivity defaults conservative"; owner may re-set). Retention
   MUST be actually enforced by a sweeper — see Risk R1 (today nothing sweeps screenshot PNGs).
3. **Privacy Pause stops ALL ambient sampling (foreground + ambient screenshot) but NOT on-demand
   chat screenshots** — those remain explicit consent through the Gate. Durations: until-resumed +
   until-tomorrow (Recall shapes).
4. **Sensitive-process skip ships; a hit suppresses BOTH the ambient screenshot AND the T3a window-
   title sample** (a title like "工资表 - 某某银行" leaks by itself; same check, zero extra cost).
   Conservative built-in exe-name list (password managers / banking clients / RDP), user-editable
   later (#26). **Known coverage gap, must be documented, not papered over**: exe-name matching
   cannot catch in-browser sensitive content or incognito (Chrome incognito is still `chrome.exe`;
   Recall only manages this via explicit browser-OS integration we cannot replicate). The real
   backstops remain default-OFF + Pause + PII scrub.
6. **TWO privacy layers over ambient capture, neither replacing the other** (owner-ratified 2026-07-26
   after a leader-found hole):
   - **Layer 1 — deterministic, prevents TRANSMISSION.** The batch-B ambient sampler infers the
     foreground from the entry T3a recorded, but a sensitive sample was DROPPED entirely, so the layer
     still held the last non-sensitive entry — within the staleness tolerance (~60s) the sampler would
     photograph a password manager believing it is still on VS Code. Fix (batch D, mechanism ruled by
     the leader — supersedes the "record a bare timestamp and compare it" proposal this ruling was
     first written with): replace inference-from-absence with the SEAL the activity state already has.
     `ActivityState.seal()` ends the live stretch — `current()` goes undefined and the next sample opens
     a fresh entry — and the activity sampler now calls it on a sensitive hit, exactly as an
     `available:false` sample already did. A sensitive foreground IS that event: the foreground left the
     entry we were tracking. The ambient sampler's existing fail-closed "unknown foreground" guard then
     refuses, with no new state, no new comparison and no new leak surface: `seal()` takes no arguments
     and stores nothing — no process name, no title, no timestamp — so the record of "something
     sensitive was in front" itself carries nothing. Owner ratified closing this because the VLM is a
     REMOTE endpoint — by the time a semantic check could run, the pixels have already left the machine.
     **Self-clearing by construction**: returning to a normal app opens a new entry, so capture resumes
     on the very next tick — no reset, no possibility of a permanent block. Required tests (all landed):
     (a) no capture during a sensitive foreground, driven through the real state + the real foreground
     derivation and RED against the pre-fix code; (b) capture RESUMES immediately after leaving it
     ("must not break normal use", owner); (c) byte-identical behavior when no sensitive app is ever
     seen (zero regression in existing tests). Known consequence, accepted: sealing SPLITS an activity
     stretch, so frequent toggling to a sensitive app can produce sub-dwell fragments that never become
     reportable — this reinforces the dwell-fallback tuning candidate below, which stays untaken.
   - **Layer 2 — semantic, prevents RETENTION/USE.** The mandatory ambient VLM pass doubles as a
     privacy check (`SENSITIVE_SCREEN` structural sentinel, fail-closed) — it catches what an exe-name
     list structurally cannot: in-browser banking, incognito, unexpected sensitive content. On a
     sensitive verdict the frame is discarded regardless of retention, nothing is published, and the
     log carries no description or identity.

5. **PII scrub = deterministic regex, v1 no model**; **scrub-THEN-fence, once at the sense seam**,
   before BOTH prompt and storage; non-bypassable step. Class set from the in-tree MIT
   `hermes/redact.py` (vendor-prefixed secrets, JWT, private keys, DB/URL creds, E.164 phone,
   secure-by-default flag, head/tail mask) + email / credit-card-with-Luhn / IBAN from Presidio;
   per-regex timeout.

## Requirements

* **Privacy Pause** (Core state + WS operator method; UI is #26): a single flag that instantly gates
  every ambient sampler. The T3a foreground sampler currently has NO pause hook (`activity-sampler.ts`
  pushes every available sample) — this task adds it.
* **Sensitive-process skip**: consulted before capture AND before pushing a foreground sample; reads
  the process name the T3a sampler already returns (no new capture). Placement in Core (OS-neutral,
  sample already in hand); Shell placement rejected for v1 (duplicates the list across the WS
  boundary for a marginal "pixels never leave the OS" win — revisit if ambient capture proves it).
* **PII scrub module**: pure, deterministic, unit-tested class set; applied to every sensed string
  (window titles + VLM descriptions) before it can reach a prompt or storage.
* **Ambient screenshot sampler**: own loop modeled on `activity/activity-sampler.ts`; capture → Gate
  (`screenshot-ambient` cell) → VLM describe → scrub → fence → activity layer as TEXT. Inherits the
  T3a ask-over-poll etiquette (at most one dialog per session; deny stops the loop for the session).
  Degrades cleanly when no vision slot is configured (log once, do not spin).
* **Retention enforcement**: ambient frames obey the configured retention; a sweeper actually deletes
  them (extend the existing sweep or route ambient captures through the swept store).
* **Governance**: one new name-keyed `screenshot-ambient` cell in FIXED_RISK + registry count test
  update; `evaluate_by_class` reused unchanged; confirm whether a distinct cell name needs its own
  Shell capability entry or reuses the `screenshot` handler.
* **Activity card**: Core read surface `{ current, recent[], samplingStatus, pauseState }` + a WS
  read/subscribe method modeled on existing subscription precedents. UI at #26.
* **D44 closure**: the VLM description (on-demand AND ambient) reaches prompts only after scrub +
  `fenceUntrusted`.

## Acceptance Criteria

* [ ] Ambient sampling is OFF by default: with no enable grant, the loop is never scheduled — zero
      captures, zero dialogs (unit-tested).
* [ ] Privacy Pause stops the foreground sampler AND the ambient sampler immediately; on-demand
      screenshot still works while paused (unit-tested both directions).
* [ ] A sensitive foreground process suppresses BOTH ambient capture and the title sample
      (synthetic-process-name unit tests).
* [ ] PII scrub removes each configured class before prompt/storage; scrub happens BEFORE fencing
      (ordering asserted).
* [ ] VLM descriptions reach prompts only scrubbed + fenced (D44 closed, RED-provable).
* [ ] Configured retention is enforced by a sweeper: drop-after-describe leaves no file; N-days
      deletes on schedule (unit-tested against a fake clock/fs).
* [ ] `packages/core` stays OS-neutral; all gates green (cargo, clippy -D, shared, core, typecheck, lint).

## Out of Scope

* All settings-panel UI (retention picker, skip-list editor, pause button, activity card view) → #26.
  T3b delivers Core state + WS surfaces only.
* Heartbeat consumption of the activity card → T4.
* **Prompt-side semantics for every injected ambient block → T4's prompt-design pass** (owner
  2026-07-26). T3a/T3b inject a fenced activity block and the time task injects date/time lines, but
  no system-prompt text teaches the agent what they mean or how to use them (use naturally, never
  recite). T3b must NOT invent that wording piecemeal — same ruling that moved the time-awareness
  norms to T4. Also ratified: activity stays PUSH-only (no pull tool; a history-query tool was
  offered and declined).
* Browser-URL capture and in-browser sensitive detection → needs its own ruling (T3a ra §OMITTED);
  the exe-name gap is documented, not solved.
* Model-based (NER) PII detection → deferred; deterministic classes only in v1.

## Tuning candidates (leader-flagged, decide during impl or defer explicitly)

* **Ambient-sampler audit log level**: every successful sample writes three INFO audit lines; over a
  30s poll that is ~360 lines/hour. Consider debug-level for polled successes while keeping the audit
  record (owner observed the volume; no ruling taken).
* **Activity injection dwell threshold**: an entry becomes promptable only after >=2 merged samples
  AND the merge identity includes the FULL window title, so title-churny apps (tab/file switching)
  may never reach the threshold — the agent then sees no activity block at all. Consider an app-level
  dwell fallback. No ruling taken.

## Research References

* [`research/ra-privacy-controls.md`](research/ra-privacy-controls.md) — describe-then-drop pipeline,
  skip-list norms, the hermes/Presidio scrub class set, pause semantics, ambient-vs-on-demand grant
  precedent, activity-card shapes; §OMITTED holds the unsourced (exact list membership, TTL number,
  hard-pause, NER).
* [`research/rb-codebase-frontload.md`](research/rb-codebase-frontload.md) — every seam file:line;
  **R1: screenshot PNGs are written by `screenshot-store.ts` and swept by NOTHING** (the #17 TTL/GC
  only touches content-addressed chat attachments) — ambient capture would pile up forever;
  D44's two unfenced paths (tool result + episodic writer); the T3a sampler's missing skip/pause hooks.
* T3a bank (archived): `.trellis/tasks/archive/2026-07/07-21-perception-activity-layer/research/`.

## Technical Notes

* Anchors: `packages/core/src/activity/` (T3a module + sampler model), `capabilities/screenshot-*.ts`,
  `memory/image-description-writer.ts`, `agents/untrusted-fence.ts`, `gate/governance.rs` FIXED_RISK,
  `media/attachment-store.ts` (sweeper), `server/methods/` (operator method + subscription patterns).
* Owner hard rules in force: every design rule cited (§OMITTED for the rest); provider/environment
  agnostic; conservative privacy defaults; structured errors on every path.
