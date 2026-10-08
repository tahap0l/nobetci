## What and why

<!-- What does this change, and why? Link the issue it addresses, e.g. "Fixes #123". -->

## How I tested it

<!-- Commands you ran, demo URLs you checked (?demo=…, settings.html?tab=…), what you tried against the real app. -->

## Screenshots

<!-- For UI changes: before and after, in English and Turkish. `npm run screenshots` or the demo URLs make this quick. -->

## Checklist

- [ ] `npm run check:invisible`, `npx tsc --noEmit`, `cargo fmt --all --check`, `npm run lint` and `npm test` pass locally.
- [ ] Tests are added or updated. A new risk rule comes with a test **and** a "stays low" case for everyday commands.
- [ ] Every new or changed UI string exists in **Turkish and English**.
- [ ] No `innerHTML` (nor `outerHTML`, `insertAdjacentHTML` or `document.write`): the DOM is built with `h()` and text nodes.
- [ ] UI changes come with screenshots in both languages.
- [ ] The ground rules still hold: Claude Code is never blocked, `~/.claude/settings.json` is only written after a reviewed diff, nothing HIGH or CRITICAL is approved without a person, and there is no telemetry or network access.
- [ ] User-visible changes are noted under **Unreleased** in `CHANGELOG.md`.
