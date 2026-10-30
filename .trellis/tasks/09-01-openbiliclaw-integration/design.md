# OpenBiliClaw Integration Bridge Design

> **Historical design warning — 2026-10-08:** This design is retained as September research, not the current implementation specification. Read [MEDIA-INTEGRATION.md](../../../docs/MEDIA-INTEGRATION.md) for M01-M58 and [MEDIA-AGENT-INTEGRATION-PLAN.md](../../../docs/MEDIA-AGENT-INTEGRATION-PLAN.md) for the current entry, preparation, initiative and UI proposal. This task is reused in `planning`; its session binding does not activate implementation. Prefer native HTTP clients against running services; do not implement the internal engine construction, fixed tool inventory, local-only scope, zero-Taki-change claim, illustrative SDK calls, or unverified estimates below without evidence and artifact reconciliation. This notice authorizes no deployment or code changes.

## Overview

Independent Python package `openbiliclaw-mcp-bridge` providing HTTP MCP server that exposes OpenBiliClaw's recommendation/discovery capabilities to TakiAgent. The bridge is a **thin request facade over a separately-running OpenBiliClaw service** — it imports the adapter once, holds it in memory, and forwards 13 result-oriented tool calls. It does **not** own the background scheduler.

## Scheduler Ownership (verified in source — corrects an earlier assumption)

The adapter path and the daemon path are two distinct lifecycles in OpenBiliClaw:

| Path | Entry | Scheduler behavior |
|------|-------|-------------------|
| **Adapter** (`build_openclaw_adapter_services()`) | `integrations/openclaw/bootstrap.py` | Constructs `ContinuousRefreshController` and calls only `run_startup_maintenance()` (`bootstrap.py:421`). **Never calls `run_forever()`** |
| **Daemon** (`openbiliclaw.cli start`) | `api/runtime_context.py:1807` | Calls `run_forever()`, launching ~20 concurrent 60s loops (`refresh.py:1639-1667`) |

Source evidence — `bootstrap.py:342-345`:

> "OpenClaw only invokes short-lived operations and never starts `ContinuousRefreshController.run_forever()`. It must therefore await the durable expression-copy work itself rather than notify a daemon coordinator that will never run."

And `bootstrap.py:409-412`:

> "The OpenClaw adapter has no daemon lifecycle. Keep the evaluator's bounded inline drain, then finish copy through the awaited callback above; unlike a notify-only coordinator this leaves no dormant owner or background copy task behind."

**Consequence**: the candidate pool is replenished only by the OpenBiliClaw **daemon**, not by anything the bridge does. The adapter is deliberately built for short-lived, bounded, interactive requests: it drains at most 4 pending expression-copy items inline per request (`bootstrap.py:356`, `one_shot_inline_eval_limit=4`) and leaves the rest durable for the next call.

Therefore the deployment requires **two OpenBiliClaw-side processes**:

1. `openbiliclaw.cli start` — the daemon that owns `run_forever()` and keeps the pool fresh
2. `openbiliclaw-mcp-bridge` — the MCP HTTP facade taki talks to

The bridge must **not** call `run_forever()` itself. Doing so would create a second full discovery stack (~20 loops) writing the same SQLite database as the daemon — WAL makes that safe from corruption, but it would double API quota consumption against Bilibili/YouTube/Douyin and double LLM spend.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ TakiAgent (Agent Core)                                          │
│   packages/core/src/mcp/                                        │
│     ├─ mcp-config.ts (HTTP transport entry)                     │
│     └─ mcp-client.ts (tool invocation)                          │
└────────────────────┬────────────────────────────────────────────┘
                     │ HTTP (127.0.0.1:8421) — MCP protocol
┌────────────────────▼────────────────────────────────────────────┐
│ openbiliclaw-mcp-bridge (persistent, import paid once)          │
│   ├─ server.py    13 MCP tool handlers → adapter methods        │
│   ├─ adapter.py   holds build_openclaw_adapter_services()       │
│   │               result in memory; NEVER calls run_forever()   │
│   └─ lifecycle.py /health, graceful shutdown                    │
└────────────────────┬────────────────────────────────────────────┘
                     │ in-process import + direct await
