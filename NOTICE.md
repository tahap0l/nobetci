# Notice

Nöbetçi began as a fork of the Windows build of **Coucou**
(<https://github.com/Louis-CFM/coucou>, commit `5ae7bd9`), © 2026 Louis Raillé,
released under the MIT License.

Carried over and adapted from Coucou's MIT-licensed source:

- the named-pipe relay (`hook/`) and its same-user checks,
- the pipe server and the ack/decision timeouts (`src-tauri/src/pipe.rs`),
- the reviewed-diff installer for `~/.claude/settings.json` (`src-tauri/src/hooks.rs`),
- the transparent click-through island window and cursor poll (`src-tauri/src/island.rs`),
- the open/close state machine and spring helpers (`src/island/fsm.ts`, `src/core/anim.ts`).

**Not** carried over: Coucou's name, the Mochi character, its icons, sounds and
media, which are © Louis Raillé and not covered by the MIT License. Nöbetçi's
owl, icons and (synthesised) sounds are original to this project.

New in Nöbetçi: the risk engine (`src-tauri/src/risk.rs`), hold-to-confirm
approvals enforced in Rust, per-session tracking and the approval queue, the
fix for truncated commands on approval cards, and the Turkish UI.
