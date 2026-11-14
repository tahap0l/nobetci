// A small agenda for the island: things to do on a day, optionally at a time.
//
// Kept in `agenda.json` next to the settings, written atomically like them. An
// item with a time gets a reminder: a desktop notification (unless Nöbetçi is
// quiet) and an `agenda-due` event the island reacts to. The reminder thread
// wakes twice a minute and does nothing else.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

use crate::i18n::pick;

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

fn path() -> PathBuf {
    crate::settings::config_dir().join("agenda.json")
}

fn store() -> &'static Mutex<Vec<Item>> {
    static ITEMS: OnceLock<Mutex<Vec<Item>>> = OnceLock::new();
    ITEMS.get_or_init(|| {
        let items = std::fs::read(path())
            .ok()
            .and_then(|b| serde_json::from_slice::<Vec<Item>>(&b).ok())
            .unwrap_or_default()
            .into_iter()
            .filter_map(Item::sanitized)
            .collect();
        Mutex::new(items)
    })
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

impl Item {
    fn sanitized(mut self) -> Option<Item> {
        self.text = self.text.trim().chars().filter(|c| !c.is_control()).take(MAX_TEXT).collect();
        let id_ok = !self.id.is_empty()
            && self.id.len() <= 40
            && self.id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-');
        if self.text.is_empty() || !id_ok || !is_date(&self.date) {
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
    if items.len() > MAX_ITEMS {
        let extra = items.len() - MAX_ITEMS;
        items.drain(..extra);
    }
}

fn save(items: &[Item]) -> std::io::Result<()> {
    let path = path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_vec_pretty(items).map_err(std::io::Error::other)?;
    let temp = path.with_extension(format!("json.tmp-{}", std::process::id()));
    let written = std::fs::write(&temp, json).and_then(|_| std::fs::rename(&temp, &path));
    if written.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    written
}

fn changed(app: &AppHandle, items: &[Item]) -> Result<Vec<Item>, String> {
    save(items).map_err(|e| {
        crate::log::line(format!("agenda: save failed: {e}"));
        pick("Couldn't save the agenda.", "Ajanda kaydedilemedi.").to_string()
    })?;
    let _ = app.emit("agenda-changed", items);
    Ok(items.to_vec())
}

#[tauri::command]
pub fn agenda_list() -> Vec<Item> {
    let mut items = store().lock().map(|i| i.clone()).unwrap_or_default();
    tidy(&mut items, &today());
    items
}

/// Adds an item, or replaces the one with the same id.
#[tauri::command]
pub fn agenda_put(app: AppHandle, item: Item) -> Result<Vec<Item>, String> {
    let item = item.sanitized().ok_or_else(|| pick("That item isn't valid.", "Bu kayıt geçerli değil.").to_string())?;
    let mut items = store().lock().map_err(|e| e.to_string())?;
    match items.iter_mut().find(|i| i.id == item.id) {
        Some(existing) => *existing = item,
        None => items.push(item),
    }
    tidy(&mut items, &today());
    changed(&app, &items)
}

#[tauri::command]
pub fn agenda_delete(app: AppHandle, id: String) -> Result<Vec<Item>, String> {
    let mut items = store().lock().map_err(|e| e.to_string())?;
    items.retain(|i| i.id != id);
    changed(&app, &items)
}

/// Items whose reminder time falls in (after, until], as "YYYY-MM-DD HH:MM".
fn due<'a>(items: &'a [Item], after: &str, until: &str) -> Vec<&'a Item> {
    items
        .iter()
        .filter(|i| !i.done)
        .filter_map(|i| {
            let at = format!("{} {}", i.date, i.time.as_deref()?);
            (at.as_str() > after && at.as_str() <= until).then_some(i)
        })
        .collect()
}

/// Wakes every 30 seconds and reminds of items whose time has come. Times that
/// passed while the app was closed are not reminded at start.
pub fn spawn_reminders(app: AppHandle) {
    std::thread::spawn(move || {
        let minute = || crate::sys::local_time().stamp()[..16].to_string();
        let mut last = minute();
        loop {
            std::thread::sleep(Duration::from_secs(30));
            let now = minute();
            if now == last {
                continue;
            }
            let items = store().lock().map(|i| i.clone()).unwrap_or_default();
            for item in due(&items, &last, &now) {
                remind(&app, item);
            }
            last = now;
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
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(crate::redact::redact(&item.text).chars().take(240).collect::<String>())
        .show();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, date: &str, time: Option<&str>, done: bool) -> Item {
        Item { id: id.into(), text: format!("item {id}"), date: date.into(), time: time.map(Into::into), done }
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
        let ids: Vec<_> = items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, ["old-open", "early", "late"]);
    }

    #[test]
    fn reminders_fire_once_in_their_minute() {
        let items = vec![
            item("a", "2026-11-15", Some("09:00"), false),
            item("b", "2026-11-15", Some("09:01"), true),
            item("c", "2026-11-15", None, false),
            item("d", "2026-11-15", Some("09:02"), false),
        ];
        let ids = |v: Vec<&Item>| v.into_iter().map(|i| i.id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(due(&items, "2026-11-15 08:59", "2026-11-15 09:00")), ["a"]);
        assert_eq!(ids(due(&items, "2026-11-15 09:00", "2026-11-15 09:02")), ["d"]);
        assert!(due(&items, "2026-11-15 09:02", "2026-11-15 09:03").is_empty());
    }
}
