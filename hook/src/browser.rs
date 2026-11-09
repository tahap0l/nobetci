//! Chromium native messaging bridge for status-only ChatGPT web events.

use std::io::{self, Read, Write};
use std::sync::mpsc;

use serde_json::Value;

fn payload(bytes: &[u8]) -> Option<String> {
    let message: Value = serde_json::from_slice(bytes).ok()?;
    if message.as_object()?.len() != 2 {
        return None;
    }
    let id = message.get("id")?.as_str()?;
    if id.len() != 36 || !id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
        return None;
    }
    let event = match message.get("status")?.as_str()? {
        "working" => "UserPromptSubmit",
        "finished" => "Stop",
        "closed" => "SessionEnd",
        _ => return None,
    };
    Some(
        serde_json::json!({
            "hook_event_name": event,
            "session_id": format!("chatgpt-web:{id}"),
            "agent_name": "ChatGPT Web",
        })
        .to_string(),
    )
}

fn read_message(mut input: impl Read) -> Option<String> {
    let mut length = [0; 4];
    input.read_exact(&mut length).ok()?;
    let length = u32::from_ne_bytes(length) as usize;
    if !(1..=1024).contains(&length) {
        return None;
    }
    let mut bytes = vec![0; length];
    input.read_exact(&mut bytes).ok()?;
    payload(&bytes)
}

fn forward(payload: String) -> bool {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let sent = super::os::connect()
            .is_some_and(|mut pipe| pipe.write_all(payload.as_bytes()).is_ok() && pipe.flush().is_ok());
        let _ = tx.send(sent);
    });
    rx.recv_timeout(super::FIRE_AND_FORGET_BUDGET).unwrap_or(false)
}

pub fn run() {
    let ok = read_message(io::stdin().lock()).is_some_and(forward);
    let response: &[u8] = if ok { b"{\"ok\":true}" } else { b"{\"ok\":false}" };
    let mut output = io::stdout().lock();
    let _ = output.write_all(&(response.len() as u32).to_ne_bytes());
    let _ = output.write_all(response);
    let _ = output.flush();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_web_status_messages() {
        let id = "74c1ae1a-5288-4150-95c4-1cef4c65f43a";
        for (status, event) in [("working", "UserPromptSubmit"), ("finished", "Stop"), ("closed", "SessionEnd")] {
            let data = serde_json::json!({"id": id, "status": status});
            let outgoing: serde_json::Value =
                serde_json::from_str(&payload(data.to_string().as_bytes()).unwrap()).unwrap();
            assert_eq!(outgoing["hook_event_name"], event);
            assert_eq!(outgoing["session_id"], format!("chatgpt-web:{id}"));
            assert_eq!(outgoing.as_object().unwrap().len(), 3);
        }
        assert!(payload(format!(r#"{{"id":"{id}","status":"permissionrequest"}}"#).as_bytes()).is_none());
        assert!(payload(format!(r#"{{"id":"{id}","status":"working","prompt":"secret"}}"#).as_bytes()).is_none());
        assert!(read_message(1025_u32.to_ne_bytes().as_slice()).is_none());
    }
}
