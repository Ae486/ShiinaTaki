# Flow simplification, configuration-independent startup, and live configuration

## Goal and authority

Let users enter TakiAgent without unnecessary setup steps, start with empty or incomplete configuration, and configure or reconfigure features while the application stays running.

On 2026-11-09 the owner corrected the installation-first framing and confirmed this scope. The owner subsequently authorized development: first trace the actual startup paths and their interactions, then choose the split/change strategy and verify the result in real execution. This scope supersedes the initial-delivery scope in the older installation assessment. The task path stays stable; implementation is active, with S0 startup/baseline work first.

The success path is: start the existing Core/Desktop entry points -> Home without a local connection code -> use available surfaces -> configure a model -> receive a reply -> change configuration -> observe its effect without application restart. One installer and automatic Core process ownership remain later goals, not prerequisites for this slice.

## Requirements

1. **Direct local entry.** Home is the useful entry surface. Same-user, same-machine Core/Desktop operation requires no copied connection code or standalone connection/status page. Either process may start first; installer integration is not required.
2. **Configuration-independent startup.** Missing Main/Utility fields, credentials, Character assets, Live2D, or optional integrations do not prevent Core configuration/control services or Home from opening. A prerequisite affects its dependent feature, not the entire application.
3. **Dependency-scoped availability.** Distinguish connectivity, saved configuration, active configuration, actual call outcomes, and resources. History/configuration/resource management remain useful without Main. An independently configured Utility slot may still run eligible maintenance.
4. **Small configuration flow.** Save incomplete model drafts. Group related fields and offer one ordinary save/apply action for a complete candidate. Connection tests are optional, explicit, and disclose cost. Catalog lookup and successful test calls do not gate saving or activation. Compatible keyless services are supported.
5. **Live configuration beyond first activation.** Assess all 84 current registry settings: 31 restart, 52 live, and one data-root setting. Remove avoidable restart requirements at consumers. Do not equate changing the registry label with applying a value.
6. **Coherent operation boundaries.** New chat Runs, including the next message in the same continuous conversation, and new background operations use applied settings. Admitted work, queued Runs, retries, and continuations retain their capture. Immediate privacy restrictions still apply promptly. Model identity, credentials, limits, prompts, and usage must agree.
7. **Explicit clear/reset behavior.** An incomplete saved draft does not replace a working active profile. Explicit disable/clear stops new dependent admissions. Reset-to-default, Utility inheritance, and secret removal are distinct; invalid explicit Utility settings cannot silently spend on Main.
8. **Recoverable application.** Failed preparation/application preserves the last usable configuration and user data. Reconcile unknown RPC outcomes before retry. Shell identity/optional-adapter failures leave Home recovery reachable. Never replace unreadable storage with an empty profile.
9. **Necessary checks at the right boundary.** Remove setup-only and redundant gates. Retain input correctness, operation permissions, data integrity, and actual identity validation without exposing local enrollment steps. Automatic connection grants no extra Node capability.
10. **Optimize the actual product.** Completion requires a simpler user journey and preserved responsiveness/resource behavior, not only functional checklist coverage. Do not replace removed steps with more confirmations, technical concepts, duplicate configuration, or manual recovery. Prefer changes that reduce custom logic and ongoing maintenance. Suitable frameworks and libraries are explicitly allowed when their integration improves the result.

## Acceptance criteria

