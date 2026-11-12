//! INPUT:  source spans with explicit credential/header/path context already classified
//! OUTPUT: finite key recognition plus whole URL, vendor-token/JWT and private-key masking
//! POS:    shell/disclosure — linear borrowed-span recognizers; no regex backtracking or value-derived masks

use super::{advance_quote, CommandDisclosureError as Error, Projection, PRIVATE_KEY_MASK};

const NAMES: &[&str] = &[
    "password", "passwd", "pwd", "token", "accesstoken", "refreshtoken", "idtoken",
    "apikey", "secret", "clientsecret", "secretkey", "secretaccesskey", "authorization",
    "proxyauthorization", "cookie", "setcookie",
];
const SUFFIXES: &[&str] = &[
    "PASSWORD", "PASSWD", "TOKEN", "SECRET", "API_KEY", "ACCESS_TOKEN", "REFRESH_TOKEN",
    "CLIENT_SECRET", "SECRET_KEY", "SECRET_ACCESS_KEY",
];

pub(super) fn credential_name(raw: &str, environment: bool) -> bool {
    let name = raw.strip_prefix("--").unwrap_or(raw);
    let name = if name.get(..5).is_some_and(|p| p.eq_ignore_ascii_case("$env:")) { &name[5..] } else { name };
    if path_suffix(name) { return false; }
    NAMES.iter().any(|expected| folded_eq(name, expected))
        || (environment && SUFFIXES.iter().any(|suffix| suffix_eq(name, suffix)))
}

fn folded_eq(raw: &str, expected: &str) -> bool {
    raw.bytes().filter(|b| !matches!(b, b'-' | b'_')).map(|b| b.to_ascii_lowercase()).eq(expected.bytes())
}

fn suffix_eq(raw: &str, suffix: &str) -> bool {
    if raw.len() < suffix.len() { return false; }
    let offset = raw.len() - suffix.len();
    let Some(tail) = raw.get(offset..) else { return false; };
    (offset == 0 || matches!(raw.as_bytes()[offset - 1], b'_' | b'-'))
        && tail.bytes().zip(suffix.bytes()).all(|(a, b)| a.eq_ignore_ascii_case(&b)
            || (matches!(a, b'_' | b'-') && b == b'_'))
}

pub(super) fn path_suffix(name: &str) -> bool {
    name.rsplit(['_', '-']).next().is_some_and(|tail| tail.eq_ignore_ascii_case("FILE") || tail.eq_ignore_ascii_case("PATH"))
}

const HEADER_NAMES: &[&str] = &["Authorization", "Proxy-Authorization", "X-Api-Key", "Cookie", "Set-Cookie"];

pub(super) fn header_name(name: &str) -> bool {
    HEADER_NAMES.iter().any(|expected| name.eq_ignore_ascii_case(expected))
}

pub(super) fn recognized_header_prefix(text: &str) -> bool {
    HEADER_NAMES.iter().any(|name| text.get(..name.len()).is_some_and(|prefix| prefix.eq_ignore_ascii_case(name))
        && text.as_bytes().get(name.len()).is_none_or(|next| next.is_ascii_whitespace()
            || matches!(next, b':' | b'=' | b'\'' | b'"')))
}

/// A constant-size label probe precedes a single search for the matching END. Failure returns
/// immediately rather than searching again at every unterminated BEGIN in the remainder.
fn private_key_end(raw: &str, start: usize) -> Result<Option<usize>, Error> {
    let rest = &raw[start..];
    let Some(label_and_body) = rest.strip_prefix("-----BEGIN ") else { return Ok(None); };
    let probe = &label_and_body.as_bytes()[..label_and_body.len().min(48)];
    let Some(label_end) = probe.windows(5).position(|p| p == b"-----") else { return Ok(None); };
    let label = &label_and_body[..label_end];
    if !label.ends_with("PRIVATE KEY") || label.len() > 30
        || !label.bytes().all(|b| b.is_ascii_uppercase() || b == b' ') {
        return Ok(None);
    }
    let body_start = start + "-----BEGIN ".len() + label_end + 5;
    let end_marker = format!("-----END {label}-----");
    let Some(end) = raw[body_start..].find(&end_marker) else { return Err(Error::AmbiguousCredentialBoundary); };
    Ok(Some(body_start + end + end_marker.len()))
}

/// One advancing source cursor owns quote state across URI components and recognition fragments.
/// Re-reading the token prefix per query value would become quadratic for long masked credentials.
struct SourceWriter<'a, 'b> {
    raw: &'a str,
    cursor: usize,
    quote: Option<char>,
    out: &'b mut Projection,
}

