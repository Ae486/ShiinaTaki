# Research: Configuration readiness and runtime application

- Query: Remove configuration startup blockers and identify each setting's actual runtime application boundary.
- Scope: Original 2026-11-09 consumer research, retained as the baseline; current implementation/evidence is recorded below.
- Date: 2026-11-09.
- Authority: Simpler local use, empty/incomplete startup and runtime updates; installation is not a prerequisite and the 31 restart rows are not deferred wholesale. Accepted precedence: **application-saved values > environment supplementation for unconfigured fields > defaults**.
- Workspace: `H:/TakiAgent-worktrees/t4`, including existing uncommitted work. This researcher changed only this file.

## Findings

Implementation update (2026-11-10): all 84 settings have a consumer boundary in `config/config-application.ts`.
The registry now has 83 ordinary live rows and one bootstrap-only data root. Actual application metadata distinguishes
immediate, next Run/operation, component, maintenance, external and inapplicable behavior; a generic live label
does not claim a provider call succeeded. Model profiles, optional-policy isolation, privacy/retention, Local/Legacy
index replacement and listener replacement are implemented and covered by `delivery-20261110.md` and its linked
checks. Canonical BM25 is inapplicable. Per the owner's 2026-11-10 correction, Hindsight internal connection/index/
retention application remains reserved, with explicit observations and the dedicated change inventory.

The numbered table and source line references below describe the preimplementation baseline and required behavior.

Baseline inventory: **84 rows: 31 restart, 52 live, one environment-only**. Counts were executed by the parent; this pass inspected every row family and its consumer families. `live` does not prove immediate application; Hindsight setup cannot transparently replace an active connection. Paths below are relative to `packages/core/src/` unless prefixed with `packages/`, `apps/` or `.trellis/`.

Bootstrap constructs a fixed model before WS (`boot/core-bootstrap.ts:67`, `:87`); `main.ts:238` calibrates slot `main`, `:445` freezes Run model identity and `:513` injects the boot model into ChatAgent. `memory/runtime-composition.ts:62` constructs Utility/Memory consumers. Sparse writes alone cannot update these captures.

### Existing contracts to preserve and extend

- `config/config-source.ts:76`, `:80` and `config/config-writer.ts:43`, `:49`, `:66`: replace environment-first/locked behavior while preserving sparse reset, Core ownership and secret isolation; no duplicate settings file or plaintext keys.
- `config/config-writer.ts:70`, `boot/core-bootstrap.ts:96`: observers cannot undo committed writes. Project **stored**, **active** and **application pending/failed** separately.
- `agents/chat-agent.ts:72`, `:95`; `harness/run-service.ts:109`: capture once at Run admission, including retries. New Run usually means the next message in the same timeline, not a new conversation.
- `memory/runtime-composition.ts:77`: preserve captured Memory authority, provider lifetime and scheduler; do not reconstruct Core for a scalar update.
- `memory/utility-slot.ts:48`: retain one background chain and usage owner; new operations capture new handles.

## Complete matrix for the 31 restart-labelled settings

Keys omit `TAKI_`. **New Run/operation** captures once at admission and retains policy through queueing, retries, continuation and all batches/SDK steps. The matrix specifies target behavior, not completed implementation.

