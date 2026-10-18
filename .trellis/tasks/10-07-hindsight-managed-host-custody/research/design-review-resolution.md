# C1 engineering review resolutions

All six findings in the [independent readiness review](../../10-07-hindsight-template-lifecycle/research/stage5c-c1-readiness-review.md)
are accepted as engineering corrections within the owner's approved Stage 5 scope. No new product choice is needed.
The PRD/design/implement artifacts passed final independent confirmation on 2026-10-07, and the 2026-10-13
post-5B source refresh found no new blocker. The owner has authorized C1 implementation. These design findings
remain unchanged; they are not code acceptance or authority to use actual credentials/deployments.

| Finding | Concrete resolution | Required check |
| --- | --- | --- |
| P1 trusted invocation/result | Per-pending onIssued/onAccepted before notify; real Core/broker/Host attempt map; successful current terminal only; owner-backed internal handle; real post-gate Host context; no raw operator managedReceipt for new admission. | Immediate response, mismatched attempts, forged JSON, denied governance, timeout/duplicate and post-await drift; ordinary capability/existing-instance regression. |
| P1 owner snapshot | Owner capture/validate API; loaded/published envelope digest aligned with cache; boot/private revision/digest tuple; stale external replacement; opaque snapshot ID; fresh C2 non-secret reauthorization. | Fixed Date, exact-ciphertext restore ABA, failed publication, rename/read/final races and restart. |
| P1 Windows installed execution | Trusted external expected identity; actual handles/file IDs/owner/DACL/parents; denied write/delete sharing for consumed artifacts, rename-tolerant catalog; sanitized Node env; get-only 36-byte key frame. | Supported-Windows object replacement/ACL/preload/process tests; unavailable on unsupported assurance, never hash-only fallback. |
| P1 Ubuntu Host/custody | Release-safe role=node enrollment/client lifecycle; same credential-owning UID; service-local logical credential resolution each start; node token separate; canonical ask/auto policy. | Real protocol integration and supported Linux custody/service artifacts; wrong role/UID/source and unattended ask refusal. |
| P2 packaged closure | Compiled ESM helper/codec/pure Shared with complete pinned dependencies/sodium assets/metadata; no checkout/store or broad frontend crypto import. | Copied install from unrelated cwd, fake decode, no Core boot import, missing/tampered assets. |
| P2 bootstrap ownership/proof | C1a custody/install check; C1b process/bootstrap/fake observer check; C2a real registry/observer and mandatory isolated Docker proof; C2b accepted deployment ledger. | Separate P/W/L/D evidence levels; no real delivery/receipt before Docker gate, no process-only marking of original Docker AC. |

Design section 7 freezes 32 KiB non-secret request, 16 KiB status, 16 MiB sealed envelope, seven fixed slots with
65,536 UTF-16-unit values and 4 MiB private payload framed by u32 LE. Parent Host deadline is unchanged (current
default 90 s), get-only adapter is min(10 s, remaining). Graceful shutdown and model work retain separate C2 budgets.

Platform fixture absence is visible as unsupported/unverified. C1 source/process deliverables may be reviewed
without claiming installed Ubuntu/Docker acceptance; such absence never enables real managed delivery in C2.
Windows logged-in-user lifetime and Ubuntu explicit service lifetime remain different supported availability scopes.
