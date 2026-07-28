# The model sees a replay view; the stored timeline is never rewritten for context reasons

Each turn the Agent Core derives what the model sees — the **replay view** — from the stored timeline:
window selection, summary substitution (compaction), payload folds, and ephemeral in-flight additions
(volatile context: minute-level time line, activity block, perception card) all happen ONLY in this
derivation, at one seam (`conversation-store.history()` + outgoing-message assembly). The stored
timeline stays append-only (ADR 0005); no context-management mechanism ever rewrites it.

Three properties are load-bearing:

- **Idempotent**: the view is recomputed from storage every turn, never accumulated across turns
  (the accumulation failure mode is LangGraph JS #1316: a view channel without a replace-reducer
  grew `[a] → [a,a,b] → ...` and silently defeated trimming).
- **Ephemeral additions are never persisted**: injected volatile blocks ride the outgoing request
  only. The alternative — Codex persists appended `<environment_context>` messages (PR #2243) — is
  viable and equally cache-stable, but our timeline is a user-facing relationship stream (ADR 0005
  scroll-back): machine stamps would pollute it. Hermes' gateway strips per-message timestamps
  before storage for the same reason.
- **Cache-shaped**: the system prompt stays byte-stable within a calendar day; per-turn volatile
  content enters at the END of the request (in-flight message tail). Breakpoint-less prefix caches
  (OpenAI-compatible/DeepSeek) match from token 0 — the system string is effectively `messages[0]`,
  so any per-turn change there invalidates the entire replayed history every turn. "Stable-early /
  volatile-late" applies to the REQUEST, not to the inside of the system prompt.

Why an ADR: this fixes where context management is allowed to happen — everything T5+ builds
(summaries, folds, token windowing, T4 heartbeat context) rides this one seam, and the shape is
surprising without background (the model sees things the DB does not store, and vice versa). Prior
art: OpenClaw's "idempotent replay view" (the only first-party name for this seam), Claude Code's
message-channel dynamic injection (`<system-reminder>`), Codex's append-only environment context,
OpenAI's first-party cache guidance ("static at the beginning, variable content at the end").
