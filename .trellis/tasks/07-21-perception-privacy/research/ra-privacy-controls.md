# Research: T3b perception privacy controls — ambient screenshot sampling, Privacy Pause, sensitive-process skip, PII scrubbing, activity card

- **Query**: How do comparable ambient-capture systems design (1) screenshot pipelines + raw-frame retention, (2) sensitive-app skip lists, (3) PII scrubbing before LLM/storage, (4) Privacy Pause semantics, (5) ambient-vs-on-demand permission split, (6) the user-facing activity card — mapped onto our Gate / screenshot-store / A1-fence / OS-neutral-Core constraints?
- **Scope**: mixed (repo anchors + local GPLv3/MIT reference repos + exa web)
- **Date**: 2026-07-21
- **Hard rule honored**: every adopted recommendation carries a citation (URL or local `file:line`); unsourced ideas are quarantined in §OMITTED. Provider/vendor-neutral designs only.
- **Builds on** (does NOT re-research): `.trellis/tasks/archive/2026-07/07-21-perception-activity-layer/research/ra-perception-comparables.md` — already cites Recall opt-in/tray/pause/filters, screenpipe deny-globs, ActivityWatch cadence/AFK, BANDORI defaults, the S1/S2/S3 grant shapes. This doc extends into the T3b-specific ground.

## Citation keys

| Key | Source |
|---|---|
| [PRD] | `.trellis/tasks/07-21-perception-privacy/prd.md` (this task) |
| [T3A-RA] | archived T3a comparables research (see "builds on" above) |
| [GOV] | `apps/desktop/src-tauri/src/gate/governance.rs` (local) |
| [FENCE] | `packages/core/src/agents/untrusted-fence.ts` (local) |
| [DESCRIBE] | `packages/core/src/capabilities/screenshot-describe.ts` (local) |
| [SHOT-TOOL] | `packages/core/src/capabilities/screenshot-tool.ts` (local) |
| [ATTACH] | `packages/core/src/media/attachment-store.ts` (local) |
| [ATTACH-CFG] | `packages/core/src/config/attachment-config.ts` (local; `TAKI_ATTACHMENT_TTL_DAYS`, default 14) |
| [ACT-STATE] | `packages/core/src/activity/activity-state.ts` (local) |
| [ACT-SAMPLER] | `packages/core/src/activity/activity-sampler.ts` (local) |
| [ACT-RENDER] | `packages/core/src/activity/render-activity.ts` (local) |
| [SHARED-OUT] | `packages/shared/src/capability-outputs.ts` (local; Foreground/Screenshot output schemas) |
| [D44] | `docs/deferred-decisions.md` D44 (screenshot VLM description not yet fenced) |
| [D43] | `docs/deferred-decisions.md` D43 (activity layer in-memory only, no DB in T3a) |
| [H-REDACT] | `references/hermes-agent-main/agent/redact.py` (local, MIT; deterministic secret/PII redactor) |
| [PRES-YAML] | Presidio default recognizers — https://github.com/microsoft/presidio/blob/main/presidio-analyzer/presidio_analyzer/conf/default_recognizers.yaml |
| [PRES-ENT] | Presidio supported entities (detection method per entity) — https://github.com/microsoft/presidio/blob/main/docs/supported_entities.md |
| [PRES-PAT] | Presidio PatternRecognizer (regex + validate + REGEX_TIMEOUT) — https://github.com/microsoft/presidio/blob/main/presidio-analyzer/presidio_analyzer/pattern_recognizer.py |
| [GITLEAKS] | gitleaks default config (vendor-prefix secret regexes, entropy, allowlists) — https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml |
| [GITLEAKS-BLOG] | "Regex is (almost) all you need" — https://medium.com/gitleaks/finding-secrets-with-regular-expressions-d90493bb3784 |
| [SCRUB-GUIDE] | LLM PII scrubbing layered-defence guide (regex/NER/contextual) — https://sovergate.com/blog/llm-pii-scrubbing-guide |
| [SCRUB-BEFORE] | "Redact before the model call by default" — https://www.eomni.co.uk/pii-in-prompts-detection-redaction-and |
| [SCRUB-GATEWAY] | Redaction as a hard dependency at every outbound hop — https://www.boundev.ai/blog/redact-pii-before-llm-gateway-pattern ; https://philterd.ai/blog/redact-pii-before-sending-to-an-llm/ |
| [SCRUB-CAPTURE] | Pseudonymize at the capture layer (before storage), not review layer — https://www.questa-ai.com/privacy-cafe/pii-data-governance-in-ai-pipelines-a-practical-guide |
| [MS-SIF] | Recall sensitive-information filtering reference (entity list, MCE/NPU, on-by-default) — https://learn.microsoft.com/en-us/windows/client-management/recall-sensitive-information-filtering |
| [MS-FILTER] | Recall app/website/private-browsing filtering + tray filter badge — https://support.microsoft.com/en-us/windows/filtering-apps-websites-and-sensitive-information-in-recall-a4c28bee-e200-4a4a-b60d-c0522b404a5b |
| [MS-MANAGE] | Recall app-filter list uses AUMID or exe name; URI list; RDP clients filtered by default — https://learn.microsoft.com/en-gb/windows/client-management/manage-recall |
| [MS-PAUSE] | Recall pause/resume, tray slash icon, "Pause until tomorrow" auto-resume at 12:00 AM — https://support.microsoft.com/en-us/windows/ai/ai-features/retrace-your-steps-with-recall |
| [SP-RETAIN] | screenpipe retention engine (Media/Lean/All modes, describe-then-strip) — https://github.com/screenpipe/screenpipe/blob/main/crates/screenpipe-engine/src/retention.rs |
| [SP-PRIV] | screenpipe privacy data flow (text redaction at rest, exclude windows, pause) — https://docs.screenpipe.com/privacy-data-flow |
| [SP-ARCH] | screenpipe security architecture (window filtering 1Password/banking, incognito auto-detect, 1–90d retention) — https://screenpipe.com/security/architecture |
| [SP-INTRO] | screenpipe event-driven capture (~90% storage save vs continuous) — https://screenpipe-screenpipe.mintlify.app/introduction |
| [MAC-SCR] | macOS Screen & System Audio Recording control (per-app on/off toggle) — https://support.apple.com/guide/mac-help/control-access-screen-system-audio-recording-mchld6aa7d23/mac |
| [MAC-TCC] | macOS TCC per bundle-id + service; screen-capture vs photos `limited` status — https://github.com/ZachJW34/node-mac-permissions ; https://www.screenify.studio/blog/2026-04-23-macos-screen-recording-permissions |

