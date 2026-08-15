# ZCODE Leader Handoff - T4 Skills/MCP Productization

> Prepared on 2026-08-16 from the live `H:/TakiAgent-worktrees/t4` worktree.
> This is a point-in-time recovery document for ZCODE. Re-run every status and test command before acting.
> The durable program handoff remains `docs/HANDOFF.md`; this document adds the current dirty-tree, interrupted-work,
> and ZCODE takeover details that are not represented by committed history.

## 1. Takeover directive

ZCODE is taking over as the T4 Leader. The immediate product objective is still:

> MCP and Skills must be configurable and actually usable end to end.

This objective is broader than accepting configuration in a file. The operator must be able to manage extensions from
the product, the Agent must discover the resulting tools or Skills through the standard formats, and a real invocation
must execute through the common governance, Approval, Host, credential, and runtime-generation contracts.

The current child is Approval Productization, not MCP CRUD or Skill UI yet. Complete the one missing Host
challenge/resume vertical first because secure MCP execution and effectful Skill-mediated operations depend on it.
Then continue through Host secrets, MCP lifecycle, Skill lifecycle, and final discovery/integration in the frozen order.

Infrastructure work is acceptable only when it is required to make the Skills/MCP product truthful or is a direct,
reusable extraction from that requirement. Do not let Heartbeat, Scheduled Task, Autonomous Run, artifact transfer,
or a broad cross-Host product become the active deliverable before Skills/MCP acceptance.

## 2. Critical warning: do not commit the current tree as one change

The worktree contains two unrelated ownership groups plus this handoff document:

1. an uncommitted ZCODE/Trellis tooling bootstrap or migration; and
2. an incomplete Approval C+E production implementation left by a disconnected implementation agent.

Before this handoff file was added, `git status --porcelain=v1` reported 56 entries: 42 tracked diffs and 33 individual
untracked files, with Git collapsing several untracked directories into one status entry. Neither group has passed a
combined quality gate. The Approval group does not type-check end to end. Do not stage, commit, discard, clean, or
revert the tree wholesale.

First establish ownership of the ZCODE/Trellis files, recover the Trellis task binding, then review the Approval patch
against the current PRD. Preserve useful partial work surgically and complete or repair it in place. Treat every
unrecognized modification as user-owned until proven otherwise.

## 3. Live repository state

### 3.1 Worktrees and branches

| Purpose | Path | Live state on 2026-08-16 | Rule |
| --- | --- | --- | --- |
| T4 work | `H:/TakiAgent-worktrees/t4` | `task/t4-skills-mcp-productization` at `cac8f19` | Run all T4 edits and commands here. |
| Main TakiAgent work | `H:/TakiAgent` | `main` at `5dd6dd2`; two dirty Hindsight task documents | Read for coordination only; do not edit or clean it. |
| Hindsight repository | `H:/hindsight` | separate repository and owner | Do not edit, stage, commit, or clean it. |
| Legacy scratch worktree | `H:/TakiAgent/.claude/worktrees/agent-a0b3d2f31101f184a` | separate legacy branch | Do not use or remove it. |

At the snapshot, `git rev-list --left-right --count main...HEAD` returned `0 12`: T4 was 0 commits behind and 12
commits ahead of the local `main`. The owner has warned that `main` is now advancing in parallel, so this is not a
stable fact. Recheck it before every implementation wave and before touching a merge hotspot.

No push, reset, rebase, force operation, finish/archive, worktree cleanup, or final integration has been authorized or
performed for this initiative. Push remains a separate owner decision.

### 3.2 Trellis pointer drift

The local pointer file contains:

```text
.trellis/tasks/08-12-approval-productization
```

The task metadata also lists Approval Productization as `in_progress`. However, the currently modified Trellis tooling
reports no current task:

```text
python ./.trellis/scripts/get_context.py
# CURRENT TASK
# (none)

python ./.trellis/scripts/task.py current --source
# Current task: (none)
# Source: none
```

This mismatch appeared alongside the uncommitted Trellis/ZCODE migration. Diagnose the active-task resolver and
configuration before dispatching any agent. Do not blindly rewrite `.trellis/.current-task`; the pointer is already
correct for this worktree, and an unconditional rewrite could hide a tooling regression or bind the wrong authority
source.

### 3.3 Local environment

- Locked JavaScript workspace dependencies are present in this T4 worktree.
- `.env.local` is intentionally absent. Add only the minimum local secret configuration required by an approved real
  integration test, and never commit it.
- `references/` is a read-only-intent junction to local reference projects. Prefer those sources before external
  research and do not edit the referenced repositories from T4.
- The owner has explicitly allowed new dependencies or frameworks when they are the most efficient correct solution.
  This is not permission for scope expansion: update lockfiles, document the reason, check platform packaging, and
  verify the merged result.

