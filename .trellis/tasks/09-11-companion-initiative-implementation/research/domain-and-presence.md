# Research: Companion initiative domain and presence index

- Query: Turn the confirmed Pattern, Intention, User Presence, presentation, and conversational management requirements into bounded implementation contracts over the current Taki runtime.
- Scope: Internal source and existing planning records; no new external survey.
- Date: 2026-09-11
- Status: Development-design input. Product decisions below are ratified only where attributed to the parent PRD/grill; schema names and timing values explicitly marked recommendations are engineering proposals.
- Work boundary: `H:/TakiAgent-worktrees/t4`; this researcher owns only `research/domain-and-presence.md`, `research/domain-contracts.md`, and `research/presence-contracts.md` under the current task. Root verified the new task through its native session pointer. The researcher environment has no inherited native task session, and the legacy `.trellis/.current-task` still names concurrent Avatar Lab work; neither pointer was changed.

## Findings

The complete research is split below to fit Trellis context injection. Load both part files; this index does not replace their contracts or acceptance evidence. Original sections 1-12 and all source references, constraints, related specs and caveats are preserved across the two parts.

| Part | Contents |
| --- | --- |
| [Domain contracts](domain-contracts.md) | Sections 1-7: readiness/source precedence, verified code seams, domain ownership, Pattern review and lifecycle, finite source-backed Intentions and normal Memory, first Signal/condition vocabulary, and privacy-generation fencing. |
| [Presence contracts](presence-contracts.md) | Sections 8-12: authenticated source lifecycles, device association, actual message exposure, bounded non-engagement feedback/timing, Character targeting/global quota scope, validation matrix, integration dependencies, full related-spec list and caveats. |

### Key conclusions

- No new mandatory product grill blocker emerged. Confirmed requirements are sufficient for engineering design, subject to the documented integration gates.
- Reuse one Core Pattern authority and the existing runtime. Concrete Pattern confirmation grants no capability permission; automatic one-shot Intentions require finite expiry and cannot renew from replayed source text.
- Intention expiry closes the old opportunity without deleting or resolving the underlying user-reported matter. A fresh eligible interaction may independently recall it and follow up.
- Existing `ActivityState` maps unknown idle to `false`; presence must preserve nullable source evidence and actual Host/connection provenance. Late sampling results require privacy-generation checks.
- Input, focus, visibility, connectivity, message presentation, reading and Host availability remain distinct. Operator and Node identities are not implicitly associated; negative feedback needs attributable response-opportunity evidence and per-message deduplication.
- Preserve `1x -> 2x -> 4x -> daily ceiling` with full reset on a real user reply or explicit operator reset. Four Heartbeat model opportunities/beats per hour is distinct from individual model Effects.
- First-delivery targeting should remain explicit and bounded; imported Characters do not automatically become speakers, and switching cannot multiply/reset global Class B limits.

## Caveats / Not Found

This index and its parts are planning research, not implementation or runtime acceptance. No tests, builds, live databases, services or production files were changed. Incoming Memory integration remains root-owned. D78, D79, a real phone app, new sensing/exec/external effects and autonomous long-term Pattern evolution remain outside this delivery as detailed in the parts.
