# Readable operation and approval design

## 1. Scope, sources and review boundary

The owner approved this UI/UX workstream and child creation. Implement in three reviewable slices:
A1 shared names/permissions/Core-MCP approvals, A2 captured tool names in conversation history, and
B D64 Host command disclosure. A1/A2 are checked; main selected B's policy A under the owner's
2026-09-06 execution delegation. B production starts after its source-backed adapter design review.

Source contracts: [current map](research/contract-map-2026-09-05.md), parent G1–G5 research, Shared
governance/approval schemas, `core-tool-governance-adapter.ts`, `mcp-turn-tools.ts`, and the existing
frontend consumers. [D64's concrete proposal](research/d64-disclosure-policy-proposal-2026-09-05.md)
records that separate decision and implementation constraints. G4 cleanup is already checked in the
frontend child and must not be reverted by this work.

## 2. A1 — shared display vocabulary

Add a pure Shared presentation module separate from `CANONICAL_GOVERNANCE_REGISTRY`. It must expose
the following stable consumer API through the package's named public exports:

```typescript
getCapabilityLabel(capabilityId: string): string;
getPermissionCellDisplay(cellKey: string): { label: string; description: string };
getKnownToolDisplayName(toolKey: string): string | undefined;
formatMcpToolDisplayName(input: { serverName: string; toolName: string }): string;
// Closed display maps indexed by the existing wire values, never new policy values:
PERMISSION_POSTURE_LABELS; // auto / ask / deny
PERMISSION_OVERRIDE_LABELS; // ordinary / second-confirm / immutable
```

Split capability/cell descriptions and tool display helpers into cohesive files if useful; do not
create a general-purpose utility bucket. The exact registry keys stay private display lookup inputs,
not visible fallback text. Unknown capability/cell strings produce generic Chinese descriptions;
unknown model-tool keys return `undefined` so consumers choose an honest generic tool label.

Coverage is all 19 capabilities and 31 cells. Tool labels cover the explicit Core binding table plus
actual fixed Host/extension tools where used. Keep distinct tool meanings even when authority is
shared (for example `recall` and `reflect`). MCP names come from real namespace/tool sidecars, with
`server · tool` formatting; do not decode hashes or split model routing keys.

Classifier-backed terminology:

| Cell | Short display name |
|---|---|
| `exec:simple-allowlisted` | 符合允许规则的单条命令 |
| `exec:compound` | 复合或无法解析的命令 |
| `exec:shell-reentry` | 启动命令解释器 |
| `exec:allowlist-miss` | 其他单条命令 |
| `exec:blocked` | 命中拦截规则的命令 |
| `shell-open:url-safe` | 打开网页或邮件链接 |
| `shell-open:local-file` | 打开普通本地文件 |
| `shell-open:local-exec` | 打开程序或特殊路径 |
| `shell-open:blocked` | 不支持或无效的打开目标 |
| `fs-write:in-workspace` | 写入工作区文件 |
| `fs-write:dir-root` | 写入额外指定目录 |
| `fs-write:outside-root` | 写入指定范围之外 |
| `fs-write:skill-hook` | 写入技能或钩子目录 |
| `fs-write:sensitive` | 写入敏感位置 |
| `fs-write:self-escalation` | 修改助手权限配置 |

Descriptions must preserve the evidence: URL classification checks the scheme, not content safety;
special paths include UNC/extensionless targets; allowlist-miss includes resolver/file-type/local-mode
cases; Compound includes invalid quoting and currently fails in the separate executor (D63).
`gate/fs_write_class.rs` is foundation-only; the current write-file tool supports Workspace writes.
Do not describe changing a reserved cell as enabling a capability that has not been implemented.
Actual posture comes from Core and is shown separately from the category description.

## 3. A1 — approval label production and presentation

Reuse `ApprovalSafeLabels` and `ApprovalDecisionService.list(labels?)`; no database/schema migration.
Enrich the list at `ApprovalInteractionService` using an optional injected read-only label resolver.
Resolve a batch of decisions per list call, so the MCP snapshot is read once rather than once per row.
The Core approval service must not import a live MCP manager or classify permissions itself.

The MCP adapter builds a current safe-name index by exact `ownerHostId + subjectId + subjectRevision`.
Connect that source through the existing composition root after MCP boot, with no new WS method or
authority store. A default resolver can supply generic capability names when no source is installed.
Historical/removed/unavailable names remain a valid list with honest fallback, not a guessed target
or an error that hides every decision. Do not label a decision invalid merely because name resolution
failed; use the existing `usability` independently.

A1 source review also found an existing binding-construction defect: `governed-tool.ts` assigns
`fixed-risk` to every non-MCP request, while the configurable `write_file` path is registered with
`workspace-path`. When that cell is set to ask, approval construction can fail before the operator
sees it. Correct only this derivation: source classifier identity/revision from current service-owned
registry metadata, retain all policy/scope semantics, and regress the actual ask/approval/once-execute
path. `read_file` is currently immutable/auto and is not a user-configurable ask example. Memory
outcome normalization remains outside this task.

Core and MCP live approvals use the same display vocabulary and Chinese title/risk/section labels.
Keep real MCP server/tool names as fields. A 128-character valid tool name fits a 500-character field
but not the 120-character capability label; use the fixed capability label plus full target fields.
Safe list labels must satisfy their own 240-character bounds. No raw input, generation or binding ID
is added to presentation or persisted.

Desktop adopts the shared cell/capability/posture/override labels. Factory, override, effective result,
reset, immutable and second-confirm behavior remain distinct and preserve existing callbacks/values.
Use ordinary Chinese to describe fixed safety limits. Long-term approval rows show useful names,
creation time and existing usability where helpful, and always preserve the exact revoke target.
Fallback text does not expose IDs in main text, tooltips, copy controls or accessible names.

Remove the visible disclosure revision from the acknowledgement while retaining its exact internal
revision-bearing response and explicit future-background-use consent. Host challenge content remains
B's responsibility; translating Core/MCP requests must not mutate an already sealed Host payload.

## 4. A2 — captured tool names and history

Current `TimelinePart` stores canonical model-tool keys, while MCP's direct ToolSet keys are sanitized
routing names. The display name must be captured with the same MCP snapshot/tool closures, not looked
up from a later configuration when a turn finishes or history is read.

Extend the process-local MCP/Extension Run context with a frozen tool-key-to-display-name map using
the `McpToolSnapshot.ref` values already available in `snapshotMcpExtensions`. Pass that map through
`ExtensionRunContext` and `createRunSnapshotCapture` into `AgentRunContext`. It is presentation data,
not a new source of execution authority or a change to the persisted RunSnapshot binding/digest.

Use the optional `toolDisplayNames?: Readonly<Record<string, string>>` context field for compatibility
with existing injected contexts. Capture it alongside `directTools` from the same snapshot iteration;
do not derive it from `registry.snapshot.entries`: its generated `ext_mcp_*` discovery keys differ from
the actual `directTools` routing keys, and registry budgets can omit entries. MCP candidates themselves
do not supply a direct-tool `modelKey`. Freeze the value and use own-key lookups rather than inherited
object properties. Names captured for a Run stay valid descriptions of that attempted target even if
the runtime later retires; this differs deliberately from current-target approval-list resolution.

Add an optional bounded `displayName` to timeline tool-call/result parts. Enrich only names during
turn persistence from the captured map or the known fixed-tool display table. Preserve the existing
canonical `toolName`, call ID, output and order. `TimelineRepo.sanitizeParts` must retain the allowed
display name while still dropping raw call input; `toModelMessage`/`toSdkToolResult` already select
canonical fields explicitly and must not start replaying UI labels or arguments.

Bound `displayName` to the existing safe-label maximum of 240 UTF-16 units. Invalid or overlong
optional display metadata is omitted without failing conversation persistence; it never replaces the
canonical model-tool key. The producer selects its own trusted label source rather than accepting a
provider-supplied `displayName` field. Preserve exactly the prior model-facing `content` projection.

The combined check found one adjacent compatibility seam: Compaction's existing source digest hashes
Timeline parts wholesale. Exclude only the new tool `displayName` from that canonical-source hash so
labels cannot change the durable Compaction operation identity. Preserve unlabeled v1 digest bytes
and every other source field; a real canonical content/output change must still change the digest or
fail stale-source validation. This is A2 metadata isolation, not a Compaction policy/lifecycle redesign.

The ConversationStore optional presentation input and TurnOutcome pass-through must remain <=3
parameters and preserve existing callers. Prefer a small dedicated enrichment helper over growing
ChatAgent's runtime body. If another live entry path bypasses Run capture, capture its trusted label
sidecar at its existing assembly seam; never fall back to a current-catalog lookup at persistence time.

Desktop renders `displayName`, then a known fixed-tool name, then generic Chinese tool text for old
unresolved entries. It does not decode old MCP routing keys. Historical rows without the new field
remain readable; no database rewrite is required. This slice does not change tool state pairing,
stream delivery or result semantics, which belong to the live-feedback child. That child consumes
the same captured-name contract for live events, ensuring no label flip at persistence handoff.

## 5. B — D64 policy A and compatibility gate

The linked proposal now selects policy A under delegated authority. The executable slice must specify supported
masking rules, full command segmentation, visible escaping, sanitized immediate refusal, old-Host
compatibility, exact challenge binding and original-command execution/audit. A1/A2 do not authorize
expanding D63 or claiming universal secret detection. Preserve the selected policy's stated limitation.

## 6. Verification and rollback

A1 tests cover registry completeness, precise labels, unknown/history fallbacks, maximum valid names,
exact MCP matching, no label-induced binding/digest/usability/generation changes, and still-bound
permission/revoke/disclosure actions. A2 tests cover captured names across MCP replacement, optional
field DB round-trip, raw-input scrubbing, byte-equivalent canonical replay and legacy entries.

Run relevant Shared/Core/Desktop suites, workspace typecheck, root lint and Desktop build. B adds
Rust/Shared parity, redaction/bounds, challenge/authorization and real-process exec tests. Actual
WebView2 and owner visual acceptance remain separate gates. Rollback removes presentation additions
without rewriting historical authority, changing permission policy or reverting the prior G4 cleanup.
