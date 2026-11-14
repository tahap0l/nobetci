// The island as a personal assistant: write once, send it where you want.
//
// The island's assistant view takes a prompt and hands it to the AI app the
// user picks. Web apps that read a prompt from their address (`?q=`) get it
// there; the others open on their start page and the island puts the prompt on
// the clipboard to paste. The table below is the whole list of places a prompt
// can go: the front end only names a target, it never supplies a URL.
//
// "Ask here" answers in the island itself through the Prompt Studio provider
// (Ollama on this computer, or OpenAI once the user chose it and saved a key).
// Neither the prompt nor the answer is stored.

use serde::Serialize;
use tauri::AppHandle;

use crate::i18n::pick;

struct Target {
    id: &'static str,
    /// Start page, opened when the prompt cannot travel in the address.
    home: &'static str,
    /// Address with `{}` for the URL-encoded prompt, when the app reads one.
    with_prompt: Option<&'static str>,
}

const TARGETS: &[Target] = &[
    Target { id: "chatgpt", home: "https://chatgpt.com/", with_prompt: Some("https://chatgpt.com/?q={}") },
    Target { id: "claude", home: "https://claude.ai/new", with_prompt: Some("https://claude.ai/new?q={}") },
    Target { id: "gemini", home: "https://gemini.google.com/app", with_prompt: None },
    Target {
        id: "perplexity",
        home: "https://www.perplexity.ai/",
        with_prompt: Some("https://www.perplexity.ai/search?q={}"),
    },
    Target {
        id: "copilot",
        home: "https://copilot.microsoft.com/",
        with_prompt: Some("https://copilot.microsoft.com/?q={}"),
    },
    Target { id: "grok", home: "https://grok.com/", with_prompt: Some("https://grok.com/?q={}") },
    Target { id: "deepseek", home: "https://chat.deepseek.com/", with_prompt: None },
    Target { id: "mistral", home: "https://chat.mistral.ai/chat", with_prompt: None },
];

/// A desktop app that can take the prompt instead of the browser.
struct AppLink {
    /// The URL scheme the app registers.
    scheme: &'static str,
    /// Part of the handler's name, so a look-alike scheme owner is not used.
    handler: &'static str,
    /// Opens the app with `{}` as the URL-encoded prompt, when the app reads one.
    with_prompt: Option<&'static str>,
    /// Opens the app on its own.
    launch: &'static str,
    /// Longest encoded prompt the app takes in the link.
    max: usize,
}

/// Desktop apps, best first for each target. Links are documented by the apps:
/// Claude Desktop (`claude://claude.ai/new?q=`), the ChatGPT desktop app
/// (`codex://threads/new?prompt=`), Perplexity (`perplexity-app://search?q=`).
/// A link only fills the app's text box; the user still presses send.
const APPS: &[(&str, AppLink)] = &[
    (
        "claude",
        AppLink {
            scheme: "claude",
            handler: "claude",
            with_prompt: Some("claude://claude.ai/new?q={}"),
            launch: "claude://claude.ai/new",
            max: 13_000,
        },
    ),
    (
        "chatgpt",
        AppLink {
            scheme: "codex",
            handler: "chatgpt",
            with_prompt: Some("codex://threads/new?prompt={}"),
            launch: "codex://threads/new",
            max: MAX_URL_PROMPT,
        },
    ),
    ("chatgpt", AppLink { scheme: "chatgpt", handler: "chatgpt", with_prompt: None, launch: "chatgpt://", max: 0 }),
    (
        "perplexity",
        AppLink {
            scheme: "perplexity-app",
            handler: "perplexity",
            with_prompt: Some("perplexity-app://search?q={}"),
            launch: "perplexity-app://",
            max: MAX_URL_PROMPT,
        },
    ),
    ("copilot", AppLink { scheme: "ms-copilot", handler: "copilot", with_prompt: None, launch: "ms-copilot:", max: 0 }),
];

/// The installed desktop app for `target`, with its display name.
fn installed_app(target: &str) -> Option<(&'static AppLink, String)> {
    APPS.iter().filter(|(id, _)| *id == target).find_map(|(_, link)| {
        let name = crate::sys::scheme_handler(link.scheme)?;
        name.to_lowercase().contains(link.handler).then_some((link, name))
    })
}

