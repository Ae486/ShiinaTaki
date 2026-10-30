# Foreground inbox boundary — coordinator verification

Date: 2026-10-25. Planning only. This resolves the correction in [the saved independent review](architecture-review.md)
against the original [requirements](../prd.md). It is coordinator source verification, not a fresh independent verdict.
Two attempts on the new 6.1 reviewer failed upstream; the Astra attempt failed with a cross-resource error. None
produced a report or acceptance. Production behavior remains unchanged.

## Verified path and existing protection

Paths below are under `packages/core/src/`.

| Source | Observed behavior |
| --- | --- |
| `agents/chat-agent.ts:279-301,367-375` | Primary recording captures completed SDK messages and commits them, then supplies the exact committed rows plus original user row to `onPrimaryCommitted`. |
| `agents/chat-agent.ts:403-433`; `agents/chat-activity.ts:163-180` | Every public text delta is yielded and observed for presentation. Primary detached Memory maintenance runs after commit. Filtering only final storage would leave live activity exposed. |
| `agents/turn-recording.ts:25-60` | Complete step batches and actual unfinished text survive exceptions; commit currently flattens all captured messages. Preserve this error/partial fidelity while adding projection. |
| `agents/turn-mapping.ts:42-81`; `agents/conversation-turn-writer.ts:28-58` | Structured assistant messages may mix text and tool calls. Raw tool arguments are already omitted, tool outputs persist, and complete primary batches drive presentation. A whole-message filter would remove unrelated text or tools. |
| `db/run-message-repo.ts:89-127,141-147,173-196` | Private paired-message storage exists, but its admission/staged-tail guard requires a child or existing parent execution association. A primary inbox consumer needs an explicit validated association; do not forge a child execution row. |
| `memory/canonical-ingestion-source.ts:111-120` | Automatic Memory already excludes tool-role rows and tool parts, keeping user/assistant text and applying hidden-text/secret filtering. The review does not establish a current raw-tool-payload ingestion bug. |
| `db/canonical-ingestion-source-repo.ts:70-94`; `db/hindsight-ingestion-source-repo.ts:45-63` | Both providers validate committed primary rows against the actual Timeline and store immutable commit witnesses. Never hand them rewritten copies or private rows dressed as primary entries. |
| `agents/source-context.ts:18-30`; `packages/shared/src/context-source-schema.ts:20-28` (repo-root path) | Program-owned source association can survive model-output conversion; generation/material facts do not themselves grant execution or speech authority. |

The missing boundary is the proposed mixed primary inbox handling, not child-only persistence. Input-only injection
does not decide where the resulting internal action pairs belong. Existing Memory sanitization helps, but does not
replace a durable/presentation boundary or distinguish an internal prose note from actual public assistant speech.

## Selected contract

1. **Separate channels by trusted binding.** The existing planned intrinsic inbox read/handling actions are private
   capabilities bound by Core to a validated delivered batch and its actual primary Run/Attempt. Tag that registered
   binding before invocation/activity emission; the tool-call identity follows the real invocation. A model-authored
   `private`, sender or event field cannot create authority. Invalid arguments and refusals from these known private
   bindings stay private too. Normal user-directed primary tools retain their existing contract.
2. **One executor and one action authority.** The inbox handling action applies addressed child answers/dispositions
   through existing service owners and receipt checks; it does not implement another tool loop. Scope-check event,
   child, current control target and actual delivered membership. Accepted action/result witnesses live with the
   private consumer association. Retries reconcile that same event/action identity, not a new fresh command.
3. **Partition complete native parts, not messages.** At completed SDK steps, route each known private call and its
   matching result to the existing Run transcript owner, associated with the inbox consumer. Keep public text and
   all unrelated public tool pairs in their original relative order for the primary writer. Both halves retain
   program-known source metadata and complete call/result pairs. The full combined SDK step remains available to
   the running model; durable projection must not mutate its in-flight messages or rerun any tool.
