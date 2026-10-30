# Avatar command path map (2026-09-19)

Verified by direct reads at T4 `06a8090`. Line numbers are approximate anchors; re-read before editing.

## Core tools → publish

| Seam | Fact |
| --- | --- |
| `packages/core/src/avatar/set-expression-tool.ts:25-37`, `play-motion-tool.ts:24-44` | `execute` publishes and returns `{ok:true}` synchronously; on publish throw returns `{ok:false, code:"INTERNAL_ERROR", message}`; never throws. Descriptions tell the model "there is no result to read". |
| `vocab-name-schema.ts:12-14` | `name` is a dynamic `z.enum` of the live vocabulary (fallback `z.string().min(1)` when the vocabulary is empty). Unknown or missing `name` fails SDK input validation and never reaches `execute`. |
| `main.ts:393-394` | Tools are created per turn with `vocab: avatarVocabulary.get(characterId)`. |
| `avatar-subscriptions.ts:38-43` | Synchronous fan-out to every subscribed connection; no subscriber → nothing, no error. No dedupe, coalescing or ordering. |
| `server/methods/avatar-subscribe.ts:20-25` | Sink = `ctx.notify("avatar.command", command)`; operator role; auto-unsubscribe on close. |
| `packages/shared/src/avatar-schema.ts:44-52` | `AvatarCommandSchema { characterId, kind, name, priority?, loop? }` — no command id, no ack schema, no Rust mirror. |

## Pet UI receive → engine

| Seam | Fact |
| --- | --- |
| `apps/desktop/src/lib/ws-client-routes.ts:145-148` | Notification handler calls `state.push.avatar?.(parsed)`; missing handler is harmless. |
| `windows/pet/restore-pet-connection.ts:42-57` | Generation-guarded (`context.isCurrent()`), routed through `lib/presentation-gate.ts` (`sharedPresentationGate.present`, v1 immediate; slot reserved for TTS audio-ready). `onAvatarCommand` registered before `subscribeAvatar`; vocabulary `avatar.report` precedes subscribe. |
| `renderer/live2d/avatar-commands.ts:28-46` | Validates the name against the reported vocabulary (unknown → warn + drift re-report + `false`), then `void model.expression(name)` / `void model.motion(name, undefined, priority, {loop})`. The engine promises (the real applied/rejected signal) are discarded. |
| `renderer/live2d/avatar-controller.ts:21,40`; `renderer/pet-scene.ts:62,161` | Wrappers are typed `=> void`; the boolean is dropped again. |

## Turn loop and stop condition

| Seam | Fact |
| --- | --- |
| `avatar/presentation-stop.ts:18-24` | Stops when the last step's `toolCalls` are all presentation tools and any step has text. Checks `toolName` only. |
| `agents/chat-agent.ts:277,283-286,306-315` | `stopWhen: [isStepCount(max), ...stopConditions]`; step messages captured in `onStepEnd` and persisted (`turn-recording.ts:26-47` → `commitTurn`). `stopWhen` runs after `execute`, so the tool result is persisted but never read by the model when the stop fires. |
| ai@7.0.17 `dist/index.d.ts:1142-1146,1438` (types) | `StepResult.toolCalls` includes calls with `invalid?: boolean; error?: unknown` and the same `toolName`. Pending runtime confirmation (see `ai-sdk-invalid-tool-calls.md`). |

## Existing client → Core response paths

| Path | Reusable? |
| --- | --- |
| `server/methods/capability-respond.ts:16-33` + `capabilities/capability-broker.ts:50-62` | Closest analogue (pending attempt keyed by run/attempt/effect/operation, stale-generation guard) but `roles: ["node"]`; the Pet UI is an operator. |
| `server/methods/avatar-report.ts` | Operator-role method registered next to subscribe; the natural pattern for a new `avatar.outcome` method. |
| `harness/effect-lifecycle-service.ts`, `db/effect-repo.ts` | Tool Effects settle when `execute` returns; `record()` appends bounded run events. Run-event vocabulary (`shared/run-event-schema.ts`) is strict `run-event.v1`; new kinds need the reader/version plan owned by the Initiative child 1. |
| `agents/tool-invocation.ts` | `toolCallId` + `invocationId` snapshots already exist per call; a command id can be derived from `toolCallId`. |

## Tests touching these seams

`avatar/{avatar-tools,vocab-name-schema,avatar-subscriptions,presentation-stop,avatar-vocabulary}.test.ts`,
`server/methods/{avatar-subscribe,avatar-report,capability-respond}.test.ts`, `shared/src/avatar-schema.test.ts`,
desktop `renderer/live2d/avatar-commands.test.ts`, `windows/pet/restore-pet-connection.test.ts`,
`agents/chat-agent-presentation.test.ts`, `agents/chat-agent-tools.test.ts`.
