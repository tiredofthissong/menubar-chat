// The contract between the window and the helper: strict both ways.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateCommand, event, COMMANDS, EVENT_TYPES, CONTRACT_VERSION } from '../shared/contract.mjs';

test('good commands pass', () => {
  assert.equal(validateCommand({ type: 'send', project: 'work-demo', text: 'hi' }).ok, true);
  assert.equal(validateCommand({ type: 'answer', project: 'work-demo', id: 'a1b2-c3', decision: 'deny' }).ok, true);
  assert.equal(validateCommand({ type: 'resume', project: 'p', sessionId: '0f9c2a1e-1234' }).ok, true);
});

test('anything else is refused, not ignored', () => {
  const bad = [
    null, 'send', [], {}, { type: 'eval' }, { type: '__proto__' }, { type: 'toString' },
    { type: 'send', project: 'p' },                                   // no text
    { type: 'send', project: 'p', text: '   ' },                      // empty
    { type: 'send', project: 'p', text: 'x'.repeat(20001) },          // too long
    { type: 'send', project: 'p', text: 'hi', mode: 'bypassPermissions' }, // extra field
    { type: 'send', project: '../etc', text: 'hi' },                  // odd project name
    { type: 'answer', project: 'p', id: 'a b', decision: 'allow' },  // bad id
    { type: 'answer', project: 'p', id: 'a', decision: { allow: true } },
    { type: 'resume', project: 'p', sessionId: '../../x' },
  ];
  for (const b of bad) assert.equal(validateCommand(b).ok, false, JSON.stringify(b));
});

test('events: known types only, stamped with the contract version', () => {
  assert.deepEqual(event('text', { text: 'hi' }), { v: CONTRACT_VERSION, text: 'hi', type: 'text' });
  assert.equal(event('text', { type: 'approval' }).type, 'text', 'a field can not change the type');
  assert.throws(() => event('mystery'));
});

test('every event the engine builds is a known type, and every command has an action', () => {
  const files = ['engine/session.mjs', 'engine/translate.mjs', 'engine/helper.mjs'];
  for (const f of files) {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    for (const [, type] of src.matchAll(/event\('([a-z_]+)'/g)) assert.ok(EVENT_TYPES.includes(type), `${f}: ${type}`);
  }
  const helper = fs.readFileSync(new URL('../engine/helper.mjs', import.meta.url), 'utf8');
  for (const name of Object.keys(COMMANDS)) assert.match(helper, new RegExp(`\\b${name}: `), name);
});
