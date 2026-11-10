# Installation and User Experience Readiness

Source assessment: 2026-11-08. Discussion consolidated: 2026-11-09.
Source baseline: the working tree at
`H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`, including
uncommitted changes on `cd3cd91`.

## Scope update after owner review (2026-11-09)

The owner superseded installation-first staging with simpler local flows, removal
of unnecessary setup checks such as connection codes, empty/incomplete configuration
startup, and runtime configuration updates. Application-saved configuration now has
confirmed priority over environment fallback and defaults in the planned design.
See the [current PRD](../prd.md), [design](../design.md), and [execution plan](../implement.md).

This assessment retains the earlier source investigation and broader product goals.
Its one-installer requirements and 10-18 engineer-day estimate describe the later
installation track, not the currently planned slice. The original broad deferral of
31 restart-labelled settings is superseded; [the current consumer matrix](config-runtime-application.md)
covers them and the existing live settings. Current native local connection alternatives
and Shell failure isolation are documented in [local-flow research](local-flow-simplification.md).

## Target experience

A new Windows user should be able to install TakiAgent, configure a model, and
receive a first reply without developer assistance. Character preparation can be
completed during setup or later; missing avatar resources must leave Home accessible.
During later
use, the user should understand what is running, what requires attention, what a
setting changes, and how to recover from a failure without losing work or repeating
an action whose outcome is unknown.

The project already has substantial Agent, Memory, desktop, and extension
functionality. The main gaps are connecting those capabilities into an independent
user journey, reducing configuration burden, and making recovery actionable.
Priorities below are recommendations for a Windows single-machine release; remote
Core deployment needs its own transport, service-management, and connection setup.

## Retained broader installation and startup requirements

The earlier discussion accepted the following broader product requirements. The
later scope update above changes their delivery order; it does not treat integrated
installation as a prerequisite for flow simplification or live configuration:

- **One installed application and one launch.** Core and Desktop ship together;
  normal users must not start them separately or use developer commands.
- **Automatic local connection.** Remove user-facing connection-code steps for the
  bundled Core/Desktop relationship. The application establishes its internal
  connection automatically.
- **Remove the standalone Tauri connection/status page.** Home is the ordinary
  entry point. Useful startup and recovery feedback belongs there, without an
  additional window whose only purpose is displaying connection state.
- **Missing configuration or resources must not block access to the application.**
  Explain what is missing, which feature is affected, and how to complete setup.
  Keep available features accessible.
- **Independent first use is the completion standard.** A supported Windows user
  should reach setup and recovery without knowing about Core processes, ports,
  environment variables, terminal output, or internal pairing mechanisms.

These are confirmed experience requirements. The component arrangement, exact
onboarding layout, and effort figures below are the proposed implementation approach.

## Installation and first use

| Gap | Current evidence and user impact | Completion criterion |
| --- | --- | --- |
| Application startup is incomplete | The Tauri entry creates a Node client connecting to an existing Core. Bundle configuration has no Core/Node runtime or secret-helper delivery declaration. An installer for the Shell alone cannot start the complete application. | One application launch prepares resources, starts or finds the correct Core, establishes the local connection, and exposes a useful startup failure screen. Closing the Pet and exiting the complete application have distinct behavior. |
| The default window is a development connection panel | `index.html` loads `App`, which primarily shows English connection labels and a pairing-code form; its documented code source is the Core console. Home is opened through a separate window-navigation helper. This gives new users an internal connection task before the real application. | Open Home directly, route first use to setup, and integrate meaningful startup/recovery state into that window. Home remains reachable when the Pet has no model or cannot render. |
| Model setup requires an already configured Core | Bootstrap requires provider URL, API key, and model ID before starting the WS service. The ordinary config writer rejects secret writes, and Settings renders secret fields read-only. The current primary model loader reads resolved environment input rather than an application credential setup flow. | An unconfigured installation opens a setup surface; the user can save credentials, select a model, deliberately test the connection, and correct a failure from the same surface. |
| Builds depend on another local checkout | Desktop JavaScript references a QQMessageMonitor `.tgz` outside this repository; Cargo references its native package through a relative external path. Current CI checks out only TakiAgent. | A documented, versioned dependency source allows a clean build without reproducing the developer's directory layout. |
| Live2D runtime and model delivery are unfinished | Pet HTML references ignored files under `public/vendor/live2d`. Those files are present locally and fall under Vite's default public-file copying, but are absent from a clean checkout. Project policy requires proprietary runtimes and development Character assets to stay out of release bundles. | Provide a runtime acquisition/loading path consistent with the project's license policy and a usable Character import or distributable starter-asset path, including interrupted-download recovery. |
| Release artifacts lack an installation gate | CI checks TypeScript and Rust but does not build/install a distributable application. E2E has `test:e2e`, which the workflow's `pnpm -r test` does not invoke. Package versions remain `0.0.0`. | Establish versioned artifacts, release-specific E2E selection, dependency/resource checks, signing/distribution policy, and clean-Windows installation/upgrade evidence. |
| Local operator trust needs a release boundary | Default loopback auto-trust accepts an operator without pairing, and the WS server does not validate Origin. An isolated socket probe with an untrusted Origin obtained an operator token; disabling auto-trust required pairing. | Define and test application identity/source validation while preserving convenient local setup. The socket result establishes server behavior; browser reachability still needs an actual browser check. |