## 4. Program map and status

The parent Trellis task is `.trellis/tasks/08-10-skills-mcp-productization`. It remains `planning` while its children
execute; that parent status does not mean no production work has occurred.

| Slice | Trellis child | Status | Current truth |
| --- | --- | --- | --- |
| 1. Authority/credential design | `08-12-authority-credential-design` | `planning` | Planning gate and authority model are frozen; no independent production deliverable is expected. |
| 2. Host-control foundation | `08-12-host-control-foundation` | `review` | Production committed at `7427edf`; unit/wire/process evidence is strong, but the final two-Node process proof is deferred to convergence. |
| 3. Governance Authority | `08-12-governance-authority` | `review` | Production committed at `46a8487`; retained in review because effective `ask` depends on Slice 4. |
| 4. Approval Productization | `08-12-approval-productization` | `in_progress` | Batch A and B+D are committed; C+E is interrupted and partially modified in the dirty tree. This is the active work. |
| 5. Host Secret Catalog | `08-12-host-secret-catalog` | `planning` | Not implemented. Required before secure MCP credentials. |
| 6. Secure MCP lifecycle | `08-12-secure-mcp-lifecycle` | `planning` | Not implemented. The shipped MCP path is still boot-oriented developer configuration. |
| 7. Standard Skill lifecycle | `08-12-standard-skill-lifecycle` | `planning` | Not implemented. Preserve portable `SKILL.md`; do not invent a Taki-only Skill format. |
| 8. Discovery/integration | `08-12-extension-discovery-integration` | `planning` | Not implemented. Owns final product convergence and deferred cross-process evidence, not unfinished child features. |

Only after these eight slices satisfy the product acceptance should the Leader formally advance the remaining T4
program: Autonomous Run/Run Receipt, Scheduled Task, Heartbeat, delivery/liveness, and Procedural Knowledge.

## 5. What is already committed and verified

The relevant T4 history, in order, is:

| Commit | Meaning |
| --- | --- |
| `a7f1783` | Frozen Skills/MCP implementation plan. |
| `7427edf` | Generation-safe Host-control foundation. |
| `46a8487` | Unified Governance Authority. |
| `929a9e4` | Approval Productization planning artifacts. |
| `cd67ad0` | Approval Batch A canonical durable authority state. |
| `f05efd4` | Check investment scaled to actual slice complexity. |
| `2c1c4e5` | Approval B+D connection-owned interactive lifecycle. |
| `cac8f19` | Approval interactive checkpoint recorded in Trellis/HANDOFF. |

### 5.1 Host-control foundation

`7427edf` established the common execution spine:

- stable Core/Node Host identity and explicit Host-qualified routing;
- Core-assigned connection generations and complete Host catalog publication;
- immutable operation control with policy/Approval generations, exact input digest, deadlines, and attempt identity;
- per-Host/per-generation settlement, cancellation, bounded terminal caches, and no automatic replay;
- strict Shared/Rust protocol fixtures; and
- real Core/Node reconnect and capability process coverage.

Recorded gates passed workspace type-check/lint, Shared 232 tests, Core 1,215 tests plus one existing skip, Rust 148
tests, Clippy with `-D warnings`, scoped rustfmt, diff checks, Core boot, reconnect, and one live capability request.
Explicit two-Host routing is covered in Core tests, but a real simultaneous two-Node process scenario is still a final
Slice 8 gate.

### 5.2 Governance Authority

`46a8487` established one extension-neutral authority:

- canonical capability identity and descriptor registry;
- Core SQLite global Level/overrides with optimistic `policyGeneration`;
- complete Host policy projection with Host-local stricter-only enforcement evidence;
- one governed-tool wrapper across Core, MCP, Host, and Skill-mediated actions; and
- deny-only legacy compatibility. Legacy allows cannot widen current authority.

Recorded gates passed all workspace type-check/lint/tests, Rust 155 tests and Clippy, locked Node build, and the full
E2E suite at 23 passed / 6 skipped. Effective `ask` intentionally remained fail-closed until Approval Productization.

### 5.3 Approval Batch A and B+D

`cd67ad0` added the sole durable Approval repository/service, migration 015, global `approvalGeneration`, canonical
binding/digests, inert historical-row handling, optimistic mutation semantics, and fail-closed compatibility types.
It was formally checked.

`2c1c4e5` then added:

- exact physical-`Connection` ownership for pending prompts and session grants;
- targeted request/closed notifications and FIFO Desktop/CLI prompt controllers;
- canonical respond/list/revoke methods and explicit future-background acknowledgement for always-allow;
- timeout/cancel/disconnect/policy invalidation;
- post-Approval Governance and full-lineage revalidation before releasing the raw closure;
- Core-local and standard AI SDK MCP interaction through the same Approval authority; and
- prevention of new raw tool input timeline writes plus legacy read sanitization.

