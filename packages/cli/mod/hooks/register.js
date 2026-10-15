// The emerald mod (M9 fix 725): posts every classic hook event to the
// daemon's hook sink from inside the Claude process, so an event costs no
// cmd.exe and curl.exe of its own. It only observes: it never answers and
// never rewrites, and the event always goes on to the rest of the chain.
// PreToolUse is skipped, since its `e` is the tool-call envelope rather
// than the hook's stdin JSON and would neither fold against the hook
// file's copy nor parse as a hook post; that event stays the hook file's.
// Only the events `emmer hooks install` puts in the settings are posted
// (HOOK_EVENTS in hooks-install.ts less PreToolUse; the CLI's mod test
// holds the two lists together): classic.* also raises events no settings
// hook carries, MessageDisplay once per streamed piece of a reply among
// them, which the probe of fix 725 saw and the daemon has no use for.
// A plain ES module with no build step: the CLI's tsc includes src alone.
const POSTED = new Set([
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'Stop',
  'StopFailure',
  'Notification',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'CwdChanged',
]);

export function register(on) {
  on('classic.*', async ($, e, next) => {
    if (!POSTED.has(e.hook_event_name)) return next(e);
    // Literal names, so `claude plugin validate` can list what the mod reads.
    const sessionId = await $.env.get('EMERALD_SESSION_ID');
    const port = await $.env.get('EMERALD_HOOK_PORT');
    const token = await $.env.get('EMERALD_HOOK_TOKEN');
    // An unhosted Claude never gets the --plugin-dir flag; this guards one
    // that loads the mod anyway.
    if (!sessionId || !port || !token) return next(e);
    // Started before next() so it reaches the daemon ahead of the settings
    // hook's cmd.exe: the daemon keeps the first copy and folds the other.
    const post = $.http.fetch(`http://127.0.0.1:${port}/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Emerald-Token': token, 'X-Emerald-Session': sessionId, 'X-Emerald-Hook': 'emerald-mod' },
      body: JSON.stringify(e),
    }).catch(() => undefined);
    const result = await next(e);
    // curl's --max-time 1.5: a hung daemon costs a hook at most that.
    await Promise.race([post, $.clock.sleep(1500)]);
    return result;
  }).catch(($, e, next) => next(e));
}
