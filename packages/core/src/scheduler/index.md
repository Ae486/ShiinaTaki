# core/scheduler/
- sweep-runner.ts — shared boot/6h retention scheduling; synchronous legacy sweeps and non-overlapping asynchronous provider sweeps, post-success counts, bounded failures and an explicit stop handle
- schedule-pattern.ts — narrow Croner adapter for canonical at/every/cron validation and deterministic next-slot calculation
- scheduled-task-service.ts — shared revision-safe command boundary and transaction-local recomputation of future user-zone cron slots
- schedule-engine.ts — durable catch-up/re-arm lifecycle with single-flight unref timers, refreshed due-row validation and occurrence dispatch
- scheduled-run-adapter.ts — Scheduled TriggerRequest through RunService/Character queue/ChatAgent; only settled final-step text enters shared Class A delivery
- schedule-task-tool.ts — primary-turn-only action-discriminated schedule_task Agent tool
