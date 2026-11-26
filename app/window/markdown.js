// markdown.js - shows Claude's replies with real headings, bold, lists, tables and code blocks,
// instead of raw "## Router" and "**bold**". Plain script, loaded before app.js; also loaded by
// test/markdown.test.mjs.
//
// Safety: it never builds HTML strings. parse() turns text into plain objects, and toDom() builds
// elements with createElement and textContent only, so nothing Claude writes can become markup.
// Links show their text and address but are not clickable (the window never navigates).
'use strict';
(function (root) {
  // ---- Inline: **bold**, *italic*, `code`, [text](url), ~~strike~~ ----
  const INLINE = /(`+)([\s\S]*?[^`])\1(?!`)|\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__|~~(?=\S)([\s\S]*?\S)~~|\*(?=[^\s*])([\s\S]*?[^\s*])\*|(?<![\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?![\w])|\[([^\]\n]+)\]\(([^)\s]+)\)/;

  function inline(text) {
    const out = [];
    let rest = String(text);
    while (rest) {
      const m = INLINE.exec(rest);
      if (!m) { out.push({ t: 'text', v: rest }); break; }
      if (m.index) out.push({ t: 'text', v: rest.slice(0, m.index) });
      if (m[1]) out.push({ t: 'code', v: m[2].replace(/^ (.*) $/, '$1') });
      else if (m[3] != null || m[4] != null) out.push({ t: 'strong', c: inline(m[3] ?? m[4]) });
      else if (m[5] != null) out.push({ t: 'del', c: inline(m[5]) });
      else if (m[6] != null || m[7] != null) out.push({ t: 'em', c: inline(m[6] ?? m[7]) });
      else if (m[8] != null) out.push({ t: 'link', c: inline(m[8]), href: m[9] });
      rest = rest.slice(m.index + m[0].length);
    }
    return out;
  }

  // ---- Blocks ----
  const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/;
  const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
  const QUOTE = /^ {0,3}>\s?(.*)$/;
  const ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
  const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$|^\s*\|\s*:?-+:?\s*\|\s*$/;
  const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const blank = (line) => !line.trim();

  function parse(text) {
    const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let i = 0;
    const startsBlock = (l, next) => FENCE.test(l) || HEADING.test(l) || RULE.test(l) || QUOTE.test(l) || ITEM.test(l)
      || (l.includes('|') && next != null && TABLE_SEP.test(next));

    while (i < lines.length) {
      const line = lines[i];
      if (blank(line)) { i++; continue; }

      const fence = FENCE.exec(line);
      if (fence) { // a code block; one still being written runs to the end for now
        const body = [];
        i++;
        while (i < lines.length && !new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines[i])) body.push(lines[i++]);
        i++;
        blocks.push({ t: 'codeblock', lang: fence[2] || '', v: body.join('\n') });
        continue;
      }
      const h = HEADING.exec(line);
      if (h) { blocks.push({ t: 'heading', level: h[1].length, c: inline(h[2]) }); i++; continue; }
      if (RULE.test(line)) { blocks.push({ t: 'rule' }); i++; continue; }
      if (QUOTE.test(line)) {
        const body = [];
        while (i < lines.length && QUOTE.test(lines[i])) body.push(QUOTE.exec(lines[i++])[1]);
        blocks.push({ t: 'quote', c: parse(body.join('\n')) });
        continue;
      }
      if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
        const head = cells(line); i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && !blank(lines[i])) rows.push(cells(lines[i++]));
        blocks.push({ t: 'table', head: head.map(inline), rows: rows.map((r) => head.map((_, n) => inline(r[n] ?? ''))) });
        continue;
      }
      const item = ITEM.exec(line);
      if (item) { i = list(lines, i, item[1].length, blocks); continue; }

      const para = [line.trim()]; i++;
      while (i < lines.length && !blank(lines[i]) && !startsBlock(lines[i], lines[i + 1])) para.push(lines[i++].trim());
      blocks.push({ t: 'para', c: inline(para.join('\n')) });
    }
    return blocks;
  }

  // A list, with nested lists for deeper-indented items. Returns the next line index.
  function list(lines, i, indent, blocks) {
    const first = ITEM.exec(lines[i]);
    const ordered = /\d/.test(first[2]);
    const node = { t: ordered ? 'ol' : 'ul', start: ordered ? parseInt(first[2], 10) : 1, items: [] };
    while (i < lines.length) {
      const m = ITEM.exec(lines[i]);
      if (blank(lines[i])) { // a blank line ends the list unless another item follows
        let j = i; while (j < lines.length && blank(lines[j])) j++;
        const n = j < lines.length && ITEM.exec(lines[j]);
        if (n && n[1].length >= indent && /\d/.test(n[2]) === ordered) { i = j; continue; }
        break;
      }
      if (m && m[1].length > indent) { // nested list under the last item
        const last = node.items.at(-1);
        if (!last) break;
        i = list(lines, i, m[1].length, last.sub);
        continue;
      }
      if (!m) { // a wrapped line belongs to the item above
        if (!/^\s+/.test(lines[i]) || !node.items.length || FENCE.test(lines[i])) break;
        node.items.at(-1).text += `\n${lines[i].trim()}`; i++; continue;
      }
      if (m[1].length < indent || /\d/.test(m[2]) !== ordered) break;
      node.items.push({ text: m[3], sub: [] }); i++;
    }
    for (const it of node.items) { it.c = inline(it.text); delete it.text; }
    blocks.push(node);
    return i;
  }

  // ---- To elements (textContent only) ----
  function toDom(blocks, doc) {
    const frag = doc.createDocumentFragment();
    const make = (tag, cls) => { const n = doc.createElement(tag); if (cls) n.className = cls; return n; };
    const addInline = (parent, nodes) => {
      for (const n of nodes) {
        if (n.t === 'text') parent.append(doc.createTextNode(n.v));
        else if (n.t === 'code') { const c = make('code', 'md-code'); c.textContent = n.v; parent.append(c); }
        else if (n.t === 'link') {
          const s = make('span', 'md-link'); addInline(s, n.c); s.title = n.href; parent.append(s);
          const text = s.textContent;
          if (text !== n.href) { const u = make('span', 'md-url'); u.textContent = ` (${n.href})`; parent.append(u); }
        } else { const e = make(n.t); addInline(e, n.c); parent.append(e); }
      }
      return parent;
    };
    const addBlocks = (parent, list) => {
      for (const b of list) {
        if (b.t === 'para') parent.append(addInline(make('p', 'md-p'), b.c));
        else if (b.t === 'heading') {
          // Real heading levels for VoiceOver, sized for a small window (h1-h2 large, h3+ small).
          const n = make(`h${Math.min(6, b.level + 2)}`, `md-h md-h${Math.min(b.level, 3)}`);
          parent.append(addInline(n, b.c));
        } else if (b.t === 'rule') parent.append(make('hr', 'md-hr'));
        else if (b.t === 'quote') { const q = make('blockquote', 'md-quote'); addBlocks(q, b.c); parent.append(q); }
        else if (b.t === 'codeblock') {
          const pre = make('pre', 'md-pre'); const c = make('code'); c.textContent = b.v; pre.append(c);
          if (b.lang) pre.dataset.lang = b.lang;
          parent.append(pre);
        } else if (b.t === 'ul' || b.t === 'ol') {
          const l = make(b.t, 'md-list'); if (b.t === 'ol' && b.start !== 1) l.start = b.start;
          for (const it of b.items) { const li = make('li'); addInline(li, it.c); addBlocks(li, it.sub); l.append(li); }
          parent.append(l);
        } else if (b.t === 'table') {
          const wrap = make('div', 'md-table'); const t = make('table');
          const tr = make('tr'); for (const h of b.head) tr.append(addInline(make('th'), h));
          const thead = make('thead'); thead.append(tr); t.append(thead);
          const tbody = make('tbody');
          for (const r of b.rows) { const row = make('tr'); for (const cell of r) row.append(addInline(make('td'), cell)); tbody.append(row); }
          t.append(tbody); wrap.append(t); parent.append(wrap);
        }
      }
      return parent;
    };
    return addBlocks(frag, blocks);
  }

  const render = (text, doc) => toDom(parse(text), doc);

  root.ChatMarkdown = { parse, inline, toDom, render };
})(typeof window !== 'undefined' ? window : globalThis);
