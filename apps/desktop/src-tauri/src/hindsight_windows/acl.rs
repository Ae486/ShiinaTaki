//! INPUT:  retained Windows file/directory handles and the actual execution-user SID
//! OUTPUT: conservative owner/DACL protection proof over applicable non-inherit-only ACEs
//! POS:    shell/hindsight_windows — never changes production ACLs or treats current-user access as protection

use std::mem::{size_of, offset_of};
use windows::core::PWSTR;
use windows::Win32::Foundation::{HANDLE, HLOCAL, LocalFree};
use windows::Win32::Security::{
    ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_SIZE_INFORMATION, AclSizeInformation,
    DACL_SECURITY_INFORMATION, GENERIC_MAPPING, GetAce, GetAclInformation, GetLengthSid,
    INHERIT_ONLY_ACE, IsValidSid, MapGenericMask, OWNER_SECURITY_INFORMATION, PSID, PSECURITY_DESCRIPTOR,
};
use windows::Win32::Security::Authorization::{ConvertSidToStringSidW, GetSecurityInfo, SE_FILE_OBJECT};
use windows::Win32::Storage::FileSystem::{
    DELETE, FILE_ALL_ACCESS, FILE_APPEND_DATA, FILE_DELETE_CHILD, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ,
    FILE_GENERIC_WRITE, FILE_WRITE_ATTRIBUTES, FILE_WRITE_DATA, FILE_WRITE_EA, WRITE_DAC, WRITE_OWNER,
};
use windows::Win32::System::SystemServices::{ACCESS_ALLOWED_ACE_TYPE, ACCESS_DENIED_ACE_TYPE};
use crate::protocol::HindsightRefusal;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum ObjectRole { Ancestor, Payload }

struct SecurityDescriptor(PSECURITY_DESCRIPTOR);
impl Drop for SecurityDescriptor {
    fn drop(&mut self) {
        // SAFETY: GetSecurityInfo allocated this descriptor; dependent owner/ACL pointers are no longer used.
        unsafe { LocalFree(Some(HLOCAL(self.0.0))); }
    }
}

pub(super) fn verify_acl(handle: HANDLE, current_sid: &[u8], role: ObjectRole) -> Result<(), HindsightRefusal> {
    let mut owner = PSID::default();
    let mut acl: *mut ACL = std::ptr::null_mut();
    let mut descriptor = PSECURITY_DESCRIPTOR::default();
    // SAFETY: handle is retained; all output pointers refer to local storage and the allocated descriptor is freed.
    unsafe { GetSecurityInfo(handle, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
        Some(&mut owner), None, Some(&mut acl), None, Some(&mut descriptor)) }.ok()
        .map_err(|_| HindsightRefusal::UnsafeInstallation)?;
    let _guard = SecurityDescriptor(descriptor);
    if acl.is_null() || !trusted_sid(owner, current_sid)? { return Err(HindsightRefusal::UnsafeInstallation); }
    let mut info = ACL_SIZE_INFORMATION::default();
    // SAFETY: GetSecurityInfo returned a live ACL and info is an aligned output of the documented size.
    unsafe { GetAclInformation(acl, (&mut info as *mut ACL_SIZE_INFORMATION).cast(), size_of::<ACL_SIZE_INFORMATION>() as u32, AclSizeInformation) }
        .map_err(|_| HindsightRefusal::UnsafeInstallation)?;
    for index in 0..info.AceCount {
        verify_ace(acl, index, current_sid, role)?;
    }
    Ok(())
}