Source owners: [Shell startup](../../../../apps/desktop/src-tauri/src/lib.rs),
[bundle configuration](../../../../apps/desktop/src-tauri/tauri.conf.json),
[current connection page](../../../../apps/desktop/src/app.tsx),
[Home window navigation](../../../../apps/desktop/src/lib/open-home-window.ts),
[Core bootstrap](../../../../packages/core/src/boot/core-bootstrap.ts),
[provider configuration](../../../../packages/core/src/config/provider-config.ts),
[config writer](../../../../packages/core/src/config/config-writer.ts),
[desktop dependencies](../../../../apps/desktop/package.json),
[Cargo dependencies](../../../../apps/desktop/src-tauri/Cargo.toml),
[Pet HTML](../../../../apps/desktop/pet.html), [Vite configuration](../../../../apps/desktop/vite.config.ts),
[runtime downloader](../../../../scripts/vendor-live2d-runtimes.mjs),
[CI](../../../../.github/workflows/ci.yml), [E2E scripts](../../../../e2e/package.json),
[WS server](../../../../packages/core/src/server/ws-server.ts), and
[connection authentication](../../../../packages/core/src/server/methods/connect.ts).

### First-use flow

Recommended flow: **install -> open Home -> configure and test the model -> prepare
a Character or skip -> choose privacy/interaction preferences -> start chatting**.
Background preparation runs automatically and becomes a visible step only when it
needs attention. Completed setup is retained across application exits; returning
users resume their normal view and address only missing or invalid prerequisites.

1. **Installation:** deliver the Core runtime, required libraries, secret helper,
   and prompt resources; handle required WebView2 availability. Keep application
   files, user data, and temporary downloads separate. Resolve development-only
   external package paths in the release build.
2. **Initial launch:** open Home promptly, prepare the local backend, establish
   internal identities, and expose real readiness. Prevent duplicate application
   instances and unmanaged Core processes. Define window close, background operation,
   application exit, and subsequent relaunch consistently.
3. **Model setup:** show a provider/custom-compatible-service choice, API key,
   model selection or manual ID, and a custom address when needed. Validate and
   activate the complete profile from one action. Explain any paid test request
   before the user invokes it. Default background work to the main model; keep
   advanced context and maintenance knobs out of required onboarding.
4. **Character preparation:** separate Live2D runtime acquisition from model import.
   Offer a distributable starter Character if licensing permits, or an explicit
   import path with preview and useful resource diagnostics. Allow text chat before
   avatar preparation is complete. Downloads need progress, validation, and retry.
5. **Everyday preferences:** explain desktop display, proactive interaction, and
   observation scope in ordinary language. State which content may be sent to the
   configured model service. QQ, browser/media services, MCP, Skills, and optional
   Memory backends receive contextual setup when the user chooses those features.

Setup supports Back and Later where applicable. A failed test preserves the editable
profile and explains authentication failure, an unavailable model, unreachable service,
or temporary provider failure using the evidence actually available.

### Availability when preparation fails

