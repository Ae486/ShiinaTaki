# TakiAgent T4 Leader Handoff — Skills/MCP First

> Updated 2026-08-13 after Slice 3 commit and Slice 4 planning convergence. T4 remains isolated in its dedicated
> worktree. Host-control and Governance Authority are committed and retained in `review`; Approval Productization is
> the active `in_progress` child with five independently fail-closed batches. The branch must not be released between
> Slice 3 and Slice 4. Read the live repository before trusting any recorded status.

## 1. Mission and boundary

The incoming session owns the T4 program from the dedicated worktree. Its first initiative is the end-to-end
productization of Skills and MCP because Scheduled Tasks, Heartbeat, unattended governance, and Procedural Knowledge
must depend on a truthful extension surface rather than the current boot-only developer configuration.

The Host-control and Governance Authority children now implement the generation-safe execution spine plus Core-owned
durable global policy, canonical adapters, Host projection/evidence, deny-only migration, and the Home operator view.
They do not yet implement canonical Approval decisions/challenge-resume, secret storage, MCP CRUD/reload, Skill
lifecycle, Scheduled Tasks, Heartbeat, Autonomous Runs, Run Receipts, or Memory adapters.

The immediate job is therefore:

1. preserve and extend the committed Host-control contracts;
2. execute the remaining evidence-driven Trellis children through implement, proportional check, spec update, and
   closeout;
3. converge secure MCP and standard Skill lifecycle work through the final integration child; and
4. only then create and execute the formal T4 Autonomous Run/Scheduler/Heartbeat task family.

Do not restart the completed product Grill and do not repeat the three existing Skills/MCP research studies.

## 2. Repository and worktree topology

| Purpose | Path | Branch / state | Rule |
| --- | --- | --- | --- |
| T4 Leader work | `H:/TakiAgent-worktrees/t4` | `task/t4-skills-mcp-productization` | Run every T4 command here. |
| Main TakiAgent work | `H:/TakiAgent` | `main` | Memory/Hindsight coordination and other mainline work continue here. Do not edit it from a T4 session. |
| Hindsight upstream patch | `H:/hindsight` | local `main`, dirty compatibility patch | Separate Git repository. T4 must not edit, stage, commit, or clean it. |
| Legacy Claude scratch worktree | `H:/TakiAgent/.claude/worktrees/agent-a0b3d2f31101f184a` | dirty legacy branch | Do not use or remove it without a separate ownership review. |

Shared TakiAgent checkpoint: `3d8a320c5a3aea72ed3ee504c910adee10a5e2b1`
(`chore: checkpoint parallel T4 development baseline`). Both `main` and the T4 branch were created from this commit.
The commit is a mergeable parallel-work baseline; it is not a declaration that every included task passed manual
acceptance.

Current live status:

- `main` remains at `5dd6dd2` and is not ahead of the T4 branch; nothing was pushed;
- the T4 branch contains the frozen planning commits and Host-control production commit `7427edf`;
- `.trellis/.current-task` is intentionally ignored by Git and is independently bound in each worktree;
- the main worktree remains bound to `08-09-hindsight-compatibility-extensions`;
- the T4 worktree is bound to child task `08-12-approval-productization`, which is `in_progress` after its approved
  planning convergence; `08-12-governance-authority` and `08-12-host-control-foundation` remain in `review`, and the
  parent remains `planning` while children execute; and
- locked workspace dependencies are installed only inside the T4 worktree; `.env.local` remains absent.

Ignored local resources are intentionally handled as follows:

- `references/` is a read-only-intent junction to `H:/TakiAgent/references` so the existing Hermes and other reference
  checkouts are available without duplication. Do not edit reference repositories from the T4 worktree.
- `node_modules/` is not shared. Before the first build/test, install the locked workspace dependencies inside the T4
  worktree so concurrent package state cannot leak between branches.
- `.env.local` is not copied or linked. Add only the minimum local secret configuration when an approved integration
  test actually requires it; never commit or expose it.

Always refresh these facts with Git and Trellis commands. They are expected to change while the two workstreams run.

## 3. Current parallel work

### 3.1 D59/D61 reliability

The shared checkpoint contains the D59/D61 WebSocket recovery and request-deadline implementation. Its one formal
Trellis check passed the recorded automated gate: 238 files / 1,793 tests, workspace type-check, lint, Desktop build,
Core boot smoke, and diff/size/header audits.

