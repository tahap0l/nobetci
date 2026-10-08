// History of every permission decision, as JSON lines in
// %LOCALAPPDATA%\Nobetci\audit.jsonl (rolling over to audit.1.jsonl).
//
// One line per request: what was asked, how risky it looked, what happened and
// who decided — a person, a rule, a trusted project, a session grant, or nobody
// (timed out / handed to the terminal). Nothing leaves the machine.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// Longest target kept per line; the card shows more, the history needs less.
const MAX_TARGET: usize = 4000;

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
    /// user, hotkey, rule, trusted, session, timeout, terminal, paused, busy.
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

pub struct Log {
    dir: PathBuf,
}

impl Log {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    pub fn current(&self) -> PathBuf {
        self.dir.join("audit.jsonl")
    }

    fn previous(&self) -> PathBuf {
        self.dir.join("audit.1.jsonl")
    }

    pub fn append(&self, entry: Entry, max_mb: u32) -> std::io::Result<()> {
        let _guard = WRITE_LOCK.lock().unwrap();
        std::fs::create_dir_all(&self.dir)?;
        let path = self.current();
        let limit = u64::from(max_mb.max(1)) * 1024 * 1024;
        if std::fs::metadata(&path).map(|m| m.len() > limit).unwrap_or(false) {
            let _ = std::fs::remove_file(self.previous());
            std::fs::rename(&path, self.previous())?;
        }
        let mut line = serde_json::to_string(&entry.capped())?;
        line.push('\n');
        std::fs::OpenOptions::new().create(true).append(true).open(path)?.write_all(line.as_bytes())
    }

    /// Everything on disk, oldest first. A damaged line is skipped, not fatal.
    pub fn all(&self) -> Vec<Entry> {
        let mut out = Vec::new();
        for path in [self.previous(), self.current()] {
            let Ok(text) = std::fs::read_to_string(&path) else { continue };
            out.extend(text.lines().filter_map(|l| serde_json::from_str::<Entry>(l).ok()));
        }
        out
    }

    pub fn query(&self, f: &Filter) -> Page {
        let limit = if f.limit == 0 { 200 } else { f.limit.min(2000) };
        self.query_up_to(f, limit)
    }

    /// Every project name in the history, most frequent first.
    pub fn projects(&self) -> Vec<(String, usize)> {
        let mut counts: std::collections::HashMap<String, usize> = Default::default();
        for e in self.all() {
            if !e.project.is_empty() {
                *counts.entry(e.project).or_default() += 1;
            }
        }
        let mut v: Vec<(String, usize)> = counts.into_iter().collect();
        v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        v
    }

    /// Like `query`, with an explicit cap — exports take everything that matches.
    pub fn query_up_to(&self, f: &Filter, limit: usize) -> Page {
        let text = f.text.trim().to_lowercase();
        let project = f.project.trim().to_lowercase();
        let mut hits: Vec<Entry> = self
            .all()
            .into_iter()
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
        hits.reverse();
        let total = hits.len();
        let entries = hits.into_iter().skip(f.offset).take(limit).collect();
        Page { entries, total }
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

        for e in self.all() {
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
            if matches!(e.by.as_str(), "user" | "hotkey") {
                waits.push(e.ms);
            }
            *projects.entry(e.project.clone()).or_default() += 1;
            *tools.entry(e.tool.clone()).or_default() += 1;
            for l in &e.labels {
                *labels.entry(l.clone()).or_default() += 1;
            }
        }
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
        let _guard = WRITE_LOCK.lock().unwrap();
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

/// One CSV cell. Quoted always; a cell that a spreadsheet would read as a formula
/// is defused with a leading apostrophe — the history is full of text a hostile
/// prompt could have chosen.
fn cell(s: &str) -> String {
    let risky = s.starts_with(['=', '+', '-', '@', '\t', '\r']);
    let body = s.replace('"', "\"\"");
    if risky {
        format!("\"'{body}\"")
    } else {
        format!("\"{body}\"")
    }
}

pub fn to_csv(entries: &[Entry], tz_offset_min: i32) -> String {
    let mut out = String::from(
        "\u{FEFF}zaman,proje,oturum,araç,tür,risk,karar,karar_veren,kural,hedef,bulgular,mesaj,süre_ms\r\n",
    );
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
        out.push_str(&row.iter().map(|c| cell(c)).collect::<Vec<_>>().join(","));
        out.push_str("\r\n");
    }
    out
}

pub fn write_export(path: &Path, entries: &[Entry], format: &str, tz_offset_min: i32) -> std::io::Result<()> {
    let body = if format == "json" { serde_json::to_string_pretty(entries)? } else { to_csv(entries, tz_offset_min) };
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
    fn csv_is_quoted_and_formula_safe() {
        let e = entry(0, "high", "deny", "user", "=HYPERLINK(\"http://x\")");
        let csv = to_csv(&[e], 0);
        assert!(csv.starts_with('\u{FEFF}'));
        assert!(csv.contains("\"'=HYPERLINK(\"\"http://x\"\")\""));
        assert!(csv.contains("1970-01-01 00:00:00"));
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
