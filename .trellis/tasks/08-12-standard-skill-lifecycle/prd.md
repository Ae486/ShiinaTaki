# Standard Skill Package Lifecycle and Home Management

## Goal

Productize open-standard `SKILL.md` packages through safe staged import, sidecar governance, atomic catalog publication,
confined support resources, and one Home operator surface.

## Dependencies

- `08-12-approval-productization` complete; may proceed in parallel with secure MCP work.

## Scope

- Current Agent Skills field validation and lossless package preservation.
- Directory/archive staging, traversal/link/case/size defenses, quarantine, hash, provenance/trust/scan state.
- Inspect/enable/disable/remove/reconcile and atomic catalog generations.
- On-demand confined support-resource reads on the owning Host; scripts remain data until governed execution.
- Home Skills page with complete states.

## Acceptance Criteria

- [ ] Operator completes full lifecycle without manual file edits or Core restart.
- [ ] Invalid/rejected packages remain observable but never discoverable/executable.
- [ ] Package update cannot mutate a live generation in place or escape its Host/root.
- [ ] Skill metadata can narrow/recommend but never grants permission.
- [ ] Standard-compatible unknown files/metadata are preserved rather than converted to a private format.

## Out of Scope

- Hub/marketplace, automatic updates, signing ecosystem, agent self-editing, or Learning Proposal activation.

