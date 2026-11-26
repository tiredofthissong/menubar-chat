// projects.mjs - the list of project folders, each tagged Work or Personal (untagged counts as Work).
// Two files are read: the app's own list (projects you added in the window) and the scratch list
// that `npm run scratch` makes. The app's own list wins for a folder that's in both. Only the app's
// own list is ever written. Pure apart from the small fs object passed in, so tests need no Mac.
import path from 'node:path';

const NAME = /^[\w][\w .-]{0,63}$/; // the same rule the window-helper contract uses

const clean = (p) => ({ name: p.name, path: p.path, tag: p.tag === 'personal' ? 'personal' : 'work' });

/** @param {{ read: (file: string) => string, exists: (p: string) => boolean }} fs */
export function loadProjects(files, fs) {
  const seen = new Set(); const out = [];
  for (const file of files) {
    let list = [];
    try { list = JSON.parse(fs.read(file)); } catch { continue; }
    for (const p of Array.isArray(list) ? list : []) {
      if (typeof p?.name !== 'string' || !NAME.test(p.name) || typeof p.path !== 'string' || !fs.exists(p.path)) continue;
      if (seen.has(p.path) || out.some((o) => o.name === p.name)) continue;
      seen.add(p.path); out.push(clean(p));
    }
  }
  return out;
}

/** A name the contract accepts, from the folder's own name, made unique in the list. */
export function nameFor(folder, list) {
  const base = (path.basename(folder).replace(/[^\w .-]/g, '-').replace(/^[^\w]+/, '') || 'project').slice(0, 56);
  let name = base; let n = 2;
  while (list.some((p) => p.name === name)) name = `${base} ${n++}`;
  return name;
}

/**
 * Why a folder can't be a project, or null when it can. Claude gets the whole folder, so your
 * home folder, the top of the disk and system or secret folders are refused.
 */
export function refuseFolder(folder, { home, list }) {
  const abs = path.resolve(folder);
  if (abs === path.parse(abs).root || abs === home || abs === path.dirname(home)) return 'That folder holds too much of your Mac. Pick one project folder inside it.';
  const inside = (d) => abs === d || abs.startsWith(d + path.sep);
  if (['/System', '/Library', '/Applications', '/usr', '/bin', '/etc', '/private'].some(inside)) return 'That is a system folder. Pick one of your own project folders.';
  if (['Library', '.ssh', '.aws', '.gnupg', '.config'].map((d) => path.join(home, d)).some(inside)) return 'That folder holds settings or keys. Pick one of your own project folders.';
  if (list.some((p) => p.path === abs)) return 'That folder is already in your list.';
  return null;
}

/** The list with one folder added (tag picked by you; anything else counts as Work). */
export function addProject(list, folder, tag) {
  const abs = path.resolve(folder);
  return [...list, clean({ name: nameFor(abs, list), path: abs, tag })];
}

/** The list with one project's tag changed. */
export const setTag = (list, name, tag) => list.map((p) => (p.name === name ? clean({ ...p, tag }) : p));
