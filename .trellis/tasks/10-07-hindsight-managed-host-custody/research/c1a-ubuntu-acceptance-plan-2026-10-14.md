# C1a Ubuntu platform acceptance plan — 2026-10-14

Status: **prepared, not executed or approved for environment changes**. Root owns
dispatch and acceptance updates. C1 source and C1b process evidence already permits
downstream C2 source work; this platform gate need not block that work. Do not repeat
the accepted eight Linux C1b tests.

Root's offline inventory today found Windows Node v24.18.0, Ubuntu DefaultUid 0,
and both WSL distros stopped. Ubuntu's VHDX is on C: (11,333,009,408 bytes), not G:;
reported free space is C: about 27.88 GB, H: 14.31 GB and G: 150.07 GB. This does
not establish the live PID1 or systemd feature set. The native fixture below must
use an already available /run tmpfs; no intentional VHDX staging is proposed.

## What is missing

AC2 lacks actual Ubuntu effective-UID, protected-path/identity and credential-source
evidence. AC6 lacks an enrolled release Host running under real systemd credentials.
Windows primitives/copied installation, Shared/Rust parity and missing-helper
compatibility are already accepted and should be reused.

Existing building blocks:

| Source | Reusable behavior / limitation |
| --- | --- |
| `apps/hindsight-host/scripts/build-linux-release.ts:17` | Existing locked Windows-side build creates Linux `payload/`, `launcher.mjs` and unit template; previous distribution was cleaned. |
| `packaging/launcher.mjs:82`, Shared installation schema:37 | Hardcode `taki-hindsight-host.service`; a differently named service is not equivalent. Launcher verifies the full installed tree before import. |
| `src/credential-source.ts:46` | Uses this start's `CREDENTIALS_DIRECTORY`, whose basename must equal that fixed service; checks UID, regular-file identity and private modes. |
| `src/enroll-node.ts`, `src/host-client.ts` | Existing create-only Node enrollment, token authentication, catalog publication, original-generation dispatch and no reconnect replay. |
| `src/authenticated-host.integration.test.ts:31` | Real Core WS/approval/broker/owner factories, but mocks preparation and installation; not an existing real-service acceptance runner. |
| `src/installed-files.test.ts`, `src/prepare-custody.test.ts` | Reuse scenarios; their injected read/key behavior is not new OS evidence. |
| `research/c1a-core-boot-smoke.mjs` | Accepted real-main/missing-helper proof; do not rerun it or overwrite its evidence. |

Paths without a prefix in this table are under `apps/hindsight-host/`, except the
Shared schema and task research path. No production fix is proposed.

## 1. First approval: bounded read-only preflight

Starting the existing Ubuntu distro requires separate approval from the completed
C1b run. The first dispatch only starts Ubuntu-22.04 and reads:

```text
wsl.exe -d Ubuntu-22.04 --exec /bin/cat /proc/1/comm
wsl.exe -d Ubuntu-22.04 --exec /usr/bin/id
wsl.exe -d Ubuntu-22.04 --exec /usr/bin/uname -m
wsl.exe -d Ubuntu-22.04 --exec /usr/bin/systemctl --version
wsl.exe -d Ubuntu-22.04 --exec /usr/bin/systemctl show taki-hindsight-host.service --property=LoadState,ActiveState,FragmentPath,UnitFileState
wsl.exe -d Ubuntu-22.04 --exec /usr/bin/systemd-creds --help
```

A small read-only shell probe may additionally resolve existing `node`,
`systemd-analyze` and `systemd-creds`; read available memory/`/run` filesystem/free
space; and check absence of the exact owned paths below. Read executable versions,
not arbitrary PATH-selected application code. No Node import, tests or service
start occurs in this phase.

**Stop** if PID1 is not a functioning systemd manager, the installed version lacks
`LoadCredentialEncrypted=`/`%d`/required unit hardening, the fixed unit already
exists in any loaded/on-disk/transient/alias form, or the approved native temporary
root cannot be protected. Ubuntu 22.04's label alone proves none of these features.
Record a missing capability as an environment blocker. Do not alter `wsl.conf`,
install/upgrade systemd, create another distro or substitute plain credentials.

