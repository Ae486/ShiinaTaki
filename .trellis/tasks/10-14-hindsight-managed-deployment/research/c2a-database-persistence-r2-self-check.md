# C2a database persistence R2 self-check

> Latest independent exact-byte review (2026-10-18T12:05:23.587Z): **Phase A FAIL; Phase B NOT STARTED**.
> `engineTime()` accepts invalid calendar dates/hour 24 instead of throwing.
> See [review](c2a-database-persistence-exact-byte-review-1b05d2f6.md) and [reproduction evidence](c2a-database-persistence-exact-byte-review-1b05d2f6.json).
> The source bytes remain frozen; no Docker/build/launcher execution occurred. Earlier results below are historical.

Date: 2026-10-18. Implementer: `/root`.

**Engine-clock source repair: static checks and independent source byte review PASS.
Fresh R2 build/run: NOT RUN (Root owns preparation, build and execution).**
There is no new launcher JSON or `persistence.json`; runtime acceptance is not established.
Public `deploymentReady` remains false.

## Exact change

Only `docker-database/run-persistence.ts` and these two self-check files were edited.

- Add `engineTime()` using the registered `dockerExchange` with
  `info --format {{.SystemTime}}`, the existing total budget capped at 10 seconds, and 4096 bytes.
- Trim and require a complete RFC3339Nano/ISO timestamp shape and parseability. Return the
  original timestamp with its fractional precision and offset unchanged. There is no host-clock
  fallback, time margin, retry, new failure code, dependency or helper module.
- Read `since` once at the beginning of `persistenceCase`; read `until` once per
  `inspectExecs`. Container and volume events share the same `until`.
- Record `report.engineClock = { first, last }` before event assertions.
- Leave the consumed CASE literal, all existing assertions/counts, SQL readiness and other
  deadlines, exec metadata checks, cleanup, Python files, README and production sources unchanged.

## Source byte binding and checks

The unchanged engine-clock description and diff record the preceding repair. Current CASE
substitution pins and bindings are recorded below; historical failure evidence is preserved.

| Item | Result |
| --- | --- |
| Before launcher | 55,442 bytes; SHA-256 `951de1587a37a0dba96fbf76bf029943128c9e80fc7ea1aa5dfe888fff470d25` |
| After engine-clock repair, before CASE substitution | 56,090 bytes; SHA-256 `c35ccae8cd1253845e06e9e37fd5a339b4d79a629da967fc5dd6f10b0ce68d53` |
| Current launcher after CASE substitution | 56,090 bytes; SHA-256 `b3736ef4cd510023434ea8f0864296f2970fec02892543af370a324595ec6f76` |
| Scope proof | Normalize current CASE to the old token, then remove the added helper/report lines and reverse both window replacements to reproduce the original SHA-256. |
| Node syntax | PASS; no syntax diagnostic. |
| Scoped ESLint | PASS, exit 0, no output. |
| Single-entry TypeScript noEmit | PASS, exit 0, zero diagnostics; no build output. |
| Encoding | UTF-8 without BOM, CRLF or trailing whitespace. |
| Independent source byte review | Preserved pre-token PASS by `/root/engine_clock_byte_review` at `c35ccae8cd1253845e06e9e37fd5a339b4d79a629da967fc5dd6f10b0ce68d53`; Root reviews fresh execution inputs. |
| Protected task files | Both Python files match their prior bytes after CASE normalization; `probe-runtime.py`, `first-start.py` and README remain byte-identical. |
| Production transport | `apps/hindsight-host/src/docker-process.ts` hash is unchanged. |

These are source checks, not a replacement for the requested real R2 run. No extra test file
or simulated runtime result was introduced. Commands, actual outputs, hashes and the previous
self-check are retained in the [JSON record](c2a-database-persistence-r2-self-check.json).

## Complete launcher diff

