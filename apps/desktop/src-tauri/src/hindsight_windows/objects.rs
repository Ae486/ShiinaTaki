//! INPUT:  registered absolute local NTFS paths and the actual Host token user
//! OUTPUT: retained no-write/no-delete-share handles, same-object digests and final-path/ACL checks
//! POS:    shell/hindsight_windows — every ancestor is checked before following a child; Catalog stays unlocked

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::mem::size_of;
use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
use std::path::{Path, PathBuf};
use sha2::{Digest, Sha256};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::Storage::FileSystem::{
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_TAG_INFO, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
    FILE_ID_INFO, FILE_INFO_BY_HANDLE_CLASS, FILE_LIST_DIRECTORY, FILE_NAME_NORMALIZED, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    FILE_STANDARD_INFO, FILE_TYPE_DISK, FileAttributeTagInfo, FileIdInfo, FileStandardInfo,
    GetFileInformationByHandleEx, GetFileType, GetFinalPathNameByHandleW, GetVolumeInformationByHandleW,
    READ_CONTROL, VOLUME_NAME_DOS, GETFINALPATHNAMEBYHANDLE_FLAGS,
};
use windows::Win32::System::SystemServices::FILE_PERSISTENT_ACLS;
use super::acl::{ObjectRole, verify_acl};
use crate::protocol::HindsightRefusal;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct FileIdentity { volume: u64, id: [u8; 16] }
pub(super) struct HeldObject { pub file: File, pub path: PathBuf, pub identity: FileIdentity, directory: bool, role: ObjectRole }
pub(super) struct HeldObjects { pub objects: HashMap<PathBuf, HeldObject>, sid: Vec<u8> }

impl HeldObjects {
    pub fn new(sid: Vec<u8>) -> Self { Self { objects: HashMap::new(), sid } }
    pub fn hold(&mut self, path: &Path, directory: bool) -> Result<(), HindsightRefusal> {
        let path = local_path(path)?;
        let mut ancestors: Vec<_> = path.ancestors().skip(1).map(Path::to_path_buf).collect();
        ancestors.reverse();
        for ancestor in ancestors { self.hold_one(&ancestor, true, ObjectRole::Ancestor)?; }
        self.hold_one(&path, directory, ObjectRole::Payload)
    }
    pub fn hold_catalog_directory(&mut self, path: &Path) -> Result<(), HindsightRefusal> {
        let path = local_path(path)?;
        self.hold(&path, true)?;
        // Windows rename replacement needs write access to its destination directory. Allow that sharing,
        // but keep delete sharing denied so this parent's name stays pinned. Open the replacement guard
        // before releasing the restrictive one; no unchecked parent gap is introduced.
        let guard = open_object_with_share(&path, true, &self.sid, ObjectRole::Payload,
            FILE_SHARE_READ.0 | FILE_SHARE_WRITE.0)?;
        self.objects.insert(path, guard);
        Ok(())
    }
    fn hold_one(&mut self, path: &Path, directory: bool, role: ObjectRole) -> Result<(), HindsightRefusal> {
        if let Some(held) = self.objects.get_mut(path) {
            if held.directory != directory { return Err(HindsightRefusal::UnsafeInstallation); }
            if role == ObjectRole::Ancestor { return Ok(()); }
            verify_acl(HANDLE(held.file.as_raw_handle()), &self.sid, role)?;
            held.role = role;
            return Ok(());
        }
        let held = open_object(path, directory, &self.sid, role)?;
        self.objects.insert(path.to_path_buf(), held);
        Ok(())
    }
    pub fn read(&mut self, path: &Path, limit: usize) -> Result<Vec<u8>, HindsightRefusal> {
        let held = self.objects.get_mut(&local_path(path)?).ok_or(HindsightRefusal::UnsafeInstallation)?;
        if held.directory || held.file.metadata().map_err(unsafe_io)?.len() > limit as u64 {
            return Err(HindsightRefusal::InputOversize);
        }
        held.file.seek(SeekFrom::Start(0)).map_err(unsafe_io)?;
        let mut result = Vec::new();
        (&mut held.file).take(limit as u64 + 1).read_to_end(&mut result).map_err(unsafe_io)?;
        if result.len() > limit { return Err(HindsightRefusal::InputOversize); }
        Ok(result)
    }
    pub fn digest(&mut self, path: &Path) -> Result<String, HindsightRefusal> {
        let held = self.objects.get_mut(&local_path(path)?).ok_or(HindsightRefusal::UnsafeInstallation)?;
        let limit = 512 * 1024 * 1024;
        if held.directory || held.file.metadata().map_err(unsafe_io)?.len() > limit { return Err(HindsightRefusal::InputOversize); }
        held.file.seek(SeekFrom::Start(0)).map_err(unsafe_io)?;
        let mut hash = Sha256::new();
        let mut chunk = [0u8; 65_536];
        let mut total = 0u64;
        loop {
            let count = held.file.read(&mut chunk).map_err(unsafe_io)?;
            if count == 0 { break; }
            total += count as u64;
            if total > limit { return Err(HindsightRefusal::InputOversize); }
            hash.update(&chunk[..count]);
        }
        Ok(format!("{:x}", hash.finalize()))
    }
    pub fn validate(&self) -> Result<(), HindsightRefusal> {
        for held in self.objects.values() {
            let handle = HANDLE(held.file.as_raw_handle());
            if identity(handle)? != held.identity || final_path(handle)? != held.path {
                return Err(HindsightRefusal::SnapshotStale);
            }
            let tags: FILE_ATTRIBUTE_TAG_INFO = query(handle, FileAttributeTagInfo)?;
            let standard: FILE_STANDARD_INFO = query(handle, FileStandardInfo)?;
            if tags.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 || standard.DeletePending
                || standard.Directory != held.directory || (!held.directory && standard.NumberOfLinks != 1) {
                return Err(HindsightRefusal::SnapshotStale);
            }
            verify_acl(handle, &self.sid, held.role)?;
        }
        Ok(())
    }
}