/// The app link for `prompt`, and whether the prompt travels in it.
fn app_address(link: &AppLink, prompt: &str) -> (String, bool) {
    let encoded = encode(prompt.trim());
    match link.with_prompt {
        Some(template) if !encoded.is_empty() && encoded.len() <= link.max => (template.replace("{}", &encoded), true),
        _ => (link.launch.to_string(), false),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    target: &'static str,
    name: String,
}

/// Which targets have a desktop app on this computer.
#[tauri::command]
pub async fn assistant_apps() -> Vec<InstalledApp> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut seen: Vec<InstalledApp> = Vec::new();
        for (id, _) in APPS {
            if seen.iter().any(|a| a.target == *id) {
                continue;
            }
            if let Some((_, name)) = installed_app(id) {
                seen.push(InstalledApp { target: id, name });
            }
        }
        seen
    })
    .await
    .unwrap_or_default()
}

/// A target the assistant knows: "here" or one of the apps above.
pub fn is_target(id: &str) -> bool {
    id == "here" || TARGETS.iter().any(|t| t.id == id)
}

/// Remembers the target picked in the island.
#[tauri::command]
pub fn set_assistant_target(app: AppHandle, target: String) {
    if !is_target(&target) {
        return;
    }
    let mut s = crate::current(&app);
    if s.assistant_target != target {
        s.assistant_target = target;
        crate::store(&app, s);
    }
}

/// Longest encoded prompt put in an address; browsers and servers cut longer ones.
const MAX_URL_PROMPT: usize = 6_000;
/// Longest prompt the assistant takes at all.
const MAX_PROMPT_CHARS: usize = 30_000;

/// Percent-encodes everything but the unreserved characters (RFC 3986).
fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 3);
    for b in text.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Where a prompt for `target` goes, and whether it travels in the address.
fn address(target: &str, prompt: &str) -> Option<(String, bool)> {
    let t = TARGETS.iter().find(|t| t.id == target)?;
    let encoded = encode(prompt.trim());
    match t.with_prompt {
        Some(template) if !encoded.is_empty() && encoded.len() <= MAX_URL_PROMPT => {
            Some((template.replace("{}", &encoded), true))
        }
        _ => Some((t.home.to_string(), false)),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    /// The app received the prompt in its address; otherwise paste it.
    prefilled: bool,
    /// The desktop app that opened, or None for the browser.
    app: Option<String>,
}

/// Opens `target` with `prompt`: in its desktop app when one is installed (and
/// the user has not turned that off), otherwise in the default browser.
#[tauri::command]
pub async fn assistant_open(app: AppHandle, target: String, prompt: String) -> Result<Opened, String> {
    if prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err(pick("The prompt is too long.", "Mesaj çok uzun.").to_string());
    }
    let Some((url, prefilled)) = address(&target, &prompt) else {
        return Err(pick("Unknown AI app.", "Bilinmeyen yapay zekâ uygulaması.").to_string());
    };
    let use_apps = crate::current(&app).assistant_use_apps;
    tauri::async_runtime::spawn_blocking(move || {
        if use_apps {
            if let Some((link, name)) = installed_app(&target) {
                let (link_url, in_link) = app_address(link, &prompt);
                if crate::sys::open_app_link(&link_url) {
                    crate::log::line(format!("assistant: opened the {target} app (prefilled: {in_link})"));
                    return Ok(Opened { prefilled: in_link, app: Some(name) });
                }
            }
        }
        if crate::sys::open_url(&url) {
            crate::log::line(format!("assistant: opened {target} (prefilled: {prefilled})"));
            Ok(Opened { prefilled, app: None })
        } else {
            Err(pick("Couldn't open the browser.", "Tarayıcı açılamadı.").to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Starts the system's own dictation into the island's text box: Windows voice
/// typing (Win+H), macOS Dictation. Nöbetçi never hears the audio; the system
/// types the words into the focused field. Linux has no system dictation.
#[tauri::command]
pub fn assistant_dictate(app: AppHandle) -> Result<(), String> {
    let win = crate::island::window(&app).ok_or("no island")?;
    crate::island::set_typing(&win, true);
    #[cfg(windows)]
    {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY,
            VK_H, VK_LWIN,
        };
        let key = |vk: VIRTUAL_KEY, up: bool| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                    ..Default::default()
                },
            },
        };
        // Let the island become the foreground window first, so voice typing
        // writes into its text box.
        std::thread::sleep(std::time::Duration::from_millis(120));
        let inputs = [key(VK_LWIN, false), key(VK_H, false), key(VK_H, true), key(VK_LWIN, true)];
        let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
        if sent as usize == inputs.len() {
            Ok(())
        } else {
            Err(pick("Couldn't start voice typing.", "Sesle yazma başlatılamadı.").to_string())
        }
    }
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        let _ = app.run_on_main_thread(move || {
            let _ = tx.send(crate::mac_panel::start_dictation());
        });
        match rx.recv_timeout(std::time::Duration::from_secs(2)) {
            Ok(true) => Ok(()),
            _ => Err(pick(
                "Turn on Dictation in System Settings → Keyboard, then try again.",
                "Sistem Ayarları → Klavye'den Dikte'yi aç ve yeniden dene.",
            )
            .to_string()),
        }
    }
    #[cfg(target_os = "linux")]
    {
        let _ = win;
        Err(pick("Linux has no system dictation.", "Linux'ta sistem dikte özelliği yok.").to_string())
    }
}

