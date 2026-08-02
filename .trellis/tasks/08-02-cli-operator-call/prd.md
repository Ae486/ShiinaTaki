# PRD — CLI generic operator invoker

Owner ruling 2026-08-02 (plan B, step 1): give the operator a lasting scriptable entry for
operator-only WS methods, so manual checks (85 memory.tidy, perception.*, future config.*) no longer
need throwaway WS scripts. The full settings panel remains its own later task; this module must be
designed to COEXIST with it (dual entry, single store — HANDOFF coupling point 4), not to be replaced
by it. Owner constraint verbatim: "注意后期的优化而不是只按当前的'能测'做为终版" — build the small
thing properly, as the permanent scriptable/diagnostic surface.

## Scope (apps/cli only; zero core/shared changes)

1. `chat-client.ts` gains `call(method: string, params: unknown): Promise<unknown>` — a thin
   `rpc.request` passthrough on the existing authenticated socket. No client-side method allowlist
   and no per-method schemas: the server's method registry already enforces roles + zod-validates
   params; the CLI prints what the server returns. This is what keeps the surface generic — a future
   `config.*` method works the day the server ships it.
2. NEW `src/operator-call.ts` (+ colocated test) — the feature module and the seam where future
   operator command families land:
   - `parseOperatorCall(line)`: recognizes `/call <method> [json-params]`. Returns a discriminated
     result: not-a-call (plain chat line) / ok {method, params} / usage error (human message, e.g.
     bad JSON, missing method). Params omitted -> `{}`. Never throws on user input.
   - `runOperatorCall(client, call, output)`: invokes `client.call`, pretty-prints the JSON result;
     a JSON-RPC error (JSONRPCErrorException) prints one structured `[code] message` line — the REPL
     survives every failure (error-handling spec: structured degrade, never a crash).
3. `main.ts` wiring (thin dispatch, no logic inline):
   - REPL: lines starting with `/call` route to operator-call; everything else stays chatTurn.
   - One-shot mode for scripts: `--call <method> [--params <json>]` argv options — authenticate
     (pairing ask still interactive on first run), run exactly one call, print result, exit 0
     (success) / 1 (error), skipping REPL and history replay.

## Acceptance

- Unit: parser (null on chat lines; `/call memory.tidy` -> `{}` params; with JSON params; bad JSON ->
  usage error; empty method -> usage error) and runner (mocked client: success prints JSON; rpc error
  prints `[code] message` without throwing) — all at the module seam, no WS needed.
- `client.call` passthrough covered at the chat-client test seam if one exists; otherwise the
  operator-call runner test with a mocked ChatClient suffices (transport is one line).
- Gates: `pnpm -r typecheck && pnpm -w lint && pnpm -r test` (cli baseline 18 tests + new; core 1101 /
  shared 199 / desktop 143 untouched).
- Leader manual verification (not the implementer's): boot core, `pnpm cli:dev -- --call memory.tidy
  --params '{"characterId":"taki"}'` returns `{status, defects}` counts.

## Constraints

- Anti-sprawl: new concern = new file; main.ts stays thin glue; caps 300/50/3; INPUT/OUTPUT/POS
  headers; update `src/index.md`.
- No `@taki/core` import in cli (existing rule); `@taki/shared` constants (MEMORY_METHODS etc.) are
  fine in tests/docs but the runtime surface stays string-generic.
- English code/comments; Conventional Commit scope `cli`.
