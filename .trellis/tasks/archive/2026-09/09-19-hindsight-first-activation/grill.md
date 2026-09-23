# Stage 2b grill record

Date: 2026-09-23. Conditional grill per the owner's direction: only material unresolved product issues pause the flow.
Research: [stage2b-seams.md](research/stage2b-seams.md).

## Q1 — Chat during the activation interval (the one product-shaped question the research surfaced)

Options: (a) keep chat usable, fence Canonical Local memory writes with a structured `MEMORY_AUTHORITY_FENCED`, witness
primary commits durably and carry them into the Hindsight epoch at COMMIT; (b) refuse new Runs until COMMIT (no carry
code, but the pet stops answering for the native import + certificate duration — minutes on real Banks).

Decision (leader, 2026-09-23): **(a)**. Grounds already on record: U1 ("one confirmation, then completion when checks
pass" — a background operation, not a modal pause); PR03 explicitly permits "durably preserve them for the resulting
epoch"; case C07 (Stage 4) requires durably queued writes during a fence and their post-restart replay, so (b) would be
replaced anyway; S2a already built the custody adoption/relocation machinery this reuses. Recorded here so the owner can
override before wave A's custody carry lands; a switch to (b) removes §2 steps 1-4 of the research and adds a
`captureRun` gate — nothing else changes.

## Engineering rulings resolved from source (no owner input needed)

- Bank coverage stays a prerequisite produced by `setup.apply` (G8): admission lists the scopes lacking a verified B3
  row; the card offers 应用配置 for them. The activation never provisions Banks itself.
- Cutover lease (G9): owner `hindsight-activation:<operationId>`, TTL 600 s renewed at every Bank boundary and native
  call (B2 precedent); `resume` may take over a lease whose holder operation is terminal or belongs to another `bootId`.
- Families `setup`, `local-onboarding` and `hindsight-activation` are mutually single-flight; direct
  `memory.hindsight.validate/setup/disable` refuse `HINDSIGHT_STATE_CONFLICT` while an activation row is open, and
  `disable` additionally refuses under marker `hindsight` (G6).
- Block writes gain the same active-epoch guard as records (G10); the fenced tidy pass is the primary stop.
- Invalidation rides the existing `memory.operations.changed` push; no second subscription (shared `index.ts` budget).
