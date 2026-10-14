// The "test suite": loads every module under src/orchard, checks each
// has the shape CLAUDE.md asks for, runs it on two trees and prints a
// line per feature. Exit 1 if any is wrong, so a demo agent that broke a
// module notices before it commits.
import { loadFeatures } from '../src/orchard/index.js';

const features = await loadFeatures();
let failed = 0;
for (const f of features) {
  const problems = [];
  if (typeof f.name !== 'string' || f.name === '') problems.push('no name');
  if (typeof f.run !== 'function') problems.push('no run');
  if (problems.length === 0) {
    try {
      const out = f.run([{}, {}], {});
      if (out?.name !== f.name) problems.push('run() does not return its name');
      if (out?.treated !== 2) problems.push('run() did not treat both trees');
    } catch (err) {
      problems.push(`run() threw: ${err.message}`);
    }
  }
  if (problems.length === 0) console.log(`ok    ${f.name} (${f.file})`);
  else {
    failed++;
    console.log(`FAIL  ${f.file}: ${problems.join(', ')}`);
  }
}
console.log(`${features.length - failed} of ${features.length} features ok`);
process.exit(failed === 0 ? 0 : 1);
