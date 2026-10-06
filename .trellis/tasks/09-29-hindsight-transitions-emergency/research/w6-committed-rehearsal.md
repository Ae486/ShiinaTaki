# W6 same-receipt full recovery rehearsal

Parent execution on 2026-10-06; task `.trellis/tasks/09-29-hindsight-transitions-emergency`.

The complete committed-recovery driver and independent Node restart passed on the new Core-only copy
`.trellis/.runtime/stage4-w6/rehearsal-abf36a2b069f4b04a2a468ff91736cf9`.
Supervisor session66223 exited0. Node35988 and Node29112 each exited0 normally, without forced termination.
The wrapper verified original files and all inventoried runtime sources were unchanged. Native was never started.

Final `rehearsal-result.json` SHA256:
`1adf77f5c041ed6d903e395de5963aa8684f4cc07e658910ccf4f94374e047ff`.
Emergency result SHA:`7eceb07b7d7bc0f64469da2ae82abd1f39411bc4527f9cadabc4398a848c5496`.
Restart result SHA:`4b2c023d5d4d469b1661b0cd4bb2966451b4daee951d85047e8932beb4b46b9d`.

## Proven behavior

- Recovery retained transition`0faf660d-9d8c-4215-ae5f-954f9f574734`, receipt
  `5da1b2448bcc7ccaf0a41d5cbfa50fc9ea5e6f77e3610082300c7ea9477eed31`, original capture/incident and target
  epoch`c4f53993-517e-4d97-96cd-7e916620ce29`. It did not create another authority publication.
- New recovery operation`e030a150-0bad-4995-8924-446fdfb19ec5` reached completed/ready/settled. All three old
  unknown operation row hashes and the original failed installation evidence remained unchanged.
- Publication and candidate extra audits took89.997s and89.890s. Each yielded to the actual existing heartbeat,
  which extended the captured executor lease. Current retention audit took3.730s. No test-driven renewal occurred.
- Production bind took178.354s, production queue settlement272.785s, and operation execution997.259s. Emergency
  start-to-completion took29m20s, including startup/preview/admission and final evidence. Preview took90.868s;
  admission was not independently timed and must not be assigned an inferred exact duration.
- Separate restart took9m27s and selected the same Local publication. Old foreign-authority reentry refused.
  Both phases preserved2Banks/722Sources/1275records/89invalidated with0new receipt-backed retention changes.
- Additional Native, transport and model calls were all0 in both phases.

## Source and continuation

The released six-file harness manifest SHA is
`92b2bebb0f849b3e2c439977ca7f563f4fe932e72217fcb62c060a6ad29e4f71`.
Parent matched112 combined Taki and5 Native identities before execution. Previous source manifests remain intact.

After this rehearsal stopped, the parent adjusted only the actual committed-recovery supervisor bound from1800s
to3600s because the measured29m20s emergency left little scheduling margin. Existing11supervisor tests passed
in1.13s; Ruff E/F/I with120columns passed. Production code,300000ms leases and all verification rules were unchanged.
`w6-committed-actual-source-preflight.json` records the original rehearsal hashes and this wrapper change.

This report proves the owned rehearsal only. Actual same-receipt recovery/restart, D91, W7/W8 and user/manual
acceptance remain separate gates. The actual current process is recorded in `leader-now.md`.
