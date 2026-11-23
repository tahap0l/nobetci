# Changelog

All notable changes to Nöbetçi are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.5.0] - 2026-11-23

A full audit of 2.4.1 — the code, the real app on Linux, every screen in both languages and all
seven themes, the installers, the website and the documents — turned up the problems below. This
release fixes them, and improves a few things along the way. One change is in how you approve: on
Linux, HIGH and CRITICAL requests are now approved in the terminal (the first point under
Security).

**What was tested where.** Everything was built and tested on Linux, and the app was tried there
on X11, on a virtual display. On Windows and macOS, CI builds the installers and runs the whole
test suite, which passes, but the app itself has not been run on them yet. So these changes have
not been tried there in real use:

- Windows: the relay's pipe hardening and the flush before the pipe closes; the click guard's
  handling of swapped buttons, of touchpads without a device handle and of buttons a program
  holds down; the island's window style (out of Alt-Tab, never taking the focus) and the keyboard
  going back to the window you were in; **Go to window**; the hook commands written for user
  folders with `$` or a backtick; each row's local time in a CSV export; the ChatGPT Web
  registration scripts; and the installer and uninstaller, which were only compiled with NSIS.
- macOS: placing the island and the desktop mascot on screens with different scaling, the desktop
  mascot never taking the keyboard, the menu bar icon, the media card's running check and time
  limits, the Apple Events entitlement, and the click guard's handling of a button a program holds
  down.

The Windows path rules (device paths, 8.3 names, `::$DATA`) are text rules, and their tests pass
on all three systems. On Linux, the desktop mascot's cut without a compositor was checked through
the window shape X reports, not by eye on a real desktop. This is the first release built by the
reworked release jobs; their signing steps have not run, because no code signing is set up yet.

### Security

- **On Linux, HIGH and CRITICAL requests are approved in the terminal.** X11 lets any program you
  run press a button through the real mouse device, and nothing in such a press tells it apart
  from your hand. So on Linux (X11 and XWayland) the island approves no HIGH or CRITICAL request:
  the card says why and offers the hand-off — **Hand to terminal**, or **Hand to Cursor** for a
  Cursor request — and **Deny**, and Rust refuses any approval of it from the island, whether a
  click, a hold or a key. The level that counts is the one on the card, after your rules. LOW and
  MEDIUM requests are still approved on the island, with a click the guard accepts: presses from
  virtual (XTEST) devices count as synthetic, including a pointer a program adds after Nöbetçi
  started (`xinput create-master`). Settings → Safety and the documents say the same. Windows and
  macOS are unchanged.
- **A program's press spoils the click.** Every mouse button a program holds down is followed
  until it is let go, and a real press made meanwhile approves nothing. A program's press of any
  button counts — a wheel button mapped to the click on Linux, either button on Windows whatever
  the swap setting says. The guard follows swapped buttons (left-handed mouse settings on Windows,
  X11 button maps on Linux), so the press it records is the one that acts as the primary click.
- **One click answers one card.** A card accepts no approval in its first 350 ms, and the press
  behind an approval must begin after the card appeared and land on the Allow button inside the
  visible island. The second click of a double-click, or the release of a hold, meant for the card
  before can no longer approve the next request unread — and no longer raises a false "a program
  tried to approve" alarm either.
- **Nöbetçi guards itself on every system.** `nobetci --remove-hooks` is CRITICAL however it is
  run — by any path, piped into a shell, through `xargs`, `$(…)` or a variable, or from an option
  of git, `script`, `tmux` or `env -S` — while a line that only prints, searches or records it (an
  `echo`, a `grep`, a commit message) isn't. Writing to Nöbetçi's folders on Windows, macOS and
  Linux (`~/.config/nobetci`, `~/.local/share/nobetci` and `~/.local/state/nobetci` were not
  covered before), its installed programs, its relay or its socket's fallback folder is CRITICAL
  however the command writes — a redirection, `cp`, `curl -o`, `sed -i`, an editor, a one-liner,
  PowerShell's .NET file calls — and variables, braces, globs, Windows' 8.3 short names, `::$DATA`
  and trailing dots or spaces no longer get a write past these names. Stopping or uninstalling it
  is HIGH, and so is `systemctl --user stop nobetci`. Writing Codex's or Cursor's hook files, or
  Codex's `config.toml`, is CRITICAL.
- **Rules can't be slipped past.** Glob patterns cross line breaks, and a *starts with* pattern
  ends at a word boundary (`npm test` no longer matches `npm testing`). A loose rule that allows or
  lowers a request doesn't cover a command that runs another one — after a new line, `;`, `&&`,
  `||`, `|` or `&`, in backticks or `$( )`, or inside the brackets PowerShell, fish and zsh run
  commands in (`( )`, `@( )`, `{ }`, `=( )`, glob qualifiers) — so it now also leaves
  `git show stash@{0}` to you unless its pattern spells the braces out. A regular-expression allow
  covers only what it matches: `^git (status|diff)` no longer allows `git status; rm …`. A path
  counts where it leads: an allow rule or a "don't ask again" grant must match the path both as
  written and where `..`, `~` or `$HOME` take it, while deny, always-ask and raising rules match
  either — and these other spellings of it: `//etc/x`, `/proc/self/root/…`, `/private/etc/…`,
  `\\?\C:\x`, `\\.\C:\x`, `\??\C:\x`, `\\localhost\C$\x`, trailing dots, spaces or `::$DATA`, and
  8.3 short names of the folders a rule names, but not links, junctions or mounted folders. Deny
  rules still match anywhere, and a rule that matched a path only where it leads never hides a deny
  rule further down.
- **The allow hotkey and batch approval go by the engine's own level.** A HIGH request that a rule
  lowered to LOW is a plain click, never something the hotkey or the batch row's **Allow all** can
  take. The hotkey works only right after a real press of the shortcut, and the batch allows
  exactly the requests its row lists, only once the whole list has been on screen.