| Condition | Application behavior | Useful next action |
| --- | --- | --- |
| No model credentials/configuration | Home and configuration/resource management open; model-dependent work remains unavailable until configured. | Complete model setup. |
| No Character model | Home and configured text chat remain usable; avatar presentation is pending. | Import a Character, obtain an authorized starter asset, or continue chatting. |
| Live2D runtime missing or renderer initialization fails | Keep Home usable and explain why the Pet cannot be displayed. | Acquire/retry the runtime or repair the model resources. |
| Optional QQ/media/extension service missing | Mark the affected feature as unconfigured or unavailable. | Configure it from its own entry when needed. |
| Core cannot start | Home retains local startup diagnostics and recovery controls; backend-dependent content is clearly unavailable. | Retry startup or address the reported dependency, permission, port, or storage problem. |
| Existing data cannot be opened safely | Preserve the existing profile and show recovery guidance. | Inspect the cause or restore through an explicit recovery procedure; never silently replace the profile with empty data. |

Missing optional resources are feature-readiness states. Required executable/runtime
or storage failures need a usable recovery surface; they cannot be presented as
successful backend startup. Already rendered stale content must retain its existing
qualification during recovery.

### Proposed technical route

Keep the Rust Shell and TypeScript Core as internal processes under one application
lifecycle. The Shell owns Core launch, readiness, controlled restart, and graceful
shutdown; users see one application. Existing Core shutdown/drain code is reusable,
but the Windows child-process control and ownership path still needs integration.

Split startup so configuration, credentials, resource management, and status remain
available before model-dependent runtime components are ready. Activate those
components after a valid model profile is available, including first-time activation
without an application restart. Reuse existing configuration/secret stores, Home,
connection recovery, and operation ownership rather than creating parallel stores
or a second Agent runtime.

Replace manual same-installation pairing with application-managed identity exchange
and credential recovery. Preserve the existing roles and action permissions. The
exact local transport/bootstrap mechanism remains a design choice; broad loopback
trust does not establish that a client belongs to this installation. Optional remote
device pairing is separate from the local startup flow.

## Configuration burden and runtime application

The current Core registry contains **84 settings**: **52 live**, **31 restart**,
and **1 environment-only**. The desktop maps **38** to Chinese primary labels;
the other **46** fall back to raw keys. Grouping places **60** settings under
Advanced, 16 under Model/Context, five under Perception/Privacy, two under
Storage/Cache, and one under Permissions. These counts exclude separate permission,
QQ, MCP, Skill, and interaction-rule controls.

Settings renders every matching row without a basic/advanced disclosure boundary.
Unmapped initiative options, including ordinary enable and quiet-hours settings,
fall under Advanced. Rows also expose environment names and Core descriptions.
Search and grouping help locate known settings, but still require users to know
the product's internal vocabulary.

Recommended organization:

- **First use:** model connection and credentials, Character preparation, and essential privacy choices.
- **Everyday preferences:** Character presentation, interaction frequency, quiet hours, and observation scope.
- **Advanced:** context/compaction, maintenance, transport timing, and integration internals; collapsed by default.
- **Diagnostics:** logging and troubleshooting information, accessed when needed.

Model settings should form one editable connection profile with complete validation.
The current model capability display explicitly describes catalog declarations,
not a successful request through the configured connection. A deliberate connection
test should identify authentication, model availability, and relevant capability
failures without treating catalog metadata as live verification.

### Replacing unnecessary restarts

Most restart labels reflect startup-captured values rather than a fundamental
process constraint. Bootstrap creates a resolved environment snapshot and injects
models and settings into long-lived consumers. Config writes publish changes, but
only selected consumers currently respond. The bootstrap test explicitly preserves
the old `maxSteps` value after a successful stored-setting change.

The following table covers all **31** restart-labelled settings. Keys omit the
common `TAKI_` prefix. These are proposed application boundaries; changing the
registry label alone would not implement them.