fn assistant_instructions() -> &'static str {
    "You are the personal assistant in Nöbetçi, a small panel at the top of the user's screen. \
     Answer in the language the user writes in. Be brief and practical: a few sentences or a short \
     list, plain text without Markdown tables or headings. If the question needs more room, say so \
     in one line and suggest opening it in a full AI app."
}

/// Answers in the island with the Prompt Studio provider and model.
#[tauri::command]
pub async fn assistant_ask(app: AppHandle, text: String) -> Result<String, String> {
    let s = crate::current(&app);
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err(pick("Write something first.", "Önce bir şey yaz.").to_string());
    }
    if text.chars().count() > MAX_PROMPT_CHARS {
        return Err(pick("The prompt is too long.", "Mesaj çok uzun.").to_string());
    }
    let model = if s.prompt_provider == "openai" { s.openai_model } else { s.ollama_model };
    crate::prompts::complete(assistant_instructions(), &text, &s.prompt_provider, &model).await
}

/// Lets the island take the keyboard while the assistant's text box is in use,
/// and gives it back when it is done. The island never takes focus otherwise.
#[tauri::command]
pub fn island_keyboard(app: AppHandle, on: bool) {
    if let Some(win) = crate::island::window(&app) {
        crate::island::set_typing(&win, on);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompts_travel_encoded_to_known_apps_only() {
        let (url, prefilled) = address("chatgpt", "Merhaba dünya & ?").unwrap();
        assert!(prefilled);
        assert_eq!(url, "https://chatgpt.com/?q=Merhaba%20d%C3%BCnya%20%26%20%3F");
        let (url, prefilled) = address("gemini", "hello").unwrap();
        assert_eq!((url.as_str(), prefilled), ("https://gemini.google.com/app", false));
        assert!(address("https://evil.test/?q={}", "x").is_none());
        assert!(address("unknown", "x").is_none());
    }

    #[test]
    fn a_prompt_too_long_for_an_address_goes_by_clipboard() {
        let long = "ş".repeat(2_000); // 2 bytes each, 6 encoded characters each
        let (url, prefilled) = address("claude", &long).unwrap();
        assert_eq!((url.as_str(), prefilled), ("https://claude.ai/new", false));
    }

    #[test]
    fn app_links_carry_the_prompt_only_when_it_fits() {
        let claude = &APPS.iter().find(|(id, _)| *id == "claude").unwrap().1;
        let (url, prefilled) = app_address(claude, "Merhaba & ?");
        assert!(prefilled);
        assert_eq!(url, "claude://claude.ai/new?q=Merhaba%20%26%20%3F");
        let (url, prefilled) = app_address(claude, &"ş".repeat(5_000));
        assert_eq!((url.as_str(), prefilled), ("claude://claude.ai/new", false));
        let copilot = &APPS.iter().find(|(id, _)| *id == "copilot").unwrap().1;
        assert_eq!(app_address(copilot, "hi"), ("ms-copilot:".to_string(), false));
    }

    #[test]
    fn app_links_belong_to_known_targets_and_never_use_web_schemes() {
        for (id, link) in APPS {
            assert!(is_target(id), "{id}");
            assert!(!matches!(link.scheme, "http" | "https" | "file"), "{id}");
            assert!(link.launch.starts_with(link.scheme), "{id}");
            if let Some(w) = link.with_prompt {
                assert!(w.starts_with(link.scheme) && w.contains("{}"), "{id}");
            }
        }
    }

    #[test]
    fn every_target_is_https() {
        for t in TARGETS {
            assert!(t.home.starts_with("https://"), "{}", t.id);
            if let Some(w) = t.with_prompt {
                assert!(w.starts_with("https://") && w.contains("{}"), "{}", t.id);
            }
        }
    }
}
