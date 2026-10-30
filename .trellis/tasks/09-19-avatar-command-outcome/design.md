# Design — Avatar command outcome and tool-contract repair

Read `research/command-path-map-2026-09-19.md` (seams, line anchors) and `research/ai-sdk-invalid-tool-calls.md`
(SDK facts, probe) first. Everything below is additive to those seams; no engine, Rust or dependency change.

## 1. Data flow

```
model → avatar_set_expression{name}
  Core tool execute:
    commandId = randomUUID()                         (Core-generated, contract-neutral)
    pending  = outcomes.open({ commandId, subscribers: subscriptions.count(characterId), signal })
    subscriptions.publish({ characterId, kind, name, priority?, loop?, commandId })
    outcome  = await pending                         (≤ deadline; instant when subscribers === 0)
    return toolResult(outcome)
  Pet UI (operator):
    avatar.command → generation guard → presentation gate → applyAvatarCommand → engine promise
    → avatar.outcome { characterId, commandId, outcome, reason? }   (only while the generation is current)
  Core avatar.outcome method → outcomes.report(commandId, connection, outcome) → resolves the pending wait
```

Correlation: `toolCallId` is available in `execute(input, options)`; it is logged beside `commandId` but never
used as the command identity (D81 keeps the path open for a non-tool producer).

## 2. Shared (`packages/shared/src/avatar-schema.ts`)

- `AvatarCommandSchema` gains `commandId: z.string().min(1)` (required; same-repo clients ship together).
- New: `AvatarOutcomeSchema = z.enum(["applied","rejected","superseded","not_rendered","unknown"])`,
  `AvatarRejectReasonSchema = z.enum(["motion_busy","speaking","already_active","unknown_name","unavailable"])`,
  `AvatarOutcomeParamsSchema = { characterId, commandId, outcome: applied|rejected|superseded, reason? }` (the Pet
  never reports `not_rendered`/`unknown`; those are Core-derived), `AvatarOutcomeResultSchema = { status: "ok" }`,
  `AVATAR_METHODS.outcome = "avatar.outcome"`.
- `error-code-schema.ts`: add `"AVATAR_REJECTED"` (rides the tool result, classified by the existing outcome seam).
- Export the new names explicitly from `index.ts`; update `index.md`. No Rust mirror (operator-only, as today).

## 3. Core

### 3.1 `avatar/avatar-outcomes.ts` (new, pure, node-tested)

```ts
interface AvatarOutcomeReport { connection: unknown; outcome: "applied"|"rejected"|"superseded"; reason?: AvatarRejectReason }
interface AvatarOutcomeResolution { outcome: AvatarOutcome; reason?: AvatarRejectReason }
createAvatarOutcomes({ deadlineMs: () => number, now?, setTimer?, maxPending = 256 }) → {
  open({ commandId, subscribers, signal? }): Promise<AvatarOutcomeResolution>;
  report(commandId, report): "resolved" | "recorded" | "late" | "unknown_command";
  size(): number;
}
```

Resolution rules, in order: `subscribers === 0` → `not_rendered` immediately (no entry kept); first `applied` →
`applied`; all subscribers reported and none applied → the strongest report (`rejected` > `superseded`); deadline →
if any report exists use the strongest, else `unknown`; `signal` abort → `unknown` immediately. Entries are removed
on resolution; opening beyond `maxPending` resolves the oldest as `unknown` first (bounded memory). Duplicate report
from the same connection counts once. Timer is `unref`'d.

### 3.2 Tools (`set-expression-tool.ts`, `play-motion-tool.ts`, `avatar-tools.ts`)

`AvatarToolDeps` gains `outcomes: AvatarOutcomes`. `execute(input, options)` follows §1; `options.abortSignal` feeds
`open()`. Result shape (model-visible JSON, classified by `agents/tool-outcome.ts` unchanged):

| Outcome | Returned value | Existing classification |
| --- | --- | --- |
| applied | `{ ok: true, outcome: "applied" }` | completed |
| not_rendered | `{ ok: true, outcome: "not_rendered" }` | completed |
| rejected | `{ ok: false, outcome: "rejected", code: "AVATAR_REJECTED", reason }` | failed / execution / `avatar_rejected` |
| superseded | `{ ok: false, outcome: "superseded", code: "CANCELLED", state: "cancelled" }` | cancelled |
| unknown | `{ ok: false, outcome: "unknown", code: "OUTCOME_UNKNOWN", state: "outcome_unknown" }` | outcome_unknown |

Publish failure keeps today's `{ ok: false, code: "INTERNAL_ERROR", message }`. Descriptions are rewritten per PRD R6
(short: outcome list; busy rejection is normal — never retry or apologize; no pet window is fine).
`tool-outcome.ts` needs `AVATAR_REJECTED` in `KNOWN_FAILURE_CODES` only if it is not already covered by
`ErrorCodeSchema.options` (it will be, via §2). `chat-activity.ts#outcomeMessage`: add one branch
`errorCode === "avatar_rejected"` → "画面未采用这次表情或动作" so the Chat card is not labelled a generic failure.

### 3.3 Method `server/methods/avatar-outcome.ts` (new)

Operator role, params `AvatarOutcomeParamsSchema`; refuses (structured `FORBIDDEN`) when the connection is not
subscribed to `characterId` (`subscriptions.isSubscribed(characterId, connection)` — one new query on the registry);
otherwise `outcomes.report(...)`, returns `{ status: "ok" }` whatever the report status (late/unknown are logged at
debug, never errors to the client). Registered in `main.ts` next to subscribe/report; `createAvatarOutcomes` built
once with the deadline knob.

