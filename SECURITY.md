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

- the Nöbetçi version, the operating system (Windows, macOS or Linux — and on Linux, X11 or
  Wayland and which desktop) and its version, and the version of the agent (Claude Code, Codex or
  Cursor);
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
  hold being bypassed, a HIGH or CRITICAL request approved automatically or through the allow
  hotkey or a batch;
- the card showing something different from what will run (rendering tricks, truncation,
  invisible characters that aren't revealed);
- text from a request being interpreted as HTML or script in the island or the settings window;
- another account, or a remote machine, reading from or writing to your pipe or socket, or a
  fake server tricking the relay into talking to it;
- Nöbetçi writing to `~/.claude/settings.json`, or to Codex's or Cursor's `hooks.json`, without
  your explicit consent, or damaging them;
- an agent request that changes Nöbetçi's own files, swaps its relay or removes its hooks without
  being scored CRITICAL;
- secrets that the redaction should catch ending up in the history or in a notification;
- formula injection through an exported CSV;
- anything in the build and release workflows that could let someone tamper with a published
  installer.

### What to report elsewhere

- **A risky command that scores too low, or a harmless one that scores too high**, is a gap in a
  heuristic rather than a vulnerability. Use the
  [risk rule issue template](https://github.com/tahap0l/nobetci/issues/new?template=risk_rule.yml)
  — unless the trick makes the *card* lie about what will run, or gets past Nöbetçi's
  self-protection, which belong here.
- **Vulnerabilities in Claude Code itself** go to Anthropic:
  <https://www.anthropic.com/responsible-disclosure-policy>.
- **Bugs in Windows, macOS, Linux desktops, WebView2, WKWebView, WebKitGTK or Tauri** go to their
  respective projects. If one of them affects Nöbetçi, a private report here is still welcome so we
  can work around it.

## Supported versions

| Version | Supported |
| --- | --- |
| 2.4.x (the latest release) | ✅ Security fixes |
| Earlier releases | ❌ Please update |

Fixes land in the latest release only. Please update before reporting.

## Threat model

### What Nöbetçi is

Nöbetçi is a **reviewer**, not a sandbox. It shows you the permission requests Claude Code would
otherwise ask about in a terminal — and those of Codex and Cursor, as far as their hooks allow —
scores each one with a set of heuristics, and passes your decision back. It runs as you, on your
machine. It decides on its own only where you told it to — a rule, a trusted project or a session
grant — and never above MEDIUM risk.

Network access is limited to what you switch on: Prompt Studio's model request (Ollama on loopback,
whose cloud-tagged models may forward the draft, or the OpenAI API after you select it and click
Improve), the island assistant's **Ask here** (the same provider), and the weather card, which asks
Open-Meteo for the forecast of the city you pick. Sending a message to an AI app from the assistant
opens that app through a fixed link, or your browser at a fixed `https://` address; for most
targets the message travels in that link or address, and the service may answer it as soon as it
opens (the [privacy policy](PRIVACY.md) says which).

Nöbetçi runs on Windows, on macOS (since 0.2.0) and on Linux (since 2.3.0). Where they differ, this
page says so.

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
CRITICAL finding never drops below HIGH, and the cap also looks at the engine's own level: a
request the engine scored HIGH that a rule lowered to LOW becomes a plain click — never an
automatic pass, never something the allow hotkey or a batch approval can take. Rules may always
deny.

**Rules mean what they say.** A *starts with* pattern ends at a word boundary, glob patterns cross
line breaks, and a loose pattern (*starts with*, *contains*, glob or empty) that allows or lowers a
request doesn't match a command that chains more commands than the pattern itself — a line break,
`;`, `&&`, `||`, `|`, `&`, backticks or `$(` — so `npm test` can't carry `rm -rf ~` behind it.
Deny rules match anywhere. For a file path, an allow rule, a rule that lowers the level and a
"don't ask again" grant match only where the path really leads once `..`, `.`, `~` and relative
parts are resolved — an allow rule for `/work/app/*` doesn't cover `/work/app/../../etc/hosts` —
while deny, always-ask and raising rules match the path as written or as resolved.

**What you see is what runs.** The relay forwards every field of a permission request whole, up to
64 KiB. Anything longer is cut, flagged and scored HIGH, with a finding telling you to review the
request in the terminal; that category can't be switched off, and the card marks the cut. A
request too large for the channel (over 1 MiB in all) has its longest fields cut evenly until it
fits: it reaches the card cut and HIGH, and no rule or grant can approve it. Two kinds never reach
a card: a request whose shape alone is too large (say, an argument holding a hundred thousand
numbers), and a question or a plan that had to be cut, whose answer would hand the cut text back
as if it were whole. Both are logged, recorded in the history and left to the agent's own prompt.
Write and edit requests show the whole content, and every edit of a multi-edit. On the card:

- invisible and direction-changing characters — zero-width characters and direction marks, the
  Arabic letter mark, bidirectional embeddings, overrides and isolates, word joiners, the soft
  hyphen, the combining grapheme joiner, the Mongolian vowel separator, Hangul fillers, tag
  characters, line and paragraph separators, the zero-width no-break space, control characters
  and a lone carriage return — are shown as visible markers such as `⟦U+202E⟧`; in a command, or
  in content about to be written, they also score HIGH (a zero-width joiner inside an emoji or a
  Persian or Indic word is ordinary text and doesn't);
- runs of four or more blank lines, or 40 or more spaces, are collapsed into visible markers such
  as `⟦12 blank lines⟧` — no-break, wide and ideographic spaces count as blanks too; in a command,
  twelve blank lines or 120 spaces with more text after them score HIGH as an attempt to push part
  of it out of view;
- a command box that has to scroll says so.

For a tool it doesn't know, Nöbetçi shows, scores and matches the whole argument object, not one
field of it.

**No HTML from requests.** The island and the settings window build their DOM from text nodes and
never use `innerHTML`, so text from a request can't become markup or script in a window that can
approve commands. The webview runs under a Content Security Policy that only allows the app's own
scripts. On Linux, a notification's text is escaped for notification servers that read markup, so
a command can't turn into a link or formatting there.

**Each window can do only its own job.** The island, the settings window and the desktop mascot
can each call only the app commands they use. The approval commands answer the island alone;
previewing and writing hooks, testing rules and reading or clearing the history answer the settings
window alone; the desktop mascot only shows itself and opens the island. A script running in the
settings window or the mascot can't approve a request.

**Physical-click guard.** While a request is waiting, Nöbetçi records every press of the primary
mouse button and whether it came from a real device:

- **Windows:** it listens to Raw Input through a message-only window, without any global hook. A
  press from a real device carries the handle of that device; input synthesised with `SendInput`
  carries none, and pressing a button through UI Automation produces no mouse input at all. With
  the mouse buttons swapped (left-handed), the guard follows the button you made primary.
- **macOS:** a local AppKit event monitor sees the presses Nöbetçi's own windows receive (no
  Accessibility or Input Monitoring permission needed). Every mouse event carries the process id
  of whoever posted it: events from a real mouse or trackpad come from the HID system with pid 0,
  events posted by a program (`CGEventPost`) carry that program's pid, and pressing a button
  through the accessibility API (`AXPress`) produces no mouse event at all. macOS itself only lets
  a program post mouse events or press other apps' buttons once you've granted it Accessibility
  access.
- **Linux:** a thread reads XInput2 raw button events on the root window (no grab) and, at every
  press, asks the X server about the device it came from. XTEST input — what `xdotool` and other
  programs fake clicks with — always comes from an XTEST device, including the one a program gets
  by adding a master pointer of its own later; such a press, or one from a device the server no
  longer knows, counts as synthetic. Pressing the button through the accessibility bus (AT-SPI)
  makes no mouse event at all. Nöbetçi asks for XInput 2.2, so it also sees the release while the
  island's own toolkit holds the pointer, and Rust measures the hold. It follows the button maps
  (`xinput set-button-map`, or `xmodmap -e 'pointer = 3 2 1'` for a left-handed mouse), so the press
  it records is the one that acts as the primary click.

Nöbetçi also notes where each press landed. An approval made on the island is accepted only if the
most recent press was physical, began after the card appeared, is fresh — released within 3
seconds, or the hold time plus 3 seconds while still held — and landed on the Allow button. A card
accepts no approval in its first 350 ms. A press is spent by the approval it backs, so one real
click can't vouch for a second card waiting in the queue, and the second half of a double-click or
the release of a hold meant for the previous card is ignored quietly. Otherwise the approval is
refused, logged as suspicious, and the card itself says that something may have tried to approve
on your behalf. Rust measures the physical hold for HIGH and CRITICAL requests. If the mouse is
released early or physical input cannot be verified, use the terminal to decide. The guard stops
recording when no requests are waiting. **Settings → Safety** can turn off physical click
verification for LOW and MEDIUM approvals. The health check shows whether the platform listener is
active.

**The allow hotkey is LOW-only.** Global hotkeys can be triggered by any program that fakes
keystrokes. The allow hotkey is therefore not set by default, and even when it is, Rust refuses it
for anything the engine itself scored above LOW, whatever a rule made of it. Rust also accepts a
hotkey approval only within 1.5 s of a press of the allow shortcut that it registered itself, so
nothing inside a window can claim one. Batch approval (the row's **Allow all** button) covers only
the requests the batch row lists, only those still LOW by both the engine's and the current level,
and takes one physical click.

**A channel only you can use.**

- **Windows:** the relay and the app talk over `\\.\pipe\nobetci-<your SID>`. The app creates it
  with an explicit DACL that grants access to your account and SYSTEM only, rejects remote
  clients, and refuses to start serving if another process already owns that name. Before
  sending anything, the relay checks that the process serving the pipe runs under your SID; if it
  can't tell, it sends nothing. It also opens the pipe at the identification level, so a server
  that grabbed the name first could at most learn who you are, never act as you. An answer is
  flushed before the pipe is disconnected, so a decision made on the spot by a rule is never lost.
- **macOS:** they talk over a Unix socket, `~/Library/Application Support/Nobetci/nobetci.sock`.
  The app keeps that folder at mode 0700 and the socket at 0600, refuses to start if something
  already answers on the socket, and drops any connection whose peer (`getpeereid`) isn't your
  user id. Before sending anything, the relay checks that the socket file belongs to you and that
  the process on the other end runs as you; otherwise it sends nothing.
- **Linux:** the same, with the socket at `~/.local/state/nobetci/nobetci.sock` (or
  `/tmp/nobetci-<uid>/` when the home path is too long for a socket) and the peer checked with
  `SO_PEERCRED`.

**Failing safe, never failing open.** If Nöbetçi is closed, paused, busy or slow, the request falls
back to the agent's own prompt: Claude Code and Codex ask in the terminal, and Cursor asks you
itself. The relay never prints a decision it doesn't fully recognise: unknown or malformed answers
produce no output, which leaves the decision to the terminal. Nöbetçi registers its Cursor
permission hooks fail-closed, so a relay that crashes or can't be started makes Cursor refuse the
command rather than run it unreviewed.

**Careful with `~/.claude/settings.json`.** Installing or removing hooks from the app always shows
a diff first, saves a dated backup, merges without touching other settings or other tools' hooks,
writes only after an explicit click, and refuses if the file changed since the preview. What is
written is exactly what the preview showed: the diff is computed on the file's own text, so any
other reformatting would show in it too, the file keeps its key order, and a backup is announced
only when there is a file to back up. Writes go to a temporary file that is renamed over the
original — for a symbolic link, over the file it points to, so the link stays a link — and a file
that can't be read or parsed is never overwritten. Codex's and Cursor's `hooks.json` are handled
the same way. When Claude Code keeps its settings elsewhere with an absolute `CLAUDE_CONFIG_DIR`,
Nöbetçi writes `$CLAUDE_CONFIG_DIR/settings.json` instead, provided Nöbetçi itself sees that
variable; Settings → Claude Code shows which file it uses.

`nobetci --remove-hooks` is the one path without a preview. The Windows uninstaller runs it, and on
macOS and Linux you run it by hand before deleting the app. It removes only Nöbetçi's own hook
commands — never another tool's hook, even one that shares a matcher group with Nöbetçi's — from
`~/.claude/settings.json`, Codex's `hooks.json` and `~/.cursor/hooks.json`, keeps a dated backup of
each, and prints one line per file in a terminal on macOS and Linux (on Windows, where it has no
console, `nobetci.log` notes each file it cleaned or couldn't clean). It exits with status 1 when a
file couldn't be cleaned (0 when no entry of Nöbetçi's is left), in which case the Windows
uninstaller keeps the relay in place and tells you what is left.

**Nöbetçi guards itself.** A request from the agent to change Claude Code's permission or hook
settings (in `~/.claude`, or in the folder `CLAUDE_CONFIG_DIR` names), or Codex's or Cursor's hook
settings (their `hooks.json`, and Codex's `config.toml`), is scored CRITICAL; one that writes hooks,
agents, plugins or `.mcp.json` is HIGH. The same goes for Nöbetçi itself, on all three systems:

- writing to its folders — `%APPDATA%\Nobetci` and `%LOCALAPPDATA%\Nobetci` on Windows;
  `~/Library/Application Support/Nobetci` and `/Applications/Nobetci.app` on macOS;
  `~/.config/nobetci`, `~/.local/share/nobetci`, `~/.local/state/nobetci` (and their
  `$XDG_*_HOME` forms) and the installed programs on Linux — or to its relay wherever it lies, is
  CRITICAL, whatever does the writing: a redirection, `tee`, `cp`, `mv`, `install`, `ln`, `rsync`,
  `curl -o`, `wget -O`, `sed -i`, `chmod`, `rm`, `dd of=`, an editor or a one-liner in a scripting
  language — and a program Nöbetçi doesn't know, handed one of those paths, counts as writing
  there. Reading those files stays LOW;
- `nobetci --remove-hooks`, by any path, is CRITICAL;
- stopping or uninstalling it (`taskkill`, `pkill`, `launchctl bootout`, `systemctl --user stop`,
  a package manager's remove…) is HIGH.

Paths are resolved against the session's folder first, so `.claude//settings.json`, `./` segments,
`..` and relative paths meet the same rules as the plain spelling, and a `cd` earlier in the
command is followed: `cd ~/.claude` and then `> settings.json` is a write to Claude Code's
settings.

**No telemetry; explicit provider requests only.** Nöbetçi has no analytics, crash reporting or
update checks. Prompt drafts are not saved. Ollama receives the draft at the local Ollama service;
Ollama models marked cloud may forward it. The OpenAI API receives it only after the user selects
OpenAI and clicks Improve. The optional API key is stored in the operating system credential vault,
never in settings, logs or history. Review OpenAI's data policies for how API requests are handled
by the provider.

**Secrets are masked in what lingers.** Before a request is written to the history, and before a
notification is shown, its text goes through redaction: PEM private keys; tokens with a
recognisable prefix (Anthropic and OpenAI style `sk-…` keys, GitHub, GitLab, Slack, AWS access key
IDs, Google API keys, Stripe, npm, Hugging Face and more); JSON Web Tokens; `Authorization`,
`Bearer` and cookie headers; Slack, Discord, Telegram and Teams webhook addresses; values of
`password`, `secret`, `token`, `api_key`, `*_PASS`, `*_PWD` and similar in `key=value`,
`key: value` and `--key value` form, quoted values whole; credentials on command lines
(`curl -u user:…`, `mysql -p…`, `sshpass -p`, `redis-cli -a`, `docker login -p`, `openssl …
pass:`); and passwords in URLs. A word like "token" or "password" in a sentence is left alone. The
approval card is deliberately not redacted: you have to see exactly what you approve. The log file
(`nobetci.log`) records what happened — request IDs, tool names, risk levels and decisions — but
not the requests themselves. On macOS and Linux, Nöbetçi keeps its settings and data folders
readable by your account only (0700) and writes the settings, the agenda, their dated copies, the
history and the log for your account only (0600).

**Formula-safe CSV.** Every exported cell is quoted, and a cell — or any line inside it — that
starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe, so a
spreadsheet shows it as text instead of running it. The separator is a comma, or a semicolon for
spreadsheets that expect one.

### What it does not protect against

**It is not a sandbox.** An approved command runs with your full rights. Nöbetçi doesn't contain,
monitor or undo what it does afterwards.

**Heuristics can be evaded.** Quoting and escaping tricks, variables and aliases, a harmless-looking
script written now and run later, package scripts (`npm run …`), payloads hidden in files —
there are many ways to make a dangerous action look ordinary. LOW means "nothing obvious", never
"safe". Read what you approve.

**Software that already runs as you.** Windows draws its security boundary between accounts, not
between programs of the same account, and so do macOS and Linux for files in your home folder.
Anything running as you — including something an approved command started — can edit
`~/.claude/settings.json` (for example to allow everything so Claude Code never asks), change
Nöbetçi's settings or history, replace the relay in `%LOCALAPPDATA%\Nobetci\bin` (Windows),
`~/Library/Application Support/Nobetci/bin` (macOS) or `~/.local/share/nobetci/bin` (Linux), or
simply end Nöbetçi. Nöbetçi scores an agent's request to do any of this CRITICAL or HIGH, but it
can't see what a program does after you approved it. An administrator can do all of that for every
account.

**Decisions made somewhere else.** Nöbetçi only sees the requests the agent would ask you about.
Tool calls that Claude Code's own permission settings already allow, sessions running with
permission checks turned off, and requests answered in the terminal (after **Hand to terminal**, a
timeout, a pause, or while Nöbetçi isn't running) are never reviewed by it. (In the Claude desktop
app, where Nöbetçi asks from `PreToolUse`, it does see calls the app's allow list would have let
through — and makes them wait for the island.)

**Fake keystrokes.** Any program can trigger a global hotkey. That's why the allow hotkey is off by
default and limited to LOW risk; the deny hotkey can be triggered too, but denying is the safe
direction.

**The limits of the click guard.** It proves that a real press landed on the Allow button a moment
before the approval, and each press backs one approval — not that you read the card before
pressing.

- On macOS it rests on the event's source process id, which the system records for posted events.
  Clicks that macOS itself makes on your behalf — Mouse Keys, for instance — look like hardware,
  and a program with Accessibility access can switch such features on; that access already means
  broad control over your Mac, so keep the list short.
- On Linux under Wayland, input the compositor itself injects reaches XWayland as ordinary pointer
  input. GNOME and KDE inject only after a remote-desktop prompt, but wlroots compositors (sway,
  Hyprland, river…) let any program inject through their virtual-pointer protocol, and the guard
  can't tell such a click from yours there.
- On some Windows laptops, precision touchpads report presses without a device handle, as
  `SendInput` does, so the guard refuses them; the log notes each such press. Use a mouse, or turn
  the guard off for LOW and MEDIUM.

If you turn off physical click verification for accessibility, remote control or a touchscreen, a
program that can send input can approve LOW and MEDIUM requests through the island.

**Redaction is best effort.** It recognises common formats; an unusual secret can slip through.
The approval card always shows the full request, so a screenshot or a screen share can expose a
secret that's on it.

**Release integrity.** Releases are started by hand from `main` and built by GitHub Actions from
that commit, with every third-party action pinned to a full commit SHA; the build jobs get no
signing secrets. A `cargo audit` job checks `Cargo.lock` against the RustSec advisory database
whenever the Rust dependencies change and once a week, and Dependabot watches npm and the actions.
`SHA256SUMS.txt` is published next to the Windows installer, the macOS disk image and the Linux
packages. Releases are not code-signed yet (the macOS app is only ad-hoc signed and not
notarized), so a matching hash proves that your download is the file on the release page — not
that the release page itself was never tampered with. See the
[code signing policy](CODE_SIGNING_POLICY.md).

### The rules that keep it this way

Contributions must keep these properties; [CONTRIBUTING.md](CONTRIBUTING.md) explains them in
full. In short: never block Claude Code; never write `~/.claude/settings.json` without a reviewed
diff; never approve HIGH or CRITICAL without a person; never use `innerHTML`; never truncate what
the card shows without flagging it; and no telemetry, no network calls the user didn't switch on,
and no stored secrets.
