// shell.mjs - just enough shell reading for cards and Dev mode (display-grade, not a full parser).
// Bromo, Nov 26: one command that wrote four files with `cat > file <<'EOF'` showed as
// "177 commands", because every line of the file text counted as a step. Here-document text is
// data, not commands, so it is taken out first, and splitting skips anything inside quotes.

// `<<EOF`, `<<-EOF`, `<<'EOF'`, `<<"EOF"`, `<<\EOF` (not `<<<`, a here-string).
const OPENER = /^<<(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|\\?([A-Za-z_][\w.-]*))/;

export const MATHS = /\(\(|\$\[|(^|[\s;&|(])let\s/;

/** Here-documents taken out of a command. quoted: the text is used exactly as written (no $(...)). */
export function stripHeredocs(command) {
  const lines = String(command ?? '').split('\n');
  const out = []; const bodies = []; let q = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; out.push(line);
    const open = [];
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (q) { if (ch === q) q = null; else if (q === '"' && ch === '\\') j++; continue; }
      if (ch === '\\') { j++; continue; }
      if (ch === '"' || ch === "'") { q = ch; continue; }
      // In maths, (( x << y )) and let, << shifts bits; it isn't file text.
      if (ch === '<' && line[j + 1] === '<' && line[j + 2] !== '<' && line[j - 1] !== '<' && !MATHS.test(line.slice(0, j))) {
        const m = OPENER.exec(line.slice(j));
        if (m) { open.push({ delim: m[2] ?? m[3] ?? m[4], dash: m[1] === '-', quoted: m[4] === undefined || /^<<-?[ \t]*\\/.test(m[0]) }); j += m[0].length - 1; }
      }
    }
    for (const h of open) {
      const body = [];
      while (i + 1 < lines.length) {
        const next = lines[++i];
        if ((h.dash ? next.replace(/^\t+/, '') : next) === h.delim) break;
        body.push(next);
      }
      bodies.push({ delim: h.delim, quoted: h.quoted, body: body.join('\n') });
    }
  }
  return { command: out.join('\n'), bodies };
}

/** Split on && || ; and new lines, but never inside quotes. A backslash-newline joins lines. */
export function splitTopLevel(command) {
  const s = String(command ?? ''); const parts = []; let cur = ''; let q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { cur += ch; if (ch === q) q = null; else if (q === '"' && ch === '\\' && i + 1 < s.length) cur += s[++i]; continue; }
    if (ch === '\\' && s[i + 1] === '\n') { i++; cur += ' '; continue; }
    if (ch === '\\' && i + 1 < s.length) { cur += ch + s[++i]; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    const two = s.slice(i, i + 2);
    if (two === '&&' || two === '||') { parts.push(cur); cur = ''; i++; continue; }
    if (ch === ';' || ch === '\n') { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** The command with every quoted string emptied, for checking redirects and command words. */
export function maskQuotes(text) {
  let out = ''; let q = null; const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === q) { q = null; out += ch; } else if (q === '"' && ch === '\\') i++; continue; }
    if (ch === '"' || ch === "'") { q = ch; out += ch; continue; }
    out += ch;
  }
  return out;
}

/**
 * For spotting paths: quoted text that holds < > or | is page text or a sed pattern
 * ('s|<h1>|...|'), not a file name, so it is left out. Everything else stays as written.
 */
export function pathView(text) {
  return String(text ?? '').replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, (m) => (/[<>|]/.test(m) ? ' ' : m));
}

// sed reads, writes or runs things with r/R/w/W/e commands and the s///w and s///e flags.
const SED_FILE = /(^|[;\s{}0-9$/])[rRwWe]\s|[|/#][gIpiM0-9]*[ewW]\s*($|[;}\n'"])/;
/** Does a sed command in this text use a pattern that could read, write or run something? */
export function sedReachesOut(text) {
  const s = String(text ?? '');
  if (!/(^|[\s;&|(])sed\s/.test(maskQuotes(s))) return false;
  return (s.match(/'[^']*'|"(?:[^"\\]|\\.)*"/g) || []).some((m) => SED_FILE.test(m.slice(1, -1)));
}