┌────────────────────▼────────────────────────────────────────────┐
│ OpenBiliClaw v0.3.205                                           │
│   ├─ integrations/openclaw/bootstrap.py                         │
│   │    build_openclaw_adapter_services() → adapter              │
│   │    + run_startup_maintenance() (one-shot only)              │
│   └─ storage/database.py — SQLite WAL, busy_timeout=30000       │
└────────────────────┬────────────────────────────────────────────┘
                     │ shares the same database file
┌────────────────────▼────────────────────────────────────────────┐
│ openbiliclaw.cli start  (separate process, user-managed)        │
│   api/runtime_context.py:1807 → run_forever()                   │
│   ~20 concurrent 60s loops: pool refresh, discovery producers,  │
│   soul pipeline, proactive push, account sync                   │
│   THIS is what keeps the candidate pool fresh                   │
└─────────────────────────────────────────────────────────────────┘
```

**Key design points**:

1. **Bridge owns no scheduler** — verified: the adapter path never calls `run_forever()`. Pool freshness depends on the separately-running `openbiliclaw.cli start` daemon
2. **Two OpenBiliClaw-side processes required** — daemon (pool) + bridge (MCP facade). The bridge degrades to serving a stale pool if the daemon is down
3. **HTTP-only transport** — no stdio; bridge lifecycle is independent of taki's process
4. **Same-machine baseline** — all three processes on localhost; cross-machine deferred
5. **One-time import** — the 4.5s import graph cost is paid once at bridge startup, not per call
6. **Zero taki code change** — `mcp-config.ts` already validates HTTP transport

## Tool Mapping (24 → 13)

### Kept Tools (result-oriented, taki receives outcomes)

| MCP Tool Name | OpenBiliClaw Skill | Role | Input Schema |
|---------------|-------------------|------|--------------|
| `recommend` | `openbiliclaw_recommend` | Generate recommendation batch | `{limit?, refresh_if_needed?, source_platform?, excluded_item_ids?}` |
| `reshuffle` | `openbiliclaw_reshuffle` | Replace current page from pool | `{limit?, source_platform?, excluded_item_ids?}` |
| `append` | `openbiliclaw_append_recommendations` | Append next page | `{limit?, source_platform?, excluded_item_ids?}` |
| `get_delight` | `openbiliclaw_get_delight` | Proactive surprise recommendation | `{}` |
| `respond_delight` | `openbiliclaw_respond_delight` | React to surprise | `{response, bvid?, content_id?, source_platform?, title?, message?, request_id?}` |
| `submit_feedback` | `openbiliclaw_submit_feedback` | Learning signal (like/dislike/dismiss) | `{recommendation_id, feedback_type, request_id, note?}` |
| `activity_feed` | `openbiliclaw_get_activity_feed` | Recent activity timeline | `{limit?, before?}` |
| `platform_availability` | `openbiliclaw_get_platform_availability` | Source inventory check | `{}` |
| `runtime_status` | `openbiliclaw_get_runtime_status` | Service health | `{}` |
| `capabilities` | `openbiliclaw_get_capabilities` | Protocol negotiation | `{}` |
| `profile` | `openbiliclaw_get_profile` | User context (read-only) | `{}` |
| `save_local` | `openbiliclaw_save_local` | Save item locally | `{list_kind, source_platform, content_id?, content_url?, ...}` |
| `list_saved` | `openbiliclaw_list_saved` | List saved items | `{list_kind, limit?}` |

**Total: 13 tools**

### Cut Tools (opaque agent persona, conflicts with "taki is primary agent")

| Skill | Reason |
|-------|--------|
| `openbiliclaw_chat` | Socratic dialogue — taki interprets results, doesn't delegate conversation |
| `openbiliclaw_get_chat_history` | Chat history for delegated dialogue (not used) |
| `openbiliclaw_next_probe` | Interest hypothesis probing (opaque cognition) |
| `openbiliclaw_respond_interest_probe` | Hypothesis response (opaque) |
| `openbiliclaw_next_avoidance_probe` | Avoidance hypothesis (opaque) |
| `openbiliclaw_respond_avoidance_probe` | Avoidance response (opaque) |
| `openbiliclaw_get_profile_edit_state` | Profile editing state (identity management taki doesn't own) |
| `openbiliclaw_edit_profile` | Profile mutation (identity management) |
| `openbiliclaw_sync_account` | Account-side signal sync (internal operation, not result delivery) |
| `openbiliclaw_remove_saved` | Delete saved item (defer to batch 2 after save/list proven) |
| `openbiliclaw_sync_saved` | Native-save sync with external accounts (defer, needs authorization design) |

**Total cut: 11 tools**

## Bridge Package Structure

```
openbiliclaw-mcp-bridge/
├── pyproject.toml           # Dependencies: openbiliclaw, mcp (official SDK), uvicorn
├── src/
│   └── openbiliclaw_mcp_bridge/
│       ├── __init__.py
│       ├── server.py        # HTTP MCP server (uvicorn app)
│       ├── adapter.py       # Thin facade wrapping OpenBiliClaw adapter
│       ├── lifecycle.py     # Health check endpoint, graceful shutdown
│       └── config.py        # Bridge config (port, OpenBiliClaw project root)
├── config.example.toml      # Bridge config template
└── README.md
```

### Entry Point

```python
# server.py
from mcp.server import Server
from mcp.server.stdio import stdio_server  # NOT used (HTTP only)
from mcp.types import Tool, TextContent
import uvicorn
from .adapter import OpenBiliClawAdapter
from .config import load_config