| Settings | Recommended application boundary | Required behavior |
| --- | --- | --- |
| `LOG_LEVEL` | Immediately | Update the logger; existing child loggers followed a root-level change in the isolated local probe. |
| `PROVIDER_BASE_URL`, `PROVIDER_API_KEY`, `PROVIDER_MODEL`, `UTILITY_BASE_URL`, `UTILITY_API_KEY`, `UTILITY_MODEL`, `PROVIDER_INCLUDE_USAGE` | Newly admitted conversations/background jobs | Validate and activate a complete model configuration. Existing work keeps its captured model and credentials unless explicitly cancelled or revoked. Model identity, usage attribution, and context calibration must agree with the actual model. |
| `PROVIDER_CONTEXT_TOKENS`, `UTILITY_CONTEXT_TOKENS`, `CONTEXT_HISTORY_RATIO`, `COMPACT_TRIGGER_RATIO`, `COMPACT_KEEP_MESSAGES`, `MAX_STEPS` | Next relevant conversation or maintenance operation | Capture a consistent policy per operation. Model changes must not inherit incompatible context calibration; retries retain their operation's configuration. |
| `PROMPT_DIR` | Next conversation | Reload and validate the prompt source; replace the construction-time/first-read caches while existing work retains its captured instructions. |
| `MEMORY_PINNED_BUDGET` | Next Memory assembly | Update the active Memory consumer without modifying stored facts. |
| `MEMORY_TIDY_WRITE_THRESHOLD`, `MEMORY_TIDY_MAX_STEPS`, `MEMORY_TIDY_STALE_DAYS`, `MEMORY_TIDY_REPORT_CAP`, `MEMORY_TIDY_BATCH_TIMEOUT_MS`, `MEMORY_TIDY_INPUT_TOKENS` | Next trigger evaluation or newly admitted tidy operation | Preserve existing queue and durable operation ownership. Keep one operation's limits coherent; do not create a second maintenance queue during reconfiguration. |
| `AMBIENT_SCREENSHOT` | Promptly on toggle | Stop scheduling and retire unconsumed/in-flight evidence on disable; prevent late results entering later requests. Already dispatched remote requests cannot be recalled. Enable must preserve permission and Privacy Pause checks. |
| `ATTACHMENT_TTL_DAYS`, `AMBIENT_SCREENSHOT_RETENTION`, `MEMORY_INTENTIONS_DEFAULT_DAYS` | Subsequent writes or cleanup cycles, according to the policy | Explain whether existing data is affected. Shortening retention can remove existing content; extending it cannot recover deleted bytes. Explicit stored expiry policies require separate treatment from defaults for new records. |
| `MEMORY_BM25_WEIGHTS` | Subsequent searches in the supported Memory implementation | Rebuild the affected prepared query or query component. Check applicability to the active Memory backend before advertising an effect. |
| `MEMORY_STOPLIST` | Managed search-index maintenance and switch | Keep stored search terms and query tokenization consistent; expose maintenance state and recovery. |
| `TRUST_LOOPBACK_OPERATOR` | Subsequent authentication attempts | Update the admission rule. Revoking already issued credentials is a distinct action. |
| `WS_HOST`, `WS_PORT` | Controlled listener restart/reconnect, or a retained backend-restart option | Coordinate client endpoint discovery, CSP, active requests, and reconnection. Hide these uncommon settings from ordinary setup. |

`TAKI_DATA_DIR` is the separate environment-only setting. Moving it needs a data
migration/reopen procedure covering the database and associated files.

For runtime application, distinguish **saved configuration**, **active configuration**,
and **application outcome**. Failed validation or component preparation should leave
the last working configuration active and show a correction path. Related settings
should activate together. Environment-locked values and model credentials need
explicit source/storage handling; an ordinary config-table write cannot replace them.

User-facing results should say "Applied", "Applies to new conversations", "Applies
to the next maintenance operation", or "Could not apply; previous configuration
remains active", with a relevant action when needed.

Source owners: [setting registry](../../../../packages/core/src/config/knob-registry.ts),
[grouping](../../../../apps/desktop/src/windows/home/pages/settings/config-groups.ts),
[Settings page](../../../../apps/desktop/src/windows/home/pages/settings/settings-page.tsx),
[model information](../../../../apps/desktop/src/windows/home/pages/settings/model-capabilities-section.tsx),
[bootstrap contract test](../../../../packages/core/src/boot/core-bootstrap.test.ts),
[runtime composition](../../../../packages/core/src/main.ts),
[Utility Slot](../../../../packages/core/src/memory/utility-slot.ts),
[window calibration](../../../../packages/core/src/agents/window-calibrator.ts),
[persona cache](../../../../packages/core/src/memory/persona-provider.ts), and
[Perception lifecycle](../../../../packages/core/src/perception/perception-layer.ts).

