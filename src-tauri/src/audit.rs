// History of every permission decision, as JSON lines in audit.jsonl (rolling
// over to audit.1.jsonl) in the app's data folder: %LOCALAPPDATA%\Nobetci,
// ~/Library/Application Support/Nobetci, ~/.local/share/nobetci.
//
// One line per request: what was asked, how risky it looked, what happened and
// who decided — a person, a rule, a trusted project, a session grant, or nobody
// (timed out / handed to the terminal). Nothing leaves the machine. On Linux
// and macOS only its owner may read it: it holds commands and paths, masked
// only where a secret is recognised.
//
// A line keeps the level the decision was made at and, when a user rule
// changed it, the engine's own level too (`engineLevel`), so the history never
// understates what was let through. Findings are kept as the labels the card
// showed and as category ids (`categories`), which the settings window shows
// in whatever language it uses now.

use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use serde::{Deserialize, Serialize};

use crate::i18n::pick;
use crate::risk::Level;

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
    /// low, medium, high or critical: the level the request was decided at.
    pub level: String,
    /// The risk engine's own level (same values), present only when a user
    /// rule re-scored the request to `level` (C-22).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine_level: Option<String>,
    /// The findings as the card showed them, in the language of that moment.
    pub labels: Vec<String>,
    /// The findings' category ids (`risk_categories`), one per label and in
    /// the same order (C-24). Absent in entries written before they were kept.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub categories: Vec<String>,
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

    /// The findings to show now, each once: through `labels_now` (category id →
    /// label in the current language) where the entry kept its categories,
    /// as recorded otherwise.
    fn findings_now<'a>(&'a self, labels_now: &'a HashMap<&'static str, &'static str>) -> Vec<&'a str> {
        let by_id = self.categories.len() == self.labels.len();
        let mut seen = HashSet::new();
        self.labels
            .iter()
            .enumerate()
            .map(|(i, label)| {
                by_id.then(|| labels_now.get(self.categories[i].as_str()).copied()).flatten().unwrap_or(label.as_str())
            })
            .filter(|label| seen.insert(*label))
            .collect()
    }
}

/// A level as the history writes it: "low", "medium", "high" or "critical".
fn level_word(level: Level) -> String {
    serde_json::to_value(level).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default()
}

/// What `engineLevel` holds for a request the engine scored `engine` and that
/// was decided at `level`: nothing unless a rule changed it.
pub fn engine_level(engine: Level, level: Level) -> Option<String> {
    (engine != level).then(|| level_word(engine))
}

/// Every finding category's label in the current language, by id.
fn current_labels() -> HashMap<&'static str, &'static str> {
    crate::risk::categories().into_iter().map(|c| (c.id, c.label)).collect()
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

/// Text as the history search compares it: lower case, with Turkish's dotted
/// and dotless i folded onto a plain `i`. "İ" lowercases to an `i` followed by
/// U+0307 (combining dot above) and "ı" has no other case, so a plain
/// `to_lowercase` lets "İNFRA" miss "infra-scripts" and "internet" miss
/// "İnternetten". The query and every field go through the same fold.
fn fold(s: &str) -> String {
    s.to_lowercase().chars().filter(|&c| c != '\u{0307}').map(|c| if c == '\u{0131}' { 'i' } else { c }).collect()
}

const HOUR_MS: i64 = 3_600_000;
const DAY_MS: i64 = 24 * HOUR_MS;

/// `day_starts` as whole milliseconds, when they can be the local midnights
/// around `days` days (C-18): `days + 1` whole numbers in the range a script
/// can hold exactly, each day between 22 and 26 hours long (a daylight-saving
/// day is 23 or 25), which also makes them ascending.
fn local_midnights(day_starts: &[f64], days: usize) -> Option<Vec<i64>> {
    const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;
    if day_starts.len() != days + 1 {
        return None;
    }
    let starts = day_starts
        .iter()
        .map(|&v| (v.is_finite() && v.fract() == 0.0 && v.abs() <= MAX_SAFE_INTEGER).then_some(v as i64))
        .collect::<Option<Vec<i64>>>()?;
    starts.windows(2).all(|w| (22 * HOUR_MS..=26 * HOUR_MS).contains(&(w[1] - w[0]))).then_some(starts)
}

/// Where the `days` day buckets of `stats` begin and end (`days + 1` instants,
/// bucket i is `[starts[i], starts[i + 1])`) and the date each one shows.
fn day_buckets(now: u64, days: u32, tz_offset_min: i32, day_starts: Option<&[f64]>) -> (Vec<i64>, Vec<String>) {
    let offset = i64::from(tz_offset_min) * 60_000;
    if let Some(starts) = day_starts.and_then(|s| local_midnights(s, days as usize)) {
        // A day's date from its middle: today's offset is an hour or so off on
        // the far side of a clock change, never half a day.
        let dates = starts.windows(2).map(|w| ymd((w[0] + (w[1] - w[0]) / 2 - offset).div_euclid(DAY_MS))).collect();
        return (starts, dates);
    }
    // Local midnight by today's offset, for every day.
    let today = (now as i64 - offset).div_euclid(DAY_MS);
    let first = today - i64::from(days) + 1;
    let starts = (0..=i64::from(days)).map(|i| (first + i) * DAY_MS + offset).collect();
    (starts, (first..=today).map(ymd).collect())
}

/// A file as it was when it was read: which file it is (device and inode on
/// Linux and macOS, its creation time elsewhere), its length and when it was
/// last changed. A file deleted and written anew is another file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Stamp {
    id: Option<(u64, u64)>,
    created: Option<SystemTime>,
    len: u64,
    modified: Option<SystemTime>,
}