# HTTP MCP handler
app = create_mcp_http_app()  # mcp SDK provides HTTP adapter

@app.on_startup
async def startup():
    config = load_config()  # reads bridge config
    adapter = OpenBiliClawAdapter(config.openbiliclaw_project_root)
    await adapter.initialize()  # calls build_openclaw_adapter_services(), keeps in memory

@app.tool("recommend")
async def handle_recommend(limit: int = 10, ...):
    return await adapter.recommend(limit=limit, ...)

# ... 12 more tool handlers

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8421)
```

### Adapter Lifecycle

```python
# adapter.py
from openbiliclaw.integrations.openclaw.bootstrap import build_openclaw_adapter_services

class OpenBiliClawAdapter:
    def __init__(self, project_root: str):
        self.project_root = project_root
        self._adapter = None  # OpenBiliClaw adapter instance

    async def initialize(self):
        """One-time initialization: build engine stack, keep in memory."""
        # build_openclaw_adapter_services() constructs Database (SQLite WAL),
        # MemoryManager, SoulEngine, DiscoveryEngine, RecommendationEngine and a
        # ContinuousRefreshController, then calls run_startup_maintenance() only
        # (bootstrap.py:421). It never calls run_forever(), so no background
        # loops start here — see bootstrap.py:342-345.
        self._adapter = await build_openclaw_adapter_services(self.project_root)

    async def recommend(self, **kwargs):
        """Forward to OpenBiliClaw adapter.recommend()."""
        result = await self._adapter.recommend(**kwargs)
        return self._format_result(result)

    # ... 12 more forwarding methods
```

**Critical**: the bridge must never call `runtime_controller.run_forever()`. The controller instance that `build_openclaw_adapter_services()` returns is intended for one-shot maintenance only. Starting its loops here would run a second full discovery stack (~20 concurrent loops) against the same database as the `openbiliclaw.cli start` daemon — WAL prevents corruption, but source API quota and LLM spend would double.

## TakiAgent Integration

### MCP Config Entry

```typescript
// packages/core/src/config/mcp-config.ts (user's config file)
{
  "mcpServers": {
    "openbiliclaw": {
      "url": "http://localhost:8421/mcp",  // HTTP transport
      "description": "OpenBiliClaw content recommendation and discovery",
      "disabled": false
    }
  }
}
```

No taki code change needed — `mcp-config.ts` already validates `{ url: z.url() }` for HTTP transport.

### Tool Governance

Tool approval follows existing `packages/core/src/mcp/mcp-tool-identity.ts`:

- `stableSubjectId("openbiliclaw", "recommend")` → `mcp.a1b2c3...` (hashes serverKey + toolName only, transport-agnostic)
- `publicConfigFingerprint(config)` → includes `url` field

**Open question**: Does changing `stdio` → `http` (or `http://localhost:8421` → `http://192.168.1.10:8421`) trigger re-approval? Need to verify `publicConfigFingerprint` consumption in approval flow.

