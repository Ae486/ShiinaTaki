# Useful user-facing information: reference study and removal scope

Status: owner-confirmed G4 requirement, recorded 2026-09-05 during UI/UX planning. The owner explicitly
requires meaningless internal information to be removed from MCP/Skills and other user-facing pages,
including their expanded details. The earlier suggestion to put arbitrary technical data into a second
disclosure was not accepted. This document records source evidence and the implementation target;
production UI was not changed by this research. The subsequently approved first frontend slice is now
implemented and checked; see [its evidence](../../08-30-frontend-uiux-optimization/implementation-evidence-g4-2026-09-05.md)
for delivered scope and pending manual acceptance. Monitor and cross-layer naming remain separate.

G5 subsequently specifies a direct DSH Trajectory presentation port/rebuild for Monitor. The ordinary
tool-card comparisons below guide field relevance; they do not replace DSH Trajectory's layout,
styles and interaction as the Monitor template. G4 still excludes meaningless bookkeeping from the port.

## 1. What the local reference implementations actually show

| Reference | Verified rendering pattern | Transferable behavior |
|---|---|---|
| DSH ordinary tool cards | `references/deepseek-harness-master/packages/client/ui-tool/src/client/tool/toolviews/GenericToolCard.tsx:59` selects an operation summary, output and error summary, and omits a redundant arguments body for single-file tools. `tool/components/ToolRow.tsx:159` expands only when input, output or a structured card exists. | Detail is actual operation content: command/output, read content, search results, or an applied diff. An error can replace the collapsed summary. |
| Pi Bash | `references/pi-main/packages/coding-agent/src/core/tools/bash.ts:232` renders the command and timeout; `:276` bounds the collapsed output; `:301` exposes the full-output file path when present; `:315` adds elapsed time; `:457` retains the command exit code with output. | Keep the command, meaningful result, duration and failure information. Pi's generic renderer may pretty-print real arguments/results; structured business output is not inherently useless. |
| Pi Skills configuration | `references/pi-main/packages/coding-agent/src/modes/interactive/components/config-selector.ts:136,435,639,649` renders skill names, origin/scope, selection and enabled/project-override state. | Present what the skill is, where it applies, and whether it is active. No generic metadata-details panel is needed. Pi documents no built-in MCP, so this is a Skills reference, not evidence of its MCP management. |

DSH deliberately separates its ordinary card from the explicit Trajectory inspection route:
`ToolRow.tsx:293` opens inspection; `packages/client/ui-trajectory/src/client/TrajectoryTable.tsx:916`
offers Summary/Payload/Result/Schema/Timing. Some ordinary DSH fallback rows also expose a call ID
when arguments are empty (`tool/models/tool-call-model.ts:224`, `ui-skill/src/client/SkillRow.tsx:45`).
These exceptions are recorded honestly; the references do not prove that identifiers never appear.
They also do not justify copying bookkeeping fields into TakiAgent's user-facing details.

Evidence comes from local reference snapshots and current T4 source at HEAD `3c67fd5`; no reference
or packaged TakiAgent UI was run. Read-only reference and current-UI inventories were performed
separately. No new dependency, renderer implementation, or schema was introduced.

## 2. G4 field-selection rule

A displayed field must help the user understand the operation/target, configure something real, read
the input/result/error, assess a meaningful state/cost/timing, or choose the next action. Apply this
test to card faces, expanded details, Inspector tabs, tooltips, accessibility labels and copy controls.

- Remove content/payload hashes, internal revision/generation counters, opaque Host/Run/Attempt/Effect/
  call/response/approval identifiers, protocol schema versions and correlation bookkeeping. Hiding the
  same values under a disclosure or adding a copy button does not make them useful.
- Do not create a replacement raw-metadata/diagnostic panel for these removed fields. `FULL_LOCAL`
  controls data availability/privacy; it is not a requirement to render every field in the response.
- Keep actual tool inputs/results, commands, paths, diffs, errors, measured timing and usage when the
  relevant contract permits them. A hash explicitly requested as the tool's business result remains
  meaningful; this is not a substring filter over arbitrary result text.
- Keep user-editable namespaces such as an MCP server named `github`, real configuration keys needed
  to identify a setting, and relevant endpoint/command configuration. These differ from generated IDs.
- An actual software-package release version can be useful for compatibility or replacement. Do not
  invent one from a config revision, catalog generation or scanner version. Current standard Skill
  metadata has no dedicated package-version field.
- Render a curated set of useful fields, not an automatic dump of arbitrary metadata entries. Remove
  empty disclosures left after cleanup. Keep operation payloads and internal concurrency/identity data
  intact; this requirement changes presentation, not canonical records or mutation binding.

