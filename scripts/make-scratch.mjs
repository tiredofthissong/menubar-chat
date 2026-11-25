// make-scratch.mjs - builds the throwaway folder the Mac test runs in. Touches nothing else.
//   ~/menubar-scratch/personal-demo   a Personal test project (with a typo and a demo skill)
//   ~/menubar-scratch/work-demo       a Work test project
//   ~/menubar-scratch/fake-github/    local stand-ins for GitHub, so no push can leave the Mac
//   ~/menubar-scratch/projects.json   the list the app reads (name, folder, Work or Personal)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

export const scratchRoot = () => process.env.MENUBAR_SCRATCH || path.join(os.homedir(), 'menubar-scratch');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

function makeRepo(root, name, files) {
  const bare = path.join(root, 'fake-github', `${name}.git`);
  const dir = path.join(root, name);
  fs.mkdirSync(bare, { recursive: true });
  git(bare, 'init', '--bare', '-q', '-b', 'main');
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'menubar-chat test');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'Test project');
  git(dir, 'remote', 'add', 'origin', bare);
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  return dir;
}

export function makeScratch() {
  const root = scratchRoot();
  if (fs.existsSync(root)) return { ok: false, root, text: `${root} already exists, so nothing changed. Delete it in Finder first if you want a fresh one.` };
  fs.mkdirSync(root, { recursive: true });
  const personal = makeRepo(root, 'personal-demo', {
    'README.md': '# Personal demo\nA throwaway project for testing the menu bar app.\n',
    'notes.txt': 'This is teh test file for scenario two.\n',
    'kit/demo-skill/SKILL.md': '---\nname: demo-skill\ndescription: A demo skill used only to test the menu bar app.\n---\nSay hello.\n',
  });
  const work = makeRepo(root, 'work-demo', {
    'README.md': '# Work demo\nA throwaway Work-tagged project. Its "GitHub" is a local folder.\n',
    'notes.txt': 'Work notes for scenario three.\n',
  });
  const projects = [
    { name: 'personal-demo', path: personal, tag: 'personal' },
    { name: 'work-demo', path: work, tag: 'work' },
  ];
  fs.writeFileSync(path.join(root, 'projects.json'), JSON.stringify(projects, null, 2) + '\n');
  return { ok: true, root, text: `Scratch folder ready at ${root}: personal-demo (Personal) and work-demo (Work). Next: npm run block-pushes -- ${work}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = makeScratch();
  console.log(r.text);
  process.exitCode = r.ok ? 0 : 1;
}
