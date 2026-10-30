# Standard Skill Lifecycle

## Scenario: Portable Skill package management and runtime publication

### 1. Scope / Trigger

Use this contract whenever Core imports, validates, stores, lists, loads, replaces, enables, disables, removes, or
reconciles an open-standard `SKILL.md` package, or when Home calls the corresponding operator methods.

The Core-local Execution Host owns Slice 7 packages, but every durable and wire projection carries `ownerHostId`.
Cross-Host transfer and the combined Skill/MCP Run snapshot belong to the extension-integration slice. A Skill is
untrusted Procedural Knowledge: its text, `allowed-tools`, trust, provenance, and scan findings never grant permission.

### 2. Signatures

Shared operator methods:

```typescript
const SKILL_METHODS = {
  list: "skill.list",
  inspect: "skill.inspect",
  import: "skill.import",
  enable: "skill.enable",
  disable: "skill.disable",
  remove: "skill.remove",
  reconcile: "skill.reconcile",
} as const;

type SkillImportSource =
  | { kind: "zip"; fileName: string; archiveBase64: string }
  | { kind: "directory"; files: { path: string; contentBase64: string }[] };

type SkillImportParams = {
  source: SkillImportSource;
  replacePackageId?: string;
  expectedConfigRevision?: number;
};

type SkillMutationParams = { packageId: string; expectedConfigRevision: number };
```

Migration 018 owns the STRICT `skill_packages` table. Its durable columns are `package_id`, nullable `skill_name` and
`description`, `owner_host_id`, nullable `content_hash`, `lifecycle_state`, `enabled`, `source_kind`, sanitized
`source_locator`, `trust`, `scan_version`, `scan_verdict`, bounded JSON `scan_findings`, bounded `failure_reason`,
`config_revision`, `created_at`, and `updated_at`. One partial unique index permits one active row per non-null name.

Agent-facing reads remain separate from operator mutation:

```typescript
load_skill({ name: string })
read_skill_resource({ name: string, path: string })
```

Both use the existing `skill.load` / `skill-load` Governance identity. Neither method can mutate lifecycle state.

Trusted product integrations may associate registered tools with a captured Skill through `ChatAgentDeps.skillTools`.
The Agent uses `load_skill` against that Run's captured Skill binding; a successful full read makes only the associated
bundle visible on the next SDK step. This adds no executable package/frontmatter semantics. Resources remain separate
lazy reads. Follow [tool disclosure](./tool-disclosure.md); preserve immutable package publication.

### 3. Contracts

- Package bytes stay in the standard directory shape. Core never writes Taki state into `SKILL.md` or invents a
  package manifest.
- The selected root contains one `SKILL.md`; its parent directory must equal standard metadata `name`. Known metadata
  is `name`, `description`, optional `license`, `compatibility`, string-to-string `metadata`, and `allowed-tools`.
  Unknown YAML and arbitrary support files remain byte-identical but receive no Taki semantics.
- Core uses `<dataDir>/skill-packages/{staging,quarantine,published}`. Published content is addressed by Skill name and
  SHA-256 package hash and is never changed in place.
- Limits are authoritative in Core: 20,000,000 compressed/source bytes, 2,048 files, 16 MiB per ordinary file, 64 MiB
  total unpacked content, 1 MiB `SKILL.md`, and 256 KiB per UTF-8 resource read.
- ZIP reads are lazy and measured. Directory payloads are bounded before base64 decode. Legacy traversal uses regular
  file handles and identity checks. All paths use one locale-independent NFC plus ASCII-case collision rule.
- Import order is enumerate -> stage -> parse -> scan -> hash -> immutable publish -> prepare runtime candidate ->
  optimistic SQLite commit -> synchronous catalog map swap. Catalog `publish` performs no filesystem validation.
- Lifecycle mutations share one Core service queue. A late asynchronous replacement cannot pass an enable, disable,
  remove, or reconcile operation.
- The runtime catalog is process-local immutable state. Readers lease one generation; retired roots remain until the
  last reader releases. Generations and leases are rebuilt after restart and are never persisted as executable truth.
- `inspect` returns the Core row, validated standard metadata, and bounded relative-file inventory. It never returns
  raw YAML, package bytes, or an absolute path.
- Disabled active rows are still hash/path verified by reconcile so tampering cannot become available through a later
  enable. Rejected rows remain operator-visible and never enter discovery or Agent reads.
