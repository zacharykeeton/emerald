import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { USE_FEATURES, USE_FRICTION_MS, dayKey, formatSpanLength, useLineOf } from '@emerald/shared';
import type { UseFeatureGroup, UseLineIn } from '@emerald/shared';
import { generationPaths } from '@emerald/shared/hook-log';

// `emmer usage report` (M9 fix 677): a markdown digest of the usage record
// (fix 676), the hook log and the renderer's lines in main.log, over the
// last n local days. Pure over the files it reads, so a test seeds a
// home. The friction figures are derived here and never written by the
// window. The digest never leaves the box; the private skill
// suggest-from-usage reads it beside the backlog.

type UseLine = UseLineIn & { at: number };

const FRICTION_SECONDS = Math.round(USE_FRICTION_MS / 1000);

// Local midnight `days - 1` days before the day `now` falls in.
export function windowStart(now: number, days: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d.getTime();
}

function mtimeOf(file: string): number | null {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

// The record's lines in the window, oldest first, and whether any
// generation exists at all.
function readUseRecord(home: string, from: number, now: number): { any: boolean; lines: UseLine[] } {
  const file = path.join(home, 'logs', 'usage.jsonl');
  let any = false;
  const lines: UseLine[] = [];
  for (const gen of generationPaths(file)) {
    const mtime = mtimeOf(gen);
    if (mtime === null) continue;
    any = true;
    if (mtime < from) continue;
    let text: string;
    try {
      text = fs.readFileSync(gen, 'utf8');
    } catch {
      continue;
    }
    for (const raw of text.split('\n')) {
      if (raw.trim() === '') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      const at = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)['at'] : undefined;
      if (typeof at !== 'number' || at < from || at > now) continue;
      const line = useLineOf(parsed);
      if (line !== null) lines.push({ ...line, at });
    }
  }
  lines.sort((a, b) => a.at - b.at);
  return { any, lines };
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function bracket(counts: Map<string, number>, extra?: string): string {
  const parts = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, n]) => `${name} ${n}`);
  if (extra !== undefined) parts.push(extra);
  return parts.length === 0 ? '' : ` (${parts.join(', ')})`;
}

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function actionsSection(lines: UseLine[]): string[] {
  const rows = new Map<string, { count: number; key: number; click: number; menu: number; cli: number }>();
  for (const l of lines) {
    if (l.ev !== 'action') continue;
    const row = rows.get(l.name) ?? { count: 0, key: 0, click: 0, menu: 0, cli: 0 };
    row.count++;
    row[l.from]++;
    rows.set(l.name, row);
  }
  if (rows.size === 0) return ['No actions recorded in the window.'];
  const out = ['| Action | Count | Key | Click | Menu | CLI |', '|---|---|---|---|---|---|'];
  for (const [name, r] of [...rows].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))) {
    out.push(`| ${name} | ${r.count} | ${r.key} | ${r.click} | ${r.menu} | ${r.cli} |`);
  }
  return out;
}

function viewsSection(lines: UseLine[]): string[] {
  const rows = new Map<string, { opens: number; closes: number; total: number; longest: number }>();
  const row = (view: string) => {
    const r = rows.get(view) ?? { opens: 0, closes: 0, total: 0, longest: 0 };
    rows.set(view, r);
    return r;
  };
  for (const l of lines) {
    if (l.ev === 'view-open') row(l.view).opens++;
    else if (l.ev === 'view-close') {
      const r = row(l.view);
      r.closes++;
      r.total += l.ms;
      r.longest = Math.max(r.longest, l.ms);
    }
  }
  if (rows.size === 0) return ['Nothing recorded in the window.'];
  const out = ['| View | Opens | Closes | Time open | Longest |', '|---|---|---|---|---|'];
  for (const [view, r] of [...rows].sort((a, b) => b[1].total - a[1].total || b[1].opens - a[1].opens || a[0].localeCompare(b[0]))) {
    out.push(`| ${view} | ${r.opens} | ${r.closes} | ${formatSpanLength(r.total)} | ${formatSpanLength(r.longest)} |`);
  }
  return out;
}

const GROUP_HEADINGS: ReadonlyArray<[UseFeatureGroup, string]> = [
  ['keys', '**Keys**'],
  ['pane-menu', '**Pane menu**'],
  ['clicks', '**Clicks**'],
  ['cli', '**CLI**'],
];

function neverUsedSection(lines: UseLine[]): string[] {
  const used = new Set(lines.filter((l) => l.ev === 'action').map((l) => (l as { name: string }).name));
  const out: string[] = [];
  for (const [group, heading] of GROUP_HEADINGS) {
    const unused = USE_FEATURES.filter((f) => f.group === group && !used.has(f.name));
    if (unused.length === 0) continue;
    if (out.length > 0) out.push('');
    out.push(heading, '');
    for (const f of unused) out.push(`- \`${f.name}\`: ${f.label}`);
  }
  return out.length === 0 ? ['Every feature the record knows was used in the window.'] : out;
}

