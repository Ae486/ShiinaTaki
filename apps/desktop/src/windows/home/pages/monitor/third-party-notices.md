# DeepSeek Trajectory presentation adaptations

The Monitor layout, toolbar, Overview, compact ledger, grouping, virtual-row behavior, Inspector,
and their styles adapt the following MIT source from DeepSeek Harness:

- `packages/client/ui-trajectory/src/client/TrajectoryView.tsx` and `views.module.css`
- `TrajectoryToolbar.tsx` and `TrajectoryToolbar.module.css`
- `TrajectoryTimeline.tsx`, `TrajectoryTimeline.module.css`, and `timeline.ts`
- `TrajectoryTable.tsx`, `TrajectoryTable.module.css`, `trajectory-virtual-rows.ts`, `trajectory-record.ts`, and `layout.ts`

The source is available in the local read-only reference at `references/deepseek-harness-master`.
Only presentation is adapted. TakiAgent's Core Run/Event ledger remains the execution authority.
The reference conversation/composer runtime and unprovided prompt/tool-payload/diff panels are omitted.
Labels are localized to Simplified Chinese, and theme tokens use the existing TakiAgent palette.

## License

MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
