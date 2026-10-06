# W6 original sealed recovery: final publication lease refusal

The explicit original-transition recovery ended exit1 without forced termination. Session73018 and Node38172
are stopped. History `d9280ebf2293468b9457af574727f195` retains all original logs/results. Supervisor started
2026-10-06T02:08:03.256824Z and finished02:31:16.288880Z. Its SHA256 is
`daeecc236b0b0272b0e10720edc14dcd3ca711596454016d4ed3d404bb8396e5`.

Unlike the earlier representation refusal, candidate reconstruction and final proof persisted. Recovery operation
`b661d113-93e3-4b2a-bfdd-ab61d21f1dca` is `outcome_unknown`; transition remains
`0faf660d-9d8c-4215-ae5f-954f9f574734`. Attempt `dd48446c-0c6b-4ad2-b7a1-86e193d200ee` is generation2,
revision6, phase `proven`, leaseUntil02:29:03.763Z. Final evidence ID is
`8e967eb5a17bc96ed60c18f084a5ae468cd6ca153a7321f16ad692c97ba06600`.
The production diagnostic reports `MEMORY_TRANSITION_LEASE_LOST` in `proven`, receipt null, authorityCommitted false.

## Independent stopped-state audit

- Complete authority row hash still matches the preserved W5 input.
- Original capture1 and sealed incident1 remain; surviving evidence2, reservation1, candidate1.
- This transition has0 receipts,0 publications,0 foreign-branch rows: no authority COMMIT.
- Stopped Core SHA is `5d0071986151d6762cc400263b969c75fb7865a0b8f282921a585b23b24b82fe`; no WAL/SHM/journal.
- Original sealed Core SHA remains `cc6dc6567eb3dc88512134f6444945c8c8bdf779a8352f0cd6bf599897569e6b`.
- All Native/transport/model/in-flight counters remain0. Supervisor source and preserved-input inventories pass.
- Neither preceding failure was overwritten. Independent restart and D91 were not started.

Live observations saw actual generation2 renewal and successful candidate/proof progress. An earlier visible lease
timestamp during synchronous work was not itself a final failure. The final production diagnostic and stopped state
establish this refusal. No recovered source stack identifies a more precise line than the production phase/code.

## Functional repair scope

The reviewer independently found missing emergency plumbing for the existing synchronous `TransitionEvidenceContext`:
candidate preparation repeats reconstruction twice; publication repeats it at boundary, installer and final readback;
each missing-policy path also independently revalidates the committed healthy predecessor. Source freeze ended only
after the actual process stopped. The reviewer owns the narrow context-plumbing repair and related corruption,
independent-entry, observer, lease and rollback tests. No general cache redesign or production lease extension.

Each independent synchronous entry retains a fresh bounded context. Only byte-checked immutable evidence and pure
projection with a complete semantic key may be reused. Current SQL joins/configuration/owner/lease, installation
checks and final candidate/publication verdicts remain fresh. Policy Maps require explicit ordered entries in keys.
The parent owns an isolated final publication rehearsal and the next explicit original-identity recovery supervisor.
Never rerun an earlier entry or change its pinned failure history. W6 product acceptance and W7/W8 remain open.
