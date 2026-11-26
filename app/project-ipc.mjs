// project-ipc.mjs - the window's project actions, done by the app itself (never by Claude):
// add a folder, tag it Work or Personal, and add the push block to a work repo. Each one runs only
// after you pick it in the window; a folder's path never comes from the window, only from the
// Mac's own folder picker.
import fs from 'node:fs';
import path from 'node:path';
import { loadProjects, refuseFolder, addProject, setTag } from './projects.mjs';
import { blockPushes, pushBlockState } from '../scripts/block-pushes.mjs';

const disk = { read: (f) => fs.readFileSync(f, 'utf8'), exists: (p) => fs.existsSync(p) };

/**
 * @param {{ ipcMain, dialog, window: () => object, fromOurWindow: (e) => boolean, home: string,
 *   userFile: string, scratchFile: string, onChange: (list: Array) => void }} d
 */
export function createProjects({ ipcMain, dialog, window, fromOurWindow, home, userFile, scratchFile, onChange }) {
  let list = loadProjects([userFile, scratchFile], disk);
  let picked = null; // the folder the Mac's picker returned, waiting for its tag

  const view = () => list.map(({ name, tag, path: p }) => ({ name, tag, pushBlock: tag === 'work' ? pushBlockState(p) : null }));
  function save(next) {
    list = next;
    const mine = loadProjects([userFile], disk).filter((p) => !list.some((q) => q.path === p.path));
    fs.mkdirSync(path.dirname(userFile), { recursive: true });
    fs.writeFileSync(userFile, JSON.stringify([...mine, ...list], null, 2));
    onChange(list);
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

  return { get list() { return list; }, view };
}
