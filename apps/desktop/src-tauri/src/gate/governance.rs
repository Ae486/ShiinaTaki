//! INPUT:  a `capability[:argClass]` cell key + the active PermissionLevel (protocol.rs serde mirrors)
//! OUTPUT: GovernanceCell/CapabilityGovernance descriptors + GovernanceRegistry { cell, is_floor, project_level }
//! POS:    shell/gate — the registry-driven Level projection (research §5.1/§5.3); factory defaults (panel overrides land with #23); batch B/C add descriptors here, the gate does not change

use crate::protocol::PermissionPosture::{Ask, Auto, Deny};
use crate::protocol::{PermissionLevel, PermissionPosture};

/// One `capability[:argClass]` projection row: the factory posture per Level, and whether an ask answer may
/// persist. persist=false is the never-persisted risky region (arg-varying risk, R2): allows are once-only and
/// decision memory is neither consulted nor written — bypass-immune.
pub struct GovernanceCell {
    pub key: &'static str,
    pub strict: PermissionPosture,
    pub standard: PermissionPosture,
    pub relaxed: PermissionPosture,
    pub persist: bool,
}

impl GovernanceCell {
    /// The projection is a data lookup, never a per-capability switch (research §5.3).
    pub fn posture(&self, level: PermissionLevel) -> PermissionPosture {
        match level {
            PermissionLevel::Strict => self.strict,
            PermissionLevel::Standard => self.standard,
            PermissionLevel::Relaxed => self.relaxed,
        }
    }
}

/// A capability's governance descriptor (research §5.1): its projection cells + its deny-by-default floor.
/// floor_classes is the prd deny-row set: denied in EVERY tier; user-configurable only over the operator panel
/// (permission.cellSet + secondConfirm, #23); the agent has NO code path that changes it.
pub struct CapabilityGovernance {
    pub name: &'static str,
    pub cells: &'static [GovernanceCell],
    pub floor_classes: &'static [&'static str],
}

/// shell-open (T2b batch A — the proven descriptor). url-safe is Level-relaxable and rememberable; the local
/// classes relax to auto ONLY at relaxed (yolo [H-APR:333-357]) and never persist; blocked is floor.
const SHELL_OPEN: CapabilityGovernance = CapabilityGovernance {
    name: "shell-open",
    cells: &[
        GovernanceCell { key: "shell-open:url-safe", strict: Ask, standard: Auto, relaxed: Auto, persist: true },
        GovernanceCell { key: "shell-open:local-file", strict: Ask, standard: Ask, relaxed: Auto, persist: false },
        GovernanceCell { key: "shell-open:local-exec", strict: Ask, standard: Ask, relaxed: Auto, persist: false },
    ],
    floor_classes: &["shell-open:blocked"],
};

/// exec (T2b batch B). The escalate family (compound / shell-reentry / allowlist-miss) relaxes to auto ONLY at
/// relaxed (yolo [H-APR:333-357]); simple-allowlisted is the one class auto-below-relaxed (strict:Ask). EVERY exec
/// cell is `persist:false` — a remembered "always allow exec" would auto-approve every future command (ruling 8),
/// so exec never persists a decision and its ask is always once-only (research §3.5; prd never-persist ruling).
/// exec:blocked is the floor: the catastrophic tripwire denied in every tier, yolo included [CC-PM circuit breaker].
const EXEC: CapabilityGovernance = CapabilityGovernance {
    name: "exec",
    cells: &[
        GovernanceCell { key: "exec:simple-allowlisted", strict: Ask, standard: Auto, relaxed: Auto, persist: false },
        GovernanceCell { key: "exec:compound", strict: Ask, standard: Ask, relaxed: Auto, persist: false },
        GovernanceCell { key: "exec:shell-reentry", strict: Ask, standard: Ask, relaxed: Auto, persist: false },
        GovernanceCell { key: "exec:allowlist-miss", strict: Ask, standard: Ask, relaxed: Auto, persist: false },
    ],
    floor_classes: &["exec:blocked"],
};

