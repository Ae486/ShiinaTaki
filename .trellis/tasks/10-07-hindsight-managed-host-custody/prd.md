# Hindsight managed Host and read-only credential custody

## Goal and status

Stage 5C/C1 provides a real installed helper and authenticated same-host custody boundary for later managed
Hindsight deployment. Core remains the sole encrypted Secret Catalog writer and owns admission; the registered
execution Host owns OS effects. Existing-instance configuration must work when this helper is absent.

The owner authorized continuation beyond the accepted Stage 5B automatic gate on 2026-10-13. The final C1 design
confirmation passed, all overlapping source ownership is released, and the
[post-5B source refresh](../10-07-hindsight-template-lifecycle/research/stage5c-post5b-readiness-2026-10-13.md)
found no new design blocker. C1a and C1b independent SOURCE reviews are complete and pass within the recorded
Windows/source scope. All source/check ownership is released. See `research/leader-now.md` and the
[independent C1b review](research/c1b-independent-review-2026-10-13.md) for evidence and remaining gates.
Source implementation and isolated fake-credential tests are authorized.
The owner separately approved the disposable G: runtime and eight Linux tests on 2026-10-14; that bounded
run passed and its temporary environment was removed. Permanent/system-wide runtime or service installation,
Docker startup, original data/credentials, real model calls and Git lifecycle actions remain outside this scope.

The owner separately allowed starting existing Ubuntu for C1b tests using existing dependencies. Preflight found
only Python 3.10.12 and no python-dotenv, so Linux execution stopped without installation. This narrow permission
does not cover Ubuntu credential-service installation or C2 Docker deployment.

The subsequent [approved temporary-runtime run](research/c1b-linux-check-2026-10-14.md) used CPython 3.11.17
and locked python-dotenv 1.2.2. All eight actual Linux process cases passed after correcting only test-fixture
startup/positive-case budgets for measured DrvFS import overhead. Production protocol limits were unchanged.

## Pre-implementation baseline

- Existing managed-receipt shapes are not evidence of an installed helper or authenticated resource producer.
- Core's TSC1 codec already uses locked libsodium-wrappers 0.8.4. A narrow boot-free shared codec can preserve its
  format and leave Core as the sole writer; the helper must never instantiate the mutable Catalog service.
- `taki-node` currently refuses release execution. The operator CLI is not an authenticated Host. Ubuntu parity
  needs a release-safe Host path with explicit registration and protected service credentials.
- Current desktop packaging does not yet prove installation of the Node helper, locked dependency tree or key
  adapter. A source checkout or arbitrary PATH executable cannot substitute for installed artifact identity.
- Native currently reads provider secrets at process startup. The proposed private stdin/bootstrap mechanism has
  not been tested; Docker restart requires new custody validation and injection for a new startup identity.
- An existing process retains its credentials. Catalog clear/rotation is not instant revocation of that process.

## Requirements

1. Ship an explicit versioned helper artifact and supported entrypoint using already locked dependencies. Verify
   manifest, executable/dependency identities, OS/architecture, registered Node 24 runtime and protected installation
   ownership before invocation. Fail closed on missing, replaced, redirected or unsafe artifacts.
2. Keep `coreHostId`/Catalog store, execution Host, OS credential owner, installation and operation identities
   distinct. Registration and live authenticated Host control must bind them; operator-supplied JSON is not proof.
3. Windows uses the existing get-only key adapter and actual token-user provenance. Ubuntu uses the registered
   protected systemd credential source and a release-safe Host/control entrypoint. Neither path creates missing
   keys, searches alternate catalogs, changes OS permissions silently or depends on a desktop dialog on a server.
4. Open the registered TSC1 catalog read-only. Authenticate the exact store/key version and sealed-byte digest;
   select only the fixed admitted Hindsight slot refs. No arbitrary ref/path/command interface, secret-valued WS
   message, public listener, stdout dump, environment file or persistent helper-secret cache.
5. Bind every result to the original operation/attempt, live Host and Core generations, admitted installation,
   config and owner-consistent catalog boot/revision/sealed-byte identity. Check again before later injection/receipt acceptance. Same-millisecond
   replacement, restore ABA and concurrent file publication cannot admit stale prepared values.
6. Preserve Core/Host permission and exact-input rules, unknown-outcome handling and non-replay after reconnect.
   A local diagnostic may report safe status but cannot be submitted as a trusted deployment receipt.
7. Implement and prove the fake-secret Native bootstrap process protocol in C1b: bounded private stdin, exact
   startup identity, fixed slot mapping, disabled dotenv, controlled logs and graceful process shutdown. C2a owns
   the real isolated Docker/temp-storage/daemon experiment and must pass it before real credential delivery or
   trusted deployment receipts are enabled. A restart waits for new custody validation, never an old acknowledgement.