- **The risk engine reads commands as commands.**
  - Paths are resolved first: `.claude//settings.json`, `./`, `..` and relative paths no longer
    turn a CRITICAL write into a LOW one, `../../usr/local/bin` counts as a system folder, and
    Claude Code's settings count in the folder `CLAUDE_CONFIG_DIR` names too. The other spellings a
    system accepts count as the path too — `//etc` on Linux and macOS, `/proc/self/root/…` on
    Linux, `\\?\C:\…`, `\??\C:\…`, `\\localhost\C$\…`, 8.3 short names such as `C:\PROGRA~1`, Git
    Bash's `/c/…` — so a write into a system folder is HIGH in any of them.
  - A file copied or moved into a folder is judged under its own name there; archives unpacked
    into a folder, copies of a folder's contents and folders moved or deleted reach what they
    hold; Perl, Ruby and awk one-liners, here-documents fed to an interpreter and PowerShell's .NET
    file calls count as writes; and recursive deletes are judged by where they land (`cd`, `..`,
    `$HOME/*`, `Get-ChildItem | Remove-Item`).
  - Download-and-run in its everyday forms is CRITICAL: `bash -c "$(curl …)"` (Homebrew's
    installer), `bash <(curl …)`, `source <(curl …)`, `eval "$(curl …)"`, a shell by path or
    through `env`, and a download kept in a variable and run. A download saved and run on a later
    line, or unpacked with `tar` or `unzip` and then run, is HIGH.
  - Caught now: `crontab -` and `systemctl --user enable`; shell writes to Claude Code's settings,
    git hooks, `core.hooksPath` and shell startup files, `$PROFILE`, `.bash_aliases`,
    `.zshrc.local`, oh-my-zsh's custom folder and fish functions included; recursive deletes with
    long options, `find -exec rm` and PowerShell's `-Recurse` aliases; every abbreviation of
    `-EncodedCommand`, base64 piped into a shell, and a payload decoded from a here-string, a file
    or `iex([Convert]::FromBase64String(…))`; `doas`, `pkexec`, `run0` and `su`; `git push -uf`;
    and `git restore .`, `git checkout -f` and `git clean --force`, which throw work away.
  - Programs that fake keyboard and mouse input are HIGH — `xdotool` (unless it only looks),
    `xte`, `ydotool`, `wtype`, `xinput` adding or moving pointers, and code that loads XTest,
    uinput, pyautogui, pynput, robotjs, nut-js, `SendInput` or `SendKeys`, whether it runs or is
    written to a file (a document such as a `.md` file excepted) — while their help, read-only
    queries and mentions stay LOW. On Linux that sends them to the terminal.
  - A request too tangled to read in full — nested too deep (`bash -c` inside `eval` inside …),
    handing over too much, thousands of `cd`s — is HIGH, can't be switched off and is never
    approved automatically; it can no longer make Nöbetçi run out of memory.
  - MCP tools are read by the words of their name (`push_files`, `apply_migration`,
    `wipe_device`…), and SQL, command, path and URL arguments are read too, as are tools that
    download, export or save to a path, destination keys, SQL in query tools, Serena's and
    JetBrains' path keys, `file://` addresses and argument arrays. A tool Nöbetçi doesn't know is
    shown and matched with all of its arguments and is never approved automatically; only Bash and
    PowerShell run their `command`, and only WebFetch its `url`.
  - More invisible characters are caught — U+061C, U+2060, the soft hyphen, Hangul fillers, tag
    characters, variation selectors, line separators, control characters — and no-break and wide
    spaces count as blank lines. Tag characters pass only as the England, Scotland and Wales
    flags, and variation selectors and joiners only where emoji or joining scripts use them.
  - "A secret and a way out" stays locked on even when the categories it is made of are switched
    off.
- **The card shows what will be written, all of it.** Write and edit cards show the whole content
  and every edit of a multi-edit, not the first 1,200 bytes. A request that was cut is marked as
  cut in the command box, and one too large for the channel (over 1 MiB) now reaches the card, cut
  and HIGH, instead of going silently to the terminal. Every invisible, direction-changing or
  control character is shown as a marker and can no longer reorder what the box displays. MCP
  cards name the tool's server and pretty-print the arguments.
- **Redaction catches more and masks less.** `curl -u user:password` (and the same flag of `wget`,
  HTTPie, `xh`, `lftp`, `ftp` and `aria2c`), names ending in `_PASS`, `_PWD` or `_PW`
  (`DB_ADMIN_PASS` too), `mysql -p…`, `sshpass -p`, `redis-cli -a`, `docker login -p`, OpenSSL
  passwords, `$env:API_TOKEN=…`, `--from-literal=password=…`, npm's `_authToken`, a URL password
  with no user name, quoted values in full, Slack, Discord, Telegram and Teams webhook addresses,
  the name=value pairs of cookie headers and more vendor tokens are now masked in the history and
  notifications. "Token" or "password" in an ordinary sentence no longer is, and
  `docker run -u 1000:1000` or the rest of a command after a cookie header stays as written. A
  notification is masked before it is shortened, so its cut can't show the start of a secret.
- **Your files are private.** On macOS and Linux, Nöbetçi's settings and data folders and the
  files in them — settings, agenda, history, log and their copies — are readable by your account
  only. On a file system without Unix permissions (FAT, exFAT, some network shares) they are used
  as they are, and the log says so.
- **A settings file read only in part lets nothing more through.** If a rule that was on, or a
  project that wasn't trusted, can't be read, allow rules and rules that lower a risk to LOW are
  off and trusted projects count as normal until the file is fixed, and an auto-allow ceiling that
  can't be read is off; the settings window says so.
- **Settings import takes only Nöbetçi settings.** Importing `~/.claude/settings.json` by mistake
  used to reset every rule, project and shortcut; such files are now refused, and exports carry a
  marker that says what they are.
- **Windows:** the relay opens the pipe without letting the other end impersonate you, and an
  answer is flushed before the pipe closes, so a rule's instant decision is never lost.
- **Only the island answers approvals.** The settings window and the desktop mascot can no longer
  call the approval commands, and the desktop mascot can't send the island events.
- **Linux notifications show text as written.** Where the notification server reads markup, a
  command in a notification can no longer turn into a link or formatting.
- **Dependencies.** rustix moves to 1.1.6, past RUSTSEC-2026-0486; url to 2.5.9, past
  RUSTSEC-2026-0592; and cookie to 0.18.3, past RUSTSEC-2026-0594.
- **Release pipeline.** Releases start only by hand from `main`; the build jobs run with a
  read-only token and no signing secrets, and Windows signing runs in jobs of its own that run
  nothing from the repository, npm or cargo, so the SignPath token never shares a job with
  third-party code; Apple's signing secrets are used only by Apple's own tools; the Windows
  installer now carries the signed programs byte for byte once signing is on; and a new workflow
  checks the Rust dependencies with `cargo audit` on every change and every week.

### Fixed

- **Updating on Windows no longer removes your hooks.** Running a new installer over an old one
  used to uninstall the old version first and take the Claude Code, Codex and Cursor hooks and
  **Start with Windows** with it. An update now keeps them, and the data too, and so does going
  back to an older version with an installer newer than 2.4.1. To go back to 2.4.1 or earlier,
  choose **Do not uninstall** on the page its installer shows.
