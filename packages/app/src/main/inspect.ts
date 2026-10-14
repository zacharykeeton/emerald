// M9 fix 355: the installed window can be profiled. EMERALD_INSPECT_PORT=<n>
// in the environment puts Chromium's devtools server on that port, so a
// driver on cdp.mjs can attach to the real window the way it attaches to
// a harness one (the typing lag of 2026-09-21 took seven harness runs to
// diagnose because the user's own window could not be). The harness
// passes --remote-debugging-port on the command line already, and a
// second switch for the same server would be ignored or fight it, so
// the variable yields to the argument. Pure, so it is tested.
export type InspectDecision = { port: number; reason: null } | { port: null; reason: string };

export function inspectPort(env: NodeJS.ProcessEnv, argv: readonly string[]): InspectDecision {
  const raw = env['EMERALD_INSPECT_PORT'];
  if (raw === undefined || raw.trim() === '') return { port: null, reason: 'not asked' };
  if (argv.some((a) => a === '--remote-debugging-port' || a.startsWith('--remote-debugging-port='))) {
    return { port: null, reason: 'the command line already names one' };
  }
  if (!/^\d+$/.test(raw.trim())) return { port: null, reason: `${raw} is not a port` };
  const port = Number(raw.trim());
  if (port < 1 || port > 65535) return { port: null, reason: `${raw} is not a port` };
  return { port, reason: null };
}
