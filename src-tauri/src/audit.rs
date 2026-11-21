// History of every permission decision, as JSON lines in audit.jsonl (rolling
// over to audit.1.jsonl) in the app's data folder: %LOCALAPPDATA%\Nobetci,
// ~/Library/Application Support/Nobetci, ~/.local/share/nobetci.
//
// One line per request: what was asked, how risky it looked, what happened and
// who decided — a person, a rule, a trusted project, a session grant, or nobody
// (timed out / handed to the terminal). Nothing leaves the machine. On Linux
// and macOS only its owner may read it: it holds commands and paths, masked
// only where a secret is recognised.

use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use serde::{Deserialize, Serialize};

use crate::i18n::pick;

/// Longest target kept per line; the card shows more, the history needs less.
const MAX_TARGET: usize = 4000;

/// Up to this much history on disk, the parsed entries stay in memory between
/// queries and only what was appended since is read. Above it (the size limit
/// goes up to 200 MB a file) every query reads the files again.
const CACHE_MAX: u64 = 32 * 1024 * 1024;

/// A cache nobody has looked at for this long is dropped at the next append.
const CACHE_IDLE: Duration = Duration::from_secs(300);

static WRITE_LOCK: Mutex<()> = Mutex::new(());

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Entry {
    /// Milliseconds since the Unix epoch.
    pub ts: u64,
    pub id: String,
    pub session: String,
    /// Folder name of the session's cwd.
    pub project: String,
    pub cwd: String,
    pub tool: String,
    pub kind: String,
    pub target: String,
    /// low, medium, high or critical.
    pub level: String,
    pub labels: Vec<String>,
    /// allow, deny or none (nobody decided here).
    pub decision: String,
    /// user, hotkey, batch, rule, trusted, session, timeout, terminal, paused,
    /// busy, undelivered.
    pub by: String,
    pub rule: String,
    pub message: String,
    /// Time from request to decision.
    pub ms: u64,
}

impl Entry {
    pub fn capped(mut self) -> Self {
        if let Some((i, _)) = self.target.char_indices().nth(MAX_TARGET) {
            self.target.truncate(i);
            self.target.push('…');
        }
        self
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Filter {
    /// Free text, matched against target, project, tool, labels and rule.
    pub text: String,
    /// Minimum level: "", low, medium, high or critical.
    pub level: String,
    pub decision: String,
    pub by: String,
    pub project: String,
    pub since: u64,
    pub until: u64,
    pub limit: usize,
    pub offset: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub entries: Vec<Entry>,
    pub total: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Day {
    /// YYYY-MM-DD in the viewer's local time.
    pub date: String,
    pub allow: usize,
    pub deny: usize,
    pub none: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub total: usize,
    pub allowed: usize,
    pub denied: usize,
    pub unanswered: usize,
    /// Decided without a person: rule, trusted project or session grant.
    pub automatic: usize,
    pub low: usize,
    pub medium: usize,
    pub high: usize,
    pub critical: usize,
    pub top_projects: Vec<(String, usize)>,
    pub top_tools: Vec<(String, usize)>,
    pub top_labels: Vec<(String, usize)>,
    pub days: Vec<Day>,
    /// Median time a person took to decide, ms.
    pub median_ms: u64,
}

fn rank(level: &str) -> u8 {
    match level {
        "medium" => 1,
        "high" => 2,
        "critical" => 3,
        _ => 0,
    }
}

/// A file as it was when it was read: its length and when it was last changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Stamp {
    len: u64,
    modified: Option<SystemTime>,
}

fn stamp(path: &Path) -> Option<Stamp> {
    let meta = std::fs::metadata(path).ok()?;
    Some(Stamp { len: meta.len(), modified: meta.modified().ok() })
}

/// The parsed history, kept while the files stay as they were.
#[derive(Default)]
struct Cache {
    previous: Option<Stamp>,
    current: Option<Stamp>,
    /// How far into the current file has been read: the end of its last whole line.
    read_to: u64,
    entries: Vec<Entry>,
    used: Option<Instant>,
}

pub struct Log {
    dir: PathBuf,
    cache: Mutex<Cache>,
}

/// Parses JSON lines. A damaged line — bad JSON, a character cut in half — is
/// skipped on its own; the lines around it still count.
fn parse_lines(bytes: &[u8], out: &mut Vec<Entry>) {
    out.extend(
        bytes
            .split(|b| *b == b'\n')
            .filter(|line| !line.iter().all(u8::is_ascii_whitespace))
            .filter_map(|line| serde_json::from_slice::<Entry>(line).ok()),
    );
}

/// The bytes of `path` from `from`; with `whole_lines`, up to the end of its
/// last full line (one being written right now is left for the next read).
/// Returns them and the offset they end at.
fn read_from(path: &Path, from: u64, whole_lines: bool) -> (Vec<u8>, u64) {
    let mut bytes = Vec::new();
    let Ok(mut file) = std::fs::File::open(path) else { return (bytes, from) };
    if file.seek(SeekFrom::Start(from)).is_err() || file.read_to_end(&mut bytes).is_err() {
        return (Vec::new(), from);
    }
    if whole_lines {
        let keep = bytes.iter().rposition(|b| *b == b'\n').map_or(0, |i| i + 1);
        bytes.truncate(keep);
    }
    let end = from + bytes.len() as u64;
    (bytes, end)
}

/// The history folder, owner-only on Linux and macOS.
fn private_dir(dir: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)?;
        let mode = std::fs::metadata(dir)?.permissions().mode();
        if mode & 0o077 != 0 {
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
        }
        Ok(())
    }
    #[cfg(not(unix))]
    std::fs::create_dir_all(dir)
}

