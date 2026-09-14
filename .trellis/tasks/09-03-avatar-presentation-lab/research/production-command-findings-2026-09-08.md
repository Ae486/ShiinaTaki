# Production command behavior and lab scope - 2026-09-08

## Owner clarification

The lab studies the presentation strengths of AgentAtelierR / Ryza and validates how they map onto Taki's installed
engine, actual costumes, and existing production code. It is not a new engine. Preserve working native composition;
use filtering or custom behavior only for a demonstrated gap. The owner reported that a later motion can replace
an earlier expression in production, and that closely spaced motion/expression tool calls sometimes appear to
apply only one. Those observations are not assumed to identify the failing layer.

## Current code findings

Checked in `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`, current HEAD
`b251474325f96a85de7bb7c9719fa330c0913762`. Existing unrelated work was preserved.

| Boundary | Actual contract |
| --- | --- |
| `packages/core/src/avatar/{set-expression-tool,play-motion-tool}.ts` | Each execute publishes its own command and immediately returns `{ok:true}`; this is publication acknowledgement, not playback acknowledgement |
| `avatar-subscriptions.ts` and `server/methods/avatar-subscribe.ts` | Synchronous fan-out per command and one `avatar.command` notification each; no cross-kind deduplication, queue replacement, or coalescing |
| `apps/desktop/src/lib/ws-client-routes.ts` | Every valid avatar notification calls the registered handler |
| `windows/pet/restore-pet-connection.ts` + `lib/presentation-gate.ts` | Current-generation commands are each forwarded; the current gate executes immediately |
| `renderer/live2d/avatar-commands.ts` | Expression calls `void model.expression(name)`; motion calls `void model.motion(name, undefined, priority, {loop})`; both discard the engine's eventual boolean |
| Installed engine 1.3.1 | `preserveExpressionOnMotion = true`; reset-on-motion requires it to be false AND non-idle motion priority. No production source changes this setting |
| Motion priorities | NORMAL/FORCE arbitrate motion versus motion; they do not rank motion above the independent expression manager |
| Click/proximity reactions | Explicitly set a matching expression AND play a matching motion; this can replace a former facial expression without the motion itself clearing it |
| `presentationTailStop` | Ends further model generation after a spoken presentation-only step; it does not choose one of two already executed calls or cancel the other renderer command |

Consequently, the current pure motion-tool path does not implement an unconditional "new motion clears old
expression" rule. The engine method's `resetExpression=true` default must not be read in isolation: its actual
start-time reset is gated by `shouldOverrideExpression()`, which is false with the installed default.

## Automatic production-entry reproduction

`lab/automation/production-command-check.mjs` invokes the unchanged Core tools with their real input schemas,
captures their synchronous subscription output, and feeds those commands to the unchanged production
`applyAvatarCommand` in a real browser with each real model. It observes the original engine Promise results and
reset calls without changing them. Production click behavior is exercised through the original avatar controller.

This is not a full historical reproduction through a live LLM, WebSocket server, or the owner's installed desktop
binary. Existing subscription/WS restoration tests cover the forwarding contract; the exact previously observed
run remains unclassified without its costume, command inputs/order, and runtime version.

Evidence: `.trellis/.runtime/production-avatar-20260908/` contains 20 case results, original calls/return values,
reset events, frame samples, and screenshots. Sixteen cases use the actual default configuration; four explicitly
marked diagnostics temporarily disable preserveExpressionOnMotion in their isolated test context, as a causal
control. They are never described as current production configuration.

| Scenario, both C2 and C3 | Engine results / visible outcome |
| --- | --- |
| Expression then motion | Both true; zero resets; smile remains |
| Motion then expression | Both true; zero resets; smile remains |
| Same batch, expression first | Both true; zero resets; smile remains |
| Same batch, motion first | Both true; zero resets; smile remains |
| Same expression twice | First true, second false because already selected; the existing expression still works |
| NORMAL motion playing, then another NORMAL motion plus expression | New motion false, expression true; earlier motion remains |
| Two different expressions without awaiting | Earlier pending expression false, later expression true: same-channel reservation replacement |
| Set smile then production click reaction | The click issues a new expression and a motion, both true; the new expression replaces smile |
| Diagnostic only: preserve=false, expression then motion | Both calls true, but one reset removes the active expression during the motion |
| Diagnostic only: preserve=false and delayed motion load in a batch | The later motion start resets the expression that already loaded; order of asynchronous completion matters |

All 20 assertions passed. All Core acknowledgements and renderer synchronous acceptances were true even in the
cases whose engine call returned false. This is the specific observability gap: tool success cannot establish
playback success. No default-config test reproduced a blanket motion-wins rule.

Validation: existing Core tests 3 files / 15 tests, Desktop tests 3 files / 16 tests passed; new diagnostic script
ESLint passed. No production source, dependency, engine config, real user data, or reference asset was modified.
Semantic discovery was unavailable (the explorer model was not configured and `jbcontext` returned insufficient
data); investigation continued through exact identifiers and verified source reads.

## Implications for the lab

1. Start with native motion and expression entry points, using exact real inputs. Keep the distinction between a
   motion's authored face, an explicit expression, and a click/proximity reaction that sets both.
2. Do not use face filtering to repair command rejection, failed loading, or same-channel supersession; it acts
   later on motion curves and cannot solve those causes.
3. A future production change may need honest applied/rejected/superseded outcomes and an explicit pairing/order
   policy. That is command orchestration and observability, not a new animation engine, and is not implemented by
   this diagnostic task.
4. Do not infer the owner-reported incident's exact cause from these nearby reproduced cases. Match a real trace
   before changing production ordering or global engine defaults.
