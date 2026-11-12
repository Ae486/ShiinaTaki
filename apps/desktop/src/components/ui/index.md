# components/ui/
The batch-2 unified primitive layer (PRD C4): one look per role, tokenized, each with its own focused test.
Keyboard focus everywhere is the single `:focus-visible` accent rule in styles.css (A5).

- selection-tile.tsx — INPUT selected/onSelect + layout/stateAttr/emphasis; OUTPUT the ONE selectable-tile recipe (selected = accent-soft fill + accent text + accent ring); POS the only selection surface primitive (nav, monitor tiles, permission levels, costume rows, KindPicker)
- master-detail.tsx — INPUT list/detail slots (+ the container-query breakpoint step at which the panes sit side by side); OUTPUT the ONE two-pane layout shell (narrow list aside + min-w-0 detail column, stacks vertically under the breakpoint); POS the L2 layout primitive shared by MCP, Skills and the monitor three-zone page — pure layout, no data/selection ownership
- dialog.tsx — INPUT open/onClose + escapePolicy ("close" | "none" — approval is fail-closed "none"); OUTPUT the ONE modal shell (backdrop z-dialog, focus trap + initial focus + restore, built-in close only when dismissible); POS approval migrates here (A1); no portal machinery by design
- field.tsx — INPUT visible label + one control (+ hint/invalid); OUTPUT explicit htmlFor/id pair injected into the control, aria-describedby/aria-invalid wiring, FIELD_CONTROL token class; POS fixes the near-invisible MCP editor ring and unassociated env/header pair
- feedback-line.tsx — INPUT tone danger/warn/ok/info + optional inline action; OUTPUT the ONE outcome line (danger → role=alert, else role=status; action = retry affordance); POS absorbs PageAlert internals, bare coloured notices, the MCP banner; ErrorState-with-retry = danger + action
- empty-state.tsx — INPUT icon?/title/hint?/action?; OUTPUT the ONE nothing-to-show block; POS replaces the bare empty <p>s across the pages
- skeleton.tsx — INPUT lines? or block?; OUTPUT the ONE animate-pulse loading stub (no shimmer system); POS replaces bare "载入中…" lines and the image shimmer block
- pending-indicator.tsx — real pending work in a fixed inline slot excluded from flex-baseline alignment; a 250 ms presentation-only delay suppresses fast flash, with accessible slow-work feedback and reduced-motion support
- copyable-row.tsx — INPUT label + technical value (+ mono/compact); OUTPUT the ONE copy-diagnostic row (min-w-0 + truncate, aria-labelled copy control, transient check tick on success); POS monitor inspector, Skills 哈希/Owner/修订, convergence shortId
- icon-button.tsx — INPUT required accessible label + glyph children (+ size/tone); OUTPUT the ONE glyph-button (32px default hit target, 28px overlay-constrained; ghost/solid/onDark); POS composer attach/remove, bubble open/close, toast/dialog dismiss