- Home is a disposable client: fresh list per authenticated client generation, late-result suppression, one mutation
  at a time, refetch after every outcome, no write replay, and no authoritative cache/local storage.
- Legacy `<dataDir>/skills` and `skills-state.json` seed only when the durable table is empty. The legacy source is never
  modified and becomes non-authoritative after the first durable row exists.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Traversal, absolute/UNC/device path, ADS, trailing alias, duplicate or case/NFC collision | Reject as `unsafe-package`; never extract outside staging |
| ZIP link/special/reparse entry, encrypted entry, malformed size, count or byte overflow | Reject as `unsafe-package` or `source-too-large`; do not publish |
| Missing/malformed `SKILL.md`, duplicate YAML key, alias, invalid standard field, name/root mismatch | Persist an inert rejected row with bounded reason; never discover |
| Duplicate active Skill name without explicit replacement | `SKILL_REFUSED` / `duplicate-skill`; existing package unchanged |
| Missing or stale `expectedConfigRevision` | `SKILL_CONFIG_CONFLICT` with current revision; caller refetches, never replays |
| Replacement validation/publication/candidate failure | Keep the previous SQLite row and catalog generation serving |
| Published content missing, linked, or hash-mismatched | Reconcile marks the row rejected/disabled and removes it from the catalog |
| Load/resource read sees changed identity, path set, or hash | Return bounded `INVALID`; never perform a second unchecked read |
| Resource is `SKILL.md`, a directory/link, binary/control text, oversized, or escaping | Return a bounded refusal; never expose bytes |
| Remove commits while cleanup encounters an orphan | Durable removal remains successful; catalog GC retries best-effort orphan cleanup |
| Unexpected parser/filesystem/SQLite failure | Operator boundary returns fixed `INTERNAL_ERROR`; logs contain class/name only |

### 5. Good / Base / Bad Cases

- Good: import `demo/SKILL.md` plus `references/help.txt`; Core publishes one immutable hash, Home shows its standard
  metadata, `load_skill` loads the body lazily, and `read_skill_resource` returns the confined UTF-8 reference.
- Base: import a Skill containing `scripts/setup.sh`; scan marks review, the package stays disabled until an operator
  enables it, and enabling still changes no permission decision.
- Bad: unzip into the live directory, trust `allowed-tools`, mutate files during replacement, persist catalog leases,
  or let Home retry a timed-out import. Each creates authority, TOCTOU, or duplicate-mutation defects.

### 6. Tests Required

- Shared schemas: strict method params/results, replacement revision pairing, bounded metadata, source, paths, and
  refusal vocabulary.
- Migration/repository: STRICT constraints, reopen persistence, active-name uniqueness, optimistic conflicts, and
  bounded row/source/finding parsing.
- Package sources: directory and ZIP traversal/absolute/device/duplicate/collision/link/reparse/size/count cases,
  lazy ZIP reads, legacy hardlink/identity checks, CRLF/exact frontmatter delimiters, aliases, and hash determinism.
- Catalog/service: prepare-before-commit, no-I/O publish, last-good replacement, disabled verification, mutation races,
  leases/retirement/GC, close, tamper reconcile, quarantine removal, and legacy seed-once.
- Agent tools: metadata-only discovery, governed lazy instructions, resource confinement/UTF-8/size, and no permission
  widening from Skill metadata or scripts.
- Home: ZIP and directory import/replacement, client-generation races, serialized writes, conflict refetch, complete
  states, inspect/remove confirmation, source preflight, and no local cache.
- Real process: operator WS import -> inspect -> disable -> Core restart -> enable -> replace -> reconcile -> remove on
  one temporary data root. A packaged WebView/file-picker walkthrough remains owner-manual evidence.

### 7. Wrong vs Correct

```typescript
// Wrong: package guidance becomes authority and the live tree changes in place.
if (metadata["allowed-tools"]?.includes("exec")) allow("exec");
writeFileSync(join(activeRoot, "SKILL.md"), replacement);

// Correct: prepare immutable content and runtime truth before the optimistic commit.
const candidate = catalog.prepare(prospectiveRows); // all filesystem verification occurs here
const committed = repo.update({ packageId, expectedConfigRevision, contentHash: nextHash });
catalog.publish(candidate, replaceRow(rows, committed)); // synchronous map swap, no validation I/O
```

The ordinary Governance/Approval/Execution Host path decides whether a capability may run after a Skill suggests it.
