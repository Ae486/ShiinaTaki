//! INPUT:  a raw shell-open request Value ({ kind: "url"|"path", target }) — untrusted agent input
//! OUTPUT: classify -> gate::ShellOpenClass (url-safe/local-file/local-exec/blocked); parse_target
//! POS:    shell/capabilities/shell_open — the target classifier feeding Gate::evaluate_shell_open (A1 fix); fail-closed

use serde_json::Value;

use crate::gate::ShellOpenClass;

// URL schemes allowed to launch in v1; everything else (file:, javascript:, custom app schemes) is Blocked (ruling 3).
const ALLOWED_SCHEMES: [&str; 3] = ["http", "https", "mailto"];

// Extensions that run code when opened via ShellExecute — the local-exec floor (R2). Beyond plain executables this
// covers the classic Windows launch vectors: script hosts, shortcuts (.lnk/.url/.scf), installers (+patches/
// transforms), ClickOnce, control-panel applets, .reg merges, script-hosting containers (.jar/.chm/.gadget) and the
// settings-redirector formats abused for code launch (.settingcontent-ms/.diagcab).
const EXEC_EXTENSIONS: &[&str] = &[
    "exe", "bat", "cmd", "com", "ps1", "sh", "msi", "msp", "mst", "hta", "lnk", "url", "scf", "scr", "vbs",
    "js", "jse", "vbe", "ws", "wsf", "wsh", "pif", "cpl", "msc", "reg", "jar", "chm", "gadget", "application",
    "appref-ms", "settingcontent-ms", "diagcab",
];

/// Derives the target class the gate authorizes on. The class is computed here, never trusted from the wire; a
/// malformed or ambiguous target fails toward the riskier class (Blocked / LocalExec), never toward a silent one.
pub fn classify(input: &Value) -> ShellOpenClass {
    match parse_target(input) {
        // Malformed request: nothing meaningful to show a user — refuse without a dialog.
        None => ShellOpenClass::Blocked,
        Some((kind, target)) => {
            // A control char can make the OS launch something other than what the dialog renders (NUL truncation
            // turns "evil.exe\0.pdf" into evil.exe) — the target the user authorizes MUST be the target that opens.
            // Legitimate urls/paths never contain control chars, so Blocked is the correct fail-closed answer.
            if target.chars().any(char::is_control) {
                return ShellOpenClass::Blocked;
            }
            match kind.as_str() {
                "url" => classify_url(&target),
                "path" => classify_path(&target),
                _ => ShellOpenClass::Blocked,
            }
        }
    }
}

// Extracts (kind, target) from the input, or None if the shape is wrong.
pub(super) fn parse_target(input: &Value) -> Option<(String, String)> {
    let kind = input.get("kind").and_then(Value::as_str)?;
    let target = input.get("target").and_then(Value::as_str)?;
    Some((kind.to_string(), target.to_string()))
}

fn classify_url(target: &str) -> ShellOpenClass {
    let scheme = target.split_once(':').map(|(scheme, _)| scheme.to_ascii_lowercase());
    match scheme {
        Some(scheme) if ALLOWED_SCHEMES.contains(&scheme.as_str()) => ShellOpenClass::UrlSafe,
        _ => ShellOpenClass::Blocked,
    }
}

fn classify_path(target: &str) -> ShellOpenClass {
    // Windows ignores trailing dots/spaces when resolving a name — strip them so "cmd.exe. " still reads as .exe.
    let cleaned = target.trim().trim_end_matches(['.', ' ']);
    if cleaned.is_empty() {
        return ShellOpenClass::Blocked;
    }
    // A UNC target resolves on a remote host — unknowable content, executable-grade risk.
    if cleaned.starts_with("\\\\") || cleaned.starts_with("//") {
        return ShellOpenClass::LocalExec;
    }
    match extension_of(cleaned) {
        Some(ext) if EXEC_EXTENSIONS.contains(&ext.as_str()) => ShellOpenClass::LocalExec,
        // A renderable document/media extension — still asked on every request, never silent (R2 floor is LocalExec,
        // but LocalFile is equally always-ask; only the dialog label differs).
        Some(_) => ShellOpenClass::LocalFile,
        // No extension is ambiguous (a folder? a PATH-resolved program?) — fail toward the riskier class.
        None => ShellOpenClass::LocalExec,
    }
}