4. **Public text remains actual Companion speech.** A foreground primary turn has its existing public text channel;
   it has no new implicit private prose channel. Child answers, internal notes and dispositions use the private
   structured action payload. Ordinary text deltas continue streaming and commit as actual speech under the current
   primary source. Instructions guide the Agent to use the right channel; Runtime does not infer privacy from prose
   or claim it can prevent every model disclosure. An intentional public answer based on a child result is legitimate
   public speech, not automatically copied private transcript. Record the actual supplied-event references as
   descriptive generation context on affected public assistant rows, without raw private bodies, user impersonation
   or claims of sentence-level causal attribution. Never relabel the original user's row.
5. **Route before both live and durable publication.** Private invocation phases, call/results and note payloads
   do not enter main/Pet activity, Timeline presentation or exposure targets. They remain inspectable through private
   event/Run evidence. Public text and ordinary tools retain stable live IDs and complete primary commit handoff.
   After part filtering, recompute primary row indexes/references from their original identities; never retain
   offsets belonging to removed private parts. The primary Memory callback receives only actual committed primary
   rows and the original user row. Existing Local/Hindsight sanitization and source-aware ingestion remain in force.
6. **Exception and restart truth.** Save completed private pairs durably before releasing their recording data.
   Cancellation/error retains already committed private actions, actual public partial text and true Effect state.
   Never fabricate an unmatched tool result or make an uncommitted private action look handled. Extend terminal
   staging for the validated inbox-consumer association; it must settle atomically with that consumer's actual
   disposition/evidence. A successful private effect still fences whole-request automatic retry even if the public
   projection is empty. The real primary request/intent and existing retraction conditions remain authoritative.
7. **Replay without promotion.** Later primary Replay Views contain their real primary history. Private pairs are
   not inserted into hidden Timeline rows or bulk-added to later primary context. A resumed handler uses the same
   event/action receipts and a bounded private reconstruction through the inbox owner. Receipt-backed state and
   detail references prevent fresh duplicate handling. Current SDK messages preserve full ordering within the turn.
   Idle handling remains private throughout; only its separately authorized publication becomes public speech.

`speech_proposed` and a public utterance are still separate facts. If a foreground answer satisfies an event, bind
its publication outcome to the actual committed primary text/Run witness; a tool's assertion alone proves no speech.
Silent handling does not consume an unrelated delayed-final-answer grant.

## Alternatives and costs

- Input-only injection plus prompts is insufficient: it provides no private durable/action route.
- Making every mixed primary response private, buffering all text until semantic classification, or adding a
  mandatory separate handler model call would change normal primary streaming/latency without solving a demonstrated
  need. The existing structured action channel and part-level writer boundary are sufficient for the selected scope.
- Chosen cost: an explicit private-consumer association and part/activity projection in shared owners. No provider
  migration, separate speech model, hidden Timeline rows, new broker or semantic privacy classifier is selected.
  Instructions still govern whether the model chooses appropriate public wording, as in ordinary primary chat.

## Required implementation evidence

Use a deterministic model through actual ChatAgent/Core/SQLite, not only a projection helper test:

1. One primary step mixes public text, a private handling call and an ordinary public tool. Verify complete pairs,
   actual next request, private action owner, public rows, source sidecars and live-to-durable identities.
2. Supply distinct sentinel bodies for private inbox content, child answer and internal note. Verify those action
   payloads are absent from primary Timeline, main/Pet events, exposure and both Memory input/source witnesses;
   the original user text, ordinary public tool behavior and intentional public answer remain present as appropriate.
3. Abort/throw before result, after action commit, after completed-step capture and while consuming partial public
   text. Assert exact Effect/receipt state, no fake tool result/handled status, no whole-request effect replay and
   unchanged public partial/retraction semantics.
4. Reject forged scope/Character/batch targets and private labels on ordinary tools. Confirm idle/foreground claim
   races share the same dispositions and restart does not promote private history into primary replay.

These are implementation gates, not completed tests. Existing ingestion tests were read as source evidence only.
