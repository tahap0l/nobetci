import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Two pages: the island and the settings window. Sounds are synthesised at
// runtime (src/core/sound.ts), so there are no audio assets to ship.
const websiteRoot = resolve(__dirname, "website");

export default defineConfig(process.env.CF_PAGES === "1" ? {
  root: websiteRoot,
  plugins: [{
    name: "nobetci-website-images",
    generateBundle(_, bundle) {
      for (const key of Object.keys(bundle)) delete bundle[key];
      for (const name of ["index.html", "privacy.html", "404.html"]) {
        this.emitFile({ type: "asset", fileName: name, source: readFileSync(resolve(websiteRoot, name)) });
      }
      const images = {
        "owl.png": "src-tauri/icons/128x128.png",
        "overview.png": "docs/media/tr/overview.png",
        "idle-island.png": "docs/media/tr/idle-island.png",
        "critical.png": "docs/media/tr/critical.png",
        "social.png": "docs/media/social.png",
      };
      for (const [name, path] of Object.entries(images)) {
        this.emitFile({ type: "asset", fileName: `assets/${name}`, source: readFileSync(resolve(__dirname, path)) });
      }
    },
  }],
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(websiteRoot, "public/site.js"),
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
    target: "chrome110",
    minify: "esbuild",
    sourcemap: false,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        island: resolve(__dirname, "index.html"),
        settings: resolve(__dirname, "settings.html"),
      },
    },
  },
});
