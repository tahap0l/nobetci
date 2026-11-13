import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Two pages: the island and the settings window. Sounds are synthesised at
// runtime (src/core/sound.ts), so there are no audio assets to ship.
const root = import.meta.dirname;
const websiteRoot = resolve(root, "website");
const websiteBase = process.env.NOBETCI_WEBSITE_BASE ?? "/";
/** The app's mascot engine (src/baykus), bundled for the website's pages. */
const MASCOT_ENGINE = "mascot-engine.js";

export default defineConfig(process.env.CF_PAGES === "1" ? {
  root: websiteRoot,
  plugins: [{
    name: "nobetci-website-images",
    // The pages ask for the built file name; in the dev server it is the source.
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url?.startsWith(`/${MASCOT_ENGINE}`)) req.url = req.url.replace(MASCOT_ENGINE, "mascot-engine.ts");
        next();
      });
    },
    generateBundle(_, bundle) {
      // The pages are plain HTML with scripts from public/; the only bundle is the mascot engine.
      for (const key of Object.keys(bundle)) if (key !== MASCOT_ENGINE) delete bundle[key];
      for (const name of ["index.html", "privacy.html", "404.html", "demo/index.html"]) {
        const input = name.startsWith("demo/") ? `public/${name}` : name;
        const html = readFileSync(resolve(websiteRoot, input), "utf8");
        const source = html.replace(/\b(href|src|content)="\/(?!\/)/g, (_, attr) => `${attr}="${websiteBase}`);
        this.emitFile({ type: "asset", fileName: name, source });
      }
      const images = {
        "owl.png": "src-tauri/icons/128x128.png",
        "overview.png": "docs/media/tr/overview.png",
        "idle-island.png": "docs/media/tr/idle-island.png",
        "critical.png": "docs/media/tr/critical.png",
        "social.png": "docs/media/social.png",
      };
      for (const [name, path] of Object.entries(images)) {
        this.emitFile({ type: "asset", fileName: `assets/${name}`, source: readFileSync(resolve(root, path)) });
      }
    },
  }],
  build: {
    outDir: resolve(root, "dist"),
    emptyOutDir: true,
    rolldownOptions: {
      input: resolve(websiteRoot, "mascot-engine.ts"),
      output: { entryFileNames: MASCOT_ENGINE },
    },
  },
} : {
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    // Cargo holds DLLs in target/ open while it builds; watching them crashes
    // the dev server with EBUSY. Nothing the front end needs lives there.
    watch: { ignored: ["**/target/**", "**/src-tauri/**", "**/hook/**", "**/release/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    // Windows runs the pages in WebView2 (evergreen Chromium); macOS in the
    // system WKWebView, which on macOS 11 — the oldest release the app supports
    // (tauri.macos.conf.json) — is Safari 14. Tauri says which one it builds for;
    // anything else gets the stricter target.
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome110" : "safari14",
    sourcemap: false,
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        island: resolve(root, "index.html"),
        settings: resolve(root, "settings.html"),
        buddy: resolve(root, "buddy.html"),
      },
    },
  },
});
