// Claude Code's own command table (M9 fix 973), one home for the chat
// view's menus and history-model's isBareCommand, which main compiles
// too, so this module imports nothing.

// The slash commands that open a picker or a dialog of their own in the
// TUI, which the chat view cannot draw: a send of one shows the fallback
// bar over the box. Read off Claude Code 2.1.301's command table (M9
// fixes 749 and 780): fix 749's thirteen first (/btw left them for the
// argument rows at fix 1005), then the rest of the
// table's terminal forms (`local-jsx`, and /rewind's message picker) in
// name order, each with its argument hint and description verbatim. A
// command whose gate reads the account, a flag or the platform is left
// out, since the view cannot see it, except /remote-control, a sent row (M9 fix 890).
export const TERMINAL_COMMANDS: readonly { name: string; description: string; hint: string }[] = [
  { name: '/model', hint: '[model]', description: 'Set the AI model for Claude Code' },
  { name: '/permissions', hint: '', description: 'Manage allow and deny tool permission rules' },
  { name: '/mcp', hint: '[reconnect (<server>|all)|enable|disable [<server>|all]]', description: 'Manage MCP servers' },
  { name: '/config', hint: '[key=value]', description: 'Open settings' },
  { name: '/usage', hint: '', description: 'Show session cost, plan usage, and activity stats' },
  { name: '/hooks', hint: '', description: 'View hook configurations for tool events' },
  { name: '/memory', hint: '', description: 'Edit CLAUDE.md files and memory settings' },
  { name: '/resume', hint: '[conversation id or search term]', description: 'Resume a previous conversation' },
  { name: '/theme', hint: '', description: 'Change the theme' },
  { name: '/login', hint: '', description: 'Sign in with your Anthropic account' },
  { name: '/status', hint: '', description: 'Show Claude Code status including version, model, account, API connectivity, and tool statuses' },
  { name: '/doctor', hint: '', description: 'Health-check your setup and fix issues: installation, unused extensions, duplicated or bloated memory files, slow hooks, updates, permissions' },
  { name: '/autocompact', hint: '[auto|<tokens>]', description: 'Set how full the context gets before auto-summarizing' },
  { name: '/background', hint: '[prompt]', description: 'Send this session to the background and free the terminal' },
  { name: '/branch', hint: '[name]', description: 'Create a branch of the current conversation at this point' },
  { name: '/bug', hint: '[report]', description: 'Report a bug or share your conversation' },
  { name: '/context', hint: '[all]', description: 'Visualize current context usage as a colored grid' },
  { name: '/copy', hint: '', description: "Copy Claude's last response to clipboard (or /copy N for the Nth-latest)" },
  { name: '/daemon', hint: '', description: 'Manage background services and routines' },
  { name: '/effort', hint: '[low|medium|high|xhigh|max|auto]', description: 'Set effort level for model usage' },
  { name: '/exit', hint: '', description: 'Exit the CLI' },
  { name: '/export', hint: '[filename]', description: 'Export the current conversation to a file or clipboard' },
  { name: '/feedback', hint: '[report]', description: 'Send feedback to Anthropic or report a bug' },
  { name: '/focus', hint: '', description: 'Toggle focus view: just your prompt, summary, and response' },
  { name: '/goal', hint: '[<condition> | clear]', description: 'Set a goal Claude checks before stopping' },
  { name: '/help', hint: '', description: 'Show help and available commands' },
  { name: '/ide', hint: '[open]', description: 'Manage IDE integrations and show status' },
  { name: '/install-github-app', hint: '', description: 'Set up Claude GitHub Actions for a repository' },
  { name: '/logout', hint: '', description: 'Sign out from your Anthropic account' },
  { name: '/mobile', hint: '', description: 'Show QR code to download the Claude mobile app' },
  { name: '/plan', hint: '[open|<description>]', description: 'Enable plan mode or view the current session plan' },
  { name: '/plugin', hint: '', description: 'Manage Claude Code plugins' },
  { name: '/powerup', hint: '', description: 'Discover Claude Code features through quick interactive lessons' },
  { name: '/release-notes', hint: '', description: 'View release notes' },
  { name: '/rewind', hint: '', description: 'Restore the code and/or conversation to a previous point' },
  { name: '/skill-doctor', hint: '', description: 'Show which loaded skills are unused and costing context' },
  { name: '/skills', hint: '', description: 'List available skills' },
  { name: '/tasks', hint: '', description: 'View and manage everything running in the background' },
  { name: '/terminal-setup', hint: '', description: 'Install Shift+Enter key binding for newlines' },
  { name: '/tui', hint: '[default|fullscreen]', description: 'Set the terminal UI renderer (default | fullscreen)' },
];

