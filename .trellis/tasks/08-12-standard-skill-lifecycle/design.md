# Standard Skill Lifecycle - Technical Design

## 1. Boundaries and state planes

Slice 7 is one compact vertical across Shared, Core, and Home. The Core-local Host is the only package owner in this
MVP, but every durable row, runtime record, operator result, and governed read carries its explicit `ownerHostId`.
Paths and display labels never infer ownership. Cross-Host transfer and whole-Run convergence stay in the final child.

The lifecycle has three state planes:

1. **Durable sidecar truth**: SQLite package/import rows and immutable published bytes. This owns desired enabled state,
   optimistic revision, provenance/trust/scan metadata, and failure visibility.
2. **Operator projection**: strict `skill.*` methods and disposable Home state. It is never another writer or cache.
3. **Runtime truth**: a process-local immutable catalog generation and short-lived read leases. It is reconstructed from
   durable rows and verified package bytes after restart; generation ids and leases are never persisted.

Package content remains a portable Agent Skills directory. Taki state never enters `SKILL.md` or an invented manifest.

## 2. Shared protocol

Add `skill-lifecycle-schema.ts` and named exports. Stable vocabulary:

- `SKILL_METHODS`: `skill.list`, `skill.inspect`, `skill.import`, `skill.enable`, `skill.disable`, `skill.remove`,
  `skill.reconcile`.
- Source: `directory | zip | legacy-directory` (`legacy-directory` is Core-produced, never accepted over the wire).
- Lifecycle: `active | quarantined | rejected`.
- Trust/provenance display: `bundled-reviewed | operator-local | external-archive | legacy-local | blocked`.
- Scan verdict: `passed | review | rejected`; scan findings are closed bounded codes, not arbitrary scanner text.
- Runtime: `available | disabled | invalid`, plus process-local `catalogGeneration`.
- Every successful package row exposes `packageId`, optional standard name/description, `ownerHostId`, content hash,
  enabled state, revision, source locator, trust, scan metadata, lifecycle/runtime state, timestamps, and a bounded
  failure reason. It never exposes an absolute path or package file bytes.

`skill.import` accepts either a bounded ZIP payload or a bounded browser-directory file list. Replacement explicitly
names `replacePackageId` and `expectedConfigRevision`; omission means create and fails on a duplicate standard name.
Enable/disable/remove require the expected revision. Inspect returns validated metadata plus a bounded relative-file
inventory. Reconcile returns counts and the new catalog generation.

Semantic refusals use new closed error codes `SKILL_CONFIG_CONFLICT` and `SKILL_REFUSED`, with bounded reasons such as
`unknown-package`, `duplicate-skill`, `invalid-package`, `unsafe-package`, and `package-disabled`. Raw YAML, archive,
filesystem, or submitted-content errors never cross the method boundary.

## 3. Durable model and migration 018

Migration 018 creates one STRICT `skill_packages` table. `package_id` is a UUID primary key; `skill_name` and
`description` are nullable so a rejected import remains observable. The row stores `owner_host_id`, `content_hash`,
`lifecycle_state`, `enabled`, `source_kind`, sanitized `source_locator`, `trust`, `scan_version`, `scan_verdict`,
`scan_findings` JSON, bounded `failure_reason`, `config_revision`, `created_at`, and `updated_at`. Checks constrain every
enum/boolean/revision column. A partial unique index permits at most one `active` row per non-null `skill_name`.

The repository Zod-parses rows, writes synchronously in short transactions, and implements optimistic
compare-write-increment for replacement, enable, disable, and remove. A rejected import starts at revision 1 and is
always disabled. Removal deletes the durable row; quarantine history is otherwise retained until explicitly removed.

Absolute package roots are derived from the fixed store root plus validated identity/hash and are not persisted.
Durable hashes use `sha256.<64-lowercase-hex>`.

## 4. Store layout and bounded import

Use a dedicated Core-owned root, separate from the legacy discovery directory:

```text
<dataDir>/skill-packages/
  staging/<importId>/
  quarantine/<packageId>/
  published/<skillName>/<sha256hex>/
```

Limits are constants in one Core module and mirrored by Shared/UI where early refusal helps. The Core is authoritative:

- compressed ZIP/source payload: 20,000,000 bytes (aligned with the existing browser-source upload ceiling);
- file count: 2,048;
- one unpacked file: 16 MiB;
- total unpacked package: 64 MiB;
- `SKILL.md`: 1 MiB;
- one agent resource read: 256 KiB of valid UTF-8 text;
- operator inventories/results: at most 2,048 relative paths and bounded reason/finding strings.

All paths normalize to `/`-separated package-relative names. Reject empty/absolute/UNC/device paths, drive prefixes,
`.`/`..`, NUL, trailing-dot/space aliases, duplicate normalized paths, Unicode-normalized or ASCII case collisions,
and resolved-root escape. Directory import data is written only after validating the complete entry table. ZIP parsing
must expose central-directory attributes before extraction; reject Unix symlinks/special files and Windows reparse
attributes. Legacy traversal uses `lstat`, rejects symbolic links/junctions and regular files with `nlink > 1`, and
rechecks containment after resolution.

The existing `fflate` whole-archive reader cannot prove link attributes or bound decompression before allocation.
Introduce a maintained lazy ZIP reader only if the installed API exposes entry sizes and external attributes; inspect
its installed types before coding. Reuse the existing `characters/member-path.ts` rules only after extracting a
domain-neutral path guard without weakening character behavior; do not copy a second drifting traversal algorithm.

## 5. Validation, scan, hash, and publication

Pipeline:

