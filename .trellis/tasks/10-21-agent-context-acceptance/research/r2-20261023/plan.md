# R2 controlled timing and bounded real inference

The owner resumed remaining automated/live acceptance on 2026-10-23 and requested stopping before human acceptance. This slice operates only in `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`, starting HEAD `06a8090`. The child session has no native task pointer; the coordinator explicitly assigned the existing acceptance child. The stale global pointer remains untouched.

## Scenario and observation contract

1. The actual primary model delegates A (`record_only`) and B (`request_parent`) with selected private markers and only `complete_subagent` executable. A transparent HTTP relay holds both child requests and the primary request after two real delegation acknowledgements.
2. Authenticated `chat.cancel` targets the original Run. Both child Run identities and running state must remain unchanged. Only the held original-parent HTTP request closes.
3. Authenticated exact-target `subagent.stop` cancels A and records its user latch. B keeps the same running Run. A real subsequent primary model calls `send_subagent_message(continue=true)` against the exact displayed A target; the retained native tool result must report `SUBAGENT_USER_CONTINUE_REQUIRED`. A's durable latch/version/inputs/executions remain unchanged.
4. Release B. Its real completion admits a new parent execution after the original was stopped. An explicit `reply` decision reaches the original accepted-request root, a distinct publication Run and one sent Timeline report. The publication Run makes no model request.
5. Authenticated user `subagent.continue` clears A's latch and admits a new Run with retained context and an actual input Effect receipt. The original A Run stays cancelled and both A terminal reports keep `record_only`.
6. The primary reuses B for new `request_parent` work with an internal-only report. The new parent decision/result is inspectable and produces no additional Delivery or relationship speech.

Production Main, ordinary SDK HTTP and authenticated WS execute in both tracks. The controlled track scripts provider responses; the live track forwards actual provider responses unchanged. Timing gates are explicit interventions, not evidence of natural provider latency. No internal IPC command simulates cancellation or completion. SQLite reads use only isolated test-owned Local state; Hindsight stays disabled.

## Bounds and artifacts

- Cap: 16 Core HTTP requests for the complete case, including requests cancelled while held. The transparent relay separately records actual upstream forwarding; held requests are not external model observations or billing claims.
- Existing scenario deadline: four minutes. Scenario failure, source drift, request budget/capture failure or unsuccessful teardown prevents a passing result.
- Exact outgoing request bodies, concurrent Effect candidates (not exact attribution), phase snapshots, terminal output/usage, source/lock hashes and transparent transport timestamps remain in a unique evidence directory. Failed runs are retained separately.
- Run the controlled case and scoped static checks before requesting a brief coordinator source freeze for one bounded real run. Do not rerun passing R1/R3 or retry a failed live case blindly.
- No real-user DB, secrets in evidence, production patch, commit, push, archive, main integration or human acceptance is included.

## Implementation ownership

New R2 fixture/test files, the narrow optional HTTP transport factory and `wsUrl` test seam in `agent-context-scenario.ts`, E2E indexes and this research directory. The coordinator requested `wsUrl` for its independently owned actual-Home/native scenario. Runtime/Source production files remain with their owners.
