# C2b relay runtime independent review — 01a180b6

Date: 2026-10-28. Root session: `01a180b6-1dac-7fc2-b365-15fcb34dd4b4`.
Recovered reviewer: `/root/relay_review_recovered`.

## Verdict and scope

**PASS_BOUNDED_TRANSPORT_DIAGNOSTIC.** The retained one-shot run
`9a276b18-7fa2-4421-869c-88f0d89aec01` proves the two declared transport cases,
network-none fixture observations and owned cleanup within the original total budget.
No blocking defect was found after independent raw-evidence recomputation.
The token is consumed and must never be rerun.

`deploymentReady=false`. Real installed Host lifecycle/artifact compatibility, Native API,
authentication, PostgreSQL lifecycle, trusted deployment lookup/receipt and positive managed setup
remain **OPEN**. This result does not close C2b, C1 platform criteria, the remaining C2a fault/daemon
cases, C3/C4/D2, D1 runtime acceptance or owner-only acceptance.

## Recovery and reviewed inputs

The previous IN_PROGRESS checkpoint was recovered after an upstream interruption; it had issued no
runtime verdict. A replacement checkpoint and the successful raw-recomputation checkpoint were
persisted before this final report. No new diagnostic was executed.

Read-only workspace verification found `H:/TakiAgent`, `refs/heads/main`, exact head
`e260ff4b0bf663b5faa0187bc6ec701fd2f007cd`, and an existing empty global task pointer.
Root's explicit sibling C2b assignment supplies this report's scope. The D1 coordination PRD,
original C2b PRD/context manifests, applicable custody/managed-deployment/quality contracts,
current preflight, topology delta, source review and all eight released scripts were read.
All **484 lines** of the C2b plan were read directly in three bounded chunks.

The accepted plan still hashes to
`0e4bdf03c903d6bbdca4d0bbfc187de14bb6c9fd8119b816bbfa7e69db0cd803`.
The topology delta still matches its release pin
`a16acd75b0e4201eed045967fca74944fc2431978536866706cb486c12d281c5`.
The original failed slice-1 result remains unchanged at
`14f0fdfcb1e486694163b6b8f42662726cc23697bfe6295593d2e941ebe8ed93`.

## Independent evidence reconstruction

The [read-only checker](c2b-relay-runtime-review-01a180b6/verify-retained.py) reads local
retained files and uses only Python's standard library. It neither imports packet code nor contacts
Docker, WSL, a listener or a service. Its [recomputed result](c2b-relay-runtime-review-01a180b6/verification.json)
retains file hashes, per-command indices/PIDs/exits/byte counts/timings, generated challenge hashes,
relay/server identities and the explicit acceptance limits.

All paths below are under
`c2b-relay-run-9a276b18-7fa2-4421-869c-88f0d89aec01/`, unless stated otherwise.
Command indices are the original zero-based `commands.json[].index` values.

| Input | Independently recomputed SHA-256 |
| --- | --- |
| Packet and archived `release.json` | `2d3f0c9ad86bcb5e5d956e9d4797edee4e1056b274958ae781b548b4d8cb954f` |
| `result.json` | `474a4d60d3f4b7a99757b82850dfa9738ab3ac054ee7beefe7ccd393678250c6` |
| `commands.json` | `3702362c4771c20d1b26c5d86b7e5d576547242964ceed0b0c4821d2c83b49d2` |
| `disposition.json` | `301e687132732e24de30a0e81ed63ff952867668a4433f9fc18513e7643cfb6c` |

All eight executable files match the external source release, the live packet, archived bytes and
`result.inputs`. The embedded release equals the actual release JSON. Every file named in
`disposition.hashes` was rehashed; the archive contains exactly those twelve files plus disposition.
The twelve archived staging files total **239,280 bytes**, and the marker contains exactly the token.
Root's process stdout decodes to the exact archived disposition, its release pin matches, its PID
matches `result.hostPid=31884`, and its exit is 0 with empty stderr. The stage is also absent on this
review's filesystem readback. No source, archive, old failure or task metadata was changed.

### Raw transfer and isolation proof

