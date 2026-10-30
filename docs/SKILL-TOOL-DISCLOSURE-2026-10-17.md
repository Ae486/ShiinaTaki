# Skill tool progressive disclosure

Date: 2026-10-17. Worktree: `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`, base HEAD
`06a8090`. This record describes the authorized disclosure and analysis-inventory slice, not completion of the entire
media integration or a comprehensive M49 review. Existing unrelated changes and the historical task pointer were
preserved; no task creation/binding, commit, push, archive, dependency upgrade or database migration was performed.

## Delivered mechanism

Dedicated integration tool schemas previously remained in ordinary model requests. The generic Agent hook
`ChatAgentDeps.skillTools` now associates trusted product-registered tool bundles with captured Skills. Full successful
Skill loading reveals its small bundle on the next SDK model step; unrelated bundles remain hidden. Each new generation
starts from the ordinary tool set, while original conversation history and tool results remain intact.

The implementation uses installed **AI SDK 7.0.17 `ToolLoopAgent.prepareStep` / `activeTools`**. The full governed
registry still owns execution. MCP definitions stay in their captured Run context and reuse existing connections;
`extension_describe` exposes one exact original direct key on the following step. No second Agent, queue, conversation,
tool execution engine, permission system, discovery model call or per-query connection check was introduced.

| Layer | Owner and relationship |
| --- | --- |
| Standard Skill package | SKILL.md plus lazy supporting resources describe when/how to act. They cannot register arbitrary native handlers or grant permissions. |
| Trusted native registration | Existing product composition creates schemas/handlers and associates small bundles using `skillTools`. |
| MCP registration | Existing selected server, Host, generation and governed captured closures remain authoritative. |
| Disclosure | SDK selects active schemas from successful results in this generation, not historical text. |
| Execution | Existing Core/Host Governance, approval, Effect, abort and generation checks still apply. |
| Analysis query | The existing Co-Watching catalog supplies registered result references; native work is unchanged. |

Model-facing `load_skill` uses the captured extension Skill closure rather than a fresh same-name loader. This avoids
crossing a replaced catalog generation even when package bytes are identical. Unknown, stale, failed, resource-only or
incomplete loads do not activate bundles. Same-response hidden calls are rejected by the SDK before execution. Generic
permitted non-primary bundles work without fake user messages; Co-Watching control itself stays primary-only.

Initial request/compaction measurement uses the visible subset. Actual later-step provider telemetry remains the source
for usage. D70 continues to defer same-loop **message reduction**; this change never rewrites `prepareStep` messages.

## Reference choices

See [reference research](research/SKILL-TOOL-DISCLOSURE-REFERENCES-2026-10-17.md) and the
[independent review](research/SKILL-TOOL-DISCLOSURE-REVIEW-2026-10-17.md).

- Pi separates extension registration from the active tool set; Hermes/OpenClaw reuse policy-scoped discovery and
  ordinary dispatch. Taki uses those boundaries through its existing registry and SDK.
