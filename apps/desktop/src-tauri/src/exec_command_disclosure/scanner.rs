//! INPUT:  borrowed raw command spans plus the bounded projection writer
//! OUTPUT: credential-context masking with preserved source order and ordinary path purpose
//! POS:    shell/disclosure — finite quote/context scanner; its tokens are offsets, never executable argv

use super::{advance_quote, patterns, CommandDisclosureError as Error, Projection};

#[derive(Clone, Copy)]
enum NextValue { Credential, Header, Path }

#[derive(Clone, Copy)]
struct Token<'a> {
    raw: &'a str,
    start: usize,
    end: usize,
    balanced: bool,
}

impl<'a> Token<'a> {
    fn at(raw: &'a str, start: usize) -> Self {
        let mut quote = None;
        let mut end = raw.len();
        for (offset, c) in raw[start..].char_indices() {
            if quote.is_none() && matches!(c, ' ' | '\t' | '\r' | '\n') {
                end = start + offset;
                break;
            }
            advance_quote(&mut quote, c);
        }
        Self { raw, start, end, balanced: quote.is_none() }
    }

    fn text(self) -> &'a str { &self.raw[self.start..self.end] }

    fn content_start(self) -> usize {
        self.start + usize::from(self.text().starts_with(['\'', '"']))
    }

    fn content(self) -> &'a str {
        let text = self.text();
        if text.len() >= 2 && text.starts_with(['\'', '"']) && text.as_bytes().first() == text.as_bytes().last() {
            &text[1..text.len() - 1]
        } else { text }
    }

    fn quote_at(self, offset: usize) -> Option<char> {
        let mut quote = None;
        for c in self.raw[self.start..offset].chars() { advance_quote(&mut quote, c); }
        quote
    }
}

pub(super) fn scan(raw: &str, output: &mut Projection) -> Result<(), Error> {
    let mut cursor = 0;
    let mut next = None;
    let mut program = true;
    let mut curl = false;
    while cursor < raw.len() {
        let c = raw[cursor..].chars().next().ok_or(Error::InvalidPresentation)?;
        if matches!(c, ' ' | '\t' | '\r' | '\n') {
            if matches!(c, '\r' | '\n') && matches!(next, Some(NextValue::Credential | NextValue::Header)) {
                return Err(Error::AmbiguousCredentialBoundary);
            }
            output.literal(&raw[cursor..cursor + c.len_utf8()])?;
            if matches!(c, '\r' | '\n') { program = true; curl = false; }
            cursor += c.len_utf8();
            continue;
        }
        let token = Token::at(raw, cursor);
        let masks_before = output.masks;
        let consumed = match next.take() {
            Some(NextValue::Credential) => {
                if token.content().starts_with('-') { return Err(Error::AmbiguousCredentialBoundary); }
                mask(token, token.start, output)?; token.end
            }
            Some(NextValue::Header) => header_value(token, token.start, output)?,
            Some(NextValue::Path) => { output.literal(token.text())?; token.end }
            None => project_token(token, curl, &mut next, output)?,
        };
        if output.masks != masks_before && (!token.balanced || ambiguous_control(token)) {
            return Err(Error::AmbiguousCredentialBoundary);
        }
        update_program(token, &mut program, &mut curl);
        cursor = consumed;
    }
    if matches!(next, Some(NextValue::Credential | NextValue::Header)) { return Err(Error::AmbiguousCredentialBoundary); }
    Ok(())
}

fn ambiguous_control(token: Token<'_>) -> bool {
    let mut quote = None;
    let uri = token.text().contains("://");
    for c in token.text().chars() {
        if quote.is_none() && (matches!(c, ';' | '|' | '<' | '>')
            || (c == '&' && !uri)) { return true; }
        advance_quote(&mut quote, c);
    }
    false
}

fn update_program(token: Token<'_>, program: &mut bool, curl: &mut bool) {
    let mut quote = None;
    let mut last_separator = None;
    // URI query separators are retained as URI structure, not interpreted as a second program.
    if !token.text().contains("://") {
        for (offset, c) in token.text().char_indices() {
            if quote.is_none() && matches!(c, ';' | '|' | '&') { last_separator = Some(offset + c.len_utf8()); }
            advance_quote(&mut quote, c);
        }
    }
    let name = last_separator.map_or(token.content(), |offset| &token.text()[offset..]);
    if last_separator.is_some() { *program = true; *curl = false; }
    if *program && !name.is_empty() && !name.contains('=') && !matches!(name, "env" | "set")
        && !name.get(..5).is_some_and(|p| p.eq_ignore_ascii_case("$env:")) {
        let basename = name.trim_matches(['\'', '"']).rsplit(['/', '\\']).next().unwrap_or("");
        *curl = basename.eq_ignore_ascii_case("curl") || basename.eq_ignore_ascii_case("curl.exe");
        *program = false;
    }
}

