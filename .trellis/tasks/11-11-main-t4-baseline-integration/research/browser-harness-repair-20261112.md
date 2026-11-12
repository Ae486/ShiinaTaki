# Isolated Home Browser Harness Repair

Date: 2026-11-12. Workspace: `G:/TakiAgent-integration`, branch
`integration/main-t4-20261111`. Existing task continuation only; the child session
source is `session:codex_01a1cf08-edef-7401-9e05-d251b3990bf1`.

## Failure and correction

The previous connected journey stopped at Home onboarding before browser interaction:
`home-check.py` could not import `playwright.sync_api`. Its Python interpreter is
`G:/anaconda3/python.exe`; the existing Playwright installation is under
`G:/Roaming/Python/Python312/site-packages`. Replacing the OS profile correctly removed
automatic access to that user-site installation.

`first-use-runtime/home-browser.mjs` now supplies that explicit dependency root only to
its Python children. Both the normal Home step and the new browser preflight reuse the
same environment and `-B -s` interpreter arguments. User-site activation remains off,
bytecode writes remain off, and the isolated `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`,
`TEMP`, and `TMP` remain inherited from the controlled launcher. No package installation,
real-profile restoration, credential access, or Hindsight source edit is required.

The preflight imports the actual Playwright sync API, launches the existing headless
Chromium executable, sets and asserts a local in-memory page title, reports dependency
versions and profile paths, and closes the browser in `finally`. Python/executable/import
failures propagate as a nonzero preflight result, before Native/Core/PostgreSQL startup.
The outer Python process has a 60-second timeout.

`run-controlled-journey.ps1` now runs that preflight before its existing model-cache
preparation and heavyweight launch. It rechecks the unchanged **6 GiB available physical
memory gate** after the browser exits. `-PreflightOnly` exercises the shared browser path
without cache preparation or service startup. Every invocation gets a UTC timestamp plus
random suffix and prints its exact log and launch-receipt paths:

- `journey-<yyyyMMddTHHmmssfffZ>-<8-char GUID>.log`
- `journey-launch-<same run ID>.json`

The launch receipt records the run/profile, stage, mode, status, final exit code, and log
path. Failure diagnostics and cache-preparation output join the same per-run log. Existing
`journey-20261112.log`, its launch receipt, and the previous journey result directory are
retained separately.

## Actual checks

Run from `G:/TakiAgent-integration` using Node `v24.18.0` and PowerShell `7.6.10`:

```powershell
node --check .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/home-browser.mjs
& .trellis/tasks/11-11-main-t4-baseline-integration/research/run-controlled-journey.ps1 -PreflightOnly
git diff --check -- .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/home-browser.mjs
```

The PowerShell AST parser also returned zero errors for the launcher. Both edited scripts
are UTF-8 without BOM or trailing whitespace. The browser-only invocation exited `0` in
4.72 seconds; its receipt reports:

- Python `3.12.7`, Playwright `1.54.0`, Chromium `139.0.7258.5`.
- Profile `G:/taki-codex-work/integration-profile-55e68ec75dcc44f3b489ddaf42acaf68`.
- Temporary directory is that profile's `Temp`; `userSiteEnabled=false`,
  `bytecodeDisabled=true`.
- Log: [journey-20261112T091953650Z-205e97e8.log](journey-20261112T091953650Z-205e97e8.log).
- Receipt: [journey-launch-20261112T091953650Z-205e97e8.json](journey-launch-20261112T091953650Z-205e97e8.json).

Afterward, the probe profile had zero temporary entries, no model-cache receipt, and no
`.pg0` registry; no live Python/Node/Chromium process referenced this probe profile.
Running `G:/anaconda3/python.exe -B -s -c 'import playwright.sync_api'` with the same
isolated profile and no `PYTHONPATH` reproduced `ModuleNotFoundError` and exit `1`.
This distinguishes the repair from accidentally restoring automatic real-user imports.

Normal ESLint ignores `.trellis`. A forced check with explicit standard Node globals
compared the file at `HEAD` to the repaired file without disabling any rules: both report
only the pre-existing four-parameter `homeStep` (`max-params`), with **zero new findings**.
This is a baseline-relative check, not a claim that the normally ignored harness passes
the entire lint configuration. The structured
[scoped check receipt](harness-repair-checks-20261112.json) retains both reports, source
hashes, BOM/whitespace checks, and hashes of the old and new launch/log artifacts.

## Limits and follow-up

The existing interpreter, dependency directory, and Chromium executable remain local
machine dependencies. The preflight makes absence or incompatibility visible before a
heavy launch; it does not install, vendor, or pin them in the project lockfile.

This repair validates the isolated browser process and harness wiring only. It starts no
Core, Native Hindsight, PostgreSQL, real provider, or external messaging path. It does not
establish Home onboarding, the complete memory journey, or owner-manual acceptance; the
parent owns the full isolated journey and resource sampling. Hindsight/startup contract
records remain in the parent's existing handoff/ledger rather than being duplicated here.
