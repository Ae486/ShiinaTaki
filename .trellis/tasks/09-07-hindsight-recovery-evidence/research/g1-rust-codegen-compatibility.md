# Research: Rust generated pattern validation dependency

- Query: Can the locked Rust generator preserve SHA-256 pattern validation without a direct regress runtime dependency?
- Scope: internal/local dependency source; H:/hindsight Rust manifest, lockfile, build script and installed Cargo registry.
- Date: 2026-09-08
- Status: Read-only source finding. No source/manifest/lock changes, Cargo invocation, build, download or service operation.
- Registry root: C:/Users/55473/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f

## Findings

### Conclusion

For the current locked generator and unchanged generated validation, add a direct normal dependency on the already-locked regress 0.10.5. There is no public re-export or settings path in the inspected versions that makes the existing absolute ::regress::Regex references resolve without that dependency.

This adds a runtime dependency edge to hindsight-client. It does not require a new third-party package identity/version in the current lockfile. The build-time transitive dependency remains; it is not moved or removed. Runtime scope nevertheless expands, so describe this accurately when the leader assesses authorization.

Recommended bounded manifest addition under [dependencies]:

```toml
# Typify-generated OpenAPI pattern newtypes validate with the regress runtime.
regress = "=0.10.5"
```

The exact pin preserves the already-locked version. A caret requirement could also resolve to that version today, but permits future 0.10.x versions; no new version is needed for this repair. Use the same default features already selected by the generator dependency.

### Files found and evidence

| File | Finding |
| --- | --- |
| H:/hindsight/hindsight-clients/rust/Cargo.toml:12-45 | Runtime dependencies include progenitor-client, serde, chrono and uuid, but not regress. progenitor and regex are build dependencies. |
| H:/hindsight/hindsight-clients/rust/Cargo.lock:326-346 | hindsight-client root package dependency list has regex and generator packages but lacks regress. |
| Same lockfile:838-900,1565-1609 | Locked progenitor/progenitor-client/progenitor-impl are 0.11.2; typify/typify-impl/typify-macro are 0.4.3. |
| Same lockfile:957-964 | regress 0.10.5 already exists with hashbrown 0.16.1 and memchr. No new regress package stanza is necessary. |
| H:/hindsight/hindsight-clients/rust/build.rs:149-214 | Reads canonical hindsight-docs/static/openapi.json; converts 3.1 nullable forms, normalizes string unions and filters multipart paths; Generator::default().generate_tokens emits a Rust file into OUT_DIR. |
| H:/hindsight/hindsight-clients/rust/src/lib.rs:23 | Includes OUT_DIR/hindsight_client_generated.rs into the runtime library crate. |
| H:/hindsight/hindsight-docs/static/openapi.json:17025-17033,17240-17244,17279-17288,17329-17333 | Current prepared_input_hash, document_hash, request_hash, result_hash, native_receipt_hash and references_sha256 retain pattern ^[0-9a-f]{64}$. |

The lockfile's existing regress package is:

```toml
[[package]]
name = "regress"
version = "0.10.5"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "2057b2325e68a893284d1538021ab90279adac1139957ca2a74426c6f118fb48"
dependencies = [
 "hashbrown 0.16.1",
 "memchr",
]
```

Registry-relative sources below are installed package source, not assumptions about newer releases.

### Why this is a runtime requirement

typify-impl-0.4.3/src/convert.rs:795-825 validates a string schema's pattern during generation, sets self.uses_regress = true and constructs a constrained newtype. This build-time validation does not eliminate the generated runtime check.

typify-impl-0.4.3/src/type_entry.rs:1560-1569 emits:

```rust
static PATTERN: ::std::sync::LazyLock<::regress::Regex> =
    ::std::sync::LazyLock::new(|| {
        ::regress::Regex::new(#p).unwrap()
    });
if PATTERN.find(value).is_none() {
    return Err(#err.into());
}
```

The check is inserted into FromStr at 1579-1587. TryFrom variants delegate to parsing at 1590-1614, and the generated Deserialize implementation begins at 1618. This is generated input validation, not a generator-only utility.

typify-impl-0.4.3/src/lib.rs:832-834 documents uses_regress as "Whether the generated code needs [regress] crate." typify-impl-0.4.3/Cargo.toml:51-52 declares regress = "0.10.4", which is compatible with the project's existing locked 0.10.5.

build.rs is compiled as a separate build-script crate. Its transitive dependencies are not automatically named dependencies of the library which includes the emitted source. Cargo.lock records resolution; the presence of a transitive package there does not put ::regress into hindsight-client's extern prelude. The reported unresolved-crate error is consistent with this source path; this researcher did not rerun the failing build.

The existing regex build dependency is used by build.rs::fix_optional_header_params (223+) and is a different crate. It cannot satisfy a generated ::regress reference.

### Re-exports and settings checked

