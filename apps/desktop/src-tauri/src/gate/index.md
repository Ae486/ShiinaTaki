# desktop/src-tauri/src/gate/
- approver.rs — Approver trait (ask carries an optional dialog detail) + Scope/ApproverOutcome + TwoStepDialogApprover + ScriptedApprover (debug-only, env-driven gate bypass for headless tests)
- decisions.rs — once/session/always/never store (persisted + session), corruption-tolerant, atomic writes
- fs_write_class.rs — fs-write ArgClass producer (T2b item 4, FOUNDATION/not-in-production): classify a write target into fs-write:sensitive/self-escalation floors, skill-hook, in-workspace, dir-root:<root> (dynamic key), outside-root
- governance.rs — registry-driven Level projection (T2b): GovernanceCell/CapabilityGovernance descriptors + GovernanceRegistry (cell/is_floor/project_level); factory defaults, B/C/D descriptors mount here (D = the four fixed-risk name-keyed cells); cell() family-fallback for per-target dynamic keys
- level.rs — load_level: the active PermissionLevel from permission-level.json (missing/corrupt -> Standard, fail-safe; read once at build_node)
