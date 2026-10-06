# W6 private pair preparation

Parent prepared a new physical copy after accepting the completed W5 healthy journey. This is an unstarted
test input, not emergency, restart or paired-restore acceptance. No new extraction/conversion/model call or
original-data authority change occurred.

- New root: `H:/TakiAgent/.trellis/.runtime/stage4-w6/db280d150f6340618b340a70439b43f7`.
- Source: the completed stopped W5 root in `w5-healthy-final-result-2026-10-06.md`.
- Core SHA256: `274e1ccbd651bcd8c64f88f7ceb0d80c56a3701e5a5a62309369cbfbd0235a45`.
- Files:1665; bytes:1289072235. Contents are `data/` and `application.sqlite`; source `prompt/` was absent.
- Copy inventory: `<new root>/source-files.json`, SHA256
  `0e5fc2cc07fd30461da4754afe4021cbaeee70223920f5e9e910db818c2ae4f4`.
- `<new root>/ownership.json`: prepared=true, started=false, stopped=true, originalPreserved=true.

The parent verified original stopped ownership and released ports, rejected links/reparse points, hashed every
source file, copied into a fresh unique directory, matched the complete target inventory, rehashed the source
and confirmed no PostgreSQL PID or Core WAL in the new copy. The old W5 and original historical sibling remain
preserved inputs; neither is to be started or mutated by W6.

Command, cwd`H:/TakiAgent` (exit0):

```powershell
& H:/hindsight/.venv/Scripts/python.exe -X utf8 -B -s .trellis/tasks/09-29-hindsight-transitions-emergency/research/w6-prepare-owned-copy.py --prepare-owned-copy
```

The helper defaults to inert, has no path override and starts no service. Ruff E/F/I and formatting passed.
Running it again would create another fresh copy; it is not needed for this prepared input. This file is a
physical test-pair preparation helper, not an alternative product backup/restore engine.

The implementer may design the synthetic/live harness interface from this sanitized description. Actual private
data/service execution remains parent-owned. Preserve the existing DPAPI credential custody; do not copy secret
values into task reports, replace Core authority by raw SQL, or infer credential portability. Startup ports and
the exact final-code run command will be fixed after reviewing the W6 harness. Current Core schema is the W5
lineage through056; any W6 upgrade must use the real additive migrations on this new private copy.

## Separated Core working directory

Parent subsequently created `<new root>/core/` and copied the preserved `application.sqlite` to `core/taki.db`.
Both files match the same Core SHA above; neither database was opened or migrated. `<new root>/core-layout.json`
records CoreDataDir=`core`, CoreDbPath=`core/taki.db`, NativePgData=`data`, started=false. Product incident and
backup storage belongs under `core/backups`; no Core file belongs inside PostgreSQL PGDATA. The original1665-file
prepared-pair inventory still describes the preserved inputs, not the additional Core working copy.