- **Uninstalling on Windows is safer.** It asks about a running Nöbetçi before anything is touched
  (Cancel really changes nothing); if the hooks can't be removed it keeps the relay and the log
  and says what to finish by hand: which hook files to clean (also under `CLAUDE_CONFIG_DIR` or
  `CODEX_HOME`), and to delete only the relay folder and the log, so your history stays;
  **Delete the application data** now deletes your settings, agenda, history and log; the ChatGPT
  Web bridge's browser registration is removed (an update keeps it); the machine-wide **Start with
  Windows** entry is removed when possible; and the installer falls back to English, not Turkish,
  on other Windows languages.
- **Cursor isn't blocked when Nöbetçi is closed.** When Nöbetçi gives no answer — closed, paused,
  handed back, queue full or timed out — Cursor now asks you itself instead of refusing every
  shell and MCP command. A relay that can't run at all still makes Cursor refuse.
- **Denying no longer stops Claude.** A plain deny — the button, a reason, the hotkey or a rule —
  lets Claude read your message and carry on another way; **Deny and stop Claude** ends its turn.
  Before, every deny ended the turn. Codex and Cursor can't be stopped from a hook, so their cards
  offer the reasons without **Deny and stop**.
- **Session notifications are sent again.** With the default settings they never were; now a
  notification comes whenever the island isn't open (the compact pill counts as not showing it).
- **The resting island goes quiet.** The owl falls asleep after three minutes of calm and the
  island stops drawing (it used to cost about 12 % CPU forever); far from the island, the cursor
  is checked less often. Quiet hours take effect on time, without waiting for a Claude event, and
  the strip at the top of the screen always wakes the island (it could stop reacting after a
  pause).
- **The assistant opened with the shortcut closes again** with Esc, ✕, the shortcut or the toggle,
  and while it isn't on screen it takes no keys and sends nothing on Enter.
- **ChatGPT Web reaches the island.** The bridge's messages were dropped by the app since 2.1.4;
  its guide is in English and Turkish now (the Turkish one opens from a Turkish interface),
  registers without changing the PowerShell policy, works when your Windows user folder has
  letters outside ASCII, has an unregister script, and the extension backs off while Nöbetçi is
  closed.
- **No more lost data.**
  - An unreadable `settings.json` is copied aside as `settings.json.unreadable-…`, the window says
    so, and nothing is saved over the original until you restart. If only a few values are bad,
    every value that still reads is kept — deny rules and strict projects stay in force — and the
    window says which were left at their defaults.
  - An agenda file with a byte-order mark or a bad entry keeps everything else, and is copied
    aside before anything is saved over it. A file that can't be read is never written over, and
    the agenda card says it couldn't read `agenda.json` instead of showing an empty day. A full
    agenda (300 items) makes room by dropping the oldest finished item, and otherwise says it is
    full instead of silently dropping old items.
  - An import or a reset keeps the settings it replaces as `settings.json.bak-…`, two saves at once
    can no longer mix their contents, and a settings file saved by Notepad imports.
  - A save that fails says so instead of "Saved", a reset or an import whose save fails says the
    settings are in effect until Nöbetçi restarts but weren't saved, and a failed agenda change is
    undone on screen.
- **Long approval cards keep their buttons.** The findings scroll and the buttons stay pinned to the
  bottom of the island; the card no longer jumps or flashes a hint while it settles, and a cut
  multi-edit shows one scroll hint, clear of the line that says the request was cut.
- **Right-click → Reload is gone.** The webview's own menu and reload keys could drop a waiting
  request; text fields keep their copy-and-paste menu, and waiting cards come back if the island
  ever reloads.
- **The approval card.**
  - The 1/N in the header is a real pager: look at the queued requests without answering them.
  - The batch row lists what it will allow, has room for six requests before it scrolls, and never
    appears under the pointer where another button was.
  - "Don't ask again" says what it covers: this exact command, changes to this file, this address
    or this tool with these arguments.
  - Why an action was refused ("hold the button", "LOW only for the hotkey") is shown on the card.
  - The deny menu is never cut off by the screen edge and opens with a short transition; Esc
    closes it.
  - Enter or Space on Allow no longer sets off the "not a physical click" alarm; a slow click
    counts from its release.
  - While a card waits, header buttons that can't act look disabled and say why, and **Pause**
    notes the handed-back requests on the session's timeline.
  - Long commands wrap at spaces and the command, preview and plan boxes grow into free room; an
    edit shows the new text first, then what it replaces, and says so when it replaces every
    occurrence; text after a collapsed run of blank lines keeps its indentation; a highlight after
    a dotted İ no longer lands a few letters off.
  - Cursor cards say **Hand to Cursor**, and Claude app cards **Hand to Claude**. When one of them
    takes a request over — handed back, paused or timed out — the timeline names it instead of the
    terminal, and so does the history for a request you handed back.
  - Themed scrollbars and checkbox, readable hints, and MEDIUM in yellow and HIGH in red-orange.
  - The pulsing CRITICAL badge stops when the island isn't open and under reduced motion.
- **Question and plan cards.** A question with spaces around it can be answered; a typed answer
  and a highlighted option no longer both look chosen; unanswered questions below are pointed out;
  and what you typed on a question or plan card survives looking at another request. Plans show
  nested lists, numbered lists that start anywhere, italics, links with their titles, rules, code
  blocks with their language, and tables with every column.
- **Cards that stayed or vanished.** A card whose session moved on is dropped; a card arriving
  during the greeting no longer leaves the island stuck; after a suspend or clock change an
  expired card is handed to the terminal at once instead of waiting. An answer that never reached
  the agent (it had stopped waiting) shows as **Not delivered** on the session's timeline and no
  longer counts as approved or denied.
- **The island's views.** The session view no longer grows on every update, opening a diff no
  longer squashes the file list, more than five sessions can be scrolled to, rows react to every
  click and light up on hover in every theme, secondary text is easier to read, the empty view and
  the session list replace each other, a paused island stops showing "Working" and offers Resume,
  and the weekly limit's reset shows its day. The pill shows a long message in full on hover and
  `+N` for sessions beyond four, a right or middle click on it no longer opens the island, and
  opening or folding the island no longer flashes the pill's text over the cards or leaves the
  mascot hanging below the pill. Slash commands work in capitals, and the session search takes the
  keyboard on Windows and Linux.
- **The island's cards.** The focus timer's ring no longer covers its button, and the end of a
  focus session is heard and shown, and sends a desktop notification when notifications are on;
  the system card's rings turn red at 85 %, and a hanging GPU driver can no longer pile up
  processes behind it; the agenda's add row is wide enough to read, items can be edited, and
  refusal notes wrap instead of being cut off; a reminder in the past is pointed out and fires
  once on the night clocks change; the music card says when it is off (with a button to turn it
  on) or when nothing plays, and reads the player only while it or the pill's widget line is on
  screen; the calendar works with the keyboard and names both months of a week that spans two;
  Turkish wind speed is "km/sa"; the snow icon is visible.
