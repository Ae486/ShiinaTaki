# core/config/
- provider-config.ts — TAKI_PROVIDER_* env → { baseUrl, apiKey, model }; fatal-fast, names missing var
- server-config.ts — TAKI_WS_* / TAKI_LOG_LEVEL / TAKI_DATA_DIR / TAKI_PROMPT_DIR / TAKI_TRUST_LOOPBACK_OPERATOR env → { host, port, logLevel, dataDir, promptDir, trustLoopbackOperator } with defaults
- agent-config.ts — TAKI_MAX_STEPS env → { maxSteps } per-turn tool-loop cap (default 10; D11 config-ization)