fn verify_ace(acl: *const ACL, index: u32, current_sid: &[u8], role: ObjectRole) -> Result<(), HindsightRefusal> {
    let mut ace = std::ptr::null_mut();
    // SAFETY: acl is alive throughout the descriptor guard; index is below its reported ACE count.
    unsafe { GetAce(acl, index, &mut ace) }.map_err(|_| HindsightRefusal::UnsafeInstallation)?;
    if ace.is_null() { return Err(HindsightRefusal::UnsafeInstallation); }
    // SAFETY: a successfully retrieved ACE always starts with ACE_HEADER.
    let header = unsafe { &*ace.cast::<ACE_HEADER>() };
    if u32::from(header.AceFlags) & INHERIT_ONLY_ACE.0 != 0 { return Ok(()); }
    // Conditional/object/callback ACE semantics require a broader policy engine. Reject rather than approximate.
    if u32::from(header.AceType) != ACCESS_ALLOWED_ACE_TYPE && u32::from(header.AceType) != ACCESS_DENIED_ACE_TYPE {
        return Err(HindsightRefusal::UnsafeInstallation);
    }
    let sid_offset = offset_of!(ACCESS_ALLOWED_ACE, SidStart);
    if usize::from(header.AceSize) < sid_offset + 8 { return Err(HindsightRefusal::UnsafeInstallation); }
    // SAFETY: standard allow/deny ACEs share the fixed mask/SID layout; minimum size was checked above.
    let sid = PSID(unsafe { ace.cast::<u8>().add(sid_offset).cast() });
    // SAFETY: the OS-validated ACE owns the SID bytes; check its declared extent before copying/conversion.
    if !unsafe { IsValidSid(sid).as_bool() } || unsafe { GetLengthSid(sid) } as usize > usize::from(header.AceSize) - sid_offset {
        return Err(HindsightRefusal::UnsafeInstallation);
    }
    // Deny never expands rights. We conservatively refuse a later dangerous Allow even when earlier group denies
    // might mask it: this accepts fewer ACLs, without relying on an incomplete group-token/access-check model.
    if u32::from(header.AceType) == ACCESS_DENIED_ACE_TYPE || trusted_sid(sid, current_sid)? { return Ok(()); }
    let mut mask = unsafe { (*ace.cast::<ACCESS_ALLOWED_ACE>()).Mask };
    let mapping = GENERIC_MAPPING { GenericRead: FILE_GENERIC_READ.0, GenericWrite: FILE_GENERIC_WRITE.0,
        GenericExecute: FILE_GENERIC_EXECUTE.0, GenericAll: FILE_ALL_ACCESS.0 };
    // SAFETY: both arguments point to initialized stack values of the documented types.
    unsafe { MapGenericMask(&mut mask, &mapping); }
    let dangerous = DELETE.0 | WRITE_DAC.0 | WRITE_OWNER.0 | FILE_DELETE_CHILD.0
        | FILE_WRITE_DATA.0 | FILE_WRITE_ATTRIBUTES.0 | FILE_WRITE_EA.0
        | if role == ObjectRole::Payload { FILE_APPEND_DATA.0 } else { 0 };
    // Ancestors may allow creating a new sibling directory (e.g. the Windows drive root); they may not permit
    // deletion, redirection, metadata changes or replacing the already-held path. Payload dirs also disallow add-dir.
    if mask & dangerous != 0 { return Err(HindsightRefusal::UnsafeInstallation); }
    Ok(())
}

fn trusted_sid(sid: PSID, current_sid: &[u8]) -> Result<bool, HindsightRefusal> {
    // SAFETY: the owner/ACE pointer is kept alive by the security descriptor guard.
    if sid.is_invalid() || !unsafe { IsValidSid(sid).as_bool() } { return Err(HindsightRefusal::UnsafeInstallation); }
    let bytes = unsafe { std::slice::from_raw_parts(sid.0.cast::<u8>(), GetLengthSid(sid) as usize) };
    if bytes == current_sid { return Ok(true); }
    let mut text = PWSTR::null();
    // SAFETY: validated SID is live; Windows allocates a NUL-terminated SID string, freed exactly once below.
    unsafe { ConvertSidToStringSidW(sid, &mut text) }.map_err(|_| HindsightRefusal::UnsafeInstallation)?;
    let value = unsafe { text.to_string() };
    unsafe { LocalFree(Some(HLOCAL(text.0.cast()))); }
    let value = value.map_err(|_| HindsightRefusal::UnsafeInstallation)?;
    Ok(matches!(value.as_str(), "S-1-5-18" | "S-1-5-32-544"
        | "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464"))
}
