# Initiative E2E harness follow-up

Date: 2026-09-19. Source inspection only, in the T4 worktree. No initiative execution or acceptance is claimed.

## Verified existing seams

- `e2e/src/fixture/with-stack.ts` boots the actual Core and headless Node in separate temporary data directories with real pairing, bounded log waits, restart helpers and unconditional teardown. `prepareCoreData` runs before Core opens SQLite; use it only for pre-boot arrangement, never a concurrent external database writer.
- `StackOptions.provider` currently supports `dummy` and `real`. The dummy endpoint is loopback port 9 and cannot generate a decision. The real option reads explicitly configured credentials; it is not appropriate for deterministic or no-cost acceptance.
- `devTrigger` enables only the existing operator-only `capability.trigger` path. It executes a capability, not a Heartbeat opportunity or the initiative Agent loop, and cannot serve as initiative E2E proof.
- `e2e/src/core-shutdown.e2e.test.ts` provides an existing local HTTP scripted-provider/process composition example. Its IPC preload is test-only and only delivers graceful shutdown on Windows; it is not an admission hook. It uses hermetic `childEnv`, isolated data, bounded cleanup and `windowsHide`.
- `packages/core/src/harness/run-service.ts` admits typed `TriggerRequest` values and captures immutable execution context. `packages/shared/src/harness-schema.ts` already defines `heartbeat`, `class_b` and `autonomous`, but these enum values do not implement eligibility, thin requests or terminal decisions.

## Child-1 implementation constraints

Use the real new initiative adapter, RunService, ChatAgent, repositories and outward projection. Extend the test-only harness to support an explicitly owned loopback scripted provider, or compose the existing process primitives as the shutdown test does. Keep provider isolation and process/data cleanup verifiable. Do not register a production debug RPC, weaken governance or seed a successful Run/decision as the result under test.

The implementation still needs to select a test-only arrangement for a validated opportunity once the real child-1 adapter exists. No such working arrangement was found or added in this investigation. Child 3 owns production wake producers, so child-1 acceptance must identify its arrangement boundary precisely and must not claim production Pattern/Signal admission.

Assert at least the actual outgoing SDK request, the existing Run/Attempt identity, structural silent/express/speak settlement, held same-Attempt continuation without another model call, canonical Timeline linkage, Monitor facts, and denied-opportunity zero Run/model growth. Keep real-provider, native WebView2 and subjective owner acceptance separate.

## Inspection and tool limits

The initial semantic search returned the fixture and shutdown references from indexed T4 revision `06a8090`. These files were then read directly from the current worktree. The attempted research-agent channel failed with a model-service 503; the direct reads above completed the bounded investigation without relying on that failed report.
