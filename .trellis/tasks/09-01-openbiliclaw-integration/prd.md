# OpenBiliClaw Integration as MCP Plugin

> **Historical scope warning — 2026-10-09:** This September OpenBili-only PRD is research history and is not ready for implementation. Current requirements and owner direction M01-M59 live in [MEDIA-INTEGRATION.md](../../../docs/MEDIA-INTEGRATION.md); [MEDIA-AGENT-INTEGRATION-PLAN.md](../../../docs/MEDIA-AGENT-INTEGRATION-PLAN.md) owns the reviewable design. The 2026-10-08 session reused this task in `planning`; the 2026-10-09 continuation explicitly proceeds without task creation/binding. Reconcile scope and execution artifacts before activation. The internal adapter import, fixed thirteen-tool surface, local-only/deferred-browser scope and zero-Taki-change assumptions below cannot override current capability-first direction, selected recommendation pre-analysis or native OpenBili browsing/feedback.

## Goal

Integrate OpenBiliClaw v0.3.205 as an independent MCP bridge that provides media content recommendation and discovery tools to TakiAgent. OpenBiliClaw remains a self-contained plugin; taki receives only results (recommendations, parsed content, activity feeds) without knowing internal crawling/parsing/recommendation logic.

## Context

OpenBiliClaw is a MIT-licensed Python package (v0.3.205) with complete agent infrastructure: LLM provider, memory, soul, discovery engine, recommendation engine, and runtime producers. It already has:

- **Agent Bridge v2 protocol** at `src/openbiliclaw/integrations/openclaw/` — host-agnostic integration layer supporting multiple hosts (openclaw, hermes, workbuddy)
- **24 skill descriptors** with JSON Schema via `emit-skill-descriptors` command (no credentials/config needed)
- **MCP client** (uses mcporter for Exa/You.com calls) but **no MCP server** — this is the integration gap
- **SQLite storage** with WAL + `busy_timeout=30000` + per-thread connections for concurrent write safety
- **ContinuousRefreshController** with 60-second ticks that replenishes candidate pool via periodic scheduler

TakiAgent architecture constraints (ADRs 0002, 0006):

- Agent Core never touches OS on agent initiative (except MCP stdio transport in `packages/core/src/mcp/` and `secrets/master-key.ts`)
- `packages/core/src/mcp/mcp-config.ts` already supports both stdio and HTTP transports (Streamable HTTP MCP)
- MCP tool governance uses `stableSubjectId` (hashes serverKey+toolName only, transport-agnostic)

## Requirements

### 1. Bridge Form

**Independent Python package** as MCP HTTP server:

- **Not a CLI per-call spawn** — performance testing shows 4.9s floor with 4.5s just for imports (yt-dlp, anthropic, google-genai, openai, curl-cffi)
- **Persistent adapter process** with one-time import, keeps engine stack in memory
- **Thin request facade only** — the bridge must never call `ContinuousRefreshController.run_forever()`. Verified in source: the adapter path only runs `run_startup_maintenance()` (`bootstrap.py:421`) and explicitly "never starts `run_forever()`" (`bootstrap.py:342-345`). Pool freshness belongs to the separately-running `openbiliclaw.cli start` daemon (`api/runtime_context.py:1807`)
- **Deployment requires two OpenBiliClaw-side processes**: the daemon (owns the ~20 background 60s loops that replenish the candidate pool) and the bridge (MCP HTTP facade). Starting loops inside the bridge would double source API quota and LLM spend against the same database
- Uses OpenBiliClaw's `integrations/openclaw/bootstrap.py::build_openclaw_adapter_services()` to construct engine stack

### 2. Transport & Deployment

**HTTP MCP only** (no stdio):

- **Same-machine deployment baseline** — bridge co-located with OpenBiliClaw, taki always HTTP client
- Bridge lifecycle is independent of taki's process; the OS supervisor (NSSM/PM2/systemd) owns both the daemon and the bridge, with the bridge declaring a soft dependency (`Wants=`, not `Requires=`) on the daemon so a daemon outage degrades freshness instead of removing taki's tools mid-conversation
- Taki does not use agent exec capability for infrastructure keep-alive (ADR 0002: no agent-initiated OS action; also avoids permission-gate approval noise)
- **Cross-machine deployment deferred** — register in `docs/deferred-decisions.md` with trigger: "when user deploys OpenBiliClaw on remote VPS"

### 3. Tool Surface

Reduce from 24 descriptors to **~13 result-oriented tools**:

**Keep (result-delivery)**:
- `recommend` / `reshuffle` / `append` — recommendation operations
- `get_delight` — retrieve specific content
- `activity_feed` — user activity timeline
- `platform_availability` — check source status
- `runtime_status` — service health
- `capabilities` / `doctor` — introspection
- `profile` (read-only parts) — user context
- `saved_*` operations — saved content management
- `feedback` — learning signal submission

**Cut (opaque agent persona)**:
- `chat` / `probe` — Socratic dialogue (conflicts with "taki is primary agent" red line)
- `profile-edit` / `sync_account` — identity management taki doesn't own

Final list needs design-phase confirmation with exact tool names from `emit-skill-descriptors`.

### 4. Content Source Tiers

OpenBiliClaw sources have three tiers:

1. **Tier 1 (no browser/cookie)**: YouTube, V2EX, LinuxDo, 番剧, GitHub Stars, Reddit anonymous
2. **Tier 2 (one-time cookie extraction)**: Bilibili, Douyin, X — env variable方式, no plugin needed
3. **Tier 3 (persistent browser+plugin)**: 小红书, 知乎 personal history, 微博 — cookie never leaves browser

