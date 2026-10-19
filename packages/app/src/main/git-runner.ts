import path from 'node:path';
import { setGitWorkerFile } from '@emerald/shared/git-runner';

// The main process's way to run git (M9 fix 226) is shared's runner and
// worker since fix 916, the same pair the daemon uses. The worker's file is
// the second entry of the main bundle (electron.vite.config.ts), beside
// this one's; the thunk is only called when the worker starts, so the unit
// tests, which load this module under Node and inject their own git, never
// touch __dirname.
setGitWorkerFile(() => path.join(__dirname, 'git-worker.js'));

export { gitText, gitBytes, gitPipe, setGitRunnerLog, forgetInFlight, GIT_TIMEOUT_MS, GIT_MAX_OUTPUT, type GitOptions } from '@emerald/shared/git-runner';