The Leader gate passed Shared/Core/CLI/Desktop type-checks, Shared 254 tests, focused Core 130 tests, CLI 36, Desktop
386, Desktop production build, changed-file lint, diff checks, and production header audits. The implementation agent
also passed the full Core suite at 1,290 tests plus one existing skip. Packaged WebView interaction and real
Core/operator process E2E remain unverified. Existing historical raw tool inputs are hidden from current reads but not
physically scrubbed.

## 6. Current interrupted Approval work

### 6.1 Agent state

No subagent is currently running. The previous direct implementation agent's response stream disconnected. Its intended
path was:

```text
Host ask classification
  -> capability.challenge
  -> Core provenance validation
  -> existing single Approval interaction
  -> capability.resume
  -> one Host execution
  -> terminal authorization lineage
```

The path was not completed or verified. Do not infer completion from the presence of new schemas.

### 6.2 ZCODE/Trellis bootstrap ownership group

The following changes appear to belong to a ZCODE/Trellis setup or migration, not Approval production:

- deletion of `.codex/hooks/statusline.py`;
- modifications to `AGENTS.md`, `.gitattributes`, `.trellis/.gitignore`, `.trellis/.version`,
  `.trellis/.template-hashes.json`, `.trellis/config.yaml`, `.trellis/workflow.md`, and many
  `.trellis/scripts/**` files;
- new `.trellis/agents/**` and Trellis common helpers; and
- new `.zcode/**` hooks, agents, commands, skills, and configuration.

Do not mix these files into an Approval feature commit. Confirm whether they are the intended ZCODE bootstrap, review
their migration/compatibility impact, and explain the current-task resolver regression. Do not remove them merely to
make the feature diff smaller.

Relevant takeover files include:

- `.zcode/config.json`
- `.zcode/agents/trellis-implement.md`
- `.zcode/agents/trellis-check.md`
- `.zcode/agents/trellis-research.md`
- `.zcode/commands/trellis/continue.md`
- `.zcode/commands/trellis/finish-work.md`
- `.trellis/agents/implement.md`
- `.trellis/agents/check.md`

The ZCODE agent templates already include a recursion guard. Preserve and enforce it.

### 6.3 Approval partial-production ownership group

The current production patch modifies or creates these areas:

- Shared protocol: `packages/shared/src/host-approval-schema.ts`, its tests, Host-control schemas/APIs/exports,
  protocol fixtures, and protocol version 3;
- Core Approval/capability routing: `approval-interaction-service.ts`, `route-capability.ts`,
  `capability-broker-state.ts`, and `capability-response.ts`;
- Rust protocol: `host_approval_protocol.rs`, `host_control_protocol.rs`, `protocol.rs`, and `Cargo.toml`; and
- required module indexes in Shared and Tauri.

The direction worth retaining after review is:

- an immutable `HostOperationControl` plus nested `CapabilityAuthorization`;
- separate strict Host Approval schemas rather than bloating the base control DTO;
- Host-control protocol version 3;
- domain-separated canonical control/challenge digests;
- TypeScript/Rust golden fixtures;
- terminal authorization lineage; and
- strict Rust UUID/time parsing using the added `uuid` and `time` crates.

### 6.4 Proof that the partial vertical is incomplete

Live commands run on 2026-08-16 produced:

| Command | Result |
| --- | --- |
| `pnpm --filter @taki/shared typecheck` | Passed. |
| `pnpm --filter @taki/shared exec vitest run src/host-approval-schema.test.ts src/protocol-fixtures.test.ts` | Passed: 2 files / 56 tests. |
| `pnpm --filter @taki/core typecheck` | Failed. |
| `cargo test --locked host_approval_protocol --lib` from `apps/desktop/src-tauri` | Did not compile because `Cargo.lock` needs an update. |
| `git diff --check` | Passed. |

The Core failures are structural, not test noise:

- `CapabilityRouteDeps` now requires `approval`, but `main.ts` and existing tools/tests do not provide it;
- `route-capability.ts` passes `connection`, `approval`, `operator`, and `isCurrent` to
  `CapabilityBroker.request`, while the live `CapabilityDispatchTarget` does not declare them;
- `capability-broker-state.ts` and `capability-response.ts` exist but are not integrated;
- no Core `capability.challenge` method exists;
- no Core `capability.resume` notification path exists;
- Rust `ws_client.rs` still returns terminal `APPROVAL_REQUIRED` for `ask`;
- Rust `host_session.rs` has no stored challenge/input and no one-time resume consumption;
- Host tool construction is not yet per-turn/initiating-operator aware; and
- terminal authorization lineage is represented in DTOs but is not enforced end to end.

