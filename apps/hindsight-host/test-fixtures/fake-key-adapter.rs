//! INPUT:  the fixed get-only adapter argv and an empty private stdin in an isolated C1a fixture
//! OUTPUT: one fixed FAKE 32-byte key in the existing u32-LE framed protocol
//! POS:    hindsight-host/tests — fixture executable only; never reads Credential Manager or production data

use std::io::{Read, Write};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args != ["get", "--account", "secret-catalog-master-key-v1"] {
        std::process::exit(2);
    }
    let mut unexpected = [0u8; 1];
    if std::io::stdin().read(&mut unexpected).unwrap_or(1) != 0 {
        std::process::exit(2);
    }
    let mut frame = [0xa5u8; 36];
    frame[..4].copy_from_slice(&32u32.to_le_bytes());
    if std::io::stdout().write_all(&frame).is_err() {
        std::process::exit(2);
    }
}
