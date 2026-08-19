# Secure MCP Lifecycle Contract

## 1. Scope / Trigger

Use this contract whenever code changes MCP desired configuration, secret handling, candidate validation, runtime
publication, tool-call leases, operator methods, or the Home MCP management page.

The lifecycle has three distinct state planes:

1. **Desired truth**: `mcp_desired_servers` in Core SQLite, including `ownerHostId` and per-row
   `configRevision`. Config contains only opaque `secret-ref:` markers.
2. **Operator surface**: operator-role `mcp.*` methods plus the disposable Home page. This merges desired rows with a
   sanitized runtime projection; it does not become another authority.
3. **Runtime truth**: process-local candidates, active/draining generations, leases, and latest outcomes. This state is
   rebuilt from desired truth after restart and is never persisted as executable truth.

MCP tools use the common Governance and Approval path. This module must not create a separate permission system or
grant authority from configuration, Skill metadata, or successful connection.

## 2. Signatures

```typescript
interface McpDesiredRuntime {
  serverId: string;
  ownerHostId: string;
  configRevision: number;
  config: McpServerConfig;
  selectedTools: string[];
  enabled: boolean;
}

interface McpManager {
  reconcile(servers: McpDesiredRuntime[]): Promise<void>;
  applyDesired(input: McpDesiredRuntime): Promise<McpCandidateOutcome>;
  disableServer(input: McpDesiredRuntime): void;
  removeServer(serverId: string): void;
  secretCleared(ref: string): void;
  secretUpdated(ref: string): void;
  test(input: CandidateInput): Promise<McpTestResult>;
  tools(interactive?: TurnInteractive): ToolSet;
  statuses(): McpServerStatus[];
  close(): Promise<void>;
}
```

Operator methods are `mcp.list`, `mcp.get`, `mcp.add`, `mcp.edit`, `mcp.enable`, `mcp.disable`, `mcp.remove`,
`mcp.test`, `mcp.reconnect`, and `mcp.status`. All are registered exactly once with `roles: ["operator"]`; no Agent
tool may call this management surface.

`edit`, `enable`, `disable`, and `remove` require `expectedConfigRevision`. `add` creates revision 1. Every successful
desired mutation increments only that row's revision.

## 3. Contracts

### Desired and secret boundary

- `McpServerConfig` env/header values accepted by the operator wire are valid `secret-ref:<SecretRef>` markers only.
  Plaintext values must fail schema validation before SQLite.
- Secret values travel only through `secret.set`. Desired reads and Home drafts return markers, never values.
- Add may store new secrets before creating desired state because no row exists yet. Edit first wins the optimistic
  desired write, then stores changed secret values and explicitly reconnects. If a post-commit secret/reconnect step
  fails, the UI retains the draft and adopts the committed `configRevision` for a deliberate retry.
- A generation captures its referenced secret set. `secret.clear` retires every active/draining/candidate user and
  blocks new leases even when a newer desired edit no longer mentions the ref. `secret.set` reloads every enabled
  desired server that references the ref.
- The legacy `mcp-servers.json` is seed-only. Import occurs only when the desired table is empty and only after the
  secret migration has converted every plaintext env/header value to a marker.

### Candidate and publication

- Stdio desired configuration stays portable as `command + args + env + cwd`. The runtime preserves that tuple on
  Unix and uses an internal Windows shim relay only when the configured command resolves to a `.cmd`/`.bat` launcher;
  platform paths and shell wrappers are never persisted or exposed to the operator.
- A candidate resolves secrets just in time, connects, lists every page under one deadline, applies the narrow schema
  compatibility contract, validates selected raw tool names, and builds collision-safe model keys.
- The local listing loop rejects repeated cursors and more than `MAX_MCP_TOOL_COUNT` tools or pages. A selected tool
  absent from discovery fails the whole candidate; it must not silently publish a partial selection.
- Candidate failure closes the client and preserves the last-good active generation. `mcp.test` uses the same candidate
  validation and collision checks, always closes its client, and never publishes.
- Every desired operation receives a process-local ownership token. Publication succeeds only while both the desired
  object and candidate token are still current. A late candidate cannot overwrite a newer revision or resurrect a
  disabled, removed, secret-cleared, or shutting-down server.
- Cross-server model-key collisions reject only the candidate. Raw MCP names remain the `tools/call` authority key;
  model-facing normalized keys are presentation identifiers.

### Generations, leases, and shutdown

- Publication atomically installs a generation carrying `ownerHostId`, `configRevision`, tools, refs, and captured
  secret refs, then retires the previous generation.
- A per-turn tool closure captures one generation. Lease acquisition happens outside Governance/Approval execution;
  a draining or closed generation rejects the call and never redirects it to a replacement.
- Disable, remove, replacement, secret clear, and shutdown remove active publication before drain. Draining generations
  accept no new leases and close at lease zero or at the bounded drain deadline.
- All owners share one close promise per MCP client. Underlying `client.close()` starts at most once even across late
  candidate, generation, and shutdown races.