impl SourceWriter<'_, '_> {
    fn literal_to(&mut self, end: usize) -> Result<(), Error> {
        let text = self.raw.get(self.cursor..end).ok_or(Error::AmbiguousCredentialBoundary)?;
        self.out.literal(text)?;
        for c in text.chars() { advance_quote(&mut self.quote, c); }
        self.cursor = end;
        Ok(())
    }

    fn credential_to(&mut self, end: usize) -> Result<(), Error> {
        let text = self.raw.get(self.cursor..end).ok_or(Error::AmbiguousCredentialBoundary)?;
        self.out.credential(text, &mut self.quote)?;
        self.cursor = end;
        Ok(())
    }

    fn private_key_to(&mut self, end: usize) -> Result<(), Error> {
        let text = self.raw.get(self.cursor..end).ok_or(Error::AmbiguousCredentialBoundary)?;
        self.out.atom(PRIVATE_KEY_MASK)?;
        for c in text.chars() { advance_quote(&mut self.quote, c); }
        self.cursor = end;
        Ok(())
    }
}

pub(super) fn emit(raw: &str, start: usize, end: usize, quote: Option<char>, out: &mut Projection) -> Result<usize, Error> {
    let mut source = SourceWriter { raw, cursor: start, quote, out };
    while source.cursor < end {
        if let Some(finish) = private_key_end(raw, source.cursor)? {
            source.private_key_to(finish)?;
            continue;
        }
        let c = raw[source.cursor..].chars().next().ok_or(Error::InvalidPresentation)?;
        if separator(c) {
            source.literal_to(source.cursor + c.len_utf8())?;
            continue;
        }
        let word_end = raw[source.cursor..end].char_indices().find(|(_, c)| separator(*c))
            .map_or(end, |(offset, _)| source.cursor + offset);
        emit_word(&mut source, word_end, end)?;
    }
    Ok(source.cursor)
}

fn separator(c: char) -> bool {
    // These boundaries only limit recognition probes. A selected credential still consumes its
    // whole value, including adjacent quote fragments; quoted URI punctuation stays in that value.
    matches!(c, ' ' | '\t' | '\r' | '\n' | '\'' | '"')
}

fn emit_word(source: &mut SourceWriter<'_, '_>, end: usize, token_end: usize) -> Result<(), Error> {
    let start = source.cursor;
    let word = &source.raw[start..end];
    for (offset, _) in word.match_indices("-----BEGIN") {
        if let Some(finish) = private_key_end(source.raw, start + offset)? {
            source.literal_to(start + offset)?;
            return source.private_key_to(finish);
        }
    }
    if let Some(scheme_end) = word.find("://") {
        let scheme_start = word[..scheme_end].char_indices().rev()
            .find(|(_, c)| !c.is_ascii_alphanumeric() && !matches!(c, '+' | '-' | '.'))
            .map_or(0, |(offset, c)| offset + c.len_utf8());
        let scheme = &word[scheme_start..scheme_end];
        if scheme.as_bytes().first().is_some_and(u8::is_ascii_alphabetic) {
            source.literal_to(start + scheme_start)?;
            // Source quote delimiters do not end an argv value. Include adjacent fragments, while
            // refusing an unencoded whitespace boundary when a recognized URI value is incomplete.
            let uri_end = source.raw[source.cursor..token_end].find([' ', '\t', '\r', '\n'])
                .map_or(token_end, |offset| source.cursor + offset);
            let masks = source.out.masks;
            emit_url(source, start + scheme_end + 3, uri_end)?;
            if source.out.masks != masks && uri_end != token_end { return Err(Error::AmbiguousCredentialBoundary); }
            return Ok(());
        }
    }
    // Ordinary paths and path components are not credentials. Explicit option/assignment/header
    // contexts were handled before this fallback and deliberately override this exclusion.
    if word.contains(['/', '\\']) { return source.literal_to(end); }
    emit_token(source, end, token_end)
}

fn emit_token(source: &mut SourceWriter<'_, '_>, end: usize, value_end: usize) -> Result<(), Error> {
    let start = source.cursor;
    let mut cursor = start;
    while cursor < end {
        if let Some(finish) = private_key_end(source.raw, cursor)? {
            source.literal_to(cursor)?;
            source.private_key_to(finish)?;
            cursor = finish;
            continue;
        }
        let boundary = cursor == start || !source.raw.as_bytes()[cursor - 1].is_ascii_alphanumeric()
            && !matches!(source.raw.as_bytes()[cursor - 1], b'_' | b'-');
        if boundary && vendor_or_jwt(&source.raw[cursor..end]) {
            source.literal_to(cursor)?;
            return source.credential_to(value_end);
        }
        cursor += source.raw[cursor..].chars().next().ok_or(Error::InvalidPresentation)?.len_utf8();
    }
    if source.cursor < end { source.literal_to(end)?; }
    Ok(())
}