## Error explanation and recovery

| Current gap | User consequence | Required improvement |
| --- | --- | --- |
| Chat failures use `Provider request failed (HTTP ...)` or `Agent turn failed`; the send hook forwards the reason to a toast. | Authentication, rate limits, provider availability, and internal failures do not lead to distinct corrective actions. | Preserve safe structured error categories and map them to readable descriptions and contextual actions. Keep important unresolved failures available after the transient notice disappears. |
| Connection notices describe connecting, reconnecting, pairing, or disconnection but offer no action themselves. | A user cannot determine whether to wait, configure, pair, or recover a stopped backend from the notice. | Show the known cause and affected capabilities; link to the relevant setup or recovery operation. Keep automatic recovery state visible. |
| Initial costume promotion catches read failures together with the ordinary not-imported case; some diagnostics go only to the console. | An absent or incorrect Character may have no visible explanation. | Distinguish missing resources from failed reads, show the available fallback, and offer import/reload actions. |
| Costume import shows a count of optional-resource warnings without listing those warnings in that card. | Users cannot tell which expressions or motions are unavailable or how to fix the package. | Present affected resources and their practical effect with a useful correction path. |
| Several pages interpolate exception messages directly. | Technical or inconsistent wording reaches users; a generic retry can leave the actual prerequisite unresolved. | Use domain-specific recovery copy and retain sanitized technical details only where they help diagnosis. |

An important failure should explain **what failed, its effect, confirmed partial
results, whether recovery is in progress, and the next useful action**. State an
unknown cause explicitly rather than inferring it from a timeout. For example, a
provider 401 can lead to "Authentication failed; check the service address and API
key" plus an action opening the model profile. A 429 alone must not be described
as a confirmed empty account balance.

Read retries and mutation retries have different semantics. A failed status read
can be repeated. An unacknowledged message, command, analysis request, or credential
change needs reconciliation before resubmission where duplicate effects are possible.
Cancellation should report what stopped and what already completed. Backend state
and operation identities must supply these facts.

Reusable foundations already exist: settings retain drafts and conflicts; many
reads preserve qualified last-good data with retry; MCP distinguishes connection
failures and partial commits; Memory tidy reports durable partial/interrupted results
and next steps; child work exposes persistent attention and deliberate continuation.
Extend these mechanisms to missing paths.

Source owners: [chat error classification](../../../../packages/core/src/server/methods/chat-send.ts),
[send feedback](../../../../apps/desktop/src/windows/home/pages/chat/use-chat-send.ts),
[connection notice](../../../../apps/desktop/src/components/connection-status/connection-status.tsx),
[initial costume promotion](../../../../apps/desktop/src/windows/pet/initial-costume-promotion.ts),
[costume page](../../../../apps/desktop/src/windows/home/pages/costume/costume-page.tsx),
[Memory tidy card](../../../../apps/desktop/src/windows/home/pages/operations/memory-tidy-card.tsx), and
[child attention](../../../../apps/desktop/src/features/subagents/subagent-attention.tsx).

## Whole-product experience

