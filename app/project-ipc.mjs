// project-ipc.mjs - the window's project actions, done by the app itself (never by Claude):
// add a folder or a GitHub repo, tag it Work or Personal, add the push block to a work repo, and
// put a GitHub project away (folder to the Trash, kept in the list) or copy it back. Each one runs only
// after you pick it in the window; a folder's path never comes from the window, only from the
// Mac's own folder picker.
import fs from 'node:fs';
import path from 'node:path';
import { loadProjects, refuseFolder, addProject, setTag, setAway } from './projects.mjs';
import { whyNotPutAway } from './put-away.mjs';
import { blockPushes, pushBlockState } from '../scripts/block-pushes.mjs';
import { parseRepo, cloneRepo } from './github.mjs';

const disk = { read: (f) => fs.readFileSync(f, 'utf8'), exists: (p) => fs.existsSync(p) };

/**
 * @param {{ ipcMain, dialog, window: () => object, fromOurWindow: (e) => boolean, home: string,
 *   userFile: string, scratchFile: string, onChange: (list: Array) => void }} d
 */
export function createProjects({ ipcMain, dialog, window, fromOurWindow, home, userFile, scratchFile, onChange, clone = cloneRepo, trash = async () => { throw new Error('no Trash'); }, check = whyNotPutAway }) {
  let list = loadProjects([userFile, scratchFile], disk);
  let picked = null; // the folder the Mac's picker returned, waiting for its tag

  const here = () => list.filter((p) => !p.away); // Claude only ever gets projects whose folder is on this Mac
  const view = () => list.map(({ name, tag, path: p, repo, away }) => ({ name, tag, repo: repo || null, away: !!away, pushBlock: tag === 'work' && !away ? pushBlockState(p) : null }));
  function save(next) {
    list = next;
    const mine = loadProjects([userFile], disk).filter((p) => !list.some((q) => q.path === p.path));
    fs.mkdirSync(path.dirname(userFile), { recursive: true });
    fs.writeFileSync(userFile, JSON.stringify([...mine, ...list.map(({ away, ...p }) => p)], null, 2));
    onChange(here());
    return { ok: true, projects: view() };
  }
  const guard = (fn) => async (e, ...args) => (fromOurWindow(e) ? fn(...args) : { ok: false, error: 'not from this window' });

  ipcMain.handle('projects:pick', guard(async () => {
    const r = await dialog.showOpenDialog(window(), { title: 'Add a project folder', buttonLabel: 'Add folder', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths?.[0]) return { ok: false, canceled: true };
    const why = refuseFolder(r.filePaths[0], { home, list });
    if (why) return { ok: false, error: why };
    picked = path.resolve(r.filePaths[0]);
    return { ok: true, folder: path.basename(picked) };
  }));
  ipcMain.handle('projects:add', guard(async (tag) => {
    if (!picked) return { ok: false, error: 'Pick a folder first.' };
    const next = addProject(list, picked, tag); picked = null;
    return { ...save(next), added: next.at(-1).name };
  }));
  // From GitHub: the window sends only the typed repo name; the folder is built from it here.
  ipcMain.handle('projects:github', guard(async (text) => {
    const ref = parseRepo(text);
    if (!ref) return { ok: false, error: 'Type the repo as owner/name, or paste its GitHub link.' };
    const r = await clone(ref, home);
    if (!r.ok) return r;
    const have = list.find((p) => p.path === r.folder);
    if (have?.away) return { ...save(setAway(list, have.name, false, r.folder)), added: have.name, text: `Copied ${have.name} back from GitHub.` };
    if (have) return { ok: true, projects: view(), added: have.name, text: `${have.name} is already in your list.` };
    const why = refuseFolder(r.folder, { home, list });
    if (why) return { ok: false, error: why };
    const next = addProject(list, r.folder, 'personal', `${ref.owner}/${ref.repo}`);
    return { ...save(next), added: next.at(-1).name, text: `${r.reused ? 'Added' : 'Copied and added'} ${ref.repo} from GitHub. It lives in ~/GitHub/${ref.repo}.` };
  }));
  // Put away: only after every check that nothing lives only on this Mac; the folder goes to the Trash.
  ipcMain.handle('projects:putAway', guard(async (name) => {
    const p = list.find((x) => x.name === name);
    if (!p?.repo || p.away) return { ok: false, error: 'Put away is for projects added from GitHub.' };
    if (p.tag !== 'personal') return { ok: false, error: 'Put away is for personal projects, because work never goes to GitHub.' };
    const why = await check(p.path, p.repo);
    if (why) return { ok: false, error: why };
    try { await trash(p.path); } catch { return { ok: false, error: "The folder couldn't go to the Trash, so nothing changed." }; }
    return { ...save(setAway(list, name, true)), text: `${name} is safe on GitHub and its folder is in the Trash. Pick it in the list to copy it back.` };
  }));
  ipcMain.handle('projects:bringBack', guard(async (name) => {
    const p = list.find((x) => x.name === name);
    const ref = p?.away ? parseRepo(p.repo) : null;
    if (!ref) return { ok: false, error: 'That project is already on this Mac.' };
    const r = await clone(ref, home);
    if (!r.ok) return r;
    return { ...save(setAway(list, name, false, r.folder)), text: `Copied ${name} back from GitHub.` };
  }));
  ipcMain.handle('projects:tag', guard(async (name, tag) => {
    if (!list.some((p) => p.name === name) || !['work', 'personal'].includes(tag)) return { ok: false, error: 'There is no project by that name.' };
    return save(setTag(list, name, tag));
  }));
  ipcMain.handle('projects:block', guard(async (name) => {
    const p = list.find((x) => x.name === name);
    if (!p || p.tag !== 'work') return { ok: false, error: 'The push block is for work projects.' };
    const r = blockPushes(p.path);
    return { ok: r.ok, text: r.text.replace(p.path, p.name), projects: view() };
  }));

  return { get list() { return here(); }, view };
}
