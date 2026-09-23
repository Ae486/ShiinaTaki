# Stage 2b research index

- [stage2b-seams.md](stage2b-seams.md) — B4 substrate map, PR03 custody analysis, A38 writer inventory, operation surface,
  recovery classification, Home seams, test substrate, wave split and the closed failure matrix (11 numbered gaps, G1-G11).

## What exists

- Every B4/D78 primitive (capture, baseline, prepare, import, verify, replica publication, markReady, promotion) with
  immutable evidence tables and a synchronous promotion transaction; a harness that drives the whole chain in tests.
- Stage 1 operation owner (`memory.operations.*`, `memory.authority.status`), Stage 2a Local onboarding kinds, trusted
  primary custody, one published Local binding with same-epoch recovery, and Home cards/controllers to mirror.
- Deterministic Hindsight doubles (transport client, D78 wire builders, runtime app/native fixture) and scripted models.

## What is missing

- A production coordinator and operation kind (G1, G7), an in-process Local -> Hindsight rebind and boot-unavailable path
  for Hindsight (G3), a Canonical Local write fence/drain with `settle()` (G2), and PR03 carry of open groups and
  unconsumed witnesses into the Hindsight epoch plus marker-routed primary callbacks (G4). Secondary: capture transition
  refusal (G5), family/RPC isolation during activation (G6), Bank prerequisite guidance (G8), lease owner/TTL (G9),
  unguarded Block writes (G10), boot evidence join (G11).

## Open product question (only one)

- During the activation interval: keep chat usable with Local memory writes fenced and late commits carried into the new
  epoch (recommended), or refuse new Runs until COMMIT (simpler, blocks chat for the native import/certificate duration).

## Files

- `stage2b-seams.md` — the seam research (primitives, custody, fence, surface, recovery, matrix).
- `isolated-process-check.mjs` — wave B boot smoke: temp data dir, free non-default port, provider fetch blocked; migrations through the head, operator auth, `memory.activation.status` + `memory.authority.status`, wrong-marker `hindsight.activate` refused (kind registered), SIGINT clean exit. Run: `node .trellis/tasks/09-19-hindsight-first-activation/research/isolated-process-check.mjs`.
