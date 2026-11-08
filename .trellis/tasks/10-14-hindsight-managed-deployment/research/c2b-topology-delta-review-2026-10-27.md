# C2b topology and installed-artifact delta review

Date: 2026-10-27. Independent advisor: `c2b_advisor`, GPT-6-Astra xhigh.
Root read the full 484-line accepted R2 plan and reconciled the advisor's findings with the retained
experiment. This review accepts a bounded next diagnostic and source-artifact direction only; no
new topology, API, PostgreSQL or deployment readiness has passed runtime acceptance.

## Original requirement

Preserve co-located authenticated loopback HTTP, exact original Host/container/Native ownership,
no inference or external/source egress for the fixed initial profile, existing V1 compatibility,
checked API/PG stop/restart, trusted original deployment lookup and definition-only managed setup.
Original data/credentials/models, new dependencies/privileges and shared-daemon/firewall changes remain excluded.

## Verified findings

The full R2 plan SHA-256 remains
`0e4bdf03c903d6bbdca4d0bbfc187de14bb6c9fd8119b816bbfa7e69db0cd803`.
The retained slice-1 result SHA-256 is
`14f0fdfcb1e486694163b6b8f42662726cc23697bfe6295593d2e941ebe8ed93`.
The advisor inspected all 25 command records and found embedded inventory output equal to `phaseA.output`.

- The installed package resolves at `/app/api/hindsight_api`; five template modules are missing and
  actual compatibility build is `batch0-v2`, not `template-backup-v1` (result lines 85, 374, 666).
- Both phases failed and cleanup is proven. The topology server accepted zero connections; the only
  Windows attempt returned `ECONNREFUSED`; both IPv4 connect probes reported connected.
- `run-slice1.ts:233-240` makes only one host connection immediately after child readiness.
  It does not observe live Windows listener readiness or `NetworkSettings.Ports`.
- The network had IPv6 enabled, but probes covered IPv4 only; `networkMatches` does not enforce
  the IPv6 state or exact option set (`result.json:925`, `run-slice1.ts:255`).
- Python exit 0 means evidence collection completed; TypeScript correctly rejected the semantic
  result. A future isolation check must also reject arbitrary probe errors rather than treating
  every non-connected result as successful isolation.

## Hypotheses and limits

1. Masquerade-off does not establish an egress deny policy. Official Docker documentation defines it
   as source NAT control. Recorded connects prevent acceptance; their actual remote destination is unknown.
2. Windows publication may have been absent or not ready for the single attempt. A fixed readiness
   deadline with live listener/publication facts would distinguish these causes.
3. Millisecond TCP connects may have been accepted by a local networking/proxy component; no authenticated
   application exchange identified a remote peer. This is plausible, not proven.
4. Untested IPv6/gateway paths would remain an evidence gap even if sampled IPv4 attempts failed.

The previous leader's universal explanation that internal-network publication cannot work is not
established for this exact installation. The selected next diagnostic does not rely on that explanation.

## Selected direction and alternatives

Use `--network none` and an exclusive Host-owned loopback listener with a fixed no-TTY
`docker exec -i` stream relay into the exact original container's `127.0.0.1:8000`.
Docker documents only loopback for the none driver. This requires no custom network, published Docker
port, sidecar, NET_ADMIN, firewall tools or shared backend change.

The cost is a real installed Host lifecycle: bounded connections/children, backpressure, half-close,
cancellation, reaping and withdrawal of endpoint usability. Its source/runtime proof is still required.
The identity chain replaces Docker publication with Host listener identity -> original container-bound
relay -> original Native API PID/start/listener. Core still authenticates and matches the Native manifest.
Relay loss never retries a mutation or silently substitutes a container/startup.

Namespace-local egress fencing on a non-internal bridge needs unproven firewall/tool/privilege support
and dual-stack rules. A dual-network sidecar adds another image/resource/trust boundary without a clear
benefit for this co-located profile. Masquerade-off alone, host networking and shared firewall changes
do not satisfy this requirement.

## Bounded diagnostic contract

Root will freeze a new UUID, script/CLI/image hashes, one fixed host port (58118 if free), an exact marked
G: staging root and a fresh empty Docker client-config directory before execution. No consumed token is reused.

- One container from the existing pinned base `sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db`.
- No build/pull, volume/mount, custom network or Docker publication. UID/GID1000, read-only root,
  network none, log none, 256MiB, one CPU, 16 PIDs, all capabilities dropped, no-new-privileges.
- One stdlib-only fixture server via the pinned interpreter `-I -B -`, no Hindsight/SQL/model import.
  Record PID/start identity, exact listener, interfaces/routes and expected refusal classes for IPv4/IPv6.
- Host holds an exclusive `127.0.0.1:58118` listener. For each of at most two streams, fixed Docker exec
  starts the pinned interpreter with frozen nonsecret `-c` relay source and only target127.0.0.1:8000.
  No caller-selected destination, shell, command, environment or TTY.
- At most two relay children, 64KiB each direction, ten-second readiness and sixty-second overall bound.
  Prove fragmented bidirectional transfer/half-close and a separate client-abort/child-exit case.
- Stop accepting; drain/reap exact relay children; stop/reinspect/remove only the original owned container;
  verify container absence and Host port release. Preserve result/scripts/hashes before exact marked staging cleanup.
- Resource mismatches, missing evidence, unexpected error classes or incomplete cleanup fail. Transport PASS
  does not imply real API/authentication/PG/receipt/setup acceptance.

The concrete runner receives a separate source review before Root runs it. Existing project-owned isolated
fixture authorization and the current continuation cover these unchanged trust/effect boundaries.

## Installed-artifact correction

Derive from the pinned base with no network or pulls; preserve its locked environment. Do not use the full
standalone Dockerfile, which installs dependencies and downloads tokenizer assets (Native Dockerfile165,201).
Freeze the complete current working-tree application package, Python/package data/migrations, bootstrap
and metadata/lock hashes, including untracked Stage5 files. A HEAD archive or five-module patch is incomplete.

Replace only the application tree inside the new image at its proven import location; prevent deleted source
files surviving a merging COPY. Preserve the base virtual environment. Copy the verified cl100k_base cache
from `/tmp/data-gym-cache` into immutable image storage outside later volume/tmpfs mounts, pinning SHA-256
`223921b76ee99bde995b7ff738513eef100fb51d18c93597a113bcffe865b2a7`.

The resulting image needs actual installed-tree/migration/dependency/profile/cache/PG re-inventory and
wrong-build/missing/corrupt-cache refusal before API import, SQL or listen. Nine sampled distributions are
not complete dependency compatibility. Minimal real API/PG lifecycle still gates trusted lookup/setup.

## Official sources and actual review scope

- https://docs.docker.com/engine/network/drivers/none/
- https://docs.docker.com/desktop/features/networking/
- https://docs.docker.com/engine/network/port-publishing/
- https://docs.docker.com/reference/cli/docker/network/create/#internal
- https://docs.docker.com/reference/cli/docker/container/exec/

The advisor made no changes, spawned no agents, ran no tests and caused no runtime effects; ownership is
released. Root observed the Engine pipe absent and has not started Docker in this continuation. Runtime
feasibility/performance, installed dependency compatibility and real API/PG producer acceptance remain open.