| # | Key | Current production evidence | Proposed application boundary and necessary behavior |
| --- | --- | --- | --- |
| 1 | `LOG_LEVEL` | `config/knob-registry.ts:127`; `logging/logger.ts:17`; root and child loggers are pino instances | Immediate root-logger update; retain instances and verify child propagation. |
| 2 | `PROVIDER_BASE_URL` | `config/provider-factory.ts:14`; `boot/core-bootstrap.ts:87` | New Main Run captures one complete endpoint/model/auth profile revision. |
| 3 | `PROVIDER_API_KEY` | `config/provider-config.ts:10`; `config/config-source.ts:80` | New Run captures a private Secret Catalog binding; optional no-auth is valid; never return keys. |
| 4 | `PROVIDER_MODEL` | `main.ts:445`; `harness/run-service.ts:120` | New Run: dispatch, stored identity, capabilities and usage describe the same revision. |
| 5 | `UTILITY_BASE_URL` | `config/utility-config.ts:32`; `memory/utility-slot.ts:44` | New background operation captures the explicit profile; retain the single Utility queue. |
| 6 | `UTILITY_API_KEY` | `config/utility-config.ts:11`; `memory/utility-slot.ts:81` | Secret-backed optional auth; incomplete explicit Utility must not spend on Main. |
| 7 | `UTILITY_MODEL` | `memory/utility-slot.ts:44`; `memory/runtime-composition.ts:62` | New operation: distinguish explicit profile, inherit-Main and disabled. |
| 8 | `PROVIDER_INCLUDE_USAGE` | `config/provider-factory.ts:20` | New Main binding; omit the provider option entirely when false. |
| 9 | `PROVIDER_CONTEXT_TOKENS` | `main.ts:238`; `agents/window-calibrator.ts:42` | New Run; model-specific calibration and context policy; reject late samples for a superseded binding. |
| 10 | `UTILITY_CONTEXT_TOKENS` | `memory/runtime-composition.ts:134` | New background operation; derive its limits from the selected Utility/Main model. |
| 11 | `CONTEXT_HISTORY_RATIO` | `main.ts:244` | New Run; retain policy through preparation/retry without changing stored history. |
| 12 | `COMPACT_TRIGGER_RATIO` | `main.ts:585`; `memory/runtime-composition.ts:179` | Next eligibility check; admitted compaction retains policy; align inline and detached consumers. |
| 13 | `COMPACT_KEEP_MESSAGES` | `memory/runtime-composition.ts:179`; `config/context-config.ts` | New compaction operation; preserve source span, checkpoints and Character chain. |
| 14 | `MAX_STEPS` | `main.ts:522`; `agents/chat-agent.ts:160` | New Run; queued/admitted work and retries keep their cap without restarting. |
| 15 | `PROMPT_DIR` | `memory/persona-provider.ts:24`; `:27`; `:37` | Prepare/reload persona producer for new captures; retain old text/attribution, Memory authority and no health-test gate. |
| 16 | `MEMORY_PINNED_BUDGET` | `memory/memory-engine.ts:127`; `memory/canonical-local-runtime.ts:100`; `memory/hindsight/hindsight-memory-runtime.ts:35` | Next uncaptured assembly/Run; retained captures stay immutable; no stored-fact rewrite. |
| 17 | `MEMORY_TIDY_WRITE_THRESHOLD` | `memory/tidy-pass.ts:68`, `:71` | Next trigger evaluation; preserve operation ownership, coverage and one maintenance queue. |
| 18 | `MEMORY_TIDY_MAX_STEPS` | `memory/tidy-pass.ts:150`; `memory/hindsight/hindsight-policy-curator.ts:49` | New maintenance operation; all batches retain limits; reuse curator capture pattern. |
| 19 | `MEMORY_TIDY_STALE_DAYS` | `memory/tidy-report.ts:61`; `memory/tidy-coverage.ts:28` | Next trigger/review capture; retain admitted workset. |
| 20 | `MEMORY_TIDY_REPORT_CAP` | `memory/tidy-report.ts:101`; `memory/hindsight/hindsight-policy-curator.ts:76` | New maintenance operation; preserve complete duplicate groups, partial results and coverage. |
| 21 | `MEMORY_TIDY_BATCH_TIMEOUT_MS` | `memory/tidy-pass.ts:123` | Capture per operation; each batch starts its deadline excluding queue time; existing deadlines do not slide. |
| 22 | `MEMORY_TIDY_INPUT_TOKENS` | `memory/tidy-pass.ts:144`; `memory/runtime-composition.ts:138` | New operation; derive clamp from its model window, preserving configured and effective values separately. |
| 23 | `AMBIENT_SCREENSHOT` | `perception/perception-layer.ts:158`; `perception/ambient-screenshot-sampler.ts:287`; `main.ts:692`, `:708` | Immediate existing-owner toggle; stop schedules/retire late evidence; update readiness; preserve Privacy Pause and denial. |
| 24 | `ATTACHMENT_TTL_DAYS` | `main.ts:248`, `:734`; `media/attachment-store.ts:107`; `media/attachment-gc.ts:12` | Next read/sweep; shorter TTL can expire existing raw files; preserve in-use leases; extension cannot restore bytes. |
| 25 | `AMBIENT_SCREENSHOT_RETENTION` | `perception/perception-layer.ts:174`; `perception/ambient-shot-gc.ts:29`; `main.ts:710` | Reconfigure one sampler/GC owner; keep-to-expiry starts cleanup, reverse stops it; preserve protected frames and report existing-file effects. |
| 26 | `MEMORY_INTENTIONS_DEFAULT_DAYS` | `memory/retention-sweeper.ts:95`; `memory/canonical-layer-policy.ts:26`; `memory/canonical-local-runtime.ts:49` | New writes/fallback sweeps; retain explicit canonical expiresAt; Legacy no-expiry fallback affects existing rows. |
| 27 | `MEMORY_BM25_WEIGHTS` | `db/memory-repo.ts:111`, `:147`; `memory/memory-engine.ts:118`; `db/canonical-memory-sparse-repo.ts:34` | Next Legacy search uses replaced prepared query. Canonical fixed BM25 and Hindsight native ranking are inapplicable; report this. |
| 28 | `MEMORY_STOPLIST` | `memory/memory-engine.ts:120`; `memory/canonical-local-runtime.ts:85`; `memory/hindsight/hindsight-runtime-state.ts:81` | Managed derived-index/tokenizer publication from authority; update readers/writers together, including old Run tools; use canonical rebuild. |
| 29 | `TRUST_LOOPBACK_OPERATOR` | `main.ts:498`; `server/methods/connect.ts` | Next authentication; token revocation is separate. Verified local application enrollment must not rely on broad loopback trust. |
| 30 | `WS_HOST` | `config/knob-registry.ts:119`; `main.ts:757` | Controlled listener replacement/discovery/reconnect; preflight bind, retain old listener on failure, preserve local restrictions. |
| 31 | `WS_PORT` | `config/knob-registry.ts:126`; `main.ts:757` | Same host/port transaction; cover occupied port/lost ACK/unknown outcomes; reconnect never repeats effects automatically. |