The new Rust dependencies are allowed by the owner's prior approval, but `Cargo.lock` must be updated deliberately and
the platform build/test gates must pass before the change is considered usable.

## 7. Exact remaining Approval scope

Complete one minimal C+E Host/convergence vertical. It must satisfy all of the following:

1. The Host classifies exact input as `auto`, `ask`, or `deny` under the projected policy and any stricter local floor.
2. `ask` emits a strict `capability.challenge`; it never opens a Host-native or Shell prompt.
3. Core validates Host identity, physical connection generation, catalog, policy, Approval generation, immutable
   control, challenge digest, decision scope, and current routing provenance.
4. Core uses the existing single `ApprovalInteractionService` and targeted operator connection. Do not add a second
   dialog, decision file, or session store.
5. Core mints a short-lived authorization bound to the exact control, challenge, scope, generation, and expiry.
6. Core sends `capability.resume` to the same current Host connection.
7. Rust revalidates the authorization and all current local constraints, consumes it once, then executes at most once.
8. Replay, tamper, expiry, cancellation, policy/Approval mutation, reconnect, and disconnect fail closed.
9. The terminal response carries authorization lineage, and Core validates it before settling success.
10. Exact legacy denies remain effective. Legacy allows remain inert until explicit reconfirmation through the current
    canonical identity and current future-background disclosure.
11. Pending raw input remains memory-only and absent from logs, audit, timeline, cache, persistence, error payloads,
    crash diagnostics, and run history.
12. Historical raw timeline data must have an explicit final privacy disposition: prove read sanitization is sufficient
    for the stated acceptance, or implement a focused idempotent scrub with migration/reopen evidence.
13. Add focused Shared/Core/Rust tests and real process evidence for the vertical.
14. Run one final direct xhigh `trellis-check` only after the whole Approval slice converges.

Do not add Heartbeat, Scheduled Task, Autonomous Run, broad cross-Host failover, artifact transfer, or MCP/Skill product
screens inside this Approval slice.

## 8. Frozen decisions and the corrected architecture direction

### 8.1 Standard extension formats

- MCP remains standard MCP through the installed `@ai-sdk/mcp` path. Productization wraps standard discovery and raw
  tool execution with configuration, lifecycle, governance, credentials, and operator surfaces; it does not replace
  MCP with a Taki protocol.
- Skills remain portable `SKILL.md` packages with confined resources. A Skill supplies procedure and suggested tools;
  it never grants permission and is not a replacement authority system.
- Progressive discovery is required: bounded metadata first, Skill detail and permitted tools only when relevant.

### 8.2 Why the work mentions migrating Shell permissions instead of adding a third system

The live repository started with fragmented permission/Approval paths: legacy Shell/native Gate decisions and an older
Core/MCP Approval path. Skills/MCP productization needs one common authorization answer across Core tools, MCP tools,
Host OS capabilities, and Skill-mediated use. Simply adding a new Skills/MCP permission store would create a third
authority whose precedence, revocation, prompts, and durable decisions could disagree with the first two.

The frozen design therefore converges authority rather than inventing another product:

- Core owns the single global policy ceiling, durable Approval authority, desired extension registry, and Run truth.
- An Execution Host owns its Workspace, Skill/MCP runtimes, secrets, and local OS capabilities.
- The Host may enforce a stricter local/managed floor and performs final local validation, but it cannot widen Core
  authorization, persist a second allow, or show another prompt.
- Exact legacy denies remain a compatibility floor. Legacy allows and process-global sessions are inert and require
  explicit reconfirmation into the canonical Core authority.
- The old modules can remain as deny readers or test compatibility fixtures while production composition stops using
  them as independent authorities.

This is not a Shell rewrite for its own sake. It is the minimum convergence needed so a configured MCP tool or a
Skill-mediated effect cannot bypass, duplicate, or contradict existing protection.

### 8.3 Host and connection model

- One profile has one active Core Authority. Local and VPS Core are explicitly rebound, not active-active or silently
  failed over.
- Every Run has one immutable `primaryHostId`; each cross-Host operation names its target Host explicitly.
- Paths, display labels, and model text never select a Host implicitly.
- Availability is not authorization. Reconnect creates a new generation and never silently replays a side effect.
- Pending Approval/session scope belongs to one physical operator `Connection`, not a user-supplied `deviceId` and not
  a global UI store.

### 8.4 Credentials and MCP runtime state

Three state planes are frozen:

1. Core SQLite stores desired sanitized MCP metadata, owning `hostId`, selected tools, opaque secret references,
   enabled state, and `configRevision`.
2. The owning Host stores encrypted secret values. Secret mutation uses a dedicated sensitive path and returns only
   presence/provenance/sanitized diagnostics.
