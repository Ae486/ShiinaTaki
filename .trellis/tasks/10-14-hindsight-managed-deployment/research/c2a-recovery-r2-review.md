# C2a recovery R2 independent review

Date: 2026-10-15. Reviewer: `/root/c2_design_check`.

**PASS for Root's once-only R2 execution.** R2 runtime is **NOT RUN**.
The consumed first attempt remains **FAIL**; `deploymentReady` remains false.

Scope: only the R1-relative scan-order repair, fresh token and new static evidence.
No previously accepted unchanged source or runtime behavior was re-reviewed or rerun.

## Findings (fixed)

- File: `docker-recovery/run-recovery.ts`
- Issue: R1 scanned local file contents while the live Shell held `deployment.lock` exclusively.
- Verified fix: The released R2 removes the final live scan. Cleanup still reaps every recorded
  Core/Shell and verifies captured helpers gone at lines 592-593, performs the **same complete
  scanner** at line 629, then validates/removes R. Only successful scan completion sets
  `protectedTreeScannedAfterStop`; line 685 requires it before cleanup can retain final PASS.
- Attribution: Implemented before this review by `/root/c2a_recovery_implement`; no reviewer edit
  was needed.

The source comparison contains exactly the fresh CASE token plus the expected live-scan removal,
post-stop flag assignment and final flag requirement. Scanner body, provisioning scan, persistent
file coverage (including the lock), sentinel/regular-file/symlink checks, limits, budgets, production
sharing and live evidence assertions remain unchanged.

The original main catch is unchanged. A prior failure stays false after successful cleanup; a
scan, cleanup, path/removal or missing-flag failure reaches the existing cleanup catch and forces
false. No failure is converted to PASS by the new flag.

## Findings (not fixed)

None within the repair. R2 still needs actual execution; this static PASS does not accept it.

## Verification

- Node syntax: **PASS**, reused from the matching R2 source hash.
- Lint: **PASS**, matching R2 scoped ESLint `--no-ignore`.
- TypeCheck: **PASS**, matching R2 single-entry no-emit result, `diagnostics: []`.
- Python AST / Ruff check / Ruff format: **PASS**, prior results reused after independently matching
  the unchanged probe SHA-256 `e3e49ad25888b34332184775f3193a47ad9e3c0c4943fd08e3dc7b3611119b29`.
- Tests/runtime/build: **NOT RUN**. No static check was repeated because this review made no source
  change. All four released input hashes match the self-check/Root handoff; UTF-8 has no BOM.

New successful checks ran at 10:26:22.682Z (syntax), 10:26:34.297Z (ESLint), and
10:26:38.909Z (no-emit), after the final token-bound launcher edit. Raw commands/results remain in
[the self-check JSON](c2a-recovery-r2-self-check.json). [This review's JSON](c2a-recovery-r2-review.json)
records the exact comparison and check reuse.

## Released bindings

- Token: `775da07b-2b69-44a3-868c-2604423dac11`
- S: `G:/TakiAgent-c2a-docker-acceptance/recovery-775da07b-2b69-44a3-868c-2604423dac11`
- R: `C:/taki-c2a-docker-recovery-775da07b-2b69-44a3-868c-2604423dac11`
- Tag: `taki-c2a-fake:775da07b-2b69-44a3-868c-2604423dac11`

| Input | SHA-256 |
| --- | --- |
| `docker-recovery/run-recovery.ts` | `869146af78a9cde99cf70af2c857049548c3c097aedd09f63c95d779c8d11017` |
| `docker-recovery/README.md` | `9c73c76e240e84e45b98d6872a9e6596f9df7d6e7c12d55d46556d36b9c0e3e4` |
| `c2a-recovery-r2-self-check.md` | `974109fdb4598cce3ceaada4f933d804ca24381d96f90a6f401715d6454df20c` |
| `c2a-recovery-r2-self-check.json` | `c9250e0c65792b8656d63a338700665a4f6a781bf9f6d163385c1fb4040fe419` |

Only this review and its JSON companion were added. All four owned inputs are released unchanged
to Root. The old token is absent from the current runner/README; references to R1 in the self-check
are historical evidence.

Root's verified R1 archive has 72 entries and SHA-256
`fb0d5afca5f04df4d800c25d831db49c218a2d3233a07c919f5baa55e11b795d`.
That verification is reused; no archive, R1 result, consumed marker or prior review was altered.
No production/template/spec contract changed, so no spec synchronization is needed.

Root may prepare the exact fresh resources and execute R2 once under the existing approval.
Runtime evidence, complete post-stop scan and exact owned cleanup must pass before acceptance.