```diff
--- before/run-persistence.ts
+++ after/run-persistence.ts
@@ -110,6 +110,17 @@
   } catch { entry.outcome = "failed-or-unknown"; throw new Error("DOCKER_EXCHANGE_FAILED"); }
   finally { entry.elapsedMs = Date.now() - before; }
 }
+async function engineTime(): Promise<string> {
+  requireFact(fixture);
+  const value = (await dockerExchange(fixture.deploymentRegistration, {
+    argv: ["info", "--format", "{{.SystemTime}}"],
+    signal: AbortSignal.timeout(budget(10_000)), maxBytes: 4096,
+  })).toString("utf8").trim();
+  // Preserve Engine RFC3339Nano precision; the Windows clock can exclude completed Engine events.
+  requireFact(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
+    && Number.isFinite(Date.parse(value)));
+  return value;
+}
 function command(path: string, args: string[], cwd = ROOT) {
   const result = spawnSync(path, args, { windowsHide: true, encoding: "utf8", timeout: budget(15_000), maxBuffer: 32 * 1024,
     env: { SystemRoot: process.env.SystemRoot }, cwd });
@@ -322,7 +333,8 @@
 }
 async function inspectExecs(original: OwnedDeploymentRecord, since: string, restarted: boolean) {
   requireFact(original.containerId && original.volume);
-  const until = new Date().toISOString();
+  const until = await engineTime();
+  report.engineClock = { first: since, last: until };
   const events = await docker(["events", "--since", since, "--until", until, "--filter", `container=${original.containerId}`, "--format", "{{json .}}"]);
   scan(`container-events-${restarted}`, events);
   const rows = events.toString("utf8").trim().split("\n").filter(Boolean).map((line) => json(line));
@@ -590,7 +602,8 @@
   return second;
 }
 async function persistenceCase(generation: Generation) {
-  capacity(); const since = new Date().toISOString();
+  capacity(); const since = await engineTime();
+  report.engineClock = { first: since, last: since };
   const status = await startWithPreInjectionObservation();
   stage = "initial-resource-contract";
   const original = ownedRegistry();
```

## Real execution status and blockers

Direct command actually attempted:

```powershell
& 'C:/Program Files/Docker/Docker/resources/bin/docker.exe' -H npipe:////./pipe/dockerDesktopLinuxEngine version --format '{{json .}}'
```

Actual client version was `29.0.1`, Server was `null`, and the command exited 1 with:

```text
permission denied while trying to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine
```

Earlier Node child-process preflight attempts for `version` and `ps -a` returned `EPERM`
without a process exit status. No alternate Docker endpoint or privilege escalation was used.

The configured writable workspace is `H:/TakiAgent`; G: staging and the protected C: runtime
root are not writable under this session's policy, and approval policy is `never`.
No out-of-workspace write was attempted.

## CASE substitution and fresh bindings

On 2026-10-18 the owner approved CASE UUID literal substitution only, following
`c2a-database-persistence-plan.md:65-69`. The former source-scope conflict is resolved.
Token: `13f04d85-ee84-408e-890c-88922e36c69e` -> `1b05d2f6-494c-4a6d-a601-1e807eca1486` (random UUID v4).

| File under research/ | Bytes | Before SHA-256 | After SHA-256 | Only changed line |
| --- | ---: | --- | --- | ---: |
| `docker-database/run-persistence.ts` | 56090 | `c35ccae8cd1253845e06e9e37fd5a339b4d79a629da967fc5dd6f10b0ce68d53` | `b3736ef4cd510023434ea8f0864296f2970fec02892543af370a324595ec6f76` | 32 |
| `docker-database/database-read.py` | 6084 | `0ad82eb436c9c4389852c07ddb7c28eed6e9b5cd59740fb71c1ebb42db243419` | `4bd830c60a4ddecc4e8e7018d2b19eb08093c81fc5d7f3ee0a8ff380178e4271` | 18 |
| `docker-database/fake_child.py` | 44233 | `427bc9e824e4a1dacadf29acca4d0e57faed1800a41972eb4c7797fc5b974800` | `9d65b8875e5d798a024dff9b4a182d6cff7bf4b62646954e38cd0c2e12ce3819` | 23 |

For each source, replacing the new CASE with the old CASE reconstructs its pre-substitution
SHA-256. Each diff contains exactly one changed line; copies normalized only at the CASE
line are byte-identical. Both Python files passed `ast.parse` and AST `compile` without
execution. No other source byte changed, including the engine-clock fix.

```diff
--- before/docker-database/run-persistence.ts
+++ after/docker-database/run-persistence.ts
@@ -32 +32 @@
-const CASE = "13f04d85-ee84-408e-890c-88922e36c69e";
+const CASE = "1b05d2f6-494c-4a6d-a601-1e807eca1486";
--- before/docker-database/database-read.py
+++ after/docker-database/database-read.py
@@ -18 +18 @@
-CASE = "13f04d85-ee84-408e-890c-88922e36c69e"
+CASE = "1b05d2f6-494c-4a6d-a601-1e807eca1486"
--- before/docker-database/fake_child.py
+++ after/docker-database/fake_child.py
@@ -23 +23 @@
-CASE = "13f04d85-ee84-408e-890c-88922e36c69e"
+CASE = "1b05d2f6-494c-4a6d-a601-1e807eca1486"
```