3. Candidate/active/draining runtime generations, clients, leases, and close state are Host-local in-memory truth and
   are never restored from disk as executable state.

MCP reload must use candidate validation, last-good publication, immutable Run snapshots, lease acquisition before
dispatch, no new leases to draining generations, bounded close, and exactly-once client ownership. A stale Run closure
fails closed; it is not silently redirected to a replacement generation.

## 9. Leadership corrections from the prior discussion

The owner explicitly rejected the previous resource and delegation pattern. Preserve these corrections:

1. The earlier Leader over-fragmented a conceptually bounded feature into too many batches and checks. That increased
   coordination cost without changing engineering scope.
2. Allowing implementation agents to spawn further implementation/check agents created recursive delegation,
   ownership ambiguity, repeated context loading, and long delays. This was a serious leadership error.
3. The main Leader is the only dispatcher and owns the global plan, PRD truth, task split, shared docs, HANDOFF,
   requirements review, merge decisions, and final quality statement.
4. Use one direct high-effort implementation agent for a coherent slice or convergence wave. Use one direct xhigh
   check agent after meaningful slice convergence. Do not run one formal check per internal batch by default.
5. Internal batches are fail-closed implementation boundaries, not mandatory agent boundaries. Simple work should go
   through one implementation pass and one final check; complex work can retain internal checkpoints without repeated
   outsourcing.
6. Resource reduction must not mean rushed code. Preserve strict contracts, focused regression tests, real process
   evidence where it matters, and final end-to-end acceptance. Avoiding preventable debug and rework is part of cost
   control.
7. Multi-Host and shared harness work is valid only where demanded by actual Skills/MCP execution or directly reusable
   by later T4 work. It must not displace the current product acceptance or grow into speculative Heartbeat work.
8. Do not interrupt a running agent without a material conflict, safety issue, or clear scope failure. If a session is
   interrupted but still resumable, resume it instead of replacing it. At this takeover no previous agent is running.

The prior work on Host generations, common Governance, physical-connection Approval, and the process harness is useful
and requirement-driven. It prevents configured extensions from becoming boot-only metadata or bypassing authority.
The error was orchestration and prioritization, not the existence of those contracts. ZCODE should retain the useful
foundation while driving visibly toward user-configurable, actually invocable MCP and Skills.

## 10. Master operating rules

- Communicate with the owner in Simplified Chinese.
- Write code, comments, commits, engineering documents, and agent prompts in English.
- Work only in `H:/TakiAgent-worktrees/t4` for T4. Never modify `H:/TakiAgent` or `H:/hindsight` from this session.
- Read known files directly. For an unknown code location, use one broad English `jbcontext search`, inspect the hit and
  nearby code, then use at most one narrowed `jbcontext search -p <path>` retry.
- **YCE is absolutely prohibited.**
- Prefer `references/` local material before external MCP search. Do not invent framework behavior.
- Do not repeat the three completed Skills/MCP research studies or reopen owner-frozen product choices without new,
  contradictory live evidence.
- Preserve user changes in a dirty tree. Never use destructive Git cleanup as a way to simplify review.
- Do not push, reset, rebase, force, finish/archive, or clean worktrees without the applicable owner authorization.
- Do not mark manual acceptance criteria passed unless the owner actually performed or confirmed them.
- Keep project documentation current. Every changed production source file must retain the established top-level
  `INPUT` / `OUTPUT` / `POS` header convention where applicable, and every affected source folder `index.md` must be
  updated. This is existing project practice, not a new constraint.
- Update `docs/HANDOFF.md`, the relevant Trellis task artifacts, reusable specs, and the developer journal at real
  convergence points. Do not create documentation ceremony for trivial intermediate edits.

## 11. Direct subagent rules

Only the ZCODE Leader may dispatch agents. Implement/check agents must never spawn children.

### 11.1 Dispatch policy

- One direct `trellis-implement` agent at high effort for the remaining coherent Approval C+E vertical.
- One direct `trellis-check` agent at xhigh effort after the complete Approval slice converges.
- No recursive delegation, no agent chains, and no independent dispatcher inside a subagent.
- Do not dispatch until the Trellis current-task mismatch and dirty-file ownership are understood.
- Implement/check agents may edit their assigned scope but may not commit, push, or merge.

### 11.2 Prompt requirements

Every prompt and follow-up to an agent must be in English and must state:

- active task and exact objective;
- owned files or responsibility boundary;
- required PRD/research/spec/code sources;
- frozen contracts and explicit exclusions;
- `YCE is absolutely prohibited.`;
- the `jbcontext` rule for unknown code and direct reads for known files;
- no child-agent spawning;
- no commit, push, merge, reset, rebase, force, finish/archive, or cleanup;
- expected focused verification commands; and
- a report that separately identifies completed, incomplete, unverified, extra/unrequested work, and residual risks.

