# Permission Authorization Granularity

How the Rust Permission Gate keys an authorization decision. Get this wrong and a persisted "Always" silently
escalates into actions the user never saw — the A1 defect (task `shell-open-persist-fix`).

## The rule: authorize on what determines risk, never on the capability name alone

Split every capability into two kinds by asking *"does the argument change the risk?"*

| Kind | Example | Authorization key | Memory |
|------|---------|-------------------|--------|
| **Fixed-risk** — the action is the same every call | `screenshot`, `process-list`, `clipboard-read` | capability **name** | once / session / always (name-keyed) |
| **Arg-determined risk** — the argument sets the danger | `exec` (command), `shell-open` (target) | `(capability, argClass)` | per class; a safe class may persist, a risky one never does |

Only add name-keyed persistence to a fixed-risk capability. A capability whose argument can move it from "open a
url" to "run cmd.exe" MUST authorize on a derived class, not its name.

## Constraints for arg-determined capabilities

- **Classify in the Rust Gate, fail-closed.** The class is derived from the argument (ADR 0002), never trusted from
  the wire; a malformed/ambiguous argument resolves to the *riskier* class, never a silent one. Control chars or any
  input that could make the executed target diverge from the rendered one → hard-blocked before classification.
- **A persisted allow on one class NEVER authorizes another.** `shell-open:url-safe = Always` must not permit a
  `shell-open:local-exec` open. Decision memory keys on `(capability, argClass)` so cross-class leakage is
  structurally impossible.
- **Risky classes are a bypass-immune floor**: always ≥ ask, never persisted, and unreachable by any future
  "trust/auto" mode. The dialog always shows the concrete argument (never audited).
- **Safe class → silent after Always; risky class → always-ask.** That is the whole point — routine safe actions
  don't nag, dangerous ones can't be rubber-stamped once and forgotten.

Grounding: unanimous across Claude Code (`WebFetch(domain:x)`), Codex sandbox roots, Cline command-globs, OpenClaw
binary allowlist, Hermes bypass-immune rules. This is industry consensus, not a local invention.
