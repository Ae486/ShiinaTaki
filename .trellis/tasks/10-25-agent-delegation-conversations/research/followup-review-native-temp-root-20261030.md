# Native fixture temp-root repair — 2026-10-30

## Finding (fixed)

The coordinator's native UI run failed before WebView startup. Its unchanged evidence at
`target/agent-delegation-20261030-validation/native-ui/2026-10-30T09-54-50-392Z/evidence.json` records exit 101 and
`examples/c2-presence-fixture.rs:13`: `root.is_absolute() && root.starts_with(std::env::temp_dir())` failed.

Both new S7 native scripts allocated `C2_FIXTURE_ROOT` beneath the repository evidence directory. This violated the
existing native fixture's OS-temp-root contract; the established C2/C3 scripts use Node's `os.tmpdir()`.

The repair is limited to:

- `apps/desktop/test/s7-subagent-native-smoke.mjs`
- `apps/desktop/test/s7-subagent-runtime-smoke.mjs`
- `apps/desktop/test/index.md`

Both scripts now use `mkdtemp(join(tmpdir(), "taki-s7-..."))`. Reports/screenshots remain under the selected repository
evidence root. An immediate `fixture-location.json` records `{ retainedOwnedFixture: directory }` before asset building,
so even an early build failure leaves a discoverable retained-profile location. Final evidence retains its existing
`retainedOwnedFixture` field. Cleanup still closes owned processes/connections; it does not claim those retained
profiles/assets were deleted. No native guard, Rust source, production source, TEMP variable or dependency changed.
No directory was deleted or moved, and the original failed evidence remains intact.

## Verification and evidence

Evidence: [`target/followup-review-20261030/native-temp-root`](../../../../target/followup-review-20261030/native-temp-root/).
It contains inherited preimages, a three-file ownership manifest, exact review diffs/hashes, original failure/native
guard hashes, and verification logs. The existing failure and native Rust guard SHA-256 hashes still match.

```powershell
node --check apps/desktop/test/s7-subagent-native-smoke.mjs
node --check apps/desktop/test/s7-subagent-runtime-smoke.mjs
pnpm exec eslint apps/desktop/test/s7-subagent-native-smoke.mjs apps/desktop/test/s7-subagent-runtime-smoke.mjs
node target/followup-review-20261030/native-temp-root/allocation-probe.mjs
pnpm --filter @taki/desktop typecheck
git diff --check -- apps/desktop/test/s7-subagent-native-smoke.mjs apps/desktop/test/s7-subagent-runtime-smoke.mjs apps/desktop/test/index.md
```

- Syntax: both scripts PASS.
- Scoped ESLint: PASS.
- Desktop TypeCheck: PASS; this is the workspace static gate, not execution of the `.mjs` acceptance scenarios.
- Allocation probe: PASS. It reads and evaluates only each repaired script's exact `mkdtemp` expression, verifies an
  existing absolute direct child of the actual `tmpdir()`, checks location recording precedes the build, and confirms
  the same directory feeds `C2_FIXTURE_ROOT`/final evidence. Both empty probe directories are deliberately retained and
  listed in `allocation-probe.json`; it launches no native app, Core or model.
- Diff check and protected source/evidence parity: PASS.

The repaired harness source is frozen for the coordinator's native rerun. This repair establishes the JavaScript
allocation precondition and preserves the Rust guard; it does not claim WebView startup or native acceptance passed.
