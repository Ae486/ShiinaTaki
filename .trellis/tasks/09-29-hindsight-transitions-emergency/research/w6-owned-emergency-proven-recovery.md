# Reviewed proven-candidate continuation

`w6-owned-emergency-proven-recovery.py` defaults to inert. Its explicit `--run-reviewed-proven-recovery` entry
is the next actual continuation after the narrow context repair and isolated publication rehearsal pass.
It retains and verifies all three failed histories, the exact current stopped Core hash, unchanged authority,
both unknown operations, expired generation2/revision6/proven, the original incident/capture and the one persisted
candidate/reservation. Existing receipt/publication/foreign branch, changed histories, WAL or a different generation
refuse. It delegates to the existing two-process supervisor and recovery-only Node arguments. Production TTL/lease
remain unchanged; the parent supervisor's existing30-minute per-process ceiling is retained.

Validation:11 synthetic pytest cases PASS in1.28s; Ruff E/F/I/format120 PASS; actual read-only preflight PASS,
session4338 closed. No successor execution occurred during these checks. Earlier wrappers/manifests are unchanged.

`w6-publication-clock-rehearsal.mjs` is a separate, default-inert diagnostic for a new owned Core-only copy.
It uses production repositories to create a new synthetic recovery operation, keeping both historical unknown rows.
It isolates actual candidate/proof/COMMIT/independent-readback timing under real five-minute leases and exact saved
data. This intentionally starts below operator preview/admission and never starts runtime/Native/model services;
it cannot replace the later real operator recovery, binding, retention audit and distinct Node restart.
