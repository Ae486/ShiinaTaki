# Prompt cache live verification — 2026-08-28

## Scope and privacy

- Provider configuration came from the operator-authorized `H:/TakiAgent/.env.local` through the key-gated E2E seam.
- Each run used a fresh temporary Core data directory, random loopback port, canonical Local memory, 72 deterministic
  history rows, no Node process, and no conversation summary.
- Evidence contains provider/model names and token counts only. Prompts, credentials, raw tool payloads, provider
  bodies, raw Run/Attempt/effect ids, and reply text were neither printed nor persisted here.
- Structured Timeline parts proved `get_current_time` was called; the names-only tool name is the only tool evidence.

## Before

The reproduced production baseline used comparable long requests with approximately 68,500 input tokens and exactly
6,912 cache-read tokens, approximately 10.1%.

| request | provider | model | input | no cache | cache read | ratio |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| reproduced baseline | configured OpenAI-compatible upstream | deepseek-v4-flash | ~68,500 | ~61,588 | 6,912 | ~10.1% |

## After — isolated run 1

| request kind | provider | model | input | no cache | cache read | ratio | output | quality |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| tool turn | taki-provider.chat | deepseek-v4-flash | 59,890 | 56,178 | 3,712 | 6.20% | 60 | reported |
| tool continuation | taki-provider.chat | deepseek-v4-flash | 60,037 | 133 | 59,904 | 99.78% | 87 | reported |
| new conversational Turn | taki-provider.chat | deepseek-v4-flash | 60,100 | 324 | 59,776 | 99.46% | 9 | reported |

Comparable follow-up improvement over the 10.1% baseline: +89.36 percentage points.

## After — isolated run 2

| request kind | provider | model | input | no cache | cache read | ratio | output | quality |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| tool turn | taki-provider.chat | deepseek-v4-flash | 59,891 | 56,179 | 3,712 | 6.20% | 73 | reported |
| tool continuation | taki-provider.chat | deepseek-v4-flash | 60,051 | 147 | 59,904 | 99.76% | 143 | reported |
| new conversational Turn | taki-provider.chat | deepseek-v4-flash | 60,104 | 328 | 59,776 | 99.45% | 8 | reported |

Comparable follow-up improvement over the 10.1% baseline: +89.35 percentage points.

## Result

- Both fresh-data runs met the 55k-80k comparable-input band.
- Both follow-up first requests exceeded the 50% cache-read gate and the +30 percentage-point improvement gate.
- Every request after each cold first request reported positive cache reads.
- Normal replies completed and one harmless Core tool path was proven in each run.
- Reported arithmetic held for every row: `input_no_cache_tokens + cache_read_tokens == input_tokens`.

An initial 80-row fixture crossed an existing post-tool window-calibration boundary because multi-step aggregate usage
updates one per-turn calibrator sample. Reducing the deterministic fixture to 72 rows retained comparable long input
while keeping both Turns below window movement, as required by the acceptance protocol. No threshold was lowered and
no memory/window production behavior was changed.
