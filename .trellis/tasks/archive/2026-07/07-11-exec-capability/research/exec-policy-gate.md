# Research: exec policy engine and its meeting with the gate

- **Query**: Modes deny|allowlist|full; where allowlist/mode config lives; the per-command-vs-per-capability gate-decision mismatch; once/session/always granularity; audit-includes-command tension
- **Scope**: mixed (ADR 0002 + gate.rs/decisions.rs/approver.rs/audit.rs + #11 config precedent)
- **Date**: 2026-07-11

## Verdict (read first)

1. **exec must pre-classify (allow / escalate / block) BEFORE and AROUND the gate — it cannot use `Gate::evaluate` as-is.** The current gate decides per **capability name** (`gate.rs:65`, keyed on the string `"exec"`). exec needs the decision to depend on the **parsed command**: `git status` may auto-run while `rm x` escalates, both under the capability `"exec"`. The clean design: exec computes its class internally (parser + policy mode), and only invokes the approver for the ESCALATE case, passing the full command as the dialog `detail`. BLOCK never reaches the gate (immediate reject). SIMPLE+allowlisted in `allowlist` mode never reaches the approver (auto-run) — but must STILL be audited.
2. **The gate's once/session/always memory is `capability`-keyed and MUST NOT be reused verbatim for exec.** A remembered "always allow exec" would auto-approve *every future command* — catastrophic. Either exec does NOT participate in always/session memory at all (every ESCALATE always asks), or the memory key must be **per exact command string** (or per argv[0]), never the bare capability name. **Recommend: v1 exec ESCALATE is always-ask, no "always" persistence** (simplest safe default; matches ADR's "escalates to a user approval dialog" with no memory clause). Flag the granularity as a firm user decision.
3. **Config (mode + allowlist) source for v1:** an operator-owned Shell-side file mirroring the `mcp-servers.json` precedent — under `app_data_dir()`, loaded at boot, missing/malformed → SAFE default (mode=`allowlist`, empty or a tiny built-in allowlist). #23 owns the UI later; v1 needs a file source now.
4. **Audit-includes-command is a real, unavoidable tension.** Today the audit line is names-only ("never the input, the image, or a path" — audit.rs:25). For exec, an audit line WITHOUT the command records only "exec was allowed" — near-useless as the blast-radius record ADR 0002 wants. Recommend: the exec audit line INCLUDES the command string, as a deliberate, exec-specific exception to names-only. Flag — this breaks the current invariant and needs a ruling.

## Findings

### The three policy modes (ADR 0002, read carefully)

