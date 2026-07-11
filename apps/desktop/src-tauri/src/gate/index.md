# desktop/src-tauri/src/gate/
- approver.rs — Approver trait (ask carries an optional dialog detail) + Scope/ApproverOutcome + TwoStepDialogApprover + ScriptedApprover (debug-only, env-driven gate bypass for headless tests)
- decisions.rs — once/session/always/never store (persisted + session), corruption-tolerant, atomic writes