It is still an open task because owner manual checks 96-105 have not all been recorded. Do not mark it complete,
archive it, or reinterpret the checkpoint as manual acceptance. T4 inherits only its established connection-generation
foundation and the bounded G2-12 residual: passive half-open and sleep/resume liveness must retire the existing
generation and restore through D59, never create a second reconnect system.

### 3.2 Memory/Hindsight program

The active main-worktree task is `.trellis/tasks/08-09-hindsight-compatibility-extensions`. In the separate Hindsight
repository, Slice 0A and PostgreSQL Slice 0B have Leader acceptance; Slice 0C and the final combined gate remain the
recorded next work. Treat that statement as a handoff clue and verify the live task and repository.

The Hindsight production patch has no T4 production-file overlap because it lives under `H:/hindsight`. Later
TakiAgent Memory provider children can overlap T4 integration seams. The main merge hotspots are expected to be:

- `packages/core/src/main.ts`;
- `packages/core/src/agents/chat-agent.ts`;
- shared schema exports and indexes under `packages/shared/src/`;
- Home/operator WS routes under `apps/desktop/src/lib/ws-client*.ts`;
- Home page registration and shared operator UI;
- `CONTEXT.md`, `.trellis/spec/**`, `docs/HANDOFF.md`, and the developer journal.

Treat those as coordination points. Do not assume that worktree isolation eliminates semantic conflicts.

### 3.3 T4 Skills/MCP program

The owner approved implementation after the planning report. The program is decomposed into eight slices:

1. authority/credential design gate;
2. Host-control foundation;
3. governance authority;
4. Approval productization;
5. Host secret catalog;
6. secure MCP lifecycle;
7. standard Skill lifecycle; and
8. extension discovery/integration convergence.

Slice 2 is committed as `7427edf` (`feat: add generation-safe host control`). It adds the canonical Host-control wire,
strict TypeScript/Rust golden fixtures, stable Core/Node Host identity, Core-assigned connection generations, complete
catalog publication, explicit Host routing, generation-owned broker settlement, cancellation/unknown-outcome behavior,
and bounded duplicate/late caches. The reusable executable contract is in
`.trellis/spec/backend/host-operation-lifecycle.md`.

Recorded gates for this commit:

- workspace typecheck and root lint passed;
- Shared passed 19 files / 232 tests;
- Core passed 173 files / 1,215 tests, with 1 existing skip;
- Rust passed 148 tests plus Clippy `-D warnings` and scoped rustfmt;
- `git diff --check` passed; and
- the real `withStack` reconnect and `process-list` scenarios passed, covering Core boot, identity creation, Host
  negotiation/catalog publication, same-Host reconnect, and one live capability request/response.

Do not overstate coverage: the existing fixture starts one Node, so a real two-Node process test for simultaneous
same-capability routing remains unverified. Core unit tests cover explicit two-Host routing and cross-Host provenance.
Rust cooperative cancellation suppresses accepted late settlement but cannot forcibly abort arbitrary blocking OS work.

Slice 3 has a live reconnaissance, owner-review PRD, implemented technical design, and curated implement/check context:

- `.trellis/tasks/08-12-governance-authority/research/live-governance-migration-map.md` maps the three current authority
  stores, both prompt paths, migration hazards, and exact code seams;
- its `prd.md` and `info.md` freeze the extension-neutral identity/descriptor/evaluator contract, Core SQLite and
  `policyGeneration`, complete Host policy projection, deny-only legacy compatibility, and the Slice 3/4 boundary;
- standard MCP over `@ai-sdk/mcp` and portable `SKILL.md` are explicit non-replacement requirements; and
- `implement.jsonl` and `check.jsonl` are curated for a high-effort implement agent and xhigh-effort check agent.

Slice 3 production code is verified across Shared, Core, Rust, Desktop Home, and the process harness and committed as
`46a8487` (`feat: add unified governance authority`). The final automated gates passed: workspace typecheck/lint/tests
(Shared 251, CLI 32, Desktop 370, Core 1,255 + 1 skip), Rust 155 tests, Clippy `-D warnings`, locked `taki-node` build,
full E2E 23 passed / 6 skipped
/ 0 todo, and `git diff --check`. The test-only bounded WS relay proves stale-generation and same-generation
valid-digest projection tampering rejection, no execution/replay, bounded Core `NODE_DISCONNECTED` settlement, and
cleanup. No push, finish, or archive has been performed.

