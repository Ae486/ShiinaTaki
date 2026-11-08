# Deployment Resource Requirements

Measured needs of the memory stack (Agent Core, Native Hindsight with its local retrieval models, PostgreSQL), for sizing a
deployment.

**Status: provisional.** Measured 2026-11-07 on one machine: Windows 11, Intel i7-13700H (14 cores, 20 threads), 16 GB RAM,
with a controlled model provider, so model-provider network time is excluded. Nothing here has been measured on Ubuntu, the
production VPS target. Re-measure there before committing to a VPS size.

Runs behind these numbers ([summaries, probes and scripts](../.trellis/tasks/08-09-memory-operations-ui/research/resources-20261107/)):

- **Small journey**: first-use journey runs 8 and 10, through their tenth step, small fixture data, about 6 minutes each. Run 8 had a CPU profiler attached; run 10 had none. Peaks below are the higher of the two.
- **Large replay**: isolated copy of a real library with 1,690 sources; one chat, four recalls and a paired backup, about 2.5 minutes.

## Memory

| Component | Typical physical | Peak physical | Peak commit | Notes |
| --- | --- | --- | --- | --- |
| Native Hindsight, local models | 1.0-1.4 GB | 2.01 GB | 4.31 GB | Peak follows concurrent reranking, not library size (see below). Not shown to level off yet. |
| Agent Core | 0.38-0.62 GB | 0.64 GB small, 0.78 GB large | 0.67 GB small, 0.80 GB large | Single process. The large figure had a CPU profiler attached; the small figure did not. |
| PostgreSQL | 0.3-0.5 GB | about 0.55 GB | 0.29 GB private plus shared memory | 20-34 processes. `shared_buffers=256MB`, `work_mem=64MB`. Adding per-process figures (0.93 GB) counts shared pages many times. |
| **Stack total** | | **about 3.4 GB** | **about 5.5 GB** | Upper bound from adding peaks. Machine-wide free memory fell by 2.9-3.2 GB (small) and 2.2 GB (large), including the test harness (about 0.4 GB) and, for small, the test browser. |
| Home client | 0.5 GB | 0.65 GB | 0.4 GB | Headless Chromium in tests. The real WebView2 window is not measured. |

Physical is working set; commit is private bytes. Windows charges commit against RAM plus page file, so a machine with a small
or disabled page file needs the commit figure available. Linux accounting differs and is not measured.

## Disk

| Item | Size | Notes |
| --- | --- | --- |
| Native Python environment | 1.8 GB | Development environment with all extras: torch 456 MB, `claude_agent_sdk` 225 MB, scipy 105 MB, pyarrow 82 MB, litellm 82 MB. A production install should be smaller; not measured. Excludes the base Python install. |
| Retrieval models | 217 MB | `bge-small-en-v1.5` 129 MB, `ms-marco-MiniLM-L-6-v2` 88 MB. Must be present or downloadable at first start. |
| PostgreSQL binaries | 161 MB | Embedded pg0 18.1. |
| PostgreSQL data | 50 MB empty, 75 MB small, 87 MB large | About 22 KB per source, estimated from one library. |
| Core data | 10 MB small, 28 MB large | |
| Backups | 1.8 MB Native part, large replay | Core data grew from 28 MB to 42 MB in the same run; how much of that is the backup is not separated. |
| Native log | 1.4 MB in the 6-minute journey | About 13 MB per hour of active use, mostly repeated `Unknown parameters ignored` warnings. Rotation is not reviewed. |

## CPU

| Component | Typical | Peak | Notes |
| --- | --- | --- | --- |
| Native | 0.1-0.2 core | 8-9 cores for a few seconds | Bursts are local model inference, which uses every physical core it is given. |
| Agent Core | 0.1 core small, 1 full core large | about 1 core | Single-threaded, and in the large replay it stayed at 100% of one core for minutes. Prefer fast single-core speed over many slow cores. |
| PostgreSQL | under 0.05 core | 0.4 core | |

## Local retrieval models

Both models run locally on CPU by default: `BAAI/bge-small-en-v1.5` for embeddings (384 dimensions) and
`cross-encoder/ms-marco-MiniLM-L-6-v2` for reranking.

Memory by layer, from a [probe](../.trellis/tasks/08-09-memory-operations-ui/research/resources-20261107/model-memory-probe.jsonl) outside any workload:

| Loaded so far | Physical | Commit |
| --- | --- | --- |
| Native code only (remote providers configured, torch is never imported) | 300 MB | 761 MB |
| Plus torch and sentence-transformers | 642 MB | 1,558 MB |
| Plus both models | 672 MB | 1,829 MB |
| Plus first inference, one at a time | 1,043 MB | 2,246 MB |

Each extra concurrent rerank adds 140-280 MB and the memory stays held: peak 690, 967, 1,108 and 1,273 MB at 1, 2, 3 and 4 at
once, without the Native code layer ([probe](../.trellis/tasks/08-09-memory-operations-ui/research/resources-20261107/rerank-concurrency-probe.jsonl)). Native allows 4
(`HINDSIGHT_API_RERANKER_LOCAL_MAX_CONCURRENT`), and one chat turn can already recall from two Banks at once.

Inference time by available threads, median seconds, synthetic text, thread limit standing in for a smaller machine:

| Work | 14 threads | 4 threads | 2 threads | 1 thread |
| --- | --- | --- | --- | --- |
| Embed one query | 0.02 | 0.04 | 0.03 | 0.04 |
| Embed 32 documents of 300 characters | 0.37 | 0.90 | 1.37 | 1.71 |
| Rerank 22 candidates of 300 characters | 0.17 | 0.43 | 0.63 | 0.84 |
| Rerank 46 candidates of 300 characters | 0.36 | 0.79 | 0.96 | 1.62 |
| Rerank 46 candidates of 1,500 characters | 1.45 | 2.98 | 4.20 | 6.75 |

Real workload on this machine: query embedding 0.08-0.11 s, rerank 0.5 s for 22 candidates and 2.2-2.7 s for 46. Reranking was
about 75% of recall time. All model work was about 31 s of the 6-minute small journey, and at most about 5 s of the 46 s
large-library chat turn, so model time is not the main cost of a turn on this machine. On 2 vCPU, a 46-candidate rerank would
take roughly 6-8 s (estimate from the ratios above; VPS core speed may be lower).

Options, none exercised end to end yet:

| Choice | Effect | Cost |
| --- | --- | --- |
| Keep both local | Works offline; nothing leaves the machine | Memory above; large recalls slow on few cores |
| Remote embedding only | Almost no memory saved (the reranker keeps torch loaded). Time saved is at most the local time, 0.1 s per query | Network latency, provider cost, memory text leaves the machine, and existing memories must be re-embedded ([D95](deferred-decisions.md)) |
| Remote embedding and remote reranker, or remote embedding with the `rrf` reranker | Saves at least 740 MB physical and 1.5 GB commit because torch is never imported | As above; `rrf` uses no model, so ranking quality changes, unmeasured |
| Lower `..._RERANKER_LOCAL_MAX_CONCURRENT`, enable `..._RERANKER_LOCAL_BUCKET_BATCHING` | Bounds memory; upstream claims 36-54% faster reranking, unmeasured here | Concurrent recalls queue |
| Local ONNX (`intfloat/multilingual-e5-small`) | Multilingual embedding without the torch dependency for that model | Unmeasured; a model change requires re-embedding |

Core exposes `TAKI_HINDSIGHT_EMBEDDING_PROVIDER`, `..._EMBEDDING_MODEL`, `..._RERANKER_PROVIDER` and `..._RERANKER_MODEL`. Both local
models are English-only; retrieval quality on Chinese memories is unmeasured. See [D101](deferred-decisions.md).

## Sizing guidance (estimates from the above)

| Topology | Memory | CPU | Disk |
| --- | --- | --- | --- |
| Single machine with Home | 8 GB minimum, 16 GB comfortable; keep about 5.5 GB of commit headroom | 4 or more cores | 3 GB plus data |
| VPS running Core, Native and PostgreSQL, local models | 4 GB is too tight (3.4 GB peak plus the OS); plan on 6-8 GB | 2 vCPU minimum; 4 if large recalls must stay under a few seconds | 3 GB plus data |
| VPS with both retrieval models remote | 4 GB should be workable | 2 vCPU | About 2 GB plus data, if torch is left out of the install |

## Not measured yet

- The full journey, including transitions and backup under load.
- Whether Native memory levels off during long sessions, and Core memory on the large library without a profiler attached.
- Libraries much larger than 1,690 sources.
- Ubuntu, the real WebView2 client, real model providers, remote retrieval providers.
