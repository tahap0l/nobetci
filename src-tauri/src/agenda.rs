// A small agenda for the island: things to do on a day, optionally at a time.
//
// Kept in `agenda.json` next to the settings and written like them: a file only
// the user can read (0600 in a 0700 folder on Linux and macOS), replaced in one
// step through a temporary file. An item with a time gets a reminder: a desktop
// notification (unless Nöbetçi is quiet) and an `agenda-due` event the island
// reacts to. The reminder thread wakes twice a minute and does nothing else.
//
// The file is the user's, and a hand edit can break it. That never costs the
// rest of it: a byte-order mark is skipped, every entry is read on its own (one
// that cannot be used is left out, the others stay), and a file that could not
// be kept whole is copied aside as `agenda.json.unreadable-<stamp>` before
// anything is saved over it. A file that cannot be read at all is never written
// over: changes are refused until it can be read again.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

use crate::i18n::pick;
use crate::settings;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub text: String,
    /// "YYYY-MM-DD", local.
    pub date: String,
    /// "HH:MM", local, or none for a whole-day item.
    #[serde(default)]
    pub time: Option<String>,
    #[serde(default)]
    pub done: bool,
}

const MAX_ITEMS: usize = 300;
const MAX_TEXT: usize = 200;
/// Finished items are dropped this many days after their date.
const KEEP_DONE_DAYS: i64 = 30;
/// What `agenda_put` answers when there is no room left (C-10).
const FULL: &str = "agenda_full";

fn path() -> PathBuf {
    settings::config_dir().join("agenda.json")
}

fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && s.split('-').all(|p| p.bytes().all(|c| c.is_ascii_digit()))
        && (1..=12).contains(&s[5..7].parse::<u8>().unwrap_or(0))
        && (1..=31).contains(&s[8..10].parse::<u8>().unwrap_or(0))
}

fn is_time(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 5
        && b[2] == b':'
        && s[..2].parse::<u8>().is_ok_and(|h| h < 24)
        && s[3..].parse::<u8>().is_ok_and(|m| m < 60)
        && b[..2].iter().chain(&b[3..]).all(u8::is_ascii_digit)
}

fn is_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 40 && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
}

impl Item {
    fn sanitized(mut self) -> Option<Item> {
        self.text = self.text.trim().chars().filter(|c| !c.is_control()).take(MAX_TEXT).collect();
        if self.text.is_empty() || !is_id(&self.id) || !is_date(&self.date) {
            return None;
        }
        if self.time.as_deref().is_some_and(|t| !is_time(t)) {
            self.time = None;
        }
        Some(self)
    }

    fn key(&self) -> (String, String) {
        (self.date.clone(), self.time.clone().unwrap_or_default())
    }
}

// ── Reading the file ─────────────────────────────────────────────────────────

/// What reading agenda.json found.
#[derive(Debug, Default)]
struct Loaded {
    items: Vec<Item>,
    problem: Option<Problem>,
}

#[derive(Debug, PartialEq)]
enum Problem {
    /// The file is there but could not be read: a lock, permissions, a failing disk.
    Unread(String),
    /// It was read, but not all of it could be used as it is: what was wrong,
    /// and the file's bytes as they were.
    Damaged { why: String, bytes: Vec<u8> },
}

/// Reads the agenda at `path`: empty when there is no file yet (or an empty one:
/// there is nothing in it to lose).
fn load(path: &Path) -> Loaded {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Loaded::default(),
        Err(err) => return Loaded { items: Vec::new(), problem: Some(Problem::Unread(err.to_string())) },
    };
    // Notepad and PowerShell 5 save UTF-8 with a byte-order mark, which serde_json refuses.
    let text = settings::strip_bom(&bytes);
    if text.iter().all(u8::is_ascii_whitespace) {
        return Loaded::default();
    }
    let (items, why) = match serde_json::from_slice::<Value>(text) {
        Ok(Value::Array(entries)) => {
            let (items, notes) = read_entries(&entries);
            (items, (!notes.is_empty()).then(|| notes.join("; ")))
        }
        Ok(_) => (Vec::new(), Some("not a list of items".to_string())),
        Err(err) => (Vec::new(), Some(err.to_string())),
    };
    let problem = why.map(|why| Problem::Damaged { why, bytes });
    Loaded { items, problem }
}

