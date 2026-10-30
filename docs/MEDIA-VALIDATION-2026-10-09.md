# Media Validation — 2026-10-09

Status: partial capability validation completed; production Co-Watching integration is not accepted.

## Authorization and scope

The owner approved isolated local validation, selected [BV1UEaq6qEZt](https://www.bilibili.com/video/BV1UEaq6qEZt), identified Edge with an existing Bilibili login, and imposed no model-testing spend ceiling. The owner requested token/cost evidence when available. The existing no-Trellis-task choice remains in effect.

The owner installed the temporary playback observer and reported the requested play/pause/seek/tab-switch steps complete. This confirms participation in that probe, not acceptance of a finished Taki Co-Watching feature.

No production integration code or upstream source checkout was changed. BiliNote ran from a disposable archive; the model credential stayed in a local relay process, while BiliNote received an ephemeral loopback relay credential. No browser Cookie was read or transferred by this probe.

## Environment and reproducibility

| Item | Observed value |
| --- | --- |
| Workspace | `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`; substantial pre-existing edits preserved |
| BiliNote | Clean supplied checkout at `90940fde4d224d0f69ad99674f4af0a1ea52d3c4`; archived backend executed under the validation directory |
| OpenBili extension | Source version `0.3.205`; copied only for a disposable upstream build, including required `web/shared` assets |
| Native environment | CPython 3.11.5, upstream requirements resolved in a fresh venv; `setuptools==80.9.0` required by pinned CTranslate2 4.6.0's `pkg_resources` import |
| Local backend/relay | Bound to `127.0.0.1:18483` / `127.0.0.1:18785`; stopped after recording browser evidence |
| Docker | Desktop CLI present, daemon unavailable; local Python path used |
| Model | Exact `deepseek-flash`; designated primary endpoint/key read from existing local configuration |
| ASR | Native faster-whisper tiny on CPU; model downloaded for this isolated run |
| Visual settings | Native `video_understanding=true`, 6-second frame interval, 3x3 grids |
| Native task | `fc5868a7-6e9c-4ec9-950d-bba979633452` |
| Video identity | BVID `BV1UEaq6qEZt`, CID `42265479965`, one part |
| Duration | Bilibili metadata and browser: 300 seconds; native downloaded-media metadata: 299.306 seconds |

Local scripts, logs, original result and observation records live in the ignored `.runtime/media-validation-20261009/` directory. The scripts are disposable test instrumentation, not production Core/Host adapters.

The native Chroma post-processing also downloaded its default local ONNX MiniLM cache under `C:/Users/55473/.cache/chroma/onnx_models/all-MiniLM-L6-v2`. This upstream default is outside the isolated source directory; it was not deleted. Future isolated runs should configure or contain such library caches explicitly.

The extension build initially exposed two fixture requirements: a nested package workspace is needed to avoid treating the scratch extension as part of Taki's workspace, and the upstream build references sibling shared web assets. The package manager also refreshed an unrelated QQMM tarball checksum in the root lock; that one refresh was restored from the pre-existing installed lock, retaining the existing QQMM dependency edits.

## Native analysis result

The original BiliNote HTTP route accepted the request, ran its native pipeline, and returned a complete readable result through `task_status`. Native backend, ffmpeg and SQLite readiness passed.

- Title: **你应该知道的网页交互术语 01**.
- Time from generation request to readable complete result: **109.515 seconds**.
- Native CPU transcription: **52.604 seconds**.
- Model round trip measured at the relay: **26.344 seconds**.
- Transcript: **246 segments**, through **298.68 seconds**.
- Model input: **5 grid images**, representing **45 of 50 extracted frames**.
- Output: time-associated Markdown covering loaders, page transitions, hero sections, smooth scrolling and scroll-triggered/driven effects.
- Post-result native vector indexing completed with **34 chunks**.

Environment setup, initial model downloads and subsequent vector-index initialization are outside the 109.515-second result-availability measurement. Timings describe this one run, not a performance guarantee.

The isolated backend had no platform Cookie. Its anonymous subtitle requests did not obtain a track, so it used its existing audio/ASR fallback. This does not establish that the logged-in browser has no subtitles. Visible tiny-ASR transcription errors mean transcript/analysis quality still needs review; this was not a quality acceptance test.

## Token and cost evidence

Usage is the actual upstream completion response relayed unchanged to BiliNote. The relay recorded no prompt contents, provider secrets or signed media URLs in the usage ledger.

| Phase | Input tokens | Output tokens | Total tokens | Reasoning tokens included in output |
| --- | ---: | ---: | ---: | ---: |
| Successful text preflight | 34 | 64 | 98 | 62 |
| Successful image preflight on primary endpoint | 228 | 73 | 301 | 62 |
| Native whole-video analysis, one model request | **7,983** | **3,822** | **11,805** | **2,751** |
| Successful responses with reported usage | 8,245 | 3,959 | **12,204** | 2,875 |

All successful responses reported zero cached input tokens. Image-versus-text input token allocation was not provided.

The existing VLM configuration points to a different endpoint/credential. Its `deepseek-flash` preflight returned HTTP 503, with no usage. A subsequent image request to the designated primary endpoint correctly identified a red left half and blue right half; the native video request used that verified primary endpoint. The failed request's usage/cost is **unknown**, not zero.

**Monetary cost is unavailable.** Neither completion JSON, relevant response headers, nor the model-list entry exposed a billed amount or pricing. The model list identifies `deepseek-flash` as owned by `deepseek`, but that does not establish this endpoint's price. Do not apply another product/model's public rate or invent a zero charge.

The **11,805-token** figure covers BiliNote analysis with the settings above. It excludes future Taki commentary generation/revision, OpenBili recommendation processing and any additional validation requests. ASR and native vector embedding in this run used local computation, not paid ASR/embedding API calls.

Native analysis response ID for later billing correlation: `efeb6a0a-3eba-4056-9b21-d6b17d317086`.

## Edge observation evidence

A disposable **Taki Playback Validation** extension observed only the selected video page. It read HTML video state and sent bounded records to a loopback collector with a probe-specific token. It did not request Cookie access, change playback, invoke a model or publish Companion speech.

The owner completed the requested operations. Final evidence contains:

| Check | Observed evidence |
| --- | --- |
| Samples/source lifetime | 248 samples across two document identities |
| Duration | All reported finite durations were 300 seconds |
| Playback progress | 51 qualifying adjacent sample intervals with advancing position |
| Paused state | 161 qualifying adjacent intervals with effectively unchanged position |
| Seek | Position changed from 14.425708 to 64.051094 seconds across 0.125 seconds of observation time |
| Visibility | Both visible and hidden states; six visibility-change events |
| Event vocabulary | Play, playing, pause, seeking, seeked, attachment and ticks observed |
| Sequence consistency | No duplicate/reversed sequence detected after per-document ordering |

This proves basic source observability on this video/Edge instance. It does not prove production Host authentication, generation fencing, selected-part identity across navigation, observation expiry, disconnect handling, playback-driven publication, Stop, or restart recovery.

The original OpenBili extension passed TypeScript declaration build and its Chrome/Edge asset preflight (19 declared script/resource assets). It was not the observer installed for the test, and the OpenBili backend was not started. No native recommendation or feedback acceptance is claimed.

## Confirmed gaps and next implementation work

| Finding | Evidence | Required treatment |
| --- | --- | --- |
| Incomplete final visual grid is discarded | Native `app/utils/video_reader.py` skips groups smaller than the configured grid. 50 frames were extracted, but five 3x3 grids supplied only 45; frames at 04:30–04:54 were omitted. | A scoped upstream correction should preserve the final partial group. Re-test non-divisible frame counts. The measured cost above is for the unmodified behavior. |
| Progress identity diverges during summarization | Native log wrote `<task-id>_markdown.status.json`; polling the canonical task remained TRANSCRIBING until SUCCESS. | Correct native stage/status identity as part of the existing native contract work; do not mask it with invented UI progress. |
| Native output is not the planned structured media contract | Readable Markdown, transcript and metadata were returned, but no validated typed moment/result contract for a bridge consumer exists yet. | Define the small native result projection and stable source identity before wiring Taki commentary. |
| Ordinary Run delivery cannot simply be overwritten repeatedly | Existing source and tests retain one immutable delivery decision per Run. | Prove linked preparation/publication executions or another reviewed reuse of existing owners for multiple utterances. No parallel delivery authority. |
| Result-to-Agent and browser-to-Host adapters remain absent | Existing selected-context builder and actual probe are separate paths. | Add the minimal governed adapters only after their contracts are reviewed. The disposable localhost relay is not that implementation. |
| Environment resolution is not fully pinned upstream | Requirements permit unconstrained transitive setuptools; current release removed an API needed by CTranslate2 4.6.0. | Preserve the verified environment constraint in deployment planning. No production dependency patch was made. |

No extra product ruling is needed to diagnose these findings. Existing M49/M59 capability composition, M51 quota treatment and the other accepted behaviors remain authoritative.

## Gate accounting

| Gate | Current evidence |
| --- | --- |
| V1 | **Partial:** local BiliNote analysis, text/image model, CPU ASR and local vector indexing observed. OpenBili backend, combined service bridge and VPS paths remain untested. |
| V2 | **Not passed:** native source staging/build worked, but Taki Skill-to-Execution-Host file/script locality was not exercised. |
| V3 | **Partial baseline only:** four existing Core test files, **52 tests passed**. No live two-utterance/edit/Stop composition was exercised. |
| V4 | **Partial:** owner-operated Edge source observation passed; production transport and lifecycle remain untested. |
| V5 | **Not exercised:** full Core restart/explicit Continue. |
| V6 | **Not exercised:** the three integrated entries, consent/deduplication and native recommendation/feedback flow. |

Core baseline command:

```powershell
pnpm exec vitest run packages/core/src/db/run-delivery-repo.test.ts packages/core/src/initiative/initiative-context-builder.test.ts packages/core/src/initiative/initiative-runtime.test.ts packages/core/src/delivery/delivery-coordinator.test.ts
```

Next deliverable: review the concrete native result/status corrections, governed result/context and browser/Host interfaces, and the multiple-publication task linkage. Then implement the smallest accepted-task path and repeat the video experiment with actual Taki commentary/revision/Stop. Scheduled preparation should later reuse that same capability path.

## Local artifacts and cleanup

- [Analysis text](../.runtime/media-validation-20261009/video-analysis.md).
- [Sanitized native result](../.runtime/media-validation-20261009/video-result.json).
- [Usage summary](../.runtime/media-validation-20261009/usage-summary.json).
- [Playback summary](../.runtime/media-validation-20261009/playback-summary.json).
- [Source manifest](../.runtime/media-validation-20261009/source-manifest.json).

The temporary backend, model relay and observation collector were stopped after recording evidence. The user may disable/remove **Taki Playback Validation** in Edge. The ignored test environment and result files remain available for review; no production service, source checkout, task lifecycle or remote deployment was modified.
