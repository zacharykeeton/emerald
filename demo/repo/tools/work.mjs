// The pacer: prints a line a second for as long as it is told and exits.
// It is what a demo agent runs between commits so the work takes long
// enough to watch; the label is what the sidebar row shows meanwhile.
//
//   node tools/work.mjs 6 "compiling the graft module"
const seconds = Math.max(1, Math.min(600, Number(process.argv[2]) || 5));
const label = process.argv.slice(3).join(' ') || 'working';

for (let i = 1; i <= seconds; i++) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  console.log(`${label}: ${i}/${seconds}`);
}
console.log(`${label}: done`);