- **The assistant.** Tab completion and ↑ history stick, all targets can be scrolled to, a long
  answer scrolls with its Copy button, the Turkish key hint fits, Esc closes the prompt library,
  `/play`, `/next` and `/prev` work with the media card switched off on a player that is already
  running (with none, the assistant says so), and Linux shows no dictation button it can't use.
  It says when an app may already have sent your message — ChatGPT, Claude, Perplexity, Copilot
  and Grok on the web, the ChatGPT and Perplexity apps — instead of telling you to press send.
- **Searching in Turkish.** İ, I, ı and i match each other in the session search, the history
  search and the risk categories.
- **Settings window.**
  - Dialogs and the history drawer are opaque in every theme and keep the keyboard inside; the
    page behind can't be changed while a diff is open, and changing the hook events invalidates
    an open preview, so what is written is what you reviewed.
  - Button text is readable in all seven themes, the whole window takes the mascot's colours, the
    risk levels take the island's, a click no longer replays the page's entrance animation, and
    nothing is cut off in small windows.
  - Quiet hours with the same start and end now say they never apply — in the General tab's
    summary too — and point to Do not disturb, and times follow the UI language's clock.
  - The rule editor checks a regular expression with the same engine the rules use, warns before
    an empty pattern covers every tool, explains how file paths are matched and when a deny rule
    further down decides, and asks before discarding edits; the template menu no longer stacks
    copies.
  - Project paths are stored when you finish them — Enter, leaving the field, a folder pick, a tab
    change or closing the window — never half-typed during a redraw or a minimise; quotes and
    spaces around them are removed (with a notice while you type), in imported settings too, and
    Undo restores the row as it was.
  - The shortcut recorder registers the key your layout labels (Windows, Linux) and on a Mac says
    that keys go by position; Tab and Shift+Tab move on instead of being recorded, and a shortcut
    needs Ctrl, Alt or Super/⌘ (F1–F24 excepted).
  - The risk testers build requests the way the real engine sees them, with a working folder that
    fits your system.
  - The history's stats survive a reload, its chart, durations and empty states are right, its day
    bars follow daylight saving, the list starts where the stats start, the target gets its room
    (MCP tools as server › tool, the full text on hover), and the filters are never cut off.
  - The health check knows a status line that belongs to someone else and explains `PreToolUse`;
    hooks can't be installed while the relay is missing, and they go to
    `$CLAUDE_CONFIG_DIR/settings.json` when Claude Code keeps its settings there and Nöbetçi itself
    sees that variable (Settings → Claude Code shows the file); on Windows the page says when hooks
    can run only where Claude Code uses Git Bash.
  - For other agents, the Cursor note says Cursor asks you itself when Nöbetçi gives no answer, a
    "Connected" message no longer outlives hooks removed outside the window, connecting no longer
    promises a backup when there is no file, and a review that changes nothing shows no backup line.
  - The first-run wizard shows its errors, ticks only the steps you did — a health check with gaps
    counts as skipped — and a late start-up event no longer reopens or resets it; **Reset to
    defaults** no longer brings it back.
  - Prompt Studio's model name no longer snaps back or merges while you type; Esc on an inline
    question ("Clear history…", "Reset to defaults…") cancels it instead of closing the window; and
    the assistant's app list says which apps may send your message as soon as they open.
  - macOS and Linux get their own wording where Windows' made no sense, and messages follow a
    language switch.
- **Start with Windows / at login follows the system.** Switched off or removed in Task Manager,
  Login Items or your desktop's autostart settings, it shows as off instead of coming back, and a
  change that fails is reported.
- **Hooks are installed and removed precisely.** Only Nöbetçi's own hook commands are touched —
  never another tool's hook in the same group, while a relay path an older version wrote in
  Windows' 8.3 short form still counts as Nöbetçi's — the file keeps its key order, a symlinked
  `settings.json` is written through the link, the preview is worked out on the file's own text
  and layout (a change of line endings is named at its top) and a file that needs no change isn't
  rewritten, the backup named in the preview is the one written (and none is announced when there
  was no file), and `nobetci --remove-hooks` reports failure with its exit code.
- **History.** Every outcome is recorded: requests too large for the channel, questions and plans
  handed straight to the terminal, and answers that never reached the agent, marked **Not
  delivered**. One damaged line no longer hides the whole file, a failed roll-over no longer drops
  the decision, a history file emptied or replaced is read again from the start, and the history
  is read once and kept, not parsed three times per refresh, without stalling the island while
  History loads.
- **Mascots.**
  - The island's canvas is wider than the mascot, so wings, tails, manes and huffs are no longer
    cut off.
  - Reactions blend into each other, a hop retriggered in mid-air continues from where it was,
    hops crouch before they jump and land with a squash, the cheer flutters and settles, eyes close
    into a smile from below, the dizzy spin no longer whips back or shows face markings on the back
    of the head, and blinks and level of detail no longer pop.
  - Reduced motion is honoured by the island's mascot, the small heads in the session list, the
    pill and the gallery, the desktop mascot and the greeting, and under it the island opens
    without overshooting.
  - The desktop mascot draws nothing while it sleeps, while it is hidden and while Nöbetçi is
    paused (it used to redraw about 15 times a second); Ctrl+wheel resizing keeps its feet where
    they are; it shows a grabbing cursor while you hold it; and a double-click opens the island
    without poking, frowning or getting dizzy first.
  - The installer's owl ends its cheer on a clean frame.
  - The mood fits Claude's questions and **Pause**; the small mascots in the list and the pill
    move smoothly.
- **English and Turkish everywhere.** "1 session", not "1 sessions"; no Turkish-only error
  messages in the browser preview or the website's demo.
- **macOS.** The island and the desktop mascot open at the right place and size on screens with
  different scaling (after the update the desktop mascot may move, or go back to its corner,
  once); the desktop mascot never takes the keyboard; the media card no longer starts a player
  that was just closed, and a stuck player can't pile up `osascript` processes; the menu bar icon
  follows light and dark mode.
- **Linux.**
  - The AppImage plays the island's sounds (it now carries GStreamer, and is about 11–15 MB
    bigger), and programs it opens get your desktop's own GTK and GStreamer settings rather than
    the AppImage's; programs opened from Nöbetçi no longer inherit its X11 setting either.
  - Clicking the island no longer takes the keyboard from your terminal; the assistant opened with
    its shortcut takes your typing on the first try, and when you leave an island text box the
    keyboard goes back to the window you were in.
  - Without a compositor, the island's window is cut down to the island (square corners, no
    shadow) and the desktop mascot's to the mascot, instead of black boxes, and the log says so
    once.
  - The desktop mascot's window takes the mascot's size; it was stuck at 200×200.
  - A login entry your desktop switched off (`Hidden=true`) turns **Start at login** off, and a
    moved AppImage is put into the entry's `Exec=` line without touching what you added there.
  - The media card only talks to a player that is already running, and one with an odd bus name
    can't crash it; the `.deb` no longer lists its dependencies twice.
  - The relay's socket file is removed when Nöbetçi quits or is stopped (`SIGTERM`, `SIGINT`), on
    macOS too.