### The environment-only row

`TAKI_DATA_DIR` selects database/Workspace/identities before storage opens (`boot/core-bootstrap.ts:49`; `config/knob-registry.ts:129`). It remains an environment/bootstrap migration/reopen exception, not grounds to defer ordinary hot updates.

## Accepted source precedence and compatibility

Resolve ordinary settings by application presence, permitted environment fallback, then default. Environment no longer locks saves. Expose provenance; retain the data-root exception.

| Input or action | Required interpretation |
| --- | --- |
| Application value is `false` or schema-valid `0` | It is present and wins over environment/default. Test row/field presence, never JavaScript truthiness or `value || fallback`. A present zero rejected by that setting's schema is invalid, not missing. |
| Application string is empty | Follow the field contract. A valid empty prompt is an explicit winning value. An empty required connection field makes the saved draft incomplete. Neither case authorizes silently substituting an environment value for the authored field. |
| Application field is absent | Environment may supply that field, subject to normal parsing and the profile's source/disable policy; otherwise use its default. Environment empty/unset handling is explicit per field, rather than a universal truthy test. |
| Main or explicit Utility profile is disabled | Persist an explicit disabled state that suppresses environment resurrection. Utility disabled, Utility inherit-Main and incomplete explicit Utility are distinct states; none may be inferred from an empty string alone. |
| User deliberately clears a secret or selects unauthenticated mode | Persist the profile's explicit no-secret/clear intent without a plaintext value. Suppress fallback to an old environment API key. Never convert deliberate clearing into a failed key lookup followed by environment reuse. |
| User resets a setting/field to environment/default | Remove its application override and, where applicable, its explicit suppression marker. This deliberate reset can expose the environment value again and must be named distinctly from disable/secret clear. Existing scalar `config.set(value: null)` can retain reset semantics; use an explicit typed action/state for suppression rather than overloading null. |
| User saves an incomplete model draft | Preserve the authored fields and source selections, but keep the applied profile revision unchanged. Draft persistence does not activate a partially merged profile or new environment fallback. |

### Existing profiles and restart behavior

