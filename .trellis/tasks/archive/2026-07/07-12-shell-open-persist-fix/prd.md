# PRD — shell-open: authorize by (capability, targetClass), fix A1

`shell-open` (open a url OR a local path/program) authorizes through the name-keyed `Gate::evaluate`, whose `Always` **persists** and then short-circuits every future request — no dialog, no target shown. Combined with `plan_open` doing **zero validation on `kind:"path"`**, a user who granted "Always" on a harmless URL (natural for a url) has silently permitted a prompt-injected agent to `{kind:"path", target:"…cmd.exe"}` and run **arbitrary executables** with no dialog and no readable interception point. This is Opus review finding A1 / register entry D2 — a M4-blocking security defect.

The root cause is a granularity mismatch: **the capability NAME does not determine risk for shell-open — the target does.** `exec` already learned this (it classifies by the command and never persists). `shell-open` is the last capability that authorizes by name while its risk is set by the argument.

## Cross-agent grounding (this is not a guess)

Researched Claude Code, Codex CLI, Cline, OpenHands, Goose, OpenClaw, Hermes. Unanimous consensus:
1. Risk-bearing capabilities authorize by **argument/command/path, never by tool name alone** (Claude Code `WebFetch(domain:x)` / `Bash(npm run test:*)`; Cline command-glob; Codex sandbox roots; OpenClaw binary-path allowlist).
2. A persistent allow on a safe class **must not leak into a riskier class** (OpenClaw `strictInlineEval`, Codex read-only vs workspace-write vs full-access, Cline "Execute safe" vs "Execute all", Hermes bypass-immune rules).
3. Safe class → silent; risky class → always-ask, never persisted; and even a "risky always" keys on the specific pattern, never the tool name.

## Design — authorize by `(capability, targetClass)`

**Move the authorization key from the capability name to `(capability, targetClass)`.** The Gate classifies the shell-open target (mirroring how `exec` classifies the command), then remembers/asks per class. All classification lives in the **Rust Permission Gate** (ADR 0002); Core only sends the request and reads the structured result.

Target classes (from `plan_open`):
- **`url-safe`** — `http` / `https` / `mailto` (the existing scheme allowlist). May be remembered once/session/always → **silent after an Always** (the whitelist-silent behavior the owner wants).
- **`local-file`** — a local path to a NON-executable file (e.g. `report.pdf`). **Always-ask, never persisted** — the target varies per request, so its risk does too.
- **`local-exec`** — a path to an executable/script (`.exe .bat .cmd .com .ps1 .sh .msi .hta .lnk .scr .vbs .js`, UNC paths). **Bypass-immune floor**: always at least ask, **never persisted, and unreachable by any future "trust mode"** (mirror Hermes). A hard-blocklist subset may deny outright.
- **`blocked-scheme`** — non-allowlisted url scheme (`javascript:` `file:` `data:` …) → deny, no dialog (existing behavior, keep).

Key mechanics:
- `plan_open` gains classification (it currently rubber-stamps `kind:"path"`); the class is derived, not trusted from input.
- The Gate's decision memory keys on `(capability, targetClass)`, so an `Always` on `shell-open:url-safe` is **independent** of `shell-open:local-exec` — A1 is structurally impossible.
- The dialog still shows the concrete target (detail) for every ask (never audited/logged — ruling 4 unchanged).

## Rulings / constraints
- **R1** — authorization key is `(capability, targetClass)`; an `Always` on one class NEVER authorizes another. `url-safe` Always must not permit a `local-exec` open.
- **R2** — `local-exec` is a bypass-immune floor: always ≥ ask, never persisted, not overridable by a future trust/auto mode. Optionally a hard-deny subset.
- **R3** — classification + per-class memory live in the Rust Gate (ADR 0002 / invariant 1). Core is unchanged; it sends `{kind,target}` and reads a structured allow/deny.
- **R4** — capabilities whose risk is FIXED (screenshot, process-list, clipboard-read) keep name-keyed once/session/always — this task does NOT touch them. Only shell-open (arg-determined risk) changes.
- **R5** — `exec`'s command-classification model is untouched (already correct).
- **R6** — verified on task-1's e2e net. Core regression: a `url-safe` Always followed by a `local-exec` open still asks/denies (A1 gone). Plus: `local-exec` extension rejected, `local-file` asks every time, `url-safe` Always → silent.
- **R7** — all gates green incl. `cargo test` + clippy (this is a Rust-Shell change).

## Out of scope (defer → docs/deferred-decisions.md)
- **Domain-level url whitelist** (`domain:*.github.com` granularity, à la Claude Code) — nice-to-have finer control; the three-class split already closes A1.
- **Smart/LLM reviewer** for un-allowlisted risky targets (Codex Smart Approvals / Hermes smart) — a make-it-fast layer, not needed to fix A1.
