# Security policy

Nöbetçi sits between an AI coding agent and your machine, so we take reports about it seriously —
including ones that turn out to be "only" a confusing card.

## Reporting a vulnerability

**Please don't open a public issue, discussion or pull request for a vulnerability.**

Report it privately through GitHub instead: open the repository's **Security** tab and choose
**Report a vulnerability**, or go straight to
<https://github.com/tahap0l/nobetci/security/advisories/new>. Only the maintainers can see the
report. ([How private reporting works](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately).)

A useful report says:

- the Nöbetçi version, the operating system (Windows or macOS) and its version, and the Claude
  Code version;
- what an attacker can do, and from where (the agent's own output, another program running as you,
  another account on the same machine…);
- the steps to reproduce it. Please keep proofs of concept harmless — `echo`, `calc.exe` or a file
  in a temporary folder make the point without risking anyone's machine.

What happens next. Nöbetçi is maintained by volunteers, so these are goals rather than guarantees:

- we acknowledge your report within **7 days**;
- we keep you posted at least every **14 days** until it's resolved;
- we agree on a disclosure date with you, normally no later than **90 days** after the report,
  and publish a GitHub Security Advisory together with the fix;
- we credit you in the advisory and the changelog, unless you'd rather stay anonymous.

There is no bug bounty.

### What to report here

Report privately anything that breaks one of the promises below, for example:

- something other than you approving a request: synthetic input getting past the click guard, the
  hold being bypassed, a HIGH or CRITICAL request approved automatically;