8. Define the long-lived restart observer and its supported lifecycle. Home closure is not process ownership.
   Windows logged-in-user custody and Ubuntu explicitly installed service custody retain their different availability
   boundaries. Unavailable/locked/stale custody leaves Native unstarted and visible as unavailable.
9. Expose bounded non-secret prerequisite/refusal/current-generation status for later Core/Home composition.
   Distinguish diagnostic readiness, credential preparation, process start and actual Native configuration/readiness.

## Acceptance criteria

Checked criteria below record automatic source/fake-credential acceptance only. The combined platform criteria
2 and 6 remain open; AC7 now includes actual Linux process evidence. No original-environment, real-keyring,
final-installer or manual acceptance is inferred.

- [x] Artifact builds and resolves its pinned dependencies outside the source checkout; tampered/missing manifest,
      executable, adapter and dependency tree refuse without searching for replacements.
- [ ] Windows real owner/ACL/path checks and Ubuntu effective-user/credential-source checks have supported-platform
      evidence; race/replacement tests validate opened artifacts and current identities, not only path strings.
- [x] Helper reads only the admitted catalog and fixed refs, preserves TSC1 bytes/format and Core's sole writer,
      refuses absent/locked/tampered/wrong-store/key state, and never creates or rotates key material.
- [x] Same-millisecond change, restore ABA, changed config/Host/policy/boot/installation and file replacement during
      preparation fail final validation. A stale attempt cannot silently upgrade itself to new credentials.
- [x] The real authenticated Host route admits exact original results; ordinary operator JSON, diagnostics, wrong
      attempt/input and replayed generation cannot establish custody or deployment provenance.
- [ ] Release-safe Ubuntu Host registration and Windows installed invocation both use the same strict protocol;
      Shared/Rust parity and missing-helper existing-instance paths remain correct.
- [x] C1b fake-secret process bootstrap demonstrates frame caps/startup binding, no sentinel in argv/logs/files,
      duplicate injection, abrupt helper death, new-startup refusal without credentials, locked/rotated custody
      and process-group termination/reaping. The fake observer covers original-ID recovery without claiming Docker proof.
- [x] C1 explicitly leaves Docker readiness unavailable until C2a passes actual isolated no-TTY exec delivery,
      inspect/config/log/file scans, container/daemon restart, fresh tmpfs and graceful database shutdown. No
      process-only evidence can mark that downstream gate passed or enable real delivery/receipts.
- [x] Restart observation preserves original owned resources and reports unknown/stale states without blind create,
      start or injection replay. Provider/model calls remain faked or trapped in automatic tests.
- [x] Independent custody/security/packaging review passes and records actual platform limits. Original deployment,
      actual provider keys and manual acceptance are not marked passed from fixtures.

## Open engineering gates

The independent C1b review fixed admission expiry hiding a still-running process's original status. Final
verification passes 24 Native Windows tests and 20 fake-observer tests. The subsequent 2026-10-14 Linux run
passes all eight cases, with scoped lint/format/types passing. Its first two failed runs, measured fixture
corrections, final source hashes and cleanup are preserved in the linked report. AC7 is accepted for the
automatic process contract. The task remains `in_progress` for Ubuntu service/platform criteria 2 and 6;
source/process PASS does not enable deployment readiness. The temporary runtime has been removed.

The independent [C1 readiness review](../10-07-hindsight-template-lifecycle/research/stage5c-c1-readiness-review.md)
identified six concrete gaps. The design now freezes their APIs, finite limits, platform checks and C1a/C1b/C2a
ownership; final artifact confirmation passed and the 2026-10-13 source refresh preserves that verdict.
Fake-secret experiments can invalidate the mechanism
and require an engineering revision. No new owner product decision is required for these corrections.

No real environment choice is needed for planning. Installing a service/runtime/Docker, selecting actual host/data
locations or model credentials, changing privileges, unattended Windows service-account behavior and real image
downloads remain separate concrete environment actions.

## Scope boundary

C2 owns actual isolated managed-resource orchestration and trusted deployment receipts; C3 owns six-slot model
apply/readback. C4/5D own populated model changes, preserved-source candidate migration and promotion. C1 supplies
their custody/Host foundation without claiming those outcomes. No remote-Host secret transfer, general broker,
new third-party dependency, original data/grants, real provider calls, Git lifecycle or task archival.

## Sources

- [Host and model boundary research](../10-07-hindsight-configuration-observation/research/stage5c-host-boundary-research.md).
- [Custody and bootstrap proposal](../10-07-hindsight-configuration-observation/research/stage5c-custody-design.md).
- [Independent C1 readiness review](../10-07-hindsight-template-lifecycle/research/stage5c-c1-readiness-review.md).
- [Stage 5 execution map](../08-09-memory-operations-ui/research/stage5-execution-map-2026-10-07.md).