- Forced close while a lease is in flight returns `OUTCOME_UNKNOWN`; it must not report ordinary failure or fabricate
  rollback after dispatch.
- Shutdown stops publication, aborts candidates, retires active generations, waits only within its budget, and is
  idempotent. Restart reconstructs runtime state from desired rows and never replays calls.

### Status and Home behavior

- Status is a sanitized projection: phase, process-local generation, active plus draining lease count, tool count, and
  bounded last outcome. It never includes resolved config, schema bodies, raw transport errors, or secret values.
- Disabled servers cannot reconnect. Candidate/connect/list/tool-call errors crossing logs, UI, or model boundaries use
  fixed or bounded sanitized messages.
- Home keeps state in component memory only, refetches for each authenticated client generation, ignores late results,
  serializes mutations, and never replays a timed-out write.
- Env/header fields are always write-only. Renaming a field or changing stdio/http invalidates the retained opaque ref
  and requires a new value. Cancel, New, and successful Save reset editor revision and validation state.
- `mcp.test` success and failure remain distinct feedback. A failed save does not close the editor.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Plain env/header value or malformed secret ref | Zod validation failure; no desired or catalog write |
| Stale `expectedConfigRevision` | `MCP_CONFIG_CONFLICT` with current revision; Home refetches and never replays |
| Unknown/duplicate/colliding server id | `MCP_REFUSED` with bounded `unknown-server`, `duplicate-server`, or `key-collision` |
| Reconnect of disabled desired row | `MCP_REFUSED` with `server-disabled`; no hidden live generation |
| Missing/locked secret | Candidate `secret-unresolvable`; last-good generation remains if it does not use the cleared ref |
| Connect/list deadline or cancellation | Abort candidate, sanitize failure, close any late client, never publish |
| Repeated cursor, listing bound, or missing selected tool | Fail candidate closed; preserve unrelated servers and last-good state |
| Normalized key collision | Reject candidate/test with bounded collision metadata; publish nothing |
| New desired operation while old candidate runs | Old candidate becomes stale and closes; only current token may publish |
| Disable/remove/secret clear with leases | Remove active truth, reject new leases, drain then close exactly once |
| Drain deadline interrupts dispatched call | Return `OUTCOME_UNKNOWN` after transport interruption |
| Raw transport error contains credentials | Fixed/bounded message only; raw text never reaches logs, UI, or model |
| Edit desired commit succeeds but secret/reconnect fails | Preserve draft, expose partial failure, continue from committed revision |

## 5. Good / Base / Bad Cases

- **Good**: edit revision 4 creates a validated candidate; revision 4 publishes atomically, revision 3 drains while
  its existing call finishes, and the next turn sees only revision 4.
- **Base**: a candidate cannot connect. The desired revision and sanitized failure are visible, the prior generation
  continues serving, and unrelated servers are unchanged.
- **Bad**: a delayed candidate publishes after disable, a secret value is stored in desired JSON, a draining call is
  redirected to a new client, or Home reports a failed test as success. Each violates an authority or truth boundary.

## 6. Tests Required

- Shared schema tests: strict params/results, marker-only env/headers, secret-ref bounds, selected-tool/list limits,
  refusal vocabulary, and sanitized status/outcome shapes.
- Desired repo tests: migration, marker-only rows, seed ordering, optimistic edit/enable/disable/remove, conflict
  current revision, reopen, and corrupt-row rejection.
- Candidate tests: JIT resolution, pagination, repeated cursor, total bound, missing selected tool, schema isolation,
  normalization collisions, deadline abort, late-client close, and raw-error sanitization.
- Manager/generation tests: stale publication tokens, last-good retention, in-flight replacement, disable/remove,
  secret update/clear across active/candidate/draining refs, exact-once close, forced-close unknown outcome, truthful
  draining status, restart reconcile, and idempotent bounded shutdown.
- Method tests: operator-only registration, CRUD/test/reconnect/status, typed conflict/refusal, disabled reconnect, and
  unexpected-error sanitization.
- Desktop tests: write-only refs, rename/transport-change re-entry, editor resets, conflict refetch, no mutation replay,
  partial-commit revision adoption, test success/failure feedback, disabled reconnect, and no local persistence.
- Real-process evidence: standard MCP add/test/enable/invoke/edit/disable/restart path through Core, Governance, and
  Approval. Production Desktop build and Core boot must remain green.

## 7. Wrong vs Correct

### Wrong

```typescript
// Persistence accepts a credential, and any late candidate may replace current runtime truth.
await repo.edit({ ...input, config: { command: "server", env: { TOKEN: rawToken } } });
active.set(serverId, await connectAndList(input));
```

### Correct

```typescript
await secretCatalog.set(secretRef, rawToken);
const row = repo.edit({
  ...input,
  config: { command: "server", env: { TOKEN: `secret-ref:${secretRef}` } },
  expectedConfigRevision,
});
await manager.applyDesired(row); // token-gated candidate; last-good survives failure
```

The desired row names credentials, the catalog owns values, and only the current validated candidate may publish a
new runtime generation.