The Leader must first compare the report to the assigned requirements, then separately decide whether any unrequested
change is justified. Do not accept a green summary without inspecting the live diff and evidence.

## 12. Required reading order

ZCODE should read these in order before modifying production code.

### 12.1 Operating law and live recovery

1. `AGENTS.md`
2. `.trellis/workflow.md`
3. `docs/ZCODE-HANDOFF.md`
4. `docs/HANDOFF.md`
5. `CONTEXT.md`

### 12.2 Skills/MCP product and frozen engineering plan

6. `.trellis/tasks/08-10-skills-mcp-productization/prd.md`
7. `.trellis/tasks/08-10-skills-mcp-productization/info.md`
8. `.trellis/tasks/08-10-skills-mcp-productization/research/current-gap-and-dependency-map.md`
9. `.trellis/tasks/08-10-skills-mcp-productization/research/standards-and-reference-prior-art.md`
10. `.trellis/tasks/08-10-skills-mcp-productization/research/vps-secret-backend-options.md`

### 12.3 Active Approval child

11. `.trellis/tasks/08-12-approval-productization/prd.md`
12. `.trellis/tasks/08-12-approval-productization/info.md`
13. `.trellis/tasks/08-12-approval-productization/research/live-approval-lifecycle-map.md`
14. `.trellis/tasks/08-12-approval-productization/implement.jsonl`
15. `.trellis/tasks/08-12-approval-productization/check.jsonl`

Also read `.trellis/tasks/08-12-governance-authority/research/live-governance-migration-map.md` to preserve the
implemented Slice 3/4 boundary.

### 12.4 Executable specs

16. `.trellis/spec/backend/host-operation-lifecycle.md`
17. `.trellis/spec/backend/permission-authorization.md`
18. `.trellis/spec/backend/server-push-and-connection-auth.md`
19. `.trellis/spec/backend/mcp-tool-schema-compatibility.md`
20. `.trellis/spec/backend/tool-design.md`
21. `.trellis/spec/backend/logging-guidelines.md`
22. `.trellis/spec/backend/e2e-harness.md`
23. `.trellis/spec/backend/database-guidelines.md`
24. `.trellis/spec/frontend/home-window.md`
25. `.trellis/spec/frontend/state-management.md`
26. `.trellis/spec/frontend/type-safety.md`
27. `.trellis/spec/frontend/operator-connection-recovery.md`

### 12.5 Later T4 and multi-end remote context

28. `.trellis/workspace/pleia/t4-second-grill-prep.md`
29. `docs/adr/0010-separate-autonomous-run-history-from-relationship-timeline.md`
30. `docs/adr/0009-single-memory-authority-with-local-replica.md` and `docs/MEMORY-DESIGN.md` only when the later T4
    work crosses the provider-neutral Memory boundary.

The critical multi-end model is defined across `CONTEXT.md`, Host operation lifecycle, server push/connection auth,
frontend operator recovery, the parent technical plan, and the live Core/Rust files listed below. Do not infer remote
semantics from WebSocket DTO shape alone.

## 13. Live code reading map

Read current files and their focused tests before changing them.

| Concern | Primary code |
| --- | --- |
| Core Host pending owner | `packages/core/src/capabilities/capability-broker.ts` |
| Interrupted Core state split | `capability-broker-state.ts`, `capability-response.ts`, `route-capability.ts` |
| Canonical Approval interaction | `packages/core/src/approval/approval-interaction-service.ts`, `approval-runtime.ts` |
| Core composition and tools | `packages/core/src/main.ts`, `packages/core/src/agents/chat-agent.ts` |
| Physical connection authority | `packages/core/src/server/connection-registry.ts`, `ws-server.ts` |
| Shared Approval/control wire | `packages/shared/src/approval-schema.ts`, `host-control-schema.ts`, `host-approval-schema.ts`, `host-control-api.ts` |
| Governance identity/policy | `packages/shared/src/governance-registry.ts`, `packages/core/src/governance/governance-policy-service.ts` |
| Rust Host protocol/session | `apps/desktop/src-tauri/src/host_control_protocol.rs`, `host_approval_protocol.rs`, `host_session.rs`, `protocol.rs` |
| Rust execution/composition | `apps/desktop/src-tauri/src/ws_client.rs`, `node.rs`, `lib.rs`, `gate.rs` |
| Desktop operator transport | `apps/desktop/src/lib/ws-client.ts`, `ws-client-routes.ts`, `ws-client-methods.ts` |
| CLI operator prompt | `apps/cli/src/approval-prompt.ts`, `apps/cli/src/main.ts` |
| Timeline privacy | `packages/core/src/agents/turn-mapping.ts` and its read/write callers/tests |
| Process evidence | `e2e/src/fixture/with-stack.ts`, `operator-drivers.ts`, `ws-relay.ts` |
| Existing governance E2E patterns | `e2e/src/governance-authority.e2e.test.ts`, `governance-stale-projection.e2e.test.ts` |

