# C1a Ubuntu read-only preflight — 2026-10-14

## Result: BLOCKED — required platform prerequisite

The owner-approved phase 1 started the existing Ubuntu-22.04 distro and executed
three read-only Linux commands. PID1 is systemd, but the required
`/usr/bin/systemd-creds` entrypoint does not exist. The approved encrypted-credential
procedure therefore cannot continue in this environment. Investigation stopped
at that prerequisite; no installer, upgrade or alternative credential mechanism
was attempted.

| Command (all under `wsl.exe -d Ubuntu-22.04 --exec`) | Exit | Observed result |
| --- | --- | --- |
| `/bin/cat /proc/1/comm` | 0 | `systemd` |
| `/usr/bin/systemctl --version` | 0 | `systemd 249 (249.11-0ubuntu3.22)` |
| `/usr/bin/systemd-creds --help` | 1 | `execvpe(/usr/bin/systemd-creds) failed: No such file or directory` |

The version and required-path absence are actual command results. No independent
unit-parser validation of `LoadCredentialEncrypted=`/`%d`, alternate-path search
or encryption probe was performed; this report does not present those as tested
facts. Existing WSL startup warnings about localhost proxy/Maven PATH translation
were retained in raw evidence and were not changed.

## Remaining gate and minimum compatible environment

AC2 and AC6 remain **open**. This diagnostic run is not service/credential custody
acceptance. The accepted C1 source and C1b process gate remains valid and **C2
source progression remains unblocked**; `deploymentReady` stays false.

Use a separately approved, compatible Linux/systemd environment that supplies:

- A functioning systemd manager and available supported `systemd-creds`.
- Real manager support for the packaged `LoadCredentialEncrypted=`, `%d` and
  hardening directives, plus an already provisioned approved host-encryption
  facility without initializing/replacing machine key material.
- The remaining plan prerequisites: exact service-name/path availability, protected
  native `/run` capacity, Node 24 and a proven Linux-compatible Core fixture dependency
  closure.

No current or minimum systemd feature version is guessed here. Installing Node
alone does not resolve the observed missing credential tool. The remaining
queries (fixed unit conflict, UID/architecture, Node, memory/tmpfs, native path
absence and fixture imports) were deliberately not run after the stop condition.
No service fixture source was created.

## Effects, final state and evidence

Before the run, Ubuntu-22.04 and docker-desktop were both Stopped and the planned
`G:/Temp/taki-c1a-ubuntu-20261014` directory was absent. Final Windows-side WSL
readback at `2026-10-14T10:01:35.3234252Z` reported:

```text
NAME              STATE           VERSION

* Ubuntu-22.04      Stopped         2

  docker-desktop    Stopped         2
```

The planned G: directory remains absent. No fixture/runtime was created, so no
cleanup deletion was needed. No service creation/start/reload, Docker, download,
installation, credential/original-data access, system configuration change,
distro termination or Git lifecycle action occurred. Normal distro startup was
the sole environment action authorized for these queries.

Exact commands, raw outputs/exits, before/after volume figures and plan hash are
preserved in [the JSON evidence](c1a-ubuntu-preflight-2026-10-14.json).
The original [acceptance plan](c1a-ubuntu-acceptance-plan-2026-10-14.md) is unchanged.
Root owns task/AC/handoff updates. This preflight assignment is complete and its
ownership is released.