- Preserve sparse rows, profiles and encrypted secret bytes/references. Missing application fields retain environment compatibility; do not import the whole environment or seed defaults.
- Stored/environment conflicts intentionally change to application-first. Keep stored overrides and report provenance; do not delete them to preserve old environment precedence.
- Legacy application URL/model may use an environment key for a genuinely missing field only when that credential source belongs to the effective endpoint. Follow the design's adoption rule: adopt complete application-first candidates without another save; expose incomplete/source-mismatched candidates without copying an old endpoint's key, placeholder credentials or migration-time paid tests.
- Persist disable/clear intent explicitly. Legacy absence does not imply disable. Preserve reset compatibility and round-trip `false`, valid `0` and valid empty strings.
- Persist draft separately from applied revision. Restart locally reprepares the applied revision/source/secret policy, never promotes a newer incomplete draft or requires a network-health test. Failed preparation preserves the record/draft and reports unavailable.
- Resolve restart-time environment supplementation coherently and reflect actual identity/source. Never partly overwrite an applied profile or conceal endpoint/key mismatch.

## Coverage of all 52 live-labelled rows

All 52 live rows are listed by family below. Consumers were inspected; this is not exhaustive runtime verification.

| Family and count | Keys, omitting `TAKI_` | Production evidence and current application boundary |
| --- | --- | --- |
| Initiative wake, 8 | `INITIATIVE_TARGET_CHARACTER`, `INITIATIVE_PERIODIC_ENABLED`, `INITIATIVE_EVENTS_ENABLED`, `INITIATIVE_CHECK_INTERVAL_MS`, `INITIATIVE_MODEL_CADENCE_MS`, `INITIATIVE_JITTER_RATIO`, `INITIATIVE_QUIET_START`, `INITIATIVE_QUIET_END` | `config/initiative-wake-config.ts:10`; `config/initiative-wake-knobs.ts:12`; `initiative/pattern-composition.ts:60`, `:65`, `:90`. Live reader plus config-change invalidation. Existing source/quiet-hours windows, not a new scheduler. |
| Intention limit, 1 | `INITIATIVE_INTENTION_MAX_WINDOW_MS` | `main.ts:509`; `config/initiative-intention-config.ts:19`. Applies to newly formed windows; existing deadlines do not slide. |
| Child check-ins, 2 | `SUBAGENT_CHECKIN_STEPS`, `SUBAGENT_CHECKIN_PARENT_APPROVALS` | `main.ts:660`; `config/subagent-config.ts:21`. New work/next check-in interval. Existing user-required waits remain required. |
| Initiative master switch, 1 | `INITIATIVE_ENABLED` | `initiative/initiative-composition.ts:41`. Read at initiative admission/delivery gates; config change notifies the wake owner. |
| Initiative/delivery policy, 7 | `INITIATIVE_MODEL_HOUR_LIMIT`, `INITIATIVE_UTTERANCE_HOUR_LIMIT`, `INITIATIVE_UTTERANCE_DAY_LIMIT`, `INITIATIVE_UTTERANCE_GAP_MS`, `INITIATIVE_BUSY_MAX_WAIT_MS`, `INITIATIVE_OUTPUT_TTL_MS`, `SCHEDULED_OUTPUT_TTL_MS` | `config/initiative-policy-config.ts:12`; `initiative/initiative-composition.ts:32`. Re-read for admissions/publication; staged output keeps its explicit expiry. Preserve the whole-policy hour/day validation. |
| Monitor, 1 | `MONITOR_MODE` | `main.ts:193`, `:200`, `:203`, `:228`. Real producer invalidation and demand-time mode reads. Do not synthesize zero metrics for unavailable producers. |
| Desktop timing, 10 | `RECONNECT_BASE_MS`, `RECONNECT_CAP_MS`, `RECONNECT_STABILITY_RESET_MS`, `WS_OPEN_AUTH_TIMEOUT_MS`, `RPC_INTERACTIVE_TIMEOUT_MS`, `RPC_LONG_TIMEOUT_MS`, `CHAT_ACK_TIMEOUT_MS`, `PET_COSTUME_TOTAL_TIMEOUT_MS`, `RENDERER_LOAD_TIMEOUT_MS`, `HOME_RESULT_TIMEOUT_MS` | `config/knob-registry.ts:140`; `apps/desktop/src/lib/timing-policy-sync.ts:28`; `timing-policy.ts:27`. Full-policy subscribe/read refresh, in-memory last-good snapshot; later operations capture their budgets. Reuse this projection pattern for new active-state UI. |
| Avatar deadline, 1 | `AVATAR_OUTCOME_DEADLINE_MS` | `main.ts:274`; `config/avatar-config.ts:15`. Read for each newly opened outcome wait. Changing it does not extend an existing timer. |
| Browser input, 1 | `BROWSER_PLAYBACK_ENABLED` | `main.ts:192`, `:401`; `perception/browser-playback-sources.ts:45`, `:70`. Live read and synchronous retirement of sources no longer permitted; remains subordinate to Privacy Pause. |
| Viewing invitations, 3 | `INITIATIVE_VIEWING_EFFECTIVE_MS`, `INITIATIVE_VIEWING_REMAINING_SECONDS`, `INITIATIVE_VIEWING_INVITATION_TTL_MS` | `main.ts:691`; `config/viewing-invitation-config.ts:28`. Read for current eligibility/new invitations; accepted work and stored invitation expiry retain their contract. |
| Hindsight setup connection, 15 | `HINDSIGHT_ENABLED`, `HINDSIGHT_DEPLOYMENT_MODE`, `HINDSIGHT_ENDPOINT`, `HINDSIGHT_REQUEST_TIMEOUT_MS`, `HINDSIGHT_SETUP_TIMEOUT_MS`, `HINDSIGHT_TEMPLATE_REVISION`, `HINDSIGHT_MODEL_DEFAULT_PROVIDER`, `HINDSIGHT_MODEL_DEFAULT`, `HINDSIGHT_MODEL_RETAIN`, `HINDSIGHT_MODEL_REFLECT`, `HINDSIGHT_MODEL_CONSOLIDATION`, `HINDSIGHT_EMBEDDING_PROVIDER`, `HINDSIGHT_EMBEDDING_MODEL`, `HINDSIGHT_RERANKER_PROVIDER`, `HINDSIGHT_RERANKER_MODEL` | `config/hindsight-config.ts:15` produces the current B3 projection. `memory/hindsight/hindsight-runtime-connection.ts:23`, `:35` captures it and rejects drift for active Memory. Existing setup liveness is not active-connection hot update; **the owner reserved this gap for the dedicated Hindsight task on 2026-11-10**. Remote setup/model changes retain their existing explicit setup operations; no automatic deployment is implied. |
| Hindsight curator, 2 | `HINDSIGHT_POLICY_TIMEOUT_MS`, `HINDSIGHT_POLICY_PROMPT` | `memory/hindsight/hindsight-memory-subsystem.ts:55` reads current source, and `hindsight-policy-curator.ts:48` copies it at pass execution. The Memory sub-object is still startup-captured; update it at the defined new-operation boundary with the 31-row work. |