When the later slices begin, re-run code discovery rather than assuming locations, then curate each child context.
Likely future areas include `packages/core/src/mcp/**`, `packages/core/src/skills/**`, Home settings/page registries, Host
secret adapters, Shared extension schemas, and Agent tool assembly.

## 14. First ZCODE session checklist

Perform this sequence before an implementation dispatch:

1. Confirm the exact worktree, branch, HEAD, `main...HEAD`, worktree list, and both worktree statuses.
2. Read the live `.trellis/.current-task`, run `get_context.py`, then run `task.py current --source`.
3. Diagnose why the modified active-task resolver ignores a valid local pointer. Record the cause and intended ZCODE
   bootstrap ownership; do not mask it with a pointer rewrite.
4. Review `git status`, `git diff --stat`, `git diff`, and untracked files. Separate tooling ownership from Approval
   ownership before staging or further edits.
5. Read the required documents and the existing broker/Host execution code. Do not repeat the completed research.
6. Re-run the Shared focused gate, Core type-check, Rust locked focused test, and diff check to establish a fresh
   baseline.
7. Review the partial schema/state split for correctness, especially canonical TypeScript/Rust serialization parity,
   optional `subjectLabel`, timestamp acceptance, and lockfile changes.
8. Complete one technical plan for the remaining vertical. It should name exact state transitions, invalidation hooks,
   privacy boundaries, tests, and rollback/fail-closed points without creating another product decision cycle.
9. Report the recovered status and concrete implementation boundary to the owner in Chinese.
10. Dispatch one direct high-effort implement agent only after the above is stable. Do not let it spawn children.

Recommended live commands:

```powershell
Set-Location 'H:\TakiAgent-worktrees\t4'
git status --short --branch
git log -3 --oneline --decorate
git worktree list
git rev-list --left-right --count main...HEAD
Get-Content -Raw '.trellis\.current-task'
python ./.trellis/scripts/get_context.py
python ./.trellis/scripts/task.py current --source
git diff --stat
git diff --check
```

## 15. Approval convergence verification

Use focused gates while implementing, then one formal slice check. At minimum, prove:

- TypeScript/Rust protocol parity for valid and invalid challenge/resume fixtures;
- same physical operator connection ownership even when two sockets claim the same `deviceId`;
- exact Host/connection/catalog/policy/Approval/control/challenge binding;
- one prompt and one effect under normal allow;
- zero effects for deny, wrong connection, tamper, replay, expiry, reconnect, disconnect, cancellation, or mutation;
- one-use authorization and correct duplicate/late response handling;
- stricter Host floors and exact legacy denies remain effective;
- old allows do nothing before explicit canonical reconfirmation;
- sentinel raw input is absent from SQLite, decision files, logs, audit, timeline, caches, error responses, and crash
  diagnostics; and
- real Core/operator/Host process behavior, not only DTO round trips.

Final Approval gates should include affected workspace type-check/lint/tests, full relevant package suites, Rust tests,
Clippy with `-D warnings`, formatting, locked Node/Desktop builds where affected, focused real-process E2E, header/index
audits, size limits, and `git diff --check`. Use the single xhigh `trellis-check` for this converged slice.

Known technical risks requiring explicit review:

- TypeScript/Rust canonical JSON parity, including optional `subjectLabel` omission;
- Zod datetime acceptance versus Rust RFC 3339 parsing;
- Approval generation/policy listeners currently use append-only arrays without unsubscribe semantics;
- per-turn initiating operator context must not make ambient or future Heartbeat work raise a prompt;
- Host pending input/challenge must remain memory-only while surviving the intended in-process resume;
- interruption and forced close of side effects can produce `outcome_unknown`, never fabricated rollback;
- historical timeline raw-input disposition;
- packaged WebView interaction and the deferred real two-Node process scenario; and
- semantic conflicts if `main` advances in shared composition, schemas, migrations, or Home transport.

## 16. Merge and synchronization protocol

Before each coherent implementation wave or edit to a known hotspot:

1. Recheck `main...HEAD` and both worktree statuses.
2. Do not merge while the T4 tree contains mixed unreviewed ownership. First establish a clean, reviewable checkpoint
   for each owned group with the owner's applicable authorization.
3. If `main` advanced, integrate it through normal Git history from the T4 worktree. Preserve both semantic contracts;
   never choose an entire side merely because it resolves the textual conflict.