**First batch: Tier 1 + Tier 2 only** — these are pure `config.toml` enable toggles (per-source `enabled = true/false`), zero bridge code impact. Tier 3 deferred, registered in `docs/deferred-decisions.md` with trigger: "when user requests Xiaohongshu/Zhihu/Weibo integration".

### 5. Signal Flow

**Pull-only** (no active push in first batch):

- Taki calls tools explicitly (recommend, get_delight, activity_feed)
- Bridge returns results synchronously from the pool the daemon maintains
- The `openbiliclaw.cli start` daemon replenishes the pool on its own 60s loops, independent of any taki activity
- **Active signal push deferred** — registered in `docs/deferred-decisions.md` with trigger: "when taki needs proactive content notifications"

### 6. Lifecycle & Failure Semantics

- Bridge process monitoring is bridge's own responsibility (systemd/PM2/Windows Service wrapper), not taki's agent exec
- When bridge unavailable: taki's MCP tool calls fail gracefully with structured error (never crash)
- Degraded mode: taki continues operating without content recommendation; no feature assumes bridge is always available
- Service discovery: taki's MCP config points to fixed `http://localhost:<port>` (configurable), no dynamic discovery in first batch

### 7. Identity & Governance

- TakiAgent remains primary agent; OpenBiliClaw is pluggable capability provider (never forms "two personalities")
- OpenBiliClaw's Socratic chat does not reach user directly (taki interprets results and responds in taki's voice)
- Tool approval: follows existing MCP governance in `packages/core/src/mcp/mcp-tool-identity.ts` — `stableSubjectId` hashes serverKey+toolName (transport-agnostic), `publicConfigFingerprint` includes transport config

## Performance Evidence

Measured on Windows 11 with H:\OpenBiliClaw-main\.venv:

```
Bare Python:                 163ms
Import CLI module only:     4539ms
capabilities (cold):        4900ms
doctor (cold):              4900ms
```

Import graph bottleneck: yt-dlp, anthropic, google-genai, openai, curl-cffi.

**Conclusion**: Per-call CLI spawn is dead; bridge must be persistent process with one-time import.

## Architecture Decision (Route Selection)

**Considered (Route 1: stdio MCP)**: taki spawns the bridge via stdio transport and owns its lifecycle.

Rejected, but not for the reason first assumed. The initial rejection ("the bridge's 60s scheduler must outlive taki") turned out to rest on a misreading: the adapter path never runs a scheduler at all (`bootstrap.py:342-345`). The valid objections are narrower:

- The bridge pays a 4.9s cold start; tying it to taki's process means paying that on every taki restart
- Pool freshness already requires a separate long-lived daemon (`openbiliclaw.cli start`), so the deployment is multi-process regardless — stdio buys no simplification
- Cross-machine (deferred) would require a transport change; HTTP costs nothing extra today

**Selected (Route 2: HTTP MCP only)**: bridge as an independent HTTP service co-located with OpenBiliClaw, supervised by the OS alongside the daemon.

- Bridge and daemon both supervised externally; no taki agent exec dependency
- taki is always an HTTP client (same-machine baseline)
- Zero new spawn points in taki's core (ADR 0006 compliance — no change to the two sanctioned sites)
- Cross-machine ready: HTTP is transport-transparent, only monitoring ownership moves

## Acceptance Criteria

- [ ] Bridge package structure defined: entry point, MCP HTTP server setup, adapter lifecycle
- [ ] Tool surface finalized: exact 13 tool names from `emit-skill-descriptors`, JSON Schema mappings
- [ ] Lifecycle design: bridge process monitoring approach (systemd/PM2/Windows Service wrapper recommendation), degradation semantics when bridge unavailable
- [ ] TakiAgent MCP config sample: HTTP endpoint, serverKey, tool approval workflow
- [ ] Deferred items registered in `docs/deferred-decisions.md`: cross-machine deployment, Tier 3 sources, active signal push
- [ ] ADR if needed: confirm Route 2 (HTTP-only) does not conflict with existing ADR 0006 spawn sanctioning

## Definition of Done

- Design document complete with:
  - Bridge package structure and entry point
  - Exact tool mapping (24→13) with cut rationale
  - HTTP MCP server setup (port, auth if any)
  - Service lifecycle monitoring recommendation
  - Degradation semantics (bridge unavailable)
  - TakiAgent integration steps (mcp-config.ts entry)
  - Deferred decisions registered with triggers
- No code implementation yet (design-only task)
- Ready for implementation task creation

## Out of Scope

- Actual bridge implementation (separate task)
- TakiAgent UI for OpenBiliClaw settings (separate task)
- Cross-machine deployment (deferred)
- Tier 3 content sources (deferred)
- Active signal push (deferred)
- Replacing TakiAgent's Memory Provider or core agent loop

## Technical Notes

**OpenBiliClaw references**:
- Source: `H:\OpenBiliClaw-main` (not a git repo, GitHub ZIP extract)
- Key files: `src/openbiliclaw/integrations/openclaw/capabilities.py`, `bootstrap.py`, `storage/database.py`, `runtime/refresh.py`, `config.example.toml`
- Documentation: `README.md`, `docs/`

**TakiAgent references**:
- MCP subsystem: `packages/core/src/mcp/mcp-config.ts`, `mcp-tool-identity.ts`, `mcp-client.ts`
- ADRs: `docs/adr/0002-permission-gate.md`, `0006-mcp-processes-vs-no-os-invariant.md`
- Memory: `C:\Users\55473\.claude\projects\H--TakiAgent\memory\takiagent-openbiliclaw-integration.md` (discussion record from 2026-09-01)

**Related deferred decisions**:
- Cross-machine: trigger = "user deploys OpenBiliClaw on remote VPS"
- Tier 3 sources: trigger = "user requests Xiaohongshu/Zhihu/Weibo integration"
- Active push: trigger = "taki needs proactive content notifications"
