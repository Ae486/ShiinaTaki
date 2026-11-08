# C2b fixed API and owned PostgreSQL producer source

Status: new Native source and deterministic checks complete; Root integration and real runtime remain open.

## Checkpoint 1: source assignment

- Root reports the preceding application artifact built once and passed complete installed source,
  virtualenv/METADATA and real offline tokenizer checks. The old packet/snapshot stays immutable.
- This assignment owns only new API-specific modules/tests beside Native `managed_bootstrap`, plus
  this report and its matching validation directory. Existing fake/wire/owner modules and all
  Taki Shared/Core/Host integration remain Root-owned.
- Implement the already accepted fixed no-model profile, immutable pre-import gate, original-grant
  launch marker, owned API/PostgreSQL lifecycle and one shared 25-second shutdown deadline.
- Heavy execution slot is owned by D1-B. No Docker, WSL, SQL server, API, model/provider, package
  install, Git lifecycle or runtime cleanup effects are admitted to this source agent.
- Next: map existing process/credential/grant and offline-PG helpers; implement new modules and
  generated deterministic tests, then request the heavy slot before running subprocess fixtures.

## Checkpoint 2: direct source modules written

- Added new `api_profile.py`, `api_artifact.py`, `api_state.py`, `api_consumer.py`,
  `api_database.py`, `api_server.py` and `api_child.py`; existing Native files are untouched.
- Consumer signature for Root integration is `C2ApiConsumer(bootstrap.startup_id,
  configuration_digest, bootstrap.remaining)`. The existing post-consumption grant check stays.
- The child validates immutable build/cache before its private PID/start marker, starts one PG0
  generation or an explicitly checked same-volume raw-postgres restart, and supplies an external
  loopback PostgreSQL URL to ordinary `hindsight_api.server:app` with migrations enabled.
- Native readiness requires an actual SQL/durability/ancestry check, normal ASGI startup, healthy
  SQL-backed health, denied unauthenticated manifest and a matching authenticated build/contracts/
  lineage response. It remains distinct from Host endpoint or deployment readiness.
- PG subprocess environments contain only fixed non-secret local values; only CONNECTION is
  mapped into the API environment. Six model slots are discarded by this initial producer.
- Shared stop uses one 25-second deadline, at most five seconds for ordinary lifespan closure,
  fixed fast pg_ctl stop within at most 17 seconds, exact original-process reap and matching
  shut-down pg_controldata. Forced/timeout exits cannot publish a checked-stop result.
- No checks or subprocess fixtures have run yet; D1-B still owns the heavy slot. Next: focused
  deterministic tests/static checks when granted, then exact Root integration/runtime handoff.

## Checkpoint 3: tests prepared; execution slot pending

- Added nine generated deterministic tests in `test_api_producer.py`: one-slot privacy and fixed
  profile, invalid connection rejection, non-renewable budgets, durable private marker recovery,
  interrupted evidence preservation, original-grant timeout/one dispatch, zero-effect stale grant,
  launch ACK independent of readiness, and wrong immutable build before cache/provider access.
- Tests use controlled Popen substitutions and real temporary marker files; they never start
  an API, SQL server, model, provider or Docker process. No check command has run yet.
- Recorded PID/start/PPID/PGID/SID/executable/UID evidence for API, PG CLI/postmaster/logger and
  the real SQL backend. Existing original init/current-start/checked-stop records must reconcile
  before a raw same-volume restart; missing or unknown prior records refuse.
- Explicitly guarded ready publication versus TERM/startup-alarm cancellation with Linux signal
  masking. Repeated stop triggers retain the original deadline. Zombie/reused observed processes
  cannot remain Native-ready.
- Root's D1 integration checks currently own the heavy slot. Once released, run scoped Ruff,
  Linux/Python 3.11 ty and only this new deterministic test file; retain failures and final hashes.

## Source handoff