const UNDO_DROP = new Set(['close-pane', 'pane-hide', 'hide-pane']);
const SPLITS = new Set(['split-vertical', 'split-horizontal', 'split-here', 'pane-split-right', 'pane-split-down', 'pull-pane']);

function frictionSection(lines: UseLine[]): string[] {
  const quick = new Map<string, number>();
  let quickN = 0;
  for (const l of lines) {
    if (l.ev === 'view-close' && l.ms < USE_FRICTION_MS) {
      quickN++;
      bump(quick, l.view);
    }
  }

  const actions = lines.filter((l): l is UseLine & { ev: 'action'; name: string } => l.ev === 'action');
  const runs = new Map<string, number>();
  let runN = 0;
  let longest = 0;
  for (let i = 0; i < actions.length; ) {
    let j = i + 1;
    while (j < actions.length && actions[j]!.name === actions[i]!.name) j++;
    const len = j - i;
    if (len >= 3) {
      runN++;
      bump(runs, actions[i]!.name);
      longest = Math.max(longest, len);
    }
    i = j;
  }

  const drops = new Map<string, number>();
  let dropN = 0;
  const splits = new Map<string, number>();
  let splitN = 0;
  for (let i = 0; i + 1 < actions.length; i++) {
    const a = actions[i]!;
    const b = actions[i + 1]!;
    if (b.at - a.at >= USE_FRICTION_MS) continue;
    if (a.name.startsWith('drop-') && (b.name.startsWith('drop-') || UNDO_DROP.has(b.name))) {
      dropN++;
      bump(drops, a.name);
    }
    if (SPLITS.has(a.name) && UNDO_DROP.has(b.name)) {
      splitN++;
      bump(splits, a.name);
    }
  }
  return [
    `- Views closed within ${FRICTION_SECONDS} s: ${quickN}${bracket(quick)}`,
    `- The same action three or more times running: ${runN}${bracket(runs, runN > 0 ? `longest ${longest}` : undefined)}`,
    `- A drop taken back within ${FRICTION_SECONDS} s: ${dropN}${bracket(drops)}`,
    `- A split closed within ${FRICTION_SECONDS} s: ${splitN}${bracket(splits)}`,
  ];
}

// main.1.log then main.log: the renderer's errors and warnings and the
// cap's dropped-lines count, in the window.
function rendererSection(home: string, from: number, now: number): string[] {
  const files = ['main.1.log', 'main.log'].map((n) => path.join(home, 'logs', n));
  if (!fs.existsSync(files[1]!)) return ['No main.log under this home.'];
  let errors = 0;
  let warnings = 0;
  let dropped = 0;
  const bodies = new Map<string, { level: string; count: number }>();
  for (const file of files) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const raw of text.split('\n')) {
      const m = /^(\S+) renderer: (.*)$/.exec(raw.trimEnd());
      if (m === null) continue;
      const at = Date.parse(m[1]!);
      if (Number.isNaN(at) || at < from || at > now) continue;
      const rest = m[2]!;
      const drop = /^(\d+) more lines dropped this second$/.exec(rest);
      if (drop !== null) {
        dropped += Number(drop[1]);
        continue;
      }
      const lm = /^(error|warning) (.*)$/.exec(rest);
      if (lm === null) continue;
      const level = lm[1]!;
      if (level === 'error') errors++;
      else warnings++;
      const body = lm[2]!.replace(/ \([^()]*:\d+\)$/, '').slice(0, 100);
      const key = `${level}\u0000${body}`;
      const entry = bodies.get(key) ?? { level, count: 0 };
      entry.count++;
      bodies.set(key, entry);
    }
  }
  const out = [`${errors} errors and ${warnings} warnings, ${dropped} lines dropped by the cap.`];
  if (bodies.size === 0) return out;
  out.push('', '| Level | Count | Message |', '|---|---|---|');
  const top = [...bodies].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0])).slice(0, 10);
  for (const [key, e] of top) out.push(`| ${e.level} | ${e.count} | ${cell(key.slice(key.indexOf('\u0000') + 1))} |`);
  return out;
}

function storedFolders(home: string): Map<string, string> {
  const out = new Map<string, string>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(home, 'sessions.json'), 'utf8'));
  } catch {
    return out;
  }
  const list = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)['sessions'] : undefined;
  if (!Array.isArray(list)) return out;
  for (const e of list) {
    if (typeof e !== 'object' || e === null) continue;
    const r = e as Record<string, unknown>;
    const folder = typeof r['groupCwd'] === 'string' ? r['groupCwd'] : typeof r['spawnCwd'] === 'string' ? r['spawnCwd'] : null;
    if (typeof r['id'] === 'string' && folder !== null) out.set(r['id'], folder);
  }
  return out;
}