/// Every entry that can be used, each on its own, and a note for each one that
/// was left out or had to be changed to fit ("item 3: …").
fn read_entries(entries: &[Value]) -> (Vec<Item>, Vec<String>) {
    let mut items: Vec<Item> = Vec::with_capacity(entries.len());
    let mut notes = Vec::new();
    let mut ids: HashSet<String> = HashSet::new();
    for (n, entry) in entries.iter().enumerate() {
        let n = n + 1;
        // Field by field, so one value of the wrong type ("done": null, a time
        // written as a number) costs that value, not the entry.
        let field = |key: &str| entry.get(key).and_then(Value::as_str).map(str::to_string);
        let (Some(text), Some(date)) = (field("text"), field("date")) else {
            notes.push(format!("item {n}: left out (no text or date)"));
            continue;
        };
        let mut item = Item {
            id: field("id").unwrap_or_default(),
            text,
            date,
            time: field("time"),
            done: entry.get("done").and_then(Value::as_bool).unwrap_or(false),
        };
        // A missing, odd or repeated id gets a new one: ids are Nöbetçi's own
        // handles, and the entry itself is worth keeping.
        if !is_id(&item.id) || ids.contains(&item.id) {
            item.id = fresh_id(&ids, n);
        }
        let Some(item) = item.sanitized() else {
            notes.push(format!("item {n}: left out (empty text or a date that is not YYYY-MM-DD)"));
            continue;
        };
        if serde_json::from_value::<Item>(entry.clone()).ok().as_ref() != Some(&item) {
            notes.push(format!("item {n}: changed to fit"));
        }
        ids.insert(item.id.clone());
        items.push(item);
    }
    (items, notes)
}

/// An id no other entry has, for entry `n`.
fn fresh_id(taken: &HashSet<String>, n: usize) -> String {
    (0..)
        .map(|k| if k == 0 { format!("restored-{n}") } else { format!("restored-{n}-{k}") })
        .find(|id| !taken.contains(id))
        .unwrap_or_default()
}

/// Copies `bytes` (agenda.json as it was) beside it as
/// agenda.json.unreadable-<stamp>, readable by the user alone. A copy of the
/// same bytes made earlier is used again, so starting with the same broken file
/// does not pile up copies.
fn keep_aside(path: &Path, bytes: &[u8]) -> std::io::Result<PathBuf> {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let prefix = format!("{name}.unreadable-");
    if let Some(entries) = path.parent().and_then(|dir| std::fs::read_dir(dir).ok()) {
        let earlier = entries.flatten().map(|e| e.path()).find(|p| {
            p.file_name().is_some_and(|n| n.to_string_lossy().starts_with(&prefix))
                && std::fs::metadata(p).is_ok_and(|m| m.len() == bytes.len() as u64)
                && std::fs::read(p).is_ok_and(|have| have == bytes)
        });
        if let Some(earlier) = earlier {
            return Ok(earlier);
        }
    }
    settings::write_new_private(&path.with_file_name(format!("{prefix}{}", crate::sys::local_time().compact())), bytes)
}

// ── Writing the file ─────────────────────────────────────────────────────────

/// Writes the agenda to a temporary file beside agenda.json and renames it into
/// place, so a crash or a full disk mid-write leaves the old file whole. A link
/// stays a link: the file it names is replaced.
fn save_to(path: &Path, items: &[Item]) -> std::io::Result<()> {
    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
        settings::private_dir(dir)?;
    }
    let mut json = serde_json::to_vec_pretty(items).map_err(std::io::Error::other)?;
    json.push(b'\n');
    let target = settings::real_path(path);
    let temp = settings::temp_beside(&target, "tmp");
    let written = settings::write_private(&temp, &json).and_then(|()| std::fs::rename(&temp, &target));
    if written.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    written
}

/// The agenda in memory, and what has to happen before agenda.json may be replaced.
struct Agenda {
    items: Vec<Item>,
    guard: Guard,
}

#[derive(Debug, PartialEq)]
enum Guard {
    /// Nothing: the file was read whole, there was none, or a copy of it is kept.
    Clear,
    /// The file could not be read. It is read again before each use, and
    /// nothing is saved over it until it can be.
    Unread,
    /// Not all of the file could be used and no copy of it could be made yet:
    /// these bytes are copied aside before anything replaces it.
    Copy(Vec<u8>),
}

impl Agenda {
    /// The agenda from what `load` found at `path`. A damaged file is copied
    /// aside at once. Also returns what to write to the log.
    fn from_loaded(path: &Path, loaded: Loaded) -> (Agenda, Option<String>) {
        let Loaded { items, problem } = loaded;
        match problem {
            None => (Agenda { items, guard: Guard::Clear }, None),
            Some(Problem::Unread(why)) => (
                Agenda { items, guard: Guard::Unread },
                Some(format!(
                    "agenda: agenda.json could not be read ({why}); nothing is saved over it until it can be"
                )),
            ),
            Some(Problem::Damaged { why, bytes }) => {
                let kept = keep_aside(path, &bytes);
                let note = format!(
                    "agenda: agenda.json was not read whole ({why}); kept {} item(s); {}",
                    items.len(),
                    match &kept {
                        Ok(copy) => format!("the file as it was is kept as {}", copy.display()),
                        Err(err) =>
                            format!("no copy of it could be made ({err}); nothing is saved over it until one is"),
                    }
                );
                let guard = if kept.is_ok() { Guard::Clear } else { Guard::Copy(bytes) };
                (Agenda { items, guard }, Some(note))
            }
        }
    }

