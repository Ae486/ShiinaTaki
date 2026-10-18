//! INPUT:  the registered Core Catalog directory, expected sealed digest and actual Host token user
//! OUTPUT: owner/DACL/parent-verified read-only Catalog snapshot with final current-object validation
//! POS:    shell/hindsight_windows — mutable Catalog leaf permits Core rename publication; ancestors stay pinned

use std::io::Read;
use std::path::{Path, PathBuf};
use sha2::{Digest, Sha256};
use crate::protocol::{CUSTODY_ENVELOPE_BYTES, HindsightRefusal};
use super::objects::{FileIdentity, HeldObject, HeldObjects, local_path, open_catalog_object};

pub(super) struct CatalogSnapshot {
    path: PathBuf,
    identity: FileIdentity,
    digest: String,
}

impl CatalogSnapshot {
    pub fn open(objects: &mut HeldObjects, directory: &Path, sid: &[u8], expected: &str) -> Result<Self, HindsightRefusal> {
        let directory = local_path(directory)?;
        objects.hold_catalog_directory(&directory)?;
        let path = directory.join("secret-catalog.bin");
        let mut object = open_catalog_object(&path, sid)?;
        if sealed_digest(&mut object)? != expected { return Err(HindsightRefusal::SnapshotStale); }
        let snapshot = Self { path, identity: object.identity.clone(), digest: expected.to_string() };
        // Windows replacement can fail even with FILE_SHARE_DELETE while a read handle remains open.
        // Only immutable identity/digest evidence survives this read; the protected parents remain pinned.
        drop(object);
        snapshot.validate(sid)?;
        Ok(snapshot)
    }

    pub fn validate(&self, sid: &[u8]) -> Result<(), HindsightRefusal> {
        // Reopen the registered leaf so replacement with even identical bytes invalidates the old identity.
        // This temporary handle closes before returning and cannot block later Core publication.
        let mut current = open_catalog_object(&self.path, sid)?;
        if current.identity != self.identity || sealed_digest(&mut current)? != self.digest {
            return Err(HindsightRefusal::SnapshotStale);
        }
        Ok(())
    }
}

fn sealed_digest(object: &mut HeldObject) -> Result<String, HindsightRefusal> {
    if object.file.metadata().map_err(|_| HindsightRefusal::SnapshotStale)?.len() > CUSTODY_ENVELOPE_BYTES as u64 {
        return Err(HindsightRefusal::InputOversize);
    }
    let mut bytes = Vec::new();
    (&mut object.file).take(CUSTODY_ENVELOPE_BYTES as u64 + 1).read_to_end(&mut bytes)
        .map_err(|_| HindsightRefusal::SnapshotStale)?;
    if bytes.len() > CUSTODY_ENVELOPE_BYTES { return Err(HindsightRefusal::InputOversize); }
    Ok(format!("{:x}", Sha256::digest(&bytes)))
}
