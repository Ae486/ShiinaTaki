# core/config/
- provider-config.ts — TAKI_PROVIDER_* env → { baseUrl, apiKey, model }; fatal-fast, names missing var
- vision-config.ts — TAKI_VLM_* env → { baseUrl, apiKey, model } | null (feature off); the optional vision slot, partial = fatal
- attachment-config.ts — TAKI_ATTACHMENT_TTL_DAYS env → { ttlDays, ttlMs }; image-retention TTL (default 14; fail-closed parse)
- memory-config.ts — TAKI_MEMORY_PINNED_BUDGET env → { pinnedBudget }; the pinned-row safety valve (default 800; garbage = fatal). Per-block budgets are registry rows, not env vars
- server-config.ts — TAKI_WS_* / TAKI_LOG_LEVEL / TAKI_DATA_DIR / TAKI_PROMPT_DIR / TAKI_TRUST_LOOPBACK_OPERATOR env → { host, port, logLevel, dataDir, promptDir, trustLoopbackOperator } with defaults
- agent-config.ts — TAKI_MAX_STEPS env → { maxSteps } per-turn tool-loop cap (default 10; D11 config-ization)
- ambient-screenshot-config.ts — TAKI_AMBIENT_SCREENSHOT / _RETENTION env → { enabled, retention }; ambient screen sampling is OFF by default and its raw frames drop right after describe (keep / N days are the opt-ins; garbage = fatal)