- **Windows.** The island stays out of Alt-Tab and never takes focus after it changes its window
  flags, and when you leave an island text box the keyboard goes back to the window you were in;
  **Go to window** no longer opens the target app's menu bar; a press without a device handle
  (some precision touchpads) is written to the log; and a user folder with `$`, a backtick or other
  shell characters no longer breaks the hooks.
- **False alarms.** A download read as data (`curl … | python3 -m json.tool`), a commit message
  about a "graceful shutdown" or one that mentions `sudo`, `--dry-run`, `.env.example`,
  `npm i -D rimraf`, emoji with joiners, edits inside a project that lives under `/usr` or `/opt`,
  and files merely named `cookies` or `credentials` no longer score HIGH or CRITICAL.
- **CSV export.** Choose a comma or a semicolon (for Excel in Turkish and other languages that
  expect one); every line of a cell, and whatever follows a comma or a semicolon in it, is
  formula-safe; and each row's time is the local time of that day, daylight saving included.

### Changed

- **The documents tell it straight.** No release has been code-signed so far, v2.4.1 included,
  and the README, the code signing and privacy policies and the website now say so; uninstalling
  is described for every system, including how to remove Codex and Cursor hooks on macOS and
  Linux and how to unregister the ChatGPT Web bridge; the installation guide covers Codex, Cursor,
  Wayland's limits, the compositor Linux needs, the Claude desktop app's wait and touchpads that
  the click guard refuses. They also say that on Linux HIGH and CRITICAL requests are approved in
  the terminal, how to go back to 2.4.1 without losing the hooks, and which spellings of a path a
  deny rule catches.
- **Releases.** The notes list the Linux files and say whether the release is signed and
  notarized, and every file also comes without the version in its name
  (`Nobetci-setup.exe`, `Nobetci-macos-universal.dmg`, `Nobetci-linux-amd64.deb`,
  `Nobetci-linux-amd64.AppImage`) for links that always fetch the newest one.
- **macOS.** A Big Sur–style icon, a disk image whose labels are readable in light and dark mode,
  and the name Nöbetçi in Finder and the Dock (the app on disk is still `Nobetci.app`). The app is
  signed with the Apple Events entitlement that the media card's AppleScript needs under macOS's
  hardened runtime.
- **The website** speaks your language from the first paint, covers 2.4 (questions, plans, batch
  approval, Codex and Cursor), works on phones (the live demo pans, pauses off screen and has a
  Pause button), shows a new link-preview image, carries its security policy in the pages
  themselves, and has bilingual policy and 404 pages; the demo's cards and deny reasons follow the
  page language.
- **Focus length** is 5 to 180 minutes everywhere.

### Added

- **A live mascot preview** in Settings: the theme picker shows each mascot moving, and the
  first-run wizard greets you with yours.
- **Livelier mascots**: an occasional glance, head tilt or ear and tail flick when idle; ears,
  tails, manes and tentacles that follow the body; brows on the hawk and eagle that show their
  mood; and an octopus whose skirt and tentacles sway.
- **The history keeps what the risk engine said.** When one of your rules changed a request's
  level, the history keeps the engine's own level too: Settings → History shows it beside the
  decided one, and the CSV export has an `engine_level` column (`motor_riski` in Turkish). Findings
  recorded from now on are shown in the language you use, whichever one was on when they were
  recorded.

## [2.4.1] - 2026-11-19

### Changed

- **A new look for the Windows installer.** Dark welcome and finish pages in Nöbetçi's colours, with
  a little island and the owl in the sidebar: it waves on the welcome page and cheers when setup is
  done. New welcome and finish texts in Turkish and English, and the owl in the header of every
  page. The pictures are drawn with the app's own mascot engine (`scripts/installer-art.mjs`).
- **A new look for the macOS disk image too.** The window that opens with the `.dmg` has the
  same night sky, the island and a soft arrow from Nöbetçi to Applications, with the instruction in
  Turkish and English, sharp on Retina screens.

## [2.4.0] - 2026-11-19

### Added

- **Answer Claude's questions on the island.** When Claude asks a multiple-choice question
  (AskUserQuestion), the card shows every question with its options; pick one or several, or
  write your own answer, and send. Works in the terminal, VS Code and the Claude desktop app.
  **Hand to terminal** gives the question back.
- **Approve plans on the island.** When Claude finishes a plan (ExitPlanMode), the card shows it
  as formatted text. **Approve plan**, or write what to change and **Send back with note**: Claude
  reads the note and keeps planning. Turn both off under **Settings → Claude Code → Questions and
  plans**.
- **Changed files with diffs.** The session view lists every file the session edited or created
  with lines added and removed; click one to read its diff.
- **Context and plan limits.** Tick **StatusLine** under **Settings → Claude Code → Events** and
  the session view shows context use and the session's cost, the island header shows the 5-hour
  limit, and meters show the 5-hour and weekly windows with their reset times. It uses Claude
  Code's own status line (a short line under the prompt), so it is opt-in, and Nöbetçi never
  replaces a status line of yours.
- **Allow all low-risk requests at once.** With two or more LOW requests waiting, one click allows
  them all. Medium and above, questions and plans are never part of it, and the click must be a
  real one when the click guard is on. The history marks them **Batch (low risk)**.

## [2.3.3] - 2026-11-19

### Fixed

- **The Claude desktop app on Windows.** Claude Code runs a hook in Git Bash, or in PowerShell when it
  cannot find Git Bash, which is often the case in the Claude desktop app even when the terminal
  finds it. Nöbetçi wrote its hooks as a quoted path, which PowerShell reads as a plain string, so
  in the app the relay never ran and nothing reached the island. The hooks are now a bare path
  that runs in both shells (the 8.3 short form when the path has spaces).
- **Update the hooks once:** Settings → Claude Code says the hooks are out of date; review the
  change and reinstall, then restart the Claude desktop app.

## [2.3.2] - 2026-11-16

### Fixed

- **Approvals from the Claude desktop app.** The Code tab of the Claude desktop app shows its own
  permission dialog and never runs Claude Code's `PermissionRequest` hook, so its requests never
  reached the island. Nöbetçi now asks from the `PreToolUse` hook there instead: commands, file
  edits, web fetches and MCP tools wait for your decision on the island, with the same risk score,
  hold and real-click guard. Reads never wait, and nothing waits in a mode where the app would not
  ask (Accept edits for file edits, Bypass permissions). With no answer, or with Nöbetçi closed,
  the app's own dialog appears as before. The terminal and VS Code are unchanged.
