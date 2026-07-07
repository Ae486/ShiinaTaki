# One continuous conversation timeline per character, no session list

The user and a Character share a single continuous conversation timeline — a relationship stream browsable by date — not a ChatGPT-style list of parallel sessions. "Start a new chat" does not exist as a user-facing concept: you don't reset a relationship. Both interaction entries (quick bubble input on the pet, full chat window) read and write the same stream.

Technically, LLM context-window management (compaction, pre-compaction memory flush per MEMORY-DESIGN) happens behind the scenes and is invisible in the UI; the stored timeline is append-only and never truncated by context limits.

Why an ADR: this fixes the conversation storage model (one append-only stream per character keyed by date, not a sessions table), which is expensive to change after messages accumulate, and contradicts the default chat-app shape a future contributor would assume.
