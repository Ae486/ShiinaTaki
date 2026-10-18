# C2a cached database metadata probe

Date: 2026-10-15. Execution and owned cleanup PASS; raw PostgreSQL availability remains unresolved.
This non-starting probe is not database shutdown/persistence acceptance.

The [reviewed script](docker-database/probe-runtime.py) ran once in a fresh read-only, network-none,
UID/GID-1000 container on the pinned cached Native image. It returned exit 0 in 0.084 seconds of
script execution; the complete bounded Docker command and State records are preserved.

| Fact | Actual cached Linux result |
| --- | --- |
| Runtime | Python 3.11.16 at `/app/api/.venv/bin/python` |
| Packages | `pg0-embedded` 0.15.0; `psycopg2-binary` 2.9.11 |
| pg0 wrapper | 13,837 bytes; SHA-256 `ac3f14beaff4b1cdfc0fdf674df2d2c322131bc4852de09b58f0ed7bc4288dc1` |
| Bundled CLI | `/app/api/.venv/lib/python3.11/site-packages/pg0/bin/pg0`, 34,205,672 bytes; SHA-256 `20c65441992d3f1d433c7d5d33a14aba0030c77913beed9c9571e3816ea7f8fb` |
| Raw PostgreSQL tools | `postgres`, `initdb`, `pg_ctl`, `pg_controldata` not confirmed in package-listed assets |
| Data seed | `/home/hindsight/.pg0` empty, owned/traversable by UID/GID 1000 |

The consumed wrapper supports `--data-dir`, puts its configured password in argv, and uses unchecked
stop exit handling. Its numbered source is retained. The fixture must use nonsecret local DB parameters
and independently verify actual data/process/stop results. No pg0 command, cluster initialization,
database startup, asset extraction/download, original-data mount or model access ran.

Root's first image metadata template used an absent optional `Config.Volumes` key. The corrected query
uses `json (index .Config "Volumes")`; failed and successful read-only commands are both retained.
The same engine/base and absence of image-declared volumes were confirmed before container creation.

The exact probe container was removed. All seven original containers, their states, start times and
restart policies matched the before-state. After archiving and checking all file hashes, Root removed
the marked G: staging tree (138,262 logical bytes); no H: build output or image build was created.

- Token: `4f0d332f-d9d9-4c30-a847-36cfc02afb7d` (consumed; do not reuse).
- [Evidence ZIP](c2a-database-probe-evidence.zip): 35,616 bytes, SHA-256
  `9a5e5be39037b1ddf4465b8698a99af0f2e95bdab5864bd34aaed6e47f0db893`.
- [Preservation and cleanup](c2a-database-probe-preservation.json) lists every member hash.
- [Static review](c2a-database-probe-review.md) and [design review](c2a-database-design-review.md).

Next: review a small offline extraction/first-start proposal for the bundled CLI using new owned
storage and no network. Missing raw assets do not prove they can be extracted offline; no automatic
download, alternate runtime or normal Native API start is permitted by this result. The recovery
fixture implementation proceeds independently. Keep all three broader task criteria open.