## Content Source Tiers (Configuration Only)

OpenBiliClaw's `config.toml` has per-source `enabled` toggles:

```toml
[sources.bilibili]
enabled = true    # Tier 2: one-time cookie extraction

[sources.xiaohongshu]
enabled = false   # Tier 3: persistent browser+plugin (deferred)
```

**First batch: Tier 1 + Tier 2 only**:

- **Tier 1** (no auth): YouTube, V2EX, LinuxDo, 番剧, GitHub Stars, Reddit anonymous
- **Tier 2** (env variable cookie): Bilibili, Douyin, X

Bridge zero code impact — user edits OpenBiliClaw's `config.toml`, restarts bridge, new sources appear in `platform_availability` results.

**Tier 3 deferred** (Xiaohongshu, Zhihu, Weibo) — registered in `docs/deferred-decisions.md` with trigger: "user requests persistent-browser source integration".

## Lifecycle & Monitoring

### Two Processes, Both Outside Taki

**Neither is taki's responsibility** — both are independent infrastructure supervised by the OS:

| Process | Role | Must be running for |
|---------|------|--------------------|
| `openbiliclaw.cli start` | Daemon; owns `run_forever()` and pool freshness | Recommendations to stay fresh and non-repetitive |
| `openbiliclaw-mcp-bridge` | MCP HTTP facade | Taki to reach OpenBiliClaw at all |

The bridge already depends on the daemon, so declare that ordering to the supervisor rather than leaving it implicit.

**Windows**: NSSM (true Windows Service, starts without user login) or PM2 (easier dev workflow: logs, restart, status). Recommend NSSM for the daemon and PM2 during bridge development.

**Linux** (future VPS) — bridge unit with an explicit dependency on the daemon:

```ini
# openbiliclaw-bridge.service
[Unit]
Description=OpenBiliClaw MCP Bridge
After=network.target openbiliclaw.service
Wants=openbiliclaw.service

[Service]
Type=simple
User=taki
WorkingDirectory=/opt/openbiliclaw-mcp-bridge
ExecStart=/opt/openbiliclaw-mcp-bridge/.venv/bin/python -m openbiliclaw_mcp_bridge.server
Restart=on-failure
RestartSec=10s

[Install]
WantedBy=multi-user.target
```

`Wants=` rather than `Requires=`: a daemon outage should degrade recommendation freshness, not tear down the bridge and make taki's tools vanish mid-conversation.

### Health Check Endpoint

Bridge exposes `/health` for external monitoring. Note it reports **daemon liveness indirectly**, via pool freshness, because the daemon is a separate process the bridge does not own:

```python
# lifecycle.py
@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "adapter_initialized": adapter is not None,
        "database_readable": await adapter.test_database_read(),
        # Daemon liveness proxy: the bridge cannot inspect the separate
        # `openbiliclaw.cli start` process, but a pool that has not been
        # refreshed recently means run_forever() is likely down.
        "pool_available": await adapter.pool_available_count(),
        "pool_last_refresh_age_seconds": await adapter.pool_last_refresh_age(),
    }
```

A `pool_last_refresh_age_seconds` far above the daemon's 60s tick is the signal that the OpenBiliClaw daemon needs attention — not the bridge.

### Degradation Semantics

When bridge unavailable (crashed, not started, network issue):

1. TakiAgent's MCP client call fails → structured error returned to agent LLM
2. Agent interprets error, informs user: "Content recommendation service unavailable"
3. TakiAgent continues operating (chat, memory, other tools) — no hard dependency
4. User restarts bridge manually or via process manager

**No automatic restart from taki** — violates ADR 0002 (agent never touches OS on initiative) and creates approval noise (agent exec capability requires permission gate).

