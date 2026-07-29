# Source Grounding Guide

> **Purpose**: Every gap between the design doc and the code you are writing is filled by
> EXPLORATION, never by invention. "Didn't find it" is reportable; "made it up" is a defect.

---

## The Rule (owner-mandated 2026-07-29)

1. **Design docs cite their sources; the sources are part of the contract.** A batch/task design
   doc names the research banks, surveys, and reference repos it was derived from. During
   implementation you MAY (and should) read those sources to supplement detail the design doc
   compresses away. When the design's level of detail runs out, go DOWN into the cited source —
   not sideways into imagination.

2. **A skipped explore stage moves the explore duty into implement — it does not remove it.**
   When the leader skips a separate research/explore dispatch (because grill + design already
   covered the ground), the implement agent inherits the duty: any information found missing
   mid-build is resolved by active exploration, never by guessing.

---

## Resolution ladder when information is missing (in order)

| Step | Source | Notes |
|------|--------|-------|
| 1 | The design doc + its NAMED sources | research banks / workspace surveys cited in the doc |
| 2 | The repo itself | existing patterns, sibling modules, their tests — grep/read before inventing |
| 3 | Installed dependencies | `node_modules` types/dist, crate docs — the INSTALLED version, never trained memory |
| 4 | `references/` repos | only when the design names them; license rules apply (clean-room) |
| 5 | Web research | allowed tools ONLY (`mcp__exa__*` / tavily); for external-API facts |
| 6 | Still unresolved | implement the smallest defensible version + REPORT the gap explicitly in the final report |

An honest reported gap beats a fabricated fact — every time.

---

## Signals you are about to fabricate (STOP and explore)

- [ ] Writing an API call you have not seen in the installed package's types/dist
- [ ] Inventing a config key, file format, or field "that probably exists"
- [ ] Stating another system's behavior ("X does it this way") without a citation in reach
- [ ] Choosing a number (cap, timeout, budget, threshold) with no source — numbers come from the
      design doc, config, or a registry field, or they get flagged in the report
- [ ] Describing disk layout / protocol shape from memory instead of reading the actual code

---

## Leader-side mirror (dispatch duty)

Every dispatch prompt names the design doc AND its reference sources, with one line on what each
source grounds — so the implement/check agent knows where "down" is before it needs it.
