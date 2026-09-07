# Operation names and approval presentation

Presentation explains an operation; it never identifies or authorizes its execution. This contract
covers the readable-operations A1/A2 boundary. D64's full command, masking, handshake and canonical
binding contract is in [command-approval-disclosure.md](command-approval-disclosure.md). Live tool
delivery/state reconciliation follows [Foreground Chat Activity](foreground-chat-activity.md) and the live-feedback task.

## 1. Scope / Trigger

Read this before changing capability/cell labels, Core/MCP approval copy, durable-decision labels,
captured tool names, Timeline tool presentation, or a consumer's unknown-name fallback. Preserve the
canonical governance, MCP generation and model replay contracts in the corresponding backend specs.

## 2. Signatures

Shared named exports in `governance-presentation.ts` and `tool-presentation.ts`:

```typescript
getCapabilityLabel(capabilityId: string): string;
getPermissionCellDisplay(cellKey: string): { label: string; description: string };
getKnownToolDisplayName(toolKey: string): string | undefined;
formatMcpToolDisplayName(input: { serverName: string; toolName: string }): string;
getValidToolDisplayName(value: unknown): string | undefined;
captureToolDisplayNames(
  names?: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> | undefined;
```

`PERMISSION_POSTURE_LABELS` and `PERMISSION_OVERRIDE_LABELS` map existing closed wire values to
Chinese text. They do not introduce policy values. Core's optional `ApprovalLabelResolver` receives
`readonly ApprovalDurableDecision[]` and returns `ReadonlyMap<string, ApprovalSafeLabels>` keyed by
the exact decision identity.

`ExtensionRunContext` and `AgentRunContext` carry optional process-local
`toolDisplayNames?: Readonly<Record<string, string>>`. Persistence accepts it as the third argument:

```typescript
appendTurn(characterId: string, messages: TurnMessage[],
  toolDisplayNames?: Readonly<Record<string, string>>): void;
```

Timeline `tool-call` and `tool-result` parts retain their canonical `toolCallId` and `toolName`, with
optional `displayName?: string`. No database migration, new environment key or authority digest is
introduced. `GovernancePolicyService.classifierMetadata(capabilityId)` returns the service registry's
`classifierId` and `classifierRevision` as a separate value, not mutable registry ownership.

## 3. Contracts

- Shared labels cover the complete canonical capability/cell vocabulary. Unknown keys produce
  generic Chinese text; never print a raw key as a fallback. Tool names remain precise when multiple
  tools share a capability. Factory posture, effective posture and override mode remain distinct.
- Approval names and binding data have separate paths. Revocation uses the exact `decisionId`;
  acknowledgement responses retain the exact disclosure revision without printing that revision.
  Do not add IDs, hashes or revisions to tooltips, copy controls or accessible names.
- Resolve durable MCP approval labels from one current snapshot per list. Match the exact
  `ownerHostId + subjectId + subjectRevision`, require a current valid generation, and reject an
  ambiguous duplicate binding. Missing labels do not change decision usability or hide the decision.
- Build initial and final Core approval scopes from the service-owned classifier metadata. Do not
  assume every non-MCP capability uses `fixed-risk`: configurable `write_file` uses `workspace-path`.
  This derivation changes no posture, path scope, digest rules or execution-count guarantees.
- Capture actual MCP server/tool names in the same `snapshotMcpExtensions` iteration as the tool
  closures. A registry's generated `ext_mcp_*` discovery key is not the direct-tool routing key, and
  registry budgets can omit entries. Never rebuild the name map from that registry projection.
- Freeze a copied name map at Run capture and retain it across attempts. Compatibility entry paths
  copy their trusted map at tool assembly before execution. Use own-key lookup, including for names
  such as `__proto__`; inherited object properties are not labels.
- A Run's captured name describes its attempted target even after replacement/retirement. This
  deliberately differs from the current-target check used by an approval list. Neither path consults
  a current catalog while persisting or reading an old turn.
