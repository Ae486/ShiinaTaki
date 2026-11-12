# Core startup configuration recovery: next real Chat Run

## Scope and source

- The original task requires no-model basic-plane startup and supported configuration recovery. The former
  `smoke-core-result.json` proved explicit model testing, but contained zero Runs throughout; it did not prove the
  next real chat after live configuration. This focused extension closes that deterministic process gate.
- Workspace: `G:/TakiAgent-integration`, branch `integration/main-t4-20261111`, current uncommitted integrated source.
  The existing task was bound through `task.py start`; the script reported session-scoped binding.
- Changed only `research/smoke-core.mjs` and added this note plus the new timestamped result below. No production
  code, original H: worktree/profile, credentials, Git refs or original result artifact was changed.
- The test-only loopback provider follows `e2e/src/fixture/scripted-provider.ts` OpenAI-compatible SSE framing.
  The Core runs the production entry, actual provider adapter, ChatAgent and public RPC/notification path.
  Shared `ChatSendResultSchema`, `ChatDeltaSchema` and `ChatCompleteSchema` validate the received chat contract.

## Reproduction and artifacts

Run from `G:/TakiAgent-integration` with Node `v24.18.0`:

```powershell
node --check .trellis/tasks/11-11-main-t4-baseline-integration/research/smoke-core.mjs
node .trellis/tasks/11-11-main-t4-baseline-integration/research/smoke-core.mjs
```

Both commands exited 0. The process smoke ran once, from `2026-11-12T10:02:55.540Z` to
`2026-11-12T10:03:08.123Z` (12.583 seconds). No full lint/typecheck/package suite was rerun for this research-only change.

- Result: [smoke-core-result-2026-11-12T10-02-55-540Z-35220.json](./smoke-core-result-2026-11-12T10-02-55-540Z-35220.json).
- Fresh retained data/evidence root: `G:/taki-integration-boot-3V55M2`.
- Core data roots: `no-model/` and `invalid-optional-memory/` under that root; reopen uses the first database.
- `USERPROFILE`, `LOCALAPPDATA`, `APPDATA`, `TEMP` and `TMP` point into fresh G: directories. The only inherited
  environment names are `PATH`, `SystemRoot`, `WINDIR`, `COMSPEC` and `PATHEXT`. Core is launched directly without
  an env-file argument, model/provider environment, credential helper, Native or PostgreSQL.
- SQLite observations use a WAL-aware `DatabaseSync(..., { readOnly: true })`, including before admission,
  after refusal, before the recovered chat, after completion, after force termination and at reopen.

## Observations

| Stage | Core PID | Total Runs | Completed Runs | Provider requests |
| --- | --- | ---: | ---: | ---: |
| Fresh no-model startup, before refusal | 34948 | 0 | 0 | 0 |
| `chat.send` returns `CONFIG_REFUSED` / `MODEL_UNAVAILABLE` | 34948 | 0 | 0 | 0 |
| Main apply plus explicit `config.modelProfileTest` | 34948 | 0 | 0 | 1 nonstream test |
| Next actual `chat.send`, same PID and operator socket | 34948 | 1 | 1 | 1 additional SSE chat |
| Invalid apply retains the active last-good Main | 34948 | 1 | 1 | No additional request |
| Invalid optional Memory policy, no Main | 33544 | 0 | 0 | 0 |
| Reopen last-good Main and completed history | 16368 | 1 | 1 | 0 |

The recovered chat completed in 155 ms with exact streamed and persisted assistant text:

> Integration live configuration recovered without a Core restart.

Run `5419bead-9574-4225-8f65-79173bfae3ff` has `initiator=primary`, `state=completed`, `outcome=completed`
and a terminal timestamp. Its Attempt records `model_id=integration-controlled-model` and completed state/outcome.
The same Run identity and exact Timeline text survive termination and reopen. All databases report migration head 77.

`config.list` and `timeline.history` succeed in all three processes. The invalid optional case sets
`TAKI_MEMORY_STOPLIST=invalid` and `TAKI_MEMORY_TIDY_MAX_STEPS=bad`; it keeps that basic plane available and refuses
the no-model chat before Run admission. The invalid Main apply retains the previous application-owned active model,
reports `applicationState=failed`, and retains the same state after reopen.

The provider received exactly two `POST /v1/chat/completions` requests for the controlled model: one explicit
nonstream connection test, then one streaming chat. Neither carried Authorization. Startup, profile apply,
invalid apply, the invalid Memory case and reopen issued no provider requests.

Core listening times were 4,376 / 3,999 / 3,619 ms. Available physical memory was 5,985,204 KiB before execution
and 6,061,332 KiB at the post-run check; process peak memory was not measured. Execution was sequential.
All three owned PIDs were absent at the final `Get-Process` check. Windows `child.kill("SIGTERM")` here is force
termination after socket close, not evidence of graceful shutdown; that gate is owned by the separate shutdown check.

## Artifact integrity and limits

SHA-256:

- Executed `smoke-core.mjs`: `554ecea16baab5fc5745b1802784cfc7d793d457e6cdf41285c4aa5f70fa47e6`.
- New result: `dfca505cf187e240fbc6efeaf2c9077c402ae304d47e2439e22e9f9d32c1f393`.
- Original `smoke-core-result.json`, unchanged before/after:
  `e72f86498798d5eba8f58acd0741fb44fa504813fe09fbdb4de37d3cc5578d1e`.

This is deterministic loopback-model and real Core/RPC/SQLite evidence. It does not establish paid-provider behavior,
Native/Home rendering, owner-manual acceptance, graceful shutdown, or model-binding retention for already-running
work. No new production behavior or broader acceptance claim is introduced.