Eight new files under `H:/hindsight/docker/standalone/managed_bootstrap/` are released to Root:

| File | Responsibility |
| --- | --- |
| `api_profile.py` | Fixed initial profile; CONNECTION-only API mapping and no model credential application. |
| `api_artifact.py` | Fixed build/source/cache/tokenizer-reader checks before ASGI/provider/SQL import. |
| `api_state.py` | Original process identity, private observation, atomic evidence and monotonic lifecycle budget. |
| `api_consumer.py` | Sole process dispatch; original-grant launch ACK and independently checked original-process observation. |
| `api_database.py` | Offline PG0 first start, original checked-stop/raw restart, SQL/durability/ancestry and exact shutdown. |
| `api_server.py` | Ordinary `hindsight_api.server:app`, authenticated readiness and bounded stock-lifespan shutdown. |
| `api_child.py` | Fixed isolated entrypoint composing pre-import gate, subreaper, API and PostgreSQL lifetimes. |
| `test_api_producer.py` | Nine generated deterministic tests; no actual API/PG/provider process. |

Validation is recorded in `c2b-api-producer-source-01a180b6-validation/checks-final-2.json`:
Ruff, Linux/Python 3.11 ty, all nine tests and all eight AST parses exit 0. Initial formatting,
missing static Native import search path and the last SQL string-width finding are preserved in
the two earlier check records; no rule was suppressed. `source-manifest.json` binds exact source
and check bytes. The execution slot was returned immediately after checks completed.

Root's minimal remaining integration is concrete:

1. Instantiate the new consumer from a separate fixed API owner/profile with
   `C2ApiConsumer(bootstrap.startup_id, configuration_digest, bootstrap.remaining)` and return it
   through the existing `Bootstrap` callback. Preserve its post-consumption `grant.require_live()`.
   The existing fake owner, control protocol and supervision files were deliberately not edited.
2. Expose `consumer.observe()` only through Root's protected original-resource observation path.
   Its private `ApiObservation` is not a Shared wire type or a caller-authoritative receipt;
   Root still binds Host/Engine/image/container/start/profile, actual relay/listener and authenticated
   API manifest before constructing a trusted setup reference. `deployment_ready` remains false.
3. Freeze a **new** producer context/image, including these files and the actual fixed API owner.
   Preserve the consumed application artifact/release/G: snapshot. Its current-source verifier is
   expected to see the newly added Native bootstrap files; never mutate that old snapshot to match.
4. Run actual isolated first initialization, ordinary migrations/authentication/readiness, checked
   API/PG stop and a later explicitly admitted same-volume raw restart. Pin resources/tools/storage
   and use the accepted network-none Host relay. Do not start the original standalone supervisor or
   allow MemoryEngine to select its embedded-PG URL path.

## Verified limits and risks

- Deterministic tests exercise launch/grant/privacy/marker/immutable-build/budget rules with Popen
  substitutions and real generated marker files. They do **not** prove Linux PG0 extraction,
  detach/adoption, raw-tool/library availability, stock lifespan closure or HTTP/SQL readiness.
- The database uses the previously accepted PG0 0.15.0/PostgreSQL 18.1 tool hashes and start/stop
  mechanism. Any missing library/extension, different process topology or incomplete prior stop
  refuses; actual producer/runtime evidence is still required.
- API pool limits remain 1/4 for read and write. PostgreSQL uses 16 connections instead of the
  one-client diagnostic's 8, leaving space for both API pools, migration and observed SQL connections.
- A hard shared-deadline exit is unsuccessful and may require cleanup by the original owned
  container. It never becomes checked stop, silent reseeding, replacement or restart permission.
- No Docker/WSL/image build, API/SQL server, model/provider, package install, original data/key,
  Git lifecycle or unrelated cleanup was performed. Existing Native source files and all prior
  relay/dependency/application packets remain untouched.

Ownership is released to Root after the exact manifest handoff. No further source edits or checks
will occur without a new assignment.
