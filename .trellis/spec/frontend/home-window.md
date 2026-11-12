# Home Window, Pages & Streaming Timeline Contract

> The home window (`src/windows/home/`) is the ONE settings-family surface: a left menu plus one page per registry row, with **chat as a page** (#26 retired the standalone chat window #17 built). These are the executable contracts — follow them, don't re-derive.

## Window topology

| label | entry | declared | capability | role |
|-------|-------|----------|-----------|------|
| `pet` | `pet.html` | `tauri.conf.json` (transparent, undecorated, always-on-top, hidden until first paint) | `pet.json` | the overlay: Live2D scene, chat bubble, operation wheel |
| `home` | `home.html?page=<id>` | initial `tauri.conf.json`; recreated by `lib/open-home-window.ts` after closing | `home.json` + `local-auth.json` | useful entry and every page: chat / settings / operations / perception / costume |
| `main` | `index.html` | only when explicit remote Node endpoint needs pairing | retained compatibility permissions | LEGACY remote pairing panel; ordinary same-user entry uses native local admission |
| `spike` | `spike.html` | Vite input only | — | the #13 renderer spike, dev-only |

Window-state persistence is configured POSITION-only with `main` on the denylist (`src-tauri/src/lib.rs`): which labels persist is a plugin-side decision, not something a window's capability file grants (the `window-state:*` permissions only gate the JS save/restore calls).

## Runtime-created windows (NOT a tauri.conf.json entry)

Home opens before fallible execution Node initialization. Node identity failures retry independently; optional browser
configuration failures remain scoped and retry until repaired. Missing models/avatars do not prevent Home navigation.
Browser adapter setup replaces only its own listener and returns the actual `restartRequired` result; repaired/enabled
listeners do not duplicate Node workers or connection owners. Unknown Core failures are not diagnosed from a timeout.

A closed secondary Home may be recreated at runtime:

- **Open-on-demand** via a `lib/open-<name>-window.ts` helper: `await WebviewWindow.getByLabel("<label>")` (async in `@tauri-apps/api` v2) → if it exists `unminimize()` + `show()` + push it to the right page + `setFocus()`; else `new WebviewWindow("<label>", { url: "<name>.html", ... })`. Fixed label, fixed url — never interpolate runtime data into either (the home page id rides a `?page=` query param, which is not the url). Single instance is BY CONSTRUCTION: the label is a constant and an existing window is reused, never re-created.
- **Await the create race**: `tauri://created` resolves, `tauri://error` rejects, so a failed open reaches the caller. Packaged builds have no devtools and `window.alert` is a no-op — a rejected open MUST surface as a toast (`pushToast`), never console-only (D34; the dead opener defect).
- **Entry**: a root `<name>.html` (opaque; no Cubism/renderer scripts unless it renders Live2D) + `src/windows/<name>/main.tsx`, added to `vite.config.ts` `build.rollupOptions.input.<name>`.
- **Capability**: a dedicated `src-tauri/capabilities/<name>.json` with `"windows": ["<label>"]` granting only what that window needs (home needs just `core:event:default`: its Core traffic is a plain browser WebSocket, its file `<input>` is a web-platform API, and events cover `home:navigate` inbound + `pet:costume-switch` outbound). The window that OPENS another needs `core:webview:allow-create-webview-window` + `core:window:allow-set-focus` + `core:window:allow-get-all-windows` + `core:webview:allow-get-all-webviews` (the `getByLabel` lookup enumerates windows/webviews; without the get-all pair opening throws `plugin:window|get_all_windows not allowed by ACL`, #18 round 4) in ITS capability file — that is why `pet.json`, not `home.json`, carries them. A wrong/oversized permission set is a review-blocker; capability ids are validated by `cargo check` (tauri build script), so run it after editing capabilities.
- **Every `@tauri-apps/api/*` call is ACL-gated PER WINDOW, and `cargo check` does NOT catch a missing grant — only running that window does.** Front-end JS calls like `path.homeDir`/`join`/`resolve` (→ `core:path:default`), `window.*`, `fs.*`, `dialog.*` each need their permission in the CALLING window's capability file. `cargo check` validates that a listed id is spelled right; it does NOT verify a window has every permission it will USE at runtime — a missing grant compiles clean and throws `<command> not allowed on window "<label>" ... allowed on: [windows: "main"]` the moment that window invokes it (real example: `path.homeDir` in `character-asset-url.ts` worked from `main` but threw in `pet` until `core:path:default` was added to `pet.json`, #18). Web-platform APIs (WebSocket, `<input type=file>`, `fetch`) are NOT gated. `convertFileSrc` needs no capability (pure URL rewrite). When adding a Tauri API call to a window, grant it in that window's capability AND smoke that window — a passing build proves nothing here.

## The page registry is the only page list

- `windows/home/pages.ts` holds `HOME_PAGES`: `{ id, label, icon, component }` rows, `as const satisfies readonly HomePage[]`. `PageId` is DERIVED from it, `DEFAULT_PAGE_ID` names the boot page, and `isPageId()` gates ids arriving from outside the type system (the `?page=` param, a Tauri event payload). **Adding a page = one row here + one directory under `pages/<id>/`** (invariant 7); no other page list may exist, and no page imports another page.
- Navigation state is a small zustand store (`home-store.ts`: `currentPage` + `navigate`) — one store per domain, UI state only (invariant 4). A fresh window boots from `?page=`; an ALREADY-open window is pushed with the `home:navigate` Tauri event (`use-home-navigate-event.ts`).
- The pet overlay's operation wheel (`features/operation-wheel/wheel-items.ts`) is the same shape: one registry row per shortcut, each row calling `openHome(page)`. Its rows and the home menu rows are independent registries on purpose — the wheel is a shortcut set, not a mirror of the menu.
- **Static-render caveat for tests**: zustand serves `renderToStaticMarkup` its INITIAL state, so a static shell render always shows `DEFAULT_PAGE_ID` no matter what `navigate()` was called with. Assert nav/highlight behaviour against the default row.

## Own WS connection per window

Each window opens its OWN operator socket via `lib/ws-client.ts` (concurrent same-device sockets are allowed by the Core's connection registry). A window does NOT share JS memory or a socket with another window; cross-window liveness is Core fan-out. Native same-user admission verifies server and client proofs on each socket without a pairing page. Inside Home there are exactly TWO sockets: `use-home-connection.ts` and the Chat page's own `use-chat-connection.ts`; streaming turn state does not share a client with request/response pages.

Every owner replaces whole authenticated client generations after an observed close/failure; it never reuses a closed
client, buffers offline commands, or replays mutations. Connected status is published only after that owner's required
restoration. The complete lifecycle, deadline, timing-policy, timeline-reconciliation, and readiness contract lives in
[`operator-connection-recovery.md`](./operator-connection-recovery.md); what each page updates from pushes, refetches per
generation, and gates while hidden is codified in [`reactive-read-models.md`](./reactive-read-models.md).

### Grouped model configuration

Settings begins with Main and Utility cards using existing Field/Badge/ActionButton components. These replace the six
legacy connection-field editors; context/limit controls remain in the scalar settings list. One ordinary Save persists
incomplete drafts or applies complete profiles. A separate explicit test discloses possible cost and accepts unsaved
input. Catalog metadata is optional guidance and never an activation prerequisite.

Current active model/source, saved draft/application failure and actual test outcomes stay distinct. Authentication
choices include keyless services and write-only key replacement/removal. Utility explicitly inherits Main, configures
its own profile, or disables future dependent work; reset deliberately restores environment/default ownership.

Chat reads Main availability on its own socket. Missing/disabled Main exposes a Settings action and disables new sends
while history and other Home pages remain available. No avatar/resource prerequisite is added to text configuration.
The concurrency, visibility, secret-input and unknown-acknowledgement rules live in `reactive-read-models.md`.

### Settings permission governance

- The Settings page renders Core permission governance before generic config knobs: one `strict | standard | relaxed`
  selector plus a collapsed advanced cell list grouped by Core-returned `capabilityId`.
- `use-permissions.ts` is the only permission WS seam. It parses Shared schemas, reads fresh state for each authenticated
  Home client generation, and delegates async race handling to the framework-free permission controller.
- Permission state is window memory only. It has no cache key, persisted allow-list entry, Zustand persistence, or
  `localStorage` write. Home is a disposable operator view, not a policy replica.
- Only one permission mutation may be active. Late reads/mutations from a retired client are ignored; a conflict
  refetches; timeout/reconnect never replays a write.
- The UI renders Core facts only: factory/override/effective posture, override mode, reset, second-confirm,
  immutable, loading/reconnecting/read/validation/saved/conflict states. It may disclose that Hosts can tighten, but it
  must not invent a per-row Host constraint not present in the Core response. Policy/registry generations remain
  internal concurrency inputs and are not displayed, including expanded or accessible content.

### Secure MCP management

- The MCP page is an operator projection over Core desired rows plus process-local runtime status. It owns no
  authoritative configuration, runtime generation, permission decision, or secret value.
- State is component memory only. Each authenticated Home client generation performs a fresh `mcp.list`; late reads or
  mutations from a retired client are ignored, and timeout/reconnect never replays a mutation.
- Env/header values are always write-only. Core returns opaque markers only. A field name or transport-kind change
  invalidates the retained ref and requires a new value before save.
- Mutations are serialized. Revision conflict refetches Core truth. A desired edit committed before secret rotation or
  reconnect failure keeps the editor open, preserves the draft, and advances its retry revision to the committed row.
- Test result truth is preserved: a failed diagnostic never renders as success, and `test` never publishes tools.
- Disabled servers cannot reconnect. Cancel and New start a fresh editor session. A successful Save clears only its
  current unchanged submitted draft; newer edits stay open. Only a matching current-client commit may advance the
  same server/session's retry revision, never a background refresh or a retired completion.
- Full backend/runtime/secret and verification requirements live in
  [`mcp-lifecycle.md`](../backend/mcp-lifecycle.md).

### Standard Skill management

- The Skills page is a disposable operator projection over Core package rows and the process-local catalog. It owns no
  package bytes, enabled truth, revision, trust decision, scan verdict, or runtime generation.
- Each authenticated Home client generation starts with a fresh `skill.list`. Late list/inspect/mutation results from a
  retired client are ignored; reconnect and timeout never replay a write.
- ZIP and browser-directory import share one Core-authoritative validation pipeline. Home applies count/size preflight
  only to avoid waste; it never treats browser paths or client validation as trusted.
- Import, replacement, enable/disable, remove, and reconcile are serialized. Every success or failure refetches Core
  truth; optimistic conflicts remain visible and require a new operator action against the returned revision.
- Replacement supports both ZIP and directory sources. Remove requires an explicit second confirmation. Inspect shows
  only validated standard metadata and a bounded relative-file inventory, never absolute paths or package bytes.
- Active, disabled, quarantined/rejected, loading, empty, reconnecting, validation, conflict, partial-failure, inspect,
  and removal-confirmation states are rendered from current-generation state held only in component memory.
- Full storage/runtime/governance and verification requirements live in
  [`skill-lifecycle.md`](../backend/skill-lifecycle.md).

### Optional Hindsight API configuration observation (Operations page)

- `HindsightConfigurationSection` uses the shared Home operator connection and actual Character roster. Global and
  Character scopes go to Core; Home never chooses a Native endpoint, grant, namespace or evidence identity.
- `hindsightConfigurationStatus` and `hindsightConfigurationObserve` are Shared-validated ordinary bounded reads.
  Mount, reconnect, focus and visible-page restoration read Core status. Only the explicit observation button
  initiates a Native observation. No model health, setup or mutation is attached to either method.
- The controller hides previous evidence during refresh and after failure, rejects retired connection/scope results,
  and cancels expiry work when hidden/disposed. It subtracts request transit time from Core `validForMs` and performs
  at most one status read for each expired observation identity; the same expired observation cannot rearm a timer.
  There is no polling, push without a producer, localStorage or browser-owned evidence authority.
- Desired settings, observed provider/configured-model aliases, Core comparisons and unknown coverage are separate.
  API replicas, standalone Workers, embedding and reranker remain unknown. Unsupported/routed/custom profiles never
  become a first-member model. An unpinned Bank is explicit; a match never becomes activation or health readiness.
- Denied, unsupported, unavailable, expired, identity mismatch and transport failures use closed safe wording.
  No raw error, nonce, build hash or runtime session identifier is rendered. Existing-instance operations remain
  available independently of this optional disclosure capability.
- Test actual WsClient/controller/Core-service behavior and authenticated browser scope, observer, reconnect,
  remount, expiry and refusal paths; static presentation cases supplement these tests rather than replacing them.

### Hindsight templates and explicit user choices (Operations page)

- `HindsightTemplateSection` uses the shared authenticated Home client and Core-listed Bank identities/catalog
  revisions. Defaults affect the reviewed existing Banks and later new Banks; per-Bank user choices stay local.
  Native values never reconstruct user intent or legacy ownership. An untracked Bank stays visibly untracked.
- Text, labels, models and directives preserve distinct `value`, `inherit` and `suppress` choices. Explicit values
  equal to a template remain explicit. Complete user resources retain advanced fields. An unfinished resource
  editor prevents preview/confirmation; duplicate additions cannot silently replace an existing choice.
- Preview calls `memory.templates.preview`, then `memory.templates.preview.bank` for every Bank in that exact
  ready preview. All details must agree before confirmation. Display complete old/new definitions, each deletion's
  content/history/dependency consequences and requested provider work. Existing-resource enrollment, deletion and
  provider work have separate acknowledgements. Same-name directive adoption requires an explicit actual UUID;
  multiple candidates never become an automatic choice.
- Scope, draft, connection or selected-plan/revision changes retire old preview/detail replies. Local unsubmitted
  drafts survive connection replacement; an externally changed identity marks them stale until explicit reload.
  The same socket can observe connection config/drift, setup revision, Bank roster or incarnation changes; these
  retire consent too, without using ordinary cursor/job/timestamp progress as an identity change.
  One-shot expiry retires consent and performs no read or write. Cancellation receives focus; Escape dismisses
  from any focused preview detail or confirmation control and restores the opener. Changing a template version
  clears separately selected generation requests.
- `template.apply` submits only the consumed request/preview/hash identity through `memory.operations.submit`.
  A second click, timeout, reconnect or remount cannot replay it. `template.recover` uses only the original
  `recoverPlanId` supplied by Core. Subscription failures use the same injected safe formatter as mutation failures.
- Native receipts, Core selection publication, current runtime availability and the original operation's historical
  outcome are separate facts. Binding-only recovery does not rewrite the original failed operation as successful.
  Rollout child rows always identify their historical observation time and never imply current progress.
- `memory.templates.derived` explicitly rereads one genuine plan/Bank/child. Stale, unavailable, wrong-identity or
  failed observations clear previous current evidence. Reconnect rereads only the selected child after status;
  it does not refresh models or enumerate children. Preview/derived use bounded long-read deadlines because they
  contact Native; status/detail are bounded local reads. Durable submit retains its ordinary unknown-outcome ACK.
- Verify strict adapters, explicit full-resource round trips, stale generations, all-Bank detail gating and failure
  cleanup. Use actual Core/operator WS tests and one integrated real-browser sequence for two observers, lost ACK,
  partial original-plan recovery, scope selection, explicit equal-value retention on removal and derived failure.
  Synthetic Native/runtime delegates do not prove Native SQL/auth, installed WebView2/CSP or owner acceptance.

### Memory authority and operations card (Operations page)

- The card is a disposable projection of `memory.authority.status` plus the `memory.operations.changed` push. It owns
  no authority, progress, checkpoint or setup state; the legacy `memory-status` counter cache never stores any of it.
- Each authenticated Home client generation subscribes once and refetches the composite status on every push, on
  reconnect and on remount. There is no polling; results from a retired client are ignored; nothing is replayed.
- Actions (立即同步 / 完整对账 / 重试 / 取消) are serialized `memory.operations.*` submits; the card enables Retry only when
  the Bank reports `explicit_retry_required` and Cancel only for an `admitted` `replica.sync`. Availability follows the
  current Core status, never a stale snapshot.
- Unknown values render as 未知; the card never shows `0` pending, a health badge or freshness that the producer did
  not report. Setup validate/apply live on the Hindsight activation card. Backup lives in its own block on this card
  (below). Transitions and upgrade are not on this card until their Core operations exist.
- Under Hindsight authority the card renders the `hindsight` section as a child block
  (`memory-hindsight-lifecycle-state.ts` `hindsightLifecycleView`, `memory-hindsight-lifecycle-block.tsx`), also while
  the runtime is unavailable: connection rows (drift and 上次校验通过 only for a ready config), one readiness row per
  scope (可用 / 同步中 / 创建中 / 失败 / 未创建), and the reason labels for `connection_disabled` / `config_changed`.
- 重新校验连接 (`connection.revalidate` with the status epoch id; omitted when it is null) and 创建 Bank（id）
  (`bank.provision` per listed Character) come only from `hindsight.actions`; there is no client allow rule. They submit
  through the generic controller `submit(request, key)` and are disabled while the client is disconnected or any
  mutation is pending. Native Bank ids and error codes appear only in the collapsed 技术诊断.
- The `hindsight.backup` section renders as a second child block after the lifecycle block
  (`memory-hindsight-backup-state.ts` `hindsightBackupView`, `memory-hindsight-backup-block.tsx`):
  - State rows: 备份状态 未知 when the section is null; 尚无已校验的备份; or 已有已校验的备份 with 上次备份 (`createdAt` and
    its age) and 校验时间. A 最新备份（未通过校验） row appears when the newest sealed backup is unverified.
  - One 未备份区间 row per native Bank: native cursor -> replica cursor and unsettled writes, labelled by scope where
    the lifecycle section maps the id.
  - A danger line when a replica or lifecycle Bank reports `HINDSIGHT_PROVIDER_ROLLBACK_DETECTED`, and the in-flight
    line (kind and phase) or the newest settled failure (closed-code label; `outcome_unknown` gets the restart line).
  - Staged capture: the newest `staged` entry of the current epoch shows the 导入备份 form. It names
    `backups/<id>.staged/native-request.json` and `backups/inbox`, and it submits `backup.admit` only for a file name
    the Shared inbox schema accepts.
  - Actions: 创建备份 (`native-endpoint`); 创建备份（手动导出原生数据） (`operator-artifact`) only after the newest settled
    capture failed `HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE`; 校验备份 re-verifies `latest`, the newest sealed backup whether
    verified or not. There is no action for an older backup: any sealed backup id stays verifiable through
    `backup.verify` on the operator surface.
  - Every action goes through the generic `submit` and is disabled while the card is locked or a backup operation is
    open. Backup ids, operation ids and codes appear only in the collapsed 备份诊断, except the staged backup id that the
    import form needs for its path. Contract: [`memory-hindsight-backup.md`](../backend/memory-hindsight-backup.md).
- Full operation ownership and verification requirements live in
  [`memory-operations.md`](../backend/memory-operations.md).

### Local onboarding card (Operations page)

- A separate focused card (`local-onboarding-card.tsx`, `use-local-onboarding.ts`, controller/state/actions modules)
  projects `memory.onboarding.status` plus the `memory.onboarding.changed` invalidation. It subscribes before the
  initial read and refetches on push, reconnect, remount and visibility restoration; it never polls and never replays
  a write — a timed-out mutation triggers rediscovery, not resubmission.
- Actions come only from the server-derived `actions` (preview, prepare, resume, replace, exclude, activate, cancel
  before claim, recover binding); they are disabled while status is stale, the client is disconnected or a mutation
  is pending. Client identity and generation are both guarded; late replies from a retired client are ignored.
- The card renders producer counts and source-relative diagnostics; it never carries filesystem paths or memory bodies,
  and technical receipt hashes stay in diagnostics. Accepted (admitted) and completed states are shown distinctly.
- Contract: [`memory-local-onboarding.md`](../backend/memory-local-onboarding.md).

### Hindsight activation card (Operations page)

- A separate card (`hindsight-activation-card.tsx`, `use-hindsight-activation.ts`, state/actions modules) projects
  `memory.activation.status` (`INTERACTIVE_READ` deadline class), invalidated by `memory.operations.changed`. A hidden
  page retires the client generation; there is no polling and no replay of a write.
- It and the Stage 1 card share `createMemoryOperationsController<TStatus>(sink, read)`: one push subscription per
  generation awaited before the first read, coalesced refetch on every push and after every mutation outcome, and
  serialized submit/cancel. A mutation whose deadline expired with `outcomeUnknown` shows
  "请求超时，操作结果未知。正在重新读取 Core 状态，请根据结果选择下一步。" and re-reads Core instead of resubmitting.
- 启用 Hindsight / 继续 / 恢复运行时 / 取消 come only from Core `actions` (`activate`, `resume`, `recoverBinding`,
  `cancelOperationId`). The two client-derived rules are 校验连接 / 应用配置 (`setup.validate` / `setup.apply`): allowed
  only under `canonical-local` authority with no open activation row, by setup phase (validate: `ready-to-validate`,
  `compatible`, `failed`; apply: `compatible`, `failed`); when setup is already `configured`, only 应用配置, and only
  while `prerequisites.blocking` contains `HINDSIGHT_TEMPLATE_NOT_VERIFIED` (a Character Bank created after setup,
  D86), targeting the first unverified Character Bank. A loading, errored or busy frame dispatches nothing.
- Run, transaction, epoch ids and hashes appear only in the collapsed diagnostics; admitted and completed are shown
  distinctly, and outcomes are never derived locally.
- Contract: [`memory-hindsight-activation.md`](../backend/memory-hindsight-activation.md).

### Private Subagent Conversation

- Home's sidebar mounts lightweight `subagent.attention` observation independently of the selected page. Install the
  existing child-change listener before subscription acknowledgement, then read at most 20 entries per explicit page.
  Actual producer hints and reconnect invalidate; document hide retires disposable reads and preserves the gap.
  `needs_user_input`, `reconciliation_needed`, user-required check-ins and exhausted pre-intent retry retain an explanation and exact
  child/work navigation. Generic once-per-recent-attention Toasts contain no private report body and never replace the
  persistent entry. Existing recovery controls retain the exact consumer and stable operation key; no automatic replay.
  Render the actual `needs_user_input.reason` decision note as escaped persistent text; a generic request to decide is
  insufficient. Map reconciliation reason codes through the shared recovery vocabulary without displaying internal codes.
  A child send/Continue warning remains unknown until a canonical input with its exact Character/child/work/operation
  identity is read. Clear only that warning when acceptance is confirmed; preserve newer action feedback and independent
  read errors. Receipt reconciliation may clear the submitted draft, but never a newer local edit or another operation.
  `inbox_retry_exhausted` offers explicit `subagent.inbox.retry` without inventing a consumer: it schedules only a fresh
  pre-intent opportunity. Unknown outcomes require a fresh status read and deliberate action, never reconnect replay.
- Child headers/list show Core cumulative token evidence, including no calls yet, reported zero, unknown totals,
  incomplete known subtotal, in-flight calls and missing usage. Do not derive total usage from step count, last Run or
  local counters. Progress displays the captured current interval and actual unattended approval count; legacy
  `post_upgrade` tracking explicitly leaves earlier step counts unknown.
- An open `check_in` wait uses one exact `Continue` RPC with `replyToEventId`, including an empty direction. A draft
  provides explicit redirect-and-continue. User-required checks say the main Agent cannot release them. User Stop
  remains independent and user-only; ordinary main chat does not reset the unattended work count.
- Conversation check-ins render as System factual snapshots, selected only by the trusted `needs_input` event's Core-minted
  `producerKey=checkin:<interval>`, never by body text. Show recorded steps, pending-input count, captured required actor and
  clearly attributed recent worker text/older summary; remaining work stays unconfirmed. Do not expose internal reference
  fields as ordinary prose. Decode at most 64,000 body characters; incomplete/unsupported bodies retain a labelled original
  fallback and the existing exact read-more control. Formatting never mutates the canonical body or changes row identity.
- Both N/K knobs use existing Settings registry editors and Chinese labels. Explain that newly stored values are
  captured at new work or the next check-in interval; they do not move an active threshold or downgrade an existing
  user-required check-in. UI owns no second configurable state.
- Home registers `subagents` once in `pages.ts`. `features/subagents/` owns a disposable query/controller view;
  retained private content never enters the Character Timeline, presence exposure reports, or persisted UI caches.
  Reuse Chat text/tool presentation without manufacturing canonical Timeline identities.
- Install the parsed `subagent.changed` handler, await `subagent.subscribe`, then read bounded list/history pages.
  Input, message and execution cursors remain independent. Hide retires read authority and retains the gap; it
  does not cancel a submitted command. Each authenticated replacement repeats read restoration only.
- Keep the committed child/title/payload/work coherent while another child loads. Actions require a fresh
  displayed target: `subagentId`, exact `workInputId`, `expectedControlVersion`, and `expectedRunId` including
  explicit `null` for an idle child. Stale displayed callbacks cannot retarget a different child or work.
- Serialize controls. Stop addresses only the chosen child. An authenticated explicit Continue clears the
  user-stop latch through Core; sending a message or opening the page does not. Co-Watching `paused_child`
  links its exact child/work into this same page through `openSubagentConversation`.
- An accepted input with no `consumed` receipt displays as waiting for inclusion. A receipt means included in
  model request intent, not provider receipt or model understanding. Child outcome, completion disposition,
  parent synthesis/decision, publication and canonical delivery state remain separate visible facts.
  Execution pages use a Run-ID cursor, not a chronological sequence; do not label their array positions as
  first/second executions. Display the retained execution state without inventing an ordinal.
- Timeout/disconnect preserves the draft and unknown-outcome diagnostic across client replacement; never
  resend automatically. Conflict and subsequent read failure remain separate. Only fresh reads restore action
  readiness. Known absent/forbidden selected detail removes that projection; ordinary refresh failure retains
  permitted last-good content with retry. Do not substitute an empty/success response for a failed read.
- Verify exact targeting, subscription-before-read, stale read/action retirement, hidden mutation settlement,
  receipt distinctions and no reconnect replay. Actual WebView2/browser evidence must separately cover rendered
  navigation, retained editor/message nodes and deliberate controls; scripted RPC evidence is not Runtime/model
  or owner acceptance.

## Cross-window commands (the pet owns the scene, the pages own the surface)

A page that needs something only the pet window can do COMMANDS it and does not reach into it:

- Costume switching: `lib/costume-switch-event.ts` — the costume page emits `pet:costume-switch` to the `pet` label; the pet window parses the payload (malformed → dropped with a breadcrumb, never thrown in a callback) and runs its existing switch path. Presentation only: the state of record still rides the pet's WS persist, so this is not a second writer (invariant 2).
- The reverse direction is `openHome(page)` + `home:navigate`.
- Anything the Core can mediate SHOULD go through the Core instead (a WS method + its push), not through a window-to-window event.

## Scenario: Result-bearing cross-window commands

### 1. Scope / Trigger

Use this contract when one window commands work that only another window can execute and the initiating UI must remain
truthful about the outcome. A resolved Tauri `emitTo` proves delivery only; it does not prove execution, so a command
that can fail, be refused, be cancelled, or stall requires a typed return event and a local deadline.

### 2. Signatures

```typescript
type CostumePhase = "started" | "succeeded" | "failed" | "cancelled";
interface CostumeSwitchPayload { costumeId: string }
interface CostumeResultPayload {
  costumeId: string;
  phase: CostumePhase;
  reason?: string;
}

requestCostumeSwitch(costumeId: string): Promise<void>; // delivery only
requestCostumeCancel(costumeId: string): Promise<void>; // delivery only
publishCostumeResult(result: CostumeResultPayload): Promise<void>;
```

The event names are `pet:costume-switch` (home -> pet), `pet:costume-cancel` (home -> pet), and
`pet:costume-result` (pet -> home). The home reducer accepts `request`, `undeliverable`, `result`, `observed`, `cancel`, and
`timeout` actions. Each pending row captures `currentTimingPolicy().homeResultMs` once; a Home client replacement must
not restart that timer. The validated relationship is `rendererLoadMs < petCostumeTotalMs < homeResultMs` (development
profile: 30s < 40s < 45s). See [`costume-operation-lifecycle.md`](./costume-operation-lifecycle.md).

### 3. Contracts

- The command owner validates every inbound payload before acting. Empty/non-string `costumeId` and unknown result
  phases are dropped with a warning breadcrumb; event callbacks do not throw.
- The executor reports every accepted lifecycle: `started` followed by exactly one of `succeeded`, `failed(reason)`,
  or `cancelled`. A guard rejection reports `failed` with a closed reason (`busy`, `no-scene`, `unknown-costume`, or
  `not-renderable`) instead of returning silently.
- The initiating page marks only the commanded row pending. Selection follows a correlated live Pet snapshot, never
  the click, default or remembered costume. `succeeded` requests a new snapshot and retires prior responses. Failure,
  cancellation, undeliverable emit, and deadline all release pending so another command can be attempted.
- Renderer attachment is the executor's success boundary. A later `avatar.report` failure is synchronization debt,
  not permission to report the visibly committed costume as failed.
- Cancel releases the initiating UI before emitting the cancel command. A missing/dead executor therefore cannot wedge
  the page. The executor cancels only when `costumeId` matches its active switch.
- A late `succeeded` clears a stale deadline error and re-reads actual Pet presentation; it cannot directly assert a
  costume after a scene replacement. `costume-scene-event.ts` owns finite request/snapshot and data-free changed events;
  `costume-operation-lifecycle.md` defines ordering, retirement and native Pet-destroy observation. Core connectivity
  does not gate this local presentation read. Durable costume identity remains Core/Pet-owned.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|-----------|-------------------|
| Invalid command/result payload | Drop it, warn with event name + payload, preserve current state |
| Executor guard refuses command | Emit `failed` with a named refusal reason |
| Command emit rejects | Clear pending and render an undeliverable error |
| Executor switch throws or hits its renderer/total timeout before attachment | Emit `failed(reason)`; keep the previous selection |
| Renderer attaches, then `avatar.report` fails or times out | Keep/publish `succeeded`; mark report recovery-needed and re-report the live snapshot on reconnect |
| Operator cancels | Clear home pending immediately; executor reports `cancelled` when its hook settles |
| Executor never answers | Home's captured `homeResultMs` deadline clears pending and shows a retryable error |
| Result belongs to another costume | Ignore non-success endings; `succeeded` requests the pet's current scene |
| Cancel id does not match active switch | Warn and do not cancel another command |

### 5. Good/Base/Bad Cases

- Good: click -> pending row -> `started` -> `succeeded` -> live scene observation; only actual attachment is highlighted.
- Base: a refusal, renderer failure, Cancel, or deadline clears pending, leaves the old highlight, and permits retry.
- Bad: fire-and-forget command + optimistic highlight + unbounded spinner. Delivery is not completion and the UI will
  lie or wedge when the other window is absent or half-alive.

### 6. Tests Required

- `lib/costume-switch-event.test.ts`: all three event names, valid phase round-trips, malformed payload drop + warning.
- `lib/costume-switch-attempt.test.ts` + `lib/costume-report-sync.test.ts`: total budget, stage cancellation, attachment
  commit, report recovery, exact-boundary races, and stale report tickets.
- `windows/pet/costume-report.test.ts`: started/succeeded ordering, failed reason, cancelled settle, every guard refusal.
- `windows/home/pages/costume/costume-select-state.test.ts` and scene-observer tests: selection moves only on a current
  scene observation; failure, Cancel, deadline,
  and undeliverable emit release pending; stale/foreign results cannot corrupt the active row.
- Component/manual: one row alone renders pending + Cancel, other rows remain clickable, and manual checks #74/#75 pass
  against the real pet renderer and Tauri event bridge.

### 7. Wrong vs Correct

```typescript
// Wrong: delivery is treated as success and the UI can wait forever.
setSelected(costumeId);
await emitTo("pet", "pet:costume-switch", { costumeId });

// Correct: the request creates pending state; success prompts a correlated live scene observation.
dispatch({ kind: "request", costumeId });
await requestCostumeSwitch(costumeId);
// Later: dispatch({ kind: "result", result }); with a local deadline running.
```

## Page presentation contract

- The shell (`home-shell.tsx`) owns the nav column and a `<main>` flex column; a page renders `<PageHeader>` + `<PageBody>` from `page-chrome.tsx` — except a page that owns its own scroll (chat: header, banner, timeline, composer).
- Shared primitives, declared once, restyled once: `page-chrome.tsx` (`PageHeader` / `PageBody` / `PageAlert`), `page-card.tsx` (`PageCard` / `LabeledRows`), `badge.tsx` (tones: `warn` = needs the operator's attention, `ok` = in effect, `neutral`/`muted` = a plain fact), `action-button.tsx` (`primary` / `secondary` / `danger-soft` / `danger`). A page that hand-rolls card, badge or button markup is a review finding.
- Palette (semantic tokens live in `src/styles.css` `@theme` — pages reference the role, not the hue): slate neutral, **rose = the one brand accent** (selection + identity + primary chat action via `accent*`), **red = danger/error** (`danger*`; deliberately a different hue from the accent so the two roles cannot drift back together — the approval dialog's ALLOW uses the slate `primary` tone, DENY uses `danger-soft`), amber = attention (`warn*`), emerald = confirmed/in effect (`ok*`), `link` = markdown hyperlinks. The solid `danger` fill is reserved for an irreversible confirm (today only the D46 attachment purge, which is two-step by construction). Neutral slate sizing/spacing tokens are deliberately deferred to the batch-2 adoption pass.
- Icons live in `lib/icons/` as self-drawn inline SVG components (`Glyph` base + one glyph per file, `className` passthrough). **No icon package, no imported third-party asset file.**
- **`references/BANDORI-PET-REV` is GPLv3: a LAYOUT and organization reference only.** Read it to learn shape (sidebar with brand row + icon nav, card-grouped right pane, label-left/control-right rows); never transcribe code, class schemes, or asset files into this repo.
- Overlay animation is CSS-only (the wheel's appear keyframe is registered in `styles.css` under Tailwind v4 `@theme`) — no JS timers on the pet window, whose idle CPU is a feature.

### Human-facing execution projections

- A monitor or trajectory page is a presentation projection over Core facts, not a direct ledger/database viewer. Ordinary
  rows lead with readable event labels, phase/category, status, outcome, duration, counts, and bounded error summaries.
- **Owner clarification, 2026-09-05 (G4):** remove meaningless internal information from user-facing surfaces,
  including expanded details and the Monitor Inspector. Moving it into a second disclosure or adding a copy control
  is not an acceptable fallback. This supersedes the earlier general developer-inspector allowance.
- Internal `runId`/`attemptId`/effect/call/correlation IDs, hashes/digests, config/catalog/policy generations and
  revisions, schema bookkeeping and opaque Host IDs are not presentation content. Keep the values needed for keys,
  joins, authorization, CAS, requests and generation guards internally; remove their user-visible rows, titles,
  tooltips, copy affordances and accessible-name fallbacks. `FULL_LOCAL` does not waive this rule.
- Curate fields that explain an operation, input/result/error, useful state/timing/usage or an action the user can take.
  Actual commands, file paths/diffs, tool results, user-edited MCP namespaces and actionable config keys can be useful.
  Do not strip arbitrary result text because it contains a hash or version: a requested checksum is a valid result,
  and a real package version can inform compatibility. Internal config revisions are not package versions.
- Do not dump `Object.entries(metadata)` or `inspector.technical` into a generic details section. Keep only meaningful
  fields and remove a disclosure if nothing useful remains. Do not replace removed UI with a new raw-metadata panel.
- Adapt DSH's `current`/`shadowed`/`log-only` classification so superseded or internal evidence remains queryable without
  producing duplicate or meaningless user-facing rows. Category/severity/Run/Attempt/tool/trigger/delivery filters are
  preferred over exposing raw event JSON.
- MCP/Skills details, shared extension status, permission settings, Monitor and import feedback have concrete G4 cleanup
  targets. See [the reference study and field inventory](../../tasks/08-22-t4-agent-architecture-observability/research/uiux-useful-information-2026-09-05.md).
  The first pure-frontend cleanup has automated evidence in the frontend task; cross-layer labels and Monitor remain
  separate work. A target contract or static test does not certify actual-window visual acceptance.
- Availability copy follows the actual lifecycle state, not the existence of an internal identifier. MCP can expose a
  draining runtime generation while not connected; continued-service wording requires a connected snapshot with a
  runtime. A disconnected/idle extension snapshot must be identified as previous data, never current availability.

Field-selection example (illustrative; retain the original snapshot for actions):

```typescript
const snapshot = { name: "GitHub", configRevision: 7, contentHash: "internal-digest" };
// Wrong: serialize every available field into user-visible rows.
const dumpedRows = Object.entries(snapshot);
// Correct: choose information needed for this view; the revision still exists for concurrency checks.
const visibleRows = [{ label: "名称", value: snapshot.name }];
```

Verification: open every affected disclosure/Inspector and assert absence of internal bookkeeping from visible and
accessible content. Assert that meaningful names, configuration, results, errors and actions remain. Preserve CAS/
generation behavior and selection through updates. Existing tests that require hashes/IDs/counters in details must
change with the implementation; an old presentation assertion does not override the owner requirement.

### Monitor product baseline (G5, owner 2026-09-05)

The pre-D68 Monitor prototype did not establish product UI acceptance. Monitor has its own acceptance,
separate from the other pages' visual direction. Port/rebuild Monitor primarily from
`references/deepseek-harness-master/packages/client/ui-trajectory`: its Toolbar/Overview/Table/Inspector
composition, styles, density, grouped information and interaction. Use the
[D68 source-to-target plan](../../tasks/08-28-dsh-observability-expansion/design.md).

Adapt the view to TakiAgent's real Core projections, React/window integration, Chinese system labels,
G4 useful-field selection and privacy. Preserve the single execution authority. Complete UI localization
includes status/filter/tab/tooltip/loading/error/empty/accessibility copy; actual tool/model names,
commands, paths and content retain their identity. Retain MIT source attribution for substantial copies.

Acceptance compares representative default, selected/expanded, live-tail, older-history and narrow
states against DSH and exercises the actual WebView2 UI. A working trace, a nominal three-region grid,
or old screenshot/test acceptance does not establish G5 completion. D68-B's implementation must pass
that actual-window gate; automated source/component checks alone are insufficient.

Use the reference's compact Toolbar (32px), fixed three-lane Overview (50px) and ordinary rows (30px),
with a full-height Run browser, measured ledger, temporary resizable Inspector and closable narrow
drawer. Range/search/grouping use loaded real records; durable full-Run totals remain distinguished.
Missing timing is a start marker. Keep history anchors, current selection and reduced-motion cleanup.

HomeShell must preserve the last confirmed Monitor availability through a transient null connection;
otherwise unmounting discards the controller before its reconnect logic can restore selection. Initial
unknown must not expose the page or discard its requested route; confirmed DISABLED retains the normal
hide/navigation behavior. Follow [the availability contract](reactive-read-models.md).

## Streaming timeline: ordered activity and complete batch handoff

Tool names follow [Operation Presentation](../backend/operation-presentation.md): valid captured
`displayName` -> known fixed-tool Chinese name -> generic Chinese tool text. Never expose an unknown
canonical key or reconstruct an MCP name from it. The optional Timeline field is captured with the
Run's actual tools, survives persistence, and does not change model replay or call/result identity.
Live delivery follows [Foreground Chat Feedback](foreground-chat-feedback.md) and the
[Core activity/batch contract](../backend/foreground-chat-activity.md):

- Canonical history remains keyed by Timeline `seq`; pages are newest-first on the wire and deduplicated
  into display order. Read views never write another transcript authority.
- `chat.activity` carries stable language/tool `itemId` and accepted-message identity. `chat.send`'s
  acknowledgement `messageId` is distinct from a persisted row UUID. Keep exact acknowledgement,
  Character and physical client generation when settling requests or restoring drafts.
- One compact invocation entry interleaves with language, updates truthful phase/outcome in place, and
  remains in Chat history. Captured names survive handoff; old unlabeled rows retain conservative fallback.
- Buffer partial appends with presentation metadata. A complete `timeline.committed` batch or complete
  paged-history recovery atomically covers only that accepted message, preserving keys, focus and text
  selection. Never clear all activity when the first assistant row arrives or legacy completion fires.
- `chat.delta` remains a compatibility fallback when authoritative activity is absent. Receiving both
  channels cannot duplicate text; late callbacks from a retired message/client cannot erase current state.
- Reconnect restores subscriptions and bounded snapshots through reads. Stale/unavailable state remains
  truthful, does not replay mutations, and does not automatically open Pet.
- Scroll discipline (bottom-pinning, pause-on-scroll-up, the load-older hold and truthful paused-follow
  affordance) remains in [`reactive-read-models.md`](reactive-read-models.md) §(f). Pet additionally follows
  the segmented transcript and occupied-space motion rules in the foreground-feedback contract.

## Memory tidy result feedback

Operations uses `MemoryTidyFailureDetailsSchema` from Shared to recognize typed INTERNAL_ERROR data. Keep the canonical
request result separate from optional read-model refresh errors: a failed refresh cannot replace a successful or partial
mutation outcome. A new attempt clears its prior result, locks duplicate clicks and ignores retired-client settlement.
Known partial/failed outcomes refresh the affected read models and show actual saved edits plus Chinese reasons and
closed tool-error labels. The issue count describes unresolved tool operations, not every possible failure. Unknown
transport/deadline errors remain unknown; never replay tidy automatically or label a timeout as no changes.

Validate the controller's client replacement, duplicate-click and refresh-failure boundaries, component result/error
states, and a rendered production WS path carrying clean/ran and typed partial/failed outcomes. Scripted models prove
wiring; real-model behavior and owner UI acceptance are separate evidence.

## Rendering server-owned binary refs (images)

A timeline `image` part carries `{ mediaType, ref }` — **never bytes**. ONE render path for both live-attached and scroll-back images: a `use-attachment-image.ts` hook calls `media.get(ref)` lazily, cached in a module-level `Map<ref, Promise<dataURL>>` (one fetch per ref across all rows and re-mounts; evict on failure so it can retry). A `FORBIDDEN`/missing ref (TTL-expired image) degrades to a placeholder — **text stays authoritative** (the image's meaning already lives in memory as the vision description). The `<img src>` is a `data:` URL whose mediaType comes ONLY from the zod-parsed `MediaGetResult` closed enum.

## Markdown is default-safe (XSS surface)

Assistant AND user text render through ONE `markdown-view.tsx` = `react-markdown` + `remark-gfm`, used **default-safe**: NO `rehype-raw`, NO `rehype-sanitize`, NO `dangerouslySetInnerHTML`, NO `urlTransform` override, NO `components` prop that reintroduces raw HTML. react-markdown escapes raw HTML and defangs `javascript:`/`data:` hrefs by default; adding any of the above re-opens the hole. Keep a markdown XSS regression test (`markdown-view.test.tsx`) whenever this file changes. Wrap settled rows in `React.memo` so only the in-flight row re-parses each delta.
