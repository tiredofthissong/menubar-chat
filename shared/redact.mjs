// redact.mjs - hide keys, tokens and passwords before anything leaves the helper.
// Rule: redact each STRING VALUE, never serialized JSON (a pattern ending in \S+ can eat a
// closing quote and break the stream). Streamed text reaches here whole lines at a time
// (engine/translate.mjs), so a key split across two chunks is never half-shown. Pure: no I/O.
const HIDDEN = '[hidden secret]';

// keep: 'none' hides the whole match; 'prefix' keeps group 1 ("Bearer "); 'name' keeps
// groups 1 and 2 ("GITHUB_TOKEN=") so the line still reads.
const PATTERNS = [
  { re: /sk-ant-[A-Za-z0-9_-]{8,}/g, keep: 'none' },                 // Anthropic keys
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, keep: 'none' },             // GitHub tokens
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, keep: 'none' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, keep: 'none' },                     // AWS access key ids
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, keep: 'none' },           // Slack tokens
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, keep: 'none' },
  { re: /(Bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi, keep: 'prefix' },   // Authorization headers
  // NAME=value or NAME: value, where NAME sounds secret (API_KEY, TOKEN, PASSWORD ...).
  // A value an earlier pattern already hid is left alone (no "[hidden secret] secret]").
  { re: /\b([A-Z0-9_]*(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Z0-9_]*)(\s*[=:]\s*)(?!\[hidden secret\])("[^"]*"|'[^']*'|[^\s"']{6,})/g, keep: 'name' },
];

// Object keys whose values are always hidden, whatever the value looks like.
const SECRET_KEY_NAME = /^(api[_-]?key|apikey|token|access[_-]?token|secret|password|passwd|authorization|cookie)$/i;

export function redact(text) {
  let out = String(text ?? '');
  for (const { re, keep } of PATTERNS) {
    out = out.replace(re, (...m) => (keep === 'prefix' ? `${m[1]}${HIDDEN}` : keep === 'name' ? `${m[1]}${m[2]}${HIDDEN}` : HIDDEN));
  }
  return out;
}

/** Redact every string inside an event (objects, arrays, strings). Returns a new value. */
export function redactDeep(value, keyName = '') {
  if (typeof value === 'string') return SECRET_KEY_NAME.test(keyName) ? HIDDEN : redact(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v, k);
    return out;
  }
  return value;
}