- **Update the hooks once:** Settings → Claude Code says the hooks are out of date (the
  `PreToolUse` entry gets the same timeout as `PermissionRequest`); review the diff and reinstall.

## [2.3.1] - 2026-11-15

### Added

- **Voice input** in the assistant: the microphone button starts the system's own dictation
  (Windows voice typing, macOS Dictation) into the text box. Nöbetçi never hears the audio.
- **Prompt ideas**: about twenty ready-made prompts in six groups (getting started, writing,
  learning, work, code, everyday), in Turkish and English. Each one shows how a good prompt is
  built; the parts in [brackets] are selected for you, and Tab jumps to the next one.
- **Desktop AI apps first**: when the Claude, ChatGPT, Perplexity or Copilot app is installed, the
  assistant opens the message there instead of the browser (Claude, ChatGPT and Perplexity get the
  text in their box; the app never sends it for you). A green dot marks those targets; switch it
  off under **Settings → General → Assistant**.
- **Agenda**: a small to-do list per day on the island, with an optional time that reminds you
  with a notification (silent during do-not-disturb). The calendar shows dots on busy days and a
  click on a day opens its agenda; the compact island mentions the next item.
- **System card**: processor, memory and graphics load as live rings, with a minute of CPU history.
  Read only while the card is on screen.
- **Focus length**: set the timer from 5 to 120 minutes in Settings, or with − and + on the card.
- **Mascot sizes**: the island's mascot can be 80–130 % of its size; the desktop mascot also
  resizes with Ctrl (⌘) + mouse wheel.

### Changed

- **Weather** shows an animated icon, high and low, feels-like and wind, and the next twelve hours
  in steps of three. One request is shared and reused for ten minutes; 17 more cities.
- **Calendar**: day pills that slide when you change weeks, and a **Today** button.
- **Island motion**: the width opens a moment before the height, content rises out of a light blur
  piece by piece, and a sliding pill marks the selected card. Looping animations only run while
  the island is open.
- The empty island was a little too short for its cards; it now fits them.
- Tauri 2.12.5.

## [2.3.0] - 2026-11-14

### Added

- **Linux.** A `.deb` and an AppImage for x86-64. The island runs on X11 and, through XWayland, on
  Wayland desktops; the relay talks over a Unix socket in `~/.local/state/nobetci` and checks the
  peer's user id; the click guard reads XInput2 raw events and refuses XTEST clicks (`xdotool`);
  quiet in full screen, **Go to window**, start at login and the Secret Service keyring all work.
- **An assistant on the island** (`Ctrl+Alt+Space` or the ✦ button). Write a message and send it to
  ChatGPT, Claude, Gemini, Perplexity, Copilot, Grok, DeepSeek or Mistral: the app opens with the
  message (where it accepts one in its address) and the message is on the clipboard too. **Here**
  answers on the island with the Prompt Studio model. Slash commands (`/pause`, `/dnd`, `/focus 25`,
  `/play`, `/next`, `/prev`, `/settings`, in Turkish too) control Nöbetçi, and ↑/↓ bring back
  earlier messages. The island takes the keyboard only while you type there.
- **A new media card**: the artwork blurred behind the card, a live time bar you can click (or
  move with ←/→) to seek, and larger controls. It now works on all three systems — the system
  media controls on Windows, Spotify and Music on macOS, every MPRIS player on Linux.
- **Mascot size**: make the desktop mascot 60–200 % of its size in **Settings → General → Desktop
  mascot**; it keeps standing where it was.
- Claude Code sessions from the **Claude desktop app** (its Code tab) and from VS Code are named as
  such on the island; the hand-off button reads **Hand to Claude** for them.

### Changed

- **macOS is no longer a beta.** The island is a non-activating panel that never takes focus,
  quiet in full screen works, and the media card follows Spotify and Music.
- A refreshed settings window: ambient light behind a glass sidebar and header, cards with an
  icon chip and a soft sheen, the island's violet as the accent, gentler motion.

### Security

- Update `rustls-webpki` to 0.103.17 (RUSTSEC-2026-0382: certificate checks could accept a
  distrusted intermediate). It is used by the Prompt Studio's OpenAI connection and the weather card.

## [2.2.0] - 2026-11-14

### Added

- A desktop mascot: the island's mascot in a window of its own that you drag anywhere on the
  screen with the mouse. It remembers where you left it (and comes back to a corner if that display
  is gone), spreads its wings while carried and lands with a bounce, shares the island's mood, pokes
  back on a click and opens the island on a double click. It never takes keyboard focus, falls
  asleep after two minutes of calm and then stops drawing. Switch it in **Settings → General →
  Desktop mascot** or from the tray menu; it can also be sent back to its corner from there.
  Decisions are still made only on the island's card.
- New reactions to decisions, for all seven mascots. Approving: smiling eyes and rosy cheeks, two
  nods, two hops with the wings up, and a green tick that draws itself in a burst of sparkles.
  Denying: a frown with narrowed eyes and pinned-back ears, bristling feathers, a head shake, huffs
  of steam and a red cross. Requests a rule denies get the same reaction. The web demo plays them
  too.

### Fixed

- Never approve a request automatically when the risk engine scored it HIGH or CRITICAL, even after
  a re-scoring rule lowered it. A broad rule such as "git push → LOW" used to let a force push
  through on its own in a trusted project; now it is a plain click. "Don't ask again in this
  session" is only offered where it can take effect.
- Score MCP tools by their name even when an argument is called `url` or `command`, and check those
  arguments with the web and command rules as well. `mcp__notion__delete_page` with a `url` was
  scored as an ordinary LOW web request.
- Show and match every MCP argument: the card, rules and session grants used to see only the first
  600 characters.
- Flag downloaded code run through a longer pipe (`curl … | tee x | bash`, CRITICAL) and fetched
  then run in the same command (`curl -o x.sh … && bash x.sh`, `chmod +x`, `source`, HIGH).
- Treat Claude Code's `WebSearch` as a known web request instead of an unrecognized one.
- Close a card when the request was answered in the terminal. Claude Code sends `PostToolUse`
  with a `tool_use_id` that `PermissionRequest` never has, so the card stayed until it timed out.
  Long commands, cut by the relay in the later event, are matched too.
- Stop keeping a record of every answered request in the island's memory, and stop showing
  "waiting for approval" on sessions whose requests were handed to the terminal by Pause.
- Keep a copy of a settings file that cannot be read before falling back to defaults, accept a
  UTF-8 BOM in it, and write it atomically, so a crash or a hand edit no longer wipes every rule.
