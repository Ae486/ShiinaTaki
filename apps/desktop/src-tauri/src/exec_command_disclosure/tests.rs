use super::*;

fn joined(value: &HostChallengePresentation) -> String {
    value.sections.iter().flat_map(|s| s.fields.iter().map(|f| f.value.as_str())).collect()
}

fn project(raw: &str) -> String { joined(&project_exec_command(raw).expect("complete disclosure")) }

#[test]
fn masks_complete_credential_values_and_keeps_source_delimiters() {
    for (raw, expected) in [
        ("tool --token abc=tail:more --mode fast", "tool --token [凭证已隐藏] --mode fast"),
        ("tool --api-key=--private --password=\"a b\"suffix", "tool --api-key=[凭证已隐藏] --password=\"[凭证已隐藏]\""),
        ("tool --PaSsWoRd 'alpha'omega --token=last", "tool --PaSsWoRd '[凭证已隐藏]' --token=[凭证已隐藏]"),
        ("env AWS_SECRET_ACCESS_KEY=top=secret tool --data keep", "env AWS_SECRET_ACCESS_KEY=[凭证已隐藏] tool --data keep"),
        ("set \"API_KEY=demo secret\"", "set \"API_KEY=[凭证已隐藏]\""),
        ("$env:TOKEN = \"demo secret\"", "$env:TOKEN = \"[凭证已隐藏]\""),
        ("$env:client_SECRET='demo'", "$env:client_SECRET='[凭证已隐藏]'"),
        ("tool --token='a'\"b\"c --token=again", "tool --token='[凭证已隐藏]'\"\" --token=[凭证已隐藏]"),
        ("tool sk-SYNTHETIC12345'private'suffix", "tool [凭证已隐藏]''"),
    ] { assert_eq!(project(raw), expected, "vector: {raw}"); }
}

