# Readable operation and approval contracts — 2026-09-05

Status: source-backed planning for the owner-approved second UI/UX batch. G4 frontend cleanup is the
current implementation task. This record is not evidence that naming or D64 has been implemented.
Source snapshot: T4 HEAD `3c67fd5`, with the separate G4 Desktop edits in progress. Search-index hits
were verified against current files; no conclusion relies on the older index revision alone.

## 1. Presentation is separate from authority

`packages/shared/src/governance-registry.ts:28` is the code-owned authority vocabulary: 19 capability
descriptors and 31 cells. `permission-level-schema.ts:29` accepts syntactically valid cell strings,
but `governance-registry.ts:135` resolves whole registered keys. Do not derive risk meaning by splitting
an identifier. A Shared presentation module may map those complete keys without adding fields to the
strict authority descriptor schema.

| Capability family | Registered cells |
|---|---|
| `shell-open` | `url-safe`, `local-file`, `local-exec`, `blocked`, each under the `shell-open:` prefix |
| `exec` | `simple-allowlisted`, `compound`, `shell-reentry`, `allowlist-miss`, `blocked`, each under `exec:` |
| `fs-write` | `in-workspace`, `dir-root`, `outside-root`, `skill-hook`, `sensitive`, `self-escalation`, each under `fs-write:` |
| Fixed Host capabilities | `screenshot`, `screenshot-ambient`, `process-list`, `clipboard-read`, `clipboard-write`, `foreground-window` |
| Extensions | `skill-load`, `mcp-tool-call` |
| Fixed Core/Workspace capabilities | `get-current-time`, `schedule-manage`, `memory-search`, `memory-write`, `memory-archive`, `avatar-set-expression`, `avatar-play-motion`, `workspace-read` |

Keep levels, postures, approval-memory and override-mode semantics distinct. Known values are
`strict/standard/relaxed`, `auto/ask/deny`, `rememberable/once-only`, and
`ordinary/second-confirm/immutable`. Preserve the existing level/cell callbacks, second confirmation
and generation checks. Human wording must describe the classifier, not promise capabilities it lacks.

Subject identity has no independent `kind` enum: `governance-schema.ts:12` defines only `subjectId`
and `revision`. Only `skill.load` and `mcp.tool.call` require it; `governance-evaluator.ts:21` rejects
both absent required subjects and unexpected subjects. Display labels must never change this rule.

## 2. Existing safe-label seams

`approval-decision-schema.ts:91` already permits optional `ApprovalSafeLabels` with `capability` and
`subject` strings (each 1–240 characters; at least one must exist). Labels are deliberately absent
from canonical scope/binding serialization, digests, decision usability and persistence.

`packages/core/src/approval/approval-decision-service.ts:40,77` already accepts a map keyed by
`decisionId` in `list(labels?)`. The existing test at `approval-decision-service.test.ts:221` proves
labels can enrich the list without entering the stored authority snapshot. The production
`approval-interaction-service.ts:189` currently calls `authority.list()` without them. Use a bounded
label resolver at that projection seam instead of changing approval storage or authorization.

MCP target resolution must match `ownerHostId + subjectId + subjectRevision` against a current
`McpManager.snapshot()` entry (`mcp-manager.ts:30`). `mcp-tool-identity.ts:27` hashes server/tool into
the subject ID; it cannot be decoded. `mcp-candidate.ts:211,227` binds the subject revision to actual
public configuration and sets `ref.serverName` to the user-entered server namespace. This namespace
is useful configuration identity, not a generated UUID or a separately supplied display name.

Historical bindings intentionally tolerate old string grammar and revisions. A missing, removed,
changed or unavailable target must have honest generic Chinese fallback text, creation time,
usability and revoke action as applicable. **Do not display a raw identifier even in this fallback.**
Do not borrow a name from a different Host/revision, infer it from a hash, or introduce a new persistent
label authority merely to make every old row look resolved.

## 3. Live approval and tool naming consumers

- `core-tool-governance-adapter.ts:16,89` has an explicit model-tool-to-capability binding table and
  a separate `corePresentation(key)` helper. Keep the binding table intact; use a pure presentation
  lookup for Chinese operation text. Multiple memory tools share one authority capability, so a
  capability label cannot replace a more precise known tool name everywhere.
- `mcp-turn-tools.ts:122` already receives the real `McpToolRef`. Chinese titles/section labels can
  retain the actual server and tool as content. Keep full tool names in bounded value fields; the
  title/capability/subject limits differ and must not be confused with the 240-character list labels.
- `approval-schema.ts:30` currently bounds field values/risk summaries at 500, field and section labels
  at 80, title/capability at 120, subject at 160, fields at 12 per section, sections at 8. Avoid a new
  schema revision for plain translation or metadata removal.
- `pages/settings/permission-cell-row.tsx`, `permission-cells-card.tsx` and
  `approval-decisions-section.tsx` consume the shared display map while retaining canonical inputs.
- `components/approval/approval-dialog.tsx` currently shows the internal disclosure revision in the
  acknowledgement. Remove the displayed revision while keeping the exact revision-bearing response
  and explicit future-background-use acknowledgement.

Chat history currently carries only `toolCallId/toolName/input/output` in `TimelinePartSchema`
(`packages/shared/src/timeline-schema.ts:34`). MCP model-facing keys are sanitized routing keys, not
authority identities or a reliable reversible server/tool representation. Full target-name support
must use captured producer identity or an explicit safe presentation projection; never guess by
splitting a model key. Coordinate that producer/consumer contract with the live-feedback child and
preserve model replay inputs. The naming batch must explicitly account for N5 at this boundary.

## 4. D64 command disclosure is a separate reviewed slice

`apps/desktop/src-tauri/src/ws_challenge.rs:18,48` currently seals a classification-only presentation.
The sealed raw command remains in `PendingChallengeRecord.input`; `command_of` in
`capabilities_impl/exec.rs:59` exposes it locally without changing execution. The Core tool's command
input is an unbounded nonempty string (`packages/core/src/capabilities/exec-tool.ts:25`).

`packages/shared/src/host-approval-schema.ts:92` includes presentation in the challenge digest;
`ws_challenge.rs:75` checks the exact stored control/challenge/scope digests on resume. D64 must build
the permitted command representation from that same request before sealing. Display formatting must
never become executable input, and changing display text must not retarget an authorization.

The existing renderer uses ordinary text paragraphs; multiline/long commands require deliberate
readable formatting and bounded complete disclosure. Do not silently truncate a command and present
the preview as the complete action being approved. Secret/credential/path policy and maximum-size
handling must be resolved in D64's design, using existing redaction rules where they actually exist.
Never copy raw input wholesale merely because `sections` accepts strings.

`gate.rs:320` and its command-audit tests require the original command in the restricted Shell audit,
not general tracing. The D64 gate must prove sealed-display tamper detection, denial without execution,
one-shot resume, stale/expired invalidation, and preserved raw-command audit. D63 compound execution
remains a separate recorded problem; this presentation work does not loosen parser/sandbox policy.

## 5. Required verification

- Complete mapping against all registry capabilities/cells, with classifier-backed descriptions.
- Unknown/historical/removed-target fallback without opaque IDs or exceptions that break list reads.
- Exact MCP Host/subject/revision matching; no label-induced authority/digest/generation change.
- Maximum valid server/tool names within both presentation and list-label bounds.
- Existing permission and approval action/controller tests plus Shared/Core/Desktop checks.
- D64 additionally needs Rust/Shared parity, redaction/bounds and real command-approval lifecycle tests.
- Actual UI/owner acceptance remains distinct from static markup and deterministic contract tests.