pub(super) fn local_path(path: &Path) -> Result<PathBuf, HindsightRefusal> {
    let value = path.to_str().ok_or(HindsightRefusal::UnsafeInstallation)?.replace('/', "\\");
    let bytes = value.as_bytes();
    if bytes.len() < 3 || !bytes[0].is_ascii_alphabetic() || bytes[1..3] != *b":\\"
        || value[2..].contains(':') || value.contains('\0') || value.encode_utf16().count() > 4096 {
        return Err(HindsightRefusal::UnsafeInstallation);
    }
    let suffix = value[3..].trim_end_matches('\\');
    if !suffix.is_empty() && suffix.split('\\').any(|part| part.is_empty() || part == "." || part == ".."
        || part.ends_with('.') || part.ends_with(' ') || part.chars().any(char::is_control)) {
        return Err(HindsightRefusal::UnsafeInstallation);
    }
    // Final Windows spelling is canonicalized once after opening; use case-insensitive path keys to prevent aliases.
    Ok(PathBuf::from(value.trim_end_matches('\\').to_ascii_lowercase() + if suffix.is_empty() { "\\" } else { "" }))
}

pub(super) fn open_object(path: &Path, directory: bool, sid: &[u8], role: ObjectRole) -> Result<HeldObject, HindsightRefusal> {
    open_object_with_share(path, directory, sid, role, FILE_SHARE_READ.0)
}

/// The Catalog is a mutable Core-owned publication, so its inspected leaf must permit atomic replacement.
/// Its parent chain is still pinned by HeldObjects before this function follows the registered leaf. Callers
/// must close this temporary leaf after inspection: share-delete alone does not guarantee rename replacement.
pub(super) fn open_catalog_object(path: &Path, sid: &[u8]) -> Result<HeldObject, HindsightRefusal> {
    open_object_with_share(path, false, sid, ObjectRole::Payload, FILE_SHARE_READ.0 | FILE_SHARE_WRITE.0 | FILE_SHARE_DELETE.0)
}

/// A provisioned private lock leaf is held with no sharing for this Shell's
/// complete resource-owner lifetime. Missing/foreign locks are never repaired.
pub(super) fn open_state_lock(path: &Path, sid: &[u8]) -> Result<HeldObject, HindsightRefusal> {
    open_object_with_share(path, false, sid, ObjectRole::Payload, 0)
}

