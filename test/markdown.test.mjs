// markdown.test.mjs - Claude's replies show real headings, lists and code, never raw "## Router".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../app/window/markdown.js', import.meta.url), 'utf8');
const ctx = { window: {} }; vm.runInNewContext(src, ctx);
const M = ctx.window.ChatMarkdown;
const plain = (o) => JSON.parse(JSON.stringify(o)); // objects from the vm, compared here
const types = (text) => plain(M.parse(text)).map((b) => b.t);

test('the example from Bromo: "## Router" becomes a heading, not text with hashes', () => {
  const [h, p] = plain(M.parse('## Router\nThe router sends each message to the right project.'));
  assert.equal(h.t, 'heading'); assert.equal(h.level, 2);
  assert.deepEqual(h.c, [{ t: 'text', v: 'Router' }]);
  assert.equal(p.t, 'para');
});

test('bold, italic, inline code and links', () => {
  const c = plain(M.inline('Run **npm start**, then *wait* for `ready` — see [the guide](https://code.claude.com/docs).'));
  assert.deepEqual(c.map((n) => n.t), ['text', 'strong', 'text', 'em', 'text', 'code', 'text', 'link', 'text']);
  assert.equal(c[5].v, 'ready');
  assert.equal(c[7].href, 'https://code.claude.com/docs');
  assert.deepEqual(plain(M.inline('2 * 3 * 4 and snake_case_name')), [{ t: 'text', v: '2 * 3 * 4 and snake_case_name' }], 'math and names stay as they are');
});

test('lists, nested lists, numbered lists', () => {
  const [ul, ol] = plain(M.parse('- one\n- two\n  - two a\n- three\n\n1. first\n2. second'));
  assert.equal(ul.t, 'ul'); assert.equal(ul.items.length, 3);
  assert.equal(ul.items[1].sub[0].t, 'ul');
  assert.equal(ol.t, 'ol'); assert.equal(ol.items.length, 2);
});

test('code blocks keep their text exactly, even half-written', () => {
  const [code] = plain(M.parse('```bash\ngit pull && npm start\n```'));
  assert.equal(code.t, 'codeblock'); assert.equal(code.lang, 'bash'); assert.equal(code.v, 'git pull && npm start');
  const [open] = plain(M.parse('```\n## not a heading'));
  assert.equal(open.t, 'codeblock'); assert.equal(open.v, '## not a heading', 'still streaming: stays code');
});

test('tables, quotes and rules', () => {
  assert.deepEqual(types('| File | What |\n|---|---|\n| a.js | app |\n\n> a note\n\n---'), ['table', 'quote', 'rule']);
  const [t] = plain(M.parse('| A | B |\n| - | - |\n| 1 |'));
  assert.equal(t.t, 'table'); assert.equal(t.rows[0].length, 2, 'a short row is padded to the header');
  assert.deepEqual(types('a | b\nnot a table'), ['para'], 'a stray bar is just text');
});

test('nothing Claude writes becomes markup', () => {
  const blocks = plain(M.parse('<img src=x onerror=alert(1)> **<b>hi</b>**'));
  const flat = JSON.stringify(blocks);
  assert.match(flat, /<img src=x onerror=alert\(1\)>/, 'kept as text');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function|href\s*=/);
});

test('builds elements with a document', () => {
  // A tiny stand-in for the browser's document: enough to check the shape.
  const node = (tag) => ({ tag, kids: [], dataset: {}, set textContent(v) { this.kids = [{ text: v }]; }, get textContent() { return this.kids.map((k) => k.text ?? k.textContent).join(''); }, append(...k) { this.kids.push(...k); } });
  const doc = { createElement: node, createDocumentFragment: () => node('#frag'), createTextNode: (text) => ({ text }) };
  const frag = M.render('## Router\n\n- **one**', doc);
  assert.deepEqual(frag.kids.map((k) => k.tag), ['h4', 'ul']);
  assert.equal(frag.kids[0].className, 'md-h md-h2');
  assert.equal(frag.kids[1].kids[0].kids[0].tag, 'strong');
});
