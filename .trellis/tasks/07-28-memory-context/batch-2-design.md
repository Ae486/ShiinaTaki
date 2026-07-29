# Batch 2 design — Block foundation

Pre-development design for PRD §Batch 2. Binding inputs: prd.md §Batch 2 + notes.md rulings
(Q7 blocks-as-pure-md + registry; R20/R14 pinned region; R7 Identity Card wins all conflicts;
M-D4 user-model block; Q8 fence; R13 every number = config; D28 single-file deletable).
Written 2026-07-29 by the leader; owner-confirmed before dispatch.

## 1. Disk layout (structurally outside the FTS world)

```
<dataDir>/workspace/
  memory/            <- entry store (frontmatter files; FTS-indexed; batch 1 state)
  blocks/            <- NEW block root — NOT under memory/, so store.list()/reconcile can never
    global/            see a block and the FTS index can never ingest one (PRD: never indexed)
      user-card.md
      user-model.md
    characters/<characterId>/
      memory-index.md
```

Blocks are PURE markdown — zero frontmatter; ALL policy lives in the registry. Deleting a block
file removes that feature completely (D28); a missing file renders nothing (no header, no error).

## 2. New modules (colocated in `packages/core/src/memory/`)

| File | Role |
| --- | --- |
| `block-registry.ts` | Declarative rows + zod schema, validated at module load (clone of layer-registry pattern) |
| `block-store.ts` | Workspace-scoped IO: read / write with registry-policy enforcement; atomic temp+rename (clone of store.ts writeAtomic) |
| `memory-config.ts` (in `config/`) | `TAKI_MEMORY_PINNED_BUDGET` -> `{ pinnedBudget }`, zod, fail-closed default 800 (R13 — moves the assembler's hardcoded const) |

Touched: `assembler.ts` (block sections + fence + config-fed budget), `memory-engine.ts` (wire
block store into assembler deps), `main.ts` (construct block store at
`join(dataDir, "workspace", "blocks")` + load memory config), `persona-provider.ts` (extract
`stripNoteBlock` into a shared `strip-note.ts` — block reads reuse it, DRY), `pinned-block.ts`
(unchanged logic; only if signature must carry config), `docs/MEMORY-DESIGN.md` (§Blocks — the
batch-2 sanctioned edit), index.md files, tests.

## 3. Block registry (data, not code paths)

```ts
BlockDefinitionSchema = z.object({
  id: kebab id,
  ownership: z.enum(["global", "per-character"]),
  writer: z.enum(["user", "background"]),   // who may WRITE through the store API
  header: z.string().min(1),                // one-line prompt framing rendered above the content
  budgetTokens: z.int().positive(),         // per-block fit budget (fitToBudget-style trim)
});
V1_BLOCKS = [ user-card, memory-index, user-model ]  // ARRAY ORDER = injectPosition (PRD's
                                                     // injectPosition field realized as order —
                                                     // declarative, no duplicate/gap numbers)
```

Rows: `user-card` (global, writer:user, header states the R7 rule — "written by the user, wins
over anything else you remember"); `memory-index` (per-character, writer:background, header frames
it as "topics your memory holds — search triggers"); `user-model` (global, writer:background,
header frames it as her own consolidated understanding). Header text is registry DATA; exact
wording drafted at implement, checked against R7/R14/M-D4 semantics.

## 4. block-store API and policies

- `readBlock({ id, characterId? }) -> string | undefined` — direct `readFileSync` per call, NO
  boot cache (deliberate divergence from persona-provider, why-commented): user-card must pick up
  live hand-edits without a restart (queued manual check), and batch 4's tidy rewrites
  background blocks mid-session. Three tiny sync reads per turn is noise. Missing/unreadable ->
  `undefined` (never throws in the assemble hot path). `stripNoteBlock` applied on read (the `>`
  editor-note convention, shared with persona cards).
- `writeBlock({ id, characterId?, content, caller: "user" | "background" }) -> ok/refused` —
  REFUSES when `caller` mismatches the registry row's `writer` (PRD: the agent-side path can
  never write a writer:user block). Batch 2 has no agent-facing block tool — this store-level
  seam is what batch 4's tidy `block-rethink` tool and any future WS method ride. Atomic write.