4. Re-evaluate append-only SQLite migration numbers, Shared exports, `packages/core/src/main.ts`, Agent tool assembly,
   Desktop WS routes, Home registries, `CONTEXT.md`, specs, HANDOFF, and the journal.
5. Rerun focused tests for every conflict seam plus the final cross-module gate.

Expected hotspots with main/Hindsight work are:

- `packages/core/src/main.ts`
- `packages/core/src/agents/chat-agent.ts`
- `packages/shared/src/index.ts` and adjacent schemas/indexes
- `packages/core/src/db/migrations/index-list.ts`
- `apps/desktop/src/lib/ws-client*.ts`
- Home page/settings registration
- `CONTEXT.md`, `.trellis/spec/**`, `docs/HANDOFF.md`, and the developer journal

Do not copy patches manually between worktrees. Do not touch the dirty Hindsight task documents in `H:/TakiAgent`.

## 17. Product acceptance after Approval

### 17.1 MCP acceptance

Secure MCP lifecycle is complete only when the product can demonstrate:

- add, inspect, edit, enable, disable, remove, test, and reconnect a standard MCP server;
- secret fields stored through the owning Host credential catalog without secret echo;
- selected raw tools and collision-safe model-facing identities;
- candidate validation, last-good generation replacement, leases/draining, bounded close, restart reconciliation, and
  truthful failure diagnostics;
- a Home management surface using fresh Core/Host state; and
- an actual Agent turn discovering and invoking a configured MCP tool through Governance and Approval.

### 17.2 Skill acceptance

Standard Skill lifecycle is complete only when the product can demonstrate:

- import/discovery of a portable `SKILL.md` package;
- inspect, enable, disable, and remove;
- trust/quarantine and confined package resources;
- progressive metadata/detail loading and truthful tool suggestions;
- a Home management surface using authoritative state; and
- an actual Agent turn using `load_skill` and following the enabled Skill without treating it as permission.

### 17.3 Final integration

Slice 8 must converge extension discovery, Host ownership, restart/reconnect, operator surfaces, migration, security
evidence, real Agent execution, and the deferred two-Node Host proof. It must not become a dumping ground for unfinished
MCP or Skill feature implementation.

## 18. Handoff completion state

At the time of this document:

- **Completed and committed:** Host-control foundation, Governance Authority, Approval canonical state, and
  Core/MCP/Desktop/CLI connection-owned Approval interaction.
- **In progress but incomplete:** Approval Host challenge/resume, legacy/privacy convergence, and real process proof.
- **Unverified partial work:** the current uncommitted protocol v3/Rust/Core broker patch.
- **Not started in production:** Host Secret Catalog, secure MCP management/runtime lifecycle, standard Skill
  management/lifecycle, and final extension integration.
- **Separately in progress:** uncommitted ZCODE/Trellis tooling migration that currently breaks active-task discovery.
- **Not part of the current deliverable:** formal Autonomous Run, Scheduled Task, Heartbeat, and later T4 product work.

The next useful milestone is not another design loop. It is a recovered Trellis/ZCODE environment plus one complete,
fail-closed, tested Host Approval challenge/resume vertical, followed by the single final Approval check. After that,
move directly toward the user-visible Host Secret Catalog and secure MCP lifecycle.

## 19. Owner authority rulings for the ZCode Leader (2026-08-16)

Recorded from the live owner session after takeover. Where they conflict with stricter earlier
defaults in this document or `docs/HANDOFF.md`, these rulings supersede.

1. **Effort naming**: "xhigh/high" were Codex model-effort labels. ZCode equivalents are
   最高/高. The Leader plans the actual per-dispatch thinking depth; the labels are not
   mechanically binding.
2. **Stop protocol / goal mode**: the owner drives via goals, not step approvals. Commit at task
   milestones so history stays traceable and rollback-capable. The Trellis task lifecycle
   (create/start/finish/archive) is Leader-decided.
3. **Merge authority**: only the T4 worktree is currently active; `main` will not advance for
   now. Merging the T4 branch into `main` is a Leader decision whenever the result is
   conflict-free or the conflicts are resolvable while preserving both semantic contracts.
   Push is optional and may be omitted entirely; staged commits and rollback capability are
   the actual requirement.
4. **Code search**: whether to use `jbcontext` is Leader-decided; direct reads are acceptable
   when confidence is high. The YCE prohibition is unchanged.
5. **Milestone reports**: after each milestone task completes, archive a report as the work
   trace. When the next task breakdown is already clear, proceed directly per the process
   without interrupting the owner.

Standing honesty rule (Leader operationalization, not a new owner grant): owner-manual
acceptance items are never marked passed without the owner's actual observation. They are
recorded as "pending owner verification" in reports and archives; they gate release claims,
not further implementation.