| Dimension | Current evidence / remaining gap | Target behavior |
| --- | --- | --- |
| Feature discovery and navigation | Eleven page definitions include implementation-oriented labels such as Operations, MCP, Skills, and Subagents; Monitor visibility is conditional. New users need to understand where their goal belongs. | Organize common paths around chatting, Character customization, proactive companionship, extensions, and data/privacy. Preserve technical controls under an appropriate advanced entry. |
| Prerequisite guidance | Co-Watching depends on browser pairing, playback reception, an analysis service/result, Skill readiness, and privacy state. The manual card tells users to register completed analysis but does not guide the complete setup. Chat invitations already provide another entry. | Show readiness per dependency and link each missing prerequisite to its correction. Preserve the conversational entry and allow optional integrations to be skipped. |
| Long-running work and control | Child work and tidy have useful progress/recovery surfaces; full-Core-restart continuation remains separately tracked as T4-D85. | Across analysis, delegation, maintenance, and scheduled work, distinguish queued/running/waiting/partial/failed/unknown. Make Stop, Continue, and required user decisions discoverable. |
| Permissions, privacy, and interruptions | Permission levels, durable approvals, Privacy Pause, initiative policy, and independent QQ collection controls exist across different surfaces. | Explain which sources and background work each control affects. Separate stopping observation, stopping a particular task, quiet hours, and revoking permission. Show remaining available capabilities after refusal. |
| Memory and data ownership | Operations emphasizes authority/runtime, Bank/Pending, sync/reconcile, and maintenance. Attachment removal explicitly retains textual image descriptions. | Give users direct ways to understand remembered information, correct/forget it, inspect storage/remote processing, and understand deletion scope. Put backend-maintenance details behind the everyday data view. |
| Cost and resource visibility | Monitor and child work expose real usage, including incomplete/unknown values. Background interaction, analysis, and maintenance can also invoke models. | Explain cost implications before enabling expensive behavior; provide understandable usage and resource views. Distinguish measured usage, estimated cost, and actual billing. Define explicit controls without inventing missing metrics. |
| Desktop continuity and accessibility | Pet is transparent, always on top, and uses click-through; costume switching requires the Pet window. Windows have independent connection owners. | Provide a reliable way to reopen/reposition the Pet and understand window closing versus application exit. Validate keyboard access, text scaling, multiple displays, sleep/resume, and consistency across windows in the packaged app. |
| Backup, upgrades, and support | Database migrations exist, but the inspected user-facing registry and Operations page have no complete backup/restore, update, or help/diagnostic-export flow. | Protect full user state during upgrades; explain uninstall retention. Supply contextual help and user-controlled, redacted diagnostic export so support does not require manual database/log collection. |

Source owners: [navigation](../../../../apps/desktop/src/windows/home/pages.ts),
[browser setup](../../../../apps/desktop/src/windows/home/pages/perception/browser-attachment-card.tsx),
[Co-Watching controls](../../../../apps/desktop/src/windows/home/pages/perception/co-watching-card.tsx),
[privacy controls](../../../../apps/desktop/src/windows/home/pages/perception/pause-controls.tsx),
[QQ connection controls](../../../../apps/desktop/src/windows/home/pages/qqmm/qqmm-controls.tsx),
[initiative settings](../../../../apps/desktop/src/features/initiative-patterns/initiative-setup-card.tsx),
[Memory operations](../../../../apps/desktop/src/windows/home/pages/operations/operations-page.tsx),
[storage controls](../../../../apps/desktop/src/windows/home/pages/operations/storage-card.tsx),
[child usage](../../../../apps/desktop/src/features/subagents/subagent-progress.tsx), and
[Pet stage](../../../../apps/desktop/src/windows/pet/pet-stage.tsx).

## Earlier whole-product delivery order and acceptance

The order below is retained from the installation assessment. The current slice's
order is in implement.md; configuration simplification and hot updates now precede
integrated installation work.

1. **Make first use independently achievable.** Close runtime/resource delivery,
   clean-build dependencies, local connection trust, unconfigured startup, model
   credential setup, Character preparation, and first reply.
2. **Make everyday configuration understandable.** Separate ordinary preferences
   from advanced controls, provide model connection tests, and implement runtime
   application for frequently changed settings with accurate active-state feedback.
3. **Make failures recoverable.** Establish structured error/recovery behavior on
   startup, chat, Character loading, and extension setup; connect existing task and
   maintenance recovery surfaces to the user's immediate context.
4. **Complete ongoing ownership.** Add coherent privacy/cost/data controls, backup
   and upgrade recovery, support diagnostics, and packaged desktop acceptance.

### Historical installation and first-start effort estimate

The discussion estimated a **medium-sized change: 10-18 engineer-days**, approximately
**2-4 working weeks for one engineer familiar with this project**, including integration
and acceptance for a Windows-first delivery. This is a planning estimate based on
the inspected code, not a scheduled completion date. The largest uncertainty is
separating model readiness from Core startup across dependent components, followed
by clean-machine packaging and lifecycle behavior.

