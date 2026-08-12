# windows/home/pages/settings/
The knobs page (#26 R13): every core config knob rendered FROM the server's config.list metadata — the panel never
derives a knob's shape, order or editability from its key. Value precedence is env > stored > default, and each row
states truthfully when a change takes effect.
- settings-page.tsx — page root: the knob list in the server's order + the load-error banner
- knob-field.tsx — one knob row: description, badges (env 锁定 / 重启生效 / 密钥 / 已自定义), the editor, save outcome
- knob-input.tsx — the editor itself: checkbox / select / text / number per input.kind, or a secret's set-not-set readout
- knob-editor.ts — pure metadata→editor mapping (kind, disabled + reason, bounds, secret set/not-set) + input parsing
- config-state.ts — pure knob-list transitions (config.changed / accepted set) + the five refusal messages + the apply verdict
- use-config.ts — the page's ONLY ws touchpoint: cached config.list (secret rows scrubbed before persistence), one fan-out config.changed consumer, and config.set per row; subscription is shared once per client generation