| Binding | Fresh value |
| --- | --- |
| T | `1b05d2f6-494c-4a6d-a601-1e807eca1486` |
| S | `G:/TakiAgent-c2a-database/persistence-1b05d2f6-494c-4a6d-a601-1e807eca1486` |
| W | `C:/taki-c2a-db-persistence-1b05d2f6-494c-4a6d-a601-1e807eca1486` |
| Image tag | `taki-c2a-db:1b05d2f6-494c-4a6d-a601-1e807eca1486` |
| Image label | `taki.c2a.fixture=1b05d2f6-494c-4a6d-a601-1e807eca1486` |
| Run fence | `G:/TakiAgent-c2a-database/persistence-1b05d2f6-494c-4a6d-a601-1e807eca1486/persistence.started` |

These are reserved bindings only. No staging, protected root, image, container or volume was
allocated, and the token was not consumed. Root owns independent review, preparation, build
and execution. The README and implementation source manifest were not edited.

### Expected staged context pins

This is an in-memory expectation for the recipe plus eleven Python modules, not a staged
directory or image digest. All twelve upstream inputs match the accepted `nativeContext`
pins in `c2a-database-persistence-self-check.json`. Only expected staged `fake_child.py`
uses the updated task copy; the recipe and other ten modules retain their upstream bytes.

| Expected path under S/context/ | Bytes | SHA-256 |
| --- | ---: | --- |
| `docker/standalone/Dockerfile.c2a-fake` | 555 | `2be1279ef4621f5d42397879fab2e436d780224eb3c02d591180faf9e9a9fcff` |
| `docker/standalone/managed_bootstrap/__init__.py` | 80 | `cbf487cffc9c62b5c6fe61f32d80070b5843f70f966c5fca163c675e21ddbf1d` |
| `docker/standalone/managed_bootstrap/bootstrap.py` | 6323 | `b8331bd8c9645d265578ed65f9f77402f170813f20d1d2683b5aa0a7d0768101` |
| `docker/standalone/managed_bootstrap/control.py` | 5593 | `c75dcdf2285df614c4836dab4898a2980a2a1e8e4572862861596ab244f39d5e` |
| `docker/standalone/managed_bootstrap/fake_child.py` | 44233 | `9d65b8875e5d798a024dff9b4a182d6cff7bf4b62646954e38cd0c2e12ce3819` |
| `docker/standalone/managed_bootstrap/fake_consumer.py` | 4302 | `52b3d0664b06ef82dca4765d2c08e820c16c2af5e2814a02f98fe08f8e220eb3` |
| `docker/standalone/managed_bootstrap/owner.py` | 2460 | `5b10f9f09def8ff985c96fed56c31f4ec4976f684d7e3b044fdc8a66afb38acc` |
| `docker/standalone/managed_bootstrap/owner_protocol.py` | 3199 | `cd9cdbea572354dbbc1200098d9edfe9280679c2b346a67c1326a795b01c1804` |
| `docker/standalone/managed_bootstrap/protocol.py` | 13320 | `074247650a31cfc47a1931ef6c7b258aa6f1d3a649bbb792ff2878257f6f8b88` |
| `docker/standalone/managed_bootstrap/submitter.py` | 4913 | `5a6ad60266066d1cff2559d46c6b2b15d4a93cf882de1e487790ad0fb6863c4a` |
| `docker/standalone/managed_bootstrap/supervision.py` | 4552 | `ff768434e0cef9eb2b6996351ba31e1dedede95211809d2ab8e8d09b5d9a5064` |
| `docker/standalone/managed_bootstrap/unix_socket.py` | 9434 | `08b6e604211d19e31ad61782c96b91a004277b37c31d6e9a0bdfdda681cd7725` |

Expectation digest before CASE substitution:
`8f616c05462d0c3a047c9c5f80b4fd3c717f42401d2f9a4626c619a0eb735ec8`.

Expectation digest after CASE substitution:
`a20096ec28ce8181ba0b1e52375a99701abae7fafa5c40234607d773ca015a54`.

Digest encoding: UTF-8 `JSON.stringify([{path,bytes,sha256},...])`, sorted by path,
followed by one LF. Detailed source-to-staged mappings are in the JSON record.

The 109-file `c2a-implementation-source-manifest.json` remains unchanged at SHA-256
`f27379be3b4b5e61e1b2821c2eda2d87bf54e5c2983b034bdb637ee789961ae2`. It pins upstream
`H:/hindsight/docker/standalone/managed_bootstrap/fake_child.py`, not these task copies.

### Static checks for the fresh byte pins