---

## 1. Ambient screenshot pipelines + raw-frame retention

### How comparables process an ambient capture

- **Change-driven, not fixed-FPS, with a slow idle floor.** screenpipe listens for meaningful events (app switch, click, typing pause, scroll) and captures a frame only when something changes; event-driven capture saves ~90% storage vs continuous recording ([SP-INTRO]). It debounces (`min_capture_interval_ms=200`) and has a 30 s ambient idle floor ([T3A-RA §2.2]). Recall saves "a snapshot… every few seconds and when the content of your active window changes" ([T3A-RA §2.4 / MS-PAUSE]).
- **Capture → structured text → the frame becomes secondary.** screenpipe's pipeline: frame → prefer the OS accessibility tree, fall back to OCR when a11y text is absent/thin/terminal → `frames` row + `ocr_text` + `elements` + FTS index; the raw JPEG is a disk file separate from the searchable text ([SP-ARCH] pipeline; [SP-INTRO]). This is exactly our shape: **the VLM description is the durable artifact, the pixels are the disposable byproduct** — our `screenshot-describe` already returns text and "pixels never reach [the text model]" ([DESCRIBE:1-8]).
- **Retention is tiered and text-outlives-frames.** screenpipe's retention engine defines three modes ([SP-RETAIN]):
  - `Media` (default): keep every DB row (search/timeline/transcripts), reclaim only the mp4/wav/**jpeg files** on disk.
  - `Lean`: reclaim media files AND strip the heavy per-frame text (a11y `elements`, raw AX JSON, `ui_events`) but keep `full_text`/transcripts searchable.
  - `All`: delete frames + transcriptions + ui_events outright.
  Configurable 1–90 days, min 1 day enforced, batch deletion in 1-hour windows, runs every 5 min ([SP-ARCH] Data Retention). The salient pattern: **the derived text is retained longer than (or independently of) the raw frame** — "describe, keep the text, drop the pixels."
- **Recall** stores snapshots locally + encrypted, disk-space-managed, with user delete controls; DRM content is never stored, no continuous video/audio ([MS-FILTER]; [T3A-RA §2.4]).

### How our existing pieces compose (repo facts)

- We already have a **content-addressed screenshot/attachment store with TTL GC**: `save()` (sha256, dedup, mtime = TTL clock), `sweepExpired(ttlMs)` deletes files older than the TTL, `usage()`, `clear()` ([ATTACH:55-77]). TTL is user-editable, default **14 days** (`TAKI_ATTACHMENT_TTL_DAYS`) ([ATTACH-CFG:8,15-19]); main.ts sweeps on a `.unref()` interval ([ATTACH `sweepExpired` note]). Crucially, the store's own header records the design intent: **"Only raw bytes older than the TTL are swept; the description-memory is permanent (decision 9)"** ([ATTACH:73]). That is screenpipe's Media/Lean split already latent in our code: bytes are disposable, description is durable.
- The on-demand `screenshot` tool already routes → gate → `store.save()` → optional `describe()`, and degrades every failure to a structured result, never throwing ([SHOT-TOOL:42-61]).

### Recommendation shape for T3b (details in §7)

Ambient capture should reuse the on-demand path but bias hard toward **describe-then-drop**: capture → gate → VLM describe → **keep the fenced description** in the activity layer, and either (a) never persist the raw frame for ambient samples, or (b) persist it under a much shorter ambient TTL than the 14-day on-demand default, GC'd by the same `sweepExpired` machinery. This mirrors screenpipe Lean/Media and Recall's "text is the product" stance ([SP-RETAIN]; [ATTACH:73]).

---

## 2. Sensitive-app skip lists

### What comparables ship as built-in / default

- **Recall auto-filters some apps for you and filters sensitive info by default.** "Some apps are filtered for you, and sensitive information is filtered by default" ([MS-FILTER]). Concretely: **private-browsing windows are auto-filtered** across Edge/Firefox/Opera/Chrome/Chromium-124+ ([MS-FILTER]; [MS-PAUSE]); **some remote-desktop connection clients are filtered by default** ([MS-MANAGE]); DRM content and Game-Mode video are never stored ([MS-FILTER]).
- **Match key = exe name or AUMID (apps), URI (websites).** Recall's app-filter list "can include Application User Model IDs (AUMID) or the name of the executable file. For example: `code.exe;Microsoft.WindowsNotepad_8wekyb3d8bbwe!App;ms-teams.exe`" ([MS-MANAGE]). Website filtering is a semicolon URI list with scheme; browser-local schemes (`edge://`, `chrome://`) are filtered by default ([MS-MANAGE]). So the canonical match key for a *desktop* skip list is the **executable name** (URL/AUMID are higher-sensitivity extensions, out of scope per [PRD] "Browser-URL capture → own governance ruling").
- **screenpipe ships concrete example targets: password managers + banking.** Its window-filtering control literally reads "Exclude specific apps from capture (e.g., **1Password, banking**). Admin-pushable include/exclude lists. **Incognito window auto-detection** (Safari, Chrome, Firefox)" ([SP-ARCH] Privacy Controls table). Filters are allow/deny globs on app + window + URL ([T3A-RA §2.2]; [SP-PRIV]).
- **No comparable publishes a canonical exhaustive "sensitive app" list**; each ships a small curated default (password managers, banking, private browsing, RDP clients) + a user-editable list. The *sensitive-information filter* (§3, Recall's MCE/NPU classifier) is the content-side complement to the *app skip list*.

### Skip screenshots only, or also window-title sampling (T3a)?

- Comparables gate their *capture* on the skip list, and for these tools "capture" = the screenshot/OCR pipeline. But Recall's app filter is described as operating **"at the window level"** and prevents the app's content from appearing in snapshots ([MS-MANAGE]) — i.e. it suppresses the sensitive surface wholesale, not just a pixel subset.
- Our T3a foreground sampler already treats the window **title** as untrusted content ([SHARED-OUT:70-72]; fenced by [ACT-RENDER:44]). A password manager's or banking app's window title can itself leak (e.g. `"1Password — Chase Visa ••4512"`). The conservative, comparables-consistent reading: **a sensitive-process match should suppress BOTH the screenshot sample AND the T3a window-title sample for that foreground app** (title reduced to a category label or dropped), because the point of the skip is "don't observe this app," not "don't photograph this app." Recommendation in §7; note the T3a sampler currently has no skip hook — it pushes every `available` sample ([ACT-STATE:62-88]).

---

## 3. PII scrubbing before LLM / storage

### Deterministic vs model-based, and where to scrub

- **Industry consensus is a layered defence, deterministic-first:** Layer 1 regex (fast, deterministic, sub-ms, ~100% recall on well-structured PII: email, IBAN, phone, card, IP, secrets — but cannot catch names); Layer 2 NER (names/orgs/locations, 5–50 ms); Layer 3 a small LLM for contextual PII (50–200 ms, high-risk only). "For most production pipelines, Layer 1 + Layer 2 is the right starting point" ([SCRUB-GUIDE]). Presidio itself is regex + checksum + context words + optional NER ([PRES-ENT]; [PRES-PAT]).
- **Scrub BEFORE the model call, by default.** "Short answer: redact before the model call by default. Almost always… Pre-model redaction is the only approach that meaningfully reduces blast radius" ([SCRUB-BEFORE]). Post-model redaction is a documented exception (medical summarization etc.), not the default ([SCRUB-BEFORE]).
- **For agents, scrub at EVERY outbound hop, as a hard dependency, not optional middleware.** A single user turn fans out into many model calls (tool selection, tool outputs fed back, retrieval, synthesis); "the redaction stage has to sit at each outbound model call as a hard dependency in the request path, not… optional middleware someone can bypass" ([SCRUB-GATEWAY]). This is our fence's sibling: sensed content re-enters the prompt on later turns.
- **Also scrub BEFORE storage, at the capture layer** — not only before the prompt. "Pseudonymize log content at the capture layer (before writing to storage), not at the review layer — logs should never contain raw PII" ([SCRUB-CAPTURE]). screenpipe implements exactly this: "text redaction at rest — detected PII is redacted in stored text columns on-device, not only at AI-query time" ([SP-PRIV]). So for us: scrub the VLM description / sampled title **once, at the seam where sensed text is produced**, so both the prompt path and the (D43-deferred) storage path inherit clean text.

### A concrete, citable, OS-neutral deterministic v1 class set

**We already have a shipped, MIT-licensed, regex-only, OS-neutral reference in-tree: [H-REDACT].** It is directly the deterministic Layer 1 the guides prescribe, and it is defensively engineered in ways we want:

- **Secure-by-default, agent-cannot-disable:** the enable flag is snapshotted at import so "runtime env mutations (e.g. LLM-generated `export HERMES_REDACT_SECRETS=false`) cannot disable redaction mid-session" ([H-REDACT:59-68]). Mirrors our "agent can never flip a policy" red line.
- **Class set (all regex, no OS/native deps → invariant 8 safe):**
  - Vendor-prefix API keys/tokens — 40+ prefixes (`sk-`, `ghp_`, `AKIA…`, `AIza…`, `xox[baprs]-`, `sk_live_`, JWT `eyJ…`, etc.) ([H-REDACT:71-113, 259-264]). Same family as gitleaks' prefix rules ([GITLEAKS]; the gitleaks "identifier + operator + secret" regex structure is documented in [GITLEAKS-BLOG]).
  - ENV/JSON/YAML/dotted config secrets (`API_KEY=…`, `"apiKey":"…"`, `password: …`) with false-positive carve-outs for `os.getenv(...)` code refs ([H-REDACT:115-182, 550-593]).
  - Authorization / `x-api-key`-style headers ([H-REDACT:196-211]).
  - Private-key PEM blocks ([H-REDACT:220-222]).
  - DB connection-string passwords `proto://user:PASS@host` ([H-REDACT:232-235]).
  - **E.164 phone numbers** `+<country><7-15 digits>` ([H-REDACT:266-268, 674-680]).
  - `mask_secret()` head/tail masking (keep 4+4, floor 12) so masked text stays debuggable / coherent ([H-REDACT:309-353]) — the "partial redaction / consistent placeholder keeps model coherence" point from [SCRUB-GATEWAY].
- **Missing from [H-REDACT] but standard in Presidio/gitleaks and cheap to add deterministically:** email addresses (Presidio `EmailRecognizer`, RFC-822 validation [PRES-ENT]), **credit-card numbers with Luhn checksum** (Presidio `CreditCardRecognizer`, "pattern match and checksum" [PRES-ENT] — checksum kills false positives), IBAN, IP/MAC, crypto addresses ([PRES-YAML] recognizer list). Presidio guards regex with a per-pattern `REGEX_TIMEOUT` to avoid catastrophic backtracking ([PRES-PAT]) — a hardening we should copy for untrusted screen text.
- **What comparables treat as "sensitive info" content classes** (for parity, Recall's on-device MCE list): passwords/"General Password", credit-card numbers, national IDs, bank account numbers, SSN/ITIN/NINO, IBAN/SWIFT, tax IDs, driver's licence numbers, Azure/cloud secret/connection strings ([MS-SIF]). This is a superset; our v1 should cover the **high-frequency, deterministically-detectable** subset: emails, credit cards (Luhn), phone (E.164), API keys/secrets/JWT, private keys, DB/URL credentials, and a "General Password"-style `password=…` catch — all present or trivially addable in [H-REDACT] + [PRES-ENT].

### Interaction with the A1 untrusted-content fence

- Our fence wraps sensed text in `<untrusted-observation>` and neutralizes fence-breakout ([FENCE:19-25]); D44 requires the screenshot VLM description to route through it when this task touches the describe pipeline ([D44]). **Scrub INSIDE the fence boundary but BEFORE fencing** — i.e. produce description/title → scrub PII → `fenceUntrusted(scrubbed)`. Rationale: the fence is a *labelling* control (data-not-instructions), scrubbing is a *content-minimization* control; they are orthogonal and compose as scrub-then-fence. Scrubbing first also means the redaction placeholders (`***`, `«redacted:sk-…»`) are what the model and any future store ever see — matching "scrub at capture, both paths inherit" ([SP-PRIV]; [SCRUB-CAPTURE]).

---

## 4. Privacy Pause semantics

### Precedents

- **Recall pause is a first-class, one-click, duration-shaped control with a visible state.** "Select the Recall icon in the system tray and select **Pause until tomorrow**. Snapshots will be paused until they automatically resume at **12:00 AM**." The tray icon shows a **slash** while paused; manual resume requires Windows Hello re-auth ([MS-PAUSE]). So the shipped duration shapes are: **until-tomorrow (auto-resume at local midnight)** and **manual resume**; the full off is a separate Settings toggle ([MS-PAUSE]; [T3A-RA §2.4]).
- **macOS** shows a persistent capture indicator whenever any app records the screen; the grant itself is a standing per-app toggle ([T3A-RA §3]; [MAC-SCR]).
- **screenpipe** exposes "pause or stop capture" as an app control ([SP-PRIV]).
- Our own survey mandates the pair: "敢看"必配"能停" — Privacy Pause is the named mitigation ([PRD "What I already know"]; [T3A-RA §1.1 SURVEY:371-372]).

### Scope question: ambient only, or also agent-initiated captures?

- Comparables draw the pause boundary around the **ambient/background** capture (Recall pause stops *snapshots*; the user can still take a manual "Now" snapshot in the Recall window, which is an explicit user action [MS-PAUSE]). There is no precedent for a background-pause blocking a foreground, user-solicited screenshot — those are different consent events.
- Applied to us: the user typing "take a screenshot" in chat is an **explicit, in-the-moment consent** that already crosses the Gate approval flow ([SHOT-TOOL]; [GOV] screenshot cell `{Ask,Ask,Auto}`). Privacy Pause is about **withdrawing the standing consent to be observed in the background.** The comparables-consistent design: **Privacy Pause gates ALL ambient sampling (foreground-window sampler + ambient screenshot sampler) but does NOT gate an agent's on-demand chat screenshot** — that request still hits the ordinary Gate, where the user can approve or deny in context. (If the owner wants a bigger hammer, a second "hard stop everything incl. on-demand" is a strict-Level option — flagged, not defaulted; §OMITTED.)
- **Duration shapes to offer** (all sourced): until-resumed (manual), until-tomorrow / until-local-midnight (Recall's shape [MS-PAUSE]). "For-N-hours" is a reasonable generalization of until-tomorrow but **no surveyed system ships a fixed-N-hours pause** — treat as a nice-to-have, mark derived (§OMITTED).
- **Implementation seam:** the T3a sampler already stops itself on `DENIED` and skips ticks under backoff / no-node ([ACT-SAMPLER:61-98]). Pause is the same "don't sample this tick" gate but *reversible* and *global*: a Core-owned pause flag that (a) the foreground sampler checks in `tick()` before routing, and (b) the ambient screenshot sampler checks likewise. Unit-testable per [PRD] AC ("Privacy Pause stops all perception sampling immediately").

---

## 5. Ambient-vs-on-demand permission split

### Precedents for two distinct grants

- **Recall is a separate opt-in from the OS screenshot APIs.** Any Windows app can call the screenshot/Snipping APIs; Recall's ambient snapshotting is a *separate*, off-by-default opt-in with its own consent, its own tray presence, and its own settings page ([MS-PAUSE] "you need to opt in to saving snapshots"; [MS-FILTER]). "Take a screenshot now" (Snipping Tool / an app's capture) and "let the system snapshot me continuously" (Recall) are governed independently. This is the exact analog of our split.
- **macOS TCC distinguishes capability grants and even offers a *limited* tier.** Screen Recording is one standing per-app toggle ([MAC-SCR]; [MAC-TCC]); the Photos permission has an explicit **`limited`/`PHAuthorizationStatusLimited`** status where the user picks *which* items an app may see ([MAC-TCC] node-mac-permissions: "`limited` — currently only applicable to the `photos` type"). So OS precedent has both (a) *different capabilities get different grants* and (b) *the same capability can carry a narrowed scope*. The mapping onto our model: **"agent may screenshot when I ask" and "the system may ambiently sample my screen" are two different capabilities/cells, not one capability at two scopes.**

### Mapping onto our per-cell governance registry

- Today `screenshot` is a single name-keyed FIXED_RISK cell `{strict:Ask, standard:Ask, relaxed:Auto, persist:true}` ([GOV:99, 96-110]). The registry is explicitly extensible: "Adding a capability = declare its descriptor… and list it in `factory()`" ([GOV:112-116]) — the same one-line pattern used to add `foreground-window` in T3a ([GOV:107]).
- **Recommendation (detail §7): register a SECOND name-keyed cell, e.g. `screenshot-ambient`, distinct from the on-demand `screenshot` cell.** This lets a user allow chat screenshots while denying ambient capture (or vice-versa), which is the whole point of the Recall/TCC split ([MS-PAUSE]; [MAC-TCC]). The factory posture should be *stricter than on-demand and OFF-by-default*: ambient observation is the high-sensitivity opt-in ([PRD] "DEFAULT OFF, opt-in"; Recall off-by-default [MS-PAUSE]). Because it is polled, it inherits T3a's ask-over-poll composition (first tick raises one session/always dialog; deny → stop for the session; `persist:true` makes an "always" a de-facto standing toggle) ([GOV:103-107]; [T3A-RA §3 S2]; [ACT-SAMPLER:70-76]). "Default OFF" is stronger than "Ask": it means the ambient *sampler is not even scheduled* until an explicit enable grant exists — the Recall model where "off has no tray icon and takes no snapshots" ([MS-PAUSE]; [T3A-RA §3]).

---

## 6. Activity-card shapes

### What recorders expose as the "what was I doing" surface

- **Recall = a scrollable timeline** of snapshots with search; the user-facing state also includes the tray icon's mode (saving / paused-with-slash / filter-badge) ([MS-PAUSE]; [MS-FILTER]). The *status* affordance (am I being recorded? is it paused? is it filtered right now?) is as much part of the surface as the history.
- **ActivityWatch = a dashboard** of per-bucket events (`app`, `title`, duration) with category breakdown, computed at read time ([T3A-RA §2.1, §4]).
- **screenpipe** = a searchable timeline + status/pause controls in-app ([SP-PRIV]).

### Our existing "card" is a fenced prompt block, not yet a UI card

- T3a's `renderActivityContext` already emits a compact **"Now: … / Earlier: …"** block (current live entry + up to 3 recent, with idle markers), fenced as untrusted ([ACT-RENDER:26-44]). That is the *agent-facing* card. The activity `state` exposes `entries()` + `current()` ([ACT-STATE:32-39]); history is in-memory only (no DB — [D43]).
- **Minimal companion card shape (sourced-minimal):** the smallest surface that covers the comparables' three concerns is `{ current, recent[], samplingStatus, pauseState }`:
  - `current` + `recent[]` — the "what was I doing" timeline slice (Recall/AW timeline [MS-PAUSE][T3A-RA §4]); we already have these from `current()`/`entries()` ([ACT-STATE]).
  - `samplingStatus` — is ambient sampling on/off, and which tiers (foreground-only vs +screenshot); the Recall/macOS "is it observing" indicator norm ([MS-PAUSE]; [T3A-RA §3]).
  - `pauseState` — paused? until when? (Recall's slash-icon + "until tomorrow" [MS-PAUSE]).
  Delivered as a Core state + WS surface now; the panel/tray UI is #26 ([PRD] Out-of-Scope: "Settings-panel UI → #26; T3b builds Core state + WS surfaces only").

---

## 7. §Recommendations (mapped to our constraints)

Constraints recap: inv.1 (sampling = capability over the Gate), inv.2 (Core single writer), inv.7 (pluggable module + one registry line), inv.8 (Core OS-neutral; Windows specifics in apps/desktop); existing screenshot store + describe bridge + A1 fence; D44 closes here; activity layer is in-memory ([D43]).

| # | Topic | Ranked v1 recommendation | Source / derivation |
|---|---|---|---|
| R1 | Ambient screenshot pipeline | **Describe-then-drop.** Ambient tick → gate → capture → VLM `describe()` → keep the **fenced, scrubbed description** in the activity layer; raw frame either not persisted for ambient samples, or persisted under a **short ambient TTL** (« the 14-day on-demand default) GC'd by the existing `sweepExpired` ([ATTACH:60-74]). "Text is the durable artifact, pixels are disposable." | screenpipe Media/Lean (strip media, keep text) [SP-RETAIN]; Recall text-derived-from-snapshot [MS-PAUSE]; our own "description-memory is permanent, bytes swept" [ATTACH:73]; pixels-never-reach-model [DESCRIBE:1-8] |
| R2 | Ambient cadence | Reuse T3a's **30 s** default poll for the ambient screenshot sampler too (operator-configurable); consider change-driven skip (only describe when the foreground entry changed) to cut cost. | 30 s ambient floor [T3A-RA §2.2, SP-CAP]; change-driven capture ~90% cheaper [SP-INTRO]; T3a poll default [ACT-SAMPLER config] |
| R3 | Raw-frame retention default | Ambient frames: **describe-then-delete** (retain 0 raw bytes by default), OR a short user-editable TTL (e.g. a new `TAKI_AMBIENT_SHOT_TTL_*`) far below the 14-day attachment TTL. Never let ambient frames ride the 14-day on-demand clock. | screenpipe 1–90d, min 1d, default-Media reclaims frames [SP-ARCH][SP-RETAIN]; conservative-default owner rule [PRD]; existing TTL/GC machinery [ATTACH-CFG] |
| R4 | Sensitive-process skip | A **built-in default exe-name skip set** (password managers, banking, private-browsing/incognito, RDP clients) + user-editable list (panel #26), match key = **executable name** (case-insensitive), consulted in the sampler BEFORE any capture. Skip suppresses **both** the ambient screenshot AND the T3a foreground-title sample for that app (title → category label or dropped). | Recall auto-filters apps/private-browsing/RDP, key = exe/AUMID [MS-FILTER][MS-MANAGE]; screenpipe "1Password, banking" + incognito auto-detect [SP-ARCH]; title is untrusted/leaky [SHARED-OUT:70-72]; window-level suppression [MS-MANAGE] |
| R5 | PII scrub — technique | **Deterministic regex v1** (Layer 1), no model. Adopt [H-REDACT]'s in-tree class set (vendor-prefix secrets/JWT/private-keys/DB-&-URL creds/auth-headers/E.164 phone, secure-by-default snapshot flag, head/tail `mask_secret`) rewritten to our TS/kebab conventions, PLUS email + credit-card-with-Luhn + IBAN/IP from Presidio's set; wrap each regex with a match timeout. | Layer-1-first consensus [SCRUB-GUIDE][SCRUB-BEFORE]; in-tree MIT reference [H-REDACT:71-268]; Luhn/RFC-822 validation [PRES-ENT]; regex timeout guard [PRES-PAT]; Recall content classes [MS-SIF] |
| R6 | PII scrub — placement | **Scrub once at the sense seam, scrub-then-fence, before both prompt and any store.** Order: produce description/title → scrub → `fenceUntrusted(scrubbed)` → prompt. Same scrubbed text is what any future activity store persists. Scrub is a **hard, non-bypassable step** on the sensed-text path (not optional middleware). | Scrub-before-prompt default [SCRUB-BEFORE]; scrub-at-capture-before-storage [SCRUB-CAPTURE][SP-PRIV]; hard-dependency-at-every-hop [SCRUB-GATEWAY]; fence is a separate labelling control [FENCE][D44] |
| R7 | Privacy Pause — scope | One Core-owned pause flag stops **all ambient sampling** (foreground + ambient screenshot); it does **NOT** gate on-demand chat screenshots (those keep hitting the ordinary Gate). Sampler `tick()` checks the flag before routing. | Recall pause stops snapshots but "Now" manual snapshot still allowed [MS-PAUSE]; on-demand = explicit in-context consent [SHOT-TOOL][GOV]; existing per-tick gating seam [ACT-SAMPLER:88-98] |
| R8 | Privacy Pause — durations | Offer **until-resumed (manual)** + **until-tomorrow (auto-resume at local midnight)**; "for-N-hours" optional/deferred. | Recall's two shipped shapes [MS-PAUSE]; N-hours unsourced (§OMITTED) |
| R9 | Ambient-vs-on-demand split | **Second name-keyed governance cell `screenshot-ambient`**, distinct from on-demand `screenshot`, added via one `factory()` line; DEFAULT OFF (sampler not scheduled without an explicit enable grant), stricter than on-demand; inherits ask-over-poll (session/always → standing toggle; deny → stop). | Recall separate opt-in from screenshot APIs [MS-PAUSE][MS-FILTER]; macOS TCC per-capability + `limited` tier [MAC-TCC]; registry one-line-add pattern [GOV:107,112-116]; ask-over-poll [T3A-RA §3 S2][ACT-SAMPLER:70-76] |
| R10 | Activity card | Core state + WS surface exposing `{ current, recent[], samplingStatus, pauseState }`; agent-facing render stays the fenced "Now/Earlier" block. Panel/tray UI deferred to #26. | Recall timeline + status/pause indicator [MS-PAUSE]; AW dashboard [T3A-RA §4]; existing render + state [ACT-RENDER][ACT-STATE]; UI-out-of-scope [PRD] |
| R11 | D44 closure | Route the screenshot VLM description (on-demand tool result AND ambient) through `fenceUntrusted` (after scrub, R6). RED-provable per [PRD] AC. | [D44]; [FENCE]; [SHOT-TOOL:47-56]; [PRD] AC "VLM description reaches prompts only inside the A1 fence" |

---

## 8. §OMITTED (thought of, could not source — quarantined)

- **Exact ambient-frame TTL number / "keep N minutes"**: no comparable publishes a raw-frame retention figure for a *companion-agent ambient tier*; screenpipe's 1–90d is for a full recorder, our on-demand default is 14d. The "short ambient TTL / describe-then-delete" *direction* is sourced ([SP-RETAIN][ATTACH:73]); any specific minutes/days number is owner-tunable, not sourced.
- **"For-N-hours" pause duration**: a generalization of Recall's until-tomorrow; no surveyed system ships a fixed-N-hours pause. Until-resumed and until-tomorrow ARE sourced ([MS-PAUSE]).
- **A "hard pause" that also blocks on-demand chat screenshots**: proposed as a possible strict-Level option, but no comparable pauses a foreground user-solicited capture — unsourced; do not default it.
- **Exact built-in skip-list membership** (which specific password-manager/banking exe names): comparables name categories + examples ("1Password, banking", RDP clients) [SP-ARCH][MS-MANAGE] but publish no canonical exhaustive list; the concrete default set is a curation decision, only the *categories* and *exe-name match key* are sourced.
- **Suppressing the title sample (not just the screenshot) for a skipped app**: derived from Recall's "window-level" wholesale suppression [MS-MANAGE] + our title-is-untrusted stance [SHARED-OUT:70-72]; no comparable explicitly states "a screenshot skip also drops the separate window-title telemetry stream" because comparables don't have a separate low-sensitivity title stream — the linkage is our composition, flagged for owner ruling.
- **Whether ambient PII scrub should also run a Layer-2 NER for names**: the layered guides recommend it ([SCRUB-GUIDE]), but NER needs a model (spaCy/transformers) that would violate the OS-neutral, zero-LLM, deterministic-supply posture of the activity layer; recommended DEFERRED — v1 stays deterministic (R5), NER is a later hardening. (Direction sourced; the deferral is our call.)
- **Model-based (Layer-3) contextual PII on screen text**: sourced as high-risk-only [SCRUB-GUIDE]; explicitly not v1.
