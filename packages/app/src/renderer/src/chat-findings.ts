// M9 fix 1170: a /code-review reply as findings, read off the text Claude Code 2.1.322 prints for a forked review: the formatter's numbered list where the fork returned JSON, or the fork's own one line per finding where its prompt asked for lines (Opus 5 at medium and high, low everywhere). Null is anything else, drawn as today's divider.
// The first real run (verify:chat's findings-real, 2026-11-12) met a third shape: the review ran in the background ("Running in the background as @code-review"), and the fork's own JSON array, unformatted, arrived as a task notification's <result> with prose after it; that is the 'json' shape, read as the bundle's formatter reads it (its `jt` and `Ut`).

export interface Finding {
  n: number;
  file: string;
  line: number | null;
  summary: string;
  scenario: string | null;
}

export interface FindingsReply {
  shape: 'list' | 'lines' | 'json';
  findings: Finding[];
}

// The turn's prompt as promptOf reads it: the command and its arguments.
// /review is the skill's alias.
export function isReviewPrompt(prompt: string): boolean {
  return /^\/(?:code-review|review)(?:\s|$)/.test(prompt);
}

// The place a finding names: a file, with its line's first number when it
// gives a line or a range.
function placeOf(place: string): { file: string; line: number | null } {
  const m = /^(.*?):(\d+)(?:-\d+)?$/.exec(place);
  return m === null ? { file: place, line: null } : { file: m[1]!, line: Number(m[2]) };
}

// The formatter's shape (the bundle's `Ut`): `N findings, most severe
// first:` (or `1 finding:`), a blank line, then each finding as
// N. `place`: summary, its scenario after a blank line as `Failure
// scenario: ...`, every line after an item's first indented by the length
// of `N. `, the items joined by a blank line. An item's own lines are
// indented, so a blank line inside a scenario never splits two items.
function listOf(text: string): FindingsReply | null {
  const head = /^(\d+) findings?(?:, most severe first)?:\n\n/.exec(text);
  if (head === null) return null;
  const count = Number(head[1]);
  const pieces = text.slice(head[0].length).split(/\n\n(?=\d+\. `)/);
  if (count < 1 || count !== pieces.length) return null;
  const findings: Finding[] = [];
  for (let i = 0; i < pieces.length; i += 1) {
    const m = /^(\d+)\. `([^`\n]+)`: ([\s\S]*)$/.exec(pieces[i]!);
    if (m === null || Number(m[1]) !== i + 1) return null;
    const body = m[3]!.replace(new RegExp(`\\n {0,${m[1]!.length + 2}}`, 'g'), '\n');
    const cut = body.indexOf('\n\nFailure scenario: ');
    const summary = (cut < 0 ? body : body.slice(0, cut)).trim();
    const scenario = cut < 0 ? null : body.slice(cut + '\n\nFailure scenario: '.length).trim();
    findings.push({ n: i + 1, ...placeOf(m[2]!), summary, scenario });
  }
  return { shape: 'list', findings };
}

// The fork's own lines: `path:line` then a dash and the text, perhaps
// bulleted, numbered, bold or in backticks; any other line (a sentence
// before them) is passed over.
function linesOf(text: string): FindingsReply | null {
  const findings: Finding[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)?/, '');
    const m = /^(?:\*\*)?`?([^\s`*][^`*]*?):(\d+)(?:-\d+)?`?(?:\*\*)?:?\s+[—–-]{1,2}\s+(\S.*)$/.exec(line);
    if (m === null) continue;
    findings.push({ n: findings.length + 1, file: m[1]!, line: Number(m[2]), summary: m[3]!.trim(), scenario: null });
  }
  return findings.length === 0 ? null : { shape: 'lines', findings };
}

// The fork's JSON as the formatter takes it: the whole text when it starts
// with `[`, else the first fenced json block. Each finding names a file and
// a summary; its line is a number or a string like `10-12` (a falsy one is
// the file alone, as the formatter prints it), its scenario optional. An
// empty array, which the formatter prints as `No findings.`, is null, as is
// any element of another shape.
function jsonOf(text: string): FindingsReply | null {
  const t = text.trim();
  const body = t.startsWith('[') ? t : (/^```json[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/im.exec(t)?.[1] ?? null);
  if (body === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.trim());
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const findings: Finding[] = [];
  for (const item of parsed as unknown[]) {
    if (typeof item !== 'object' || item === null) return null;
    const o = item as Record<string, unknown>;
    const file = o['file'];
    const summary = o['summary'];
    const rawLine = o['line'];
    const rawScenario = o['failure_scenario'];
    if (typeof file !== 'string' || file === '' || typeof summary !== 'string') return null;
    if (rawLine !== undefined && rawLine !== null && typeof rawLine !== 'number' && typeof rawLine !== 'string') return null;
    if (rawScenario !== undefined && rawScenario !== null && typeof rawScenario !== 'string') return null;
    const lineMatch = typeof rawLine === 'number' ? (Number.isInteger(rawLine) && rawLine >= 1 ? rawLine : null) : typeof rawLine === 'string' ? Number(/^\s*(\d+)/.exec(rawLine)?.[1] ?? 0) || null : null;
    const scenario = typeof rawScenario === 'string' && rawScenario.trim() !== '' ? rawScenario.trim() : null;
    findings.push({ n: findings.length + 1, file, line: lineMatch, summary: summary.trim(), scenario });
  }
  return { shape: 'json', findings };
}

export function findingsOf(text: string): FindingsReply | null {
  if (/^(\d+) findings?(?:, most severe first)?:\n\n/.test(text)) return listOf(text);
  return jsonOf(text) ?? linesOf(text);
}

export function findingPlace(f: Finding): string {
  return f.line === null ? f.file : `${f.file}:${f.line}`;
}

export function findingsHead(count: number): string {
  return count === 1 ? 'Code review · 1 finding' : `Code review · ${count} findings`;
}

// The prompt a card types: one line, since a typed newline would submit
// early, and whole on its own, since the session may have compacted the
// review away by the time it is sent.
export function fixPrompt(findings: readonly Finding[]): string {
  const ns = findings.map((f) => String(f.n));
  const which = ns.length === 1 ? `finding ${ns[0]}` : `findings ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;
  const items = findings.map((f) => {
    const s = f.summary.replace(/\s+/g, ' ').trim();
    const said = /[.!?]$/.test(s) ? s : `${s}.`;
    return ` ${f.n}: ${findingPlace(f)}, ${said}`;
  });
  return `Fix ${which} of the code review above.${items.join('')}`;
}