## Failure Modes & Recovery

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Bridge process crash | MCP call timeout / connection refused | Process manager restarts bridge (NSSM/PM2/systemd) |
| **OpenBiliClaw daemon down** | `/health` shows `pool_last_refresh_age_seconds` growing past ~120s; pool drains and `recommend` returns fewer items | Restart `openbiliclaw.cli start`. Restarting the **bridge** does not help — it owns no loops |
| Pool exhausted (daemon alive but starved) | `platform_availability` shows near-zero inventory across sources | Check daemon logs for source-level quota/风控 blocks; verify per-source `enabled` in `config.toml` |
| Database locked | SQLite `busy_timeout=30000` → `OperationalError` after 30s | Bridge returns structured MCP error; taki retries after backoff |
| Stale recommendations (repetitive) | User reports repetition | Verify daemon is running and pool refresh is advancing; this is a daemon-side symptom |
| Import failure (missing deps) | Bridge startup fails, logs to stderr | Check bridge logs, verify `.venv` intact |

**Diagnostic rule**: bridge symptoms are connection-level (timeout, refused). Daemon symptoms are content-level (empty, stale, repetitive pool). Restarting the wrong process wastes a 4.9s cold start and fixes nothing.

## Performance Characteristics

- **Cold start**: 4.9s (includes 4.5s import graph)
- **Warm request** (adapter in memory): ~50-200ms (database query + engine logic)
- **Scheduler overhead**: 60s tick with ~500ms-2s execution (pool refresh query + ranking)
- **Memory footprint**: ~150-300 MB (Python + loaded models + SQLite connection pool)

One-time 4.9s cost amortized over bridge lifetime (hours to days between restarts).

## Security & Isolation

