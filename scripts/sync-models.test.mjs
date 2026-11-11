// Tests for scripts/sync-models-lib.mjs (M9 fix 1149), on a fixture string,
// never the real bundle, so they pass on a box with no Claude Code:
//
//   node --test scripts/sync-models.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aliasNames, catalogRates, compare, newestVersion, readCatalog, rewrite, sliceCatalog } from './sync-models-lib.mjs';

// A catalog in the bundle's own shape (JavaScript, bare keys, `!0`, `1e5`),
// with a close brace and an escaped quote inside one string value, between
// junk on either side.
const CATALOG =
  'var Q={"//":"Hand-maintained baked-in model catalog } with a \\" quote",schema_version:1,' +
  'pricing_tiers:{tier_8_40:{input:8,output:40,cache_write_5m:10,cache_write_1h:16,cache_read:0.2,web_search:0.01},' +
  'tier_2_10:{input:2,output:10,cache_write_5m:2.5,cache_write_1h:4,cache_read:0.1,web_search:0.01},' +
  'tier_4_20:{input:4,output:20,cache_write_5m:5,cache_write_1h:8,cache_read:0.2,web_search:0.01},' +
  'haiku_55:{input:0.1,output:0.5,cache_write_5m:0.125,cache_write_1h:0.2,cache_read:0.01,long_prompt:{above_prompt_tokens:1e5,input:0.5}}},' +
  'models:[{id:"claude-opus-5-5",family:"opus",display_name:"Opus 5.5",pricing:"tier_4_20",native:!0},' +
  '{id:"claude-sonnet-5-5",family:"sonnet",display_name:"Sonnet 5.5",pricing:"tier_2_10"},' +
  '{id:"claude-haiku-5-5",family:"haiku",display_name:"Haiku 5.5",pricing:"haiku_55"},' +
  '{id:"claude-fable-5-2",family:"fable",display_name:"Fable 5.2",pricing:"tier_8_40"}],' +
  'aliases:{opus:{default:"claude-opus-5-5"},sonnet:{default:"claude-sonnet-5-5"},haiku:{default:"claude-haiku-5-5"},fable:{default:"claude-fable-5-2"}},' +
  'latest_per_family:{fable:"claude-fable-5-2"}};';
const BUNDLE = 'junk(){return "{"};' + CATALOG + 'more(){}}}';

const CHAT = [
  '// head',
  'export const MODEL_CHOICES: readonly { alias: string; name: string; line: string }[] = [',
  "  { alias: 'default', name: 'Default', line: 'Use the default model' },",
  "  { alias: 'opus', name: 'Opus 5.5', line: 'Best for everyday, complex tasks' },",
  "  { alias: 'sonnet', name: 'Sonnet 5.5', line: 'Efficient for routine tasks' },",
  "  { alias: 'haiku', name: 'Haiku 5.5', line: 'Fastest for quick answers' },",
  "  { alias: 'fable', name: 'Fable 5.1', line: 'Most capable' },",
  "  { alias: 'opusplan', name: 'Opus Plan', line: 'Opus in plan mode, else Sonnet' },",
  '];',
  '',
].join('\r\n');

const RATES = [
  'export const MODEL_RATES: readonly ModelRates[] = [',
  "  { family: 'Fable 5.1', fresh: 10, cacheWrite: 12.5, cacheWrite1h: 20, cacheRead: 0.25, output: 50 },",
  "  { family: 'Opus 5.5', fresh: 4, cacheWrite: 5, cacheWrite1h: 8, cacheRead: 0.3, output: 20 },",
  "  { family: 'Sonnet 5.5', fresh: 2, cacheWrite: 2.5, cacheWrite1h: 4, cacheRead: 0.1, output: 10 },",
  "  { family: 'Haiku 5.5', fresh: 0.1, cacheWrite: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01, output: 0.5 },",
  '];',
  '',
].join('\n');

