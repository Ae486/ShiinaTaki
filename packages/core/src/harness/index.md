# core/harness/
- run-service.ts — Core-owned Trigger admission and Attempt-aware lifecycle; execution bindings and display names remain process-local, with snapshot reads before the short admission transaction
- run-snapshot-capture.ts — redaction-safe durable snapshot builder plus process-local Extension/Memory bindings and frozen tool names excluded from authority digests
- effect-lifecycle-service.ts — guarded Core effect boundary with contained observability event recording