| Check | Actual result |
| --- | --- |
| Single-entry TypeScript noEmit | Exit 0; zero diagnostics; no emitted files. |
| Scoped ESLint on launcher | Exit 0; no output. |
| Python AST parse/compile and CASE-normalized comparison | Exit 0; both Python files PASS; no execution or bytecode output. |
| Expected context pin comparison | Exit 0; all upstream pins match; no staging allocated. |

Exact commands and raw outputs are preserved at `caseBinding.staticChecks` in the
[JSON record](c2a-database-persistence-r2-self-check.json). The previous checks and independent
engine-clock review remain unchanged; Root must bind any future execution review to these
fresh input hashes.

| Required runtime evidence | Current result |
| --- | --- |
| Fresh image build / launcher invocation | 0 / 0 |
| Launcher JSON and new persistence.json | Absent; no new case result |
| Actual Engine readback versus Windows time | Unavailable |
| create/start/stop/die counts | Not measured |
| submit count and exec metadata | Not measured |
| finalStop validation | Not measured |
| New first-stop/final-stop/commands/stdout/stderr artifacts | None |

The previous failed R2 evidence remains unchanged. Its Windows `until=12:49:43.662Z`
excluded Engine stop/die at approximately `12:49:45.672Z` and `12:49:45.686Z`.
That accepted diagnosis supports this source change but does not validate a repaired run.

## Cleanup and free space

No case container, volume, image tag, staging tree or protected root was created in this turn;
there is nothing newly owned to remove. No existing-container mutation command or Git write
command was issued. Live verification of the seven original container IDs remains unavailable
because the Docker connection was denied.

Whole-drive free-space observations during source work (bytes):

| Drive | Before | After | After minus before |
| --- | ---: | ---: | ---: |
| C:/ | 25830313984 | 25603174400 | -227139584 |
| G:/ | 138497101824 | 138497097728 | -4096 |
| H:/ | 2376122368 | 2377842688 | 1720320 |

After sample: `2026-10-18T11:43:30.627Z`. These are observed whole-drive changes; with no case
build/run, they cannot be reported as case disk consumption or reclamation.

## Remaining gate

Root owns independent review and all preparation/build/execution for fresh token
`1b05d2f6-494c-4a6d-a601-1e807eca1486`. This pass performed only CASE substitution and static checks;
no Docker command, build or staging allocation occurred. The consumed old token
`13f04d85-ee84-408e-890c-88922e36c69e` must not be reused. Root resolves execution permissions before its run.

The JSON's `historicalSelfCheck` and `historicalMarkdown` preserve the earlier 2026-10-15
pre-run self-check. Their former NOT_RUN/reserved-token wording is historical, not current.

## Review round 1 fix

Recorded: 2026-10-18T12:09:43.471Z. Case: `1b05d2f6-494c-4a6d-a601-1e807eca1486`.

Fixed `A3-INVALID-ENGINE-TIME` from the
[round 1 review](c2a-database-persistence-exact-byte-review-1b05d2f6.md).
Only the `engineTime()` validation block changed: UTC `Z` shape plus exact calendar/time
field round-trip. The original nanosecond string and existing comment remain unchanged.
The six numeric captures use a type-only tuple assertion for `noUncheckedIndexedAccess`.
No host-clock fallback, margin or retry was added.

| Launcher pin | Bytes | SHA-256 |
| --- | ---: | --- |
| Before this fix | 56090 | `b3736ef4cd510023434ea8f0864296f2970fec02892543af370a324595ec6f76` |
| After this fix | 56502 | `c39fd6e465f922cefd198abe1e6d531d731359f8969b183ae9b5b4d2cf06ee27` |

Node v24.18.0 ran the literal regex/UTC round-trip logic without extracting or
executing the launcher/helper. Results:

| Input | Actual result |
| --- | --- |
| `2026-10-15T12:49:45.123456789Z` | ACCEPTED, returned unchanged |
| `2026-10-15T12:49:45Z` | ACCEPTED, returned unchanged |
| `2026-02-30T00:00:00Z` | REJECTED |
| `2026-13-01T00:00:00Z` | REJECTED |
| `2026-10-15T24:00:00Z` | REJECTED |
| `2026-10-15T12:49:45.123456789+08:00` | REJECTED |
| `not-a-time` | REJECTED |

All seven expectations passed (exit 0). Scoped ESLint passed with no output (exit 0);
the same single-entry TypeScript `noEmit` check passed with zero diagnostics (exit 0).
Reversing only this validation block reproduced the exact pre-fix launcher hash.
Commands and raw outputs are appended under `reviewRound1Fix` in the JSON report.

Prior report content and the independent Phase A FAIL evidence are preserved.
This is a local fix record, not a new independent PASS: Root/reviewer owns the fresh review
and Phase B. No Docker command, build, launcher invocation or staging access occurred.
