# core/harness/
- run-service.ts — the single Core-owned Trigger admission and Attempt-aware transition/status writer; stale callbacks are no-ops and snapshot reads finish before its short SQLite admission transaction
- run-snapshot-capture.ts — redaction-safe durable snapshot builder plus process-local immutable Extension and Memory authority bindings
- effect-lifecycle-service.ts — guarded Core effect boundary with contained observability event recording
