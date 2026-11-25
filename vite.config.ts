import { build as viteBuild, defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Two pages: the island and the settings window. Sounds are synthesised at
// runtime (src/core/sound.ts), so there are no audio assets to ship.
const root = import.meta.dirname;
const websiteRoot = resolve(root, "website");
const websiteBase = process.env.NOBI_WEBSITE_BASE ?? "/";
/** The app's mascot engine (src/baykus), bundled for the website's pages. */
const MASCOT_ENGINE = "mascot-engine.js";

export default defineConfig(process.env.CF_PAGES === "1" ? {
  root: websiteRoot,
  plugins: [{
    name: "nobi-website-images",
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
      for (const name of ["index.html", "privacy.html", "code-signing.html", "404.html", "demo/index.html"]) {
        const input = name.startsWith("demo/") ? `public/${name}` : name;
        const html = readFileSync(resolve(websiteRoot, input), "utf8");
        const source = html.replace(/\b(href|src|content)="\/(?!\/)/g, (_, attr) => `${attr}="${websiteBase}`);
        this.emitFile({ type: "asset", fileName: name, source });
      }
      // Screenshots for the pages are WebP files in website/public/shots/, and
      // the link-preview image is website/public/social.png.
      const images = {
        "owl.png": "src-tauri/icons/128x128.png",
      };
      for (const [name, path] of Object.entries(images)) {
        this.emitFile({ type: "asset", fileName: `assets/${name}`, source: readFileSync(resolve(root, path)) });
      }
    },
    // The live demo is the app's real island, built a second time into
    // dist/island/ with VITE_WEB_DEMO so its browser-only scenarios stay in.
    async closeBundle() {
      await viteBuild({
        configFile: false,
        root,
        base: `${websiteBase}island/`,
        logLevel: "warn",
        define: { "import.meta.env.VITE_WEB_DEMO": JSON.stringify("1") },
        build: {
          outDir: resolve(root, "dist/island"),
          emptyOutDir: true,
          target: "es2022",
          sourcemap: false,
          rolldownOptions: { input: resolve(root, "index.html") },
        },
      });
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
