// skills.mjs - notices new or changed skills and /commands, so they show up without restarting the
// app. Claude Code reads them when its process starts; the session compares this fingerprint
// before each message and, when it changed, picks the same chat up again in a fresh process.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PLACES = ['.claude/skills', '.claude/commands'];

/** The folders Claude Code reads skills and /commands from, for this project and for you. */
export const skillDirs = (projectDir, home = os.homedir()) => PLACES.flatMap((p) => [path.join(projectDir, p), path.join(home, p)]);

/** Names and change times, one level down. Cheap enough to run before every message. */
export function skillStamp(dirs) {
  const out = [];
  for (const d of dirs) {
    let names = []; try { names = fs.readdirSync(d).sort(); } catch { continue; }
    for (const n of names) {
      const p = path.join(d, n); let t = 0;
      try { t = fs.statSync(path.join(p, 'SKILL.md')).mtimeMs; } catch { try { t = fs.statSync(p).mtimeMs; } catch { /* gone meanwhile */ } }
      out.push(`${p}:${t}`);
    }
  }
  return out.join('|');
}
