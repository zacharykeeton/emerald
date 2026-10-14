import child_process from 'node:child_process';

// node-pty's kill() on a ConPTY session forks its conpty_console_list_agent
// to list the shell's process tree, and forks it with no hide flag. The
// daemon runs detached (so it outlives the app), which on Windows means it
// has no console, so Windows gives that helper a fresh one, and Windows
// Terminal, as the default host, opens a window for it: a flash on every
// session close, and a window that stays when the launch fails under load.
// CREATE_NO_WINDOW gives the helper a console with no window instead; the
// helper frees its console before attaching to the shell's, so a hidden
// one changes nothing else. libuv only sets the flag when no stdio is
// inherited, and fork inherits by default, hence silent as well. node-pty
// looks fork up on the module at call time, so wrapping it here is enough.
const AGENT = /conpty_console_list_agent/;

export function hideConsoleListAgent(cp: { fork: typeof child_process.fork } = child_process): void {
  const fork = cp.fork;
  const hidden = function (this: unknown, modulePath: string | URL, args?: unknown, options?: unknown) {
    if (AGENT.test(String(modulePath))) {
      if (Array.isArray(args)) options = { ...(options as object), windowsHide: true, silent: true };
      else args = { ...(args as object), windowsHide: true, silent: true };
    }
    return fork.call(this, modulePath, args as string[], options as child_process.ForkOptions);
  };
  cp.fork = hidden as typeof child_process.fork;
}