- Give every rule its own id; rules added in the same millisecond shared one.
- Write the CSV export's header and the Codex/Cursor diff header in the app's language.

### Changed

- Offer Claude Code's `PreCompact` and `PostCompact` events, which the island already shows.
- Build the front end for Safari 14 on macOS, the WebView macOS 11 ships.
- Update Vite to 8, TypeScript to 7, the Tauri plugins and the CI actions; this clears the two
  high-severity advisories `npm audit` reported for Vite 6. Building from source now needs
  Node.js 22 or newer (20.19 also works).

## [2.1.7] - 2026-11-11

### Changed

- Give the wolf, hawk, octopus, lion, canary, and eagle a full body and every movement the owl has. On
  the island and in the greeting they now breathe, blink, follow the pointer, wave at a permission
  request, bristle at a risky one, hop when a session finishes, doze, and get dizzy when poked, each with
  its own ears, face, limbs, feet, and tail.
- Redraw the same six mascots for session rows and the settings gallery in the owl's style: flat colors, a
  dark outline, large rimmed eyes, and the owl's expressions. The website and web demo use the same
  drawings.
- Draw the island's tab, focus timer, calendar, and media settings icons, and the website's feature
  icons, as line icons instead of font symbols, so they look the same on every system.
- Show the same animated, full-body mascots on the website: the home page companion and the web demo now
  run the app's own mascot engine, and fall back to the drawn heads if it does not load.
- Refresh every README image and add a picture of all seven mascots. `npm run screenshots` now renders
  all of them, including the first image and the mascot picture, and runs on macOS and Linux with any
  Chromium-based browser.

## [2.1.6] - 2026-11-10

### Fixed

- Launch Windows Codex hooks with PowerShell's call operator. The health check distinguishes the
  relay test signal from the last live Codex event. Review and trust the repaired hooks again after updating.
- Keep the session list reachable when the expanded island is crowded.
- Publish the website and demo on GitHub Pages as an alternate address.

### Changed

- Split the expanded island into Media & focus, Calendar, and Weather with vertical navigation,
  themed transitions, and table layouts for the weekly calendar and current weather.
- Show media artwork and supported playback controls on Windows, and count active subagents in session details.
- Animate all seven web mascots with distinct reactions to pending, risky, approved, and denied requests.

## [2.1.5] - 2026-11-10

- Slim down the idle island and replace the large music card with a horizontal player next to the focus timer.
- Redraw the wolf with larger eyes that follow the pointer and look toward permission requests.
- Refresh the website demo and README previews.

## [2.1.4] - 2026-11-10

- Put sessions awaiting attention first and add keyboard search by project, agent, or terminal.
- Show before-and-after excerpts for edit requests and require manual review for unrecognized or incomplete requests.
- Verify physical holds for high-risk approvals and limit concurrent relay connections and initial message time.
- Detect outdated Codex SessionEnd timeouts and keep other hooks when reinstalling. Refuse to write hook settings changed since preview.
- Add a Spotify playback animation with reduced-motion support and a gallery of seven illustrated mascots.

- Give ChatGPT a dedicated settings tab alongside Claude Code and link to it from the island.
- Add a relay health check and report incomplete hook installations for local ChatGPT Work, Codex, and Cursor.
- Document the desktop Hooks list workaround. Work Cloud does not run local hooks, and live ChatGPT approval delivery has not yet been verified.

## [2.1.3] - 2026-11-09

- Redesigned the expanded Dynamic Island with animated agent, media, and focus cards.
- Added a 25-minute focus timer with pause and reset. Calendar and weather remain one swipe away.
- Added a ChatGPT Web setup entry under Other agents.

## [2.1.2] - 2026-11-09

- Keep the compact Dynamic Island visible while idle and show the date, weather, and active Windows media in rotation.
- Add a weekly calendar and swipe between calendar, weather, and media cards. Agent approvals still take priority.
- Refresh desktop and demo mascot artwork and update the English and Turkish README files.
- Add an opt-in ChatGPT Web response-status bridge for Chrome and Edge on Windows.

## [2.1.1] - 2026-11-09

- Added optional weather and Windows media controls to the desktop island, including when no agent session is active.
- Added Codex context compaction events and a shortcut to Codex and Cursor setup.

## [2.1.0] - 2026-11-09

- Added seven mascot themes with saved preferences.
- Show the session working directory on approval cards.
- Added an interactive approval demo to the website.

## [2.0.2] - 2026-10-20

### Added

- **Codex and Cursor monitoring.** Install their local hooks from Settings → Other agents to track sessions and submitted prompts. Codex permission requests and Cursor shell/MCP requests can be reviewed from the island; exact configuration diffs and timestamped backups are shown before changing settings.
- **Safe prompt handling.** Prompt events are recorded in the session timeline. Agent hooks cannot replace submitted text, so typo correction stays in Prompt Studio and the user pastes the reviewed result.
- **Safe fallback and cleanup.** Cursor permission hooks fail closed; if Nöbetçi cannot decide, the action is denied with a retry message. Uninstall removes only Nöbetçi's own hooks.

## [2.0.1] - 2026-10-20

### Added

- **Prompt Studio.** Revise messages for Claude Code, Codex, Cursor, ChatGPT, Gemini and other agents. Local Ollama is the default; OpenAI API is optional and explicit. Review and copy the result yourself.
- **Microsoft Store preparation.** Add an offline package configuration and bilingual privacy and submission guidance.


## [0.2.0] - 2026-10-03

The first public release: a watchful owl for Claude Code on Windows 10 and 11 and, as a beta, on
macOS 11 or later.

### Added