| Observation | Raw evidence and independently checked result |
| --- | --- |
| First stream | Command 8's base64 stdout decodes to exactly **49,152 bytes** and equals a freshly reconstructed `response` challenge. The independent SHA-256 is `96ea0e56ef19e5e30e59ade96a40478a0df79f425f6e57f18073a80467364d3e`. The generated **32,768-byte** request hashes to `ac469a51336bd2114ff73ecc3815f8b0baecadc8328dd6305b203bf5f8668d34`; client, command stdin, relay stderr events and fixture stdout agree. |
| Fragmentation and EOF | Client writes sum to 32,768; fixture response writes sum to 49,152. Relay raw events record eight 4,096-byte input reads and twelve 4,096-byte target reads, exact sent totals, stdin EOF, target write-half-close and target EOF. Client and Host close observations agree. The fixture's request-EOF and case-complete records come from command 5's raw stdout. |
| Second stream | Command 11's stdout is exactly the independently regenerated **512-byte** `abort-ack`, SHA-256 `c3f8be1b87730012febcac6106a26c2eceae900dce00f30b00416fa5b4d19df9`. Its **1,024-byte** request hashes to `5bd6f557cf6d45efbe0e88196ee893bc1353186d2369ec40e1f48d95fb3988e5`. Client issues reset without request half-close; Host records `client:ECONNRESET` and no normal client-end. |
| Abort propagation | Command 11's original relay receives stdin EOF, half-closes the fixed target, drains its acknowledgement, and exits 0. Fixture cancellation reason is `eof`. Both relay command records have `kills=[]`; no replacement or replay exists in the command list. This is the graceful propagation path after client reset. |
| Listener and fixture identity | The Host result records `127.0.0.1:58118` and the second bind's actual `EADDRINUSE`. Fixture PID 1/startTicks 14725 owns `socket:[15809]`; its raw /proc row is `0100007F:1F40`, LISTEN `0A`, UID 1000, matching `127.0.0.1:8000`. UID/GID are all 1000, capabilities all zero, and NoNewPrivs is 1. |
| Network observations | Raw interface inventory is only `lo`; IPv4 route data contains only its header. IPv6 has only ::1/128 and unreachable default rows on lo. All four fixed public/link-local IPv4/IPv6 probes report connect-phase **ENETUNREACH**. Their exact families/targets and route flags were checked rather than trusting `onlyLoopback` or `expectedRefusal`. |

Command 5's raw JSON lines equal the fixture-event projection; command 8/11 stderr JSON lines equal
the respective stream-event projections. Every retained stdout and stderr value in all 23 records
was independently decoded, counted and hashed, including expected absence errors. These joins
prevent a detached summary Boolean from substituting for the original command evidence.

### Commands, original identity and cleanup

The complete command inventory is **23**: 6 engine reads, 1 image read, 9 container inspections,
1 create, 1 attached start, 2 relay execs, 1 observer exec, 1 stop and 1 remove. Runtime indices are
0–14; cleanup indices are 15–22. Every record closes; exits are 0 except the expected absent-name/CID
inspections 2, 21 and 22, which exit 1 with the exact no-such-container message. There are no
timeouts, overflows, spawn/persistence/stream errors, signals or recorded CLI kills.

Every argv uses the pinned absolute Docker executable, fixed Engine pipe and the same marked
stage's empty client-config path. Create arguments exactly match the frozen restrictions;
start/stop/remove use only the original returned CID. Both exec source strings equal the archived
relay bytes and exact marker; the observer source equals its archived bytes. Attached stdin hashes
to the exact **9,329-byte fixture script**. Observer stdin is independently reconstructed from
the original server and two relay identities and matches its **115-byte** count and hash.

The original container is
`3b39336986d38734b83c1b5b3364295ae1b2678bdc98564ca492ada43deae844`.
Raw inspections 4/7/10/13/16/19 equal all six result projections and retain its exact image,
name, labels, interpreter, UID/GID, network-none, no mounts/publication, read-only root,
256 MiB/one CPU/16-PID limits, dropped capabilities, no-new-privileges, no logging and no restart.
The lifecycle is created -> four running observations -> exited. The same nonzero StartedAt
`2026-10-28T04:18:36.718075485Z` persists through the final stopped read.

Command 14's raw observation binds relay **PID 7/startTicks 14824** and **PID 13/startTicks 14925**.
Both initial and final /proc scans find their original PIDs absent, no marker matches, and only
two visible processes including observer PID 20. Original server PID 1/startTicks 14725 remains
non-zombie and unchanged. The observer does not signal or reap; the fixture's SIGCHLD handling and
normal relay exits precede this factual absence observation.