1. **Bridge listens on localhost only** (`127.0.0.1:8421`) — no external network exposure
2. **No authentication in first batch** — same-machine trust boundary sufficient
3. **OpenBiliClaw cookies/tokens** stored in OpenBiliClaw's database, never transmitted to taki
4. **MCP protocol** carries only tool calls and results (no credential exchange)
5. **Cross-machine security deferred** — when bridge runs on remote VPS, add:
   - HTTPS + TLS cert (Let's Encrypt)
   - Bearer token auth (taki's `mcp-config.ts` supports `headers: { Authorization: "Bearer ..." }`)

## Deferred Decisions

Registered in `docs/deferred-decisions.md` as **D71-D74**. Summarized here with the implementation detail the registry rows omit.

### 1. Cross-Machine Deployment (D71)

**Trigger**: User deploys OpenBiliClaw on remote VPS

**Changes needed**:
- Bridge: HTTPS endpoint, bearer token auth, CORS policy
- TakiAgent: `mcp-config.ts` entry changes from `http://localhost:8421` to `https://vps.example.com:8421`, adds `headers: { Authorization: "Bearer <token>" }`
- Monitoring ownership: VPS operator monitors bridge, taki no longer assumes local process

**Effort**: 1-2 days (HTTPS setup, token exchange, testing)

### 2. Tier 3 Content Sources (D72)

**Trigger**: User requests Xiaohongshu/Zhihu/Weibo integration

**Changes needed**:
- OpenBiliClaw: User configures browser plugin, sets `enabled = true` in `config.toml`
- Bridge: Zero code change (sources appear in `platform_availability` after OpenBiliClaw restart)
- TakiAgent: Zero code change (new platforms flow through existing `recommend` tool)

**Effort**: 0 days bridge work; user configuration only

### 3. Active Signal Push (D73)

**Trigger**: Taki needs proactive content notifications (e.g., "notify me when new BanG Dream video drops")

**Changes needed**:
- Bridge: WebSocket endpoint or Server-Sent Events for push channel
- OpenBiliClaw: New "subscription" feature (watch specific creators/tags)
- TakiAgent: WS client in `packages/core/src/mcp/`, route incoming signals to agent context

**Effort**: 5-7 days (subscription engine, push transport, agent integration)

### 4. Tool Surface Expansion (D74)

**Trigger**: User explicitly requests chat/probe/profile-edit features

**Decision**: Re-evaluate "taki is primary agent" constraint — if user wants delegated Socratic dialogue, expose `openbiliclaw_chat` tool, but:
- Make delegation explicit in taki's agent prompt ("when user asks philosophical content questions, delegate to OpenBiliClaw chat")
- Never make chat the default path (taki answers in taki's voice by default)

**Effort**: 1 day per tool batch (add MCP handlers, update taki prompt)

## Implementation Phases

### Phase 1: Bridge Package Scaffold (1 day)

- [ ] Create `openbiliclaw-mcp-bridge` package structure
- [ ] Define `pyproject.toml` dependencies (openbiliclaw, mcp, uvicorn, pydantic)
- [ ] Implement `config.py` (load bridge config from TOML)
- [ ] Stub `server.py` (HTTP MCP app skeleton, no tool handlers yet)
- [ ] Stub `adapter.py` (`initialize()` calls `build_openclaw_adapter_services()`, keeps in memory)
- [ ] Manual test: bridge starts, `/health` returns 200

### Phase 2: Tool Handlers (2-3 days)

- [ ] Implement 13 MCP tool handlers in `server.py`
- [ ] Forward calls to `adapter.py` methods
- [ ] Format results as MCP `TextContent` (JSON serialization)
- [ ] Error handling: catch OpenBiliClaw exceptions, return structured MCP errors
- [ ] Unit tests: mock adapter, verify tool call → adapter method routing

### Phase 3: TakiAgent Integration (1 day)

- [ ] Add `openbiliclaw` entry to taki's `mcp-config.ts` (HTTP URL)
- [ ] Start bridge, start taki, verify MCP client connects
- [ ] Manual test: call `recommend` tool from taki's agent prompt, verify results appear
- [ ] Test degradation: stop bridge, verify taki handles error gracefully

### Phase 4: E2E Testing & Docs (1-2 days)

- [ ] End-to-end: taki calls all 13 tools, verify results match OpenBiliClaw CLI output
- [ ] Performance test: measure warm request latency (target < 500ms p95)
- [ ] Write bridge README: setup, config, monitoring, troubleshooting
- [ ] Write taki integration guide: `mcp-config.ts` entry, example agent prompts
- [ ] Register deferred decisions in `docs/deferred-decisions.md`

**Total estimate: 5-7 days**

## Open Questions

1. **publicConfigFingerprint approval**: Does switching `http://localhost:8421` → `http://192.168.1.10:8421` (same bridge, different host) require re-approval? Need to trace `publicConfigFingerprint` consumption in `mcp-tool-identity.ts` approval flow.

2. ~~**Scheduler conflict verification**~~ — **RESOLVED in source.** The adapter path never starts loops (`bootstrap.py:342-345`, `:409-412`, `:421` calls only `run_startup_maintenance()`); `run_forever()` is launched exclusively from the FastAPI daemon path (`api/runtime_context.py:1807`). There is no accidental double-scheduler risk as long as the bridge does not call `run_forever()` itself. The remaining requirement is a deployment one: the daemon must be running for the pool to stay fresh.

2a. **Pool-freshness telemetry**: `/health` needs `pool_last_refresh_age_seconds`. Confirm which column or table exposes the last pool refresh timestamp (`_pool_readiness_counts()` gives availability counts but timestamp source is unverified).

3. **Bridge restart frequency**: How often will users restart bridge in practice? If daily (config changes, updates), 4.9s cold start is fine. If hourly (unstable), need to investigate import optimization (lazy imports, stub unused backends).

4. **Windows Service vs PM2**: Recommend NSSM or PM2 for Windows? NSSM for true Windows Service (auto-start on boot, no user login needed), PM2 for easier dev workflow (logs, restart, status dashboard).

## Success Criteria

- Bridge starts in < 5s (one-time cold start)
- Warm tool call latency < 500ms p95
- TakiAgent successfully calls all 13 tools, results match OpenBiliClaw CLI
- Bridge crash → taki degrades gracefully (no agent hang/crash)
- Deferred decisions registered with clear triggers
- Documentation complete: bridge README, taki integration guide

## Non-Goals (out of scope)

- Replacing OpenBiliClaw's recommendation engine (bridge is thin adapter)
- Redesigning OpenBiliClaw's scheduler or database schema
- Building taki UI for OpenBiliClaw settings (separate task)
- Supporting OpenBiliClaw versions other than v0.3.205 (version upgrade is future task)
