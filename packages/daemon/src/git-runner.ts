import { fileURLToPath } from 'node:url';
import { setGitWorkerFile } from '@emerald/shared/git-runner';

// The daemon's way to run git (M9 fix 226) is shared's runner and worker
// since fix 916, the same pair the app's main process uses. Shared's
// exports map names the built worker, which import.meta.resolve finds from
// the daemon's source under the suite, from its dist in the build and from
// the stage's node_modules once installed. The rest of the daemon imports
// the runner from here, as it always has.
setGitWorkerFile(() => fileURLToPath(import.meta.resolve('@emerald/shared/git-worker')));

export { gitText, setGitRunnerLog, forgetInFlight, type GitOptions } from '@emerald/shared/git-runner';