- Standard Agent Skills/Anthropic Skill packaging distinguishes instructions, resources and executable registration.
- [OpenAI tool search](https://developers.openai.com/api/docs/guides/tools-tool-search) and
  [AI SDK tool search](https://ai-sdk.dev/docs/ai-sdk-core/tool-search) describe newer deferred-loading APIs. The actual
  installed `ai@7.0.17` export check found `toolSearch` undefined, so no dependency upgrade or invented API was used.
  [SDK loop control](https://ai-sdk.dev/docs/agents/loop-control) supplies the already installed selection mechanism.

This is provider-neutral schema filtering; it does not claim native OpenAI/Anthropic deferred-reference/cache behavior.

## Co-Watching inventory

`manage_co_watching({ action: "list_analyses", instruction: null })` is in the `taki-co-watching` bundle. Query guidance
ships in `integrations/taki-co-watching/references/tools.md`, imported with SKILL.md through immutable package replacement.

The result explicitly states **`scope: core_registered_analyses`**. It returns analysisId, title and exact BV/CID/page.
Operator registration can precede native verification; listing is not proof of current upstream success/availability.
The original proposed `core_verified_analyses` label was corrected after checking the actual registration producer.

Listing does not accept watching, submit/reconcile native requests, read complete analysis content or run preparation.
It works without playback/native availability. Empty inventory and failed reads are distinct. Existing exact-source and
service matching, retained-request reconciliation and result verification still run when a result is actually consumed.

## Automated validation

| Check | Result |
| --- | --- |
| Core full suite, `pnpm exec vitest run --maxWorkers=4` from packages/core | 471 files / 3,890 tests passed; 2 existing skips |
| Shared full suite | 71 files / 662 tests passed |
| Core + Shared typecheck | Passed; Core repeated after final inventory changes |
| Scope ESLint and tracked diff whitespace checks | Passed |
| Final inventory/disclosure suite after empty/offline/failure cases | 2 files / 21 tests passed |
| Extension context/disclosure/name tests after initial loading guidance | 4 files / 35 tests passed |
| Shared tool/governance presentation after query label update | 2 files / 44 tests passed |

The first unrestricted full-suite run had two 5-second timeouts in the existing SQLite reopen and privacy-source-scan
tests. Lowering worker concurrency passed the complete suite without changing assertions/timeouts. Later small changes
received the focused gates shown above; the earlier full-suite number does not include the two newly added inventory cases.

The provider-wire test serializes real OpenAI-compatible requests through the installed adapter with simulated SSE.
It proves schema omission/next-step inclusion/reset at the actual request-body boundary, not a paid-model result.

## Live verification

The existing isolated profiles, model `deepseek-flash`, browser, Shell and native service were reused. Only idle Core
processes were restarted; the Skill was immutably replaced at configuration revision 8 with both package files.

Two ordinary inventory phrasings in the retained conversation selected unrelated `exec` directory commands instead of
loading the Skill. The first command was denied; the second turn was cancelled before execution. Both native inventory
and accepted Co-Watching root counts remained unchanged. These attempts are **not successful query acceptance**.
Initial extension context now explains hidden schemas/current-generation loading before the Skill body is read.

The diagnostic follow-up explicitly requested the installed Co-Watching Skill and captured only outgoing tool names and
instruction-presence booleans, never credentials or message bodies. It **passed**:

- Actual Home ACK: Run `807f0b5d-6841-4ae3-874a-908454f02242`, message `05aec21b-c405-40d3-a51b-12ed00812cc5`.
- First request contained 22 ordinary/discovery tools including `load_skill`, with no `manage_co_watching` or direct
  native MCP schema. All three flags confirmed current Skill metadata, extension context and loading instructions.
- Successful `load_skill` returned the captured package; the next request contained 23 tools, adding exactly
  `manage_co_watching`. It returned both existing references: `BV1UEaq6qEZt` and `BV1BTP5euE75`, both page 1.
- No shell workaround, child Run, Co-Watching acceptance or native request. Native rows remained **4**, accepted roots
  **13**, and `coWatching.read.session` remained null. No foreground video playback was needed for this query.
- Actual model choices were `load_skill`, `manage_co_watching`, and two avatar expression calls. All five provider
  requests reported usage: **129,420 tokens**. The two unsuccessful earlier probes reported 70,815 and 23,279 tokens;
  all three query attempts total **223,514 reported tokens**, with no new native video-analysis call. Cost was not reported.
- Evidence: `.runtime/co-watching-invitation-20261016/disclosure-after-20261017-130600.json` and
  `disclosure-wire-1792242265537.jsonl`; corresponding `chat-inventory_guided-*.json` contains the actual ACK.

This proves the real Skill/tool capability and schema boundary. It does not establish reliable automatic Skill selection
for a plain inventory question in this long retained conversation. The actual request flags rule out missing initial
metadata/instructions in the successful diagnostic, while source tracing found no context-field drop. History influence
is plausible but was not isolated experimentally; do not state it as a proven root cause. No history was cleared to
manufacture success. Further model/tool-selection tuning remains open, separate from voice/spoiler style.

The temporary fetch tap is confined to `.runtime` and is disabled in the final ordinary Core launch. The independent
review recorded and corrected the registered-versus-verified wording defect. A later reviewer-resume failed at its
provider boundary; the primary agent checked the actual `chat.send` -> Run context -> ChatAgent path directly.

Final Core launch: PID **16740**, `2026-10-17T13:07:36.532365Z`, ordinary `node packages/core/src/main.ts` without the
diagnostic preload. Boot reported one active Skill and four published native MCP tools, and the existing clients
reconnected. Logs: `.runtime/co-watching-invitation-20261016/core-20261017-130736.*.log`. Final scoped ESLint and tracked
whitespace checks passed. Query/control presentation now reads "查询分析或管理共看"; it changes no Governance authority.

## Remaining boundaries and operation

- Existing discovery budget: **128 captured descriptors**. Overflow schemas remain hidden; no automatic eager fallback
  or unlimited/paginated model discovery was added. Core retains internal closures for its existing governed work.
- New Skill-specific tools should use the generic bundle facility. Existing unrelated ordinary tools were not all
  reclassified. Runtime handler registration remains product/extension/MCP-owned, outside the standard Skill format.
- The catalog is Core-registered references, not all historical BiliNote jobs. This query does not fetch full content.
- Earlier real same-video reuse is recorded in `MEDIA-CO-WATCHING-INVITATION-2026-10-16.md`; it is separate from these
  disclosure/query tests. Broader media S6 work and the overall Co-Watching business-boundary/M49 review remain open.
- Deploy by starting the existing Core command and importing both Skill files through the existing package lifecycle.
  No new dependency/env/schema is required. Keep original isolated Shell profile spelling and credential identity.
- Rollback uses the previous reviewed code/package version with an idle Core; never edit published Skill bytes in place
  or reset this dirty worktree. No stored conversation, analysis or native request requires migration.

Executable contract: [tool disclosure](../.trellis/spec/backend/tool-disclosure.md).
