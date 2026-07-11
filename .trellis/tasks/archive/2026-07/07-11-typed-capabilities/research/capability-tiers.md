# Research: capability sensitivity tiers, gate policy, core tools, and CapabilityOutput generalization

- **Query**: map the 4 new caps (+ screenshot) to Sensitivity Tiers (ADR 0002); per-capability default gate policy; enumerate core-side tools + output shapes; how does `CapabilityOutput` generalize beyond screenshot
- **Scope**: internal (ADR 0002, gate seam, protocol/schema)
- **Date**: 2026-07-11

## Verdicts (read first)

1. **CapabilityOutput must stop being a single struct.** Today it's screenshot-shaped in three mirrored places (`protocol.rs:122-131`, `capability-schema.ts:25-31`, and the untagged `CapabilityRespond::Ok{output}`). The cleanest generalization that preserves invariant 3 (one shape, mirrored): **make the wire `output` an opaque JSON blob at the channel layer, and let each capability own its own zod/serde schema that it parses the blob with.** The gate/broker/registry stay capability-agnostic; only the per-capability tool (Core) and exec (Shell) know the concrete shape. Alternative: a discriminated union keyed by capability. Recommendation + tradeoffs below — **flag for leader, this is the second big design call.**
2. **Tiers** (ADR 0002 language + CONTEXT.md "Sensitivity Tier"): screenshot = High; process-list = Medium; clipboard-read = Medium; clipboard-write = Medium-High; shell-open = **High**; workspace-files = Low (Core-side, own directory) — see table.
3. **Default gate policy**: everything is **always-ask** in v1 (the gate has no per-tier auto-allow yet — `GatePolicy` only has an enable/disable switch, `gate.rs:18-35`; operator config is deferred to #23). So "tier" today informs *defaults for the future policy table*, not current behavior. All four Shell capabilities go through the same two-step approval dialog. workspace-files (Core-side) is the exception — not gated by the Rust gate at all (see `workspace-files.md`).

## Findings

### Tier mapping (ADR 0002 + CONTEXT.md)

CONTEXT.md defines Sensitivity Tier as low (window title, process name — default on) vs high (full screenshot — off by default). Extending that spirit to the action capabilities:

| Capability | Reads/Writes | Sensitivity Tier | Rationale | Proposed default policy (future table) |
|---|---|---|---|---|
| screenshot | reads screen pixels | **High** | full-screen content, most invasive read (CONTEXT.md example of high tier) | always-ask |
| process-list | reads process metadata | **Medium** (Low if name+pid only; Medium if `cmd` argv included) | window/process *names* are Low tier per CONTEXT.md; full argv can leak URLs/tokens → Medium | ask-first-then-session, or auto-allow if name-only |
| clipboard-read | reads clipboard text | **Medium** | can contain passwords/secrets the user copied | always-ask |
| clipboard-write | writes clipboard text | **Medium-High** | can plant content (phishing, command strings the user then pastes) | always-ask |
| shell-open | launches url/file/app | **High** | arbitrary launch ≈ code execution surface (see `shell-open.md`) | always-ask, show target |
| workspace-files (Core-side) | reads/writes Core's own Workspace | **Low** | the agent's own scratch dir; memory engine already writes it ungated | auto-allow within Workspace |

Note: ADR 0002 explicitly lists "screenshot, process list, clipboard, shell-open, workspace file RW" as the typed capabilities and says they "carry their own per-capability switches and Sensitivity Tiers" (line 10) — this task realizes that list.

### Current gate reality (what actually happens in v1)

- `GatePolicy` (`gate.rs:18-35`) has ONLY an enable/disable set — no tier, no auto-allow-by-tier. Operator config lands with #23 (comment `gate.rs:16-17`).
- Every enabled capability with no remembered verdict → the two-step dialog (`approver.rs`). Remembered `Always`/`Never` short-circuit (`gate.rs:70-74`).
- So for THIS slice, adding a capability = it's enabled by default and always-asks until the user picks "always". The tier table above is **design intent for #23's policy table**, not code to write now — unless the leader wants a minimal per-capability default-decision seed. Flag for leader.
- **Per-capability gating already works by name**: `gate.evaluate(&request_id, &capability)` (`ws_client.rs:161`) and `DecisionStore` key on the capability string. Each new capability is independently remember-able with zero gate changes. The gate is genuinely capability-agnostic already — good.

### Core-side agent tools to add (one per capability, invariant 7)

Mirror `screenshot-tool.ts` (`tool({...})`, `execute` never throws, route→broker→shape). Registered via `extraTools` spread in `main.ts:168`.

| Tool file (proposed) | Capability | Input schema | Output to model (text-friendly) |
|---|---|---|---|
| `process-list-tool.ts` | process-list (Shell) | `z.object({})` | JSON array of `{pid,name,memoryBytes,parentPid,...}` — model reads directly |
| `clipboard-read-tool.ts` | clipboard-read (Shell) | `z.object({})` | `{ text }` — trivial |
| `clipboard-write-tool.ts` | clipboard-write (Shell) | `z.object({ text: z.string() })` | `{ ok:true }` ack |
| `shell-open-tool.ts` | shell-open (Shell) | `z.object({ kind: z.enum(["url","path"]), target: z.string().min(1) })` | `{ ok:true, opened }` ack |
| `read-file-tool.ts` | workspace-files READ (**Core-side, no broker**) | `z.object({ path: z.string().min(1) })` | `{ path, content, bytes, truncated }` |
| `write-file-tool.ts` | workspace-files WRITE (**Core-side, no broker**) | `z.object({ path: z.string().min(1), content: z.string() })` | `{ ok:true, path, bytes }` |

Key asymmetry: the first four route through `deps.broker.request(CAPABILITY, input, node.notify)` (Shell round-trip + gate). The last two do **local `node:fs`** with the Workspace-confinement check — no broker, no node, no Rust gate (see `workspace-files.md` verdict 1). All six degrade failures into `{ok:false, code, message}` per the screenshot tool's error contract (`screenshot-tool.ts:31-54`).

Shell side (first four only): each gets a `capabilities_impl/<name>.rs` implementing `CapabilityExec`, one `handlers.register(Arc::new(...))` line and one entry in `capabilities: vec![...]` (`lib.rs:88-96`).

### CapabilityOutput generalization — the design options

**Problem**: `CapabilityOutput` is a fixed struct `{mediaType,dataBase64,width,height}` in `protocol.rs:122-131` + `capability-schema.ts:25-31`, embedded in `CapabilityRespond::Ok{output}` (`protocol.rs:152-157`) and `CapabilityRespondParamsSchema` (`capability-schema.ts:44-48`). Four new capabilities have four different output shapes. It cannot stay screenshot-only.

**Option A — opaque output blob at the channel, per-capability schema at the edges (RECOMMENDED):**
- Change the wire `output` type to `z.unknown()` / serde `serde_json::Value` (it already is `Value` in many places). The `CapabilityRespond::Ok` carries `output: Value`; the Shell exec produces a `Value` (each exec serializes its own struct), the Core tool parses the `Value` with its own capability-specific zod schema.
- Pros: gate/broker/registry/`CapabilityRespond` never change again when a capability is added (invariant 7 — adding a capability touches only its own module + registry entry). Matches how `input` is ALREADY handled (`CapabilityRequest.input: Value`, `capability-schema.ts:20` `input: z.unknown()`). Symmetric.
- Cons: the strong-typing/golden-fixture guarantee at the channel layer weakens — the channel no longer validates output shape; validation moves into each capability's tool. Mitigate: each capability defines `XOutputSchema` in `@taki/shared` (or colocated) and the tool `.parse()`s it, so there's still one zod source per capability, mirrored in Rust by that capability's serde struct.
- Naming per CLAUDE.md: `ProcessListOutputSchema` → `ProcessListOutput`, etc., one per capability file.

**Option B — discriminated union keyed by capability:**
- `CapabilityOutputSchema = z.discriminatedUnion("capability", [ScreenshotOutput, ProcessListOutput, ...])` with a matching serde `#[serde(tag="capability")]` enum.
- Pros: channel still validates the full shape; golden fixtures still cover every output.
- Cons: **every capability addition edits the shared union + the Rust enum** — a central file every feature touches, which is exactly the "god-bucket"/central-registry coupling invariant 7 warns against. Also the untagged `CapabilityRespond` enum discriminates on `ok`, and nesting a second discriminant is more serde complexity.

**Recommendation**: **Option A** — it's consistent with the already-opaque `input`, preserves invariant 7 (no central edit per capability), and keeps the golden-fixture channel tests focused on the envelope (`ok`/`requestId`/`error`) while each capability owns its payload schema + its own tests. The screenshot output schema becomes just the first per-capability output schema, moved out of the channel core.

Either way, the `CapabilityErrorCode` union (`DENIED|EXEC_FAILED|UNSUPPORTED_CAPABILITY`) and the `CapabilityRespond` Ok/Err envelope stay unchanged — only the `output` *payload* type generalizes.

## Related code / specs

- `docs/adr/0002-exec-in-v1-behind-permission-gate.md:10` — the typed-capability list + per-capability tiers this task realizes.
- `CONTEXT.md:17-18, 43-44` — Sensitivity Tier + Capability glossary.
- `apps/desktop/src-tauri/src/gate.rs:18-35` — `GatePolicy` (enable/disable only; no tier logic yet).
- `apps/desktop/src-tauri/src/protocol.rs:122-164` — `CapabilityOutput` + `CapabilityRespond` (the shapes to generalize).
- `packages/shared/src/capability-schema.ts:15-52` — the wire contract; `input: z.unknown()` is the precedent for opaque payloads (Option A).
- `packages/core/src/capabilities/screenshot-tool.ts` — the tool pattern all six copy.
- `packages/core/src/main.ts:168` — `extraTools` registry (core-side plug point).
- `apps/desktop/src-tauri/src/lib.rs:88-96` — Shell register + declared-capabilities plug point.

## Caveats / Not Found

- No existing per-tier policy code to extend — tiers are currently descriptive, realized only as always-ask + remember. Confirmed by reading `gate.rs` (no tier field).
- Whether #23's operator-config policy table shape is already sketched anywhere: not found in `docs/adr/` (0001-0006 only). The tier defaults above are proposals for that future work.

## Leader decisions needed

1. **CapabilityOutput generalization**: Option A (opaque `Value` output + per-capability schemas, recommended — matches `input`, preserves invariant 7) vs Option B (discriminated union in shared + Rust enum). This is a cross-cutting protocol decision blocking all four Shell capabilities.
2. **Tier→policy now or later**: seed per-capability default decisions/tiers in this slice, or leave everything always-ask until #23's operator config? Recommend: leave always-ask; don't build the policy table early (KISS).
3. **process-list tier** hinges on the `cmd` decision from `sysinfo-clipboard.md` (name-only = Low, argv = Medium).
4. **workspace-files gating**: confirm it's Core-side and auto-allowed within Workspace (per `workspace-files.md` verdict 1), i.e. NOT in the Shell `capabilities` list and NOT gated by the Rust gate.
5. **Where per-capability output schemas live**: in `@taki/shared` (one file per capability, mirrored in Rust) vs colocated with each tool. Recommend `@taki/shared` for the Shell-mirrored ones (invariant 3), colocated for the Core-only file tools.
