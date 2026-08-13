# desktop/src-tauri/src/gate/
- approver.rs — retained pre-Slice-3 Approver trait/dialog implementation plus ScriptedApprover for debug/headless setup; the production WS execution path does not invoke it
- decisions.rs — read-only exact legacy Never compatibility for production; dormant once/session/always writer helpers remain test-covered but are not production authority
- fs_write_class.rs — fs-write ArgClass producer (T2b item 4, FOUNDATION/not-in-production): classify a write target into fs-write:sensitive/self-escalation floors, skill-hook, in-workspace, dir-root:<root> (dynamic key), outside-root
- governance.rs — legacy Host registry used to interpret deny-only local compatibility; canonical global descriptors and projections are Core/Shared-owned
- level.rs — read-only legacy permission-level compatibility (missing is neutral at the Host seam; malformed/unreadable fail closed; relaxed never widens Core)