// Claude Code 2.1.301's aliases of the terminal commands: a typed one
// opens its command's dialog, so it brings the bar, but the menu lists
// the command alone (M9 fixes 749 and 780). The aliases of a sent command
// (/reset and /new for /clear, /name for /rename) need nothing.
export const TERMINAL_ALIASES: readonly string[] = ['/cost', '/stats', '/settings', '/allowed-tools', '/continue', '/plugins', '/marketplace', '/bashes', '/quit', '/share', '/bg', '/ios', '/android', '/checkpoint', '/undo', '/checkup'];

// M9 fix 719: the `/` menu over the box. The built-ins that run and leave
// nothing to answer, their hints and descriptions verbatim from Claude
// Code's own command table (the bundle under
// ~/.local/share/claude/versions; `claude --help` lists no slash
// commands). Read off Claude Code 2.1.301's command table (M9 fix 780):
// fix 719's five first, then the rest of the table's `local` and `prompt`
// commands, and /rename, which prints a line and opens nothing (bare, it
// names the session itself), in name order. /remote-control (M9 fix 890)
// is the one command whose gate reads the account that is listed, since
// the person asked to call it from the chat view; its send opens one of
// Claude Code's dialogs (the one-time Enable Remote Control, or Disconnect
// while connected), so opensMenu answers true for it (fix 923). /review is not in the table
// and /cost is /usage's alias.
export const SENT_COMMANDS: readonly { name: string; description: string; hint: string }[] = [
  { name: '/compact', hint: '<optional custom summarization instructions>', description: 'Free up context by summarizing the conversation so far' },
  { name: '/clear', hint: '[name]', description: 'Start a new session with empty context; previous session stays on disk (resumable with /resume)' },
  { name: '/init', hint: '', description: 'Initialize a new CLAUDE.md file with codebase documentation' },
  { name: '/recap', hint: '', description: 'Generate a one-line session recap now' },
  { name: '/reload-skills', hint: '', description: 'Pick up skills added or changed on disk during this session' },
  { name: '/insights', hint: '', description: 'Generate a report analyzing your Claude Code sessions' },
  { name: '/install-slack-app', hint: '', description: 'Install the Claude Slack app' },
  { name: '/radio', hint: '', description: 'Listen to Claude FM lo-fi radio' },
  { name: '/reload-plugins', hint: '[--force]', description: 'Activate pending plugin changes in the current session' },
  { name: '/remote-control', hint: '[name]', description: 'Control this session from your phone or claude.ai/code' },
  { name: '/rename', hint: '[name]', description: 'Rename the current conversation' },
  { name: '/statusline', hint: '', description: "Set up Claude Code's status line UI" },
  { name: '/stickers', hint: '', description: 'Order Claude Code stickers' },
  { name: '/team-onboarding', hint: '', description: 'Help teammates ramp on Claude Code with a guide from your usage' },
];

// M9 fix 780: the commands whose hint is a required argument. A pick
// completes the name with a space and sends nothing, and the send of the
// completed box brings the bar, since both draw a dialog of their own
// (/add-dir's `Add directory to workspace`). /btw (M9 fix 1005) completes
// the same way, but its completed send opens the chat view's side strip
// rather than the bar.
export const ARGUMENT_COMMANDS: readonly { name: string; description: string; hint: string }[] = [
  { name: '/add-dir', hint: '<path>', description: 'Add a new working directory' },
  { name: '/btw', hint: '[question]', description: 'Ask a quick side question without interrupting the main conversation' },
  { name: '/cd', hint: '<path>', description: 'Move this session to a new working directory' },
];

// The sent commands' aliases (/reset and /new for /clear, /name for
// /rename), which need nothing of the view.
export const SENT_ALIASES: readonly string[] = ['/reset', '/new', '/name'];

// Built-ins read off 2.1.310 whose gate (`isHidden`) the view cannot see,
// so no menu lists them; a prompt that starts with one is still a
// command, not an ask.
export const GATED_COMMANDS: readonly string[] = ['/color', '/output-style'];

// Whether `name` (with its slash) is one of Claude Code's built-ins or
// their aliases, in any case.
export function isBuiltinCommand(name: string): boolean {
  const n = name.toLowerCase();
  return [TERMINAL_COMMANDS, SENT_COMMANDS, ARGUMENT_COMMANDS].some((t) => t.some((c) => c.name === n)) || TERMINAL_ALIASES.includes(n) || SENT_ALIASES.includes(n) || GATED_COMMANDS.includes(n);
}