// The lowercased extension of the final path component. An NTFS alternate-data-stream suffix (notes.txt:evil.exe)
// naturally yields the stream's extension — which is the one that would run.
fn extension_of(path: &str) -> Option<String> {
    let component = path.rsplit(['\\', '/']).next().unwrap_or(path);
    let (stem, ext) = component.rsplit_once('.')?;
    if stem.is_empty() || ext.is_empty() {
        return None; // a dotfile (".gitignore") or a bare trailing dot has no extension in the launch sense
    }
    Some(ext.to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn class_of(kind: &str, target: &str) -> ShellOpenClass {
        classify(&json!({ "kind": kind, "target": target }))
    }

    #[test]
    fn allowlisted_url_schemes_are_url_safe() {
        for target in ["http://x.test", "https://example.com/p?q=1", "mailto:a@b.test", "HTTPS://UPPER.CASE"] {
            assert_eq!(class_of("url", target), ShellOpenClass::UrlSafe, "{target}");
        }
    }

    #[test]
    fn non_allowlisted_or_malformed_urls_are_blocked() {
        for target in ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "ms-settings:", "noscheme"] {
            assert_eq!(class_of("url", target), ShellOpenClass::Blocked, "{target}");
        }
    }

    #[test]
    fn executable_and_script_extensions_are_local_exec() {
        for target in [
            "C:\\Windows\\System32\\cmd.exe",
            "C:\\x\\run.bat",
            "C:\\x\\run.cmd",
            "C:\\x\\payload.ps1",
            "C:\\x\\setup.msi",
            "C:\\x\\page.hta",
            "C:\\x\\link.lnk",
            "C:\\x\\screen.scr",
            "C:\\x\\macro.vbs",
            "C:\\x\\script.js",
            "C:\\x\\merge.reg",
            "C:\\x\\link.url",
            "C:\\x\\shell.scf",
            "C:\\x\\app.appref-ms",
            "C:\\x\\lib.jar",
            "C:\\x\\help.chm",
            "C:\\x\\panel.settingcontent-ms",
            "/home/x/run.sh",
        ] {
            assert_eq!(class_of("path", target), ShellOpenClass::LocalExec, "{target}");
        }
    }

    #[test]
    fn extension_tricks_still_classify_as_local_exec() {
        // Trailing dots/spaces (stripped by Windows name resolution), case, and an ADS-hidden executable stream.
        for target in ["C:\\x\\evil.EXE", "C:\\x\\evil.exe.", "C:\\x\\evil.exe  ", "C:\\x\\notes.txt:evil.exe"] {
            assert_eq!(class_of("path", target), ShellOpenClass::LocalExec, "{target:?}");
        }
    }

    #[test]
    fn ambiguous_targets_fail_closed_to_local_exec() {
        // No extension (folder or PATH-resolved program) and UNC targets — never the softer LocalFile.
        for target in ["C:\\Users\\me\\Documents", "cmd", "\\\\server\\share\\doc.pdf", "//server/share/x"] {
            assert_eq!(class_of("path", target), ShellOpenClass::LocalExec, "{target}");
        }
    }

    #[test]
    fn renderable_documents_are_local_file() {
        for target in ["C:\\Users\\me\\report.pdf", "C:\\x\\notes.txt", "C:\\x\\pic.png", "C:\\x\\archive.tar.gz"] {
            assert_eq!(class_of("path", target), ShellOpenClass::LocalFile, "{target}");
        }
    }

    #[test]
    fn malformed_requests_are_blocked() {
        assert_eq!(classify(&json!({ "kind": "url" })), ShellOpenClass::Blocked);
        assert_eq!(classify(&json!({ "target": "https://x" })), ShellOpenClass::Blocked);
        assert_eq!(classify(&json!({ "kind": "registry", "target": "HKLM" })), ShellOpenClass::Blocked);
        assert_eq!(class_of("path", "   "), ShellOpenClass::Blocked);
        assert_eq!(class_of("path", ". . ."), ShellOpenClass::Blocked);
    }

    #[test]
    fn control_characters_block_the_target_regardless_of_extension() {
        // NUL truncation could launch "evil.exe" while the dialog renders "evil.exe\0.pdf" as a .pdf — any control
        // char (url or path) is Blocked before extension logic ever runs.
        for target in ["C:\\x\\evil.exe\0.pdf", "C:\\x\\re\rport.pdf", "C:\\x\\re\nport.pdf", "C:\\x\\re\tport.pdf"] {
            assert_eq!(class_of("path", target), ShellOpenClass::Blocked, "{target:?}");
        }
        assert_eq!(class_of("url", "http://x.test/\0evil"), ShellOpenClass::Blocked);
        // No regression: the clean equivalents keep their classes.
        assert_eq!(class_of("path", "C:\\Users\\me\\report.pdf"), ShellOpenClass::LocalFile);
        assert_eq!(class_of("url", "http://x.test/evil"), ShellOpenClass::UrlSafe);
    }
}