    /// Saves `next` over the file at `path` and only then makes it the agenda,
    /// so a change that could not be saved leaves the list as it was (C-10).
    /// Lines for the log go to `log`.
    fn apply(&mut self, path: &Path, next: Vec<Item>, log: &mut Vec<String>) -> Result<(), String> {
        match &self.guard {
            Guard::Clear => {}
            Guard::Unread => {
                return Err(pick(
                    "Nöbetçi couldn't read agenda.json, so it doesn't save over it. Check the file, then try again.",
                    "Nöbetçi agenda.json dosyasını okuyamadı, bu yüzden üzerine kaydetmiyor. Dosyayı kontrol edip yeniden dene.",
                )
                .to_string());
            }
            Guard::Copy(bytes) => match keep_aside(path, bytes) {
                Ok(copy) => {
                    log.push(format!("agenda: the damaged agenda.json is kept as {}", copy.display()));
                    self.guard = Guard::Clear;
                }
                Err(err) => {
                    log.push(format!("agenda: still no copy of the damaged agenda.json ({err}); not saving"));
                    return Err(pick(
                        "Couldn't keep a copy of the damaged agenda.json, so nothing was saved over it.",
                        "Bozuk agenda.json dosyasının kopyası alınamadı, bu yüzden üzerine kaydedilmedi.",
                    )
                    .to_string());
                }
            },
        }
        save_to(path, &next).map_err(|err| {
            log.push(format!("agenda: save failed: {err}"));
            pick("Couldn't save the agenda.", "Ajanda kaydedilemedi.").to_string()
        })?;
        self.items = next;
        Ok(())
    }
}

fn open(path: &Path) -> Agenda {
    let (agenda, note) = Agenda::from_loaded(path, load(path));
    if let Some(note) = note {
        crate::log::line(note);
    }
    agenda
}

/// The agenda, read from agenda.json the first time it is needed.
fn agenda() -> MutexGuard<'static, Agenda> {
    static AGENDA: OnceLock<Mutex<Agenda>> = OnceLock::new();
    let mut agenda = AGENDA.get_or_init(|| Mutex::new(open(&path()))).lock().unwrap_or_else(PoisonError::into_inner);
    if agenda.guard == Guard::Unread {
        // A lock may have been let go, or a network home may answer now.
        let loaded = load(&path());
        if !matches!(loaded.problem, Some(Problem::Unread(_))) {
            let (fresh, note) = Agenda::from_loaded(&path(), loaded);
            crate::log::line(note.unwrap_or_else(|| "agenda: agenda.json can be read again".into()));
            *agenda = fresh;
        }
    }
    agenda
}

// ── The list ─────────────────────────────────────────────────────────────────

