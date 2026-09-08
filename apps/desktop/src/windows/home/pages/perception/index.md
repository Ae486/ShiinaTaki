# windows/home/pages/perception/
The perception & privacy page: Privacy Pause evidence, scheduled sampling loops and the latest accepted activity
card. It surfaces only what perception.* exposes — retention/screenshot policy is knob material, so this page
points at the settings page instead of inventing a control.
- perception-page.tsx — retained sampling/activity cards, compact header qualification and delayed pending indication; initial loading, genuine empty results and failed reads stay distinct
- pause-controls.tsx — stable last-confirmed privacy wording, non-displacing pending slot and guarded pause / 暂停到明天 / resume actions
- perception-controller.ts — subscribe-before-card producer observation, explicit older-Core fallback, qualified pause authority and independent write/hidden read lifetimes
- use-perception.ts — current-client/effective-visibility React adapter over the memory-only Perception controller
- perception-view.ts — truthful pause/scheduling wording, stable sampled-entry identities and the local-midnight input shortcut
