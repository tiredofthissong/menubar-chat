// redact.mjs - hide secrets in anything shown in the window or the hover line.
// Works on string values (never on serialized JSON). Streamed text is released whole
// lines at a time (see LineBuffer) so a key split across two chunks is never half-shown.
const PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,              // Anthropic keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,          // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,                  // AWS access key ids
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,         // Slack tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];
export function redact(text) {
  let out = String(text ?? '');
  for (const re of PATTERNS) out = out.replace(re, '[hidden secret]');
  return out;
}

export class LineBuffer {
  constructor() { this.buf = ''; }
  /** Add a chunk; returns the redacted complete lines (may be ''). */
  push(chunk) {
    this.buf += chunk;
    const cut = this.buf.lastIndexOf('\n');
    if (cut < 0) return '';
    const ready = this.buf.slice(0, cut + 1); this.buf = this.buf.slice(cut + 1);
    return redact(ready);
  }
  /** Release whatever is left (end of a message). */
  flush() { const rest = this.buf; this.buf = ''; return redact(rest); }
}
