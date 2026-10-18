# C1a Windows API notes — 2026-10-13

Read-only implementation support for design section 2 and the accepted review resolutions. This note is not
an additional gate. Only this file was written; no build, test, service, credential access or source edit ran.

## Existing modules and exact pointers

`apps/desktop/src-tauri/Cargo.lock:5640` already locks `windows 0.62.2`. `Cargo.toml:64` already enables
`Win32_Foundation`, `Win32_Security` and `Win32_System_Threading`. Add only feature flags to that existing crate:

- `Win32_Storage_FileSystem`: file/directory handles, object identity, final path and filesystem information.
- `Win32_Security_Authorization`: handle-based owner/DACL access and fixture security descriptors.
- `Win32_System_SystemServices`: named ACE-type constants and `FILE_PERSISTENT_ACLS` for the ACL-walking approach.
  `Win32_System_WindowsProgramming` is unnecessary unless choosing `GetDriveTypeW` plus its `DRIVE_FIXED` constant.

All binding pointers below are under the locally cached
`C:/Users/55473/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-0.62.2/src/Windows/Win32/`.

| Purpose | Exact binding/API pointer |
| --- | --- |
| Open retained objects | `Storage/FileSystem/mod.rs:361`: `CreateFileW(path, desired_access: u32, share: FILE_SHARE_MODE, security, OPEN_EXISTING, flags, template) -> Result<HANDLE>`. |
| Object identity | `Storage/FileSystem/mod.rs:1144`: `GetFileInformationByHandleEx(HANDLE, FILE_INFO_BY_HANDLE_CLASS, *mut c_void, u32) -> Result<()>`; `FileIdInfo` yields `FILE_ID_INFO { VolumeSerialNumber: u64, FileId: FILE_ID_128 }` at `:4302`. |
| Redirect/link checks | Same query with `FileAttributeTagInfo` / `FILE_ATTRIBUTE_TAG_INFO` (`:4058`) and `FileStandardInfo` / `FILE_STANDARD_INFO` (`:4613`, `NumberOfLinks`, `DeletePending`, `Directory`). |
| Final local path/filesystem | `Storage/FileSystem/mod.rs:1238`: `GetFinalPathNameByHandleW(HANDLE, &mut [u16], flags) -> u32`; `:1470`: `GetVolumeInformationByHandleW(...) -> Result<()>`; `:1164`: `GetFileType(HANDLE) -> FILE_TYPE`. |
| Owner and full DACL | `Security/Authorization/mod.rs:463`: `GetSecurityInfo(HANDLE, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION \| DACL_SECURITY_INFORMATION, owner, group, dacl, sacl, descriptor) -> WIN32_ERROR`; use `.ok()`. |
| ACL interpretation | `Security/mod.rs:404` `GetSecurityDescriptorDacl`; `:353` `GetAclInformation`; `:348` `GetAce`; `:660` `MapGenericMask`. ACE constants are in `System/SystemServices/mod.rs:1/:6`; persistent-ACL flag at `:687`. |
| Actual token user | `System/Threading/mod.rs:1199` `OpenProcessToken(HANDLE, TOKEN_QUERY, *mut HANDLE) -> Result<()>`; `Security/mod.rs:454` `GetTokenInformation(..., TokenUser, ...) -> Result<()>`. Existing implementation: `src/secrets.rs:132/:148`. |

The local Rust docs also contain stable `OpenOptionsExt::{access_mode, share_mode, custom_flags}` at
`std/os/windows/fs.rs:166/:194/:225`; `CommandExt::creation_flags` at `std/os/windows/process.rs:182`;
`Child::{AsRawHandle, AsHandle}` at `:37/:45`. These refer to source-line anchors in the installed rustdoc
tree `C:/Users/55473/.rustup/toolchains/stable-x86_64-pc-windows-msvc/share/doc/rust/html/src/`.

## Minimum sequence

1. Start from the protected registration and expected manifest identity. Reject UNC/device/ADS/ambiguous input
   spellings; open and verify each required parent from the admitted ancestor toward the leaf. Use
   `OPEN_REPARSE_POINT`; directories additionally need `BACKUP_SEMANTICS`. This flag alone does not prevent
   following an unchecked intermediate reparse point.
2. Retain ordinary `File`/owned handles. Regular artifacts can use `OpenOptions::read(true)`;
   directory guards need `FILE_LIST_DIRECTORY` in addition to metadata/security access
   (`FILE_READ_ATTRIBUTES | READ_CONTROL`). C1a's real `parent_handle_blocks_directory_rename` test failed with
   metadata-only access despite read-only sharing; the focused five-case Windows rerun passed after adding
   data access. This execution result corrects the original metadata-only API suggestion.
   Explicitly set `share_mode(FILE_SHARE_READ.0)`: std defaults also permit write and delete. Hold every
   consumed runtime/adapter/JS/metadata/sodium/dependency object and required parent guard through execution.