fn open_object_with_share(path: &Path, directory: bool, sid: &[u8], role: ObjectRole, share: u32) -> Result<HeldObject, HindsightRefusal> {
    let mut options = OpenOptions::new();
    // Metadata-only directory handles do not participate in Windows' data-access sharing checks and permit
    // rename despite omitting FILE_SHARE_DELETE. Request list access so every retained parent pins its name.
    if directory { options.access_mode(FILE_LIST_DIRECTORY.0 | FILE_READ_ATTRIBUTES.0 | READ_CONTROL.0); } else { options.read(true); }
    options.share_mode(share).custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0
        | if directory { FILE_FLAG_BACKUP_SEMANTICS.0 } else { 0 });
    let file = options.open(path).map_err(unsafe_io)?;
    let handle = HANDLE(file.as_raw_handle());
    let tags: FILE_ATTRIBUTE_TAG_INFO = query(handle, FileAttributeTagInfo)?;
    let standard: FILE_STANDARD_INFO = query(handle, FileStandardInfo)?;
    // SAFETY: file owns this live handle for the complete inspection/consumer lifetime.
    if unsafe { GetFileType(handle) } != FILE_TYPE_DISK || tags.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0
        || standard.Directory != directory || standard.DeletePending || (!directory && standard.NumberOfLinks != 1)
        || final_path(handle)? != path {
        return Err(HindsightRefusal::UnsafeInstallation);
    }
    verify_filesystem(handle)?;
    verify_acl(handle, sid, role)?;
    let identity = identity(handle)?;
    Ok(HeldObject { file, path: path.to_path_buf(), identity, directory, role })
}

fn verify_filesystem(handle: HANDLE) -> Result<(), HindsightRefusal> {
    let mut name = [0u16; 32]; let mut flags = 0;
    // SAFETY: retained handle and bounded writable output buffers are valid for the call.
    unsafe { GetVolumeInformationByHandleW(handle, None, None, None, Some(&mut flags), Some(&mut name)) }.map_err(|_| HindsightRefusal::UnsafeInstallation)?;
    let length = name.iter().position(|value| *value == 0).ok_or(HindsightRefusal::UnsafeInstallation)?;
    if String::from_utf16_lossy(&name[..length]) != "NTFS" || flags & FILE_PERSISTENT_ACLS == 0 {
        return Err(HindsightRefusal::UnsupportedInstallation);
    }
    Ok(())
}
fn identity(handle: HANDLE) -> Result<FileIdentity, HindsightRefusal> {
    let info: FILE_ID_INFO = query(handle, FileIdInfo)?;
    Ok(FileIdentity { volume: info.VolumeSerialNumber, id: info.FileId.Identifier })
}
fn final_path(handle: HANDLE) -> Result<PathBuf, HindsightRefusal> {
    let mut buffer = [0u16; 4096];
    // SAFETY: retained handle and bounded UTF-16 output buffer; the returned length is checked before slicing.
    let flags = GETFINALPATHNAMEBYHANDLE_FLAGS(FILE_NAME_NORMALIZED.0 | VOLUME_NAME_DOS.0);
    let count = unsafe { GetFinalPathNameByHandleW(handle, &mut buffer, flags) } as usize;
    if count == 0 || count >= buffer.len() { return Err(HindsightRefusal::UnsafeInstallation); }
    let value = String::from_utf16(&buffer[..count]).map_err(|_| HindsightRefusal::UnsafeInstallation)?;
    local_path(Path::new(value.strip_prefix("\\\\?\\").ok_or(HindsightRefusal::UnsafeInstallation)?))
}
fn query<T: Default>(handle: HANDLE, kind: FILE_INFO_BY_HANDLE_CLASS) -> Result<T, HindsightRefusal> {
    let mut value = T::default();
    // SAFETY: callers pair the documented information class with its matching initialized, aligned output type.
    unsafe { GetFileInformationByHandleEx(handle, kind, (&mut value as *mut T).cast(), size_of::<T>() as u32) }
        .map_err(|_| HindsightRefusal::UnsafeInstallation)?;
    Ok(value)
}
fn unsafe_io(_: std::io::Error) -> HindsightRefusal { HindsightRefusal::UnsafeInstallation }