- **The island.** A small owl on a black island at the top of the screen shows every Claude Code
  session on its own row — what it's doing, for how long, and whether it's done, failed or waiting
  for you. A session detail view adds a timeline of recent steps, counters, **Go to window** (brings
  the session's terminal or editor to the front) and the project folder. The island opens by
  itself for permission requests, errors and questions, and folds into a thin strip at the top
  edge when nothing needs you.
- **Approval cards** for Claude Code's permission requests: the full command, file path, URL or
  MCP arguments with the risky parts highlighted; a queue of up to six requests; a countdown to
  when the terminal takes over; **Allow**, **Deny**, deny with a ready-made reason that Claude
  reads, **Deny and stop Claude**, **Hand to terminal**, and "don't ask again for this request in
  this session" wherever the auto-allow ceiling allows it.
- **A risk engine** that scores every request LOW, MEDIUM, HIGH or CRITICAL and says why. It reads
  commands (Bash and PowerShell), file writes and their content, file reads, web requests and MCP
  tools, and covers dozens of categories: download-and-execute, encoded commands, tampering with
  security tools (Defender, Gatekeeper, SIP, firewalls), persistence (Run keys, scheduled tasks,
  LaunchAgents), suspicious built-in Windows tools, secrets and exfiltration (the macOS keychain
  included),
  destructive git operations, publishing, cloud and database deletions, changes to Claude Code's
  own settings and hooks, changes to Nöbetçi's own files, invisible characters, content hidden behind long runs of whitespace,
  and more. Categories can be switched off one by one, except the two that catch hiding.
- **Press and hold to allow** HIGH requests (1.2 s by default) and CRITICAL ones (2.4 s).
- **Rules** that match on tool, pattern (contains, starts with, equals, glob or regex) and project
  folder, and then allow, deny with a message for Claude, always ask, or re-score a request.
  The first match wins. Comes with templates and a tester that evaluates a draft before you save.
- **Project trust** — trusted, normal or strict — and an **auto-allow ceiling** (off, LOW only,
  or LOW + MEDIUM) for everything that decides without you.
- **History**: every permission request with its risk, findings, decision, who decided and how
  long it took. Search, filters, statistics and charts, and CSV or JSON export of everything that
  matches. The log rolls over at a configurable size and can be turned off or cleared.
- **Notifications and quiet**: desktop notifications while the island is out of sight; do not
  disturb, quiet hours and (on Windows) quiet in full screen; synthesised sounds that can be muted one by one.
- **Global hotkeys** to open the island, deny, allow (LOW only, not set by default) and toggle do
  not disturb.
- **A settings window** with General, Claude Code, Safety, Rules, Notifications, History and About
  pages, settings import, export and reset — and a **welcome wizard** on first launch.
- **A careful hook installer** for `~/.claude/settings.json`: it shows a diff, saves a dated
  backup, merges without touching other tools' hooks, writes only after you confirm, and refuses if
  the file changed in the meantime. You choose which hook events to install, and a **health
  check** pings the app through the real relay.
- **English and Turkish**, following the system language unless you pick one. What
  Claude is told when you deny a request follows the same language.
- **Placement and behaviour**: the island can sit left, centre or right, on the main display or the
  one with the mouse; start with Windows or at login; adjustable auto-close and stale-session
  cleanup.
- **A per-user installer** that needs no administrator rights. Uninstalling removes Nöbetçi's own
  hook entries from `~/.claude/settings.json` (with a dated backup) and nothing else.
- **macOS (beta)**: one universal app for Apple silicon and Intel in a disk image. It lives in the
  menu bar, the island sits just below the menu bar (clear of the notch), the relay talks to the
  app over a private Unix socket, **Go to window** brings the session's app to the front, and the
  shortcuts use ⌃ Control and ⌥ Option. Quiet in full screen isn't available on macOS yet.
- **Release builds** from GitHub Actions for both systems, with `SHA256SUMS.txt` published next to
  the Windows installer and the macOS disk image.

### Security

- The hold for HIGH and CRITICAL requests, and the cap that keeps them from ever being approved
  automatically, are enforced in Rust; a hand-edited settings file can't lift the cap. Session
  grants obey the same auto-allow ceiling as rules and trusted projects.
- Approvals must come from a physical mouse click on the Allow button: Windows Raw Input tells
  real presses from clicks synthesised with `SendInput` and from UI Automation invokes, and on
  macOS the event's source process tells a real mouse or trackpad from posted events and
  accessibility presses; anything else is refused and shown on the card. Each real press backs exactly one approval. The guard only listens while a request is waiting, and can be switched off for
  accessibility tools.
- The channel between the relay and the app is yours alone: on Windows a per-user named pipe with
  an explicit DACL (your account and SYSTEM only) that rejects remote clients, on macOS a Unix
  socket in a 0700 folder whose peers must run as you. Either way the relay checks that the app
  on the other end runs as you before sending anything.
- Approval payloads up to 64 KiB travel whole; anything longer is flagged and scored HIGH, never
  shortened silently. Invisible and bidirectional characters, and long runs of blank lines or
  spaces, are made visible on the card, and a command box that scrolls says so.
- Request text is never rendered as HTML.
- Secrets — API keys and tokens, `Authorization` headers, password-style values, credentials in
  URLs and private keys — are masked in the history and in notifications. The approval
  card always shows the request in full.
- The CSV export defuses spreadsheet formulas.
- No network access, no telemetry, no stored secrets.

## 0.1.0 - 2026-10-01

Internal builds, never released publicly. They introduced the island and the owl, per-session
tracking with an approval queue, the first risk engine with press-and-hold for HIGH and CRITICAL
requests, approval payloads that are never cut silently, and a Turkish-only interface. The named
pipe relay, the reviewed-diff hook installer and the island window were adapted from
[Coucou](https://github.com/Louis-CFM/coucou) (MIT). Everything they had, and much more, shipped
publicly in 0.2.0.

[Unreleased]: https://github.com/tahap0l/nobetci/compare/v2.5.0...HEAD
[2.5.0]: https://github.com/tahap0l/nobetci/compare/v2.4.1...v2.5.0
[2.4.1]: https://github.com/tahap0l/nobetci/compare/v2.4.0...v2.4.1
[2.4.0]: https://github.com/tahap0l/nobetci/compare/v2.3.3...v2.4.0
[2.3.3]: https://github.com/tahap0l/nobetci/compare/v2.3.2...v2.3.3
[2.3.2]: https://github.com/tahap0l/nobetci/compare/v2.3.1...v2.3.2
[2.3.1]: https://github.com/tahap0l/nobetci/compare/v2.3.0...v2.3.1
[2.3.0]: https://github.com/tahap0l/nobetci/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/tahap0l/nobetci/compare/v2.1.7...v2.2.0
[2.1.7]: https://github.com/tahap0l/nobetci/compare/v2.1.6...v2.1.7
[2.1.6]: https://github.com/tahap0l/nobetci/compare/v2.1.5...v2.1.6
[2.1.5]: https://github.com/tahap0l/nobetci/compare/v2.1.4...v2.1.5
[2.1.4]: https://github.com/tahap0l/nobetci/compare/v2.1.3...v2.1.4
[2.1.3]: https://github.com/tahap0l/nobetci/compare/v2.1.2...v2.1.3
[2.1.2]: https://github.com/tahap0l/nobetci/compare/v2.1.1...v2.1.2
[2.1.1]: https://github.com/tahap0l/nobetci/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/tahap0l/nobetci/compare/v2.0.2...v2.1.0
[2.0.2]: https://github.com/tahap0l/nobetci/compare/v2.0.1...v2.0.2
[0.2.0]: https://github.com/tahap0l/nobetci/releases/tag/v0.2.0
[2.0.1]: https://github.com/tahap0l/nobetci/compare/v0.2.0...v2.0.1