### Live-family issues the plan must address

- Distinguish immediate privacy, next-admission, external setup and new-operation meanings of `live`.
- Preserve the timing pattern's last-good full-policy refresh and generation fencing; late responses must not restore stale active-profile UI.
- Invalid stored/environment input should expose group-level unavailability without blocking Home or pretending defaults succeeded. Preserve actual address/type/duration/secret constraints.

### Hindsight application boundary is in the current task

Current whole-projection fingerprinting can invalidate the runtime even for non-identity changes. This task must separate and implement: (1) timeout/policy changes for new operations, (2) endpoint/credential replacement under the same verified Authority/lineage/Bank binding, and (3) desired remote model/template application through existing explicit setup operations with truthful desired/applied status. Existing runtime/operation owners prepare and publish candidates; old work retains safe binding or reports explicit service revocation. Failed replacement preserves the previous usable binding and candidate. Application-first disable/clear suppresses environment resurrection.

Verify lineage/Bank continuity before connection publication. Different Authority or destructive migration remains separate; that does not defer supported hot updates. No automatic deployment, weakened authority guard or empty Local/Legacy fallback is implied.

## Recommended lifecycle and validation semantics

### Model profiles

- Save incomplete drafts; apply only the local structure needed for construction. Paid tests are optional, explicit and never a save/activation gate.
- `@ai-sdk/openai-compatible@3.0.75` accepts optional keys and conditional Authorization (`packages/core/node_modules/@ai-sdk/openai-compatible/src/openai-compatible-provider.ts:65`, `:156`). Support no-auth endpoints without fake keys; request failure is separate from local activation.
- Distinguish absent active profile, incomplete draft, locally applicable profile and observed test/request failure; no conflated ready Boolean.
- Utility explicit/incomplete, inherit-Main and disabled modes differ. Only inherit chooses Main. Valid explicit Utility need not stop when Main is absent.
- Capture model/key/provider, usage/context policy and prompt revision together at admission. New messages see new revisions; queued work and retries retain their capture.
- Failed candidates preserve active state. Explicit clear/disable stops new dependent admissions, unlike failed edit or reset. Existing work keeps its capture unless deliberately cancelled/revoked; avoid repetitive save confirmations.
- SQLite and encrypted catalog are separate publication domains: stage keys then publish references with crash reconciliation. Never publish missing keys, expose plaintext, overwrite unreadable catalogs or delete keys retained by Runs.