- the card showing something different from what will run (rendering tricks, truncation,
  invisible characters that aren't revealed);
- text from a request being interpreted as HTML or script in the island or the settings window;
- another account, or a remote machine, reading from or writing to your pipe or socket, or a
  fake server tricking the relay into talking to it;
- Nöbetçi writing to `~/.claude/settings.json` without your explicit consent, or damaging it;
- secrets that the redaction should catch ending up in the history or in a notification;
- formula injection through an exported CSV;
- anything in the build and release workflows that could let someone tamper with a published
  installer.

### What to report elsewhere

- **A risky command that scores too low, or a harmless one that scores too high**, is a gap in a
  heuristic rather than a vulnerability. Use the
  [risk rule issue template](https://github.com/tahap0l/nobetci/issues/new?template=risk_rule.yml)
  — unless the trick makes the *card* lie about what will run, which belongs here.
- **Vulnerabilities in Claude Code itself** go to Anthropic:
  <https://www.anthropic.com/responsible-disclosure-policy>.
- **Bugs in Windows, macOS, WebView2, WKWebView or Tauri** go to their respective projects. If one of them affects
  Nöbetçi, a private report here is still welcome so we can work around it.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.2.x | ✅ Security fixes |
| 0.1.x | ❌ Internal builds, never released |

Fixes land in the latest release only. Please update before reporting.

## Threat model

### What Nöbetçi is

Nöbetçi is a **reviewer**, not a sandbox. It shows you the permission requests Claude Code would
otherwise ask about in a terminal, scores each one with a set of heuristics, and passes your
decision back. It runs as you, on your machine, with no network access. It decides on its own only
where you told it to — a rule, a trusted project or a session grant — and never above MEDIUM
risk.

Nöbetçi runs on Windows and, since 0.2.0, on macOS. Where the two differ, this page says so.

It assumes the following can be hostile:

- **the content of a request** — a command, file contents, a URL or MCP arguments written by an
  agent that may have been steered by prompt injection;
- **other programs on your desktop** that try to approve a request on your behalf by faking input;
- **other accounts on the same machine**, and remote machines, that try to talk to your pipe or
  socket, or pose as Nöbetçi;
- **files that leave Nöbetçi**, such as a CSV export opened in a spreadsheet program.

### What it helps with

**Visibility and friction.** Every request gets a level (LOW, MEDIUM, HIGH or CRITICAL) and the
reasons behind it, and the parts of the command that triggered a finding are highlighted. HIGH and
CRITICAL requests need the Allow button to be held down: 1.2 s and 2.4 s by default. The holds can
be changed, but Rust clamps them so they can't drop below 0.4 s, and the CRITICAL hold is never
shorter than the HIGH one.

**The hold is enforced in Rust.** The decision handler in `src-tauri/src/pipe.rs` refuses a plain
"allow" for a HIGH or CRITICAL request; the island sends the confirmed form only after a completed
hold. A bug in the front end can't turn a click into an approval of a risky request. There is no
"always allow" anywhere — not in the app, and not in what the relay understands.

**Nothing HIGH or CRITICAL is approved automatically.** Rules, trusted projects and "don't ask
again in this session" grants are capped in Rust (`src-tauri/src/rules.rs`). The auto-allow
ceiling can be off, LOW or MEDIUM, and a hand-edited settings file can't raise it further
(`src-tauri/src/settings.rs` sanitises it on load). A rule may re-score a false alarm, but a
CRITICAL finding never drops below HIGH. Rules may always deny.

**What you see is what runs.** The relay forwards every field of a permission request whole, up to
64 KiB. Anything longer is cut, flagged and scored HIGH, with a finding telling you to review the
request in the terminal; that category can't be switched off. On the card:

- zero-width characters and direction marks (U+200B to U+200F), bidirectional embeddings and
  overrides (U+202A to U+202E), bidirectional isolates (U+2066 to U+2069) and the zero-width
  no-break space (U+FEFF) are shown as visible markers such as `⟦U+202E⟧`; in a command, or in
  content about to be written, they also score HIGH;
- runs of four or more blank lines, or 40 or more spaces, are collapsed into visible markers such
  as `⟦12 blank lines⟧`; in a command, twelve blank lines or 120 spaces with more text after them
  score HIGH as an attempt to push part of it out of view;
- a command box that has to scroll says "there's more — scroll".

**No HTML from requests.** The island and the settings window build their DOM from text nodes and
never use `innerHTML`, so text from a request can't become markup or script in a window that can
approve commands. The webview runs under a Content Security Policy that only allows the app's own
scripts.

**Physical-click guard.** While a request is waiting, Nöbetçi records every left-button press and
whether it came from a real device:

- **Windows:** it listens to Raw Input through a message-only window, without any global hook. A
  press from a real device carries the handle of that device; input synthesised with `SendInput`
  carries none, and pressing a button through UI Automation produces no mouse input at all.
- **macOS:** a local AppKit event monitor sees the presses Nöbetçi's own windows receive (no
  Accessibility or Input Monitoring permission needed). Every mouse event carries the process id
  of whoever posted it: events from a real mouse or trackpad come from the HID system with pid 0,
  events posted by a program (`CGEventPost`) carry that program's pid, and pressing a button
  through the accessibility API (`AXPress`) produces no mouse event at all. macOS itself only lets
  a program post mouse events or press other apps' buttons once you've granted it Accessibility
  access.

Nöbetçi also notes where each press landed. An approval made on the island is accepted only if the most
recent left-button press was physical, recent — within 3 seconds for a click, or the hold time
plus 3 seconds for a hold — and landed on the Allow button. A press is spent by the approval it
backs, so one real click can't vouch for a second card waiting in the queue. Otherwise the approval
is refused, logged as suspicious, and the card itself says that something may have tried to approve
on your behalf.
The guard stops recording as soon as nothing is waiting. It is on by default and can be switched
off in **Settings → Safety**. If the platform listener can't start, the guard stands down rather
than refusing every approval; the health check shows whether it's active.

**The allow hotkey is LOW-only.** Global hotkeys can be triggered by any program that fakes
keystrokes. The allow hotkey is therefore not set by default, and even when it is, Rust refuses it
for anything above LOW.

**A channel only you can use.**

- **Windows:** the relay and the app talk over `\\.\pipe\nobetci-<your SID>`. The app creates it
  with an explicit DACL that grants access to your account and SYSTEM only, rejects remote
  clients, and refuses to start serving if another process already owns that name. Before
  sending anything, the relay checks that the process serving the pipe runs under your SID; if it
  can't tell, it sends nothing.
- **macOS:** they talk over a Unix socket, `~/Library/Application Support/Nobetci/nobetci.sock`.
  The app keeps that folder at mode 0700 and the socket at 0600, refuses to start if something
  already answers on the socket, and drops any connection whose peer (`getpeereid`) isn't your
  user id. Before sending anything, the relay checks that the socket file belongs to you and that
  the process on the other end runs as you; otherwise it sends nothing.

**Failing safe, never failing open.** If Nöbetçi is closed, paused, busy or slow, the request falls
back to Claude Code's own prompt in the terminal. The relay never prints a decision it doesn't
fully recognise: unknown or malformed answers produce no output, which leaves the decision to the
terminal.

**Careful with `~/.claude/settings.json`.** Installing or removing hooks from the app always shows
a diff first, saves a dated backup, merges without touching other settings or other tools' hooks,
writes only after an explicit click, and refuses if the file changed since the preview. Writes go
to a temporary file that is renamed over the original, and a file that can't be read or parsed is
never overwritten. The uninstaller's `nobetci.exe --remove-hooks` is the one path without a
preview: it only removes Nöbetçi's own entries, and still keeps a dated backup. (macOS has no
uninstaller; the same command can be run by hand.) A request from the
agent to change Claude Code's permission or hook settings is scored CRITICAL; one that writes
hooks, agents, plugins or `.mcp.json` is HIGH. The same goes for Nöbetçi itself: a request to
change its settings, history or relay is CRITICAL, and one that tries to stop it is HIGH.

