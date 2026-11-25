import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalBroker } from '../policy/approvals.mjs';

const broker = (opts = {}) => {
  const opened = []; const closed = [];
  const b = new ApprovalBroker({ onOpen: (c) => opened.push(c), onClose: (...a) => closed.push(a), ...opts });
  return { b, opened, closed };
};

test('only the exact string "allow" approves', async () => {
  for (const answer of ['Allow', ' allow', 'allow ', 'yes', true, 1, null, undefined, { behavior: 'allow' }]) {
    const { b, opened } = broker();
    const p = b.ask('Bash', { command: 'ls' }, {});
    b.answer(opened[0].id, answer);
    assert.equal((await p).behavior, 'deny', `answer ${JSON.stringify(answer)} must deny`);
  }
  const { b, opened } = broker();
  const p = b.ask('Bash', { command: 'ls' }, { toolUseID: 't1' });
  b.answer(opened[0].id, 'allow');
  const r = await p;
  assert.equal(r.behavior, 'allow');
  assert.equal(r.updatedPermissions, undefined, 'never "always allow"');
  assert.equal(r.toolUseID, 't1');
});

test('cards open with Deny as the default', () => {
  const { b, opened } = broker();
  b.ask('Bash', {}, {});
  assert.equal(opened[0].defaultChoice, 'deny');
  b.denyAll('test over');
});

test('an answer counts once', async () => {
  const { b, opened } = broker();
  const p = b.ask('Bash', {}, {});
  assert.equal(b.answer(opened[0].id, 'deny'), true);
  assert.equal(b.answer(opened[0].id, 'allow'), false);
  assert.equal((await p).behavior, 'deny');
  assert.equal(b.answer('no-such-id', 'allow'), false);
});

test('abort, timeout and denyAll all deny', async () => {
  const ac = new AbortController();
  const { b } = broker();
  const p1 = b.ask('Bash', {}, { signal: ac.signal });
  ac.abort();
  assert.equal((await p1).behavior, 'deny');

  const pre = new AbortController(); pre.abort();
  assert.equal((await b.ask('Bash', {}, { signal: pre.signal })).behavior, 'deny');

  const { b: fast } = broker({ timeoutMs: 5 });
  assert.equal((await fast.ask('Bash', {}, {})).behavior, 'deny');

  const { b: many } = broker();
  const ps = [many.ask('Bash', {}, {}), many.ask('Edit', {}, {})];
  many.denyAll('stopped');
  for (const r of await Promise.all(ps)) { assert.equal(r.behavior, 'deny'); assert.equal(r.message, 'stopped'); }
  assert.equal(many.size, 0);
});