/// Days since 1970-01-01 for a "YYYY-MM-DD" date (proleptic Gregorian).
fn day_number(date: &str) -> i64 {
    let y: i64 = date[..4].parse().unwrap_or(1970);
    let m: i64 = date[5..7].parse().unwrap_or(1);
    let d: i64 = date[8..10].parse().unwrap_or(1);
    let (y, m) = if m <= 2 { (y - 1, m + 9) } else { (y, m - 3) };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * m + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn today() -> String {
    crate::sys::local_time().stamp()[..10].to_string()
}

/// Drops finished items well in the past and keeps the list in order.
fn tidy(items: &mut Vec<Item>, today: &str) {
    let now = day_number(today);
    items.retain(|i| !i.done || now - day_number(&i.date) <= KEEP_DONE_DAYS);
    items.sort_by_key(Item::key);
}

/// The list with `item` added, or put in place of the one with its id. When
/// that leaves no room, the oldest finished item makes room; when none is
/// finished, the put is refused with `agenda_full`. Nothing else is dropped,
/// least of all the item being put.
fn with_item(items: &[Item], item: Item, today: &str) -> Result<Vec<Item>, String> {
    let id = item.id.clone();
    let mut next = items.to_vec();
    match next.iter_mut().find(|i| i.id == id) {
        Some(existing) => *existing = item,
        None => next.push(item),
    }
    tidy(&mut next, today);
    // A file written by hand may hold more than MAX_ITEMS: it keeps them, but
    // does not grow.
    if next.len() > MAX_ITEMS.max(items.len()) {
        // In date order, the first finished item is the oldest.
        let oldest_done = next.iter().position(|i| i.done && i.id != id).ok_or_else(|| FULL.to_string())?;
        next.remove(oldest_done);
    }
    Ok(next)
}

#[tauri::command(async)]
pub fn agenda_list() -> Vec<Item> {
    let mut items = agenda().items.clone();
    tidy(&mut items, &today());
    items
}

/// Adds an item, or replaces the one with the same id.
#[tauri::command(async)]
pub fn agenda_put(app: AppHandle, item: Item) -> Result<Vec<Item>, String> {
    let item = item.sanitized().ok_or_else(|| pick("That item isn't valid.", "Bu kayıt geçerli değil.").to_string())?;
    let mut agenda = agenda();
    let next = with_item(&agenda.items, item, &today())?;
    commit(&app, &mut agenda, next)
}

#[tauri::command(async)]
pub fn agenda_delete(app: AppHandle, id: String) -> Result<Vec<Item>, String> {
    let mut agenda = agenda();
    let next = agenda.items.iter().filter(|i| i.id != id).cloned().collect();
    commit(&app, &mut agenda, next)
}

fn commit(app: &AppHandle, agenda: &mut Agenda, next: Vec<Item>) -> Result<Vec<Item>, String> {
    let mut log = Vec::new();
    let applied = agenda.apply(&path(), next, &mut log);
    for line in log {
        crate::log::line(line);
    }
    applied?;
    let _ = app.emit("agenda-changed", &agenda.items);
    Ok(agenda.items.clone())
}

// ── Reminders ────────────────────────────────────────────────────────────────

/// Which reminders are due, minute by minute. Each is given once: a minute the
/// clock passes twice (the hour repeated when daylight saving time ends, or a
/// clock set back) does not remind again.
struct Reminders {
    /// The last minute looked at, "YYYY-MM-DD HH:MM" (local).
    last: String,
    /// Reminders given since yesterday: (id, "YYYY-MM-DD HH:MM").
    given: HashSet<(String, String)>,
}

impl Reminders {
    fn new(now: &str) -> Reminders {
        Reminders { last: now.to_string(), given: HashSet::new() }
    }

    /// The items to remind of at minute `now`: those due since the minute last
    /// looked at, that one included (an item added during its own minute is
    /// not missed), each once. A clock that jumps ahead reminds of what it
    /// skipped, like the hour lost when daylight saving time starts.
    fn step<'a>(&mut self, items: &'a [Item], now: &str) -> Vec<&'a Item> {
        if now == self.last {
            return Vec::new();
        }
        let from = std::mem::replace(&mut self.last, now.to_string());
        let mut due = Vec::new();
        for item in items.iter().filter(|i| !i.done) {
            let Some(time) = item.time.as_deref() else { continue };
            let at = format!("{} {time}", item.date);
            if at.as_str() >= from.as_str() && at.as_str() <= now && self.given.insert((item.id.clone(), at)) {
                due.push(item);
            }
        }
        let yesterday = day_number(&now[..10]) - 1;
        self.given.retain(|(_, at)| day_number(&at[..10]) >= yesterday);
        due
    }
}

/// Wakes every 30 seconds and reminds of items whose time has come. Times that
/// passed while the app was closed are not reminded at start.
pub fn spawn_reminders(app: AppHandle) {
    std::thread::spawn(move || {
        let minute = || crate::sys::local_time().stamp()[..16].to_string();
        let mut reminders = Reminders::new(&minute());
        loop {
            std::thread::sleep(Duration::from_secs(30));
            let now = minute();
            if now == reminders.last {
                continue;
            }
            let items = agenda().items.clone();
            for item in reminders.step(&items, &now) {
                remind(&app, item);
            }
        }
    });
}

