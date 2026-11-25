//! The relay binary as the hosts run it. Every case here stops before the relay
//! would connect (the input cannot be read, or is not a status message), so the
//! tests never reach a Nobi that happens to be running on this machine.

use std::io::Write;
use std::process::{Command, Stdio};

/// Runs the relay with `args` and `stdin`; returns stdout and the exit code.
fn relay(args: &[&str], stdin: &[u8]) -> (Vec<u8>, i32) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_nobi-hook"))
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("start the relay");
    child.stdin.take().unwrap().write_all(stdin).unwrap();
    let out = child.wait_with_output().unwrap();
    (out.stdout, out.status.code().unwrap_or(-1))
}

fn json_line(stdout: &[u8]) -> serde_json::Value {
    let text = std::str::from_utf8(stdout).unwrap();
    assert!(text.ends_with('\n') && text.trim_end().lines().count() == 1, "one line: {text:?}");
    serde_json::from_str(text.trim_end()).unwrap()
}

#[test]
fn cursor_asks_when_the_relay_cannot_read_the_request() {
    // Not JSON, nothing at all, and a lone surrogate serde_json refuses.
    let cases: [(&str, &[u8]); 3] = [
        ("beforeShellExecution", b"{not json"),
        ("beforeShellExecution", b""),
        ("beforeMCPExecution", br#"{"tool_name":"q","tool_input":"{\"x\":\"\ud83d\"}","command":"\ud83d"}"#),
    ];
    for (event, input) in cases {
        let (stdout, code) = relay(&["cursor", event], input);
        assert_eq!(code, 0);
        let answer = json_line(&stdout);
        assert_eq!(answer["permission"], "ask", "{event}: {answer}");
        assert!(answer["user_message"].as_str().unwrap().contains("Cursor"));
    }
}

#[test]
fn a_cursor_prompt_always_continues() {
    let (stdout, code) = relay(&["cursor", "beforeSubmitPrompt"], b"");
    assert_eq!(code, 0);
    assert_eq!(json_line(&stdout), serde_json::json!({ "continue": true }));
}

#[test]
fn claude_code_and_codex_hear_nothing_and_ask_themselves() {
    for args in
        [&["PermissionRequest"][..], &["codex", "PermissionRequest"][..], &["cursor", "afterShellExecution"][..]]
    {
        let (stdout, code) = relay(args, b"{broken");
        assert_eq!(code, 0, "{args:?}");
        assert!(stdout.is_empty(), "{args:?}: {:?}", String::from_utf8_lossy(&stdout));
    }
}

#[test]
fn the_browser_bridge_answers_in_native_messaging_framing() {
    // Not a status message: refused without being sent anywhere.
    let message = br#"{"id":"74c1ae1a-5288-4150-95c4-1cef4c65f43a","status":"working","title":"chat"}"#;
    let mut input = (message.len() as u32).to_ne_bytes().to_vec();
    input.extend_from_slice(message);
    let (stdout, code) = relay(&["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"], &input);
    assert_eq!(code, 0);
    let reply = br#"{"ok":false}"#;
    let mut expected = (reply.len() as u32).to_ne_bytes().to_vec();
    expected.extend_from_slice(reply);
    assert_eq!(stdout, expected);
}