### Runtime update mechanisms

Choose read-at-use scalars, admission-captured values, narrow query/persona/sampler/GC/listener replacement, or existing managed index maintenance. Data-root changes require migration/reopen. Preserve operation owners; no universal mutable proxy, second Agent runtime/Utility queue, or disguised full-Core restart.

### Privacy, retention and search

- Ambient disable retires evidence and schedules (`perception/ambient-screenshot-sampler.ts:95`; `perception/perception-layer.ts:129`); update frozen consumers at `main.ts:436`, `:692`, `:708`.
- `scheduler/sweep-runner.ts:31` returns a stop handle; attachment/ambient wrappers discard it. Give their owner one reconfigure/stop path, not duplicate timers.
- Preserve explicit canonical expiry; disclose raw-byte effects rather than rewriting historical expiry as a default update.
- Stoplist publication must keep tokenizer/index generations coherent for new consumers **and recall/write tools already captured by old Runs** (also required in `../design.md` and `../implement.md`). Rebuild from authority under existing owners. Preserve querying or report maintenance; failed rebuilding never means an empty corpus or successful no-results search.
- Report backend applicability; do not invent common ranking semantics merely to make a row appear effective.

## Acceptance scenarios to carry into the execution plan

| Scenario | Required proof |
| --- | --- |
| Empty Main and Utility, missing Character/runtime, basic storage available | Home/basic configuration APIs remain usable; no model request is attempted automatically; only dependent actions are unavailable with actionable state. |
| Incomplete Main or Utility draft, then completion and save/apply | Draft survives exit; no paid test is required; a new appropriate Run uses the accepted configuration without Core restart. |
| Compatible local endpoint without authentication | No synthetic key is needed; the adapter omits Authorization; actual request result is reported separately from activation. |
| Slow old Main reply while profile/context/prompt change; another queued old Run; then new message | Old admitted work retains its captured revision through retries; new admission uses the new revision; usage/model/context attribution remains coherent. |
| Utility policy changes while tidy/compaction is queued or running | One queue and one operation owner remain; admitted operations retain their captures; new operations use the new policy without duplicated processing. |
| Secret write failure, config write failure, activation failure, crash between publication stages | Last accepted state remains identifiable; editable draft preserved; no plaintext or false applied result; reopen reconciles actual committed state. |
| Conflicting application/environment values, including `false`, valid `0` and valid empty prompt | Present application values win; application saves are not environment-locked; provenance is truthful; invalid present values never silently fall back. |
| Explicit profile disable/secret clear with old environment credentials still present | New dependent admissions remain disabled or unauthenticated as explicitly selected, including after restart; environment cannot resurrect a cleared profile/key. |
| Deliberate reset to environment/default | Only this reset exposes the supplemental environment/default again; draft clearing does not accidentally revoke the applied profile; scalar reset compatibility is retained. |
| Restart with a newer incomplete draft beside a working applied revision | Locally reprepare the applied revision, retain the draft, and issue no automatic paid model-health test; source/secret failures remain actionable without promoting the draft. |
| Legacy profile migration with stored/environment conflicts and mixed model-field sources | Retain stored data, apply the accepted application-first precedence, preserve genuine fallback for unconfigured fields, and never silently rewrite source values or duplicate secrets. |
| Ambient disable during a capture and disable/enable within one await | Late old-generation evidence cannot enter future requests; one sampler/timer; existing Privacy Pause and denial remain effective. |
| Retention shorten/extend and drop/keep/day transitions | Existing explicit expiries preserved; raw-byte effects match stated policy; protected frames survive their leases; no duplicate GC. |
| Stoplist update interrupted or concurrent with Memory writes | Consistent tokenizer/index generation, complete search semantics, preserved authority/facts and recoverable failure. |
| BM25 weight update under Legacy, Canonical and Hindsight | Legacy new searches use updated weights; other backends report applicability honestly and retain their established ranking. |
| Listener bind fails or success acknowledgement is lost | Prior endpoint stays usable on preparation failure; successful endpoint is discoverable; no effectful RPC is automatically repeated after reconnect. |
| Live Hindsight timeout/policy/endpoint/credential changes while Hindsight is active authority | This task proves supported hot application/replacement without full Core restart, preserving same-authority/Bank binding and old operation semantics; failed candidates retain the previous usable connection and accurate desired/active state. |
| Hindsight desired remote model/template change or replacement points to a different authority | Existing explicit setup application reports its result; different authority/destructive migration is refused or routed to its separate operation, never passed off as an ordinary successful config update. |
| Repeated configuration changes and Home/Pet/Chat reconnect | Latest coherent read model, no retained subscription/timer duplication, drafts and known operation outcomes preserved. |