function folderKey(folder: string): string {
  return folder.replace(/[\\/]+$/, '').toLowerCase();
}

function baseName(folder: string): string {
  const parts = folder.split(/[\\/]/).filter((p) => p !== '');
  return parts.length === 0 ? folder : parts[parts.length - 1]!;
}

// The hook log's generations streamed, a line's time read before any
// parse, so the history before the window costs a regex each.
async function sessionsSection(home: string, from: number, now: number): Promise<string[]> {
  const file = path.join(home, 'logs', 'hooks.jsonl');
  const folders = storedFolders(home);
  const days = new Map<string, { sessions: Set<string>; projects: Set<string>; lines: number }>();
  const projectDays = new Map<string, { name: string; days: Set<string> }>();
  for (const gen of generationPaths(file)) {
    const mtime = mtimeOf(gen);
    if (mtime === null || mtime < from) continue;
    let stream: fs.ReadStream;
    try {
      stream = fs.createReadStream(gen, { encoding: 'utf8' });
    } catch {
      continue;
    }
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const raw of rl) {
        const m = /^\{"at":(\d+)/.exec(raw);
        if (m === null) continue;
        const at = Number(m[1]);
        if (at < from || at > now) continue;
        let line: unknown;
        try {
          line = JSON.parse(raw);
        } catch {
          continue;
        }
        if (typeof line !== 'object' || line === null) continue;
        const l = line as Record<string, unknown>;
        if (typeof l['sessionId'] !== 'string' || l['outcome'] !== 'applied') continue;
        const sessionId = l['sessionId'];
        const payload = typeof l['payload'] === 'object' && l['payload'] !== null ? (l['payload'] as Record<string, unknown>) : {};
        const folder = typeof payload['cwd'] === 'string' ? payload['cwd'] : (folders.get(sessionId) ?? null);
        const day = dayKey(at);
        const entry = days.get(day) ?? { sessions: new Set<string>(), projects: new Set<string>(), lines: 0 };
        entry.sessions.add(sessionId);
        entry.lines++;
        if (folder !== null) {
          const key = folderKey(folder);
          entry.projects.add(key);
          const p = projectDays.get(key) ?? { name: baseName(folder), days: new Set<string>() };
          p.days.add(day);
          projectDays.set(key, p);
        }
        days.set(day, entry);
      }
    } catch {
      // A file that went away mid-read; what was read stands.
    } finally {
      rl.close();
      stream.destroy();
    }
  }
  if (days.size === 0) return ['No hook lines in the window.'];
  const out = ['| Day | Sessions | Projects | Hook lines |', '|---|---|---|---|'];
  for (const [day, e] of [...days].sort((a, b) => a[0].localeCompare(b[0]))) out.push(`| ${day} | ${e.sessions.size} | ${e.projects.size} | ${e.lines} |`);
  const top = [...projectDays.values()].sort((a, b) => b.days.size - a.days.size || a.name.localeCompare(b.name)).slice(0, 10);
  if (top.length > 0) out.push('', `Projects by days active: ${top.map((p) => `${p.name} (${p.days.size})`).join(', ')}`);
  return out;
}

export const NOTHING_RECORDED = "Nothing recorded yet: the usage record is off until it is turned on from the speaker button's right-click menu (Usage record).";

export async function buildUsageReport(home: string, now: number, days: number): Promise<string> {
  const from = windowStart(now, days);
  const record = readUseRecord(home, from, now);
  const out = [`# Emerald usage, the last ${days} days (${dayKey(from)} to ${dayKey(now)})`, ''];
  const empty = record.lines.length === 0;
  out.push('## Actions by count', '');
  out.push(...(record.any ? actionsSection(record.lines) : [NOTHING_RECORDED]), '');
  out.push('## Views by time open', '');
  out.push(...(empty ? ['Nothing recorded in the window.'] : viewsSection(record.lines)), '');
  out.push('## Never used', '');
  out.push(...(empty ? ['Nothing recorded in the window.'] : neverUsedSection(record.lines)), '');
  out.push('## Friction', '');
  out.push(...(empty ? ['Nothing recorded in the window.'] : frictionSection(record.lines)), '');
  out.push('## Renderer errors and warnings', '');
  out.push(...rendererSection(home, from, now), '');
  out.push('## Sessions and projects per day', '');
  out.push(...(await sessionsSection(home, from, now)));
  return out.join('\n') + '\n';
}