Command 17 stops the original CID. Its stdout contains Docker's non-fatal `--time` deprecation
notice followed by that CID; exit is 0. Command 5 then closes with the original server's one
`stopped` event, exit 0 and no stderr. Command 19 proves exited/PID 0/exit 0/no OOM.
Command 20 removes the original CID without force; 21 and 22 prove absence by both CID and name.
The retained Host port rebinding succeeds. This reviewer performed no live port probe.

Root's original workload preflight and post-readback raw inspect output were independently decoded:
all **eight** IDs, names, images, status/running flags and exact StartedAt/FinishedAt fields match,
including three running and five exited workloads. No runtime argv targets those IDs.
This is equality of the recorded workload lifecycle/identity fields, not a performance measurement.

### Timing and coverage limits

The Host's single monotonic timing reports **5,291.6904 ms** work and **2,515.7416 ms** cleanup,
with **7,807.4491 ms** before archive. Their sum differs by less than 0.02 ms of measurement
overhead. All command dispatch/close timestamps fall in the corresponding Host timeline;
the attached server legitimately overlaps subsequent commands until stop. The two relay CLI
lifetimes are **385 ms** and **377 ms**.

Disposition records **8,002.6917 ms** through archive verification and staging removal, before
the final disposition write. Root's process closes in **8,342 ms**, so the final write/return is
also inside the original 60-second budget. The 65-second outer watchdog was not the acceptance
budget. Docker guest StartedAt and Windows Host timestamps are separate clock domains; their
apparent ordering is not used to derive latency or reject original-identity equality.

Only one Host-to-child backpressure event occurred; Host-to-client backpressure stayed zero.
The run demonstrates complete bounded fragmented transfer, not saturation or production throughput.
The forced CLI-termination path was not exercised. Because both relays were absent on the
observer's first scan, the pidfd-open/wait path was also not exercised. No restart, unknown-create,
lost-cleanup-reply, sustained concurrent-client or installed-service lifecycle claim follows.

## Findings (fixed)

- File: this report and `c2b-relay-runtime-review-01a180b6/`.
- Issue: the interrupted review retained only an IN_PROGRESS checkpoint and unverified supplied claims.
- Fix: completed the independent raw reconstruction, persisted a reproducible read-only checker/result,
  and replaced the pending checkpoint with this bounded verdict and explicit unexercised branches.
- No packet/production defect or source fix was required. No production template, export, detection or
  `.trellis/spec/` synchronization is needed for this unchanged task-local diagnostic.

## Findings (not fixed)

None within this diagnostic's acceptance scope. The OPEN product gates and unexercised branches
above are retained limitations, not newly accepted functionality.

## Verification

- **Lint: PASS.** Scoped Ruff E/F/I checks for the added read-only evidence checker passed.
  The unchanged packet retains the independent source review's ESLint/Ruff PASS; every reviewed
  source pin was recomputed against the current packet and archive. No ignored-file result is counted.
- **TypeCheck: PASS.** Scoped ty for the added checker passed. Unchanged packet Python retains its
  independently reviewed Linux-target ty PASS. No TypeScript or full-package gate was rerun or claimed.
- **Tests/evidence: PASS within scope.** The independent checker exits 0 and proves the raw byte,
  hash, command, resource, timing and disposition joins described above. This is local evidence
  verification, not a new runtime execution. No package suite/build or D1 heavy-runner use occurred.
- The original source review and preserved source-check evidence remain authoritative for unchanged
  lint/type/syntax results; this runtime review adds actual retained-run reconstruction.

Reproduce only the read-only evidence verification from `H:/TakiAgent`:

```powershell
& 'G:/anaconda3/python.exe' -I -B .trellis/tasks/10-14-hindsight-managed-deployment/research/c2b-relay-runtime-review-01a180b6/verify-retained.py
& 'H:/hindsight/.venv/Scripts/ruff.exe' check --no-cache --select E,F,I --ignore E501 .trellis/tasks/10-14-hindsight-managed-deployment/research/c2b-relay-runtime-review-01a180b6/verify-retained.py
& 'H:/hindsight/.venv/Scripts/ty.exe' check --output-format concise .trellis/tasks/10-14-hindsight-managed-deployment/research/c2b-relay-runtime-review-01a180b6/verify-retained.py
```

**Ownership released to Root.** Only this report and its matching evidence directory were written.
The frozen packet/archive, prior failures, task/session metadata and all D1/other collaborators'
files remain untouched. No Docker/WSL/listener/launcher/runtime cleanup, dependency, model/data/key,
Git or agent-spawn operation was performed.