- `turn-presentation.ts` enriches the existing canonical turn mapping. Ignore provider-supplied
  `displayName`; labels come only from the captured map or fixed Shared tool table. Preserve `content`,
  order, call identity and output. `TimelineRepo` retains valid labels and still removes raw call input.
- Model replay selects the original canonical fields explicitly. A label must never enter SDK
  `toolName`, replay input, permission matching, effect identity, prompt content or compaction state.
  Compaction's source digest excludes only tool-call/result `displayName`, preserving the v1 hash of
  unlabeled entries and all other source fields. Cosmetic labels cannot create a new operation;
  canonical content/output changes must still invalidate the captured source.
- Desktop renders a valid captured `displayName`, then a known fixed-tool Chinese name, then generic
  Chinese tool text. It never splits an old MCP routing key to guess a target.

## 4. Validation and error matrix

| Input or condition | Required result |
|---|---|
| Nonblank tool display name of at most 240 UTF-16 units | Preserve its exact value as optional presentation metadata |
| Missing, blank, non-string or overlong optional display name | Omit it; do not fail the otherwise valid Timeline write/read |
| Provider supplies a plausible or conflicting display name | Ignore it and use only the trusted captured/fixed source |
| Inherited name property | Ignore it; literal own keys are valid map keys |
| MCP approval target removed, replaced, stale, ambiguous or unavailable | Honest Chinese fallback; retain independent usability and revoke identity |
| Optional approval label resolver throws or returns invalid labels | Fall back safely; the durable list remains readable |
| Unknown canonical capability/classifier in an execution path | Existing governance failure remains fail-closed; presentation fallback cannot authorize it |
| Valid maximum-length MCP target in a live approval | Keep full target fields within their field limits; do not force it into the shorter capability/title bound |

Timeline label bounds use UTF-16 units. Existing live-approval title, subject and field bounds differ;
do not apply the 240-unit Timeline/list-label bound indiscriminately to every approval field.

## 5. Good / base / bad cases

- Good: a Run captures `search-server · search`; changing MCP configuration before persistence leaves
  that history name unchanged while a current approval list refuses to borrow a mismatched revision.
- Good: `write_file` under a configurable ask policy performs no write before approval and exactly
  one write after a valid single-use approval. Duplicate/late replies do not re-execute it.
- Base: an old fixed-tool row without `displayName` remains readable through the Shared table; an
  unknown old MCP key renders generic tool text with its canonical internal identity unchanged.
- Bad: reconstruct a display name from routing hashes, borrow another Host's target, or change an
  approval's usability because a current display name cannot be resolved.

## 6. Required tests

Registry completeness and exact classification descriptions; current versus historical MCP matching
and fallback; resolver failure; maximum live-approval names; unchanged bindings/usability/generations
and revoke/acknowledgement payloads; actual write-file ask/approval/once-execution; same-snapshot name
capture and immutability across replacement/attempts; own versus inherited map keys; invalid labels
and provider-name rejection; DB round-trip with raw-input removal; byte-equivalent canonical replay
and unchanged content projection; label-independent Compaction identity with canonical-change
detection preserved; fixed/unknown Desktop fallback.

These contract checks do not establish owner visual acceptance or implement live Chat/Pet tool-state
pairing. Keep those acceptance claims separate.

## 7. Wrong versus correct

```typescript
// Wrong: the target may have changed since the attempted operation.
const label = currentMcpCatalog.lookup(toolName)?.name ?? toolName;

// Correct: trust only the captured own-key value, then the fixed vocabulary.
const captured = names && Object.hasOwn(names, toolName)
  ? getValidToolDisplayName(names[toolName]) : undefined;
const label = captured ?? getKnownToolDisplayName(toolName) ?? "工具调用";
```

Source and evidence: `09-05-uiux-readable-operations` design/implementation records. The complete
authorization contract remains in [permission-authorization.md](permission-authorization.md).