/// fs-write (T2b batch C — the out-of-Workspace write FOUNDATION; no live capability handler exists yet). in-workspace
/// is the always-auto baseline (plain data, rememberable). dir-root is the DYNAMIC family: a request's full key carries
/// the specific root (`fs-write:dir-root:C:\A`, produced by fs_write_class), but its PROJECTION cell is this
/// family key — the per-root distinction lives in decision memory (cell() family-fallback), so an Always on one root
/// never authorizes another (R1). outside-root and skill-hook (executable code, D36 — never a permanent backdoor)
/// relax to auto ONLY at relaxed (yolo [H-APR:333-357]) and never persist. The floor is the two deny-by-default
/// rows — sensitive sub-targets [CX-PERM deny-wins-over-write; H-EDIT:45-48,192-197] and the self-escalation surface
/// ["config IS policy" H-APR:262-275] — denied in EVERY tier (prd factory table).
const FS_WRITE: CapabilityGovernance = CapabilityGovernance {
    name: "fs-write",
    cells: &[
        GovernanceCell { key: "fs-write:in-workspace", strict: Auto, standard: Auto, relaxed: Auto, persist: true },
        GovernanceCell { key: "fs-write:dir-root", strict: Ask, standard: Ask, relaxed: Auto, persist: true },
        GovernanceCell { key: "fs-write:outside-root", strict: Ask, standard: Ask, relaxed: Auto, persist: false },
        GovernanceCell { key: "fs-write:skill-hook", strict: Ask, standard: Ask, relaxed: Auto, persist: false },
    ],
    floor_classes: &["fs-write:sensitive", "fs-write:self-escalation"],
};

/// fixed-risk capabilities (T2b batch D). Their action is identical every call, so each is a name-keyed cell
/// (single-segment key = the bare capability name — `evaluate_by_class` splits on ':' and exact-matches it). Before
/// batch D these rode the non-Level `Gate::evaluate`, so `relaxed` still prompted them — contradicting yolo (no
/// prompt outside the deny floor [H-APR:333-357]) and leaving #23 unable to list them. Registering them here makes
/// them Level-projected AND panel-configurable (registry-driven, prd "user-editable, not hard-coded"). These are the
/// FACTORY DEFAULT postures: `{strict:Ask, standard:Ask, relaxed:Auto}` — the owner ratified (2026-07-21) deviating
/// standard→Ask from the prd table's `{ask,auto,auto}` (a gated capture/read is too sensitive to auto at the default
/// tier), keeping today's ask-then-remember at strict/standard and adding yolo-auto at relaxed. persist:true preserves
/// the existing once/session/always name-keyed memory ([CC-PERM] fixed-risk name-keyed persistence). No floor —
/// fixed-risk has no catastrophic sub-target. #23 may reconfigure every cell via permission.cellSet.
const FIXED_RISK: CapabilityGovernance = CapabilityGovernance {
    name: "fixed-risk",
    cells: &[
        GovernanceCell { key: "screenshot", strict: Ask, standard: Ask, relaxed: Auto, persist: true },
        GovernanceCell { key: "process-list", strict: Ask, standard: Ask, relaxed: Auto, persist: true },
        GovernanceCell { key: "clipboard-read", strict: Ask, standard: Ask, relaxed: Auto, persist: true },
        GovernanceCell { key: "clipboard-write", strict: Ask, standard: Ask, relaxed: Auto, persist: true },
        // foreground-window (T3a perception sampler): same fixed-risk shape as process-list — its action is identical
        // every call, so it is name-keyed. Polled continuously, so ask-over-poll is the UX: the first tick under an ask
        // posture raises ONE dialog offering session/always; that answer silences later ticks via DecisionStore
        // (persist:true), a de-facto standing toggle. A deny posture / unanswered tick makes Core back off, no re-prompt.
        GovernanceCell { key: "foreground-window", strict: Ask, standard: Ask, relaxed: Auto, persist: true },
    ],
    floor_classes: &[],
};

/// The registry the gate + the level-config surface read. Adding a capability = declare its descriptor above
/// (or beside its policy module) and list it in `factory()` — invariant 7; evaluate_by_class is untouched.
pub struct GovernanceRegistry {
    rows: &'static [&'static CapabilityGovernance],
}

