# core/harness/
- run-service.ts — Core-owned Trigger admission and Attempt-aware lifecycle; process-local bindings/names remain separate from snapshot capture and atomic event-write rollback
- run-snapshot-capture.ts — redaction-safe durable snapshot builder plus process-local Extension/Memory bindings and frozen tool names excluded from authority digests
- effect-lifecycle-service.ts — guarded Core effect boundary with contained observability event recording
