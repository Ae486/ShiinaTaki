# core/harness/
- run-service.ts — the single Core-owned Trigger admission and Attempt-aware transition/status writer; stale callbacks are no-ops, restored contexts must match persisted memory admission evidence, and snapshot reads finish before its short SQLite admission transaction
- run-snapshot-capture.ts — redaction-safe snapshot builder carrying caller cancellation and explicit Run deadlines through memory admission; keeps exact provider/capability/tool/recall/prompt bindings process-local
- effect-lifecycle-service.ts — guarded Core effect boundary with contained observability event recording
