// Standalone Vite config for the dev previews in this folder, independent of
// the app's own vite.config. Run from the repo root:
//   npx vite --config dev/vite.preview.config.mjs
// then open http://127.0.0.1:1430/dev/baykus.html
import { fileURLToPath } from "node:url";

export default {
  root: fileURLToPath(new URL("..", import.meta.url)),
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1430,
    strictPort: true,
    // Cargo rewrites locked DLLs under target/ during builds; never watch it.
    watch: { ignored: ["**/target/**", "**/src-tauri/target/**", "**/release/**"] },
  },
};
