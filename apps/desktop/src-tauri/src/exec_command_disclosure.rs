//! INPUT:  the exact sealed exec command, borrowed without argv reconstruction or normalization
//! OUTPUT: complete credential-masked, visibly escaped Approval presentation or a finite refusal
//! POS:    shell — pure bounded display adapter; never executes, resolves paths, reads files, or owns authority

mod patterns;
mod scanner;
#[cfg(test)]
mod tests;

use crate::protocol::{
    validate_presentation, HostChallengePresentation, HostChallengePresentationField,
    HostChallengePresentationSection, HostCommandDisclosure,
};

const CHUNK_LIMIT: usize = 500;
const CHUNK_COUNT: usize = 8 * 12;
const CREDENTIAL_MASK: &str = "[凭证已隐藏]";
const PRIVATE_KEY_MASK: &str = "[私钥已隐藏]";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CommandDisclosureError {
    EmptyCommand,
    AmbiguousCredentialBoundary,
    PresentationTooLarge,
    InvalidPresentation,
}

pub(crate) fn project_exec_command(raw: &str) -> Result<HostChallengePresentation, CommandDisclosureError> {
    if raw.trim().is_empty() { return Err(CommandDisclosureError::EmptyCommand); }
    let mut output = Projection::default();
    scanner::scan(raw, &mut output)?;
    let chunks = output.finish();
    let presentation = HostChallengePresentation {
        revision: 1,
        title: "允许执行此命令？".into(),
        capability_label: "执行命令".into(),
        subject_label: None,
        risk_summary: "请检查完整命令。已隐藏识别到的凭证；控制字符和反斜杠以转义显示，不可直接复制执行。".into(),
        sections: chunks.chunks(12).map(|group| HostChallengePresentationSection {
            title: "完整命令".into(),
            fields: group.iter().map(|value| HostChallengePresentationField {
                label: "命令".into(), value: value.clone(),
            }).collect(),
        }).collect(),
        command_disclosure: Some(HostCommandDisclosure {
            revision: 1, complete: true, encoding: "visible-escapes".into(),
            reconstruction: "section-field-concat".into(),
        }),
    };
    validate_presentation(&presentation).map_err(|_| CommandDisclosureError::InvalidPresentation)?;
    Ok(presentation)
}

/// Every write is an indivisible scalar, visible escape, or fixed mask. At most 96 chunks exist;
/// failure discards the partial projection, so callers can never label a truncated tail complete.
#[derive(Default)]
struct Projection {
    chunks: Vec<String>,
    current: String,
    utf16: usize,
    masks: usize,
}

impl Projection {
    fn atom(&mut self, atom: &str) -> Result<(), CommandDisclosureError> {
        let units = atom.encode_utf16().count();
        if self.current.len() + atom.len() > CHUNK_LIMIT || self.utf16 + units > CHUNK_LIMIT {
            if self.chunks.len() + 1 >= CHUNK_COUNT {
                return Err(CommandDisclosureError::PresentationTooLarge);
            }
            self.chunks.push(std::mem::take(&mut self.current));
            self.utf16 = 0;
        }
        self.current.push_str(atom);
        if matches!(atom, CREDENTIAL_MASK | PRIVATE_KEY_MASK) { self.masks += 1; }
        self.utf16 += units;
        Ok(())
    }

    fn literal(&mut self, text: &str) -> Result<(), CommandDisclosureError> {
        for scalar in text.chars() {
            match scalar {
                '\\' => self.atom("\\\\")?,
                '\n' => self.atom("\\n")?,
                '\r' => self.atom("\\r")?,
                '\t' => self.atom("\\t")?,
                c if needs_escape(c) => self.atom(&format!("\\u{{{:04X}}}", c as u32))?,
                c => self.atom(c.encode_utf8(&mut [0; 4]))?,
            }
        }
        Ok(())
    }

    /// Mask one complete source value while retaining only syntactic quote delimiters. The quote
    /// state comes from the source cursor, so adjacent fragments never leave an unmasked suffix.
    fn credential(&mut self, text: &str, quote: &mut Option<char>) -> Result<(), CommandDisclosureError> {
        let mut emitted = false;
        for c in text.chars() {
            if quote.is_none() && matches!(c, ';' | '&' | '|' | '<' | '>') {
                return Err(CommandDisclosureError::AmbiguousCredentialBoundary);
            }
            let syntax = *quote == Some(c) || (quote.is_none() && matches!(c, '\'' | '"'));
            if syntax {
                if quote.is_some() && !emitted { self.atom(CREDENTIAL_MASK)?; emitted = true; }
                advance_quote(quote, c);
                self.literal(c.encode_utf8(&mut [0; 4]))?;
            } else if !emitted { self.atom(CREDENTIAL_MASK)?; emitted = true; }
        }
        if !emitted { self.atom(CREDENTIAL_MASK)?; }
        Ok(())
    }

    fn finish(mut self) -> Vec<String> {
        if !self.current.is_empty() { self.chunks.push(self.current); }
        self.chunks
    }
}

fn advance_quote(quote: &mut Option<char>, c: char) {
    if *quote == Some(c) { *quote = None; }
    else if quote.is_none() && matches!(c, '\'' | '"') { *quote = Some(c); }
}

fn needs_escape(c: char) -> bool {
    matches!(c, '\u{0000}'..='\u{001F}' | '\u{007F}'..='\u{009F}'
        | '\u{061C}' | '\u{200E}' | '\u{200F}' | '\u{202A}'..='\u{202E}'
        | '\u{2066}'..='\u{2069}' | '\u{2028}' | '\u{2029}'
        | '\u{00AD}' | '\u{200B}'..='\u{200D}' | '\u{2060}' | '\u{FEFF}')
}
