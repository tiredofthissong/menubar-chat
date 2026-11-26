// status.mjs - the hover line and icon state, most urgent project first.
// Rules: under 100 characters; never shows a secret; "waiting on you" can't be overwritten
// while an approval card is open; says "(+1 more)" when another project is busy.
import { redact } from '../shared/redact.mjs';

export const STATES = ['idle', 'thinking', 'working', 'waiting', 'stopped', 'error'];
const RANK = { waiting: 5, error: 4, working: 3, thinking: 2, stopped: 1, idle: 0 };
const LABEL = { idle: 'Ready', thinking: 'Thinking', working: 'Working', waiting: 'Waiting on you', stopped: 'Stopped', error: 'Needs a look' };
export const MAX_LINE = 99;

export class StatusBoard {
  constructor() { this.byProject = new Map(); }

  /** @param {string} project  @param {string} state  @param {string} [detail] */
  set(project, state, detail = '') {
    const cur = this.byProject.get(project);
    if (cur?.state === 'waiting' && cur.pendingCards > 0 && state !== 'waiting') return; // sticky while a card is open
    this.byProject.set(project, { state, detail, pendingCards: cur?.pendingCards || 0 });
  }

  setPendingCards(project, n) {
    const cur = this.byProject.get(project) || { state: 'idle', detail: '', pendingCards: 0 };
    cur.pendingCards = n;
    if (n > 0) { cur.state = 'waiting'; cur.detail = cur.detail || 'approve or deny'; }
    else if (cur.state === 'waiting') { cur.state = 'working'; cur.detail = ''; }
    this.byProject.set(project, cur);
  }

  /** How many projects Claude is thinking or working in right now. */
  busy() { return [...this.byProject.values()].filter((s) => s.state === 'thinking' || s.state === 'working').length; }

  top() {
    const all = [...this.byProject.entries()].sort((a, b) => RANK[b[1].state] - RANK[a[1].state]);
    if (!all.length) return { state: 'idle', line: 'Ready' };
    const [name, s] = all[0];
    const busyOthers = all.slice(1).filter(([, o]) => o.state !== 'idle' && o.state !== 'stopped').length;
    const more = busyOthers ? ` (+${busyOthers} more)` : '';
    let line = `${LABEL[s.state]}${s.state === 'idle' ? '' : ` · ${name}`}${s.detail ? `: ${s.detail}` : ''}`;
    line = redact(line);
    const room = MAX_LINE - more.length;
    if (line.length > room) line = line.slice(0, room - 1) + '…';
    return { state: s.state, line: line + more };
  }
}