test('the catalog slice ends at its own close brace, not one inside a string', () => {
  const s = sliceCatalog(BUNDLE);
  assert.ok(s.ok);
  assert.ok(s.slice.endsWith('latest_per_family:{fable:"claude-fable-5-2"}}'));
  const r = readCatalog(BUNDLE);
  assert.ok(r.ok);
  assert.equal(r.catalog.models.length, 4);
});

test('an alias reads its model name and a family its tier', () => {
  const cat = readCatalog(BUNDLE).catalog;
  assert.deepEqual(aliasNames(cat), [
    { alias: 'opus', name: 'Opus 5.5' },
    { alias: 'sonnet', name: 'Sonnet 5.5' },
    { alias: 'haiku', name: 'Haiku 5.5' },
    { alias: 'fable', name: 'Fable 5.2' },
  ]);
  assert.deepEqual(catalogRates(cat, 'Haiku 5.5'), { fresh: 0.1, cacheWrite: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01, output: 0.5 });
  assert.equal(catalogRates(cat, 'Fable 5.1'), null);
});

test('the check names a stale name, a missing row, a moved number and a hand-kept row', () => {
  const cat = readCatalog(BUNDLE).catalog;
  const { stale, notes } = compare(cat, '9.9.9', CHAT, RATES);
  assert.deepEqual(stale, [
    'MODEL_CHOICES fable reads Fable 5.1, Claude Code 9.9.9 resolves it to Fable 5.2',
    'MODEL_RATES has no row for Fable 5.2',
    'MODEL_RATES Opus 5.5 cacheRead 0.3, Claude Code 9.9.9 0.2',
  ]);
  assert.deepEqual(notes, ["MODEL_RATES Fable 5.1 kept by hand, not in Claude Code's catalog"]);
});

test('the write rewrites both files byte for byte, keeping their line endings', () => {
  const cat = readCatalog(BUNDLE).catalog;
  const out = rewrite(cat, CHAT, RATES);
  assert.equal(out.chat, CHAT.replace("name: 'Fable 5.1'", "name: 'Fable 5.2'"));
  assert.equal(
    out.rates,
    [
      'export const MODEL_RATES: readonly ModelRates[] = [',
      "  { family: 'Fable 5.1', fresh: 10, cacheWrite: 12.5, cacheWrite1h: 20, cacheRead: 0.25, output: 50 },",
      "  { family: 'Opus 5.5', fresh: 4, cacheWrite: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 },",
      "  { family: 'Sonnet 5.5', fresh: 2, cacheWrite: 2.5, cacheWrite1h: 4, cacheRead: 0.1, output: 10 },",
      "  { family: 'Haiku 5.5', fresh: 0.1, cacheWrite: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01, output: 0.5 },",
      "  { family: 'Fable 5.2', fresh: 8, cacheWrite: 10, cacheWrite1h: 16, cacheRead: 0.2, output: 40 },",
      '];',
      '',
    ].join('\n'),
  );
  assert.deepEqual([out.renamed, out.added, out.changed], [1, 1, 1]);
  // After the write nothing is stale.
  assert.deepEqual(compare(cat, '9.9.9', out.chat, out.rates).stale, []);
});

test('text with no anchor, or an anchor whose braces never close, is not checked', () => {
  assert.deepEqual(readCatalog('nothing here'), { ok: false, reason: 'no catalog anchor' });
  assert.deepEqual(readCatalog('x={"//":"Hand-maintained baked-in model catalog",models:[{'), { ok: false, reason: 'the catalog braces never close' });
  const bad = readCatalog('{"//":"Hand-maintained baked-in model catalog",schema_version:2}');
  assert.equal(bad.ok, false);
});

test('the newest bundle is the highest version by number, not by name', () => {
  assert.equal(newestVersion(['2.1.9', '2.1.322', '2.1.40', 'tmp', '2.1.322.old']), '2.1.322');
  assert.equal(newestVersion([]), null);
});