Slice 4 now has an approved PRD, technical design, live lifecycle research, and curated implement/check context:

- one Core-owned canonical Approval authority over the existing `CanonicalCapabilityIdentity`;
- physical Core `Connection` ownership for pending requests and session grants, never `deviceId` sharing;
- durable always-allows, explicit future-background disclosure, global `approvalGeneration`, list/revoke, and inert
  legacy reconfirmation;
- immutable Host control plus a nested, single-use post-decision authorization for exact challenge/resume; and
- a strict memory-only raw-input boundary with versioned redacted presentation.

Its execution order is Batch A schemas/state, Batch B Core-local/MCP interaction, Batch C Host challenge/resume,
Batch D Desktop/CLI surfaces, and Batch E legacy/privacy/process convergence. Batch A must keep production `ask`
fail-closed and must not touch prompt, Desktop, CLI, Host-control, Rust, or `main.ts` execution wiring.

## 4. Required reading order

Read these files before changing the Skills/MCP plan:

1. `AGENTS.md` and `.trellis/workflow.md` — current operating law and Trellis phase rules.
2. `CONTEXT.md` — canonical project language, including Core Authority, Execution Host, Primary Host, Skill,
   Procedural Knowledge, Autonomous Run, and Run Receipt.
3. `.trellis/tasks/08-10-skills-mcp-productization/prd.md` — owner-confirmed scope and remaining engineering questions.
4. `.trellis/tasks/08-10-skills-mcp-productization/research/current-gap-and-dependency-map.md` — live shipped gaps and
   cross-layer anchors.
5. `.trellis/tasks/08-10-skills-mcp-productization/research/standards-and-reference-prior-art.md` — Agent Skills/MCP
   standards plus Hermes/OpenClaw evidence.
6. `.trellis/tasks/08-10-skills-mcp-productization/research/vps-secret-backend-options.md` — selected host-local secret
   architecture and spike gates.
7. `.trellis/spec/backend/host-operation-lifecycle.md` — common offline/in-flight/resume/receipt lifecycle.
8. `.trellis/spec/backend/permission-authorization.md`, `tool-design.md`,
   `mcp-tool-schema-compatibility.md`, `server-push-and-connection-auth.md`, and `config-store.md`.
9. `.trellis/spec/frontend/home-window.md`, `state-management.md`, and `type-safety.md`.
10. `.trellis/workspace/pleia/t4-second-grill-prep.md` and
    `docs/adr/0010-separate-autonomous-run-history-from-relationship-timeline.md` for the post-Skills/MCP T4 program.
11. `docs/adr/0009-single-memory-authority-with-local-replica.md` and `docs/MEMORY-DESIGN.md` only where T4 crosses the
    provider-neutral Memory boundary.

Local reference source exists under `references/`, including Hermes. Prefer its documents before source inspection,
and prefer local references before external search. External research must use available MCP search/documentation
tools; do not invent framework behavior.

## 5. Frozen product decisions — do not reopen without new evidence

### Skills, MCP, governance, and hosts

- Preserve open-standard `SKILL.md` packages. Do not create a Taki-only Task Archetype or replacement Skill format.
- A Skill provides procedure and suggested tools; it never grants permission.
- Use progressive discovery: cheap bounded metadata first, Skill detail and permitted tools only when relevant.
- Use one registry-driven governance calculation for MCP, effectful Core tools, Skills-related capability use, and
  Shell/exec. Avoid independent permission products for each tool class.
- The ordinary operator model is one global `strict | standard | relaxed` control plus an advanced capability view.
- Core owns the global ceiling and durable common policy. Slice 4 owns durable canonical Approval decisions. An
  Execution Host may impose a stricter floor and performs final local enforcement, but it cannot widen Core
  authorization or open a second approval dialog.
- One user profile has one active Core Authority. Local and VPS Core are explicitly rebound, never active-active,
  automatically failed over, or implicitly merged.
- Every Run has one `primaryHostId`; a cross-host operation names its target Host explicitly. Paths and display labels
  never select or cross a Host implicitly.
- Skill packages, MCP clients, credentials, Workspace, and OS capabilities belong to their Execution Host.
- Host availability is not permission. A disconnected Host receives no new side effect, is never silently replaced,
  and does not receive an automatic replay after reconnect.
- All Host-bound operations reuse the common lifecycle and generic receipt projection. A feature must not add its own
  offline state machine, retry queue, or disconnected card.