## 3. Current TakiAgent removal and replacement inventory

| Surface | Remove or replace | Current source anchor |
|---|---|---|
| MCP detail | Remove `configRevision`, `runtimeGeneration`, `ownerHostId`; retain selected tool names currently sharing the section. Replace generation-oriented service copy with readable availability wording. | `apps/desktop/src/windows/home/pages/mcp/mcp-server-card.tsx:46,68` |
| MCP test outcome | Remove transport enumeration page count (`outcome.pages` / 页列举). Keep tool count, meaningful result and duration. | Same file `:51` |
| Skills detail | Remove `ownerHostId`, `contentHash`, `configRevision`, `catalogGeneration` and the resulting empty technical disclosure. | `apps/desktop/src/windows/home/pages/skills/skill-card.tsx:82` |
| Skills inspect | Remove the catch-all `metadata.metadata` map dump. Select useful description, compatibility, license, declared tools and bounded relative file inventory instead. | Same file `:93,116` |
| Shared extension status | Remove shortened/full `coreHostId` and its copy control. Keep actual host availability and meaningful conflict warnings. | `apps/desktop/src/windows/home/extension-convergence.tsx:41` |
| Permission settings | Remove `policyGeneration` and `registryRevision` from badges/headings. Replace raw `capabilityId` and `cell.key` with descriptions based on the real governance semantics, including accessible labels. | `pages/settings/permission-level-card.tsx:27`, `permission-cells-card.tsx:22,27`, `permission-cell-row.tsx:60,77` under the Home source directory |
| Durable approvals | Replace raw capability/cell-key fallbacks with readable operation/target descriptions. Keep decision IDs internal to actions. | `apps/desktop/src/windows/home/pages/settings/approval-decisions-section.tsx:47` |
| Monitor Inspector | Remove user-facing rendering of the entire `inspector.technical` map, including IDs, seq/schema/source bookkeeping and payload digest. Keep meaningful semantic detail. | `apps/desktop/src/windows/home/pages/monitor/monitor-view.tsx:53`; producer inventory in `packages/core/src/observability/observability-query-service.ts:209` |
| Costume import feedback | Show a real readable character name when available, or omit the raw character ID; retain imported-costume count. | `apps/desktop/src/windows/home/pages/costume/costume-page.tsx:80` |

MCP command/args/cwd/URL and environment/header field names remain actionable configuration
(`mcp-server-editor.tsx:37`). Skills name/description/source/trust, validation/runtime outcome and
meaningful errors remain useful. Existing state, permission, redaction and single-writer rules apply.

## 4. Implementation ownership and acceptance

- Pure Desktop presentation removals fit the existing frontend task's boundary; Monitor-specific
  rendering stays with D68. If a readable name requires a missing safe Core projection, track that
  seam in the naming/approval workstream instead of widening the pure-frontend task silently.
- Preserve IDs used by React keys, selections, joins, requests, CAS and generation guards. For example,
  `expectedRevision` remains necessary for a mutation even when no revision number is displayed.
- Add no replacement diagnostic screen or automatic raw JSON dump. Tool-specific input/output
  presentation may show meaningful structured content within the existing disclosure/privacy contract.
- The semantic distinction must survive empty, loading, error, narrow-window and expanded states.
  Hidden metadata must not leak back through a tooltip, copy control, raw fallback or accessibility name.
- Validate the retained actions and conflict/refetch behavior as well as field absence; deleting the
  underlying protocol fields would break correctness while superficially cleaning the screen.

Existing tests that intentionally preserve the old presentation must be revised in the implementation
batch, rather than treating their old expectations as an override of G4:

| Test | Old assertion to replace |
|---|---|
| `apps/desktop/src/windows/home/pages/mcp/mcp-components.test.tsx:55,74` | Revision/generation/Owner copy and generation-oriented service copy |
| `apps/desktop/src/windows/home/pages/skills/skills-page.test.tsx:13,14` | Arbitrary metadata output, technical disclosure and Owner/hash/catalog-generation copies |
| `apps/desktop/src/windows/home/extension-convergence.test.tsx:19` | Shortened Core UUID and its copy control |
| `apps/desktop/src/windows/home/pages/settings/permission-components.test.tsx:21,30` | Policy-generation text and raw permission key |
| `apps/desktop/src/windows/home/pages/monitor/monitor-view.test.tsx:21` | Visible technical Event ID and copy control |

Update the corresponding folder `index.md` descriptions when implementation removes those sections.
Automated checks must exercise meaningful fields and still-bound actions; owner visual acceptance
must open the actual details rather than inspecting only card faces. No production tests were run
during this planning review; later implementation claims are limited to the linked slice evidence.
