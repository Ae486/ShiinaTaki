# Shared-runtime agent delegation

## Goal

Provide reusable, addressable Subagents and their conversation controls through the same Runtime as the main Companion, preserving the settled G1-G4 behavior.

## Requirements

- Inherit parent R02-R08, R12-R13 and AC02-AC05/AC09; do not reopen the recorded product decisions.
- Retain child results independently of the captured choice to request subsequent parent inference; inference does not automatically publish speech.
- Let the parent select fresh/inherited context, reuse and addressed follow-up. Parent context changes are not automatically copied.
- Parent stop leaves all children running with their original completion intent. Independent user stop preserves child context and requires user continuation.
- Reuse existing governance, Run/Attempt/Effect, delivery and read-model ownership, with correct targeting and no terminal Run restart.
- Expose a readable child conversation with input, stop and continue controls, without a second Character relationship history.
- Inherit parent R14/AC11: a child receives a trusted read-only Memory capability projection. It can retrieve relevant memory and suggest changes in its result, but cannot mutate Memory or automatically ingest its private transcript. Main-Companion continuation remains a distinct execution role and keeps its existing permitted memory authority.

## Acceptance criteria

- [ ] Create/reuse and selected-context/addressed input behave correctly across active and idle children.
- [ ] Child outcome is retained once; record-only completion causes zero parent model calls, while requested continuation is deduplicated and admitted separately.
- [ ] Parent stop does not cancel any child or change its completion policy.
- [ ] Stop/continue target only the chosen child and respect user-stop versus parent-interruption origin.
- [ ] Parallel children do not replace each other's cancellation handles or corrupt relationship ordering.
- [ ] Conversation navigation/view/input/control and loading/empty/error/reconnect states have evidence.
- [ ] Restart, stale completion and uncertain effects have truthful bounded outcomes; no duplicate effect or terminal Run reopen is claimed.
- [ ] Child memory reads and denial of memory mutations are verified through actual execution, including reuse/retry/recovery; a result suggestion is not automatically applied as a Memory write.

## Dependencies and constraints

Upgrade child verification precedes production work. Joint child-result/source contracts must be reviewed with the source-context child before editing shared boundaries. Follow [parent requirements](../10-21-agent-delegation-source-context/prd.md). No new runtime/framework, broad task management product, cleanup/archive feature or permission system is implicitly selected.

## Definition of done

G1-G4 work through the real shared execution and UI paths; deterministic and owner evidence are separate. All private/transient/retained state has an explicit existing authority or justified extension.
