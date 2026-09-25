# Isolated native Hindsight end-to-end smoke for Stages 1-2

Owner decision 2026-09-25 (D89): Stage 1-2 manual acceptance moves to Stage 6; every machine-verifiable item is proven
by machine. The remaining gap is real native semantics: all Stage 1-2 Core tests use a Hindsight transport double. This
task runs the real patched native Hindsight (`H:/hindsight`, see `TAKI_PATCHES.md`) as a throwaway instance against an
isolated Core and records the evidence. Verification only: no production change unless a defect is found (then the
leader rules on a fix wave).

## Requirements

- R1 Isolation: native data in a fresh embedded PostgreSQL (pg0) instance under a temp dir, a non-default port for both
  native API and Core (never 8974 or the owner's native port), Core `TAKI_DATA_DIR` in a temp dir. Existing
  `~/.pg0/instances` and the owner's Taki data are never opened, modified or deleted (listing before/after proves it).
- R2 No real model and no network: native LLM provider `mock`; embeddings/reranker from the cached local models with
  offline flags (`HF_HUB_OFFLINE=1`); Core's provider points at an unroutable or scripted local endpoint. If anything
  needs a download, stop and report instead.
- R3 No real secret: the native API key is a generated throwaway value; Core receives it through its supported secret
  path for the test (never the owner's Credential Manager entries).
- R4 Journey over the real WS RPC surface: Legacy/empty -> Local onboarding (S2a) -> retain via a Run -> `setup.validate`
  + `setup.apply` -> `hindsight.activate` -> marker `hindsight`, runtime available -> a Run captured by Hindsight ->
  Stage 1 `replica.sync` (incremental/full) -> new Character degraded Run -> `bank.provision` -> recall from Global +
  Character, degraded turn ingested once -> config change (timeout) -> `config_changed` -> `connection.revalidate` ->
  Core restart classifications (status stable, no redispatch).
- R5 Clean teardown: all spawned processes exit, no listener left, temp dirs removed after evidence is copied.

## Acceptance Criteria

- [ ] Evidence file `research/native-smoke-<date>.md` with each R4 step's observed RPC results, native call counts, and
      pass/fail; the harness script is kept under `research/` for rerun.
- [ ] Every step passes, or each failure is classified: product defect (file:line, reproduction), harness limitation
      (e.g. mock LLM extracts no facts), or native patch gap.
- [ ] R1/R2/R3/R5 proofs recorded (before/after listings, zero outbound fetches, no orphan processes).

## Out of scope

UI click-through, real key entry, the owner's real instance and data, recall quality (all Stage 6, D89).
