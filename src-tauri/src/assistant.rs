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
}

/// Opens `target` with `prompt` in the default browser.
#[tauri::command]
pub fn assistant_open(target: String, prompt: String) -> Result<Opened, String> {
    if prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err(pick("The prompt is too long.", "Mesaj çok uzun.").to_string());
    }
    let Some((url, prefilled)) = address(&target, &prompt) else {
        return Err(pick("Unknown AI app.", "Bilinmeyen yapay zekâ uygulaması.").to_string());
    };
    if crate::sys::open_url(&url) {
        crate::log::line(format!("assistant: opened {target} (prefilled: {prefilled})"));
        Ok(Opened { prefilled })
    } else {
        Err(pick("Couldn't open the browser.", "Tarayıcı açılamadı.").to_string())
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
    fn every_target_is_https() {
        for t in TARGETS {
            assert!(t.home.starts_with("https://"), "{}", t.id);
            if let Some(w) = t.with_prompt {
                assert!(w.starts_with("https://") && w.contains("{}"), "{}", t.id);
            }
        }
    }
}