impl GovernanceRegistry {
    pub fn factory() -> Self {
        Self { rows: &[&SHELL_OPEN, &EXEC, &FS_WRITE, &FIXED_RISK] }
    }

    /// The projection cell owning `key`, or None (the gate fail-closed denies an unregistered key). A per-target
    /// dynamic key (three segments, e.g. `fs-write:dir-root:C:\A`) has no cell of its own — it projects on its
    /// FAMILY cell (`fs-write:dir-root`); the specific root stays in decision memory (which keeps the FULL key), so
    /// an Always on one root never reaches another (R1). Exact match is tried FIRST, so every static key
    /// (shell-open / exec / the two-segment fs-write cells) is unaffected; only a three-segment key falls back, and a
    /// two-segment miss stays None (fail-closed).
    pub fn cell(&self, key: &str) -> Option<&GovernanceCell> {
        if let Some(cell) = self.find_exact(key) {
            return Some(cell);
        }
        self.find_exact(family_key(key)?)
    }

    fn find_exact(&self, key: &str) -> Option<&GovernanceCell> {
        self.rows.iter().flat_map(|row| row.cells.iter()).find(|cell| cell.key == key)
    }

    /// Deny-by-default floor membership (research §5.4): a set the gate reads — no per-capability branching.
    pub fn is_floor(&self, key: &str) -> bool {
        self.rows.iter().any(|row| row.floor_classes.contains(&key))
    }

    /// The full Level projection, folded over every registered row (research §5.3) — the permission.cellsGet
    /// payload shape: every cell's posture under `level`, floor rows pinned to Deny.
    pub fn project_level(&self, level: PermissionLevel) -> Vec<(&'static str, PermissionPosture)> {
        let cells = self.rows.iter().flat_map(|row| row.cells.iter()).map(|cell| (cell.key, cell.posture(level)));
        let floors = self.rows.iter().flat_map(|row| row.floor_classes.iter()).map(|key| (*key, Deny));
        cells.chain(floors).collect()
    }
}

