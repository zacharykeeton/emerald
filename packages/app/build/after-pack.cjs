// electron-builder's afterPack hook (M9 fix 1027). It runs once the
// resources are copied into the bundle and before electron-builder's own
// signing step, which electron-builder.yml skips on a Mac (identity null),
// so the signature written here is the one the dmg and the zip carry.
// Apple silicon refuses to run a binary with no signature at all, and the
// build has no Apple Developer ID, so the bundle is signed ad hoc. On any
// other platform it does nothing.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function run(cmd, args) {
  // A non-zero exit throws, which fails the build.
  execFileSync(cmd, args, { stdio: 'inherit' });
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const res = path.join(app, 'Contents', 'Resources');
  const prebuild = path.join(res, 'node_modules', 'node-pty', 'prebuilds', 'darwin-arm64');

  // The shim and node-pty's helper are run as programs. Whether the
  // extraResources copy keeps a file's mode has not been read, and the
  // public export is committed on Windows, where git records no executable
  // bit, so the mode is set here rather than trusted.
  fs.chmodSync(path.join(res, 'bin', 'emmer'), 0o755);
  fs.chmodSync(path.join(prebuild, 'spawn-helper'), 0o755);

  // The two Mach-O files sit outside the places codesign --deep walks.
  run('codesign', ['--force', '--sign', '-', path.join(prebuild, 'pty.node')]);
  run('codesign', ['--force', '--sign', '-', path.join(prebuild, 'spawn-helper')]);
  run('codesign', ['--force', '--deep', '--sign', '-', app]);
  run('codesign', ['--verify', '--deep', app]);
  console.log(`after-pack: ad-hoc signed ${app}`);
};