- MCP/Skill secrets stay in the owning Host's encrypted credential catalog. Core stores sanitized metadata and opaque
  references, not ordinary secret values.
- The selected MVP direction uses libsodium secretstream, Windows Credential Manager for the versioned host key, and
  `systemd LoadCredentialEncrypted=` on Linux/VPS. Exact packages and helper packaging remain implementation spikes;
  adding a dependency still requires owner approval.

### Later T4 behavior

- Autonomous Runs use a separate Core-owned history. Only actual Companion utterances enter the continuous relationship
  timeline; user-expected background work may project a linked Run Receipt into Home.
- This internal isolation does not create a user-visible session list.
- Every Scheduled Task fire starts a restricted Agent run. There is no literal reminder-delivery bypass.
- Scheduled Task definitions may reference Skills and guidance but do not rigidly lock the Agent to a tool list.
- Privacy Pause makes sampling-backed Heartbeat sources naturally ineligible by stopping acquisition; it is not a
  global speech mute.
- The Core owns one IANA User Timezone in fixed or designated-authority-device mode; VPS local time is not user time.
- Use the one global Main Model for Companion reasoning across normal and autonomous contexts.
- Procedural Knowledge belongs with the applicable Skill/task/capability guidance, is loaded on demand, and is separate
  from relationship Memory. Experience Review and Learning Proposal activation are later, evidence-gated work.

## 6. Skills/MCP engineering gates

The Product Owner has resolved the product behavior. The following are engineering contracts, not a new broad Grill:

1. **Host-control shared wire schema — implemented in `7427edf`**
   - stable Host and Run identity;
   - authenticated connection and catalog generations;
   - host-qualified capability/Skill/MCP ownership;
   - request/response binding to `(hostId, connectionGeneration)`;
   - policy/approval generation, exact input identity, deadlines, expiry, operation/idempotency identity;
   - disconnect, stale-response, cancellation, and `outcome_unknown` settlement; and
   - protocol/catalog version negotiation.
2. **Governance Authority — implemented and formally checked; child retained in `review`**
   - one structured canonical identity with explicit owning Host and optional stable subject binding;
   - a versioned extension-neutral descriptor registry for Core, MCP, Host, and Skill-mediated actions;
   - Core SQLite global Level/overrides plus atomic optimistic-concurrency `policyGeneration`;
   - a complete Core policy projection sent to the Host so Rust keeps trusted argument classification without a
     duplicate TypeScript security parser;
   - Host-local/managed constraints can only tighten and return bounded enforcement evidence;
   - legacy Shell/MCP denies remain effective, while legacy Level/allows cannot widen the new authority; and
   - effective `ask` fails closed until Slice 4 installs the one canonical Approval lifecycle. The parent initiative
     must not be released between those slices.
3. **MCP reload ownership**
   - candidate connection and validation;
   - last-good publication;
   - future-run generation replacement;
   - leases/draining for calls already in flight;
   - close responsibility and crash recovery; and
   - the persistence boundary between desired configuration and observed runtime state.
4. **Child-task boundaries and gates**
   - freeze an authority/credential design gate;
   - common governance/catalog vertical;
   - Approval vertical;
   - secure MCP lifecycle;
   - standard Skill lifecycle; and
   - converged discovery/integration.
5. **Trellis context**
   - Governance Authority context is curated. Repeat the same requirement independently for every later child before
     dispatching its implementer.

The four former P0 multi-Host gaps are closed at the unit/wire level: routing is explicit or single-Host-only,
disconnect settlement is generation-scoped, responses require authenticated connection provenance, and the shared
control tuple carries Host/generation/deadline identity. The remaining process-level evidence gap is the dedicated
two-Node harness described above.

## 7. Intended program order

### Phase A — Skills/MCP prerequisite

1. Freeze the remaining contracts above and obtain owner acknowledgement of the concrete implementation decision.
2. Create evidence-driven Trellis children and curate each child's context.
3. Implement common governance and Approval foundations before parallel MCP/Skill lifecycle children.
4. Converge discovery, Host behavior, Home management, restart/reconnect, migration, and security evidence.
5. Run one proportional formal check for each substantial child or converged batch; do not spend a formal check on
   discussion-only or documentation-only work.
6. Update reusable specs and close the parent only after end-to-end operator acceptance.

### Phase B — formal T4 program

