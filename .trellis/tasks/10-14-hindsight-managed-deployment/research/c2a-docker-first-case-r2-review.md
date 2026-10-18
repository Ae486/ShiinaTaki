# C2a first Docker case: targeted second-attempt correction

**PASS for the R2 static correction.** Actual Docker execution and cleanup remain Root-owned.
This review did not run Docker, WSL, apps, binary builds or behavior tests.

## Findings (fixed)

- **R2-F1 / P2 — run-first-case.ts:** boot omitted the debug Shell's required
  TAKI_GATE_AUTOAPPROVE setting. apps/desktop/src-tauri/src/bin/taki-node.rs:57 requires it;
  apps/hindsight-host/test-fixtures/deployment-installed-fixture.ts:55 supplies allow-once.
  The task launcher now supplies the same value only to its isolated Shell child.
  Real Rust Gate/Core admission and all production source remain unchanged.
- Root's minimized binary probe already established exit 2 and the missing-setting message.
  This reviewer read the exact source references and did not repeat that probe.
- Both mutable files now use fresh fixture token 8378a950-87c8-44e3-a909-d213a284f113.
  It remains an operator request key, never a chosen Core deployment Run ID; old markers/resources
  are not reused or reset.

## Findings (not fixed)

None within this correction. The actual second attempt is still to be executed by Root.

## Verification

- Syntax: PASS; scoped --no-ignore ESLint: PASS; single-entry no-emit TypeCheck: PASS, zero diagnostics.
- [Exact commands, before/after hashes and preserved evidence](c2a-docker-first-case-r2-review.json).
- preparation-check.json and the first static review/report hashes remain unchanged.
  Accepted production source, the 182-case evidence and first-attempt readback were not edited or rerun.

| Changed file | Before SHA-256 | After SHA-256 |
| --- | --- | --- |
| run-first-case.ts | 532f800475d8ed9bf14809865e247c805ac8e81dc3109c88b196e04d6bad013e | 8aa4bd9d91ccb884fec2488d5ba55d3c22d2d88a46fd719c44ce827ec9342e94 |
| README.md | a3ada14fe6cb928924b99936a63820a11af96dc3327f16ca0888c4f6d87ca92c | 06b9c97a1c9302e52354d8d60f7c0bc760eca67b46029a0b6f37afb4ef9b9c8b |

README now directs reuse of Root's successful unchanged base-probe evidence (Python 3.11.16,
dotenv 1.2.2, UID/GID 1000, empty seed), with original evidence path/hash retained. Root must
recheck the same pinned base/engine before one new local-only build and use fresh marked roots.
Unrelated resources stay unchanged; the already-absent gpt-load must not be restored.
Owned fixture files, this review/evidence and the check slot are released to Root.