fn remind(app: &AppHandle, item: &Item) {
    let _ = app.emit("agenda-due", item);
    let s = crate::current(app);
    if crate::quiet::reason(&s).is_some() {
        return;
    }
    let title = format!("{} · {}", pick("Agenda", "Ajanda"), item.time.as_deref().unwrap_or(""));
    let body: String = crate::redact::redact(&item.text).chars().take(240).collect();
    // Shown as written where the notification server reads markup: "R&D" stays "R&D".
    #[cfg(target_os = "linux")]
    let body = if crate::sys::notifications_read_markup() { crate::sys::escape_markup(&body) } else { body };
    let _ = app.notification().builder().title(title).body(body).show();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, date: &str, time: Option<&str>, done: bool) -> Item {
        Item { id: id.into(), text: format!("item {id}"), date: date.into(), time: time.map(Into::into), done }
    }

    /// A folder of its own for one test, removed when dropped.
    struct Dir(PathBuf);

    impl Dir {
        fn new(name: &str) -> Dir {
            let dir = std::env::temp_dir().join(format!("nobetci-agenda-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            Dir(dir)
        }

        fn file(&self) -> PathBuf {
            self.0.join("agenda.json")
        }

        /// The copies kept beside agenda.json.
        fn copies(&self) -> Vec<PathBuf> {
            let mut found: Vec<PathBuf> = std::fs::read_dir(&self.0)
                .unwrap()
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.file_name().unwrap().to_string_lossy().starts_with("agenda.json.unreadable-"))
                .collect();
            found.sort();
            found
        }
    }

    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn ids(items: &[Item]) -> Vec<&str> {
        items.iter().map(|i| i.id.as_str()).collect()
    }

    #[test]
    fn dates_and_times_are_checked() {
        assert!(is_date("2026-11-15"));
        for bad in ["2026-13-01", "2026-1-15", "26-11-15", "2026/11/15", "2026-11-00", "abcd-ef-gh"] {
            assert!(!is_date(bad), "{bad}");
        }
        assert!(is_time("09:30") && is_time("23:59"));
        for bad in ["24:00", "9:30", "09:60", "0930", "ab:cd"] {
            assert!(!is_time(bad), "{bad}");
        }
    }

    #[test]
    fn bad_items_are_refused_or_cleaned() {
        assert!(item("", "2026-11-15", None, false).sanitized().is_none());
        assert!(item("a b", "2026-11-15", None, false).sanitized().is_none());
        let mut blank = item("x", "2026-11-15", None, false);
        blank.text = "   ".into();
        assert!(blank.sanitized().is_none());
        let odd_time = item("x", "2026-11-15", Some("99:99"), false).sanitized().unwrap();
        assert_eq!(odd_time.time, None);
        let mut long = item("x", "2026-11-15", None, false);
        long.text = "ş".repeat(500);
        assert_eq!(long.sanitized().unwrap().text.chars().count(), MAX_TEXT);
    }

    #[test]
    fn day_numbers_count_days() {
        assert_eq!(day_number("1970-01-01"), 0);
        assert_eq!(day_number("2026-03-01") - day_number("2026-02-28"), 1);
        assert_eq!(day_number("2024-03-01") - day_number("2024-02-28"), 2);
    }

    #[test]
    fn old_finished_items_go_and_the_rest_stay_in_order() {
        let mut items = vec![
            item("late", "2026-11-20", Some("18:00"), false),
            item("old-done", "2026-09-01", None, true),
            item("old-open", "2026-09-01", None, false),
            item("early", "2026-11-20", Some("08:00"), false),
        ];
        tidy(&mut items, "2026-11-15");
        assert_eq!(ids(&items), ["old-open", "early", "late"]);
    }

    // ── Reading (D8, Y-14) ───────────────────────────────────────────────────

    #[test]
    fn no_file_or_an_empty_one_is_an_empty_agenda() {
        let dir = Dir::new("empty");
        let missing = load(&dir.file());
        assert!(missing.items.is_empty() && missing.problem.is_none());
        std::fs::write(dir.file(), b"\xEF\xBB\xBF  \n").unwrap();
        let blank = load(&dir.file());
        assert!(blank.items.is_empty() && blank.problem.is_none());
    }

    #[test]
    fn a_file_the_app_wrote_reads_back_whole() {
        let dir = Dir::new("roundtrip");
        let items = vec![item("a", "2026-11-15", Some("09:30"), false), item("b", "2026-11-16", None, true)];
        save_to(&dir.file(), &items).unwrap();
        let loaded = load(&dir.file());
        assert_eq!(loaded.items, items);
        assert_eq!(loaded.problem, None);
    }

    #[test]
    fn a_byte_order_mark_and_one_bad_entry_cost_nothing_else() {
        let dir = Dir::new("bom");
        // PowerShell 5's `Set-Content -Encoding UTF8` writes a BOM; a hand edit left
        // one entry with "done": null and one with the time as a number.
        let mut file = b"\xEF\xBB\xBF".to_vec();
        file.extend_from_slice(
            br#"[
  {"id": "a", "text": "Dentist", "date": "2026-11-20", "time": "09:30", "done": false},
  {"id": "b", "text": "Call mum", "date": "2026-11-21", "time": null, "done": null},
  {"id": "c", "text": "Gym", "date": "2026-11-22", "time": 930},
  {"id": "d", "text": "", "date": "2026-11-22"},
  {"id": "e", "text": "No date"},
  42,
  {"id": "f", "text": "Review PR", "date": "2026-11-23", "time": "14:00", "done": true}
]"#,
        );
        std::fs::write(dir.file(), &file).unwrap();
        let loaded = load(&dir.file());
        assert_eq!(ids(&loaded.items), ["a", "b", "c", "f"]);
        assert_eq!(
            loaded.items[0],
            Item {
                id: "a".into(),
                text: "Dentist".into(),
                date: "2026-11-20".into(),
                time: Some("09:30".into()),
                done: false
            }
        );
        assert!(!loaded.items[1].done, "a null 'done' reads as not done");
        assert_eq!(loaded.items[2].time, None, "a time that is not HH:MM is dropped, the item stays");
        assert!(loaded.items[3].done);
        match loaded.problem {
            Some(Problem::Damaged { why, bytes }) => {
                assert_eq!(bytes, file, "the copy is of the file exactly as it was");
                for n in ["item 2", "item 3", "item 4", "item 5", "item 6"] {
                    assert!(why.contains(n), "{why}");
                }
                assert!(!why.contains("item 1:") && !why.contains("item 7"), "{why}");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn missing_and_repeated_ids_get_new_ones() {
        let entries: Vec<Value> = serde_json::from_str(
            r#"[{"text": "one", "date": "2026-11-20"},
                {"id": "x", "text": "two", "date": "2026-11-20"},
                {"id": "x", "text": "three", "date": "2026-11-20"},
                {"id": "not ok!", "text": "four", "date": "2026-11-20"}]"#,
        )
        .unwrap();
        let (items, notes) = read_entries(&entries);
        assert_eq!(items.iter().map(|i| i.text.as_str()).collect::<Vec<_>>(), ["one", "two", "three", "four"]);
        let unique: HashSet<&str> = items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(unique.len(), 4, "{items:?}");
        assert!(items.iter().all(|i| is_id(&i.id)));
        assert_eq!(items[1].id, "x");
        assert_eq!(notes.len(), 3, "{notes:?}");
    }

    #[test]
    fn a_file_that_is_not_a_list_is_kept_aside_before_anything_is_saved() {
        let dir = Dir::new("broken");
        std::fs::write(dir.file(), b"[{\"id\": \"a\", \"text\": \"half a file").unwrap();
        let (mut agenda, note) = Agenda::from_loaded(&dir.file(), load(&dir.file()));
        assert!(agenda.items.is_empty());
        assert_eq!(agenda.guard, Guard::Clear, "the copy is made at once");
        let copies = dir.copies();
        assert_eq!(copies.len(), 1);
        assert_eq!(std::fs::read(&copies[0]).unwrap(), b"[{\"id\": \"a\", \"text\": \"half a file");
        assert!(note.unwrap().contains(&copies[0].display().to_string()));

        // Starting again with the same broken file uses the same copy.
        let (_, again) = Agenda::from_loaded(&dir.file(), load(&dir.file()));
        assert_eq!(dir.copies(), copies);
        assert!(again.unwrap().contains(&copies[0].display().to_string()));

        // Now a change may be saved: the copy stays.
        let mut log = Vec::new();
        agenda.apply(&dir.file(), vec![item("n", "2026-11-20", None, false)], &mut log).unwrap();
        assert_eq!(ids(&load(&dir.file()).items), ["n"]);
        assert_eq!(dir.copies(), copies);
        assert!(log.is_empty(), "{log:?}");
    }

    #[test]
    fn a_file_that_cannot_be_read_is_never_written_over() {
        let dir = Dir::new("unread");
        // A folder where the file should be: reading it fails, and not with NotFound.
        std::fs::create_dir(dir.file()).unwrap();
        let loaded = load(&dir.file());
        assert!(matches!(loaded.problem, Some(Problem::Unread(_))), "{:?}", loaded.problem);
        let (mut agenda, note) = Agenda::from_loaded(&dir.file(), loaded);
        assert_eq!(agenda.guard, Guard::Unread);
        assert!(note.is_some());
        let mut log = Vec::new();
        let refused = agenda.apply(&dir.file(), vec![item("n", "2026-11-20", None, false)], &mut log);
        assert!(refused.is_err());
        assert!(agenda.items.is_empty(), "nothing changed in memory either");
        assert!(dir.file().is_dir(), "and nothing on disk");
        assert!(dir.copies().is_empty());
    }

    #[test]
    fn without_a_copy_nothing_is_saved_over_a_damaged_file() {
        // A folder that cannot be written to (it does not exist under a file).
        let dir = Dir::new("nocopy");
        std::fs::write(dir.0.join("blocker"), b"").unwrap();
        let path = dir.0.join("blocker").join("agenda.json");
        let loaded = Loaded {
            items: vec![item("a", "2026-11-20", None, false)],
            problem: Some(Problem::Damaged { why: "item 2: left out".into(), bytes: b"[...]".to_vec() }),
        };
        let (mut agenda, note) = Agenda::from_loaded(&path, loaded);
        assert_eq!(agenda.guard, Guard::Copy(b"[...]".to_vec()));
        assert!(note.unwrap().contains("no copy"));
        let mut log = Vec::new();
        let refused = agenda.apply(&path, vec![item("b", "2026-11-20", None, false)], &mut log);
        assert!(refused.is_err());
        assert_eq!(ids(&agenda.items), ["a"], "the list is as it was");
        assert_eq!(log.len(), 1, "{log:?}");
    }

    // ── Writing (R-22, C-10) ─────────────────────────────────────────────────

    #[test]
    fn a_failed_save_leaves_the_list_as_it_was() {
        let dir = Dir::new("failed");
        std::fs::write(dir.0.join("blocker"), b"").unwrap();
        let path = dir.0.join("blocker").join("agenda.json");
        let mut agenda = Agenda { items: vec![item("a", "2026-11-20", None, false)], guard: Guard::Clear };
        let next = with_item(&agenda.items, item("b", "2026-11-21", None, false), "2026-11-20").unwrap();
        let mut log = Vec::new();
        assert!(agenda.apply(&path, next, &mut log).is_err());
        assert_eq!(ids(&agenda.items), ["a"], "the new item is not kept in memory, so it is not reminded either");
        assert!(log[0].starts_with("agenda: save failed"), "{log:?}");
    }

    #[cfg(unix)]
    #[test]
    fn the_file_and_its_folder_are_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = Dir::new("private");
        let folder = dir.0.join("nobetci");
        std::fs::create_dir(&folder).unwrap();
        std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o755)).unwrap();
        let file = folder.join("agenda.json");
        std::fs::write(&file, b"[]").unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();
        save_to(&file, &[item("a", "2026-11-20", None, false)]).unwrap();
        assert_eq!(std::fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(std::fs::metadata(&folder).unwrap().permissions().mode() & 0o777, 0o700);
        let leftovers: Vec<_> = std::fs::read_dir(&folder).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(leftovers, ["agenda.json"], "no temporary file is left behind");

        // A copy of a damaged file is private too.
        let copy = keep_aside(&file, b"{").unwrap();
        assert_eq!(std::fs::metadata(copy).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_agenda_stays_a_link() {
        let dir = Dir::new("link");
        let real = dir.0.join("dotfiles-agenda.json");
        std::fs::write(&real, b"[]").unwrap();
        std::os::unix::fs::symlink(&real, dir.file()).unwrap();
        save_to(&dir.file(), &[item("a", "2026-11-20", None, false)]).unwrap();
        assert!(std::fs::symlink_metadata(dir.file()).unwrap().file_type().is_symlink());
        assert_eq!(ids(&load(&real).items), ["a"]);
    }

    #[test]
    fn a_full_agenda_refuses_new_items_instead_of_dropping_them() {
        let open: Vec<Item> =
            (0..MAX_ITEMS).map(|n| item(&format!("o{n}"), "2026-11-20", Some("12:00"), false)).collect();
        // The new item would sort first and used to be the one cut away.
        let early = item("early", "2026-11-01", None, false);
        assert_eq!(with_item(&open, early.clone(), "2026-11-15").unwrap_err(), FULL);
        // Changing an item that is there still works.
        let mut changed = open[5].clone();
        changed.done = true;
        let next = with_item(&open, changed, "2026-11-15").unwrap();
        assert_eq!(next.len(), MAX_ITEMS);
        assert!(next.iter().any(|i| i.id == "o5" && i.done));
        // A finished item makes room: the oldest one goes, open items stay.
        let mut with_done = open.clone();
        with_done[0] = item("done-late", "2026-11-25", None, true);
        with_done[1] = item("done-early", "2026-11-10", None, true);
        let next = with_item(&with_done, early, "2026-11-15").unwrap();
        assert_eq!(next.len(), MAX_ITEMS);
        assert!(next.iter().any(|i| i.id == "early"));
        assert!(!next.iter().any(|i| i.id == "done-early"));
        assert!(next.iter().any(|i| i.id == "done-late"));
        // Below the limit nothing is dropped.
        let few = vec![item("a", "2026-11-20", None, true)];
        assert_eq!(with_item(&few, item("b", "2026-11-01", None, false), "2026-11-15").unwrap().len(), 2);
    }

    #[test]
    fn a_hand_made_list_over_the_limit_keeps_its_items() {
        let big: Vec<Item> =
            (0..MAX_ITEMS + 20).map(|n| item(&format!("i{n}"), "2026-11-20", None, n % 2 == 0)).collect();
        let next = with_item(&big, item("new", "2026-11-21", None, false), "2026-11-15").unwrap();
        assert_eq!(next.len(), big.len(), "one finished item made room, no more");
        let toggled = with_item(&big, Item { done: false, ..big[0].clone() }, "2026-11-15").unwrap();
        assert_eq!(toggled.len(), big.len());
    }

    // ── Reminders (widgets#4) ────────────────────────────────────────────────

    fn reminded<'a>(r: &mut Reminders, items: &'a [Item], now: &str) -> Vec<&'a str> {
        r.step(items, now).into_iter().map(|i| i.id.as_str()).collect()
    }

    #[test]
    fn reminders_fire_once_in_their_minute() {
        let items = vec![
            item("a", "2026-11-15", Some("09:00"), false),
            item("b", "2026-11-15", Some("09:01"), true),
            item("c", "2026-11-15", None, false),
            item("d", "2026-11-15", Some("09:02"), false),
        ];
        let mut r = Reminders::new("2026-11-15 08:59");
        assert!(reminded(&mut r, &items, "2026-11-15 08:59").is_empty());
        assert_eq!(reminded(&mut r, &items, "2026-11-15 09:00"), ["a"]);
        assert!(reminded(&mut r, &items, "2026-11-15 09:00").is_empty());
        assert!(reminded(&mut r, &items, "2026-11-15 09:01").is_empty(), "a is not reminded again");
        assert_eq!(reminded(&mut r, &items, "2026-11-15 09:02"), ["d"]);
        assert!(reminded(&mut r, &items, "2026-11-15 09:03").is_empty());
    }

    #[test]
    fn the_hour_repeated_when_daylight_saving_time_ends_reminds_once() {
        // America/New_York, 2026-11-01: 01:00–01:59 comes twice (EDT, then EST).
        let items = vec![item("a", "2026-11-01", Some("01:30"), false), item("b", "2026-11-01", Some("02:00"), false)];
        let mut r = Reminders::new("2026-11-01 00:58");
        let mut fired = Vec::new();
        let first_pass = (59..60).map(|m| format!("00:{m:02}")).chain((0..60).map(|m| format!("01:{m:02}")));
        let second_pass = (0..60).map(|m| format!("01:{m:02}")).chain((0..3).map(|m| format!("02:{m:02}")));
        for clock in first_pass.chain(second_pass) {
            fired.extend(reminded(&mut r, &items, &format!("2026-11-01 {clock}")));
        }
        assert_eq!(fired, ["a", "b"]);
    }

    #[test]
    fn the_hour_skipped_when_daylight_saving_time_starts_still_reminds() {
        // 2026-03-08 in New York: 01:59 is followed by 03:00.
        let items = vec![item("a", "2026-03-08", Some("02:30"), false), item("b", "2026-03-08", Some("03:00"), false)];
        let mut r = Reminders::new("2026-03-08 01:59");
        assert_eq!(reminded(&mut r, &items, "2026-03-08 03:00"), ["a", "b"]);
        assert!(reminded(&mut r, &items, "2026-03-08 03:01").is_empty());
    }

    #[test]
    fn a_clock_set_back_does_not_repeat_reminders_but_new_ones_still_come() {
        let mut items = vec![item("a", "2026-11-15", Some("10:00"), false)];
        let mut r = Reminders::new("2026-11-15 09:59");
        assert_eq!(reminded(&mut r, &items, "2026-11-15 10:00"), ["a"]);
        assert!(reminded(&mut r, &items, "2026-11-15 10:01").is_empty());
        // The clock is set back ten minutes; an item is added for 09:55 meanwhile.
        assert!(reminded(&mut r, &items, "2026-11-15 09:51").is_empty());
        items.push(item("n", "2026-11-15", Some("09:55"), false));
        let mut fired = Vec::new();
        for m in 52..=59 {
            fired.extend(reminded(&mut r, &items, &format!("2026-11-15 09:{m}")));
        }
        fired.extend(reminded(&mut r, &items, "2026-11-15 10:00"));
        assert_eq!(fired, ["n"]);
    }

    #[test]
    fn an_item_added_during_its_minute_or_moved_later_is_reminded() {
        let mut items = vec![item("a", "2026-11-15", Some("14:00"), false)];
        let mut r = Reminders::new("2026-11-15 13:59");
        assert_eq!(reminded(&mut r, &items, "2026-11-15 14:00"), ["a"]);
        // Added at 14:00:40 for 14:00: the next look still finds it.
        items.push(item("late", "2026-11-15", Some("14:00"), false));
        assert_eq!(reminded(&mut r, &items, "2026-11-15 14:01"), ["late"]);
        // Moving "a" to a later time reminds again then.
        items[0].time = Some("14:05".into());
        let mut fired = Vec::new();
        for m in 2..=6 {
            fired.extend(reminded(&mut r, &items, &format!("2026-11-15 14:{m:02}")));
        }
        assert_eq!(fired, ["a"]);
    }

    #[test]
    fn what_was_given_is_forgotten_after_a_day() {
        let items = vec![item("a", "2026-11-15", Some("10:00"), false)];
        let mut r = Reminders::new("2026-11-15 09:59");
        assert_eq!(reminded(&mut r, &items, "2026-11-15 10:00"), ["a"]);
        assert_eq!(r.given.len(), 1);
        r.step(&items, "2026-11-16 10:00");
        assert_eq!(r.given.len(), 1, "yesterday's is kept");
        r.step(&items, "2026-11-17 10:00");
        assert!(r.given.is_empty());
    }
}
