# Native image input

## Scope / Trigger

User images, explicit screenshots, opaque Host screenshot tools and selected ambient/viewing evidence use the configured primary model. The owner retired the separate vision slot and image-to-text translators on 2026-11-02. This contract governs request transport, retained replay and temporary observation lifetime; it does not introduce an image meter or permanent visual memory.

## Signatures

`ChatAgentDeps.acquireNativeImageContext?: () => NativeImageContext | undefined` supplies an optional foreground observation. Trusted initiative preparation supplies `TurnContext.nativeImageContext` through `{ text, nativeImageContext? }`.

```ts
interface NativeImageContext {
  readonly images: readonly ImageAttachment[];
  readonly context: string;
  readonly sourceContext?: SourceContext;
  isCurrent(): boolean;
  release(): void;
}
```

`createConversationStore({ ..., attachments })` uses a confined retained-image reader. User image parts and optional tool-result `imageRefs: { mediaType, ref }[]` reference the existing attachment namespace. The Timeline repository must retain this Shared field; declaring it in Zod alone does not preserve it through `sanitizeParts`.

`createExtensionComposition` accepts explicit `projectScreenshot` and `projectAmbientScreenshot` callbacks, applied only to their captured Host capability bindings. Trusted transient native sidecars carry pixels separately from enumerable tool output.

## Contracts

- `TAKI_PROVIDER_*` selects the single primary text/image model. Retired `TAKI_VLM_*` configuration is not loaded, displayed or used as a fallback. Existing stored rows and past description/usage records remain historical data.
- SDK user FileParts carry raw base64 or bytes; the installed compatible adapter produces HTTP `image_url` parts. Do not place a data URL into the SDK raw-data field or stringify pixels into tool JSON.
- The compatible adapter does not enable multipart tool content by default. Completed screenshot results retain their status/call IDs; native image messages follow the complete tool-result message in the same next request. The projection is idempotent across steps.
- Source attribution follows the producer: a screenshot transported with user role is tool evidence, not new user input. Do not identify an image by recursively guessing third-party JSON fields.
- Explicit screenshots use attachment references for later selected replay. Ambient screenshot tools keep only temporary sidecars; they do not save attachment refs or raw pixels into Timeline/selected-context records.
- Standard MCP image blocks and image-resource blobs are declared media, not guessed JSON. Normalize them through the same native tool projection after governed execution, for direct tools and `extension_call`. Preserve non-image blocks, structured content and error status. Supported store formats get refs; other explicitly declared image MIME types remain native but transient. Legacy explicit SDK image/file content is normalized at read time without rewriting stored rows.
- Private worker replay must hydrate retained images and associate temporary sidecars with exact completed rows before its own tail/summary budget decision. An outer primary projection alone does not cover DB-reconstructed child context; see [Private Worker Context](private-worker-context.md).
- Candidate loading, fold cost, history selection and complete-request measurement account for retained native images together. Use the existing estimator and provider total; never hydrate unpriced images after a text-only admission decision or count base64 as text.
- Expired/missing original images produce explicit unavailable evidence. Reads do not refresh TTL or rerun capture. Context selection/compaction still bounds replay; retained files are not a new permanent image memory guarantee.
- One latest ambient frame may be leased for one Attempt. Check source/currentness immediately before each model dispatch, omit invalid optional observations without refusing valid text/tool work, and release in `finally` on success/failure/cancellation. Fresh frame replacement and consent/Host retirement invalidate the old lease.
- Ambient `drop` means disposal after consumption, expiry, replacement or withdrawal. Pending/in-use frames are protected from ordinary GC; startup removes crash leftovers. `keep` and days remain explicit retention settings, while withdrawal overrides them.
- Keep deterministic capture screening and source authority. The removed translator's programmatic `SENSITIVE_SCREEN` barrier is not preserved before the main model: main sees permitted pixels and makes its normal judgment. Concise trusted abstention guidance belongs outside the untrusted evidence fence; do not claim it is an equivalent programmatic output filter or add another classifier call.

## Validation and error matrix

| Condition | Required result |
| --- | --- |
| Primary configured; no VLM config | Native input works through the primary route |
| Obsolete partial VLM config | Does not prevent boot or become a hidden slot |
| User image storage unavailable | Refuse before persisting an unusable user image row |
| Retained image expired/missing | Explicit unavailable part; no automatic recapture |
| Ambient consent/source retired | Omit optional pixels, release their lifetime; valid user work continues |
| Screenshot capture/storage refused | Preserve structured tool failure; no synthetic visual success |
| Arbitrary tool returns screenshot-shaped JSON | Do not promote it to trusted native image evidence |
| Catalog lookup unknown/unavailable | Do not block native transport or invent endpoint capabilities |

## Good, base and bad cases

- Base: a text-only conversation uses the existing main request and tools.
- Good: a screenshot tool completes once; its next request contains one native image and one corresponding result; a later selected replay uses only retained references.
- Good: a pending ambient frame expires before dispatch; the main request proceeds without stale pixels and no translator call is made.
- Bad: changing the translator's model to primary while keeping a separate caption call; storing base64 in tool output; counting only text before image hydration; accepting a same-name untrusted tool as a trusted capture.

## Tests required

- `agents/native-image-wire.test.ts`: real installed serializer, primary route, direct/opaque screenshot continuation, per-step image uniqueness, no byte JSON, repository round-trip/replay and budget selection.
- `agents/chat-agent-images.test.ts`: primary without vision, image-only input and observation cleanup for normal/error/cancel endings.
- Perception and viewing suites: exact frame identity, withdrawal/expiry/replacement, live GC protection, native prepared input, and byte-free persisted decision/evidence.
- Bootstrap/config tests: obsolete vision settings are inert; primary and utility behavior remains valid.
- Bounded real-provider verification establishes the selected endpoint's actual image support; fixtures prove transport, not visual accuracy. Core startup and real UI checks remain separate gates.

## Wrong versus correct

Wrong: return `{ image: base64 }` as ordinary tool JSON and infer the model saw it.

Correct: preserve byte-free tool status, attach native media through the trusted capture sidecar, inspect the actual request for `image_url`, and verify the main model's visual response separately.