```text
source -> enumerate/validate -> staging -> manifest parse -> structural scan -> deterministic hash
       -> immutable directory publish -> SQLite commit -> atomic runtime catalog publish -> old generation retire/GC
```

Parse frontmatter with a maintained safe YAML parser, unique keys, aliases disabled/bounded, and no executable custom
tags. Validate known fields exactly against the current Agent Skills contract while retaining raw `SKILL.md` and all
unknown metadata/files unchanged. The selected package root must contain exactly one root `SKILL.md`; an archive may
wrap it in one common top-level directory, which is stripped only as a view during staging.

The v1 structural scan records executable-looking files and standard `scripts/` content as review findings; it does
not claim code or prompt safety. Path/link violations and invalid standard metadata reject. Trust/scan can require an
operator to enable an import but can never authorize the actions described by it.

Hash sorted normalized relative paths and exact file bytes with unambiguous length framing. The package directory is
renamed from staging to its content-addressed destination only after complete validation. Same-name/same-hash import is
idempotent at the byte store but still obeys duplicate/replacement revision rules.

Build an in-memory candidate record before the DB mutation. If validation, publication, or DB commit fails, the old
row/generation remains authoritative and the candidate is quarantined or discarded with an observable bounded row.
After a successful DB commit, runtime publication is a synchronous map swap using the already-validated candidate and
cannot perform new I/O. Replacement therefore cannot leave durable new truth with runtime old truth.

## 6. Catalog generation, leases, and garbage collection

`SkillCatalogManager` owns one frozen map of enabled, active, hash-verified packages. Publication increments a
process-local generation and atomically swaps the map. Disabled/quarantined/rejected/tampered rows never enter it.

`renderList`, `load`, `describe`, and resource reads capture one generation record, increment its lease, perform a
bounded synchronous read under its immutable root, then release in `finally`. Retired generations accept no new reads.
Their content roots are deleted only when lease count reaches zero; a bounded boot/reconcile garbage pass removes
unreferenced staging/published roots left by crashes. A read bound to an old generation is never redirected to a new
package.

This child guarantees atomic per-operation snapshots. The final extension-integration child will bind Skill and MCP
catalog snapshots into one whole-Run discovery budget; Slice 7 must expose a generation/snapshot seam rather than edit
`chat-agent.ts` into a Skill-specific integration path.

## 7. Loading and support resources

Refactor the current static loader over `SkillCatalogManager` while preserving `load_skill` naming and governed
identity `skill.load` / `skill-load`. A successful `load_skill` returns the Markdown body, package content revision,
and bounded support-path inventory. It never interprets `allowed-tools` as a grant.

Add `read_skill_resource` as a second thin informational tool. It accepts a standard Skill name and normalized
package-relative path, uses the same `skill.load` Governance cell and subject identity/revision, and delegates to the
catalog reader. It rejects `SKILL.md`, links, directories, binary/invalid UTF-8, oversized content, and escape. Script
text may be read as data, but executing it still uses an ordinary governed capability on the explicit owning Host.

## 8. Legacy seed and reconcile

At boot, when `skill_packages` is empty, read the old `skills-state.json` and enumerate `<dataDir>/skills/<name>`.
Valid directories pass through the same link/path/manifest/hash/publish pipeline with trust `legacy-local`; disabled
names preserve their state. Invalid legacy directories create rejected/quarantine rows without blocking unrelated
packages or Core boot. The source directory and state file are never modified.

Once any durable package row exists, legacy inputs are no longer authoritative. `skill.reconcile` verifies every
durable published root against its stored hash/manifest, marks failures invalid and non-routable, rebuilds one atomic
catalog, and garbage-collects only unreferenced inert roots. It does not import newly edited legacy directories.

## 9. Operator service and Home

One `registerSkillMethods` seam exposes thin operator-only controllers over `SkillLifecycleService`; unexpected errors
are logged by class/name only and become fixed `INTERNAL_ERROR`. Lifecycle methods serialize mutations in the service,
use process-local operation tokens for asynchronous import, and recheck replacement revision before committing so a
late import cannot overwrite a newer mutation.

Home follows the MCP page's proven current-generation controller pattern: one fresh list per authenticated client,
late-result suppression, serialized mutations, conflict refetch, no replay, and no local persistence. The page offers
ZIP and browser-directory pickers, cards for active/rejected packages, inspect details, enable/disable, replacement,
reconcile, and two-step remove. It uses existing page chrome/card/badge/button primitives and a repo-native Skill glyph.
No Tauri filesystem permission is required because browser file input bytes cross the existing operator WebSocket.

## 10. Rollback and failure behavior

- Pre-publication failure: retain an inert bounded failure record; no catalog change.
- Replacement conflict/failure: old SQLite row, generation, and files remain serving.
- Crash after directory rename but before DB commit: boot/reconcile sees an unreferenced immutable root and removes it.
- Crash after DB commit: boot verifies the row/hash and rebuilds runtime truth.
- Post-publication tamper/missing file: reconcile removes it from runtime and marks the row invalid; it never serves
  partial bytes.
- Disable/remove: durable mutation commits, runtime publication removes the package, old readers drain, then content GC
  runs. Unknown operator outcomes require refetch rather than retry.

## 11. Verification shape

Tests cover Shared strict schemas; migration/repo reopen/conflicts; directory/ZIP path and size attacks; YAML field
compatibility; deterministic hash; quarantine/publication/rollback; generation leases and tamper reconcile; legacy
seed; governed instruction/resource reads; operator role/error boundaries; Home controller/state/components/no-cache;
and one real-process post-boot lifecycle over WebSocket. Final gates include workspace typecheck/lint/tests, Desktop
production build, strip-only Core boot, header/index audit, and `git diff --check`.