Host-backed encryption also needs an already provisioned, explicitly usable
systemd host encryption facility. Do not read or export its key contents. Do not
run a command that would create/replace `/var/lib/systemd/credential.secret`.
If normal host encryption would require such provisioning, stop and return that
separate environment decision. No null-key, custom-key or mount-namespace workaround.

## 2. Fixture preparation scope, before a service dispatch

Root may separately assign **one test-only fixture**:
`apps/hindsight-host/test-fixtures/linux-service-acceptance.ts`, with a brief
invocation note in the Host README if needed. No source ownership is granted by
this document. Reuse the factories and assertions in
`authenticated-host.integration.test.ts`; substitute an external installed
`launcher.mjs serve` process for its in-process mocked Host. Do not mock
`openInstallation`, `prepareCustody`, `readCatalogKey`, file identity or UID.

The fixture supplies a bounded real Core WS/registry/broker/approval/Catalog owner,
not a new application server or installer framework. Core is the sole fake Catalog
writer. It listens on a fresh **127.0.0.1 ephemeral port**, records that port, and
has no model/provider/Native startup. The existing real canonical approval and
governance factories use private in-memory SQLite.

**Unproved dependency prerequisite:** the Windows pnpm tree is not established as
a runnable Linux dependency environment. The Host release builder copies its five
locked external packages and codec/Shared closure; it does not build Core or pino.
The Core fixture additionally needs its actual locked JS/TS import closure,
including pino and transitive packages, and Node's built-in `node:sqlite`
(`packages/core/src/db/sqlite.ts:7`). A direct Node fixture avoids Vitest/esbuild/
Rollup's platform binaries, but must prove source imports and workspace resolution.
Do not promise a Node-only download is sufficient.

After explicit fixture/environment dispatch, first perform a bounded import check
of exactly those factories with provider/network effects disabled. If the Windows
tree is not portable, record the exact missing closure and propose a bounded copy
of already locked pure-JS dependencies into owned staging. Do not run a whole
`pnpm install`, build native addons, extend the production Host builder or add a
new dependency to make the environment pass. Review the final fixture/closure
before the service phase.

## 3. Concrete environment envelope, conditional on passing the preflight

| Owned object | Exact location / limit |
| --- | --- |
| Windows staging | `G:/Temp/taki-c1a-ubuntu-20261014`, initially absent; **512 MiB total cap** for downloads, release and fixture staging. |
| Linux installed test copy | `/run/taki-c1a-ubuntu-20261014`, initially absent, root-owned 0700, marker `.c1a-owned-fixture = C1A_FAKE_ONLY`; **256 MiB total cap**. Require sufficient existing tmpfs capacity; no new mount or disk fallback. |
| Installed release | `.../payload/`, `.../launcher.mjs`, `.../node24/bin/node`; real copies, not links to G:/H:. |
| Registration / Core data | `.../installation.json`; `.../core-data/secret-catalog.bin` and identical registration at `.../core-data/hindsight-host/installation.json`. |
| Fake credential preparation | `.../private/fake-master-key.raw`, `.../private/node-enrollment.json`; 0600, generated for this run only. |
| Encrypted inputs | `.../encrypted/taki-secret-catalog-master-key`, `.../encrypted/taki-hindsight-host-node`; 0600. |
| Runtime-only unit | **`/run/systemd/system/taki-hindsight-host.service`**; exact name is a protocol requirement. No enablement or file in `/etc/systemd/system`. |
| Evidence | This task's new `research/c1a-ubuntu-check-20261014.{md,json}`; safe logs <=8 MiB before retention. |

Estimated native use: Node binary roughly 100–150 MiB, Host closure <=32 MiB,
bounded Core fixture dependencies <=64 MiB and fake state/logs <=8 MiB; these are
planning estimates, not measured artifacts. Measure actual sizes and reject totals
over the caps before copying. Do not change existing `/run` permissions. G:/DrvFS
is staging only: the installed verifier rejects writable/symlinked ancestors,
including ordinary mounted-drive arrangements and sticky `/tmp`.

