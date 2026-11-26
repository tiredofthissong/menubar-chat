// package-mac.mjs - builds the app you open like any other: "Menu Bar Chat.app" in dist/.
// Run it on the Mac:  npm run package
// It only builds. Copying the app to Applications, opening it, and turning on Start at login are
// each your own step. The app is unsigned (ad-hoc signed on this Mac only), so it never leaves it.
//   - asar is off, so Claude Code's own program (the SDK's native binary) runs from the app as is.
//   - LSUIElement keeps it out of the Dock: it lives in the menu bar only.
//   - Test files and developer scripts stay out of the app.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const APP_NAME = 'Menu Bar Chat';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Kept out of the app: tests, the build output, developer checks, local notes.
export const LEFT_OUT = [
  /^\/test(\/|$)/, /^\/mock(\/|$)/, /^\/dist(\/|$)/, /^\/\.git(\/|$)/, /^\/proving-results\.md$/,
  /^\/scripts\/(smoke-electron|check-learn|make-scratch|make-icons|package-mac)\.mjs$/,
];

export function packageOptions({ root = ROOT, platform = process.platform, arch = process.arch } = {}) {
  return {
    dir: root, out: path.join(root, 'dist'), overwrite: true, quiet: true,
    name: APP_NAME, executableName: platform === 'darwin' ? APP_NAME : 'menu-bar-chat',
    platform, arch, asar: false, prune: true, ignore: LEFT_OUT,
    appBundleId: 'local.menubar-chat', appCategoryType: 'public.app-category.productivity',
    extendInfo: { LSUIElement: true },
  };
}

async function main() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) {
    console.log(`This needs Node 22.12 or newer to build the app; this Mac has ${process.versions.node}. Install the current Node from nodejs.org, then run it again.`);
    process.exitCode = 1; return;
  }
  const { packager } = await import('@electron/packager');
  const [platform, arch] = process.argv.slice(2); // a developer check builds for linux in the cloud
  const opts = packageOptions(platform ? { platform, arch } : {});
  const [out] = await packager(opts);
  const bundle = opts.platform === 'darwin' ? path.join(out, `${APP_NAME}.app`) : out;
  // On the Mac: an ad-hoc signature for this Mac only, so macOS runs the renamed app.
  if (opts.platform === 'darwin' && process.platform === 'darwin') execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle]);
  console.log(`Built: ${bundle}`);
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.log(`The build stopped: ${e.message}`); process.exitCode = 1; });
