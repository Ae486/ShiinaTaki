# Parent-owned W6 paired restore supervision

`w6-owned-paired-restore-runner.py` defaults to inert. Its explicit
`--run-reviewed-paired-restore` entry requires the existing W6 emergency and independent-process restart to have
completed with zero new Native/transport/model dispatch. Actual execution passed on2026-10-06; see
[final W6 report](w6-final-result-2026-10-06.md). Its create-only attempt is retained and must not be rerun.

The runner verifies the preserved W5/W6 input inventory, makes one new byte-equal physical copy under
`stage4-w6-restore/<uuid>`, and retains a create-only attempt pointer in the prepared W6 root. A failed attempt is
not automatically retried. Neither the W5 predecessor nor the prepared W6 PG input is started or modified.

The product route-b operation owner creates the staged Core artifact and original Native request. Only then does
the supervisor start PostgreSQL on the new copy with explicit clone-local configuration and loopback-only access.
The Native helper uses the shipped backup/restore CLI and complete table/trigger/proof comparison. PostgreSQL is
stopped before a separate Core process admits/seals the ZIP. The final immutable Core/credential preflight consumes
that actual sealed pair. No hand-built pair manifest, activation identity, extraction or model work substitutes for
these producers. These are recovery-drill tools, not a general production data-directory replacement utility.

The W5 corpus harness used an explicitly synthetic HTTP credential adapter, not a disk Secret Catalog. Accordingly
this drill initializes an owned encrypted catalog containing only that original fixture credential/provenance, with
a new owned master key supplied through the production credentials-directory interface. It preserves that catalog,
host AAD and key for paired recovery. This proves fixture credential custody, not migration of a user's catalog,
Windows Credential Manager/DPAPI portability or original-environment acceptance. No external credentials are read.

Each bounded child has independent logs and a PID/exit/stop report. PostgreSQL stop verifies the actual data path,
port, executable and process creation time; partial startup still enters cleanup. Failed artifacts and prior successful
phase results remain. Current Taki and Native source inventories are compared after execution. Source/progress
Markdown is outside the runtime source inventory, permitting truthful progress notes during execution.

## Synthetic checks on 2026-10-06

```powershell
& H:/hindsight/.venv/Scripts/python.exe -X utf8 -B -s -m pytest .trellis/tasks/09-29-hindsight-transitions-emergency/research/test_w6_owned_paired_restore_runner.py -q --tb=short
& H:/hindsight/.venv/Scripts/ruff.exe check --select E,F,I .trellis/tasks/09-29-hindsight-transitions-emergency/research/w6-owned-paired-restore-runner.py .trellis/tasks/09-29-hindsight-transitions-emergency/research/test_w6_owned_paired_restore_runner.py
```

- 13 PASS in 1.17s: inert entry, required producer order/original request identity, failed-phase cutoff, failed PG
  startup cleanup, actual synthetic child timeout/failure with retained evidence, no acceptance from incomplete or
  nonzero-dispatch emergency evidence, preserved prior attempt, and foreign PG data refusal before process lookup.
- Ruff E/F/I and formatting pass. An initial long string diagnostic was corrected without behavior changes.
- The default CLI returns `executed:false`. No actual corpus or PostgreSQL service was opened by these tests.

The implementer independently validates the stage/seal/Core/Native product helpers. The parent reviews their final
interface before the actual run; synthetic supervisor tests alone do not establish D91 acceptance.