Use Node **24**, exact version/path/digest registration. Preferred matching version
is **v24.18.0**, already recorded by the Windows acceptance; Linux availability
has not been checked. If no suitable existing protected Linux Node is available,
the proposed download is:

- `https://nodejs.org/dist/v24.18.0/node-v24.18.0-linux-x64.tar.xz`
- The same release's `SHASUMS256.txt`; verify the archive's exact entry before
  extraction, retain that manifest/hash, then hash the copied real `bin/node`.
- No `latest` selector, version-manager symlink, system PATH change or replacement
  runtime. Stop on missing artifact/digest, unsupported architecture, loader failure
  or oversized contents; refresh the concrete plan rather than select another version.

Build once on Windows using the existing locked environment, into the absent path:

```powershell
& 'C:/Program Files/nodejs/node.exe' apps/hindsight-host/scripts/build-linux-release.ts --output 'G:/Temp/taki-c1a-ubuntu-20261014/release' --architecture x64
```

This command itself is for the later authorized phase. Verify that executable's
Node 24 identity first; do not install Windows dependencies. The generated Linux
manifest, launcher and complete tree hashes must be preserved across copying.

Use the already observed root account **only if the new preflight confirms UID 0**:
Core fixture and Host both run as UID/GID 0, with no account creation. This is a
root-owner service fixture, not non-root deployment acceptance. A different actual
custody user requires a separately specified plan. Privileges required are creating
only these owned paths, loading/removing one runtime unit, starting/stopping it,
and using the existing approved systemd encrypted-credential facility.

## 4. Service execution sequence

1. Create only the marked owned root and protected children. Generate a fresh
   32-byte fake key with `generateCatalogKey()`; create the Catalog through
   `createSecretCatalogService`, `canCreate:false` key-source ownership, and
   `catalog.set(HINDSIGHT_SECRET_REFS.defaultModelApiKey, <fresh C1A_FAKE_ sentinel>)`.
   The prepared fake key file is test provisioning, not helper key creation.
   Registration uses new fixture UUIDs/store identity, actual UID, manifest/runtime
   hashes and the fixed systemd credential names. Never copy a real Catalog/key.

2. Start the bounded Core fixture and obtain its actual loopback URL. Run the
   existing protected launcher twice with clean environment and exact arguments:
   `enroll --registration /run/taki-c1a-ubuntu-20261014/installation.json
   --credential-output /run/taki-c1a-ubuntu-20261014/private/node-enrollment.json`.
   Supply bounded JSON `{coreUrl}` via stdin, then `{coreUrl,pairingCode}` using
   the actual Core-issued prompt captured only by this fixture. First call must
   not create the output/token; second must create one 0600 Node credential with
   the paired executionHostId. No direct device-store edits or token in argv/logs.

3. With the approved existing host encryption facility, use normal
   `systemd-creds encrypt --with-key=host --name=<fixed-credential-name> <owned-input> <owned-encrypted-output>`
   for each of the two named inputs. Verify plaintext read-back only inside the
   controlled fixture; never print it. Remove the owned plaintext enrollment file
   after successful provisioning. Keep the fake key only as long as the sole Core
   writer/negative checks need it. No system machine-key initialization is included.

4. Derive a runtime unit from the checked-in template. Substitute User/Group=root
   and only the owned absolute paths for WorkingDirectory, Node, launcher,
   registration and encrypted inputs. Preserve the existing security options,
   clean `env -i`, `CREDENTIALS_DIRECTORY=%d`, `--no-addons`,
   `--no-global-search-paths`, restart and control-group shutdown behavior.
   Validate with `systemd-analyze verify <owned-prepared-unit>`; treat unknown
   directives as failure. Copy to the previously absent runtime unit path,
   `systemctl daemon-reload`, then `systemctl start taki-hindsight-host.service`.
   Never enable the unit. Record its InvocationID/MainPID/start ticks and unit hash.

