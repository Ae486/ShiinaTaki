# Home visual continuity and transient feedback

## Goal

Keep Home visually continuous while records change, existing data refreshes, and short-lived action feedback appears. Apply consistent behavior across the relevant pages rather than patching only the user's examples.

## Approval and scope

- On 2026-09-08 the owner approved the class-wide proposal with "允许推进" and emphasized using the framework's own capabilities.
- This approval covers task creation, the reviewed approach, implementation, and verification. No new dependency, backend protocol, database change, or release is needed.
- Work stays in `H:/TakiAgent-worktrees/t4` on `task/t4-skills-mcp-productization`.
- The manually launched Core and Desktop remain available to the owner. Existing unrelated work is preserved.

## Requirements

1. Existing Monitor trajectory and Inspector content stays visible during a same-authority target change. The replacement becomes visible coherently when ready; labels and action targets never describe another record's content.
2. Ordinary refresh of already loaded data preserves its card/list structure and local reading/editing state. A successful empty response still becomes a truthful empty state.
3. Fast background refreshes do not flash text or replace content with a placeholder. Slow work may show a delayed, unobtrusive indication without changing content geometry.
4. One-time mutation outcomes use the existing floating notification surface, expire predictably, and are consumed exactly once. Repeated reads and renders do not replay them.
5. Persistent connection, validation, conflict, permission, and privacy uncertainty remains discoverable, truthful, and actionable without a routine refresh inserting/removing large banners.
6. The common rules cover Monitor, Perception, Settings, MCP, Skills, Costume, Operations and the relevant Chat feedback paths.
7. Use React state ownership, batching, reconciliation, and scheduling where appropriate. Avoid an independent rendering engine, duplicate DOM trees, artificial response delays, blanket memoization, or a new data framework.

## Acceptance criteria

The checkmarks below record engineering verification, with exact scope and limitations in [implementation evidence](implementation-evidence-2026-09-08.md). On 2026-09-08, after Desktop relaunch and the normal-window checklist, the owner reported no issues with this follow-up. The later permission-blocked sampling observation is separately deferred as D78 in `docs/deferred-decisions.md`; it does not reopen this visual-continuity scope or certify broader historical performance/OS IME criteria.

- [x] AC1: A loaded Run can switch to another without an intermediate empty trajectory; rapid A/B/C requests settle on the latest requested target and never mix records.
- [x] AC2: Switching inspected records keeps coherent previous detail until replacement is ready; close, deletion, permission loss and retired-client responses remain correct.
- [x] AC3: A populated Perception card retains its entries during invalidation and updates without a blank card or notification-induced vertical movement; node/scroll continuity is checked in the renderer.
- [x] AC4: Fast ordinary refreshes produce no visible transient loading text; slow work has a non-displacing accessible indication and stops on success/failure/retirement.
- [x] AC5: Permission/config/MCP/import/storage outcomes appear once in a floating surface and expire; successive attempts cannot leave an old success beside a newer failure.
- [x] AC6: Equivalent duplicate notification delivery is coalesced without suppressing a later distinct attempt; timeout pause/resume and dismissal work by pointer and keyboard.
- [x] AC7: Initial loading, a successful empty result, failed refresh, disconnect, scope replacement, authority loss and unknown privacy state stay distinguishable and safe.
- [x] AC8: Existing drafts, selected details, disclosure state, focus and scrolling survive same-resource refresh where their identities remain valid.
- [x] AC9: Applicable Desktop tests, type checks, lint and production build pass; final review covers all changed files and user-reported classes.
- [x] AC10: Native/browser verification covers fast/slow reads, repeated invalidation, racing selections and notification geometry/lifetime. Owner acceptance is recorded separately from automated evidence.

## Out of scope

- Backend trigger policy, new polling, durable caches, new dependencies, protocol/schema changes or mutation replay.
- Reworking avatar rendering, unrelated Lab/OpenBili work, CJK typography, deployment, push, or task archive.

## Research references

- `research/audit.md` — current source inventory and controlled reproductions.
- `research/react-continuity.md` — existing React primitives and their limits for this implementation.

## Definition of done

The reviewed behavior is implemented with focused regression coverage, rendered verification, updated executable frontend guidance, and a concrete delivery/remaining-manual-check report. Commit/archive actions remain separately reviewable.
