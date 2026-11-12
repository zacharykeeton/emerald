// The words `emmer shell` uses for its --shell ids, per platform (M9 fix
// 1018). No imports on purpose: the help table (commands/index.ts) loads no
// command module and nothing heavy (fix 736), and it reads the summary from
// here. The two lists are copies of @emerald/shared's shellIdsFor, held to it
// by spawn.test.ts.
export function shellIdsOf(platform: string): readonly string[] {
  return platform === 'win32' ? ['pwsh', 'powershell', 'gitbash', 'cmd'] : ['zsh', 'bash', 'sh'];
}

function orList(ids: readonly string[]): string {
  if (ids.length <= 1) return ids.join('');
  return `${ids.slice(0, -1).join(', ')} or ${ids[ids.length - 1]}`;
}

export function shellSummary(platform: string = process.platform): string {
  return `start a plain shell session in a folder; --shell picks ${orList(shellIdsOf(platform))}`;
}

export function shellUsage(platform: string = process.platform): string {
  return `emmer shell <dir> [--host <name>] [--name <label>] [--shell ${shellIdsOf(platform).join('|')}] [--json] [-- <shell args>]\n--host <name> starts it on that remote host through the window, which must be open; <dir> is then an absolute path there or ~`;
}