- per-character blocks require characterId (mirror store.ts placement guard); global refuse one.

## 5. Assembler integration (R20/R14 pinned region)

Section order becomes: assistant layer -> persona -> emotion capsule -> **blocks in registry
order** (each: header + content trimmed to its `budgetTokens`; absent file -> section skipped)
-> pinned rows (existing selectPinned: non-truncatable relationship + profile >= threshold,
under config `pinnedBudget`) -> retrieved (UNTOUCHED, dies in batch 5) -> intention.

**Q8 fence**: rows rendered from `MemoryEntryRow` (pinned block + intention line) route
observed-origin content through `fenceUntrusted` (reuse `agents/untrusted-fence.ts`,
source="memory"): self rows render as today; observed rows of a section render grouped inside
ONE fence, age prefixes preserved. Honest scope note: today observed entries (image
descriptions -> episodes@4) can only surface via the retrieved section and memory_search — both
batch-3 surfaces ("observed hit content is fenced" is batch 3's line; the retrieved section dies
in batch 5). Batch 2 makes the two row-render sites origin-aware so no future pinned/intention
path can leak an unfenced observed row, and batch 3 reuses the same helper. This sequencing is
deliberate, not a gap.

## 6. MEMORY-DESIGN.md §Blocks

New section after §Substrate: the two-tier rule (blocks = always-visible tier, deterministic
push, pure md, registry-governed; entry rows = searchable tier, frontmatter + FTS) + the disk
tree sketch above + the three v1 blocks with their writers + D28 deletability note.

## 7. TDD table

| Test | Asserts |
| --- | --- |
| block-registry validation | 3 rows parse; array order stable; a bad row throws at load |
| readBlock missing -> undefined | no throw, section skipped downstream |
| readBlock strip-note | leading `>` block removed, body intact |
| readBlock live edit | write file externally between reads -> second read sees new content (no cache) |
| writeBlock policy | caller:"background" on user-card REFUSED; caller:"user" on user-card ok; mismatch on user-model/memory-index symmetric |
| writeBlock atomicity + placement | global vs per-character paths; per-character without characterId refused |
| assembler block order + headers | registry order, header line present, absent block skipped |
| assembler per-block budget | oversized block content trimmed to budgetTokens |
| assembler pinnedBudget from config | env override respected; default 800 fail-closed |
| fence at row sites | constructed observed row in pinned/intention renders inside `<untrusted-observation>`; self rows untouched |
| stability | two assembles with unchanged files byte-identical |
| memory store isolation | reconcile over a workspace WITH blocks present indexes zero blocks |

## 8. Constraints and frozen zones (batch 2)

- Frozen: `chat-agent.ts` (D1), `fts5-retriever.ts` / `disclosure-gate.ts` / `fts5-query.ts`
  (batch 3), assembler's retrieved section + `RETRIEVED_*` constants + retriever call shape
  (batch 5), batch-1 write side (episodic/flush/dedupe/auto-layer-policy — read-only integration).
- `docs/MEMORY-DESIGN.md` is UNFROZEN for §Blocks only.
- Zero new deps; OS-neutral; size caps; headers; index.md same-change; memory content never in
  logs; every new number = config or registry field with zod (R13).
- Blocks NEVER enter FTS (structural: disk placement outside memory/ + isolation test).

## 9. Deliberately deferred (recorded, not silent)

- Retrieved-section fence + hit-shape origin -> batch 3. Block CONTENT writers (index recompute,
  user-model maintenance) -> batch 4 tidy. Panel/WS surfaces for blocks -> #26. No auto-seeded
  user-card template — absent = skipped; the path is documented in MEMORY-DESIGN §Blocks and the
  manual check tells the owner where to create it.
