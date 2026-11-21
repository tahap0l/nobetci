//! Chromium native messaging bridge for status-only ChatGPT web events.
//!
//! The extension (integrations/chatgpt-web) says only whether a ChatGPT tab is
//! generating a response: a random id and "working", "finished" or "closed".
//! Chrome or Edge starts this relay with the extension's origin as the first
//! argument and one length-prefixed JSON message on stdin; we turn it into a
//! hook event, hand it to the app like any other, and answer `{"ok":…}`.

use std::io::{self, Read, Write};
use std::sync::mpsc;

use serde_json::Value;

/// The hook event for one status message, as the line the app reads. Ended by a
/// newline like every other frame: the app reads up to it, and drops a frame
/// that ends without one.
fn line(bytes: &[u8]) -> Option<String> {
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
    let mut line = serde_json::json!({
        "hook_event_name": event,
        "session_id": format!("chatgpt-web:{id}"),
        "agent_name": "ChatGPT Web",
    })
    .to_string();
    line.push('\n');
    Some(line)
}

/// One native message: a 32-bit length in the machine's byte order, then that
/// many bytes of JSON.
fn read_message(mut input: impl Read) -> Option<String> {
    let mut length = [0; 4];
    input.read_exact(&mut length).ok()?;
    let length = u32::from_ne_bytes(length) as usize;
    if !(1..=1024).contains(&length) {
        return None;
    }
    let mut bytes = vec![0; length];
    input.read_exact(&mut bytes).ok()?;
    line(&bytes)
}

/// Writes the whole line. True only when every byte went out.
fn send(mut pipe: impl Write, line: &str) -> bool {
    pipe.write_all(line.as_bytes()).is_ok() && pipe.flush().is_ok()
}

fn forward(line: String) -> bool {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let sent = super::os::connect().is_some_and(|pipe| send(pipe, &line));
        let _ = tx.send(sent);
    });
    rx.recv_timeout(super::FIRE_AND_FORGET_BUDGET).unwrap_or(false)
}

/// Reads one message, hands it on, and answers in the same framing.
fn serve(input: impl Read, mut output: impl Write, forward: impl FnOnce(String) -> bool) {
    let ok = read_message(input).is_some_and(forward);
    let response: &[u8] = if ok { b"{\"ok\":true}" } else { b"{\"ok\":false}" };
    let _ = output.write_all(&(response.len() as u32).to_ne_bytes());
    let _ = output.write_all(response);
    let _ = output.flush();
}

pub fn run() {
    serve(io::stdin().lock(), io::stdout().lock(), forward);
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "74c1ae1a-5288-4150-95c4-1cef4c65f43a";

    fn message(json: &str) -> Vec<u8> {
        let mut framed = (json.len() as u32).to_ne_bytes().to_vec();
        framed.extend_from_slice(json.as_bytes());
        framed
    }

    #[test]
    fn accepts_only_web_status_messages() {
        for (status, event) in [("working", "UserPromptSubmit"), ("finished", "Stop"), ("closed", "SessionEnd")] {
            let data = serde_json::json!({"id": ID, "status": status});
            let outgoing: serde_json::Value =
                serde_json::from_str(&line(data.to_string().as_bytes()).unwrap()).unwrap();
            assert_eq!(outgoing["hook_event_name"], event);
            assert_eq!(outgoing["session_id"], format!("chatgpt-web:{ID}"));
            assert_eq!(outgoing.as_object().unwrap().len(), 3);
        }
        assert!(line(format!(r#"{{"id":"{ID}","status":"permissionrequest"}}"#).as_bytes()).is_none());
        assert!(line(format!(r#"{{"id":"{ID}","status":"working","prompt":"secret"}}"#).as_bytes()).is_none());
        assert!(line(br#"{"id":"not-a-uuid","status":"working"}"#).is_none());
        assert!(read_message(1025_u32.to_ne_bytes().as_slice()).is_none());
        assert!(read_message(0_u32.to_ne_bytes().as_slice()).is_none());
    }

    #[test]
    fn every_status_reaches_the_app_as_one_whole_frame() {
        // The bug this guards against: the bridge wrote its JSON with no newline,
        // the app waited for one, hit the end of the stream and dropped the frame,
        // while the extension was told {"ok":true}.
        for status in ["working", "finished", "closed"] {
            let input = message(&format!(r#"{{"id":"{ID}","status":"{status}"}}"#));
            let (mut wire, mut answer) = (Vec::new(), Vec::new());
            serve(input.as_slice(), &mut answer, |line| send(&mut wire, &line));
            assert_eq!(answer, message(r#"{"ok":true}"#), "{status}");

            let frame = crate::app_frame(wire.as_slice()).expect("the app takes the frame");
            let event: serde_json::Value = serde_json::from_slice(&frame).unwrap();
            assert_eq!(event["agent_name"], "ChatGPT Web");
            assert_eq!(event["session_id"], format!("chatgpt-web:{ID}"));
            assert_eq!(wire.last(), Some(&b'\n'));
            assert_eq!(frame.len() + 1, wire.len(), "one frame, nothing after it");
        }
    }

    #[test]
    fn a_message_that_is_not_a_status_is_answered_but_never_sent() {
        let mut sent = false;
        let mut answer = Vec::new();
        let input = message(&format!(r#"{{"id":"{ID}","status":"working","title":"my chat"}}"#));
        serve(input.as_slice(), &mut answer, |_| {
            sent = true;
            true
        });
        assert!(!sent);
        assert_eq!(answer, message(r#"{"ok":false}"#));
        // Nobody to hand it to: the extension hears that too, and backs off.
        let mut answer = Vec::new();
        serve(message(&format!(r#"{{"id":"{ID}","status":"working"}}"#)).as_slice(), &mut answer, |_| false);
        assert_eq!(answer, message(r#"{"ok":false}"#));
    }

    #[cfg(unix)]
    #[test]
    fn the_frame_survives_a_real_socket() {
        use std::os::unix::net::UnixStream;
        let (relay, mut app) = UnixStream::pair().unwrap();
        let line = line(format!(r#"{{"id":"{ID}","status":"working"}}"#).as_bytes()).unwrap();
        // The relay writes and is gone, as the real one exits right after.
        assert!(send(relay, &line));
        let frame = crate::app_frame(&mut app).expect("the app takes the frame");
        assert_eq!(serde_json::from_slice::<serde_json::Value>(&frame).unwrap()["hook_event_name"], "UserPromptSubmit");
    }
}
