# Frozen-input modern merge preview

Read-only working-tree preview on 2026-11-11 in the independent G clone, using Git's modern merge machinery. The script creates Git tree objects but changes no index, worktree or refs.

- Main: `9b98794a673efb561682b9fd451fe1da2db95086`.
- T4: `63faf8119be1747b685aacf43529d754626ab35c`.
- Merge base: `c3f8bc4d0c061f67ac998cac0cd1b95a3e91f7fb`.
- Preview tree: `9ed7e9f87eb4ef2de3774d4942c52413e44d40e1`.
- `git merge-tree` exit 1 means conflicts; the inventory producer exits 0 after recording that expected result.
- Conflicting paths: **267**, including **197** beneath `packages/core/src`, **17** beneath `packages/shared/src`, **21** beneath `apps/desktop/src`, and **3** beneath `apps/desktop/src-tauri`.
- This is a conflict inventory, not merge success, compilation, semantic compatibility or final effort estimate.

Reproduce with `python .trellis/tasks/11-11-main-t4-baseline-integration/research/git-preview.py` from the G clone. Full conflict paths and Git diagnostics are in adjacent `git-preview.json`; read the required subset rather than relying on automatic context injection of that large file.

Original main and T4 were clean at the input tips. No source merge, original-ref update, service launch or real-data upgrade has occurred.
