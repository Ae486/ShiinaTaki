//! INPUT: fixed adapter argv and bounded private stdin under an explicitly marked fixture.
//! OUTPUT: a single exchange with the test parent's private named pipe, never a Docker daemon.
//! POS: hindsight-host/tests — finite engine substitution executable, not a shipped adapter.

use std::io::{Read, Write};

fn packet(output: &mut impl Write, bytes: &[u8]) -> std::io::Result<()> {
    output.write_all(&(bytes.len() as u32).to_le_bytes())?;
    output.write_all(bytes)
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let executable = std::env::current_exe()?;
    let root = executable.parent().ok_or("missing fixture root")?;
    if std::fs::read(root.join(".c2a-owned-fixture"))? != b"C2A_FAKE_ONLY" {
        return Err("unmarked fixture".into());
    }
    let path = std::fs::read_to_string(root.join("engine-pipe.txt"))?;
    if !path.starts_with(r"\\.\pipe\taki-c2a-") || path.len() > 100 {
        return Err("wrong fixture pipe".into());
    }
    let mut channel = std::fs::OpenOptions::new().read(true).write(true).open(path)?;
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() > 64 || args.iter().any(|arg| arg.len() > 4096) {
        return Err("unbounded fixture argv".into());
    }
    channel.write_all(&(args.len() as u32).to_le_bytes())?;
    for arg in args { packet(&mut channel, arg.as_bytes())?; }
    let mut input = Vec::new();
    std::io::stdin().take(4 * 1024 * 1024 + 5).read_to_end(&mut input)?;
    if input.len() > 4 * 1024 * 1024 + 4 { return Err("unbounded fixture input".into()); }
    packet(&mut channel, &input)?;
    input.fill(0);
    let mut length = [0_u8; 4];
    channel.read_exact(&mut length)?;
    let size = u32::from_le_bytes(length) as usize;
    if size > 1024 * 1024 { return Err("unbounded fixture output".into()); }
    let mut output = vec![0; size];
    channel.read_exact(&mut output)?;
    std::io::stdout().write_all(&output)?;
    Ok(())
}

fn main() {
    if run().is_err() { std::process::exit(1); }
}