**No network, no secrets.** Nöbetçi makes no network connections and stores no API keys, tokens
or passwords, so there is nothing to steal from it and nowhere for it to send your data.

**Secrets are masked in what lingers.** Before a request is written to the history, and before a
Windows notification is shown, its text goes through redaction: PEM private keys; tokens with a
recognisable prefix (Anthropic and OpenAI style `sk-…` keys, GitHub, GitLab, Slack, AWS access key
IDs, Google API keys, Stripe, npm); JSON Web Tokens; `Authorization` and `Bearer` credentials;
values of `password`, `secret`, `token`, `api_key` and similar in `key=value`, `key: value` and
`--key value` form; and passwords in URLs. The approval card is deliberately not redacted: you
have to see exactly what you approve. The log file (`nobetci.log`) records what happened —
request IDs, tool names, risk levels and decisions — but not the requests themselves.

**Formula-safe CSV.** Every exported cell is quoted, and a cell that starts with `=`, `+`, `-`,
`@`, a tab or a carriage return gets a leading apostrophe, so a spreadsheet shows it as text
instead of running it.

### What it does not protect against

**It is not a sandbox.** An approved command runs with your full rights. Nöbetçi doesn't contain,
monitor or undo what it does afterwards.

**Heuristics can be evaded.** Quoting and escaping tricks, variables and aliases, a harmless-looking
script written now and run later, package scripts (`npm run …`), payloads hidden in files —
there are many ways to make a dangerous action look ordinary. LOW means "nothing obvious", never
"safe". Read what you approve.

**Software that already runs as you.** Windows draws its security boundary between accounts, not
between programs of the same account. Anything running as you — including something an approved
command started — can edit `~/.claude/settings.json` (for example to allow everything so Claude
Code never asks), change Nöbetçi's settings or history, replace the relay in
`%LOCALAPPDATA%\Nobetci\bin` (Windows) or `~/Library/Application Support/Nobetci/bin` (macOS), or
simply end Nöbetçi. An administrator can do all of that for every account.

**Decisions made somewhere else.** Nöbetçi only sees the requests Claude Code would ask you about.
Tool calls that Claude Code's own permission settings already allow, sessions running with
permission checks turned off, and requests answered in the terminal (after **Hand to terminal**, a
timeout, a pause, or while Nöbetçi isn't running) are never reviewed by it.

**Fake keystrokes.** Any program can trigger a global hotkey. That's why the allow hotkey is off by
default and limited to LOW risk; the deny hotkey can be triggered too, but denying is the safe
direction.

**The limits of the click guard.** It proves that a real press landed on the Allow button a moment
before the approval, and each press backs one approval — not that you read the card before
pressing. On macOS it rests on the event's source process id, which the system records for
posted events. Clicks that macOS itself makes on your behalf — Mouse Keys, for instance — look
like hardware, and a program with Accessibility access can switch such features on; that access
already means broad control over your Mac, so keep the list short. The macOS guard is new and
hasn't yet been tested against every way of making a click. With the guard switched off — which accessibility tools,
remote-control software and touchscreens may require — any program that can send input can
press, or hold, Allow for you.

**Redaction is best effort.** It recognises common formats; an unusual secret can slip through.
The approval card always shows the full request, so a screenshot or a screen share can expose a
secret that's on it.

**Release integrity.** Releases are built by GitHub Actions from the tagged commit, with every
third-party action pinned to a full commit SHA, and `SHA256SUMS.txt` is published next to the
Windows installer and the macOS disk image. Releases are not code-signed yet (the macOS app is
only ad-hoc signed and not notarized), so a matching hash proves that your download is the file
on the release page — not that the release page itself was never tampered with.

### The rules that keep it this way

Contributions must keep these properties; [CONTRIBUTING.md](CONTRIBUTING.md) explains them in
full. In short: never block Claude Code; never write `~/.claude/settings.json` without a reviewed
diff; never approve HIGH or CRITICAL without a person; never use `innerHTML`; never truncate what
the card shows without flagging it; and no telemetry, network calls or stored secrets.