/// The `capability:class` family of a per-target dynamic key: the first TWO segments of a three-segment key
/// (`fs-write:dir-root:C:\A` -> `fs-write:dir-root`). A two-segment key (or fewer) has no family and returns None —
/// only a dynamic key gets the projection fallback, so an unregistered `capability:class` stays a fail-closed miss.
fn family_key(key: &str) -> Option<&str> {
    let mut colons = key.match_indices(':');
    colons.next()?; // the capability:class boundary
    let (family_end, _) = colons.next()?; // the class:dynamic boundary — present only on a per-target key
    Some(&key[..family_end])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_projection_matches_the_prd_factory_table() {
        let registry = GovernanceRegistry::factory();
        let cases = [
            ("shell-open:url-safe", [Ask, Auto, Auto]),
            ("shell-open:local-file", [Ask, Ask, Auto]),
            ("shell-open:local-exec", [Ask, Ask, Auto]),
        ];
        for (key, [strict, standard, relaxed]) in cases {
            let cell = registry.cell(key).expect(key);
            assert_eq!(cell.posture(PermissionLevel::Strict), strict, "{key} strict");
            assert_eq!(cell.posture(PermissionLevel::Standard), standard, "{key} standard");
            assert_eq!(cell.posture(PermissionLevel::Relaxed), relaxed, "{key} relaxed");
        }
    }

    #[test]
    fn the_exec_projection_matches_the_prd_factory_table() {
        // Batch B: simple-allowlisted relaxes below relaxed (strict:Ask / standard:Auto); the escalate family asks
        // until relaxed (yolo). All four are never-persisted; exec:blocked is the floor.
        let registry = GovernanceRegistry::factory();
        let cases = [
            ("exec:simple-allowlisted", [Ask, Auto, Auto]),
            ("exec:compound", [Ask, Ask, Auto]),
            ("exec:shell-reentry", [Ask, Ask, Auto]),
            ("exec:allowlist-miss", [Ask, Ask, Auto]),
        ];
        for (key, [strict, standard, relaxed]) in cases {
            let cell = registry.cell(key).expect(key);
            assert_eq!(cell.posture(PermissionLevel::Strict), strict, "{key} strict");
            assert_eq!(cell.posture(PermissionLevel::Standard), standard, "{key} standard");
            assert_eq!(cell.posture(PermissionLevel::Relaxed), relaxed, "{key} relaxed");
            assert!(!cell.persist, "{key} must never persist (ruling 8)");
        }
        assert!(registry.is_floor("exec:blocked"));
    }

    #[test]
    fn only_url_safe_is_rememberable() {
        let registry = GovernanceRegistry::factory();
        assert!(registry.cell("shell-open:url-safe").unwrap().persist);
        assert!(!registry.cell("shell-open:local-file").unwrap().persist);
        assert!(!registry.cell("shell-open:local-exec").unwrap().persist);
    }

    #[test]
    fn floor_membership_is_set_membership() {
        let registry = GovernanceRegistry::factory();
        assert!(registry.is_floor("shell-open:blocked"));
        assert!(registry.is_floor("exec:blocked"));
        assert!(registry.is_floor("fs-write:sensitive"));
        assert!(registry.is_floor("fs-write:self-escalation"));
        assert!(!registry.is_floor("shell-open:url-safe"));
        assert!(!registry.is_floor("exec:simple-allowlisted"));
        assert!(!registry.is_floor("fs-write:in-workspace"));
        assert!(!registry.is_floor("fs-write:dir-root"));
        assert!(!registry.is_floor("shell-open"));
    }

    #[test]
    fn the_fixed_risk_projection_matches_the_factory_default() {
        // Batch D: the four fixed-risk capabilities are name-keyed cells (single-segment key) projecting
        // {strict:Ask, standard:Ask, relaxed:Auto}, persist:true (owner-ratified factory default 2026-07-21,
        // deviating standard->Ask from the prd table's {ask,auto,auto}; user-editable via #23). None is a floor.
        let registry = GovernanceRegistry::factory();
        for key in ["screenshot", "process-list", "clipboard-read", "clipboard-write", "foreground-window"] {
            let cell = registry.cell(key).expect(key);
            assert_eq!(cell.posture(PermissionLevel::Strict), Ask, "{key} strict");
            assert_eq!(cell.posture(PermissionLevel::Standard), Ask, "{key} standard");
            assert_eq!(cell.posture(PermissionLevel::Relaxed), Auto, "{key} relaxed");
            assert!(cell.persist, "{key} keeps its name-keyed once/session/always memory");
            assert!(!registry.is_floor(key), "{key} has no floor");
        }
    }

    #[test]
    fn project_level_folds_over_the_whole_registry_and_pins_the_floor_to_deny() {
        let registry = GovernanceRegistry::factory();
        for level in [PermissionLevel::Strict, PermissionLevel::Standard, PermissionLevel::Relaxed] {
            let projection = registry.project_level(level);
            // 3 shell-open + 4 exec + 4 fs-write + 5 fixed-risk = 16 cells; + 4 floor keys (shell-open:blocked,
            // exec:blocked, fs-write:sensitive, fs-write:self-escalation) = 20 rows (fixed-risk adds no floor).
            assert_eq!(projection.len(), 20, "every cell + every floor row appears");
            for floor in ["shell-open:blocked", "exec:blocked", "fs-write:sensitive", "fs-write:self-escalation"] {
                let row = projection.iter().find(|(key, _)| *key == floor).unwrap();
                assert_eq!(row.1, Deny, "the floor {floor} is deny in {level:?}");
            }
        }
    }

    #[test]
    fn the_fs_write_projection_matches_the_prd_factory_table() {
        // Batch C: in-workspace is always-auto + rememberable; dir-root asks below relaxed and IS rememberable
        // (per-root, via the full key); outside-root + skill-hook ask below relaxed and never persist; both floors
        // are set membership (asserted above).
        let registry = GovernanceRegistry::factory();
        let cases = [
            ("fs-write:in-workspace", [Auto, Auto, Auto], true),
            ("fs-write:dir-root", [Ask, Ask, Auto], true),
            ("fs-write:outside-root", [Ask, Ask, Auto], false),
            ("fs-write:skill-hook", [Ask, Ask, Auto], false),
        ];
        for (key, [strict, standard, relaxed], persist) in cases {
            let cell = registry.cell(key).expect(key);
            assert_eq!(cell.posture(PermissionLevel::Strict), strict, "{key} strict");
            assert_eq!(cell.posture(PermissionLevel::Standard), standard, "{key} standard");
            assert_eq!(cell.posture(PermissionLevel::Relaxed), relaxed, "{key} relaxed");
            assert_eq!(cell.persist, persist, "{key} persist");
        }
    }

    #[test]
    fn a_dir_root_per_target_key_projects_on_its_family_cell() {
        // RED-proof #3 (cell half) + #4: a three-segment per-root key falls back to the family cell, while every
        // static key still resolves by EXACT match (the fallback must not shadow them).
        let registry = GovernanceRegistry::factory();
        let a = registry.cell("fs-write:dir-root:C:\\A").expect("root A resolves via the family cell");
        let b = registry.cell("fs-write:dir-root:C:\\B").expect("root B resolves via the family cell");
        assert_eq!(a.key, "fs-write:dir-root", "the projection is the family cell, not the per-root key");
        assert_eq!(b.key, "fs-write:dir-root");
        // Both roots share ONE projection cell — memory (which keeps the full key), not projection, separates them.
        assert!(std::ptr::eq(a, b));
        // Static keys are untouched by the family fallback (exact match wins first).
        assert_eq!(registry.cell("shell-open:url-safe").expect("exact").key, "shell-open:url-safe");
        assert_eq!(registry.cell("exec:compound").expect("exact").key, "exec:compound");
        assert_eq!(registry.cell("fs-write:in-workspace").expect("exact").key, "fs-write:in-workspace");
        // An unregistered TWO-segment key still misses — only a three-segment dynamic key gets the fallback.
        assert!(registry.cell("fs-write:not-a-class").is_none());
        assert!(registry.cell("network:connect").is_none());
    }

    #[test]
    fn family_key_splits_on_the_second_colon_never_a_windows_drive_colon() {
        // A per-target dir-root key carries a Windows drive colon in its dynamic segment (`fs-write:dir-root:C:\A`).
        // The family MUST be the first TWO segments (`fs-write:dir-root`), split on the SECOND colon — never the
        // drive colon (which would give `fs-write:dir-root:C`) and never the first colon alone (`fs-write`). This is
        // RED if family_key ever used rfind (last colon) or the first colon.
        assert_eq!(family_key("fs-write:dir-root:C:\\A"), Some("fs-write:dir-root"));
        assert_eq!(family_key("fs-write:dir-root:C:\\Users\\me\\proj"), Some("fs-write:dir-root"));
        // A two-segment (or shorter) key has no dynamic segment -> no family (fail-closed: no projection fallback).
        assert_eq!(family_key("shell-open:url-safe"), None);
        assert_eq!(family_key("screenshot"), None);
    }

    #[test]
    fn a_dir_root_key_with_a_drive_colon_resolves_to_the_family_cell_not_the_capability() {
        // The cell()-level guarantee for the same hazard: a drive-colon key resolves to the `fs-write:dir-root`
        // family cell, never to a (nonexistent) `fs-write` cell and never to None.
        let registry = GovernanceRegistry::factory();
        let cell = registry.cell("fs-write:dir-root:C:\\A").expect("drive-colon key resolves via the family cell");
        assert_eq!(cell.key, "fs-write:dir-root");
    }

    #[test]
    fn an_unknown_key_has_no_cell() {
        // A not-yet-wired argClass (no batch registers `network:connect`) -> None -> the gate fail-closed denies it.
        // (fs-write:in-workspace was batch B's placeholder here; batch C registers it, so this retargets to a
        // genuine miss to keep the intent.)
        assert!(GovernanceRegistry::factory().cell("network:connect").is_none());
    }
}
