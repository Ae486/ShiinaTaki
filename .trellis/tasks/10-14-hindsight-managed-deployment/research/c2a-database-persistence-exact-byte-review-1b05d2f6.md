# C2a database persistence: independent exact-byte review

Recorded: 2026-10-18T12:05:23.587Z. Reviewer: /root. Case: `1b05d2f6-494c-4a6d-a601-1e807eca1486`.

**Phase A: FAIL. Phase B: NOT STARTED.**

## Blocking finding A3-INVALID-ENGINE-TIME

At [run-persistence.ts:120](docker-database/run-persistence.ts#L120), the regular expression checks numeric shape, while `Number.isFinite(Date.parse(value))` permits normalization of invalid dates and hour 24. Using the pinned Node v24.18.0 and the helper extracted from the hash-verified source, the following inputs returned unchanged instead of throwing:

| Mock Engine SystemTime | Actual helper result | Date.parse normalization |
| --- | --- | --- |
| `2026-02-30T00:00:00Z` | returned `2026-02-30T00:00:00Z` | `2026-03-02T00:00:00.000Z` |
| `2026-02-29T00:00:00Z` | returned `2026-02-29T00:00:00Z` | `2026-03-01T00:00:00.000Z` |
| `2026-10-18T24:00:00Z` | returned `2026-10-18T24:00:00Z` | `2026-10-19T00:00:00.000Z` |

All three violate the explicit requirement that malformed Engine time must throw. They can reach both event-query bounds. This is an isolated validator reproduction, not a live Engine observation or a second failed persistence execution. Validate calendar/time ranges without normalization, preserve the original nanosecond string, and repeat byte review on newly pinned inputs. No fix was made to the frozen fixtures.

## Other Phase A results

| Check | Result |
| --- | --- |
| Three submitted SHA-256 pins | PASS |
| CASE substitution | PASS: exactly launcher line 32, reader line 18, child line 23; one new token and zero stale tokens per file |
| Pre-substitution reconstruction | PASS: all three reconstructed hashes match the recorded pins; both Python files also equal the prior archived bytes |
| Engine-clock patch scope | PASS: reverse only the helper/report additions and two clock expressions after CASE normalization; complete result equals archived launcher, SHA-256 `951de1587a37a0dba96fbf76bf029943128c9e80fc7ea1aa5dfe888fff470d25` |
| Existing assertions, budgets, retries and failure codes | Unchanged, proven by complete-byte reconstruction |
| Query clock domains | PASS: Engine-derived since at line 605; Engine-derived until at line 336 shared by container line 338 and volume line 367; no host-clock fallback |
| RFC3339Nano precision | PASS for valid inputs: original nine digits and offset retained; only outer whitespace trimmed |
| Malformed timestamp rejection | **FAIL**, three reproduced counterexamples above |
| Native inputs | PASS: Dockerfile plus all eleven upstream modules match original nativeContext pins |
| Accepted source manifest | PASS: unchanged `f27379be3b4b5e61e1b2821c2eda2d87bf54e5c2983b034bdb637ee789961ae2`; 109/109 live source pins match |
| Expected context | PASS in memory: twelve entries; only fake_child replaced; digest `a20096ec28ce8181ba0b1e52375a99701abae7fafa5c40234607d773ca015a54`; no staging created |
| Case identity | PASS: launcher/reader/child, SQL row/report identity, S/W/tag derivations and label checks use the new CASE |

- `run-persistence.ts`: 56090 bytes; SHA-256 `b3736ef4cd510023434ea8f0864296f2970fec02892543af370a324595ec6f76`; CASE-normalized SHA-256 `c35ccae8cd1253845e06e9e37fd5a339b4d79a629da967fc5dd6f10b0ce68d53`.
- `database-read.py`: 6084 bytes; SHA-256 `4bd830c60a4ddecc4e8e7018d2b19eb08093c81fc5d7f3ee0a8ff380178e4271`; CASE-normalized SHA-256 `0ad82eb436c9c4389852c07ddb7c28eed6e9b5cd59740fb71c1ebb42db243419`.
- `fake_child.py`: 44233 bytes; SHA-256 `9d65b8875e5d798a024dff9b4a182d6cff7bf4b62646954e38cd0c2e12ce3819`; CASE-normalized SHA-256 `427bc9e824e4a1dacadf29acca4d0e57faed1800a41972eb4c7797fc5b974800`.

The frozen Stage 3 README's old-token examples were interpreted with the user's explicit new T substitution; its bytes were not changed. Source references and full native/context/source hashes are in the [JSON evidence](c2a-database-persistence-exact-byte-review-1b05d2f6.json).

## Execution and preservation

No Docker command, build, launcher invocation, staging/root creation, resource cleanup, Git write, daemon action, or unrelated-container operation occurred. Phase B remains gated by FAIL. There is no image ID, launcher JSON, new casePassed, event/submit/exec/finalStop result, live clock comparison, seven-container comparison, or free-space delta; these are unmeasured, not zero or successful.

The prior failure directory was read only: 60 files were inventoried and hashed (inventory digest `21c84dda4748957ce70e89eee685f2312c267eb681e78aa47a1e61807695e124`). Existing evidence was preserved. Only this report, its JSON, and the two permitted self-check records were written. Prior self-check and permission observations remain historical; this review's execution gate is A3-INVALID-ENGINE-TIME.
