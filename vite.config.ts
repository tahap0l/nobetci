import { defineConfig } from "vite";
import { resolve } from "node:path";

// Two pages: the island and the settings window. Sounds are synthesised at
// runtime (src/core/sound.ts), so there are no audio assets to ship.
export default defineConfig({
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
