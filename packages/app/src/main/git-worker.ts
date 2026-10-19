// The main bundle's second entry (electron.vite.config.ts): electron-vite
// bundles shared's git worker (M9 fix 916) as out/main/git-worker.js
// beside index.js, which git-runner.ts starts by that path. The worker
// itself lives in @emerald/shared, one copy for the app and the daemon.
import '@emerald/shared/git-worker';
