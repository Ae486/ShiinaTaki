# Notes — 08-02-cli-operator-call

## Closure (2026-08-02)

Implement (opus) + check (opus, PASS) + leader fold-ins, all gates green at close:
typecheck x5 / lint / cli **32** / core 1101 / shared 199 / desktop 143.

Deviations, all ruled:
- impl D1: one-shot argv validated BEFORE opening the socket (typo fails fast without a core) — endorsed.
- impl D2 / check concern 3: runner errors print to the `output` stream (stdout in one-shot mode), exit
  code is the script contract. LEADER DECISION: keep as-is (prd fixed the signature; scripts key on 0/1).
  If jq-clean stdout is ever wanted, split streams then — behavior change, do it before scripts depend on it.
- check D3: dead core = one friendly `[connect failed]` line + exit 1 (was an unhandled-rejection stack;
  fixes the REPL entry too). +1 test pinning connectChatClient rejects catchably (cli 31→32).
- check D4: usage line names both entry forms (`/call` + `--call`).
- leader fold-ins (post-check, from its ranked concerns 1-2): parseArgs wrapped — `--call` without a value
  or an unknown flag prints reason + usage and exits 1 (was a Node stack); `--params` without `--call`
  rejected explicitly (was a silent swallow — boundary-validation red line). USAGE exported as
  OPERATOR_CALL_USAGE for the entry seam. Smoke-verified all three argv failure paths (exit 1, no stack).

Live-core verification (leader, port 18990, temp data dirs, loopback auto-trust P3):
- `--call memory.tidy --params '{"characterId":"taki"}'` → `{status:"clean", defects all 0, usage.calls 0}`,
  exit 0 — clean-store-zero-model-calls semantics confirmed end to end.
- `--call nosuch.method` → `[-32601] Method not found: nosuch.method`, exit 1.

Evolution stance (owner constraint honored): no client-side allowlist/schemas anywhere; `chat-client.call`
is a raw passthrough — a future `config.*` method works the day the server registers it. A dedicated
command family later = sibling module + one `handleLine` branch; command registry only if families >3.