| Candidate | Actual supported surface / result |
| --- | --- |
| progenitor-client 0.11.2 | src/lib.rs:7-9 only re-exports its progenitor_client module. A complete src search found no regress import/re-export or Regex export; Cargo.toml runtime dependency sections do not include regress. |
| progenitor 0.11.2 | src/lib.rs:16-26 re-exports progenitor_client, generator types/settings and generate_api. No regress re-export. It is also only a build dependency in this client. |
| typify 0.4.3 | src/lib.rs:151-167 re-exports type/generator APIs and import_types; no regress re-export. |
| GenerationSettings | progenitor-impl-0.11.2/src/lib.rs:60-79 contains interface/hooks/derives/map/external-type/patch/replacement/conversion settings. There is no pattern-engine or runtime-crate-path setting. |
| TypeSpaceSettings | typify-impl-0.4.3/src/lib.rs:296-308 likewise has no regex path setting; type_entry.rs hardcodes ::regress. |
| with_crate / crate renaming | typify-impl-0.4.3/src/lib.rs:511-531 handles x-rust-type schema extensions and external type reuse. Progenitor forwards it at src/lib.rs:282-288. It does not rewrite the hardcoded pattern-engine path or make a build dependency available to the runtime crate. |
| with_replacement / with_conversion | Replaces generated types with caller-provided types (Progenitor src/lib.rs:291-305). Substitution with String drops validation. Writing another validator is a different implementation and does not preserve this generated validator; it is not the requested repair. |

Upstream's packaged progenitor-0.11.2/README.md:70-75 explicitly says regular-expression validation requires regress under [dependencies]. Its example version is the stale 0.4.1; use the actual locked source and 0.10.5 dependency instead of copying that version.

### Exact expected delta

1. Add regress = "=0.10.5" under hindsight-client's normal [dependencies], with default features.
2. In hindsight-clients/rust/Cargo.lock, add the string "regress" to the existing hindsight-client package's dependencies array, next to "regex"/"reqwest".
3. Leave the existing regress 0.10.5 stanza, checksum and transitive package versions unchanged. No build.rs, public OpenAPI pattern or generated validator edit is required.

regress-0.10.5/Cargo.toml:32-41 defaults to backend-pikevm and std. Its dependencies at 84-89 are hashbrown 0.16.0-compatible and memchr 2.4.0-compatible, with memchr defaults disabled. The generator already requests regress defaults, so this repair does not request a new regress feature set. Cargo.lock does not encode build/runtime edge kinds or selected features separately.

| Question | Precise answer |
| --- | --- |
| New third-party package/version added to this lockfile? | No; regress 0.10.5 and its dependencies are already resolved. |
| New direct normal dependency? | Yes; hindsight-client now explicitly depends on regress at runtime. |
| Larger runtime dependency scope? | Yes; regex validation and its dependency closure become part of the library's normal dependency graph. No measured size/performance claim. |
| Generator dependency removed? | No; the existing build-transitive path remains. |
| New validation algorithm or schema change? | No; the generator's existing validator becomes resolvable. |
| Approval conclusion? | Reserved to the leader/user boundary. This report supplies the concrete dependency-scope facts and does not request permission. |

After the authorized manifest change, Cargo must synchronize the root dependency edge in the lockfile before the canonical --locked build can pass. Merely editing Cargo.toml and retaining a stale root dependency array can produce a lock-update refusal even though the package is already present. Refresh with the existing locked graph/offline resolution, without a broad package update, and inspect that only the expected edge changed. Other independently locked path consumers, if validated by the leader, need their own lock consistency check; they were not audited here.

### Validation remaining for the owner of SDK generation

- Verify the final manifest/lock change is exactly the scope above, with no package/version/checksum churn.
- Rerun the existing canonical Rust cargo build --release --locked.
- Retain the public SHA-256 pattern and generated FromStr/TryFrom/Deserialize validation. Existing or focused contract checks can verify valid lowercase 64-hex values and rejection of wrong length/non-hex input.
- Do not drop the OpenAPI pattern, patch generated output, alias an unrelated regex crate, or add a local regex shim.

## Related Specs and External References

- H:/hindsight/AGENTS.md delegates to CLAUDE.md; its generating-clients section requires canonical OpenAPI/SDK regeneration.
- H:/TakiAgent/.trellis/spec/backend/quality-guidelines.md:75-121 requires canonical generation, preservation of maintained wrappers, no hand-editing generated output and the Rust locked release gate.
- H:/TakiAgent/.trellis/spec/guides/source-grounding-guide.md: inspect installed dependency source rather than infer unsupported APIs.
- External/upstream sources: installed progenitor 0.11.2, progenitor-client 0.11.2, progenitor-impl 0.11.2, typify/typify-impl 0.4.3 and regress 0.10.5; no web lookup or package download.
- Cargo registry sources and the checked-in lockfile agree on the versions cited above.

## Caveats / Not Found

- No usable public re-export, supported pattern-runtime path setting or dependency-free route preserving these generated validators was found in the locked versions.
- The manifest/lock delta is source-derived and has not been applied or build-tested by this researcher.
- No dependency upgrade is proposed. Already-locked does not mean unchanged runtime dependency scope.
- Only this research file was written; source, manifests, lockfiles, generated output, services and current user data were untouched.
