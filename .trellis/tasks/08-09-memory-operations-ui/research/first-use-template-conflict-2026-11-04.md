# First-use template enrollment fixture correction

Date: 2026-11-04. Scope: the parent practical-first existing-instance journey.
Only `first-use-runtime/home-check.py` and this report are changed by this worker.
Production sources, services, original data, credentials and Git state are outside
this correction. The parent owns the new runtime execution and its acceptance record.

## Retained failure and cause

The retained [2026-10-30 result](first-use-runtime/results/2026-10-30T07-02-30.062Z/result.json)
passes steps 1-9 and the settings, 6b and pending-recovery checks. Step 10,
`Explicit v2 template/default handoff`, fails. Its browser evidence remains at
`G:/taki-first-use-sLPLk0/home-template/page-error.json`; no historical evidence was replaced.

The old fixture clicked preview and immediately waited for Apply. The actual
default-scope preview covers all three Banks and returns the first enrollment
conflict. The UI offers an explicit existing-directive selection and another preview,
then an enrollment acknowledgement once all Bank details are available.

This is the expected refusal of unreviewed ownership, not evidence of a production
template defect. `template-plan-builder.ts` mints an unowned directive selector UUID;
`template-enrollment.ts` refuses a different same-name UUID until the operator selects
it. `hindsight-template-preview.tsx` binds that choice to the authenticated
`preview.review.target.bank_id` and changes the draft to `reviewed-existing`.

Read-only SQLite inspection of the retained synthetic database confirms that
`d252ec07-554f-4b3b-b04c-dc13ff3110fb` belongs to the mika Bank,
`taki-hs-v1-c-2c71a10de80033b01b878d32939bdbfe`, in
`hindsight_application_replica_projections`. The generated preview selector
`d0047d81-5057-43c3-b6b6-cbb00d605e99` has no matching projection. It is not the
persisted setup directive identity. The setup repository orders by scope and canonical
identity, putting `character:mika` first; the default preview visits that order.

## Fixture behavior

- Observe only the authenticated Core socket's `memory.templates.preview` and
  `memory.templates.preview.bank` request IDs/responses; exclude Vite HMR and retain
  no generic RPC trace or secret-bearing request bodies.
- Read the actual supported Bank inventory and checkpoint generations through the
  fixture's existing authority-status read. Bound the preview loop to one choice per
  actual Bank plus the final ready preview.
- Require each conflict to name a new known Bank with the exact lineage/generation,
  the fixture's known scope-specific v1 policy name and one same-name candidate.
  Click that candidate's real UI action. Repeated/wrong Banks and ambiguous/missing
  candidates fail instead of retrying or changing scope.
- Require a ready v2 default preview covering every Bank and all rendered Bank
  details. Join their preview IDs/hashes, exact Bank targets and selected existing
  directive IDs. Refuse any deletion or requested refresh/provider work.
- Verify Apply is disabled before the sole enrollment checkbox is checked, check
  the actual acknowledgement, apply once, and wait for Core's completed-binding UI.
  Save only bounded Bank/candidate identities and review counts in the owned run's
  `home-template/template-review.json`.

The fixture deliberately supports this first v1-to-v2 enrollment scenario. Already
managed Banks, extra resources or later taxonomy changes require a new intentional
scenario; they do not enter a generic retry/fallback path.

## Checks and remaining verification

`compile(Path(...).read_text(encoding="utf-8"), str(path), "exec")` under
`G:/anaconda3/python.exe` passes without generating bytecode. The installed Playwright
sync API confirms the WebSocket frame events and locator operations used here.
Source review matches the Shared preview/detail contracts and the controller's
complete-detail/acknowledgement gates. No new unit test is added for this browser fixture.

This worker has not run the revised browser journey or started any service. The parent
must run the controlled isolated Home/Core/Native path and retain its actual results.
Syntax and source checks do not establish runtime acceptance, installed Tauri behavior,
original-data activation or owner UI/model-quality acceptance.
