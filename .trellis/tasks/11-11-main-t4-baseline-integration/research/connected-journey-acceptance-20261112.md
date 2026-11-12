# Complete integrated connected-journey acceptance

Recovered on 2026-11-12 from source session `01a1cf03-3415-7d93-9028-6a82ce7dfee1`;
current binding is `session:codex_01a1cf67-4df4-7c42-af1c-51885631386c` in `G:/TakiAgent-integration`.
The previous API turn failed, while its already launched journey continued and finished successfully.
This is evidence recovered and independently read back, not a new heavy-stack execution.

All **24/24** stages pass. Native boots in **41.477 s**. Summed business-stage duration is **1,626.781 s**;
the launcher finishes at 10:42:53 UTC. The journey covers Local onboarding, real retained writes, Hindsight
setup/activation, incremental/full replica sync, concurrent Home settings, scheduled/manual-only windows,
new-Character degraded admission/provisioning/recall, ingestion race, Pending outage and restart recovery,
configuration revalidation, template-v2/v3 handoff, backup-v2 capture/verification, healthy Local return,
re-entry, offline takeover surviving restart, and authenticated pre-writer paired restore.

Four actual Core exits and the Native exit are natural `code=0`, nonforced. Owned listeners, spawned survivors
and newly discovered survivors after five seconds are all empty. PostgreSQL stop/registry teardown succeeds;
the run's isolated evidence root remains `G:/taki-first-use-Xsv5yD`.

## Reproduce and inspect

From `G:/TakiAgent-integration`, use the existing controlled launcher (one heavy stack at a time):

```powershell
./.trellis/tasks/11-11-main-t4-baseline-integration/research/run-controlled-journey.ps1
```

The launch receipt identifies isolated G profile/data/ports, controlled loopback providers, browser preflight
and pre-copied, hash-verified offline model caches. It starts with 5.60 GiB available RAM and the independently
reviewed 5.50 GiB test threshold; business assertions and timeouts were not relaxed.

- [Raw final result](../../08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-12T10-14-33.205Z/result.json)
- [Compact provenance/resource receipt](connected-journey-receipt-20261112.json)
- [Launcher receipt](journey-launch-20261112T101423783Z-f44c47a1.json), [stage log](journey-20261112T101423783Z-f44c47a1.log)
- [Resource samples](journey-resources-20261112T101423783Z-f44c47a1.jsonl)

The current read-back matches all 1,453 Taki manifest entries (including seven intentional deletions with null
hashes) and all 99 Native dirty-source entries. Main HEAD remains `9b98794`, pending T4 merge input `63faf81`;
Native HEAD is `eb6413a7`, with its unchanged pre-existing patch tree recorded separately. HEAD alone is not the
identity of either tested dirty tree. Fresh migrations are main001-063 plus073-077 (68 receipts, head077),
without fabricated064-072 receipts. Native handles 3,515 primary requests; the controlled provider handles 37.
Three `models.dev:443` catalog attempts are refused by the Core isolation guard; no successful external provider
calls or billing is established. Native reports no refused egress. Do not call this zero attempted egress.

## Resource observations

273 samples span 10:15:28-10:42:58 UTC. Minimum available physical memory is **2.072 GiB** at 10:21:07 UTC.
Maximum summed owned working set is **4.338 GiB**; maximum summed private commit is **7.420 GiB**.
Maximum concurrent owned process count is 35; the final sample has none.

| Process family | Sampled maximum working set (GiB) | Sampled maximum private commit (GiB) |
| --- | ---: | ---: |
| Native | 1.981 | 4.760 |
| Core | 0.808 | 0.837 |
| PostgreSQL | 0.646 | 0.191 |
| Harness/browser | 1.438 | 2.004 |

Process working sets include shared pages; private commit is not resident memory. Family maxima are taken at
different samples and must not be added. Sampling starts after launch, so its first value is not launch headroom.
These measurements do not determine a universal product minimum or unobserved inter-sample peaks.

## Required follow-up and scope

Maintain the canonical [Hindsight change handoff](../../08-09-hindsight-memory-provider/research/main-t4-integration-20261112.md)
and [startup blocker ledger](../../08-09-hindsight-memory-provider/research/startup-configuration-blockers.md).
HS-START-01/02 remain open: embedding and reranking model preparation must be possible after startup with settings
reachable, typed unavailable state and supported retry; each missing/invalid model needs separate acceptance.
The fully configured journey cannot close those requirements.

The connected stack uses real Native/PostgreSQL/Home Chromium/Core with controlled model responses. Paid-provider,
actual QQ observations, WebGL/Pet rendering, installer distribution, owner-manual and large-library acceptance
remain outside the engineering baseline evidence. All earlier failed logs/results and stopped databases are
retained. Original real-profile migration remains separately authorized. Final commit/ancestry/alignment gates
are tracked by the integration task rather than inferred from this passing journey.

Before commit, staged whitespace validation found redundant EOF blank lines in two newly added files.
[Formatting receipt](precommit-formatting-20261112.json) records exact before/after hashes and proves all
nonterminal bytes unchanged. The original connected result and its tested hashes remain unmodified; the
final source has only those two terminal-newline differences from the previously matching manifest.