5. The fixture drives the matrix below over actual Core-to-service WS traffic.
   Observe manager-owned credential-directory metadata without dumping credentials.
   Read-only `inspect-installation` alone cannot satisfy a service/prepare criterion.
   One heavy slot, one serial matrix, bounded per-step waits and total run lifetime.
   Retain first failures before any scoped engineering correction.

| Minimum evidence | Required observation |
| --- | --- |
| Real enrolled service | Actual UID matches registration/Core; separate Node credential authenticates `role=node`; complete catalog appears on the real generation; normal prepare produces owner-validated evidence, `deploymentReady:false`. |
| Canonical permission | No operator => approval-required/no preparation; one actual allow-once approval resumes exactly the admitted operation. An operator-supplied result cannot mint evidence. |
| UID/path/identity | Wrong registered UID, own-file world write/symlink/hard-link and missing/tampered artifact refuse using real Linux files. Same-byte replacement of an opened/current installation or Catalog invalidates the original preparation. Reuse existing source race tests; do not invent timing-only race success. |
| Credential source | Missing/wrong-length/wrong-key fake master input and mismatched Node identity fail closed. Do not edit systemd's mounted credential files; vary only the owned provisioning inputs while stopped. Capture whether refusal occurred in systemd or the Host. |
| Restart/lifetime | Stop/restart the owned service, record a new InvocationID/PID and Host generation plus a freshly created manager credential directory. Old pending/accepted evidence is stale; no automatic request replay. Closing fixture operator/Home connection does not stop the service. |
| Confidentiality / sole writer | Catalog sealed hash unchanged by preparation; key/token/sentinel absent from argv, safe WS/status/journal and retained evidence. No provider/database/Native process starts. |

Negative fixture edits affect only this run's files. Restore their known baseline
before the next case. Do not change production constants, original files or service
permissions to satisfy a positive result.

## 5. Cleanup, stop conditions and acceptance accounting

Only after matching the recorded InvocationID/unit hash to this run:

```sh
systemctl stop taki-hindsight-host.service
systemctl show taki-hindsight-host.service --property=ActiveState,SubState,MainPID
```

Wait/reap the recorded Core fixture PID and owned descendants; require no remaining
service cgroup processes. Confirm systemd removed this unit's generated credential
directory. Remove only the runtime unit file created by the run, then
`systemctl daemon-reload` and `systemctl reset-failed taki-hindsight-host.service`
if that owned failure record exists. Recheck that the unit is absent. Do not remove
unknown drop-ins, persistent units, journals or manager key material.

Resolve `/run/taki-c1a-ubuntu-20261014`, require exact path/no redirected root and
the marker, then remove it entirely within Linux (`rm -rf -- <verified-exact-root>`).
Resolve G:/Temp/taki-c1a-ubuntu-20261014 separately in PowerShell, require the exact
approved child path/no redirected root, then use
`Remove-Item -LiteralPath <verified-exact-root> -Recurse -Force`. No cross-shell
deletion, wildcard deletion, distro termination, VHDX compaction or build-output
cleanup. Record path/process absence, preserved source/evidence, disk and WSL state.

Stop and clean owned resources on unknown existing paths/unit, unavailable systemd
features/encryption, unresolved Linux dependencies, cap violation, original-resource
access, unowned process uncertainty or any failed assertion. Report the concrete
gate; do not install services/stacks/dependencies outside this envelope.

A temporary runtime-loaded unit **can close the automatic Linux portions of AC2/6**
if this actual UID/credential/enrollment/owner-result matrix passes together with
the accepted source/Windows evidence. It cannot prove boot enablement, persistent
installation, non-root service policy, real keyring round-trips or final Windows
MSI/NSIS/manual acceptance. Root must preserve those limits when recording ACs.
A preflight failure or diagnostic-only run closes neither AC. C2 Docker/C3 real-model
readiness remains false regardless of this result.

Planning verification: inspected current requirements, accepted evidence, builders,
launcher/unit, registration/key/enrollment paths and existing tests. **No WSL,
service, download, build, test, installation or production edit was performed.**