## Files found

The two matrices identify each consumer family and source location. Reuse config source/writer/subscriptions, existing Run/Memory/Utility owners, derived-index repositories, Perception evidence/GC owners and Desktop timing projections; their cited paths are the implementation entry points.

## External interfaces and related specifications

- Installed `@ai-sdk/openai-compatible@3.0.75`: optional API key and conditional Authorization, inspected in the local package source; no network/model call was made.
- Installed pino interface exposes writable `Logger.level` (`packages/core/node_modules/pino/pino.d.ts:149`). Actual propagation to retained child loggers remains an implementation regression check; the earlier assessment reports a successful isolated probe.
- `.trellis/spec/backend/config-store.md`: current environment-first precedence, masking, sparse reset and apply metadata. The implementation must replace its precedence/environment-lock contract with the owner's accepted application-first rule, distinguish reset from disable/clear, and update its restart-only descriptions; secret isolation and Core ownership remain.
- `.trellis/spec/backend/canonical-local-memory-runtime.md`: immutable Memory/Run captures, exact ingestion, single Utility chain and irreversible authority boundaries.
- `.trellis/spec/backend/memory-operations.md`: existing durable maintenance owner and recovery.
- `.trellis/spec/backend/server-push-and-connection-auth.md`: subscription recovery and credential/role boundaries.
- `.trellis/spec/backend/secret-catalog.md`: staged encrypted publication, locked fail-closed behavior and operator-only secret writes.
- `.trellis/spec/backend/perception-evidence.md`: epoch retirement and post-await evidence fencing.
- `.trellis/spec/backend/compaction-harness.md` and `request-attribution.md`: retry/context/usage consistency.

## Caveats / Not Found

- This is a source/interface review, not proof that any proposed hot-update behavior works. No production process, real profile, model request or external service was started; no code or spec was changed.
- Inventory coverage is complete at the row/family level. Runtime race, cancellation, observer-failure and repeated-update checks for all 84 rows remain implementation work; the sampled live paths are evidence of patterns, not blanket acceptance.
- The exact UI schema/API for saved draft versus accepted/active model revision is a design decision. The research states invariants without prescribing another generic configuration framework.
- Existing source and tests intentionally describe fatal startup/restart semantics. Change those expectations only where the new accepted requirements supersede them, while retaining existing failure/safety distinctions.
- The child session has no active runtime pointer; `.trellis/.current-task` names an unrelated historical task. The explicit parent assignment established this file's destination; no binding or other task metadata was changed.
