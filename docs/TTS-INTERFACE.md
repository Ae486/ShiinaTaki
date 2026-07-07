# TTS Interface (reserved in v1, implemented later)

The Companion's voice is synthesized by a TTS service deployed on the user's VPS — never locally (local inference would violate the low-footprint goal). v1 ships the client interface, settings fields, and audio playback path; no synthesis implementation.

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
