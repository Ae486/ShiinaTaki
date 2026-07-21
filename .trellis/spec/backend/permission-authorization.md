# Permission Authorization Granularity

How the Rust Permission Gate keys an authorization decision. Get this wrong and a persisted "Always" silently
escalates into actions the user never saw — the A1 defect (task `shell-open-persist-fix`).

## The rule: authorize on what determines risk, never on the capability name alone

Split every capability into two kinds by asking *"does the argument change the risk?"*

| Kind | Example | Authorization key | Memory |
|------|---------|-------------------|--------|
| **Fixed-risk** — the action is the same every call | `screenshot`, `process-list`, `clipboard-read`, `clipboard-write` | capability **name** | once / session / always (name-keyed) **+ Level-projected** (T2b batch D: bare name is its cell key, ridden through `evaluate_by_class`) |
| **Arg-determined risk** — the argument sets the danger | `exec` (command), `shell-open` (target) | `(capability, argClass)` | per class; a safe class may persist, a risky one never does |

Only add name-keyed persistence to a fixed-risk capability. A capability whose argument can move it from "open a
url" to "run cmd.exe" MUST authorize on a derived class, not its name.

## Constraints for arg-determined capabilities

- **Classify in the Rust Gate, fail-closed.** The class is derived from the argument (ADR 0002), never trusted from
  the wire; a malformed/ambiguous argument resolves to the *riskier* class, never a silent one. Control chars or any
  input that could make the executed target diverge from the rendered one → hard-blocked before classification. A
  class key with no governance cell registered is a wiring bug → deny + warn, never ask/allow (same fail-closed
  stance, `Gate::evaluate_by_class`).
- **A persisted allow on one class NEVER authorizes another.** `shell-open:url-safe = Always` must not permit a
  `shell-open:local-exec` open. Decision memory keys on `(capability, argClass)` so cross-class leakage is
  structurally impossible.
- **Risky classes are never-persisted and store-immune.** No `Always` record is ever written for them (any human
  allow is once-only), and a seeded/tampered store entry under their key is ignored — no stored grant, legacy
  name-keyed or class-keyed, can ever silence them. Their ask floor holds in `strict`/`standard`; the
  owner-ratified `relaxed` (yolo) tier auto-runs them — still audited, still never persisted (T2b prd 2026-07-20,
  superseding the earlier "always ≥ ask in every mode" wording). The tier-immovable region is the deny-by-default
  floor below (§ Permission Level). The dialog always shows the concrete argument (never audited).
- **Safe class → silent after Always; risky class → always-ask below relaxed.** That is the whole point — routine
  safe actions don't nag, dangerous ones can't be rubber-stamped once and forgotten.

Grounding: unanimous across Claude Code (`WebFetch(domain:x)`), Codex sandbox roots, Cline command-globs, OpenClaw
binary allowlist, Hermes bypass-immune rules. This is industry consensus, not a local invention.

> Citation keys below ([OC-*] OpenClaw, [CC-*] Claude Code, [CX-*] Codex, [H-*] Hermes) resolve in the T2b
> research bank: task `07-20-capability-governance/research/ra-permission-capability-governance.md` §0.

## Permission Level: a three-tier registry-driven projection

`PermissionLevel = strict | standard | relaxed` (zod enum in `@taki/shared`, serde-mirrored; CONTEXT.md owns the
naming — the mechanism is the unanimous ordered-preset pattern [OC-PM][CC-PM][CX-SEC]). Default `standard`.

- **A Level is a PROJECTION over per-cell postures (auto/ask/deny), never a second enforcement path or a stored
  authority.** Every request still crosses the one Gate; the Level only selects each cell's baseline posture.
  Source: OpenClaw "approvals can only tighten… never loosen" [OC-EA]; Claude Code "Modes set the baseline. Layer
  permission rules on top." [CC-PM].
