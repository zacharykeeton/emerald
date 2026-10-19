import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    // @emerald/shared is ESM-only and the main bundle is CommonJS, so bundle it
    // in rather than leaving a require() of an ESM package behind.
    // electron-updater (M9 fix 239) is bundled too: the asar holds out/ and
    // package.json and no node_modules, so a require() left behind would
    // find nothing in the installed app.
    plugins: [externalizeDepsPlugin({ exclude: ['@emerald/shared', 'electron-updater'] })],
    // The git worker thread (M9 fix 226) is a second entry, so it lands as
    // out/main/git-worker.js beside index.js and git-runner.ts starts it by
    // that path. The entry is shared's worker (M9 fix 916, one copy for the
    // app and the daemon), which src/main/git-worker.ts only imports; the
    // unit tests load src/main under Node, where an electron-vite
    // ?nodeWorker import would not resolve.
    build: { rollupOptions: { input: { index: 'src/main/index.ts', 'git-worker': 'src/main/git-worker.ts' } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@emerald/shared'] })],
  },
  renderer: {
    plugins: [react()],
    // The icon map is imported by name (file-icons.ts); as an object
    // literal rather than a JSON.parse string the unused keys shake out.
    json: { stringify: false },
    build: {
      // The file type icons (M9 fix 71) come in as URLs from a glob over
      // the Material set; Vite would inline each SVG under 4 KB as a data
      // URI, which is a megabyte of base64 in the bundle for icons most
      // rows never show. Kept as files, fetched when a row first shows one.
      assetsInlineLimit: (filePath) => (filePath.includes('material-icon-theme') ? false : undefined),
    },
  },
});
