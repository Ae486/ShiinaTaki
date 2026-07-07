# Exec tool in v1, executed only by the Rust Permission Gate

The agent gets a general-purpose `exec` (shell) tool from v1, alongside typed capability tools (screenshot, process list, clipboard, shell-open, workspace file RW). OpenClaw and Hermes both prove that shell is the highest-leverage "hands" for an agent, and the hard parts of governing it (command parsing, approval flow, audit) do not get cheaper by deferring.

Rules:
- The TS Agent Core never spawns processes. Every exec request crosses the WS boundary to the Rust Shell, which enforces policy, spawns, and audits.
- Policy modes `deny | allowlist | full`, default `allowlist`. A command auto-runs only if every pipeline segment matches the allowlist; chaining (`;`, `&&`, `||`) or redirection escalates to a user approval dialog. Unparseable commands escalate — never guess (fail-closed).
- A blocklist of catastrophic patterns (`rm -rf`, `format`, `reg delete`, ...) is rejected outright without approval — a tripwire, not the primary defense.
- Child processes run with cwd defaulting to the Workspace, scrubbed env (no API keys), a timeout, and output size caps.
- Typed system actions (screenshot, process list, clipboard) do NOT go through exec: they need structured returns and carry their own per-capability switches and Sensitivity Tiers.
- Keyboard/mouse simulation and kill-process are not capabilities in v1 (deferred, not reserved).

Known limitation, accepted: no sandbox on Windows in v1 (Docker requires WSL2, conflicting with the low-footprint goal). Blast-radius control relies entirely on the rules above plus the audit log. Adding a sandbox later is an enhancement, not a rework.