| Work package | Included work | Estimated effort |
| --- | --- | --- |
| Replace the connection window | Make Home the normal entry; adjust window identities, capabilities, navigation, and close behavior. | About 1 engineer-day |
| Integrated Core lifecycle | Automatic launch, readiness, instance ownership, port conflicts, abnormal termination, and graceful process cleanup. | 2-4 engineer-days |
| Automatic local authentication | Application-managed identity establishment and reconnection for Shell/Home/Pet without user-entered connection codes. | 1-2 engineer-days |
| Start without model configuration | Basic service availability, model credentials and test flow, and runtime activation after configuration. | 3-5 engineer-days |
| Continue without optional resources | Reachable Home, specific missing-resource feedback, and recovery/import entry points. | 1-2 engineer-days |
| Packaging and clean-machine acceptance | Deliver runtime dependencies, replace local dependency paths, and exercise initial launch, reopen, and failure recovery. | 2-4 engineer-days |

This historical estimate includes first-time model activation. Full hot-update coverage
is now part of the revised configuration plan and is not estimated by this table.
Comprehensive backup/update infrastructure and automatic deployment of every optional
integration remain separate work. Required Live2D acquisition
and dependency delivery must be included in the chosen distribution path; a more
extensive asset catalog or installer would require an updated estimate.

Historical sequence for the later installation track: establish unified lifecycle and unconfigured
startup, connect Home setup and resource recovery, then validate the installed product
on a clean Windows profile. Removing the extra page is a small first change, but the
whole journey is the delivery unit.

Acceptance should exercise complete user journeys:

| Journey | Observable result |
| --- | --- |
| Clean Windows install without developer tools or existing profile | Launch, configure, prepare a Character, chat, exit, and reopen from the installed application. |
| First launch with no model configuration, avatar resources, or optional integrations | Home opens directly, required setup is actionable, optional steps can be skipped, and completing model setup enables chat without restarting the application. |
| Automatic connection and application lifecycle | No standalone connection page or local code entry; repeated launch reuses the owned application, window closing follows the defined background behavior, and full exit settles owned Core work. |
| Wrong API key, unavailable model, rate limit, provider outage | Each has an accurate explanation and an appropriate next action; user content and known partial results remain accessible. |
| Change model during a reply | The current task stays coherent; a newly admitted task uses the selected model, with matching identity and usage records. |
| Disable observation during capture | No retired evidence enters later dispatch; UI accurately reflects the confirmed privacy state. |
| Missing runtime/model, invalid archive, incomplete optional resources | Explain the missing or rejected resource and offer a concrete recovery path; preserve the previous usable state. |
| Disconnect during an operation and reconnect | Reconcile actual outcome, retain drafts where appropriate, and avoid automatically duplicating effects. |
| First QQ/Skill/MCP/Co-Watching setup | Missing prerequisites are discoverable and actionable; unrelated core use remains available. |
| Upgrade with existing conversations, Memory, models, and extensions | State remains readable and usable; failed upgrades have a documented recovery path. |
| Long use, sleep/resume, multiple displays, scaled text, keyboard operation | Core and Pet state remain understandable, controls stay reachable, and measured resource behavior meets the chosen release target. |

## Evidence and related records

Configuration counts come from executing the current registry and desktop label
mapping. Source inspection establishes the configuration capture and UI paths above.
Isolated experiments established empty-provider rejection, the WS trust behavior,
and dynamic logger-level propagation. Clean installation, packaged UI behavior,
upgrade recovery, browser attack reachability, and proposed hot updates remain
acceptance work for the corresponding delivery stages.

- [Existing UX audit](../../../../docs/UIUX-OPTIMIZATION.md) and [frontend report](../../../../docs/UIUX-FRONTEND-REPORT.md)
  retain prior implementation history; their original findings are not all open defects.
- [Deferred decisions](../../../../docs/deferred-decisions.md): D24 owns integrated startup; D18 owns
  runtime packaging. D18's old spike-entry concern is already handled by the current
  dev-only Vite condition; runtime delivery remains the relevant gap. T4-D85 owns
  deliberate continuation after full Core restart.
- [Error-contract follow-up](../../08-22-t4-agent-architecture-observability/research/error-code-message-followup-2026-09-05.md)
  is the prior record for error classification and readable copy.
- [Media integration](../../../../docs/MEDIA-INTEGRATION.md) retains the accepted Co-Watching capability
  limits; clearer setup and recovery do not expand its observation capabilities.
- [Memory tidy requirements](../../11-06-memory-tidy-reliability/prd.md)
  distinguish automated delivery evidence from pending owner acceptance.

Implementation progress belongs in the relevant feature/release records; this
assessment supplies the cross-feature priorities and acceptance journeys.