fn stamp(path: &Path) -> Option<Stamp> {
    let meta = std::fs::metadata(path).ok()?;
    #[cfg(unix)]
    let id = {
        use std::os::unix::fs::MetadataExt;
        Some((meta.dev(), meta.ino()))
    };
    #[cfg(not(unix))]
    let id = None;
    Some(Stamp { id, created: meta.created().ok(), len: meta.len(), modified: meta.modified().ok() })
}

/// How many bytes before `read_to` are kept to recognise the file read so far.
const TAIL: u64 = 64;

/// The parsed history, kept while the files stay as they were.
#[derive(Default)]
struct Cache {
    previous: Option<Stamp>,
    current: Option<Stamp>,
    /// How far into the current file has been read: the end of its last whole line.
    read_to: u64,
    /// The last bytes before `read_to`. A file that grew but no longer has them
    /// there was emptied or rewritten, not appended to.
    tail: Vec<u8>,
    entries: Vec<Entry>,
    used: Option<Instant>,
}

/// The `TAIL` bytes of `path` before `end` (fewer near its start).
fn tail_of(path: &Path, end: u64) -> Vec<u8> {
    let from = end.saturating_sub(TAIL);
    let mut bytes = Vec::new();
    if let Ok(mut file) = std::fs::File::open(path) {
        if file.seek(SeekFrom::Start(from)).is_ok() {
            let _ = file.take(end - from).read_to_end(&mut bytes);
        }
    }
    bytes
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

/// The history folder, owner-only on Linux and macOS where the file system
/// allows it: a decision is recorded even where it does not
/// (`settings::tighten`, which also names such a folder in the log).
fn private_dir(dir: &Path) -> std::io::Result<()> {
    crate::settings::private_dir(dir)
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
        let meta = file.metadata()?;
        crate::settings::tighten(path, &meta, || file.set_permissions(std::fs::Permissions::from_mode(0o600)))?;
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
        // Appended to: the same file, longer, and still holding what was read
        // where it was read. A file emptied or replaced and then grown past
        // that point is read again whole.
        let grown = cache.previous == previous
            && cache.current.zip(current).is_some_and(|(was, now)| {
                was.id == now.id
                    && was.created == now.created
                    && now.len > was.len
                    && now.len >= cache.read_to
                    && tail_of(&self.current(), cache.read_to) == cache.tail
            });
        if grown {
            let (bytes, end) = read_from(&self.current(), cache.read_to, true);
            parse_lines(&bytes, &mut cache.entries);
            cache.read_to = end;
            cache.tail = tail_of(&self.current(), end);
            cache.current = current;
        } else if cache.previous != previous || cache.current != current || cache.used.is_none() {
            let mut entries = Vec::new();
            parse_lines(&read_from(&self.previous(), 0, false).0, &mut entries);
            let (bytes, end) = read_from(&self.current(), 0, true);
            parse_lines(&bytes, &mut entries);
            let tail = tail_of(&self.current(), end);
            *cache = Cache { previous, current, read_to: end, tail, entries, used: None };
        }
        cache.used = Some(Instant::now());
        f(&cache.entries)
    }

    /// Lets go of the parsed history (the settings window, its only reader,
    /// was closed): a long history is tens of megabytes in memory. The next
    /// query reads the files again.
    pub fn forget(&self) {
        *self.cache.lock().unwrap_or_else(|e| e.into_inner()) = Cache::default();
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
    /// A finding matches by the label it was recorded with and, where the entry
    /// kept its category, by that category's label in the current language.
    pub fn query_up_to(&self, f: &Filter, limit: usize) -> Page {
        let text = fold(f.text.trim());
        let project = fold(f.project.trim());
        let labels_now: HashMap<&str, String> = if text.is_empty() {
            HashMap::new()
        } else {
            current_labels().into_iter().map(|(id, l)| (id, fold(l))).collect()
        };
        self.with(|entries| {
            let hits: Vec<&Entry> = entries
                .iter()
                .filter(|e| {
                    (f.since == 0 || e.ts >= f.since)
                        && (f.until == 0 || e.ts <= f.until)
                        && (f.level.is_empty() || rank(&e.level) >= rank(&f.level))
                        && (f.decision.is_empty() || e.decision == f.decision)
                        && (f.by.is_empty() || e.by == f.by)
                        && (project.is_empty() || fold(&e.project) == project)
                        && (text.is_empty()
                            || fold(&e.target).contains(&text)
                            || fold(&e.project).contains(&text)
                            || fold(&e.tool).contains(&text)
                            || fold(&e.rule).contains(&text)
                            || e.labels.iter().any(|l| fold(l).contains(&text))
                            || e.categories
                                .iter()
                                .any(|c| labels_now.get(c.as_str()).is_some_and(|l| l.contains(&text))))
                })
                .collect();
            let total = hits.len();
            // Newest first.
            let entries = hits.into_iter().rev().skip(f.offset).take(limit).cloned().collect();
            Page { entries, total }
        })
    }

    /// Totals for the last `days` days, which break at the viewer's local
    /// midnights. `day_starts` are those midnights as the viewer's clock has
    /// them (C-18: `days + 1` instants, oldest first, the last one the coming
    /// midnight), so the days before a daylight-saving change keep their own
    /// hours. Without them, or when they cannot be local midnights, every day
    /// breaks at local midnight by `tz_offset_min` — the viewer's
    /// `Date.getTimezoneOffset()` today — as older callers expect.
    pub fn stats(&self, days: u32, tz_offset_min: i32, day_starts: Option<&[f64]>) -> Stats {
        self.stats_at(now_ms(), days, tz_offset_min, day_starts)
    }

    fn stats_at(&self, now: u64, days: u32, tz_offset_min: i32, day_starts: Option<&[f64]>) -> Stats {
        let days = days.clamp(1, 366);
        let (starts, dates) = day_buckets(now, days, tz_offset_min, day_starts);
        let (from, to) = (starts[0], starts[starts.len() - 1]);

        let mut s = Stats::default();
        let mut day_rows: Vec<Day> = dates.into_iter().map(|date| Day { date, ..Day::default() }).collect();
        let mut projects: std::collections::HashMap<String, usize> = Default::default();
        let mut tools: std::collections::HashMap<String, usize> = Default::default();
        let mut labels: std::collections::HashMap<String, usize> = Default::default();
        let mut waits: Vec<u64> = Vec::new();
        // Findings are counted under their label in the current language where
        // the entry kept the category, so a history recorded in Turkish reads
        // in English after a switch (C-24).
        let labels_now = current_labels();

        self.with(|entries| {
            for e in entries {
                let ts = e.ts as i64;
                if ts < from || ts >= to {
                    continue;
                }
                s.total += 1;
                let row = &mut day_rows[starts.partition_point(|&start| start <= ts) - 1];
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
                for label in e.findings_now(&labels_now) {
                    *labels.entry(label.to_string()).or_default() += 1;
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

/// One CSV cell. Quoted always; anything in it a spreadsheet could take for a
/// formula is defused with an apostrophe — the history is full of text a
/// hostile prompt could have chosen. Not only the cell's start: a reader that
/// splits rows at line breaks, or that opens a `,` file with `;` (or the other
/// way round) and does not honour the quotes, cuts the text at those points,
/// so whatever follows a line break, a `,` or a `;` (and any quotes there)
/// starts a cell of its own.
fn cell(s: &str) -> String {
    let text = s.replace("\r\n", "\n").replace('\r', "\n");
    let mut body = String::with_capacity(text.len() + 2);
    let mut starts_cell = true;
    for c in text.chars() {
        if starts_cell && matches!(c, '=' | '+' | '-' | '@' | '\t') {
            body.push('\'');
        }
        body.push(c);
        starts_cell = matches!(c, '\n' | ',' | ';') || (starts_cell && c == '"');
    }
    format!("\"{}\"", body.replace('"', "\"\""))
}

/// The separators an export may use: a comma, or a semicolon for spreadsheets
/// in locales that write decimals with a comma (Turkish, most of Europe).
pub fn separator(choice: Option<&str>) -> char {
    match choice {
        Some(";") => ';',
        _ => ',',
    }
}

/// The export as CSV. Each row's time is local time as it was at that moment
/// on this computer — summer or winter time alike, as the History table shows
/// it — and `tz_offset_min` (the window's offset today) only where the system
/// cannot say.
pub fn to_csv(entries: &[Entry], tz_offset_min: i32, sep: char) -> String {
    to_csv_by(entries, sep, |ts| crate::sys::utc_offset_min_at(ts).map_or(tz_offset_min, |east| -east))
}

/// `to_csv`, with `tz_offset_at(ts)` giving the offset in force at `ts`, in
/// `Date.getTimezoneOffset()` minutes (west of UTC).
fn to_csv_by(entries: &[Entry], sep: char, tz_offset_at: impl Fn(u64) -> i32) -> String {
    // The header follows the app's language. `findings` are the labels as the
    // card showed them; `engine_level` is the engine's own level where a rule
    // changed `risk`, and empty otherwise.
    let mut out = String::from("\u{FEFF}");
    let header = pick(
        "time,project,session,tool,kind,risk,decision,decided_by,rule,target,findings,message,duration_ms,engine_level",
        "zaman,proje,oturum,araç,tür,risk,karar,karar_veren,kural,hedef,bulgular,mesaj,süre_ms,motor_riski",
    );
    out.push_str(&header.replace(',', &sep.to_string()));
    out.push_str("\r\n");
    for e in entries {
        let row = [
            local_stamp(e.ts, tz_offset_at(e.ts)),
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
            e.engine_level.clone().unwrap_or_default(),
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

        let s = log.stats(7, 0, None);
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
        let csv = to_csv_by(&[e], ',', |_| 0);
        assert!(csv.starts_with('\u{FEFF}'));
        let header = csv.trim_start_matches('\u{FEFF}').lines().next().unwrap();
        assert!(header.starts_with("time,project,") || header.starts_with("zaman,proje,"), "{header}");
        assert_eq!(header.split(',').count(), 14, "one name per column");
        assert!(header.ends_with(",engine_level") || header.ends_with(",motor_riski"), "{header}");
        assert!(csv.contains("\"'=HYPERLINK(\"\"http://x\"\")\""));
        assert!(csv.contains("1970-01-01 00:00:00"));
    }

    #[test]
    fn csv_lines_inside_a_cell_are_defused_and_the_separator_can_be_a_semicolon() {
        // R-16 / C-7: a reader that splits rows at line breaks, or Excel in a
        // locale whose list separator is `;`, must not meet a live formula.
        let e = entry(0, "high", "deny", "user", "echo a\r\n=cmd|'/c calc'!A1\n+1\recho b; c");
        let csv = to_csv_by(&[e], ';', |_| 0);
        assert!(csv.contains("\"echo a\n'=cmd|'/c calc'!A1\n'+1\necho b; c\""), "{csv}");
        let header = csv.trim_start_matches('\u{FEFF}').lines().next().unwrap();
        assert_eq!(header.split(';').count(), 14);
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

    #[test]
    fn search_folds_turkish_dotted_and_dotless_i() {
        // S-19 / settings-2#11: "İ" lowercases to an i and U+0307, "ı" has no
        // other case. The query and every searched field fold the same way.
        let dir = tmp("fold");
        let log = Log::new(&dir);
        let mut download = entry(1, "high", "allow", "user", "curl -fsSL https://example.com/x.sh | sh");
        download.labels = vec!["İnternetten indirip çalıştırıyor".into()];
        log.append(download, 10).unwrap();
        log.append(entry(2, "low", "allow", "user", "cd infra-scripts && make"), 10).unwrap();
        log.append(entry(3, "low", "allow", "user", "cat istanbul.csv"), 10).unwrap();
        let mut capitals = entry(4, "low", "allow", "user", "ls");
        capitals.project = "İZMİR-api".into();
        log.append(capitals, 10).unwrap();
        let hits = |filter: Filter| -> Vec<u64> {
            let mut ts: Vec<u64> = log.query(&filter).entries.iter().map(|e| e.ts).collect();
            ts.sort_unstable();
            ts
        };
        let text = |q: &str| hits(Filter { text: q.into(), ..Filter::default() });

        assert_eq!(text("İNFRA"), [2]);
        assert_eq!(text("internet"), [1], "a label that starts with İ");
        assert_eq!(text("İnternetten"), [1]);
        assert_eq!(text("ISTANBUL"), [3]);
        assert_eq!(text("İSTANBUL"), [3]);
        assert_eq!(text("\u{0131}stanbul"), [3], "a dotless i typed on a Turkish keyboard");
        assert_eq!(text("izmir"), [4], "project names fold too");
        // Plain ASCII search is unchanged.
        assert_eq!(text("MAKE"), [2]);
        assert_eq!(text("bash"), [1, 2, 3, 4], "the tool name");
        assert_eq!(text("nothing-like-this"), Vec::<u64>::new());
        // So does the project filter.
        assert_eq!(hits(Filter { project: "izmir-API".into(), ..Filter::default() }), [4]);
        assert_eq!(hits(Filter { project: "nobetci".into(), ..Filter::default() }), [1, 2, 3]);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Milliseconds since the epoch of a UTC date and time.
    fn utc(y: i64, m: i64, d: i64, h: i64, min: i64) -> i64 {
        let y = if m <= 2 { y - 1 } else { y };
        let era = y.div_euclid(400);
        let yoe = y - era * 400;
        let doy = (153 * ((m + 9) % 12) + 2) / 5 + d - 1;
        let days = era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
        ((days * 24 + h) * 60 + min) * 60_000
    }

    fn per_day(s: &Stats) -> Vec<(&str, usize)> {
        s.days.iter().map(|d| (d.date.as_str(), d.allow + d.deny + d.none)).collect()
    }

    #[test]
    fn days_break_at_the_local_midnights_the_window_sends() {
        // C-18 / settings-tabs#17. Berlin leaves summer time on 2026-10-25 at
        // 03:00 (UTC+2 → UTC+1), so that day has 25 hours; New York starts it on
        // 2026-03-08 at 02:00 (UTC-5 → UTC-4), a day of 23 hours.
        assert_eq!(ymd(utc(2026, 10, 25, 12, 0).div_euclid(DAY_MS)), "2026-10-25");
        let dir = tmp("dst");
        let log = Log::new(&dir);
        let at = |ts: i64| entry(ts as u64, "low", "allow", "user", "x");
        for ts in [
            utc(2026, 10, 23, 21, 30), // 23 Oct 23:30 CEST: before the range
            utc(2026, 10, 23, 22, 30), // 24 Oct 00:30 CEST
            utc(2026, 10, 24, 22, 30), // 25 Oct 00:30 CEST
            utc(2026, 10, 25, 22, 30), // 25 Oct 23:30 CET, the 25th hour
            utc(2026, 10, 26, 11, 0),  // 26 Oct 12:00 CET
        ] {
            log.append(at(ts), 10).unwrap();
        }
        // The midnights of 24, 25, 26 and 27 October, Berlin time; now is 26 Oct, CET.
        let starts =
            [utc(2026, 10, 23, 22, 0), utc(2026, 10, 24, 22, 0), utc(2026, 10, 25, 23, 0), utc(2026, 10, 26, 23, 0)];
        let starts: Vec<f64> = starts.iter().map(|&s| s as f64).collect();
        let now = utc(2026, 10, 26, 11, 30) as u64;
        let s = log.stats_at(now, 3, -60, Some(&starts));
        assert_eq!(per_day(&s), [("2026-10-24", 1), ("2026-10-25", 2), ("2026-10-26", 1)]);
        assert_eq!((s.total, s.allowed), (4, 4));
        // Today's offset for every day, as before: each summer-time day loses
        // its first hour to the day before, and the range starts an hour late.
        let old = log.stats_at(now, 3, -60, None);
        assert_eq!(per_day(&old), [("2026-10-24", 1), ("2026-10-25", 1), ("2026-10-26", 1)]);
        assert_eq!(old.total, 3);
        log.clear().unwrap();

        for ts in [
            utc(2026, 3, 8, 4, 30), // 7 Mar 23:30 EST
            utc(2026, 3, 9, 3, 30), // 8 Mar 23:30 EDT, the last hour of a 23-hour day
            utc(2026, 3, 9, 4, 0),  // 9 Mar 00:00 EDT: the coming midnight, outside
        ] {
            log.append(at(ts), 10).unwrap();
        }
        let starts = [utc(2026, 3, 7, 5, 0), utc(2026, 3, 8, 5, 0), utc(2026, 3, 9, 4, 0)];
        let starts: Vec<f64> = starts.iter().map(|&s| s as f64).collect();
        let now = utc(2026, 3, 8, 15, 0) as u64;
        let s = log.stats_at(now, 2, 240, Some(&starts));
        assert_eq!(per_day(&s), [("2026-03-07", 1), ("2026-03-08", 1)]);
        let old = log.stats_at(now, 2, 240, None);
        assert_eq!(per_day(&old), [("2026-03-07", 0), ("2026-03-08", 2)]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn day_boundaries_that_cannot_be_local_midnights_fall_back_to_the_offset() {
        // Istanbul (UTC+3, getTimezoneOffset() -180), now 22 Nov 12:00.
        let dir = tmp("dst-fallback");
        let log = Log::new(&dir);
        for ts in [utc(2026, 11, 20, 22, 0), utc(2026, 11, 21, 10, 0), utc(2026, 11, 22, 8, 0)] {
            log.append(entry(ts as u64, "low", "allow", "user", "x"), 10).unwrap();
        }
        let now = utc(2026, 11, 22, 9, 0) as u64;
        let fallback = log.stats_at(now, 3, -180, None);
        assert_eq!(per_day(&fallback), [("2026-11-20", 0), ("2026-11-21", 2), ("2026-11-22", 1)]);

        // Valid boundaries two hours off the offset's midnights are used as sent.
        let good: Vec<f64> = (0..4).map(|i| (utc(2026, 11, 19, 23, 0) + i * DAY_MS) as f64).collect();
        let used = log.stats_at(now, 3, -180, Some(&good));
        assert_eq!(per_day(&used), [("2026-11-20", 1), ("2026-11-21", 1), ("2026-11-22", 1)]);

        let with = |f: &dyn Fn(&mut Vec<f64>)| {
            let mut v = good.clone();
            f(&mut v);
            v
        };
        let hour = HOUR_MS as f64;
        let bad = [
            with(&|v| {
                v.pop();
            }),
            with(&|v| v.push(v[3] + 24.0 * hour)),
            with(&|v| v[1] = v[0] + 12.0 * hour),
            with(&|v| v[3] = v[2] + 48.0 * hour),
            with(&|v| v[3] = v[2] + 26.0 * hour + 1.0),
            with(&|v| v[1] = v[0] + 22.0 * hour - 1.0),
            with(&|v| v.reverse()),
            with(&|v| v[2] = f64::NAN),
            with(&|v| v[3] = f64::INFINITY),
            with(&|v| v[0] += 0.5),
            with(&|v| v.iter_mut().for_each(|x| *x += 1e16)),
            Vec::new(),
        ];
        let expected = serde_json::to_value(&fallback).unwrap();
        for starts in &bad {
            let s = log.stats_at(now, 3, -180, Some(starts));
            assert_eq!(serde_json::to_value(&s).unwrap(), expected, "{starts:?}");
        }
        // Boundaries for another number of days are not these days' boundaries.
        assert_eq!(per_day(&log.stats_at(now, 2, -180, Some(&good))), per_day(&log.stats_at(now, 2, -180, None)));
        // Days of exactly 22 and 26 hours are accepted (both ends included).
        let edge = [0.0, 22.0 * hour, 48.0 * hour];
        assert_eq!(local_midnights(&edge, 2), Some(vec![0, 22 * HOUR_MS, 48 * HOUR_MS]));
        let _ = std::fs::remove_dir_all(dir);
    }

    /// C-22 / C-24: the engine's level where a rule changed it, and the
    /// findings' category ids, are kept beside what was decided — and only
    /// when there is something to say. Lines written before still read.
    #[test]
    fn the_engine_level_and_finding_ids_are_kept_beside_the_decision() {
        assert_eq!(engine_level(Level::High, Level::Low).as_deref(), Some("high"));
        assert_eq!(engine_level(Level::Critical, Level::High).as_deref(), Some("critical"));
        assert_eq!(engine_level(Level::Medium, Level::Medium), None);
        let dir = tmp("engine");
        let log = Log::new(&dir);
        let mut lowered = entry(1, "low", "deny", "user", "git push --force origin main");
        lowered.engine_level = engine_level(Level::High, Level::Low);
        lowered.labels = vec!["Zorla push".into()];
        lowered.categories = vec!["force_push".into()];
        log.append(lowered, 10).unwrap();
        log.append(entry(2, "low", "allow", "user", "npm test"), 10).unwrap();
        // A line from before: no engineLevel, no categories.
        std::fs::OpenOptions::new()
            .append(true)
            .open(log.current())
            .unwrap()
            .write_all(b"{\"ts\":3,\"id\":\"old\",\"level\":\"high\",\"labels\":[\"Eski etiket\"],\"decision\":\"deny\",\"by\":\"user\"}\n")
            .unwrap();
        let text = std::fs::read_to_string(log.current()).unwrap();
        let lines: Vec<serde_json::Value> = text.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(lines[0]["engineLevel"], "high");
        assert_eq!(lines[0]["categories"], serde_json::json!(["force_push"]));
        assert!(lines[1].get("engineLevel").is_none() && lines[1].get("categories").is_none(), "{}", lines[1]);
        let all = log.all();
        assert_eq!(all.len(), 3);
        assert_eq!((all[2].engine_level.as_deref(), all[2].categories.len()), (None, 0));
        // The settings window gets them as `engineLevel` and `categories`.
        let sent = serde_json::to_value(&log.query(&Filter::default()).entries[2]).unwrap();
        assert_eq!((sent["engineLevel"].as_str(), sent["categories"][0].as_str()), (Some("high"), Some("force_push")));
        // The export: engine_level last, empty where no rule changed the level.
        let csv = to_csv_by(&all, ',', |_| 0);
        let rows: Vec<&str> = csv.lines().skip(1).collect();
        assert!(rows[0].ends_with(",\"high\""), "{}", rows[0]);
        assert!(rows[1].ends_with(",\"\""), "{}", rows[1]);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// C-24: findings with a category read in the current language in the
    /// statistics and the search; older entries keep their recorded text.
    #[test]
    fn findings_with_a_category_read_in_the_current_language() {
        let now_label = current_labels()["recursive_delete"];
        let dir = tmp("labels-now");
        let log = Log::new(&dir);
        let now = now_ms();
        let mut kept = entry(now - 2000, "high", "deny", "user", "rm -rf build");
        kept.labels = vec!["Recorded in another language".into(), "Recorded twice".into()];
        kept.categories = vec!["recursive_delete".into(), "recursive_delete".into()];
        log.append(kept, 10).unwrap();
        let mut old = entry(now - 1000, "high", "deny", "user", "rm -rf dist");
        old.labels = vec!["Old style label".into()];
        log.append(old, 10).unwrap();
        let mut unknown = entry(now - 500, "low", "allow", "user", "ls");
        unknown.labels = vec!["From a newer version".into()];
        unknown.categories = vec!["not_a_category_yet".into()];
        log.append(unknown, 10).unwrap();
        let top = log.stats(7, 0, None).top_labels;
        assert!(top.contains(&(now_label.to_string(), 1)), "counted once per entry: {top:?}");
        assert!(top.contains(&("Old style label".to_string(), 1)), "{top:?}");
        assert!(top.contains(&("From a newer version".to_string(), 1)), "an unknown id keeps its text: {top:?}");
        assert!(!top.iter().any(|(l, _)| l.starts_with("Recorded")), "{top:?}");
        // Searching by today's label finds the entry recorded in the other language…
        let word = now_label.split_whitespace().max_by_key(|w| w.chars().count()).unwrap();
        let found = log.query(&Filter { text: word.into(), ..Filter::default() });
        assert!(found.entries.iter().any(|e| e.target == "rm -rf build"), "{word}: {found:?}");
        // …and its recorded text still finds it too.
        assert_eq!(log.query(&Filter { text: "recorded in another".into(), ..Filter::default() }).total, 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// redaction-history#3: a `,` file opened with `;` (or the other way
    /// round), or a reader that splits at line breaks and ignores the quotes,
    /// meets no cell that starts like a formula.
    #[test]
    fn a_reader_with_the_other_separator_meets_no_formula() {
        let hostile = "echo \"a;=WEBSERVICE(CHAR(104)&A2);b\",x,@SUM(1);+2;-3\n=4,\"=5\";\"+6\"\t-7";
        let mut e = entry(0, "high", "deny", "user", hostile);
        e.message = "=HYPERLINK(\"x\");@x,+y".into();
        for (sep, other) in [(',', ';'), (';', ',')] {
            let csv = to_csv_by(std::slice::from_ref(&e), sep, |_| 0);
            for line in csv.trim_start_matches('\u{FEFF}').lines().skip(1) {
                for piece in line.split(other).chain(line.split(sep)) {
                    let bare = piece.trim_start_matches('"');
                    assert!(!bare.starts_with(['=', '+', '-', '@', '\t']), "{sep:?} read with {other:?}: {piece:?}");
                }
            }
        }
        // What a spreadsheet that honours the quotes shows: the text, defused.
        assert_eq!(cell("a,-b; c;=d"), "\"a,'-b; c;'=d\"");
        assert_eq!(cell("x,\"=y\""), "\"x,\"\"'=y\"\"\"");
        assert_eq!(cell("plain, text; and more"), "\"plain, text; and more\"");
    }

    /// redaction-history#9: every row's time is local time as it was at that
    /// moment, not by today's offset.
    #[test]
    fn each_rows_time_is_local_time_as_it_was_then() {
        // Berlin (getTimezoneOffset -120 in summer time, -60 in winter time),
        // exported in November.
        let summer = utc(2026, 3, 29, 1, 0) as u64..utc(2026, 10, 25, 1, 0) as u64;
        let berlin = |ts: u64| if summer.contains(&ts) { -120 } else { -60 };
        let rows = [
            entry(utc(2026, 10, 20, 12, 0) as u64, "low", "allow", "user", "a"),
            entry(utc(2026, 10, 23, 22, 30) as u64, "low", "allow", "user", "b"),
            entry(utc(2026, 11, 22, 9, 0) as u64, "low", "allow", "user", "c"),
        ];
        let csv = to_csv_by(&rows, ',', berlin);
        for want in ["\"2026-10-20 14:00:00\"", "\"2026-10-24 00:30:00\"", "\"2026-11-22 10:00:00\""] {
            assert!(csv.contains(want), "{want} in {csv}");
        }
        // The system answers for any moment, with a plausible offset (Windows
        // from its dynamic time zone, Linux and macOS from localtime_r).
        for ts in [0, utc(2026, 7, 1, 12, 0) as u64, now_ms()] {
            let east = crate::sys::utc_offset_min_at(ts).expect("the system knows its time zone");
            assert!((-14 * 60..=14 * 60).contains(&east), "{east}");
        }
    }

    /// redaction-history#8: a history emptied or deleted by hand and then
    /// grown past what was read before is read again, not appended to.
    #[test]
    fn a_history_replaced_and_grown_again_is_read_again() {
        let dir = tmp("regrow");
        let log = Log::new(&dir);
        let targets = |log: &Log| -> Vec<String> {
            log.query(&Filter { limit: 50, ..Filter::default() }).entries.into_iter().map(|e| e.target).collect()
        };
        for i in 0..3 {
            log.append(entry(i, "low", "allow", "user", &format!("old{i}")), 10).unwrap();
        }
        assert_eq!(targets(&log), ["old2", "old1", "old0"]);
        // Emptied in place (the same file), then more than before.
        std::fs::write(log.current(), b"").unwrap();
        for i in 10..15 {
            log.append(entry(i, "low", "allow", "user", &format!("new{i}")), 10).unwrap();
        }
        assert_eq!(targets(&log), ["new14", "new13", "new12", "new11", "new10"]);
        // Deleted and written anew.
        std::fs::remove_file(log.current()).unwrap();
        for i in 20..27 {
            log.append(entry(i, "low", "allow", "user", &format!("again{i}")), 10).unwrap();
        }
        assert_eq!(targets(&log).len(), 7);
        assert_eq!(targets(&log)[0], "again26");
        // Plain appends are still read from where the last read stopped.
        log.append(entry(30, "low", "allow", "user", "appended"), 10).unwrap();
        assert_eq!(targets(&log)[0], "appended");
        assert_eq!(log.cache.lock().unwrap().read_to, std::fs::metadata(log.current()).unwrap().len());
        let _ = std::fs::remove_dir_all(dir);
    }

    /// redaction-history#10: closing the settings window lets the parsed
    /// history go.
    #[test]
    fn forgetting_lets_the_parsed_history_go() {
        let dir = tmp("forget");
        let log = Log::new(&dir);
        log.append(entry(1, "low", "allow", "user", "x"), 10).unwrap();
        assert_eq!(log.query(&Filter::default()).total, 1);
        assert_eq!(log.cache.lock().unwrap().entries.len(), 1);
        log.forget();
        assert!(log.cache.lock().unwrap().entries.is_empty());
        assert_eq!(log.query(&Filter::default()).total, 1, "read again when asked");
        let _ = std::fs::remove_dir_all(dir);
    }

    /// redaction-history#5: a folder of the user's whose mode cannot be changed
    /// (here pinned with `chattr +a`) still gets the decision, and the log says
    /// why it is not private; somebody else's folder is still refused. Needs
    /// the right to pin attributes (root here); skipped without it.
    #[cfg(target_os = "linux")]
    #[test]
    fn a_folder_whose_mode_cannot_change_still_gets_the_decision() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tmp("pinned");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o777)).unwrap();
        let pinned = std::process::Command::new("chattr").arg("+a").arg(&dir).status().is_ok_and(|s| s.success());
        if !pinned {
            let _ = std::fs::remove_dir_all(dir);
            return;
        }
        let log = Log::new(&dir);
        let written = log.append(entry(1, "high", "deny", "user", "rm -rf /"), 10);
        let notes = crate::settings::take_loose();
        let _ = std::process::Command::new("chattr").arg("-a").arg(&dir).status();
        written.unwrap();
        assert_eq!(log.all().len(), 1, "the decision is on record");
        assert!(notes.iter().any(|n| n.contains(&dir.display().to_string())), "{notes:?}");
        assert_eq!(
            std::fs::metadata(log.current()).unwrap().permissions().mode() & 0o777,
            0o600,
            "the file is private"
        );
        // Somebody else's folder (only root can make one here).
        if unsafe { libc::geteuid() } == 0 {
            let theirs = tmp("theirs");
            std::fs::create_dir_all(&theirs).unwrap();
            std::fs::set_permissions(&theirs, std::fs::Permissions::from_mode(0o777)).unwrap();
            std::os::unix::fs::chown(&theirs, Some(65534), Some(65534)).unwrap();
            let pinned =
                std::process::Command::new("chattr").arg("+a").arg(&theirs).status().is_ok_and(|s| s.success());
            let refused = Log::new(&theirs).append(entry(2, "low", "allow", "user", "x"), 10);
            let _ = std::process::Command::new("chattr").arg("-a").arg(&theirs).status();
            if pinned {
                assert!(refused.is_err(), "another account's folder is not written into");
            }
            let _ = std::fs::remove_dir_all(theirs);
        }
        let _ = std::fs::remove_dir_all(dir);
    }
}