#[test]
fn finite_key_families_and_path_exclusions_are_not_substring_rules() {
    for name in ["password", "passwd", "pwd", "TOKEN", "access_token", "refresh-token", "id_token",
        "api_key", "apikey", "secret", "client-secret", "secret_key", "secret_access_key",
        "authorization", "proxy_authorization", "cookie", "set-cookie"] {
        assert_eq!(project(&format!("tool --{name}=SYNTHETIC")), format!("tool --{name}={CREDENTIAL_MASK}"));
    }
    for name in ["MY_PASSWORD", "MY-PASSWD", "MY_TOKEN", "MY_SECRET", "MY_API_KEY", "MY_ACCESS_TOKEN",
        "MY_REFRESH_TOKEN", "MY_CLIENT_SECRET", "MY_SECRET_KEY", "AWS_SECRET_ACCESS_KEY"] {
        assert_eq!(project(&format!("{name}=SYNTHETIC")), format!("{name}={CREDENTIAL_MASK}"));
    }
    for raw in ["tool --key value --monkey ordinary --data arbitrary-user-text", "PUBLIC_KEY=value",
        "MYAPI_KEY=value", "TOKEN_PATH=sk-SYNTHETIC12345", "TOKEN_FILE=sk-SYNTHETIC12345",
        "tool --file sk-SYNTHETIC12345 --config=sk-SYNTHETIC12345 --output=unchanged",
        "tool -u alice -p 8080 /tmp/sk-SYNTHETIC12345/data.json"] {
        assert_eq!(project(raw), raw);
    }
    let path = r#"tool --file "C:\Users\alice\key store.json" \\server\share\folder --token=C:\private\value"#;
    assert_eq!(project(path), r#"tool --file "C:\\Users\\alice\\key store.json" \\\\server\\share\\folder --token=[凭证已隐藏]"#);
}

#[test]
fn header_and_curl_aliases_mask_whole_values_only_in_defined_contexts() {
    for (raw, expected) in [
        ("curl -H \"Authorization: Bearer SYNTHETIC entire tail\" https://example.test/api", "curl -H \"Authorization: Bearer [凭证已隐藏]\" https://example.test/api"),
        ("curl --header='Proxy-Authorization: Basic abc:xyz=='", "curl --header='Proxy-Authorization: Basic [凭证已隐藏]'"),
        ("curl -H\"X-Api-Key: abc\" -uuser:password -U 'proxy:secret'", "curl -H\"X-Api-Key: [凭证已隐藏]\" -u[凭证已隐藏] -U '[凭证已隐藏]'"),
        ("curl --user=user:password --proxy-user proxy:password", "curl --user=[凭证已隐藏] --proxy-user [凭证已隐藏]"),
        ("curl -H \"Cookie: a=one; b=two; third=three\"", "curl -H \"Cookie: [凭证已隐藏]\""),
        ("tool \"Set-Cookie: session=one; secure; expiry=later\"", "tool \"Set-Cookie: [凭证已隐藏]\""),
        ("curl -H \"X-Ordinary: preserve this\"", "curl -H \"X-Ordinary: preserve this\""),
        ("tool --user ordinary -H ordinary -u username -U update", "tool --user ordinary -H ordinary -u username -U update"),
        ("echo done;curl -u user:secret", "echo done;curl -u [凭证已隐藏]"),
        ("echo done; curl -u user:secret", "echo done; curl -u [凭证已隐藏]"),
        ("echo done && curl -u user:secret", "echo done && curl -u [凭证已隐藏]"),
    ] { assert_eq!(project(raw), expected, "vector: {raw}"); }
}

#[test]
fn url_offsets_preserve_host_paths_other_queries_and_fragment() {
    let raw = "curl 'https://alice:SYNTHETIC@host.test:443/path/sk-PATH123456789?a=keep&%61pi%5Fkey=hide==:all&ToKeN=next#section'";
    assert_eq!(project(raw), "curl 'https://[凭证已隐藏]@host.test:443/path/sk-PATH123456789?a=keep&%61pi%5Fkey=[凭证已隐藏]&ToKeN=[凭证已隐藏]#section'");
    assert_eq!(project("git fetch https://SYNTHETIC@host.test/repo"), "git fetch https://[凭证已隐藏]@host.test/repo");
    assert_eq!(project("tool --url=https://host.test/?token=abc&path=C:/ordinary&name=alice"),
        "tool --url=https://host.test/?token=[凭证已隐藏]&path=C:/ordinary&name=alice");
    assert_eq!(project("curl 'https://host.test/path;ordinary?token=abc;entire(tail)&name=alice'"),
        "curl 'https://host.test/path;ordinary?token=[凭证已隐藏]&name=alice'");
    assert_eq!(project("tool https://host.test/?path=C:/ordinary/sk-SYNTHETIC12345&token=secret"),
        "tool https://host.test/?path=C:/ordinary/sk-SYNTHETIC12345&token=[凭证已隐藏]");
}

#[test]
fn unicode_before_a_uri_preserves_scalar_boundaries_and_the_complete_tail() {
    for prefix in ["前缀", "é", "😀"] {
        let raw = format!("tool {prefix}https://host.test/?token=SYNTHETIC --mode ordinary");
        assert_eq!(project(&raw), format!("tool {prefix}https://host.test/?token={CREDENTIAL_MASK} --mode ordinary"));
    }
}

#[test]
fn recognized_tokens_and_uri_credentials_include_adjacent_quote_fragments() {
    for (raw, expected) in [
        ("tool 'sk-SYNTHETIC12345'PRIVATE_TAIL", "tool '[凭证已隐藏]'"),
        ("tool --data='sk-SYNTHETIC12345'PRIVATE_TAIL", "tool --data='[凭证已隐藏]'"),
        ("tool prefix:'sk-SYNTHETIC12345'PRIVATE_TAIL", "tool prefix:'[凭证已隐藏]'"),
        ("curl 'https://host.test/?token='PRIVATE_TAIL", "curl 'https://host.test/?token=[凭证已隐藏]'"),
        ("curl https://host.test/?token='alpha'PRIVATE_TAIL&name=alice", "curl https://host.test/?token='[凭证已隐藏]'&name=alice"),
        ("curl 'https://alice:'PRIVATE_TAIL'@host.test/path'", "curl 'https://[凭证已隐藏]''@host.test/path'"),
    ] {
        assert_eq!(project(raw), expected, "vector: {raw}");
    }
}

#[test]
fn vendor_jwt_and_private_keys_hide_unbounded_tails() {
    for prefix in ["sk-", "sk_live_", "sk_test_", "rk_live_", "ghp_", "gho_", "ghu_", "ghs_", "ghr_",
        "github_pat_", "xoxb-", "xoxa-", "xoxp-", "xoxr-", "xoxs-", "xapp-1-", "AIza", "AKIA",
        "SG.", "hf_", "r8_", "npm_", "pypi-", "dop_v1_", "xai-", "gsk_", "ntn_", "tvly-", "sk_", "eyJ"] {
        let raw = format!("tool {prefix}{}=:SYNTHETIC_TAIL ordinary", "A".repeat(100_000));
        assert_eq!(project(&raw), format!("tool {CREDENTIAL_MASK} ordinary"));
    }
    for label in ["PRIVATE KEY", "RSA PRIVATE KEY", "EC PRIVATE KEY", "ENCRYPTED PRIVATE KEY", "OPENSSH PRIVATE KEY"] {
        let raw = format!("tool --data=-----BEGIN {label}-----\n{}\n-----END {label}----- tail", "A".repeat(100_000));
        assert_eq!(project(&raw), format!("tool --data={PRIVATE_KEY_MASK} tail"));
    }
}

#[test]
fn ambiguous_recognized_boundaries_refuse_but_unknown_syntax_stays_visible() {
    for raw in ["tool --token", "tool --token --other", "tool --token='unterminated",
        "curl -H \"Authorization: Bearer missing-close", "curl -H 'Cookie:'", "curl -H Authorization",
        "curl -H Authorization:Bearer SECRET", "curl -H 'Authorization: Basic'",
        "curl -H 'Authorization Bearer SECRET'", "curl -H 'X-Api-Key=SECRET'", "curl -H 'Cookie session=SECRET'",
        "tool --token=abc;second-command", "tool --token=abc&second-command", "tool --token\nnext-command",
        "tool sk-SYNTHETIC12345;second-command", "curl https://host.test/?token=abc;second-command",
        "tool 'sk-SYNTHETIC12345';second-command", "curl 'https://host.test/?token='SECRET;second-command",
        "curl 'https://host.test/?token=secret unfinished value'",
        "curl 'https://host.test/?x='value'&data=-----BEGIN PRIVATE KEY-----body-----END PRIVATE KEY-----'",
        "tool -----BEGIN PRIVATE KEY-----unterminated", "tool -----BEGIN RSA PRIVATE KEY-----x-----END EC PRIVATE KEY-----"] {
        assert_eq!(project_exec_command(raw), Err(CommandDisclosureError::AmbiguousCredentialBoundary));
    }
    assert_eq!(project("tool --unknown='unterminated"), "tool --unknown='unterminated");
}

#[test]
fn escape_table_is_unambiguous_and_keeps_printable_unicode_unchanged() {
    assert_eq!(project("a\\n\nb\r\tc\u{1b}"), r"a\\n\nb\r\tc\u{001B}");
    let codes = (0..=31).chain(127..=159).chain([
        0x061C, 0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E,
        0x2066, 0x2067, 0x2068, 0x2069, 0x2028, 0x2029, 0x00AD, 0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF,
    ]);
    for code in codes {
        let c = char::from_u32(code).unwrap();
        let expected = match c { '\n' => "\\n".into(), '\r' => "\\r".into(), '\t' => "\\t".into(), _ => format!("\\u{{{code:04X}}}") };
        assert_eq!(project(&format!("a{c}b")), format!("a{expected}b"));
    }
    assert_eq!(project("中文😀e\u{301}é"), "中文😀e\u{301}é");
}

#[test]
fn unicode_chunks_respect_both_limits_and_reconstruct_every_tail() {
    for (raw, count) in [
        ("a".repeat(499), 1), ("a".repeat(500), 1), ("a".repeat(501), 2),
        ("中".repeat(166), 1), ("中".repeat(167), 2), ("😀".repeat(125), 1), ("😀".repeat(126), 2),
        ("😀".repeat(250), 2), ("e\u{301}".repeat(500), 4),
    ] {
        let value = project_exec_command(&raw).unwrap();
        let fields: Vec<_> = value.sections.iter().flat_map(|s| &s.fields).collect();
        assert_eq!(fields.len(), count);
        assert_eq!(joined(&value), raw);
        assert!(fields.iter().all(|f| f.value.len() <= 500 && f.value.encode_utf16().count() <= 500));
    }
    let raw = format!("{} --token={} tail", "a".repeat(480), "S".repeat(40_000));
    assert_eq!(project(&raw), format!("{} --token={CREDENTIAL_MASK} tail", "a".repeat(480)));
}

#[test]
fn full_capacity_and_post_escape_overflow_never_return_partial_disclosure() {
    let raw = "a".repeat(48_000);
    let value = project_exec_command(&raw).unwrap();
    assert_eq!(value.sections.len(), 8);
    assert!(value.sections.iter().all(|s| s.fields.len() == 12));
    assert_eq!(joined(&value), raw);
    assert_eq!(project_exec_command(&format!("{raw}b")), Err(CommandDisclosureError::PresentationTooLarge));
    assert_eq!(project_exec_command(&"\\".repeat(24_001)), Err(CommandDisclosureError::PresentationTooLarge));
    assert_eq!(project_exec_command(" \t\n"), Err(CommandDisclosureError::EmptyCommand));
}
