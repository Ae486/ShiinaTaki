# core/scheduler/
- sweep-runner.ts — the shared retention-arm shape (boot sweep + unref'd 6h interval + one count-only log line); consumed by the attachment GC, the ambient-frame GC and the memory retention sweeper. Not the croner scheduler (D5): these are internal housekeeping timers, not user-visible schedules
- schedule-pattern.ts — narrow Croner adapter for canonical at/every/cron validation and deterministic next-slot calculation
- scheduled-task-service.ts — shared revision-safe command boundary used by operator methods and the Agent tool
- schedule-engine.ts — durable catch-up/re-arm lifecycle with single-flight unref timers and occurrence dispatch
- scheduled-run-adapter.ts — Scheduled TriggerRequest to RunService, Character queue, and non-primary ChatAgent adapter
- schedule-task-tool.ts — primary-turn-only action-discriminated schedule_task Agent tool