### 3.4 Deadline knob

`config/knob-registry.ts`: `TAKI_AVATAR_OUTCOME_DEADLINE_MS`, int 100..10000, default 1000, `apply` = the class
that re-reads per use (the outcomes factory takes `deadlineMs: () => number` reading the config source each `open`).
Description: "How long an avatar tool waits for the Pet window's presentation outcome."

### 3.5 `avatar/presentation-stop.ts`

```ts
const invalidPresentation = (step) => step.toolCalls.some((c) => PRESENTATION_TOOL_NAMES.has(c.toolName) && c.invalid === true);
if (invalidPresentation(last)) return steps.filter(invalidPresentation).length >= 2;   // one correction per turn
// otherwise unchanged: presentation-only && spoke
```

`TypedToolCall.invalid` exists on ai@7.0.17 (`dist/index.d.ts:1142-1146`). Tests extend
`presentation-stop.test.ts`; `chat-agent-presentation.test.ts` gains the probe scenarios (scripted model: text →
invalid call → corrected call; two invalid steps) proving request counts.

## 4. Desktop (Pet UI)

### 4.1 `renderer/live2d/avatar-commands.ts`

`applyAvatarCommand(input): Promise<AvatarOutcomeReport>` where `AvatarOutcomeReport = { outcome, reason? }`.
Classification (best-effort hints; the engine promise decides applied vs not):

- unknown name → `{ rejected, unknown_name }` + drift sink (unchanged behaviour, now reported).
- expression: snapshot `current = expressionManager.currentExpression name`, then `await model.expression(name)`;
  `true` → applied; `false` and `name === current` → `{ rejected, already_active }`; `false` and a newer expression
  command was applied for this model since this one started → `superseded`; else `{ rejected, unavailable }`.
  "Newer command" is tracked by a per-model monotonically increasing sequence kept in the same module (`latest[kind]`).
  (2026-09-19 implementation note: the already_active check runs BEFORE the sequence check — the engine refuses a
  re-select of the current expression before touching its reserve slot, so a back-to-back pair would otherwise
  mislabel a genuine already_active as superseded. The motion branch likewise checks speaking/busy before the sequence.)
- motion: read `state = motionManager.state`, `audio = motionManager.currentAudio`; `busy = priority !== FORCE &&
  (priority <= state.currentPriority || priority <= state.reservePriority)`; `speaking = priority !== FORCE &&
  audio?.isPlaying === true`; then `await model.motion(name, undefined, priority, { loop })`; `true` → applied;
  `false` → `speaking ? {rejected, speaking} : busy ? {rejected, motion_busy} : {rejected, unavailable}`.
  (Engine rules verified in dist: `reserve()` and the `currentAudio.isPlaying && priority != FORCE` branch.)
- Any throw → `{ rejected, unavailable }` (never propagates).

`avatar-controller.ts` and `pet-scene.ts` propagate the promise (`applyCommand: (...) => Promise<AvatarOutcomeReport>`).

### 4.2 `windows/pet/restore-pet-connection.ts` + `lib/ws-client-methods.ts`

Inside the gate callback: `const report = await scene.applyAvatarCommand(command, drift)`; if
`context.isCurrent()` still holds, `client.reportAvatarOutcome({ characterId, commandId, ...report })` (fire-and-forget
RPC with the interactive deadline; failures logged). New method `reportAvatarOutcome` in `avatarMethods`. A retired
generation reports nothing (Core resolves `unknown` at the deadline — truthful).

### 4.3 Regression fixtures

`avatar-commands.test.ts` reproduces the Lab table with a fake model/manager: expression→motion, same expression twice,
NORMAL over NORMAL, two un-awaited expressions, speaking, unknown name, throw.

## 5. Tests and E2E

- Shared: schema round-trips, `commandId` required, outcome enums, error code.
- Core: `avatar-outcomes.test.ts` (rules in §3.1 incl. abort, deadline, late, cap, duplicate connection),
  `avatar-tools.test.ts` (result table, `not_rendered` fast path, abort → unknown), `server/methods/avatar-outcome.test.ts`,
  `presentation-stop.test.ts`, `chat-agent-presentation.test.ts` (request counts), knob registry test.
- Desktop: renderer classification, controller/scene propagation, `restore-pet-connection.test.ts` (report sent;
  stale generation silent), `ws-client-methods` coverage as the neighbours have.
- E2E (`e2e/`): one `withStack` scenario with a fake operator client that subscribes, receives `avatar.command` with a
  `commandId`, replies `avatar.outcome{rejected,motion_busy}`, and asserts the persisted tool result / Chat activity
  terminal reflect it; a second run with no subscriber asserts `not_rendered` without waiting.

## 6. Compatibility and rollback

Additive protocol (new required field on a push only consumed by the same-repo Pet UI; new operator method). No
migration. Rollback = revert; persisted tool results with the new shape still classify through the generic seam.

## 7. Deferred (record in `docs/deferred-decisions.md` at implementation)

- #31 TTS gating can hold a command past the deadline → `unknown` while it later plays; resolve when the gate
  becomes non-immediate (extend the wait to the gate, or record late outcomes durably). Log as D82 with that trigger.