ADR 0002: modes `deny | allowlist | full`, default `allowlist`.
- **deny** → exec always rejected, no dialog. (The `GatePolicy::disabled` set at `gate.rs:18-34` is the existing analogue — a disabled capability auto-denies. exec `deny` mode = exec is in that disabled set, OR exec's own policy short-circuits to reject.)
- **allowlist** (default) → SIMPLE + every needed part allowlisted → auto-run; chaining/redirection/unparseable/non-allowlisted → ESCALATE to dialog. (Per exec-parser.md, ANY chaining already forces ESCALATE, so "auto-run" only ever applies to a clean single allowlisted command in v1.)
- **full** → the ADR does NOT say "auto-run everything." Its exec rules only ever describe auto-run for allowlisted-simple and escalation otherwise. The safe reading of `full`: **everything escalates to a dialog** (the user can run anything, but always confirms) rather than "auto-run anything." An "auto-run anything" reading would make `full` a blanket bypass of the gate, which contradicts the whole ADR. **Recommend `full` = always-escalate (never auto, never blocked-by-allowlist); BLOCK catastrophic patterns still apply even in `full`.** Flag for confirmation — the ADR is genuinely ambiguous here.

The BLOCK (catastrophic) sieve is mode-INDEPENDENT: it fires in every mode, before mode logic. ADR: "rejected outright without approval."

### The gate-decision mismatch (the central design problem)

Current flow (`ws_client.rs:156-174` → `gate.rs:65`):
```
detail = handlers.detail(capability, input)          // per-capability detail string
if gate.evaluate(request_id, capability, detail):    // decides on the NAME "exec"
    handlers.respond(...)                             // runs
```
`Gate::evaluate` order: disabled? → remembered verdict (by name)? → ask approver (by name). Every branch is keyed on the capability string. For exec this is wrong: the same name must yield different outcomes per command.

**Proposed integration (minimal, keeps the gate honest):** exec does its policy decision INSIDE its capability, not by overloading `Gate::evaluate`'s name-keyed path. Two shapes:

- **Shape A (exec owns its decision, calls a narrowed approver):** exec's `run`/pre-run computes `class = classify(command) ∈ {Block, Auto, Escalate}` from parser + mode + allowlist. `Block` → return a structured error (no dialog, audited as a deny). `Auto` → run, audited as auto-allowed. `Escalate` → call the approver with `detail = <full command>`; allow → run, deny/timeout → structured error; audited accordingly. This means exec needs a handle to the approver + auditor, which today live inside `Gate`. Cleanest: give exec its own thin decision path that reuses `Approver` (the trait is already tauri-free and injectable, `approver.rs:28`) and `AuditSink`, OR extend `Gate` with an exec-aware method.

- **Shape B (extend the gate with a richer entry point):** add `Gate::evaluate_exec(request_id, command, class)` alongside `evaluate`. The gate stays the single audit+approve chokepoint (preserves "every path audits exactly once"), but branches on the pre-computed `class` instead of a name-keyed memory lookup. This keeps exec from reaching around the gate (invariant: Core has no path around the gate; here, exec has no path around audit/approve).

**Recommend Shape B** — it keeps the gate as the sole approve+audit authority (the whole point of `gate.rs`), while letting the DECISION input be a parsed class rather than a bare name. exec computes the class (its policy engine), the gate turns class→approve?→audit. This respects "every path audits exactly once" (`gate.rs` invariant) and invariant 7 (exec is one module + one wiring point).

Either way, the key correctness rule: **exec must NOT go through the existing name-keyed `decisions.get("exec")` / `remember("exec", …)` path** unless the key is command-specific. See next.

### once/session/always granularity for exec (the dangerous knob)

`DecisionStore` (`decisions.rs`) keys memory by capability string: `get(capability)` / `remember(capability, scope, allow)`. `Remembered::Always` persisted → the gate auto-allows forever WITHOUT asking (`gate.rs:72`). If exec used this with key `"exec"`:
- User approves `git status` with "Always" → **every** future exec command auto-runs. This is a full gate bypass via one careless click. Unacceptable.

Options:
1. **exec ESCALATE is always-ask; no session/always for exec** (recommend for v1). The approver's two-step "remember?" prompt is simply not offered for exec, or its answer is ignored. Safe, simple, matches the ADR (which never mentions remembering exec approvals).
2. **Per-exact-command memory**: key = normalized full command string. "Always allow `git status`" remembers only that exact string. Safer than per-capability but still surprising (whitespace/arg variants differ; a user who allowed `npm run build` might be shocked it doesn't cover `npm run test`). More store surface, more tests.
3. **Per-argv[0] memory**: key = `git`. "Always allow git" auto-runs any allowlisted-simple `git …`. Convenient but broad — `git` has destructive subcommands (`git clean -fd`, `git reset --hard`). Risky.

**Recommend option 1 for v1** (always-ask, no persistence), with per-exact-command (option 2) as a possible #23-era enhancement. **Flag as a firm user decision — the task calls this out as one of the three most likely to need the user.**

### Where mode + allowlist config lives (v1)

Precedent: `packages/core/src/mcp/mcp-config.ts` — operator-owned `mcp-servers.json` under the app data root, loaded at boot, **missing → [] (normal), malformed → WARN + [] (never crash)**. Same philosophy for exec:

- A Shell-side file (e.g. `app_data_dir()/exec-policy.json`) holding `{ mode: "deny"|"allowlist"|"full", allowlist: string[] }`.
- Missing → SAFE default: `mode = "allowlist"`, allowlist = a small built-in safe set (or empty → nothing auto-runs, everything escalates). Malformed → WARN + safe default (mirror `loadMcpConfig`, and mirror `DecisionStore`'s corrupt-file-warns-empty stance, `decisions.rs:92`).
- Shell-side because exec is Shell-side and the allowlist governs Shell spawning; #23 will build the UI over this file later.

**Flag:** config file location + schema + the built-in default allowlist contents are leader decisions. The `mcp-servers.json` pattern (load-or-degrade-safe) is the settled precedent to copy.

### Audit — does the exec line include the command?

Current contract (`audit.rs:25`, `gate.rs:3`): "Records only names — never the input, the image, or a path." The audit is the agent-unreachable blast-radius trail (ADR 0002 / decision D10). Test `audit.rs:120` even asserts `input`/`output` are absent.

For exec, a names-only line (`{capability:"exec", decision:"auto-allowed"}`) records that *an* exec ran but not *what* — which defeats the audit's purpose for the single highest-stakes capability. The command string is arguably content (it may contain a path or a URL), which is why the current rule excludes it. **This is a real tension:**
- Include the command → the audit becomes a meaningful exec record (recommend), but breaks the names-only invariant and may log a path/arg the user typed.
- Exclude it → the exec audit line is nearly worthless.

**Recommend: the exec audit line includes the (normalized) command string, as a deliberate exec-specific exception**, documented at the audit seam. ADR 0002 frames the audit as the blast-radius record that *substitutes* for a sandbox on Windows — that purpose demands the command. Flag for a ruling, since it changes an invariant that #10/#11 deliberately established. (Note asymmetry: shell-open's target is dialog-only-never-logged because a launched URL is pure content; an exec command is an *action record*, a different category — this is a defensible reason to treat them differently.)

### External References

- ADR 0002 `docs/adr/0002-exec-in-v1-behind-permission-gate.md` — modes, allowlist auto-run rule, catastrophic blocklist, audit-as-blast-radius.
- `apps/desktop/src-tauri/src/gate.rs:18-96` — `GatePolicy` (disabled set = `deny`-mode analogue), `Gate::evaluate` name-keyed order, audit-exactly-once.
- `apps/desktop/src-tauri/src/gate/decisions.rs:52-72` — `get`/`remember` keyed by capability; `Remembered::Always` = auto-allow forever (the exec footgun).
- `apps/desktop/src-tauri/src/gate/approver.rs:28-30` — `Approver` trait is tauri-free + injectable (exec can reuse it for the ESCALATE dialog; `detail` carries the full command).
- `apps/desktop/src-tauri/src/audit.rs:25-26,120-127` — names-only contract + the test asserting no payload leaks (the invariant exec's command-in-audit would amend).
- `packages/core/src/mcp/mcp-config.ts:41-70` — the load-or-degrade-safe operator-config precedent for exec-policy config.

## Caveats / Not Found

- ADR 0002's `full` mode semantics are under-specified (auto-run-all vs always-escalate). I recommend always-escalate as the only reading consistent with the rest of the ADR, but this is inference, not a quoted rule — flag.
- No existing exec-policy config file or schema exists yet; the `mcp-servers.json` shape is the analogue, not a template already present for exec.
- Whether `deny` mode is expressed via the existing `GatePolicy.disabled` set or via exec's own policy engine is an implementation choice; both reach the same auto-deny + audit outcome.

## Leader decisions needed

1. **Gate integration shape** — recommend Shape B (`Gate::evaluate_exec(request_id, command, class)`, keeping the gate the sole approve+audit authority; exec computes the class). Confirm vs Shape A (exec owns approver/audit directly).
2. **once/session/always for exec** — recommend v1 = always-ask, NO persistence (safest). Per-exact-command as a later option. Per-capability "always" is forbidden (full bypass). **(One of the three the task flags as most likely to need the user.)**
3. **`full` mode meaning** — recommend "always escalate to dialog" (never auto, BLOCK still applies), NOT "auto-run anything." Confirm the ADR's intent.
4. **exec-policy config** — file location (`app_data_dir()/exec-policy.json`?), schema (`{mode, allowlist}`), and the built-in DEFAULT allowlist contents (or empty). Load-or-degrade-safe like `mcp-servers.json`.
5. **Audit includes the command?** — recommend YES for exec, as a documented exception to the names-only invariant (the command is the blast-radius record). This amends a #10/#11 invariant — needs an explicit ruling.
