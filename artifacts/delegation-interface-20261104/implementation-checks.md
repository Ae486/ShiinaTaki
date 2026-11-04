# Parent event interface implementation checks

Workspace: `H:/TakiAgent-worktrees/t4`; branch: `task/t4-skills-mcp-productization`.
Environment observed: Node `v24.18.0`, pnpm `10.22.0`, installed AI SDK `7.0.148`, Vitest `4.1.10`.

## Owned changes

`implementation-files.json` records all 27 changed source/test/index paths, final SHA-256 values and their preserved preimages. `implementation.diff` compares against those actual working-tree preimages, not Git HEAD. Two test files are new; other owned files preserve pre-existing changes.

- Eight production TS files implement the flat Shared model input, canonical action normalization, transactional event/action operation identity, original receipt/consumer reuse and current tool/inbox guidance.
- Five directory indexes describe the affected contracts. Fourteen tests are new or adapted to the public input schema. No dependency, migration, frontend/Rust, task/spec or general privacy projection change is included.
- Internal six-action and operator schemas remain unchanged. Exact model targets require all fields, including an explicit nullable `expectedRunId`. Questions/public answers/private child replies require meaningful text; record/check-in direction may be empty.
- `answer_child` derives the reply association from the immutable selected event: `needs_input` uses its event ID; ordinary message/final/interrupted evidence uses null. This preserves private nonblocking replies without resolving a later question. Check-ins still need `continue_child` and their existing actor/Stop guards.
- `inbox.action` now returns internal `{ operationKey, consumerRunId, result }` metadata. Tools return only the original result. Identical actions reuse the historical key and original consumer for publication; changed actions refuse. Historical `no_action` is readable and is not aliased to new `record`/`retained`.

## Verification

Before production changes, the new Shared contract had 7 failing tests and the new different-key replay assertion failed with `SUBAGENT_EVENT_ALREADY_HANDLED`. Before the nonblocking-reply correction, its new integration test failed at private reply acceptance. These regressions passed after their respective fixes.

- `pnpm --filter @taki/shared exec vitest run src/subagent-inbox-schema.test.ts`: 8 passed.
- `pnpm --filter @taki/shared typecheck`: passed.
- Initial targeted Core schema/projection/recovery/publication run: 20 passed; one obsolete broad prompt assertion was narrowed to the frozen claim whose interrupted-only guidance it protects.
- `focused-core.log`: 19-file related regression run with `--maxWorkers=1 --retry=0`; 18 files / 92 tests passed. The yield file's 17 tests timed out because its scripted model still asserted `final answer in note` before releasing its test gate. That field assertion was updated to `text`; lifecycle/publication expectations were retained.
- `focused-corrections.log`: after the nonblocking reply fix and field assertion correction, all 4 files / 52 tests passed: `subagent-inbox-interface.test.ts`, `subagent-inbox-yield.test.ts`, `subagent-model-output.test.ts`, `direct-request-inbox.test.ts`. This includes actual governed parent SDK retries, child question round trips, nonblocking message versus pending question, answer rollback, exactly-once check-in approval, user Stop/user-required refusal, invalid invocation/scope/target, attention, historical no_action and original-key/original-consumer publication through an explicit successor.
- The broader passing run includes mixed public text/private tool/ordinary tool persistence and Local/Hindsight source exclusion, partial/recording failures, lazy inbox admission, ordinary/silent sends, child materials/completion, recovery/retry and check-in integration.
- `pnpm --filter @taki/core typecheck`: passed on final production source; log: `core-typecheck.log`. An intermediate TS4058 required exporting the new internal receipt interface so service return types can be named.
- `pnpm exec eslint <all 22 owned TS paths from implementation-files.json>`: passed; log: `scoped-lint.log`. Two intermediate test `prefer-const` findings were fixed.
- Scoped `git diff --check` passed; all 27 owned files decoded as UTF-8 without BOM.

Three earlier cases timed out during concurrent machine load. All three passed with one worker and unchanged test/wait thresholds; no timeout was relaxed. The later yield failure above had a distinct, verified stale-fixture cause.

## Limits and handoff

No paid model calls, external service startup, real-user data access, dependency changes or Git delivery were performed. SDK/SQLite and synthetic publication fixtures do not establish provider semantics, native Host/UI behavior or owner acceptance. Root owns the complete workspace gates, independent review, current task/spec records and bounded real-model/native campaign. No known scoped code/test failure remains after the corrections; the complete 19-file command was not repeated after the final correction because the four affected suites were rerun and root is performing complete gates.