After Skills/MCP is productized:

1. create the formal T4 PRD from the resolved G2 decisions and ADR 0010;
2. freeze provider-neutral T4/Memory contracts without waiting for every Memory UI child;
3. implement Autonomous Run and Run Receipt foundations;
4. implement Scheduled Task;
5. implement Heartbeat;
6. add delivery, transport-liveness, and Procedural Knowledge integration; and
7. run manual calibration before treating development timing/noise defaults as final product constants.

## 8. Worktree and merge protocol

### Start of every T4 session

```powershell
Set-Location 'H:\TakiAgent-worktrees\t4'
git status --short --branch
Get-Content -Raw '.trellis\.current-task'
python ./.trellis/scripts/get_context.py
git log -3 --oneline --decorate
```

Expected task pointer: `.trellis/tasks/08-12-approval-productization`. Its PRD/design/research/context are curated and
the task is `in_progress`; revalidate them plus live Git/migration state before each Batch A-E dispatch. Host-control
stays in `review` until the deferred real two-Node evidence and owner closeout; Governance Authority stays in `review`
because Slice 3 cannot release without Slice 4; the parent remains `planning` until the full program converges.

If the worktree is dirty for an unknown reason, stop and identify ownership before editing. Never run T4 commands from
`H:/TakiAgent` merely because it is the familiar path.

### Synchronizing mainline work

Before each implementation child or any edit to a known merge hotspot:

1. finish or commit the current T4 documentation/code slice so the worktree is clean;
2. inspect `git log --left-right main...HEAD` and the live main-worktree status;
3. if `main` advanced, merge `main` into the T4 branch from this worktree;
4. resolve conflicts by preserving both task contracts, not by choosing a whole-file side; and
5. rerun focused tests for every conflicted integration seam.

Do not use `reset`, force operations, or rebase without explicit owner authorization. Do not copy patches manually
between worktrees; use Git history.

### Final integration

When the T4 branch has completed its required Trellis gates and owner manual acceptance:

1. ensure both worktrees are clean;
2. merge the latest `main` into the T4 branch and verify the converged result;
3. from `H:/TakiAgent`, merge `task/t4-skills-mcp-productization` into `main`;
4. run the integration gates appropriate to the resulting cross-module diff; and
5. remove the worktree only after the merge is recorded and no uncommitted files remain.

Push remains a separate owner-authorized action.

## 9. Leader operating rules

- User-facing communication is Simplified Chinese. Code, comments, commits, and engineering documents are English.
- The Leader owns task-wide PRDs, decision synthesis, HANDOFF, cross-layer docs, and final status truth.
- Delegate Trellis implementation/check work with complete English prompts and require honest completion reports.
- Judge sub-agent output first against the assigned requirements, then separately assess unrequested additions.
- Use `jbcontext` with English queries for unknown code; YCE is prohibited. Read known files directly.
- Prefer local `references/` before external research. Use available Tavily/Exa/Context7 MCP tools for external facts.
- Do not repeat existing research unless a live version/source change invalidates it.
- Do not mark manual acceptance passed without the owner's observation.
- Use formal `trellis-check` for substantial implementation convergence, not routine planning or small documentation.
- Do not push, reset, rebase, force, finish/archive, or perform destructive cleanup without the applicable owner
  authorization. Ordinary scoped commits are allowed when they are needed to preserve the requested worktree history.

## 10. Next-session checklist

The incoming Leader should report the live state to the owner, then:

1. verify this worktree, current child, branch, `main...HEAD`, and Hindsight separation;
2. confirm `7427edf` and the recorded gates before treating Host-control as the dependency baseline;
3. treat the missing two-Node process harness as the owner-approved mandatory Slice 8 convergence gate without
   weakening the existing unit/wire evidence;
4. verify `08-12-approval-productization`, refresh `main...HEAD` and the migration registry, and dispatch only its
   independently fail-closed Batch A after the planning slice is committed and the worktree is clean;
5. keep the one Approval lifecycle Core-owned and generation-bound; do not revive Shell-local prompts or legacy allow
   writers;
6. do not mark either reviewed child complete or archive it without the applicable owner closeout direction; and
7. continue in the recorded slice order, keeping secure MCP and standard Skill lifecycle behind governance, Approval,
   and secret foundations.

No new product Grill is currently required. Ask the owner only if live code/research exposes a genuine product choice
that would materially change behavior, security, scope, or delivery.
