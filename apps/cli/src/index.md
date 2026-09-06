# cli/src/
- main.ts — REPL/operator-call/secret entry with identity load, pairing and complete-command display negotiation
- secret-commands.ts — `taki secret set|clear|presence|list`: the value arrives ONLY via stdin (never argv — no shell history), results print the write-only presence/provenance/health shapes
- repl.ts — readline loop; buffers lines from creation (no lost-EOF hang); drives authenticate then chat per line; bindAsk shares the reader; askOnce for non-REPL prompts
- chat-client.ts — typed WS client with echo-verified connect, chat/history/calls and targeted canonical Approval events/responses
- approval-controller.ts — socket-local FIFO canonical Approval lifecycle; closed/expiry retirement, cancellable input, disclosure, and bounded statuses
- operator-call.ts — the generic non-secret operator method surface: parses `/call <method> [json-params]` (and --call argv), rejects stdin-only secret mutation, and prints JSON or a structured error
- approval-prompt.ts — exact complete-command join or ordinary fields, Chinese approval choices and background-use consent
- recent-history.ts — prints the last few timeline entries oldest-first after auth (AC-2 history-replay demo)
- device-identity.ts — sanctioned node:fs site; ~/.takiagent/cli-device.json {deviceId, token?}, create-on-first-run
