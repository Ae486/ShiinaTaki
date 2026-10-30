# User presence and presentation feedback — design

## Normative design and reading order

Read the curated context entries, this child PRD, this design and its implementation plan, then the [parent design](../09-11-companion-initiative-implementation/design.md). The parent owns shared contracts; this child narrows execution ownership and does not define an alternative architecture.

Parent implementation section 4 supplies the matching ordered scope. Child 1 must have passed its shared delivery identity, reporting, timezone and Monitor compatibility gate.

## Owned modules and boundaries

Paths below name existing module areas or explicitly proposed additions. Confirm precise filenames against live source before editing; new paths are not evidence of installed features.

| Owner area | Responsibility |
| --- | --- |
| Shared | Proposed user-presence/report/feedback and ordinary Timeline presentation-report schemas; compatible client facade types. |
| Core sources | perception/perception-layer.ts, activity sampler/state accepted-evidence seam, ambient result publication, route-capability provenance and connection lifecycle. |
| Core services | Proposed presence/ service and bounded feedback repository; existing User Timezone service, Monitor queries/producers and registration. |
| Desktop | Existing client facade/recovery owners, own-surface reporter, Chat Timeline renderer, Pet bubble visibility/presentation and timezone settings. |
| Native | Only existing own-window/authorized activity integration needed for truthful reporting; no new ambient sensor capability. |

## Required contracts

1. ActivityState.idle=false is not presence when original idleSeconds is null. Keep the original nullable evidence and its current source.
2. Capture source/Host/consent identity before asynchronous foreground/VLM work and validate again before publication. New source/Host generation cannot inherit old dwell.
3. Core derives identity from authenticated connections. Same operator device may own multiple independent window sources; one disconnect retires only that source.
4. A renewal preserves last-input age. Reconnect, programmatic focus/open, synthetic events and old buffered reports cannot become new human input.
5. Node and operator identity are not implicitly co-located. Native evidence can inform qualified global presence; negative feedback needs the actual presenting device association.
6. Only real committed-message rendering/exposure can become presentation. Offscreen/skeleton/hidden/minimized content and network receipt are insufficient; no forced UI opening.
7. Union qualified presence/exposure intervals across windows/devices, settle each utterance once, and never fabricate missing/offline time or proof of reading.
8. Follow-primary-device timezone reports require the designated current operator source; other clients cannot overwrite the last confirmed zone.

## Concurrency and integration

One implementation owner serializes shared exports, `main.ts`, migrations and registry edits. Other agents may own non-overlapping bounded work after explicit assignment. Preserve existing changes; do not reset, rebase, overwrite another task or run the main worktree.

All new persistent/protocol fields are strict and bounded. Core remains the single writer. State plus required evidence commits atomically; publication follows commit. Context, generation and source identity remain internal binding facts rather than visible metadata.

## Validation design

- Null idle, sensitive/refused source, pause during await, Host replacement and resume with stale cached samples never prove fresh presence.
- Home/Chat/Pet independence, replayed sequence, future/stale report age and retired generation remain correct.
- Phone-shaped explicit input may establish presence while Desktop capability availability remains false; cross-device display association is not invented.
- Actual message exposure and same-device presence produce bounded union intervals; duplicate/overlapping reports count once and unknown gaps count nothing.
- A historical message view after the feedback deadline cannot reopen a settled observation.
- Native minimize/focus/render/visibility behavior, reader position and Pet presentation are verified without manufacturing an ACK.
- Timezone fixed/follow modes, source retirement and future recomputation work through the existing authority.

Use real owning services and meaningful failure/negative cases. Mocked UI or pure builder tests alone do not establish lifecycle, transport, source or native presentation contracts. The original planning research cited source tests without running them; current implementation results are recorded separately in [the C2 evidence report](research/implementation-evidence-2026-09-28.md).

## Sources

- [Research: presence-contracts.md](../09-11-companion-initiative-implementation/research/presence-contracts.md).
- [Research: domain-contracts.md](../09-11-companion-initiative-implementation/research/domain-contracts.md).
- [Research: decision-register.md](../09-11-companion-initiative-implementation/research/decision-register.md).
- [Effective parent decisions](../09-11-companion-initiative-implementation/research/decision-register.md).