fn project_token(token: Token<'_>, curl: bool, next: &mut Option<NextValue>, out: &mut Projection) -> Result<usize, Error> {
    if let Some(end) = spaced_env_assignment(token, out)? { return Ok(end); }
    let start = token.content_start();
    let content = &token.raw[start..token.end];
    if let Some(equal) = content.find('=') {
        let name = &content[..equal];
        let option = name.starts_with("--");
        if patterns::credential_name(name, !option) || (curl && matches!(name, "--user" | "--proxy-user")) {
            let value = start + equal + 1;
            out.literal(&token.raw[token.start..value])?;
            mask(token, value, out)?;
            return Ok(token.end);
        }
        if path_purpose(name) {
            out.literal(token.text())?;
            return Ok(token.end);
        }
        if curl && matches!(name, "--header" | "--proxy-header") {
            out.literal(&token.raw[token.start..start + equal + 1])?;
            return header_value(token, start + equal + 1, out);
        }
    }
    let bare = token.content();
    if !bare.contains(['/', '\\']) && patterns::vendor_or_jwt(bare) {
        mask(token, token.start, out)?;
        return Ok(token.end);
    }
    *next = if (bare.starts_with("--") && patterns::credential_name(bare, false))
        || (curl && matches!(bare, "-u" | "-U" | "--user" | "--proxy-user")) {
        Some(NextValue::Credential)
    } else if curl && matches!(bare, "-H" | "--header" | "--proxy-header") {
        Some(NextValue::Header)
    } else if matches!(bare, "--file" | "--config" | "--output") { Some(NextValue::Path) }
    else { None };
    if next.is_some() { out.literal(token.text())?; return Ok(token.end); }
    if curl && (bare.starts_with("-u") || bare.starts_with("-U")) && bare.len() > 2 {
        out.literal(&token.raw[token.start..start + 2])?;
        mask(token, start + 2, out)?;
        return Ok(token.end);
    }
    if curl && bare.starts_with("-H") && bare.len() > 2 {
        out.literal(&token.raw[token.start..start + 2])?;
        return header_value(token, start + 2, out);
    }
    if let Some(end) = header(token, out)? { return Ok(end); }
    patterns::emit(token.raw, token.start, token.end, None, out)
}

fn spaced_env_assignment(token: Token<'_>, out: &mut Projection) -> Result<Option<usize>, Error> {
    let name = token.content();
    if !name.get(..5).is_some_and(|p| p.eq_ignore_ascii_case("$env:")) || !patterns::credential_name(name, true) {
        return Ok(None);
    }
    let mut cursor = token.end;
    while matches!(token.raw.as_bytes().get(cursor), Some(b' ' | b'\t')) { cursor += 1; }
    if token.raw.as_bytes().get(cursor) != Some(&b'=') { return Ok(None); }
    cursor += 1;
    while matches!(token.raw.as_bytes().get(cursor), Some(b' ' | b'\t')) { cursor += 1; }
    if cursor == token.raw.len() { return Err(Error::AmbiguousCredentialBoundary); }
    let value = Token::at(token.raw, cursor);
    out.literal(&token.raw[token.start..cursor])?;
    mask(value, cursor, out)?;
    Ok(Some(value.end))
}

fn path_purpose(name: &str) -> bool {
    matches!(name, "--file" | "--config" | "--output") || patterns::path_suffix(name)
}

fn header(token: Token<'_>, out: &mut Projection) -> Result<Option<usize>, Error> {
    let start = token.content_start();
    let Some(colon) = token.raw[start..token.end].find(':') else { return Ok(None); };
    if !patterns::header_name(&token.raw[start..start + colon]) { return Ok(None); }
    out.literal(&token.raw[token.start..start])?;
    header_value(token, start, out).map(Some)
}

fn header_value(token: Token<'_>, start: usize, out: &mut Projection) -> Result<usize, Error> {
    let start = if token.raw[start..token.end].starts_with(['\'', '"']) {
        out.literal(&token.raw[start..start + 1])?;
        start + 1
    } else { start };
    let content = &token.raw[start..token.end];
    let Some(colon) = content.find(':') else {
        if patterns::recognized_header_prefix(content) { return Err(Error::AmbiguousCredentialBoundary); }
        return patterns::emit(token.raw, start, token.end, token.quote_at(start), out);
    };
    let name = &content[..colon];
    if !patterns::header_name(name) {
        if patterns::recognized_header_prefix(content) { return Err(Error::AmbiguousCredentialBoundary); }
        return patterns::emit(token.raw, start, token.end, token.quote_at(start), out);
    }
    if !token.balanced { return Err(Error::AmbiguousCredentialBoundary); }
    let mut value = start + colon + 1;
    while value < token.end && matches!(token.raw.as_bytes()[value], b' ' | b'\t') { value += 1; }
    if name.eq_ignore_ascii_case("authorization") || name.eq_ignore_ascii_case("proxy-authorization") {
        let payload = token.raw[value..token.end].trim_matches(['\'', '"', ' ', '\t']);
        if payload.eq_ignore_ascii_case("Bearer") || payload.eq_ignore_ascii_case("Basic") {
            return Err(Error::AmbiguousCredentialBoundary);
        }
        for scheme in ["Bearer ", "Basic "] {
            if token.raw[value..token.end].get(..scheme.len()).is_some_and(|p| p.eq_ignore_ascii_case(scheme)) {
                value += scheme.len();
                break;
            }
        }
    }
    if token.raw[value..token.end].trim_matches(['\'', '"', ' ', '\t']).is_empty() {
        return Err(Error::AmbiguousCredentialBoundary);
    }
    out.literal(&token.raw[start..value])?;
    mask(token, value, out)?;
    Ok(token.end)
}

/// Quotes are syntax under the current executor; backslashes are literal. Preserve only those
/// delimiters while replacing every content fragment, including suffixes outside a quoted fragment.
fn mask(token: Token<'_>, start: usize, out: &mut Projection) -> Result<(), Error> {
    if !token.balanced { return Err(Error::AmbiguousCredentialBoundary); }
    let mut quote = token.quote_at(start);
    out.credential(&token.raw[start..token.end], &mut quote)
}