- **The projection is registry-driven, never a hard-coded per-capability switch.** Each capability declares a
  `CapabilityGovernance` descriptor (its cells' per-Level postures + its floor set); `project_level` folds over
  the registry (`gate/governance.rs`). Adding a capability = one descriptor + one `factory()` entry; adding a
  Level = one enum member + a posture per cell. Source: research §5.1/§5.3 [OC-POL][OC-PM].
- **Stricter-wins composition.** Effective decision = the stricter of (Level projection, the user's explicit
  stored verdict, the floor). Concretely: a stored `Never` denies even an auto tier; a Level `deny` consults no
  store (a stored `Always` cannot lift it); the floor precedes everything. Source: [OC-EA] tighten-only;
  [CC-PM] deny/ask rules survive every mode.
- **`relaxed` = yolo, not `full`.** Everything outside the deny-by-default floor runs with no prompt — but every
  tier still writes the audit log, and `relaxed` cannot touch the floor. Source: Hermes hardline-below-yolo
  [H-APR:333-357]; Claude Code keeps a circuit breaker even in bypass [CC-PM]. We deliberately reject the
  OpenClaw `full` / Codex `danger-full-access` no-floor shape because Windows v1 has no sandbox blast-radius
  backstop (ADR 0002; research §Caveats).
- **The Level is frozen out of the agent's reach.** Read once from `permission-level.json` (node data dir) at
  `build_node`; missing/corrupt/unknown → `standard` (fail-SAFE, never `relaxed`); the file shape is the wire
  shape (`PermissionLevelState`). Only the operator surface (`permission.levelSet`, panel #23) writes it — the
  agent has no path. Source: Hermes yolo-frozen-at-import [H-APR:32-35].

## Level × scope × allowlist are ORTHOGONAL (do not conflate)

Three layers, composed stricter-wins; the existing once/session/always store and the exec allowlist are UNCHANGED
(T2b prd, owner-ratified):

1. **Classification** (allowlist / scheme / path-root) → which `(capability, argClass)` cell this request is.
2. **Level projection** → that cell's baseline posture (auto/ask/deny) in the active tier.
3. **once/session/always** → the memory scope of the human's answer, ONLY when layer 2 says ask.

A Level is not a scope and a scope is not a Level: switching tiers never edits the store, and answering a dialog
never moves the tier. Never-persisted cells produce no `always` record in any tier, so no "old always vs new
floor" conflict can exist. Source: [CC-PM] modes-baseline + rules-on-top layering; the scope store is D7.

## The deny-by-default floor

- **The floor is SET MEMBERSHIP, not a code path** (research §5.4): a class key listed in a descriptor's
  `floor_classes` is denied in EVERY tier, checked before any store consult (a seeded `Always` under a floor key
  is inert). No per-capability branching in the gate. Source: Hermes hardline-as-a-list [H-APR:417-454]; Claude
  Code circuit-breaker set [CC-PM].
- **The factory floor rows** (prd table): sensitive sub-targets (`.env*`, `id_rsa`/private keys, `.git`, `.ssh`)
  [CX-PERM deny-wins-over-write; H-EDIT:45-48,192-197]; the self-escalation surface (gate/policy/Level/permission
  files) [H-APR:262-275 "config IS policy"]; catastrophic commands (`rm -rf /`, `mkfs`, `format`) [CC-PM
  circuit breaker even in bypass]. Registered on the same seam (all landed): `shell-open:blocked` (A),
  `exec:blocked` (B), `fs-write:sensitive` + `fs-write:self-escalation` (C).
- **User-configurable via the panel ONLY; agent-immovable.** A deny-by-default cell may be changed over the
  operator surface (`permission.cellSet` carrying the `secondConfirm` marker — a prominent re-ask, not a plain
  toggle); the agent has NO code path that writes a decision, flips a Level, or edits the floor. Immovability is
  against the agent (anti-injection / anti-model-error), not against the user (prd, owner-ratified 2026-07-20).
- **Managed-floor seam reserved.** A future managed deployment may pin a maximum Level or freeze floor cells so
  the user cannot cross them either; v1 personal builds do not enable it — the shapes must not preclude it.
  Source: Claude Code `disableBypassPermissionsMode` [CC-SET]; Codex managed `requirements.toml` [CX-CFG].

## NL-authorization red line (conversational grants)

1. **A grant expressed in conversation is inert until it passes the ordinary Approval flow.** "Yes, always allow
   screenshots" is a *signal to raise the Approval dialog*, never itself a grant — decision memory is written
   ONLY by the gate's human-answer arm, keyed `(capability[, argClass])`, exactly as a dialog answer. Source:
   [CC-PM] deny/ask apply in every mode; Hermes permanent allowlist written only inside the human-answer branch
   [H-APR:2846-2851].
2. **The agent has no tool that writes a decision, flips a Level, or edits the policy file.** The policy/Level
   store is operator-role only (mirror of `approval.respond` being an operator method). Source: Hermes "config IS
   policy… agent could flip approvals.mode=off and bypass" — both file-write and shell paths denied
   [H-APR:262-275]; yolo frozen at import [H-APR:32-35].
3. **Level / bypass state is frozen out of the agent's reach** — read at load, never from a value the agent can
   influence within a turn. Source: [H-APR:32-35].
4. **Injection-amplification is assumed.** A conversational grant is untrusted: it cannot widen scope beyond what
   the dialog shows, and a denied action tells the model not to retry/rephrase/re-route. Source: Hermes
   smart-review XML-delimiting + "do NOT rephrase… via a different path" [H-APR:2585-2602, 2791-2802].

Pinned by two RED-proof tests in `gate.rs`: `a_conversational_grant_is_inert_without_an_approver_allow` (an
agent-injected "always allow" detail with a human Deny writes nothing and allows nothing) and
`decision_memory_has_exactly_one_production_writer` (a source sweep: `.remember(` has exactly one production call
site — the gate's human-answer arm). Both verified red under a flipped guard before landing.

## Registered cells & the batch B/C/D contracts

The authoritative per-cell factory postures live in `gate/governance.rs::factory()` (defaults; #23 overrides them per prd — do not duplicate the table here, it drifts). Registered capabilities:

- **shell-open** (A): `url-safe` (persist), `local-file` / `local-exec` (never-persist, ask below `relaxed`); floor `blocked`.
- **exec** (B): `simple-allowlisted` (auto below `relaxed`; `strict:ask`), `compound` / `shell-reentry` / `allowlist-miss` (ask below `relaxed`); floor `blocked` (the catastrophic blocklist). **exec keeps its OWN gate front door `evaluate_exec`** — it is the ONLY capability whose command rides the AUDIT line (ruling 9); `evaluate_by_class` audits `command:None`, so exec routes through the governance registry (`is_floor`→`cell`→`posture`) while keeping `audited_exec(Some(command))` on every arm and NEVER touching decision memory (ruling 8: exec ask is always once-only). Operator `Mode::Deny` → `ExecClass::Disabled` → direct deny.
- **fs-write** (C — FOUNDATION, no live out-of-Workspace handler yet, marked "not in production path"): `in-workspace` (auto), `outside-root` / `skill-hook` (never-persist, ask below `relaxed`), the DYNAMIC `dir-root:<root>`; floors `sensitive` (`.env*` / private keys / `.git` / `.ssh` — ANY path component) + `self-escalation` (permission-surface files: gate-decisions / exec-policy / permission-level.json). Classifier precedence is floors-FIRST — a `.env` inside an authorized root is still the sensitive floor (stricter-wins).
- **fixed-risk** (D + T3a): `screenshot` / `process-list` / `clipboard-read` / `clipboard-write` / `foreground-window` — name-keyed cells, Level-projected by riding `evaluate_by_class` with the bare capability name as the cell key. Factory default `{strict:ask, standard:ask, relaxed:auto}`, `persist:true`. **`standard:ask` DEVIATES from the prd table's `auto`** (owner-ratified 2026-07-21): a gated/sensitive capture or read must not auto-run at the default tier; `relaxed`=yolo still runs them with no prompt — closing the gap where fixed-risk previously prompted even under yolo. User-editable via #23. **`foreground-window` (T3a) is POLLED — ask-over-poll etiquette**: the Core sampler raises at most ONE approval dialog per session (first tick under an ask posture); a session/always answer silences later ticks via the ordinary DecisionStore, a deny (explicit or dialog-timeout) stops the sampler for the rest of the session (quiet — no per-tick re-prompt, Recall off-is-silent stance), and its `detail()` line must keep disclosing that window TITLES are sampled (informed grant).

**Dynamic per-target keys (dir-root).** A key may carry a free-form third segment (`fs-write:dir-root:C:\A`). Its PROJECTION cell is the two-segment FAMILY (`fs-write:dir-root`): `GovernanceRegistry::cell()` tries an exact match FIRST, then falls back to the family for a three-segment key (static keys unaffected; a two-segment miss stays `None`). Its DECISION MEMORY keys on the FULL three-segment key, so an `Always` on one root NEVER authorizes another (**R1**, structural). `dir-root` is `persist:true` (a specific root may be granted `always`); capping the offered scope to `session` is a #23 dialog concern (D41), not a Core cap.

**`relaxed` overrides exec `Mode::Full` (not `Mode::Deny`).** The exec-policy `Mode` (deny / allowlist / full) sets the CLASS; the Level sets the POSTURE. At `relaxed`, a `Mode::Full` command projects to auto (the escalate family is `relaxed:auto`) — yolo runs everything outside the deny floor, and `Mode::Full`'s "always ask" is not a floor (owner-ratified 2026-07-21). `Mode::Full` still asks at `strict`/`standard`. `Mode::Deny` is the separate operator-off (`ExecClass::Disabled`, deny in every tier).

**D3 argv[0] resolution — accurate threat model.** Rust `std::process::Command` ALREADY excludes the child cwd for a bare name (rust#87704 / CVE-2021-3013), so the classic bare-name cwd hijack is std-mitigated. The D3 fix (`capabilities_impl/exec/resolve.rs`) closes the LIVE residuals: a **relative** `argv[0]` (`./git`) whose basename matches the allowlist, plus defense-in-depth — spawn the cwd-EXCLUDED-PATH-resolved ABSOLUTE path so classify and spawn refer to the same binary. See the `resolve.rs` header; research §1.4/§4 carry the corrected framing (the earlier "`CreateProcess` searches cwd before PATH for `Command::new`" premise was inaccurate for our spawn path).
