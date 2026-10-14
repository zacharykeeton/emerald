import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// M9 fix 407: useStore names the fields it reads (fix 354), so a reader
// that names one it never uses re-renders on every push that moves it,
// and a name destructured but never read is dead. Neither is a type
// error: the keys and the destructure are two lists that have to agree
// by hand. This reads every call site out of the renderer's source and
// checks that they do.
//
// The shape every call site is written in, and the one this test can
// read, is a single line:
//
//   const { a, b: c } = useStore('a', 'b');
//
// A site split over two lines, or one that does not destructure, fails
// here rather than being skipped, since a test that quietly reads fewer
// sites than there are is the thing this fix is about.
const dir = fileURLToPath(new URL('.', import.meta.url));

// store.ts holds the definition and a comment showing the shape; this
// file holds the pattern itself. Neither is a call site.
const SKIP = new Set(['store.ts', 'store-keys.test.ts']);

function sources(): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name) && !SKIP.has(e.name))
    .map((e) => path.join(e.parentPath, e.name));
}

const CALL = /const \{([^}]*)\} = useStore\(([^)]*)\);/;

// A line that mentions useStore and is not a comment: every one of these
// has to be a call site this test can read.
function isCallLine(line: string): boolean {
  const t = line.trim();
  return line.includes('useStore(') && !t.startsWith('//') && !t.startsWith('*');
}

test('every useStore call site names the keys it destructures, and reads every name it destructures', () => {
  const files = sources();
  assert.ok(files.length > 20, `the renderer's sources, got ${files.length}`);
  let sites = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('useStore(')) continue;
    const lines = text.split('\n');
    const where = path.relative(dir, file);
    for (const [i, line] of lines.entries()) {
      if (!isCallLine(line)) continue;
      const m = CALL.exec(line);
      assert.ok(
        m !== null,
        `${where}:${i + 1} is not a call site this test can read. Write it on one line as ` +
          `\`const { a, b: c } = useStore('a', 'b');\`, since the keys and the destructure are ` +
          `checked against each other here.\n  ${line.trim()}`,
      );
      sites++;

      // The keys asked for, and the two halves of each destructured
      // entry: `a` is its own name, `a: b` is the key a bound as b.
      const asked = [...m[2]!.matchAll(/'([^']+)'/g)].map((q) => q[1]!);
      const entries = m[1]!
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p !== '')
        .map((p) => {
          const [key, alias] = p.split(':').map((x) => x.trim());
          return { key: key!, name: alias ?? key! };
        });
      assert.ok(asked.length > 0, `${where}:${i + 1}: useStore is given no quoted key`);
      assert.ok(entries.length > 0, `${where}:${i + 1}: the destructure is empty`);

      assert.deepEqual(
        [...asked].sort(),
        entries.map((e) => e.key).sort(),
        `${where}:${i + 1}: the keys useStore is given and the fields destructured are not the same list`,
      );

      // Every name has to be read somewhere else in the file. The call
      // site's own line is cut out, or the name would find itself.
      const rest = lines.filter((_, j) => j !== i).join('\n');
      for (const { name } of entries) {
        assert.match(rest, new RegExp(`\\b${name}\\b`), `${where}:${i + 1}: ${name} is destructured and never read`);
      }
    }
  }
  assert.ok(sites > 20, `the call sites, got ${sites}`);
});
