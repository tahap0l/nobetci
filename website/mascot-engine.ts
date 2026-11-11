// The desktop app's mascot engine for the website: the home page companion and
// the web demo draw the same characters, with the same movements, as the island.
// Built to /mascot-engine.js (see vite.config.ts); the pages work without it and
// fall back to the static heads in public/mascot-themes.js.

import { mountMascot } from "../src/baykus/embed";

(window as unknown as { NobetciEngine: { mount: typeof mountMascot } }).NobetciEngine = { mount: mountMascot };