3. Query those same handles: disk/local final path, supported filesystem with persistent ACLs, volume/file ID,
   correct directory/file kind, no reparse tag, no delete-pending state, and one link for regular artifacts.
   Hash bytes from the retained file, not a separately reopened pathname. Bound final-path buffers, handling
   zero/error and insufficient capacity explicitly. Path-based process launch still needs the retained parent
   guards; there is no std `Command` executable-handle argument.
4. Check actual owner and effective DACL against the admitted trust rules, including parent replacement rights.
   Absent/null DACLs are not evidence of protection. Normalize generic masks using the `FILE_GENERIC_*` /
   `FILE_ALL_ACCESS` mapping and account for inheritance and applicable ACE order; unsupported ACE semantics
   refuse. A current-user access check or owner match alone does not prove other principals cannot write/delete.
   `GetEffectiveRightsFromAclW` (`Security/Authorization/mod.rs:396`) is only a per-trustee helper. Keep the
   returned security descriptor alive while examining its owner/ACL pointers, then free it with
   `Foundation::LocalFree(Some(HLOCAL(...)))` (`Foundation/mod.rs:38`). Never repair production permissions.
5. Reuse the real SID-buffer/token-handle lifecycle in `secrets.rs:132–186`; compare actual SID bytes to the
   registration, not `USERNAME`. `Child::as_raw_handle()` also allows querying the actual spawned process token.
   Launch the fixed admitted absolute executable/argv without a shell, with `env_clear()` and an explicit small
   environment allowlist. Existing `capabilities_impl/exec/sandbox.rs:75–94` demonstrates hidden launch
   (`creation_flags(0x08000000)`) and environment clearing; its general exec allowlist is not the C1 Node policy.
6. Invoke only `get --account <registered account>`. `taki-secret-key.rs:36` reads stdin to EOF before dispatch,
   so use `Stdio::null()` or close the pipe immediately. Accept exit zero and exactly 36 stdout bytes with a
   little-endian length of 32; reject missing/trailing bytes. Drain stdout/stderr concurrently with bounds,
   discard stderr, and kill then reap on failure within `min(10 seconds, parent remaining budget)`.
   Avoid unbounded `Command::output()`. Keep the catalog read rename-tolerant as required by design section 2;
   artifact sharing locks must not be copied onto Core's published catalog.

## Mutable Catalog publication exception (independently verified)

The final [C1a independent review](./c1a-independent-review-2026-10-13.md) adds a separate Catalog contract.
Immutable runtime/payload/adapter files keep their original sharing locks. Inspect the mutable Catalog leaf
through a real OS-validated handle, retain its bounded digest/identity, then close that leaf immediately.
Retain the Catalog directory guard with list access and READ|WRITE sharing while denying DELETE sharing.
Open that guard before releasing its earlier restrictive guard, and reopen/revalidate the current leaf at
the final acceptance boundary. This preserves Core publication without making the Catalog an immutable asset.

A real CreateFileW/File.Move matrix found that READ-only directory sharing blocks both leaf overwrite and
directory rename; READ|WRITE allows leaf overwrite while still rejecting directory rename. Allowing DELETE
permits directory rename and is unsuitable for that guard. Merely changing leaf sharing was insufficient.
The final ten-case Windows group verifies normal publication, stale detection after same-byte replacement,
unsafe leaf/parent ACL and junction refusal, and continued directory-rename refusal. The failed probes remain
in the independent log; no original directory permissions were changed.

## Existing-style temporary Windows fixtures

- Use the existing `tempfile` dev dependency. Create only test-owned objects, hold their production verifier
  handles, and attempt write/delete/leaf or parent rename. Assert refusal while held, unchanged opened IDs,
  then successful replacement after release and detection of the replacement identity.
- `std::fs::hard_link` supplies a real multi-link negative case. `std::os::windows::fs::{symlink_file, symlink_dir}`
  supplies reparse cases with existing privileges; report unavailable fixture privileges without changing them.
- On those temporary objects only, `ConvertStringSecurityDescriptorToSecurityDescriptorW` (`Authorization:352`)
  plus `SetSecurityInfo` (`:534`) supplies permissive-DACL/unsafe-parent cases. Compare a fixture's real token/owner
  against a deliberately wrong registration; no credential read is needed.
- Reuse the helper's in-memory `FakeStore` tests (`bin/taki-secret-key.rs:157`) for key material. Test invocation
  and preload refusal with test-owned packaged artifacts and fake frames, never the original Credential Manager
  account. No service or runtime installation is required for these temporary-object/API fixtures.

Design inputs: current `design.md:28–66`, `research/design-review-resolution.md`, and sibling B's
`research/stage5c-post5b-readiness-2026-10-13.md`. These API pointers preserve their C1a/C1b/C2a boundaries.
