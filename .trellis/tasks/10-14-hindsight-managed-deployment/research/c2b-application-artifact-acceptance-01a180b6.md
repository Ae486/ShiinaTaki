# C2b application artifact and offline tokenizer acceptance

Root executed one local-only build and one actual read-only, network-none image check.
The application-source/cache prerequisite passes. `deploymentReady=false`; this image's
entrypoint is an artifact checker, not the later managed API producer.

- Release: `da13c5f1bceb17130c000657b40fad55cdc29de94b1c64a5ca85137e2cbf91d0`.
- Image: `sha256:c57385ec5ad1243659db1e1159f65218c1a48dd0481e94f468cbc0ada376b11e`.
- Tag/token: `taki-c2b-application:ad8bf8b8-9577-4420-9fd9-212574bd4568`.
- Archive: [original execution and acceptance](c2b-application-run-ad8bf8b8-9577-4420-9fd9-212574bd4568/acceptance.json).
  Its integrity file records 24 files and has SHA-256
  `ffca88ea834c0db1880f73e198492943b213e633fbe1a3111c6c1d6ed463cbd6`.

The complete current application and bootstrap trees match the frozen source, including the
previously missing template modules and exact `template-backup-v1` build. All 221 original
distribution metadata files match. Full virtualenv/Python digests agree before installation,
after installation and in the resulting runtime. The original base layer prefix/tag is unchanged.
The known upstream LiteLLM metadata warning was neither changed nor hidden.

Under UID/GID 1000, missing/corrupt cache and wrong build fixtures refuse before third-party
imports. Actual tiktoken 0.12.0 loads cl100k_base from the immutable checked cache, reads that
cache once during load and round-trips generated text. The audit fence reports zero forbidden
socket/process/download/application-import effects. This establishes tokenizer execution, not
provider/model or API execution.

The original build command exited 0. A subsequent readback failed because Docker omits the empty
`Config.Cmd` field. The original failed wrapper report is preserved. A separate read-only inspection
used `index .Config "Cmd"`, joined the original iidfile/tag/token/base layers, and recovered the
already-built image. No build was replayed. Optional Docker fields must use safe map access.
The current build script now uses that same safe access; the archive retains the original executed
script and its failure. Its consumed build fence remains in force.

The check and exact-ID cleanup completed in 26,703 ms, inside its 180-second work / 240-second
total bound. Container `dce0c98d30c3de7986da38f51fa379afd27881c0c0d04a15f8f9a44af8117b1b`
is stopped, removed and absent by both ID and name. All Docker CLI children closed; the original
eight workload projections are unchanged. The image, frozen source stage and Root client/evidence
stage remain deliberately retained on G: for the next producer work. Do not reuse build/check fences.

Next is the reviewed fixed Native API and owned PostgreSQL producer, then its installed Host/wire
and trusted setup integration. Raw PG tool/extension identity, real API/authentication/listener,
checked shutdown/restart, receipts/setup and D1-C/D remain unproved. The owner requested combined
review of completed deliverables; no additional per-file independent review was inserted.
