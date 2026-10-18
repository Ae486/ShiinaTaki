# shell/hindsight_windows/
- acl.rs — real owner/DACL checks with a conservative trusted-writer set and distinct payload/ancestor rules.
- objects.rs — local NTFS final-path/file-ID inspection, no reparse/hardlinks, retained no-write/delete-sharing files and list-access directory guards; the mutable Catalog directory alone permits write sharing.
- catalog.rs — protected registered Catalog parents, temporary read-only leaf inspection that closes before Core publication, and final current-file/digest validation.
- process.rs — sanitized fixed executable startup, token owner verification, bounded pipe capture and kill-on-close Job cancellation/deadline/reaping.
- installation.rs — external registration, complete consumed tree/digests, registered runtime probe and retained artifact lifetime.
- invoke.rs — post-gate private control invocation with final current-object/original-result checks; no values in output.
- deployment.rs — protected C2 installation/state lock and current-session checkpoint relay; reaps the resident before releasing artifact guards or the writer lock.
- resident.rs — bounded reusable private pipes, cancellation and one Job owning the resident helper and its descendants.
- tests.rs — actual Windows primitive tests and explicit protected fake-key copied-install checks.