- [ ] An empty isolated profile starts Core control/configuration services and opens Home through existing entry points, without an installer or automatic Core launch prerequisite.
- [ ] Core-first, Desktop-first, reconnect, and subsequent launch require no local code for Shell Node or Home/Pet/Chat operators. Unrelated clients gain no trust from loopback alone; existing roles and permissions remain correct.
- [ ] Incomplete model drafts survive reconnect/reopen and remain editable. Model-dependent requests are unavailable without trapping other surfaces behind setup. No model test is dispatched automatically.
- [ ] Completing a valid Main profile enables a first reply without restarting either process. Keyless compatible fixtures work. Custom model IDs need no catalog approval; provider failures reflect actual evidence.
- [ ] Model/credential/prompt/limit changes reach a new Run in the same conversation. Concurrent old/queued/retried work retains its capture, and identity/usage match the actual request.
- [ ] Every registry setting has a consumer/application classification and appropriate evidence. Applicable hot changes work; irrelevant backend settings are identified. Any retained process-restart requirement has a specific reviewed technical reason.
- [ ] Privacy disable retires evidence promptly. Retention changes state their effect on existing data. Tokenizer updates keep indexes and queries coherent.
- [ ] Main disable, Utility inheritance/disable, candidate failure, secret-storage failure, competing edits, and dropped apply acknowledgements produce distinct recoverable outcomes without changing unrelated ownership.
- [ ] Missing avatar resources, renderer failure, unavailable optional integrations, and malformed optional Shell configuration preserve Home access and available text functionality. Feature repair does not duplicate workers/subscriptions.
- [ ] UI distinguishes saved, active, applying/maintenance, unavailable, failed, and unconfirmed observations; drafts and last-confirmed reads survive reconnect.
- [ ] Before/after user journeys show fewer necessary steps without new routine confirmations, mandatory tests, or technical setup burdens. Internal state machinery remains behind concise user-facing actions and feedback.
- [ ] Comparable local measurements cover Home/basic-service startup, idle CPU/memory, local request overhead, configuration application/reconnect, and repeated-update resource cleanup. Supported existing paths have no unresolved performance regression; new paths meet budgets established from the baseline. Functional checks alone cannot close this criterion.
- [ ] Deterministic, real-process/native UI, and owner acceptance are recorded separately. Paid-model validation needs its own authorization.

## Boundaries

- Owner correction on 2026-11-10: another task owns dedicated Hindsight work.
  Preserve Hindsight's existing connection, synchronization, recovery, write, Bank,
  fingerprint and authority logic. Any unavoidable shared startup/Utility adapter
  change must be recorded in [the dedicated change record](research/hindsight-change-inventory-20261110.md).
  Hindsight internal hot-reconfiguration and local replica-index replacement are
  reserved for that task; their original acceptance items remain unverified here.
- Work remains in `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`; preserve unrelated work and real profiles.
- Core remains the configuration, DB, Run/Effect, and Memory authority owner. No second Agent runtime, maintenance queue, or Memory authority is introduced.
- Runtime edits do not silently migrate data roots or switch Memory authority. Listener replacement and index maintenance are in scope as controlled component operations. Full-Core-restart task continuation remains T4-D85.
- No new provider family, asset catalog, optional-service installer, global Settings redesign, automatic updater, or general backup/migration system is required.
- Distribution/one-launch goals remain follow-ups. The older 10-18 engineer-day installation estimate does not estimate this revised scope.

## Configuration-source decision

Owner-confirmed on 2026-11-09: application-saved values > environment fallback > built-in defaults. Remove environment locking for ordinary editable settings. Explicit false/zero and profile disable/no-auth choices are stored overrides, not missing values. Reset removes application ownership and deliberately resumes fallback; clearing a secret or disabling a profile must not resurrect an environment credential. The data root remains a pre-storage bootstrap exception. Preserve existing files and document old stored-value adoption; credentials never enter ordinary config rows.

## Planning artifacts

- [Design](design.md): ownership, readiness, local entry, and application contracts.
- [Execution plan](implement.md): ordered deliverables and proof gates.
- [Configuration consumer matrix](research/config-runtime-application.md): setting-level evidence, including existing live consumers.
- [Local flow research](research/local-flow-simplification.md): native startup isolation and local authentication alternatives.
- [Earlier installation/UX assessment](research/installation-user-experience-assessment.md): retained broader research; current scope above takes precedence.
- [Deferred decisions](../../../docs/deferred-decisions.md): D18/D24 distribution, T4-D83 identity compatibility, and T4-D85 restart continuation.
