# Standard Skill Package Lifecycle and Home Management

## Goal

Make open-standard `SKILL.md` packages configurable and usable without manual filesystem edits or a Core restart.
Operators can safely import, inspect, enable, disable, replace, remove, and reconcile packages from Home while the
Agent continues to use metadata-first discovery, lazy instructions, and confined support-resource reads.

## Dependencies

- Canonical Governance and Approval are implemented and checked.
- Secure MCP lifecycle is independently converged; this task reuses its operator-state and Home-client patterns but
  does not couple Skill authority to MCP transport state.
- The final `08-12-extension-discovery-integration` child owns cross-surface discovery and whole-Run integration after
  this independently usable Skill lifecycle is complete.

## Requirements

### Standards compatibility

- Accept a package whose selected root contains one required `SKILL.md` plus arbitrary additional files and
  directories. Preserve package bytes and relative paths instead of converting them into a Taki-private format.
- Validate current Agent Skills metadata: required `name` and `description`; optional `license`, `compatibility`,
  string-to-string `metadata`, and the experimental space-separated `allowed-tools` string.
- Enforce the standard `name` and parent-directory relationship. Preserve unknown metadata without assigning it Taki
  semantics.
- Recognize `scripts/`, `references/`, and `assets/` as standard support directories and preserve compatible
  conventions such as `templates/` without rejecting other additional directories.
- Treat Skill text, `allowed-tools`, provenance, trust, and scan labels as untrusted guidance. None grants permission,
  changes Host ownership, or bypasses Governance and Approval.

### Safe lifecycle

- Import both a local directory and a ZIP archive through a bounded staged pipeline that rejects traversal, absolute
  or device paths, duplicate/case-colliding paths, links, resolved-root escape, excessive file counts, oversized files,
  and excessive unpacked size.
- Validate and scan before publication, compute a deterministic package hash, and publish immutable package content
  atomically. Never mutate a live package generation in place.
- Keep Taki lifecycle state outside package contents: stable package identity, owning Host, enabled state, revision,
  source/provenance, trust, hash, scan version/verdict/findings, timestamps, and bounded failure details.
- Keep rejected packages observable to the operator but never discoverable or loadable by the Agent. Materialized
  packages that fail validation remain inert in quarantine; structurally unsafe archives are never extracted.
- Support enable, disable, safe replacement, remove, and reconcile without restarting Core. Mutations use optimistic
  revisions and never replay after an unknown client outcome.
- Preserve the last-good runtime catalog across a failed replacement. Disable/remove/replacement retires the previous
  immutable generation and deletes unreferenced content only after its readers release it.
- Seed the existing `<dataDir>/skills/<name>` layout and `skills-state.json` into the new lifecycle once when durable
  Skill state is empty. Legacy files remain untouched and become non-authoritative after a successful seed.

### Progressive disclosure and resources

- Expose only enabled, valid package name/description metadata in the always-visible Skill list.
- `load_skill` lazily returns the selected package's `SKILL.md` instructions and a bounded support-file inventory.
- A separate Skill resource tool reads one package-relative regular file through the same installed package identity,
  immutable content revision, Host ownership, and Governance cell as instruction loading.
- Resource reads reject `SKILL.md`, directories, links, binary content, oversized content, and any path that escapes the
  immutable package root. Scripts and executable-looking assets remain data; execution uses ordinary governed
  capabilities on the correct Host.

### Operator surface

- Define one strict Shared `skill.*` operator protocol for list, inspect, import/replace, enable, disable, remove, and
  reconcile. Every management method is operator-only; no Agent tool can mutate lifecycle state.
- Add one Home Skills page with loading, empty, ready, import, validation, conflict, partial-failure, disabled,
  quarantined/rejected, reconnecting, and removal-confirmation states.
- Home accepts a picked ZIP or browser directory, shows Core-authoritative provenance/hash/trust/scan/runtime facts,
  and stores no authoritative package snapshot in local storage or another cache.
- Every operator mutation is serialized, scoped to the current authenticated Home client generation, and followed by
  a Core refetch. Timeouts/reconnects do not replay writes.

## Acceptance Criteria

- [ ] From Home, an operator can import a valid directory or ZIP, inspect it, enable it, load its instructions and a
      text support resource through Agent tools, disable/re-enable it, replace it, remove it, and reconcile state
      without manual file edits or Core restart.
- [ ] A valid block-scalar YAML description and all current standard fields round-trip while unknown package files and
      metadata remain byte-for-byte present in the published package.
- [ ] Traversal, absolute/device paths, duplicates/case collisions, link-like entries, size/count overflow, malformed
      metadata, name/root mismatch, and post-publication tampering are fail-closed and tested.
- [ ] Invalid or rejected imports remain visible with bounded reasons but never enter instructions, `load_skill`, or
      resource reads.
- [ ] Replacement and mutation races cannot alter a live directory, publish stale content, redirect an in-flight read,
      or remove content still leased by an older generation.
- [ ] Durable state survives Core restart; process-local generation/lease state is rebuilt rather than restored as
      executable truth.
- [ ] Legacy valid packages and disabled state seed once without modifying the legacy package; later legacy edits do
      not silently override durable truth.
- [ ] Skill metadata, `allowed-tools`, trust, scan verdicts, and scripts never widen the canonical permission result.
- [ ] Shared, Core, Home, migration, real-process lifecycle, production build, Core boot, header/index, and diff gates
      pass at the risk-appropriate scope.

## Definition of Done

- Shared schemas, Core lifecycle, Agent loading/resource tools, Home page, migrations, and focused tests are complete.
- One real Core process proves post-boot import and lifecycle persistence over the operator WebSocket surface.
- Relevant specs, source headers, directory `index.md` files, HANDOFF, and developer journal are current.
- One full-scope `trellis-check` has reviewed the complete Slice 7 implementation.

## Out of Scope

- Hub/marketplace/source adapters, remote download, automatic update, package signing, ratings, and dependency solving.
- Agent self-install, self-edit, lifecycle mutation, Experience Review, or Learning Proposal activation.
- Executing scripts directly, interpreting `allowed-tools` as authority, or adding a Skill-specific permission store.
- Filesystem watching and silent re-import of external edits.
- Cross-Host package transfer, remote Host package mutation, and the final unified Skill/MCP discovery budget. These
  remain owned by `08-12-extension-discovery-integration`; this task carries explicit `ownerHostId` throughout.

## Research References

- `../08-10-skills-mcp-productization/research/current-gap-and-dependency-map.md`
- `../08-10-skills-mcp-productization/research/standards-and-reference-prior-art.md`
- `../08-10-skills-mcp-productization/research/vps-secret-backend-options.md`
