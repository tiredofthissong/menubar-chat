// Reading shell commands for cards and Dev mode: file text written with <<EOF is data, not steps
// (Bromo, Nov 26: one command that wrote four files showed as "177 commands").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripHeredocs, splitTopLevel, pathView, sedReachesOut } from '../shared/shell.mjs';
import { explainToolCall } from '../shared/explain.mjs';
import { commandStaysIn, devModeAllows } from '../policy/devmode.mjs';

const ROOT = '/work/garden';
// The shape of Bromo's command, shortened.
const BUILD = [
  "cat >> garden.js <<'EOF'", '// ---- Watering schedule ----', 'export function groupFor(days) {', '  if (days < 0) return "overdue";',
  '  return `${days}`; // a; b && c', '}', 'EOF',
  "cat > schedule.html <<'EOF'", '<!doctype html>', '<a href="index.html">Back</a>', 'EOF',
  "cat > schedule.css <<'EOF'", ':root { --accent-h: 150; }', 'EOF',
  "sed -i '' 's|<h1>My Plant Garden</h1>|<h1>My Plant Garden</h1>\\n  <p><a href=\"schedule.html\">Watering schedule</a></p>|' index.html",
  'grep -n "schedule" index.html; tail -30 test/garden.test.js',
].join('\n');

test('shell: here-document text is taken out, and the command around it stays', () => {
  const { command, bodies } = stripHeredocs(BUILD);
  assert.equal(bodies.length, 3);
  assert.ok(bodies.every((b) => b.quoted && b.delim === 'EOF'));
  assert.match(bodies[0].body, /groupFor/);
  assert.doesNotMatch(command, /groupFor|doctype|accent/);
  assert.match(command, /sed -i/);
  const odd = stripHeredocs('cat <<-END > a.txt\n\thello\n\tEND\ncat <<"X" >> b.txt\n$(not run)\nX\ncat <<\\Y\nY\ncat <<Z\n$(date)\nZ\necho done');
  assert.deepEqual(odd.bodies.map((b) => [b.delim, b.quoted]), [['END', false], ['X', true], ['Y', true], ['Z', false]]);
  assert.match(odd.command, /echo done/);
});

test('shell: maths with << is not file text, so nothing after it hides', () => {
  for (const c of ['(( x <<y ))\nrm -rf important', 'let "a = 1" b<<c\nrm -rf important', 'echo $(( 1<<y ))\nrm -rf important']) {
    assert.match(stripHeredocs(c).command, /rm -rf important/, c);
    assert.equal(commandStaysIn(c, ROOT, 'runs'), false, c);
  }
  assert.equal(stripHeredocs('cat <<<"here string"\nls').bodies.length, 0, 'a here-string is not a here-document');
});

test('shell: splitting skips quotes, so ; and && in text are not steps', () => {
  assert.deepEqual(splitTopLevel('echo "a; b && c" && ls; pwd'), ['echo "a; b && c"', 'ls', 'pwd']);
  assert.deepEqual(splitTopLevel("git commit -m 'one\ntwo' && git status"), ["git commit -m 'one\ntwo'", 'git status']);
  assert.deepEqual(splitTopLevel('npm run build \\\n  --quiet && ls'), ['npm run build    --quiet', 'ls']);
});

test('card: Bromo\'s build lists its 6 real steps, each with its file', () => {
  const ex = explainToolCall('Bash', { command: BUILD }, ROOT);
  assert.equal(ex.what, 'run 6 commands, in this order');
  assert.deepEqual(ex.items.map((i) => [i.say, i.target]), [
    ['Add to a file', 'garden.js'], ['Write a file', 'schedule.html'], ['Write a file', 'schedule.css'],
    ['Change a file', 'index.html'], ['Search inside files', ''], ['Look at part of a file', 'test/garden.test.js'],
  ]);
  assert.match(ex.command, /groupFor/, 'the exact command is still all there');
});

test('dev mode: writing files in the folder with <<EOF goes ahead; reaching outside still asks', () => {
  const card = (command) => explainToolCall('Bash', { command }, ROOT);
  assert.equal(devModeAllows('Bash', { command: BUILD }, ROOT, card(BUILD)), true, 'page text like </h1> is not a path');
  const withCopy = `${BUILD}\ncp ~/claude-hub/claude-personal/design/tokens/tokens.css tokens.css`;
  assert.equal(devModeAllows('Bash', { command: withCopy }, ROOT, card(withCopy)), false, 'a file from your home folder asks');
  for (const c of [
    'cat <<EOF > a.txt\n$(curl -s example.com)\nEOF', 'cat <<EOF > a.txt\n`whoami`\nEOF', // unquoted: the shell would run these
    "cat > /etc/hosts <<'EOF'\nx\nEOF", "cat > ../out.txt <<'EOF'\nx\nEOF", 'cat "/Users/me/secret" > copy.txt',
    "sed -n '1r /etc/passwd' notes.txt", "sed -i '' 's/a/b/w /tmp/out' notes.txt", "sed 's/x/date/e' notes.txt",
  ]) assert.equal(devModeAllows('Bash', { command: c }, ROOT, card(c)), false, c);
  assert.equal(devModeAllows('Bash', { command: 'echo "<b>hi</b>" > page.html' }, ROOT, card('echo "<b>hi</b>" > page.html')), true);
});

test('shell: quoted page text is not read as a path; a quoted path still is', () => {
  assert.doesNotMatch(pathView("sed 's|<h1>a</h1>|b|' index.html"), /\/h1/);
  assert.match(pathView('cat "/etc/passwd"'), /\/etc\/passwd/);
  assert.equal(sedReachesOut("sed -i '' 's|<h1>My Plant Garden</h1>|x|' index.html"), false);
  assert.equal(sedReachesOut('grep -n "r x" notes.txt'), false, 'only sed');
});