/// The history file opened for appending, owner-only on Linux and macOS —
/// also one an older version created with the default mode.
fn open_private(path: &Path) -> std::io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true).read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if file.metadata()?.permissions().mode() & 0o077 != 0 {
            file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        }
    }
    Ok(file)
}

/// Whether the file's last line was cut short (a full disk, a crash).
fn ends_mid_line(file: &mut std::fs::File) -> std::io::Result<bool> {
    if file.metadata()?.len() == 0 {
        return Ok(false);
    }
    file.seek(SeekFrom::End(-1))?;
    let mut last = [0u8];
    file.read_exact(&mut last)?;
    Ok(last[0] != b'\n')
}

impl Log {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into(), cache: Mutex::new(Cache::default()) }
    }

    pub fn current(&self) -> PathBuf {
        self.dir.join("audit.jsonl")
    }

    fn previous(&self) -> PathBuf {
        self.dir.join("audit.1.jsonl")
    }

    pub fn append(&self, entry: Entry, max_mb: u32) -> std::io::Result<()> {
        let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        private_dir(&self.dir)?;
        let path = self.current();
        let limit = u64::from(max_mb.max(1)) * 1024 * 1024;
        if std::fs::metadata(&path).map(|m| m.len() > limit).unwrap_or(false) {
            // A rotation that fails (on Windows, another program holding a file
            // open) must not cost the decision: it goes into the full file, and
            // rotation is tried again with the next one.
            let _ = std::fs::remove_file(self.previous());
            if let Err(err) = std::fs::rename(&path, self.previous()) {
                if !cfg!(test) {
                    crate::log::line(format!("history rotation failed, appending anyway: {err}"));
                }
            }
        }
        let mut line = serde_json::to_string(&entry.capped())?;
        line.push('\n');
        let mut file = open_private(&path)?;
        // A line cut short must not swallow this one.
        if ends_mid_line(&mut file)? {
            line.insert(0, '\n');
        }
        file.write_all(line.as_bytes())?;
        drop(file);
        let mut cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        if cache.used.is_some_and(|t| t.elapsed() > CACHE_IDLE) {
            *cache = Cache::default();
        }
        Ok(())
    }

    /// Runs `f` on everything on disk, oldest first, reading only what changed
    /// since the last time.
    fn with<R>(&self, f: impl FnOnce(&[Entry]) -> R) -> R {
        let (previous, current) = (stamp(&self.previous()), stamp(&self.current()));
        let size = previous.map_or(0, |s| s.len) + current.map_or(0, |s| s.len);
        let mut cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        if size > CACHE_MAX {
            *cache = Cache::default();
            drop(cache);
            let mut entries = Vec::new();
            parse_lines(&read_from(&self.previous(), 0, false).0, &mut entries);
            parse_lines(&read_from(&self.current(), 0, true).0, &mut entries);
            return f(&entries);
        }
        let grown = cache.previous == previous
            && cache.current.zip(current).is_some_and(|(was, now)| now.len > was.len && now.len >= cache.read_to);
        if grown {
            let (bytes, end) = read_from(&self.current(), cache.read_to, true);
            parse_lines(&bytes, &mut cache.entries);
            cache.read_to = end;
            cache.current = current;
        } else if cache.previous != previous || cache.current != current || cache.used.is_none() {
            let mut entries = Vec::new();
            parse_lines(&read_from(&self.previous(), 0, false).0, &mut entries);
            let (bytes, end) = read_from(&self.current(), 0, true);
            parse_lines(&bytes, &mut entries);
            *cache = Cache { previous, current, read_to: end, entries, used: None };
        }
        cache.used = Some(Instant::now());
        f(&cache.entries)
    }

    /// Everything on disk, oldest first. A damaged line is skipped, not fatal.
    #[cfg(test)]
    pub fn all(&self) -> Vec<Entry> {
        self.with(<[Entry]>::to_vec)
    }

    pub fn query(&self, f: &Filter) -> Page {
        let limit = if f.limit == 0 { 200 } else { f.limit.min(2000) };
        self.query_up_to(f, limit)
    }

    /// Every project name in the history, most frequent first.
    pub fn projects(&self) -> Vec<(String, usize)> {
        let mut counts: std::collections::HashMap<String, usize> = Default::default();
        self.with(|entries| {
            for e in entries.iter().filter(|e| !e.project.is_empty()) {
                *counts.entry(e.project.clone()).or_default() += 1;
            }
        });
        let mut v: Vec<(String, usize)> = counts.into_iter().collect();
        v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        v
    }

    /// Like `query`, with an explicit cap — exports take everything that matches.
    pub fn query_up_to(&self, f: &Filter, limit: usize) -> Page {
        let text = f.text.trim().to_lowercase();
        let project = f.project.trim().to_lowercase();
        self.with(|entries| {
            let hits: Vec<&Entry> = entries
                .iter()
                .filter(|e| {
                    (f.since == 0 || e.ts >= f.since)
                        && (f.until == 0 || e.ts <= f.until)
                        && (f.level.is_empty() || rank(&e.level) >= rank(&f.level))
                        && (f.decision.is_empty() || e.decision == f.decision)
                        && (f.by.is_empty() || e.by == f.by)
                        && (project.is_empty() || e.project.to_lowercase() == project)
                        && (text.is_empty()
                            || e.target.to_lowercase().contains(&text)
                            || e.project.to_lowercase().contains(&text)
                            || e.tool.to_lowercase().contains(&text)
                            || e.rule.to_lowercase().contains(&text)
                            || e.labels.iter().any(|l| l.to_lowercase().contains(&text)))
                })
                .collect();
            let total = hits.len();
            // Newest first.
            let entries = hits.into_iter().rev().skip(f.offset).take(limit).cloned().collect();
            Page { entries, total }
        })
    }

    /// Totals for the last `days` days; `tz_offset_min` is the viewer's
    /// `Date.getTimezoneOffset()` so days break at local midnight.
    pub fn stats(&self, days: u32, tz_offset_min: i32) -> Stats {
        let days = days.clamp(1, 366);
        let local = |ts: u64| ts as i64 - i64::from(tz_offset_min) * 60_000;
        let day_of = |ts: u64| local(ts).div_euclid(86_400_000);
        let today = day_of(now_ms());
        let first = today - i64::from(days) + 1;

        let mut s = Stats::default();
        let mut day_rows: Vec<Day> = (first..=today).map(|d| Day { date: ymd(d), ..Day::default() }).collect();
        let mut projects: std::collections::HashMap<String, usize> = Default::default();
        let mut tools: std::collections::HashMap<String, usize> = Default::default();
        let mut labels: std::collections::HashMap<String, usize> = Default::default();
        let mut waits: Vec<u64> = Vec::new();

        self.with(|entries| {
            for e in entries {
                let d = day_of(e.ts);
                if d < first || d > today {
                    continue;
                }
                s.total += 1;
                let row = &mut day_rows[(d - first) as usize];
                match e.decision.as_str() {
                    "allow" => {
                        s.allowed += 1;
                        row.allow += 1;
                    }
                    "deny" => {
                        s.denied += 1;
                        row.deny += 1;
                    }
                    _ => {
                        s.unanswered += 1;
                        row.none += 1;
                    }
                }
                match e.level.as_str() {
                    "medium" => s.medium += 1,
                    "high" => s.high += 1,
                    "critical" => s.critical += 1,
                    _ => s.low += 1,
                }
                if matches!(e.by.as_str(), "rule" | "trusted" | "session") {
                    s.automatic += 1;
                }
                if matches!(e.by.as_str(), "user" | "hotkey" | "batch") {
                    waits.push(e.ms);
                }
                *projects.entry(e.project.clone()).or_default() += 1;
                *tools.entry(e.tool.clone()).or_default() += 1;
                for l in &e.labels {
                    *labels.entry(l.clone()).or_default() += 1;
                }
            }
        });
        let top = |m: std::collections::HashMap<String, usize>| {
            let mut v: Vec<(String, usize)> = m.into_iter().filter(|(k, _)| !k.is_empty()).collect();
            v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
            v.truncate(6);
            v
        };
        s.top_projects = top(projects);
        s.top_tools = top(tools);
        s.top_labels = top(labels);
        s.days = day_rows;
        waits.sort_unstable();
        s.median_ms = waits.get(waits.len() / 2).copied().unwrap_or(0);
        s
    }

    pub fn clear(&self) -> std::io::Result<()> {
        let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        *self.cache.lock().unwrap_or_else(|e| e.into_inner()) = Cache::default();
        for p in [self.current(), self.previous()] {
            if p.exists() {
                std::fs::remove_file(p)?;
            }
        }
        Ok(())
    }
}

