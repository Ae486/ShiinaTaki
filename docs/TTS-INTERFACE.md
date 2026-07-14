# TTS Interface (reserved in v1, implemented later)

The Companion's voice is synthesized by a TTS service reached over HTTP — deployed on the user's VPS in production, but **validated locally first**: the same backend runs on `127.0.0.1` during development, and moving to the VPS is a base-URL settings change with zero code impact (BandoriPet's local Qwen3TTS at `127.0.0.1:9880` validates this usage). Synthesis never runs inside TakiAgent's processes (low-footprint goal). v1 ships the client interface, settings fields, and audio playback path; no synthesis implementation.

## Wire contract

OpenAI-compatible endpoint, chosen so any mainstream TTS backend (GPT-SoVITS, fish-speech, Qwen3TTS gateways, xinference) can sit behind it without custom protocol work:

```
POST {base_url}/v1/audio/speech
Authorization: Bearer {api_key}
Content-Type: application/json

{
  "model": "<backend-defined>",
  "input": "<text>",
  "voice": "<voice id, resolved from the active Character's voice profile>",
  "response_format": "mp3 | wav | opus",
  "speed": 1.0
}
```

Response: audio bytes (chunked transfer preferred for latency; client must handle both streamed and buffered responses).

## Client-side design (Agent Core)

- `SpeechProvider` interface: `synthesize(text, voiceProfile) -> AudioHandle`. Single built-in implementation targets the contract above; the interface exists so a different backend shape never touches call sites.
- Per-Character voice mapping: a Character's profile carries `voice` (and optional backend-specific extras as an opaque passthrough object, e.g. reference-audio id for cloning backends).
- Local cache keyed by hash(text, voice, format) to avoid re-synthesizing repeated utterances.
- Timeouts and graceful degradation: TTS failure never blocks the text reply; the bubble renders regardless.

## Pet UI

Playback via WebAudio. Lip-sync drives `ParamMouthOpenY` from output amplitude — a factor in the Live2D renderer spike (untitled-pixi-live2d-engine ships native lip-sync).

## Presentation timing + open design questions (discussion 2026-07-14 — NOT implemented in v1; recorded so #16 leaves the right seams)

**Nothing here is built until #31.** These rulings exist only so the #16 avatar/bubble work reserves compatible seams (high-cohesion/low-coupling; no rework when TTS lands). All character-specific data (voice profile, clip library, thresholds) lives in `characters/<id>/` files — never hardcoded (invariant 7).

- **Display timing = TTS-ready is the single trigger.** When TTS is ON, the reply's text bubble + avatar expression/motion + audio all surface together when synthesis returns (llm-latency + tts-latency). When OFF, "audio ready" is immediate ⇒ llm-latency + 0ms. **Whole-reply granularity, NOT per-sentence chunking** — rejected sentence-segmentation (2026-07-14): it adds "who splits / mid-word cuts / inter-segment timbre jumps" for a wait-time that isn't severe, because taki's replies are short by persona and short-text synthesis is ~1-2s. Neuro-sama-style instant streaming serves long improvised monologue — not our case. #16 builds only a presentation seam keyed on a "ready" signal; v1 (no TTS) = ready-immediately = plain streaming bubble.
- **TTS is a pipeline stage, NOT an LLM tool.** "Read my own reply aloud" is a presentation policy (config: on/off, voice, threshold), not a model decision — making it a tool wastes tokens, risks the model forgetting to call it, and invites the model to retry/apologize on failure. The synthesis stage owns: on/off check, char-count threshold (skip synthesis over the limit → that reply is text-only, shown immediately; LLM never knows), and mechanical text sanitization (strip markdown/code/URLs before synthesis — deterministic cleanup, NOT a second content version). TTS failure/timeout ⇒ degrade to text-only, never blocks the reply.
- **Emotion for TTS — reuse the avatar emotion signal, do NOT add a TTS tool.** Open, engine-dependent (decide at #31): if the engine infers tone from text → pipeline-automatic, LLM uninvolved. If the engine needs an explicit emotion param → that "which emotion" IS a performance decision, so reuse the SAME emotion tag the LLM already sets via `avatar.set_expression` — one signal, two consumers (avatar + TTS), never a separate TTS tool.
- **Single content, two synchronized channels** (text + voice), never "one version for text, one for voice" (splits the persona, doubles tokens). "Acting in character" is the persona card's job — taki's replies must be speakable as written.
- **Signature pre-recorded clips + TTS mix.** Some utterances are character-signature ("哈？") that TTS can't nail → a voice-clip resolution stage: each reply unit first checks the character's clip library (`characters/<id>/voice-clips/` + a trigger-phrase→file map, a data file), hit ⇒ pre-recorded, miss ⇒ TTS. Constraint: pre-recorded clips are whole-utterance/sentence-level only — NO mid-sentence splicing of recorded+synthesized (timbre break sounds bad). Lip-sync treats recorded and synthesized audio identically (both are audio segments).
- **Engine note**: user currently has `so-vits-svc` + `RVC` locally — these are SVC (voice/timbre conversion), NOT TTS (they convert existing audio, don't synthesize from text). Likely final shape = a TTS engine generates speech + optional SVC converts it to taki's timbre. Engine choice (and whether these suffice) is deferred to #31, decided then against current stable options via web research + BANDORI's `tts_manager.py` (its verified segmentation/emotion/trigger strategy is the reference — see `live2d-presentation-analysis.md` §6), not designed from scratch here.