pub(super) fn vendor_or_jwt(value: &str) -> bool {
    // Minimum discriminator lengths prevent ordinary prose from matching; once recognized, the
    // *entire* remaining value is hidden, including padding/punctuation and arbitrarily long tails.
    const PREFIXES: &[(&str, usize, &str)] = &[
        ("sk-", 10, "_-"), ("sk_live_", 10, ""), ("sk_test_", 10, ""), ("rk_live_", 10, ""),
        ("ghp_", 10, ""), ("gho_", 10, ""), ("ghu_", 10, ""), ("ghs_", 10, ""), ("ghr_", 10, ""),
        ("github_pat_", 10, "_"), ("xoxb-", 10, "-"), ("xoxa-", 10, "-"), ("xoxp-", 10, "-"), ("xoxr-", 10, "-"), ("xoxs-", 10, "-"),
        ("AIza", 30, "_-"), ("SG.", 10, "_-"), ("hf_", 10, ""), ("r8_", 10, ""), ("npm_", 10, ""),
        ("pypi-", 10, "_-"), ("dop_v1_", 10, ""), ("xai-", 20, ""), ("gsk_", 10, ""), ("ntn_", 10, ""), ("tvly-", 10, ""), ("sk_", 10, "_"), ("eyJ", 10, "_-"),
    ];
    if PREFIXES.iter().any(|(prefix, min, punctuation)| value.strip_prefix(prefix).and_then(|tail| tail.as_bytes().get(..*min))
        .is_some_and(|head| head.iter().all(|b| b.is_ascii_alphanumeric() || punctuation.as_bytes().contains(b)))) { return true; }
    if value.strip_prefix("AKIA").and_then(|tail| tail.as_bytes().get(..16))
        .is_some_and(|head| head.iter().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())) { return true; }
    let Some(tail) = value.strip_prefix("xapp-") else { return false; };
    let version = tail.bytes().take(3).take_while(u8::is_ascii_digit).count();
    version > 0 && tail.as_bytes().get(version) == Some(&b'-')
        && tail.as_bytes().get(version + 1..version + 11)
            .is_some_and(|head| head.iter().all(|b| b.is_ascii_alphanumeric() || *b == b'-'))
}

fn emit_url(source: &mut SourceWriter<'_, '_>, authority_start: usize, end: usize) -> Result<(), Error> {
    let authority_end = source.raw[authority_start..end].find(['/', '?', '#']).map_or(end, |n| authority_start + n);
    source.literal_to(authority_start)?;
    if let Some(at) = source.raw[authority_start..authority_end].rfind('@') {
        source.credential_to(authority_start + at)?;
    }
    source.literal_to(authority_end)?;
    let tail = &source.raw[authority_end..end];
    let query = tail.find('?').filter(|q| tail.find('#').is_none_or(|hash| *q < hash));
    let Some(query) = query else { return source.literal_to(end); };
    source.literal_to(authority_end + query + 1)?;
    let query_end = source.raw[source.cursor..end].find('#').map_or(end, |n| source.cursor + n);
    while source.cursor < query_end {
        let parameter_end = source.raw[source.cursor..query_end].find('&').map_or(query_end, |n| source.cursor + n);
        emit_query_parameter(source, parameter_end)?;
        if source.cursor < query_end { source.literal_to(source.cursor + 1)?; }
    }
    source.literal_to(end)
}

fn emit_query_parameter(source: &mut SourceWriter<'_, '_>, end: usize) -> Result<(), Error> {
    let Some((key, value)) = source.raw[source.cursor..end].split_once('=') else { return source.literal_to(end); };
    let credential = query_credential(key);
    let path = path_suffix(key) || value.contains(['/', '\\']);
    source.literal_to(source.cursor + key.len() + 1)?;
    if credential { source.credential_to(end) }
    else if path { source.literal_to(end) }
    else { emit_token(source, end, end) }
}

fn query_credential(key: &str) -> bool {
    // Only ASCII key decoding is needed. A fixed buffer covers every finite recognized key;
    // unknown/long keys remain unchanged rather than allocating or normalizing a URL.
    let mut decoded = [0_u8; 64];
    let mut length = 0;
    let mut cursor = 0;
    while cursor < key.len() && length < decoded.len() {
        let byte = key.as_bytes()[cursor];
        if byte == b'%' {
            let Some(pair) = key.as_bytes().get(cursor + 1..cursor + 3) else { return false; };
            let Some(high) = (pair[0] as char).to_digit(16) else { return false; };
            let Some(low) = (pair[1] as char).to_digit(16) else { return false; };
            decoded[length] = (high * 16 + low) as u8;
            cursor += 3;
        } else { decoded[length] = byte; cursor += 1; }
        length += 1;
    }
    cursor == key.len() && std::str::from_utf8(&decoded[..length]).is_ok_and(|name| credential_name(name, false))
}