/// Days since 1970-01-01 → "YYYY-MM-DD" (proleptic Gregorian, civil-from-days).
fn ymd(days: i64) -> String {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

/// "YYYY-MM-DD HH:MM:SS" in the viewer's local time.
pub fn local_stamp(ts: u64, tz_offset_min: i32) -> String {
    let local = ts as i64 - i64::from(tz_offset_min) * 60_000;
    let day = local.div_euclid(86_400_000);
    let secs = local.rem_euclid(86_400_000) / 1000;
    format!("{} {:02}:{:02}:{:02}", ymd(day), secs / 3600, secs / 60 % 60, secs % 60)
}

/// One CSV cell. Quoted always; any line of it that a spreadsheet would read
/// as a formula is defused with a leading apostrophe — the history is full of
/// text a hostile prompt could have chosen, and a reader that splits rows at
/// line breaks would see each line as a cell of its own.
fn cell(s: &str) -> String {
    let lines = s.replace("\r\n", "\n").replace('\r', "\n");
    let body: Vec<String> = lines
        .split('\n')
        .map(|line| if line.starts_with(['=', '+', '-', '@', '\t']) { format!("'{line}") } else { line.to_string() })
        .collect();
    format!("\"{}\"", body.join("\n").replace('"', "\"\""))
}

/// The separators an export may use: a comma, or a semicolon for spreadsheets
/// in locales that write decimals with a comma (Turkish, most of Europe).
pub fn separator(choice: Option<&str>) -> char {
    match choice {
        Some(";") => ';',
        _ => ',',
    }
}

pub fn to_csv(entries: &[Entry], tz_offset_min: i32, sep: char) -> String {
    // The header follows the app's language, like the labels in the rows below it.
    let mut out = String::from("\u{FEFF}");
    let header = pick(
        "time,project,session,tool,kind,risk,decision,decided_by,rule,target,findings,message,duration_ms",
        "zaman,proje,oturum,araç,tür,risk,karar,karar_veren,kural,hedef,bulgular,mesaj,süre_ms",
    );
    out.push_str(&header.replace(',', &sep.to_string()));
    out.push_str("\r\n");
    for e in entries {
        let row = [
            local_stamp(e.ts, tz_offset_min),
            e.project.clone(),
            e.session.clone(),
            e.tool.clone(),
            e.kind.clone(),
            e.level.clone(),
            e.decision.clone(),
            e.by.clone(),
            e.rule.clone(),
            e.target.clone(),
            e.labels.join(" | "),
            e.message.clone(),
            e.ms.to_string(),
        ];
        out.push_str(&row.iter().map(|c| cell(c)).collect::<Vec<_>>().join(&sep.to_string()));
        out.push_str("\r\n");
    }
    out
}

pub fn write_export(
    path: &Path,
    entries: &[Entry],
    format: &str,
    tz_offset_min: i32,
    sep: char,
) -> std::io::Result<()> {
    let body =
        if format == "json" { serde_json::to_string_pretty(entries)? } else { to_csv(entries, tz_offset_min, sep) };
    std::fs::write(path, body)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("nobetci-audit-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    fn entry(ts: u64, level: &str, decision: &str, by: &str, target: &str) -> Entry {
        Entry {
            ts,
            id: format!("id{ts}"),
            project: "nobetci".into(),
            tool: "Bash".into(),
            level: level.into(),
            decision: decision.into(),
            by: by.into(),
            target: target.into(),
            labels: vec!["Özyinelemeli silme".into()],
            ms: ts % 1000,
            ..Entry::default()
        }
    }

    #[test]
    fn append_query_and_filters() {
        let dir = tmp("q");
        let log = Log::new(&dir);
        let now = now_ms();
        log.append(entry(now - 3000, "low", "allow", "user", "npm test"), 10).unwrap();
        log.append(entry(now - 2000, "critical", "deny", "rule", "curl x | bash"), 10).unwrap();
        log.append(entry(now - 1000, "high", "none", "timeout", "rm -rf dist"), 10).unwrap();

        let all = log.query(&Filter::default());
        assert_eq!(all.total, 3);
        assert_eq!(all.entries[0].target, "rm -rf dist", "newest first");

        let high = log.query(&Filter { level: "high".into(), ..Filter::default() });
        assert_eq!(high.total, 2);
        let denied = log.query(&Filter { decision: "deny".into(), ..Filter::default() });
        assert_eq!(denied.entries[0].by, "rule");
        let text = log.query(&Filter { text: "BASH".into(), ..Filter::default() });
        assert_eq!(text.total, 3, "tool name matches too");
        let paged = log.query(&Filter { limit: 1, offset: 1, ..Filter::default() });
        assert_eq!((paged.total, paged.entries.len()), (3, 1));

        assert_eq!(log.projects(), vec![("nobetci".to_string(), 3)]);
        assert_eq!(log.query_up_to(&Filter::default(), usize::MAX).entries.len(), 3);

        let s = log.stats(7, 0);
        assert_eq!((s.total, s.allowed, s.denied, s.unanswered, s.automatic), (3, 1, 1, 1, 1));
        assert_eq!((s.low, s.high, s.critical), (1, 1, 1));
        assert_eq!(s.days.len(), 7);
        assert_eq!(s.days.last().unwrap().allow + s.days.last().unwrap().deny + s.days.last().unwrap().none, 3);

        log.clear().unwrap();
        assert_eq!(log.query(&Filter::default()).total, 0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn it_rolls_over_and_still_reads_both_files() {
        let dir = tmp("roll");
        let log = Log::new(&dir);
        let big = "x".repeat(3900);
        for i in 0..400 {
            log.append(entry(1_700_000_000_000 + i, "low", "allow", "user", &big), 1).unwrap();
        }
        assert!(dir.join("audit.1.jsonl").exists());
        let n = log.query(&Filter { limit: 2000, ..Filter::default() }).total;
        assert!(n > 200 && n <= 400, "both files are read, the oldest are dropped: {n}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn long_targets_are_capped_and_bad_lines_skipped() {
        let dir = tmp("cap");
        let log = Log::new(&dir);
        log.append(entry(1, "low", "allow", "user", &"é".repeat(9000)), 10).unwrap();
        std::fs::OpenOptions::new().append(true).open(log.current()).unwrap().write_all(b"{ broken\n").unwrap();
        let page = log.query(&Filter::default());
        assert_eq!(page.total, 1);
        assert!(page.entries[0].target.chars().count() <= MAX_TARGET + 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_damaged_line_hides_only_itself() {
        // R-17: a write cut in the middle of a character, then more appends.
        let dir = tmp("utf8");
        let log = Log::new(&dir);
        log.append(entry(1, "low", "allow", "user", "first"), 10).unwrap();
        let cut = serde_json::to_string(&entry(2, "low", "allow", "user", "Özyinelemeli")).unwrap();
        let at = cut.find('Ö').unwrap() + 1; // inside the two bytes of Ö
        std::fs::OpenOptions::new().append(true).open(log.current()).unwrap().write_all(&cut.as_bytes()[..at]).unwrap();
        log.append(entry(3, "low", "allow", "user", "third"), 10).unwrap();
        // An editor that saved the file in Latin-1: invalid UTF-8 on a line of its own.
        std::fs::OpenOptions::new()
            .append(true)
            .open(log.current())
            .unwrap()
            .write_all(b"{\"target\":\"caf\xe9\"}\n")
            .unwrap();
        log.append(entry(4, "low", "allow", "user", "fourth"), 10).unwrap();
        let targets: Vec<String> = log.all().into_iter().map(|e| e.target).collect();
        assert_eq!(targets, vec!["first", "third", "fourth"]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_failed_rotation_still_records_the_decision() {
        // R-18: audit.1.jsonl cannot be replaced (here: a folder holds its name).
        let dir = tmp("rot");
        let log = Log::new(&dir);
        std::fs::create_dir_all(dir.join("audit.1.jsonl")).unwrap();
        std::fs::write(dir.join("audit.1.jsonl").join("keep"), "x").unwrap();
        let big = "x".repeat(3900);
        for i in 0..300 {
            log.append(entry(i, "low", "allow", "user", &big), 1).unwrap();
        }
        assert_eq!(log.all().len(), 300, "every decision is kept in the full file");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_cache_reads_only_what_was_appended() {
        // R-21: queries reuse what was parsed; an append is picked up, so is a
        // rotation and a clear.
        let dir = tmp("cache");
        let log = Log::new(&dir);
        log.append(entry(1, "low", "allow", "user", "one"), 10).unwrap();
        assert_eq!(log.query(&Filter::default()).total, 1);
        log.append(entry(2, "low", "allow", "user", "two"), 10).unwrap();
        assert_eq!(log.query(&Filter::default()).total, 2);
        assert_eq!(log.cache.lock().unwrap().read_to, std::fs::metadata(log.current()).unwrap().len());
        // A half-written line is left for later, then read whole.
        let next = serde_json::to_string(&entry(3, "low", "allow", "user", "three")).unwrap();
        let (head, tail) = next.split_at(10);
        std::fs::OpenOptions::new().append(true).open(log.current()).unwrap().write_all(head.as_bytes()).unwrap();
        assert_eq!(log.query(&Filter::default()).total, 2);
        std::fs::OpenOptions::new()
            .append(true)
            .open(log.current())
            .unwrap()
            .write_all(format!("{tail}\n").as_bytes())
            .unwrap();
        assert_eq!(log.query(&Filter::default()).entries[0].target, "three");
        // Another process may rotate or rewrite the files: they are read again.
        std::fs::rename(log.current(), log.previous()).unwrap();
        log.append(entry(4, "low", "allow", "user", "four"), 10).unwrap();
        assert_eq!(log.query(&Filter::default()).total, 4);
        log.clear().unwrap();
        assert_eq!(log.query(&Filter::default()).total, 0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn only_its_owner_may_read_it() {
        // R-22
        use std::os::unix::fs::PermissionsExt;
        let dir = tmp("perm");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::write(dir.join("audit.jsonl"), "").unwrap();
        std::fs::set_permissions(dir.join("audit.jsonl"), std::fs::Permissions::from_mode(0o644)).unwrap();
        let log = Log::new(&dir);
        log.append(entry(1, "low", "allow", "user", "x"), 10).unwrap();
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!((mode(&dir), mode(&log.current())), (0o700, 0o600));
        let fresh = tmp("perm2").join("nested");
        let log = Log::new(&fresh);
        log.append(entry(1, "low", "allow", "user", "x"), 10).unwrap();
        assert_eq!((mode(&fresh), mode(&log.current())), (0o700, 0o600));
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(fresh.parent().unwrap());
    }

    #[test]
    fn csv_is_quoted_and_formula_safe() {
        let e = entry(0, "high", "deny", "user", "=HYPERLINK(\"http://x\")");
        let csv = to_csv(&[e], 0, ',');
        assert!(csv.starts_with('\u{FEFF}'));
        let header = csv.trim_start_matches('\u{FEFF}').lines().next().unwrap();
        assert!(header.starts_with("time,project,") || header.starts_with("zaman,proje,"), "{header}");
        assert_eq!(header.split(',').count(), 13, "one name per column");
        assert!(csv.contains("\"'=HYPERLINK(\"\"http://x\"\")\""));
        assert!(csv.contains("1970-01-01 00:00:00"));
    }

    #[test]
    fn csv_lines_inside_a_cell_are_defused_and_the_separator_can_be_a_semicolon() {
        // R-16 / C-7: a reader that splits rows at line breaks, or Excel in a
        // locale whose list separator is `;`, must not meet a live formula.
        let e = entry(0, "high", "deny", "user", "echo a\r\n=cmd|'/c calc'!A1\n+1\recho b; c");
        let csv = to_csv(&[e], 0, ';');
        assert!(csv.contains("\"echo a\n'=cmd|'/c calc'!A1\n'+1\necho b; c\""), "{csv}");
        let header = csv.trim_start_matches('\u{FEFF}').lines().next().unwrap();
        assert_eq!(header.split(';').count(), 13);
        assert!(!header.contains(','));
        let row = csv.lines().nth(1).unwrap();
        assert!(row.starts_with("\"1970-01-01 00:00:00\";\"nobetci\";"), "{row}");
        assert_eq!(
            (separator(Some(";")), separator(Some(",")), separator(Some("\t")), separator(None)),
            (';', ',', ',', ',')
        );
    }

    #[test]
    fn dates_and_local_time() {
        assert_eq!(ymd(0), "1970-01-01");
        assert_eq!(ymd(19_723), "2024-01-01");
        assert_eq!(ymd(20_727), "2026-10-01");
        // UTC+3 (Istanbul): getTimezoneOffset() is -180.
        assert_eq!(local_stamp(0, -180), "1970-01-01 03:00:00");
    }
}
