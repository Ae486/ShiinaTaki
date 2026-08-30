# Logging Guidelines

## TS (Agent Core)

- **pino** for structured JSON logging (stdout in dev; file under the app data root `%USERPROFILE%\.takiagent\logs\` in packaged mode — outside the Workspace).
- One logger per module via child loggers: `logger.child({ mod: "server" })`.
- Levels: `error` (broken invariant / lost data), `warn` (degraded but recovered), `info` (lifecycle: start/stop, client pair/connect, task fire), `debug` (per-message detail — default off).
- Never log: API keys, full LLM prompts/responses (log token counts + ids instead), screenshot bytes, clipboard contents.
- Model/provider/Utility exceptions may embed request content or credentials. Log a closed internal failure code and a
  bounded operation label; never pass raw `error.message`, response bodies, or serialized exceptions to ordinary logs.

## Rust (Shell)

- **`tracing`** crate + `tracing-subscriber` (JSON output matching pino field style: `level`, `msg`, `mod`, `ts`).
- Spans around Capability executions (`gate.request` span with capability + decision).

## Audit log (separate from app logs)

- Every Permission Gate decision writes one JSONL line to `%USERPROFILE%\.takiagent\audit\audit-YYYY-MM.jsonl`. **The audit log lives OUTSIDE the Workspace and is written by the Shell only** — the agent's workspace file-RW Capability must never be able to reach or tamper with its own audit trail:
  ```json
  {"ts": "...", "capability": "exec", "detail": "...", "decision": "allowed|approved|denied|blocked", "source": "policy|user|blocklist"}
  ```
- Audit entries are append-only, never rotated away by log level config, and never contain secret values (command lines are recorded; env is not).
