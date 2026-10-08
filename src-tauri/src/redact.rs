// Masks secrets in text that leaves the approval card: the history file and
// Windows notifications. The card itself always shows the request exactly as it
// will run — a person approving a command must see all of it — but nothing that
// lingers on disk or in the notification centre should carry a live token.

use std::sync::LazyLock;

use regex::{Captures, Regex};

const MASK: &str = "•••";

struct Pattern {
    re: Regex,
    /// Capture group that holds the secret; everything else is kept for context.
    group: usize,
}

fn p(pattern: &str, group: usize) -> Pattern {
    Pattern { re: Regex::new(pattern).expect("bad redaction pattern"), group }
}

static PATTERNS: LazyLock<Vec<Pattern>> = LazyLock::new(|| {
    vec![
        // PEM private keys, whole block.
        p(r"(?s)(-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(?:-----END [A-Z ]*PRIVATE KEY-----|$))", 1),
        // Vendor tokens with a recognisable prefix.
        p(r"\b((?:sk-ant-|sk-proj-|sk-)[A-Za-z0-9_-]{16,})", 1),
        p(r"\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})", 1),
        p(r"\b(glpat-[A-Za-z0-9_-]{16,})", 1),
        p(r"\b(xox[abposr]-[A-Za-z0-9-]{10,})", 1),
        p(r"\b((?:AKIA|ASIA)[0-9A-Z]{16})\b", 1),
        p(r"\b(AIza[0-9A-Za-z_-]{30,})", 1),
        p(r"\b((?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{16,})", 1),
        p(r"\b(npm_[A-Za-z0-9]{30,})", 1),
        // JSON Web Tokens.
        p(r"\b(eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})", 1),
        // Authorization headers: keep the scheme, hide the credential.
        p(
            r#"(?i)\b(?:authorization|proxy-authorization)\s*[:=]\s*["']?(?:bearer|basic|token|bot)?\s*([^\s"',;]{6,})"#,
            1,
        ),
        p(r#"(?i)\bbearer\s+([A-Za-z0-9._~+/=-]{12,})"#, 1),
        // key=value / key: value / --key value for secret-looking names.
        p(
            r#"(?i)(?:^|[\s?&;,{("'-])(?:[a-z0-9_-]*?)(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|private[_-]?key)["']?\s*(?:=|:|\s)\s*["']?([^\s"'&;,)}]{4,})"#,
            1,
        ),
        // Credentials in URLs: scheme://user:password@host
        p(r"(?i)\b[a-z][a-z0-9+.-]*://[^\s/:@]+:([^\s/@]{3,})@", 1),
    ]
});

/// `text` with every recognised secret replaced by •••.
pub fn redact(text: &str) -> String {
    let mut out = text.to_string();
    for pat in PATTERNS.iter() {
        if !pat.re.is_match(&out) {
            continue;
        }
        out = pat
            .re
            .replace_all(&out, |c: &Captures| {
                let whole = c.get(0).unwrap();
                let Some(secret) = c.get(pat.group) else { return whole.as_str().to_string() };
                let (start, end) = (secret.start() - whole.start(), secret.end() - whole.start());
                format!("{}{MASK}{}", &whole.as_str()[..start], &whole.as_str()[end..])
            })
            .into_owned();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vendor_tokens() {
        let r = redact("export ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123");
        assert!(!r.contains("abcdefghijklmnop"), "{r}");
        assert!(r.contains("ANTHROPIC_API_KEY="));
        assert_eq!(
            redact("git push https://ghp_0123456789abcdefghijABCDEFGHIJ@github.com/a/b"),
            "git push https://•••@github.com/a/b"
        );
        assert!(!redact("aws s3 ls --key AKIAIOSFODNN7EXAMPLE").contains("IOSFODNN7"));
    }

    #[test]
    fn headers_and_flags() {
        let r = redact(r#"curl -H "Authorization: Bearer abc.def.ghi-123456789" https://api.x.test"#);
        assert!(!r.contains("abc.def.ghi"), "{r}");
        assert!(r.contains("https://api.x.test"));
        let r = redact("mysql -u root --password hunter2hunter2 db");
        assert!(!r.contains("hunter2"), "{r}");
        let r = redact("login?user=ada&token=9f8e7d6c5b4a&next=/");
        assert!(!r.contains("9f8e7d6c5b4a"), "{r}");
        assert!(r.contains("next=/"));
    }

    #[test]
    fn url_credentials_and_keys() {
        assert_eq!(redact("postgres://app:s3cretpass@db:5432/x"), "postgres://app:•••@db:5432/x");
        let pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----";
        assert_eq!(redact(pem), "•••");
    }

    #[test]
    fn ordinary_commands_are_untouched() {
        for c in ["npm test", "git push origin main", "cargo build --release", "echo $PATH", "ls -la ~/.ssh"] {
            assert_eq!(redact(c), c);
        }
    }
}
